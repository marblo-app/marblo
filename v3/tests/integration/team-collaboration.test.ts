import { beforeEach, describe, expect, it, vi } from "vitest";

type Constraint = {
  field: string;
  op: string;
  value: unknown;
};

type StoredDoc = Record<string, unknown>;

/**
 * Deterministic two-user Firestore substitute for the collaboration E2E.
 *
 * The production Firebase mock intentionally has no live listeners. This
 * adapter is scoped to this suite so the real team/chat/collaboration service
 * functions can be exercised without requiring a Firebase emulator or leaking
 * state into other tests.
 */
const backend = vi.hoisted(() => {
  let nextId = 0;
  const docs = new Map<string, Map<string, StoredDoc>>();
  const listeners = new Set<{
    path: string;
    constraints: Constraint[];
    callback: (items: Array<StoredDoc & { id: string }>) => void;
  }>();

  const collection = (path: string) => {
    if (!docs.has(path)) docs.set(path, new Map());
    return docs.get(path)!;
  };

  const matches = (data: StoredDoc, constraints: Constraint[]) =>
    constraints.every((constraint) => {
      const value = data[constraint.field];
      if (constraint.op === "==") return value === constraint.value;
      if (constraint.op === "array-contains") {
        return Array.isArray(value) && value.includes(constraint.value);
      }
      return true;
    });

  const read = (path: string, id: string): StoredDoc | null =>
    collection(path).get(id) ?? null;

  const snapshot = (path: string, constraints: Constraint[]) =>
    [...collection(path).entries()]
      .filter(([, data]) => matches(data, constraints))
      .map(([id, data]) => ({ id, ...data }));

  const notify = (path: string) => {
    for (const listener of listeners) {
      if (listener.path === path) {
        listener.callback(snapshot(path, listener.constraints));
      }
    }
  };

  const applySentinel = (oldValue: unknown, value: unknown) => {
    if (
      value &&
      typeof value === "object" &&
      (value as { __kind?: string }).__kind === "arrayUnion"
    ) {
      const old = Array.isArray(oldValue) ? oldValue : [];
      return [...new Set([...old, ...(value as { values: unknown[] }).values])];
    }
    if (
      value &&
      typeof value === "object" &&
      (value as { __kind?: string }).__kind === "arrayRemove"
    ) {
      const removed = new Set((value as { values: unknown[] }).values);
      return (Array.isArray(oldValue) ? oldValue : []).filter(
        (item) => !removed.has(item),
      );
    }
    return value;
  };

  const reset = () => {
    nextId = 0;
    docs.clear();
    listeners.clear();
  };

  const seed = (path: string, id: string, data: StoredDoc) => {
    collection(path).set(id, { ...data });
    notify(path);
  };

  const create = (path: string, data: StoredDoc) => {
    const id = `e2e-${++nextId}`;
    collection(path).set(id, { ...data });
    notify(path);
    return id;
  };

  const update = (path: string, id: string, data: StoredDoc) => {
    const current = read(path, id) ?? {};
    const next = { ...current };
    for (const [key, value] of Object.entries(data)) {
      next[key] = applySentinel(current[key], value);
    }
    collection(path).set(id, next);
    notify(path);
  };

  const remove = (path: string, id: string) => {
    collection(path).delete(id);
    notify(path);
  };

  const subscribe = (
    path: string,
    constraints: Constraint[],
    callback: (items: Array<StoredDoc & { id: string }>) => void,
  ) => {
    const listener = { path, constraints, callback };
    listeners.add(listener);
    callback(snapshot(path, constraints));
    return () => listeners.delete(listener);
  };

  return {
    reset,
    seed,
    read,
    create,
    update,
    remove,
    snapshot,
    subscribe,
  };
});

