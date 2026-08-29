import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 초대 시점 저장소 주소 캡처·전파 (티켓 r8vIviEcwHFbFJ88RqZ7).
 *
 * ★고치는 실버그: 멤버 기기의 "저장소 연결" 모달은 project.gitRemoteUrl 을
 * 보고 clone 을 제안하는데, 그 필드는 **로컬 git 폴더가 붙은 기기**에서만
 * 채워진다. owner 가 그 경로를 지난 적 없으면 초대받은 멤버는 로컬 repo 가
 * 없어 스스로 채울 수도 없어서 모달이 clone 대상을 영영 모른다. 초대가
 * owner 기기에서 일어나는 마지막 기회이므로 그 순간에 캡처한다.
 *
 * 계약:
 *  - 프로젝트에 URL 이 있으면 그 값을 그대로 쓰고 다시 쓰지 않는다.
 *  - 없으면 이 기기 칸의 경로에서 git origin 을 읽어 project 에 backfill 하고,
 *    초대 문서에도 실어 둔다(project 쓰기가 실패해도 남는 두 번째 창구).
 *  - 캡처 실패는 초대를 막지 않는다(전 구간 fail-soft).
 *  - 수락 시 초대에 실린 URL 을 project 로 승격하되 기존 값은 덮지 않는다.
 */

const MACHINE = "macbook-darwin-1";
const OWNER_PATH = "/Users/owner/app";
const ORIGIN = "https://github.com/acme/app.git";

const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const readFailures = vi.hoisted(() => new Set<string>());

vi.mock("../../src/services/firestore", () => ({
  getDocument: async (path: string, id: string) => {
    const key = `${path}/${id}`;
    if (readFailures.has(key)) throw new Error(`read failed: ${key}`);
    return docs.get(key) ?? null;
  },
  queryDocuments: async () => [],
  setDocument: async (
    path: string,
    id: string,
    data: Record<string, unknown>,
  ) => {
    docs.set(`${path}/${id}`, { ...data });
  },
  updateDocument: async (
    path: string,
    id: string,
    data: Record<string, unknown>,
  ) => {
    docs.set(`${path}/${id}`, {
      ...(docs.get(`${path}/${id}`) ?? {}),
      ...data,
    });
  },
  deleteDocument: async (path: string, id: string) => {
    docs.delete(`${path}/${id}`);
  },
  subscribeToCollection: () => () => {},
  toTimestamp: (date: Date) => date,
  convertTimestamps: <T>(raw: Record<string, unknown>) => raw as T,
}));

const projectMock = vi.hoisted(() => ({
  project: null as Record<string, unknown> | null,
  updates: [] as Array<Record<string, unknown>>,
  updateFails: false,
  addMember: vi.fn(),
}));

vi.mock("../../src/services/projectService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/projectService")>();
  return {
    // 정규화는 진짜 구현을 쓴다 — 이 테스트가 검증하려는 계약의 일부다.
    normalizeGitRemoteUrl: actual.normalizeGitRemoteUrl,
    getProject: async () => projectMock.project,
    updateProject: async (_id: string, data: Record<string, unknown>) => {
      if (projectMock.updateFails) throw new Error("permission-denied");
      projectMock.updates.push(data);
      projectMock.project = { ...(projectMock.project ?? {}), ...data };
    },
    addMember: (projectId: string, userId: string) =>
      projectMock.addMember(projectId, userId),
  };
});

const electron = vi.hoisted(() => ({
  machineId: null as string | null,
  gitRemoteUrl: vi.fn(async (_path: string) => null as string | null),
}));

function installElectronApi() {
  // 항상 최신 스텁을 거쳐 부른다 — 테스트 본문에서 갈아끼운 fn 이 먹히도록.
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      getMachineId: async () => electron.machineId,
      fs: { gitRemoteUrl: (path: string) => electron.gitRemoteUrl(path) },
    },
  };
}

/** owner 기기 칸이 있는 프로젝트 문서(스토어가 아닌 **원본** 문서 모양). */
function projectDoc(extra: Record<string, unknown> = {}) {
  return {
    id: "p1",
    name: "app",
    ownerId: "owner",
    members: ["owner"],
    folderPaths: {
      [`m_${MACHINE}`]: {
        path: OWNER_PATH,
        platform: "darwin",
        machineId: MACHINE,
        updatedAt: 1,
      },
    },
    ...extra,
  };
}

beforeEach(() => {
  docs.clear();
  readFailures.clear();
  projectMock.project = projectDoc();
  projectMock.updates = [];
  projectMock.updateFails = false;
  projectMock.addMember = vi.fn(async () => {});
  electron.machineId = MACHINE;
  electron.gitRemoteUrl = vi.fn(async () => ORIGIN);
  installElectronApi();
  vi.resetModules();
});

describe("getProjectMembers — missing users documents", () => {
  it("keeps a project.members uid visible when users/{uid} is missing", async () => {
    projectMock.project = projectDoc({ members: ["owner", "missing-user"] });
    docs.set("users/owner", {
      id: "owner",
      email: "owner@example.com",
      displayName: "Owner",
      photoURL: "",
      createdAt: new Date("2026-01-01"),
    });
    const teamService = await import("../../src/services/teamService");

    const members = await teamService.getProjectMembers("p1");

    expect(members.map((member) => member.id)).toEqual([
      "owner",
      "missing-user",
    ]);
    expect(members[1]).toMatchObject({
      id: "missing-user",
      email: "missing-user",
      displayName: "missing-user",
      photoURL: "",
    });
  });

  it("keeps a project.members uid visible when users/{uid} cannot be read", async () => {
    projectMock.project = projectDoc({ members: ["owner", "unreadable-user"] });
    docs.set("users/owner", {
      id: "owner",
      email: "owner@example.com",
      displayName: "Owner",
      photoURL: "",
      createdAt: new Date("2026-01-01"),
    });
    readFailures.add("users/unreadable-user");
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const teamService = await import("../../src/services/teamService");

    const members = await teamService.getProjectMembers("p1");

    expect(members.map((member) => member.id)).toEqual([
      "owner",
      "unreadable-user",
    ]);
    expect(members[1].displayName).toBe("unreadable-user");
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining("users/unreadable-user read failed"),
      expect.any(Error),
    );
    warn.mockRestore();
  });
});

