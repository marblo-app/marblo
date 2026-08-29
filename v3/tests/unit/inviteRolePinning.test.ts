import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 초대 수락이 `invitation.role` 을 역할 문서로 못 박는다
 * (티켓 uhkQrRBgeBRddWb6OeDa, P1).
 *
 * ★고치는 실버그: 수락은 `addMember()` 만 하고 `invitation.role` 을 그대로
 * 버렸다. 그래서 수락자는 `memberRoles/{projectId}_{uid}` 문서가 **없는 멤버**가
 * 됐고, 서버(`normalizeMemberRole`)와 룰(`getMemberRole`)이 문서 없음을 기본값
 * `member` 로 접어 **저장소 write 토큰을 내줬다** — viewer 로 초대해도.
 * 라이브 확인(2026-08-29): 역할 문서 없는 계정 →
 * `{"ok":true,"role":"member","access":"write"}`.
 *
 * 계약:
 *  - 수락하면 초대장의 역할이 그대로 `memberRoles` 문서가 된다.
 *  - 역할 문서 쓰기가 **addMember 보다 먼저** 일어난다. 반대 순서면 역할
 *    쓰기가 실패했을 때 "문서 없는 멤버"가 생겨 그 사고가 그대로 재현된다.
 *  - 역할 쓰기가 실패하면 던지고 멤버로 만들지 않는다(삼키지 않는다).
 *  - 'owner' 와 모르는 값은 `member` 로 접는다 — owner 는 projects.ownerId
 *    로만 되며 역할 문서로 승격되지 않는다.
 */

const docs = vi.hoisted(() => new Map<string, Record<string, unknown>>());
const writeFailures = vi.hoisted(() => new Set<string>());
const callOrder = vi.hoisted(() => [] as string[]);

vi.mock("../../src/services/firestore", () => ({
  getDocument: async (path: string, id: string) =>
    docs.get(`${path}/${id}`) ?? null,
  queryDocuments: async () => [],
  setDocument: async (
    path: string,
    id: string,
    data: Record<string, unknown>,
  ) => {
    const key = `${path}/${id}`;
    if (writeFailures.has(key)) throw new Error(`permission-denied: ${key}`);
    callOrder.push(`set:${key}`);
    docs.set(key, { ...data });
  },
  updateDocument: async (
    path: string,
    id: string,
    data: Record<string, unknown>,
  ) => {
    const key = `${path}/${id}`;
    callOrder.push(`update:${key}`);
    docs.set(key, { ...(docs.get(key) ?? {}), ...data });
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
  addMember: vi.fn(),
}));

vi.mock("../../src/services/projectService", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../src/services/projectService")>();
  return {
    normalizeGitRemoteUrl: actual.normalizeGitRemoteUrl,
    getProject: async () => projectMock.project,
    updateProject: async () => {},
    addMember: (projectId: string, userId: string) => {
      callOrder.push("addMember");
      return projectMock.addMember(projectId, userId);
    },
  };
});

const INVITE_ID = "p1_member@example.com";
const UID = "member-uid";
const ROLE_DOC_KEY = `memberRoles/p1_${UID}`;

function seedInvitation(role: unknown) {
  docs.set(`invitations/${INVITE_ID}`, {
    projectId: "p1",
    invitedEmail: "member@example.com",
    invitedBy: "owner",
    role,
    status: "pending",
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 60_000),
  });
}

beforeEach(() => {
  docs.clear();
  writeFailures.clear();
  callOrder.length = 0;
  projectMock.project = {
    id: "p1",
    name: "app",
    ownerId: "owner",
    members: ["owner"],
  };
  projectMock.addMember = vi.fn();
  (globalThis as { window?: unknown }).window = {
    electronAPI: {
      getMachineId: async () => null,
      fs: { gitRemoteUrl: async () => null },
    },
  };
});

describe("acceptInvitation — 초대 역할을 memberRoles 에 못 박는다", () => {
  it("★viewer 초대를 수락하면 viewer 역할 문서가 생긴다 (문서 없는 멤버 금지)", async () => {
    seedInvitation("viewer");
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation(INVITE_ID, UID);

    expect(docs.get(ROLE_DOC_KEY)).toEqual({
      projectId: "p1",
      userId: UID,
      role: "viewer",
    });
    expect(projectMock.addMember).toHaveBeenCalledWith("p1", UID);
  });

  it.each(["admin", "member", "viewer"])(
    "%s 초대는 같은 역할로 기록된다",
    async (role) => {
      seedInvitation(role);
      const teamService = await import("../../src/services/teamService");

      await teamService.acceptInvitation(INVITE_ID, UID);

      expect(docs.get(ROLE_DOC_KEY)).toMatchObject({ role });
    },
  );

  it("★역할 문서를 addMember 보다 먼저 쓴다", async () => {
    seedInvitation("viewer");
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation(INVITE_ID, UID);

    // 순서가 뒤집히면 역할 쓰기 실패 시 "문서 없는 멤버"가 남아 사고가 재현된다.
    expect(callOrder.indexOf(`set:${ROLE_DOC_KEY}`)).toBeLessThan(
      callOrder.indexOf("addMember"),
    );
  });

  it("★역할 문서 쓰기가 실패하면 멤버로 만들지 않고 던진다", async () => {
    seedInvitation("viewer");
    writeFailures.add(ROLE_DOC_KEY);
    const teamService = await import("../../src/services/teamService");

    await expect(teamService.acceptInvitation(INVITE_ID, UID)).rejects.toThrow(
      /permission-denied/,
    );
    expect(projectMock.addMember).not.toHaveBeenCalled();
    // 초대는 pending 으로 남아 재시도가 성립한다.
    expect(docs.get(`invitations/${INVITE_ID}`)).toMatchObject({
      status: "pending",
    });
  });

  it("★'owner' 초대로는 owner 역할 문서를 만들지 않는다 — member 로 접는다", async () => {
    seedInvitation("owner");
    const teamService = await import("../../src/services/teamService");

    await teamService.acceptInvitation(INVITE_ID, UID);

    expect(docs.get(ROLE_DOC_KEY)).toMatchObject({ role: "member" });
  });

  it("모르는 값·비문자열은 member 로 접는다 (서버 normalizeMemberRole 과 같다)", async () => {
    const teamService = await import("../../src/services/teamService");
    for (const raw of [undefined, null, "", "maintainer", 42]) {
      expect(teamService.memberRoleFromInvitation(raw)).toBe("member");
    }
    expect(teamService.memberRoleFromInvitation(" VIEWER ")).toBe("viewer");
    expect(teamService.memberRoleFromInvitation("Admin")).toBe("admin");
    expect(teamService.memberRoleFromInvitation("owner")).toBe("member");
  });

  it("만료·중복 수락은 역할 문서를 쓰기 전에 막힌다", async () => {
    seedInvitation("viewer");
    docs.set(`invitations/${INVITE_ID}`, {
      ...(docs.get(`invitations/${INVITE_ID}`) as Record<string, unknown>),
      status: "accepted",
    });
    const teamService = await import("../../src/services/teamService");

    await expect(
      teamService.acceptInvitation(INVITE_ID, UID),
    ).rejects.toThrow();
    expect(docs.get(ROLE_DOC_KEY)).toBeUndefined();
  });
});
