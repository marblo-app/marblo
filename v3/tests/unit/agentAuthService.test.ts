import type { User } from "firebase/auth";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface MergeWrite {
  collectionName: string;
  docId: string;
  data: Record<string, unknown>;
}

const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const writes = vi.hoisted(() => [] as MergeWrite[]);
const issueAgentCustomToken = vi.hoisted(() =>
  vi.fn(async () => ({ data: { customToken: "agent-token", uid: "u1" } })),
);

vi.mock("firebase/functions", () => ({
  httpsCallable: vi.fn(() => issueAgentCustomToken),
}));

vi.mock("../../src/lib/firebase", () => ({
  functions: {},
}));

vi.mock("../../src/services/firestore", () => ({
  getDocument: async (collectionName: string, docId: string) =>
    docs.get(`${collectionName}/${docId}`) ?? null,
  mergeDocument: async (
    collectionName: string,
    docId: string,
    data: Record<string, unknown>,
  ) => {
    writes.push({ collectionName, docId, data });
    docs.set(`${collectionName}/${docId}`, {
      ...(docs.get(`${collectionName}/${docId}`) ?? {}),
      ...data,
    });
  },
  toTimestamp: (date: Date) => date,
}));

vi.mock("../../src/services/projectService", () => ({
  addMember: vi.fn(async () => undefined),
  getProjects: vi.fn(async () => []),
}));

function authUser(overrides: Partial<User> = {}): User {
  return {
    uid: "u1",
    email: "ada@example.com",
    displayName: "Ada",
    photoURL: "https://example.com/ada.png",
    getIdToken: vi.fn(async () => "id-token"),
    ...overrides,
  } as unknown as User;
}

beforeEach(() => {
  docs.clear();
  writes.length = 0;
  issueAgentCustomToken.mockClear();
  delete (globalThis as { window?: unknown }).window;
  vi.resetModules();
});

describe("ensureUserProfile", () => {
  it("creates users/{uid} when the profile is missing", async () => {
    const { ensureUserProfile } = await import(
      "../../src/services/agentAuthService"
    );

    const result = await ensureUserProfile(authUser());

    expect(result).toBe("created");
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      collectionName: "users",
      docId: "u1",
      data: {
        email: "ada@example.com",
        displayName: "Ada",
        photoURL: "https://example.com/ada.png",
        createdAt: expect.any(Date),
        updatedAt: expect.any(Date),
      },
    });
  });

  it("does not write on boot when users/{uid} already matches Firebase profile fields", async () => {
    docs.set("users/u1", {
      id: "u1",
      email: "ada@example.com",
      displayName: "Ada",
      photoURL: "https://example.com/ada.png",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { ensureUserProfile } = await import(
      "../../src/services/agentAuthService"
    );

    const result = await ensureUserProfile(authUser());

    expect(result).toBe("unchanged");
    expect(writes).toEqual([]);
  });

  it("updates only changed Firebase profile fields for explicit login or provider changes", async () => {
    docs.set("users/u1", {
      id: "u1",
      email: "old@example.com",
      displayName: "Old Name",
      photoURL: "https://example.com/old.png",
      createdAt: new Date("2026-01-01T00:00:00.000Z"),
      updatedAt: new Date("2026-01-02T00:00:00.000Z"),
    });
    const { ensureUserProfile } = await import(
      "../../src/services/agentAuthService"
    );

    const result = await ensureUserProfile(authUser());

    expect(result).toBe("updated");
    expect(writes).toHaveLength(1);
    expect(writes[0].data).toEqual({
      email: "ada@example.com",
      displayName: "Ada",
      photoURL: "https://example.com/ada.png",
      updatedAt: expect.any(Date),
    });
  });

  it("serializes concurrent repairs for the same uid so a missing profile is written once", async () => {
    const { ensureUserProfile } = await import(
      "../../src/services/agentAuthService"
    );

    const results = await Promise.all([
      ensureUserProfile(authUser()),
      ensureUserProfile(authUser()),
    ]);

    expect(results).toEqual(["created", "unchanged"]);
    expect(writes).toHaveLength(1);
  });
});

describe("syncAgentFirebaseAuth", () => {
  it("keeps the existing explicit auth sync path but skips profile writes when unchanged", async () => {
    const syncAgentCustomToken = vi.fn(async () => ({ ok: true }));
    (globalThis as { window?: unknown }).window = {
      electronAPI: {
        auth: {
          syncAgentCustomToken,
        },
      },
    };
    docs.set("users/u1", {
      id: "u1",
      email: "ada@example.com",
      displayName: "Ada",
      photoURL: "https://example.com/ada.png",
    });
    const { syncAgentFirebaseAuth } = await import(
      "../../src/services/agentAuthService"
    );

    await syncAgentFirebaseAuth(authUser(), { forceRefreshIdToken: true });

    expect(writes).toEqual([]);
    expect(issueAgentCustomToken).toHaveBeenCalledOnce();
    expect(syncAgentCustomToken).toHaveBeenCalledWith("agent-token");
  });
});