describe("createInvitation — repo URL capture", () => {
  it("captures the owner machine's git origin and backfills the project", async () => {
    const teamService = await import("../../src/services/teamService");

    const id = await teamService.createInvitation(
      "p1",
      "Member@Example.com",
      "member",
      "owner",
    );

    expect(electron.gitRemoteUrl).toHaveBeenCalledWith(OWNER_PATH);
    expect(projectMock.updates).toEqual([{ gitRemoteUrl: ORIGIN }]);
    expect(docs.get(`invitations/${id}`)).toMatchObject({
      projectId: "p1",
      invitedEmail: "member@example.com",
      gitRemoteUrl: ORIGIN,
    });
  });

  it("reuses an existing project URL without touching git or rewriting", async () => {
    projectMock.project = projectDoc({ gitRemoteUrl: ORIGIN });
    const teamService = await import("../../src/services/teamService");

    const id = await teamService.createInvitation(
      "p1",
      "member@example.com",
      "member",
      "owner",
    );

    expect(electron.gitRemoteUrl).not.toHaveBeenCalled();
    expect(projectMock.updates).toEqual([]);
    expect(docs.get(`invitations/${id}`)).toMatchObject({
      gitRemoteUrl: ORIGIN,
    });
  });

  it("still carries the URL on the invitation when the project write is denied", async () => {
    projectMock.updateFails = true;
    const teamService = await import("../../src/services/teamService");

    const id = await teamService.createInvitation(
      "p1",
      "member@example.com",
      "member",
      "owner",
    );

    expect(docs.get(`invitations/${id}`)).toMatchObject({
      gitRemoteUrl: ORIGIN,
    });
  });

  it("invites anyway (no gitRemoteUrl field) when this machine has no local clone", async () => {
    // 다른 기기의 칸만 있는 프로젝트 → 이 디스크엔 경로가 없다(폴백 금지).
    projectMock.project = projectDoc({
      folderPaths: {
        m_other: {
          path: "C:\\Users\\owner\\app",
          platform: "win32",
          machineId: "other",
          updatedAt: 1,
        },
      },
    });
    const teamService = await import("../../src/services/teamService");

    const id = await teamService.createInvitation(
      "p1",
      "member@example.com",
      "member",
      "owner",
    );

    expect(electron.gitRemoteUrl).not.toHaveBeenCalled();
    // undefined 를 실으면 Firestore 가 거부한다 — 키 자체가 없어야 한다.
    expect(docs.get(`invitations/${id}`)).toBeDefined();
    expect(docs.get(`invitations/${id}`)).not.toHaveProperty("gitRemoteUrl");
  });

  it("invites anyway when the folder has no git origin", async () => {
    electron.gitRemoteUrl = vi.fn(async () => null);
    const teamService = await import("../../src/services/teamService");

    const id = await teamService.createInvitation(
      "p1",
      "member@example.com",
      "member",
      "owner",
    );

    expect(projectMock.updates).toEqual([]);
    expect(docs.get(`invitations/${id}`)).not.toHaveProperty("gitRemoteUrl");
  });
});

describe("acceptInvitation — repo URL propagation", () => {
  const later = new Date(Date.now() + 60_000);

  function seedInvitation(extra: Record<string, unknown> = {}) {
    docs.set("invitations/p1_member@example.com", {
      projectId: "p1",
      invitedEmail: "member@example.com",
      invitedBy: "owner",
      role: "member",
      status: "pending",
      createdAt: new Date(),
      expiresAt: later,
      ...extra,
    });
  }

  it("promotes the invitation URL onto a project that has none", async () => {
    seedInvitation({ gitRemoteUrl: ORIGIN });
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation("p1_member@example.com", "member-uid");

    expect(projectMock.addMember).toHaveBeenCalledWith("p1", "member-uid");
    expect(projectMock.updates).toEqual([{ gitRemoteUrl: ORIGIN }]);
    expect(docs.get("invitations/p1_member@example.com")).toMatchObject({
      status: "accepted",
    });
  });

  it("never overwrites a URL the project already has", async () => {
    projectMock.project = projectDoc({
      gitRemoteUrl: "git@github.com:acme/other.git",
    });
    seedInvitation({ gitRemoteUrl: ORIGIN });
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation("p1_member@example.com", "member-uid");

    expect(projectMock.updates).toEqual([]);
  });

  it("accepts normally when the invitation carries no URL", async () => {
    seedInvitation();
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation("p1_member@example.com", "member-uid");

    expect(projectMock.updates).toEqual([]);
    expect(docs.get("invitations/p1_member@example.com")).toMatchObject({
      status: "accepted",
    });
  });

  it("still joins when the propagation write is denied (fail-soft)", async () => {
    projectMock.updateFails = true;
    seedInvitation({ gitRemoteUrl: ORIGIN });
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation("p1_member@example.com", "member-uid");

    expect(projectMock.addMember).toHaveBeenCalled();
    expect(docs.get("invitations/p1_member@example.com")).toMatchObject({
      status: "accepted",
    });
  });
});