vi.mock("../../src/services/firestore", () => ({
  getDocument: async (path: string, id: string) => {
    const data = backend.read(path, id);
    return data ? ({ id, ...data } as unknown) : null;
  },
  queryDocuments: async (path: string, ...constraints: Constraint[]) =>
    backend.snapshot(path, constraints),
  createDocument: async (path: string, data: StoredDoc) =>
    backend.create(path, data),
  setDocument: async (path: string, id: string, data: StoredDoc) => {
    backend.seed(path, id, data);
  },
  updateDocument: async (path: string, id: string, data: StoredDoc) => {
    backend.update(path, id, data);
  },
  deleteDocument: async (path: string, id: string) => {
    backend.remove(path, id);
  },
  subscribeToCollection: (
    path: string,
    constraints: Constraint[],
    callback: (items: Array<StoredDoc & { id: string }>) => void,
  ) => backend.subscribe(path, constraints, callback),
  toTimestamp: (date: Date) => date,
  convertTimestamps: <T>(data: StoredDoc, fields: string[]) => {
    const result = { ...data };
    for (const field of fields) {
      const value = result[field] as { toDate?: () => Date } | undefined;
      if (value && typeof value.toDate === "function") {
        result[field] = value.toDate();
      }
    }
    return result as T;
  },
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    chatMessageSent: vi.fn(),
    taskCreated: vi.fn(),
    taskStatusChanged: vi.fn(),
  },
  getClientId: () => "test-client",
  isTelemetryEnabled: () => false,
}));

vi.mock("../../src/services/taskOutcomeReporter", () => ({
  observeTaskSnapshot: vi.fn(),
  resetTaskOutcomeObserver: vi.fn(),
}));

vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));

vi.mock("firebase/functions", () => ({
  httpsCallable: () => async () => ({ data: null }),
}));

vi.mock("firebase/firestore", () => {
  class TestTimestamp {
    constructor(private readonly date: Date) {}

    static fromDate(date: Date) {
      return new TestTimestamp(date);
    }

    static now() {
      return new TestTimestamp(new Date());
    }

    toMillis() {
      return this.date.getTime();
    }

    toDate() {
      return this.date;
    }
  }

  const pathOf = (...parts: string[]) => parts.filter(Boolean).join("/");
  const collection = (_db: unknown, ...parts: string[]) => ({
    kind: "collection",
    path: pathOf(...parts),
  });
  const doc = (_db: unknown, ...parts: string[]) => {
    const id = parts.at(-1)!;
    return { kind: "doc", path: pathOf(...parts.slice(0, -1)), id };
  };
  const toConstraints = (constraints: unknown[]) =>
    constraints.filter(
      (constraint): constraint is Constraint =>
        !!constraint && typeof constraint === "object" && "field" in constraint,
    );
  const asSnapshot = (path: string, constraints: Constraint[]) => {
    const items = backend.snapshot(path, constraints);
    return {
      docs: items.map(({ id, ...data }) => ({ id, data: () => data })),
      empty: items.length === 0,
      size: items.length,
    };
  };

  return {
    Timestamp: TestTimestamp,
    collection,
    doc,
    query: (ref: { path: string }, ...constraints: unknown[]) => ({
      kind: "query",
      path: ref.path,
      constraints: toConstraints(constraints),
    }),
    where: (field: string, op: string, value: unknown) => ({
      field,
      op,
      value,
    }),
    arrayUnion: (...values: unknown[]) => ({ __kind: "arrayUnion", values }),
    arrayRemove: (...values: unknown[]) => ({ __kind: "arrayRemove", values }),
    serverTimestamp: () => TestTimestamp.now(),
    setDoc: async (ref: { path: string; id: string }, data: StoredDoc) =>
      backend.seed(ref.path, ref.id, data),
    updateDoc: async (ref: { path: string; id: string }, data: StoredDoc) =>
      backend.update(ref.path, ref.id, data),
    deleteDoc: async (ref: { path: string; id: string }) =>
      backend.remove(ref.path, ref.id),
    getDoc: async (ref: { path: string; id: string }) => {
      const data = backend.read(ref.path, ref.id);
      return {
        id: ref.id,
        exists: () => data !== null,
        data: () => data,
      };
    },
    getDocs: async (ref: { path: string; constraints?: Constraint[] }) =>
      asSnapshot(ref.path, ref.constraints ?? []),
    onSnapshot: (
      ref: { path: string; constraints?: Constraint[] },
      callback: (snapshot: unknown) => void,
    ) =>
      backend.subscribe(ref.path, ref.constraints ?? [], (items) => {
        callback({
          docs: items.map(({ id, ...data }) => ({ id, data: () => data })),
        });
      }),
    runTransaction: async () => {
      throw new Error("Transactions are outside this E2E scenario");
    },
  };
});

describe("@e2e project invitation → chat → collaboration", () => {
  const projectId = "project-collaboration-e2e";
  const owner = {
    uid: "user-owner",
    email: "owner@example.test",
    displayName: "Owner",
  };
  const invitee = {
    uid: "user-invitee",
    email: "invitee@example.test",
    displayName: "Invitee",
  };

  beforeEach(() => {
    backend.reset();
    backend.seed("projects", projectId, {
      name: "Shared E2E Project",
      ownerId: owner.uid,
      members: [owner.uid],
      folderPath: "/tmp/shared-e2e-project",
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    backend.seed("users", owner.uid, {
      email: owner.email,
      displayName: owner.displayName,
      createdAt: new Date(),
    });
    backend.seed("users", invitee.uid, {
      email: invitee.email,
      displayName: invitee.displayName,
      createdAt: new Date(),
    });
  });

  it("invites the second identity and records acceptance in project.members", async () => {
    const teamService = await import("../../src/services/teamService");
    const projectService = await import("../../src/services/projectService");

    const invitationId = await teamService.createInvitation(
      projectId,
      invitee.email,
      "member",
      owner.uid,
    );
    const pending = await teamService.getMyInvitations(invitee.email);
    expect(pending).toHaveLength(1);
    expect(pending[0].id).toBe(invitationId);
    expect(pending[0].invitedEmail).toBe(invitee.email);

    await teamService.acceptInvitation(invitationId, invitee.uid);

    const invitation = await teamService.getMyInvitations(invitee.email);
    const project = await projectService.getProject(projectId);
    expect(invitation).toHaveLength(0);
    expect(project?.members).toEqual(
      expect.arrayContaining([owner.uid, invitee.uid]),
    );
  });

  it("delivers owner chat messages to the invitee listener by projectId", async () => {
    const chatService = await import("../../src/services/chatService");
    const ownerInbox: string[] = [];
    const inviteeInbox: string[] = [];
    const stopOwner = chatService.subscribeToMessages(projectId, (messages) => {
      ownerInbox.push(
        ...messages
          .filter((message) => !ownerInbox.includes(message.id))
          .map((message) => message.content),
      );
    });
    const stopInvitee = chatService.subscribeToMessages(
      projectId,
      (messages) => {
        inviteeInbox.push(
          ...messages
            .filter((message) => !inviteeInbox.includes(message.id))
            .map((message) => message.content),
        );
      },
    );

    await chatService.sendUserMessage(
      projectId,
      owner.uid,
      owner.displayName,
      "",
      "hello from owner",
    );

    expect(ownerInbox).toContain("hello from owner");
    expect(inviteeInbox).toContain("hello from owner");
    stopOwner();
    stopInvitee();
  });

  it("shows the other authenticated member in presence and keeps the board project-scoped", async () => {
    const collaborationService =
      await import("../../src/services/collaborationService");
    const taskService = await import("../../src/services/taskService");
    const seenByOwner: string[][] = [];
    const stopPresence = collaborationService.subscribeToPresence(
      projectId,
      (presence) => {
        seenByOwner.push(
          presence
            .filter((member) => member.userId !== owner.uid)
            .map((member) => member.userId),
        );
      },
    );

    await collaborationService.updatePresence(
      projectId,
      invitee.uid,
      "shared-board",
      invitee.displayName,
      "",
    );
    backend.seed("tasks", "shared-task", {
      projectId,
      title: "Invitee can see this board task",
      status: "TODO",
      priority: 1,
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    const visibleToInvitee = await taskService.getTasks(projectId);
    expect(seenByOwner.at(-1)).toContain(invitee.uid);
    expect(seenByOwner.at(-1)).not.toContain(owner.uid);
    expect(visibleToInvitee.map((task) => task.id)).toContain("shared-task");
    stopPresence();
  });
});
