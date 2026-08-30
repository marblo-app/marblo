import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 팀 협업 서비스 계약 — 초대 플로우 전 단계 + 역할 게이트 + 경계 케이스
 * (티켓 NQjByMhXZMA0BpN1fg8c).
 *
 * ★무엇을 고정하나:
 *  1. **초대 생성 → 수락 → 역할 부여 → 역할 변경 → 제거** 전 단계에서 역할이
 *     보존되는지. #1299 는 수락 단계에서 `invitation.role` 이 버려져 viewer 로
 *     초대해도 member 권한이 나갔던 사고다 — 여기서는 그 단계를 **전 플로우 안에서**
 *     다시 잡는다(단계별 단위는 tests/unit/inviteRolePinning.test.ts).
 *  2. **viewer 는 쓰지 못한다.** ROLE_PERMISSIONS 의 `write` 한 칸이 저장소
 *     push(functions/src/githubApp.ts ROLE_CAN_WRITE)·보드 티켓(firestore.rules
 *     canWriteTasks)·화면(teamRoles.canWriteTasksAsRole)의 공통 게이트다.
 *     `checkPermission` 은 그 표를 memberRoles 문서와 결합하는 유일한 서비스 경로다.
 *  3. 경계: 만료된 초대·이미 처리된 초대·id/본문 불일치·중복 초대·이미 멤버인
 *     사람의 재수락·역할 필드가 없는 레거시 문서·빈 팀·1인 팀·owner 제거.
 *
 * 인메모리 백엔드는 `services/firestore` 계층에서 끊는다 — arrayUnion/arrayRemove
 * 를 실제 배열 연산으로 해석해서 `projectService.addMember/removeMember` 가
 * **진짜로** members 배열을 바꾸는지까지 본다(setDocument 호출 여부만 세면
 * "문서는 썼는데 멤버는 안 됐다" 를 못 잡는다).
 */

type Doc = Record<string, unknown>;

const backend = vi.hoisted(() => {
  const store = new Map<string, Doc>();
  const key = (path: string, id: string) => `${path}/${id}`;
  return {
    store,
    reset() {
      store.clear();
    },
    seed(path: string, id: string, data: Doc) {
      store.set(key(path, id), { ...data });
    },
    read(path: string, id: string): Doc | null {
      const d = store.get(key(path, id));
      return d ? { ...d } : null;
    },
    list(path: string): Array<Doc & { id: string }> {
      const out: Array<Doc & { id: string }> = [];
      for (const [k, v] of store.entries()) {
        if (k.startsWith(`${path}/`)) {
          out.push({ id: k.slice(path.length + 1), ...v });
        }
      }
      return out;
    },
  };
});

type Constraint = { type: "where"; field: string; op: string; value: unknown };
type ArrayOp = { __kind: "arrayUnion" | "arrayRemove"; values: unknown[] };

const isArrayOp = (v: unknown): v is ArrayOp =>
  !!v && typeof v === "object" && "__kind" in (v as Doc);

function applyUpdate(existing: Doc, data: Doc): Doc {
  const next = { ...existing };
  for (const [k, v] of Object.entries(data)) {
    if (isArrayOp(v)) {
      const cur = Array.isArray(next[k]) ? [...(next[k] as unknown[])] : [];
      if (v.__kind === "arrayUnion") {
        for (const x of v.values) if (!cur.includes(x)) cur.push(x);
      } else {
        next[k] = cur.filter((x) => !v.values.includes(x));
        continue;
      }
      next[k] = cur;
    } else {
      next[k] = v;
    }
  }
  return next;
}

vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {}, functions: {} }));

vi.mock("firebase/firestore", () => ({
  where: (field: string, op: string, value: unknown) => ({
    type: "where",
    field,
    op,
    value,
  }),
  arrayUnion: (...values: unknown[]) => ({ __kind: "arrayUnion", values }),
  arrayRemove: (...values: unknown[]) => ({ __kind: "arrayRemove", values }),
  Timestamp: class {
    constructor(private readonly d: Date) {}
    static fromDate(d: Date) {
      return new (this as unknown as new (d: Date) => unknown)(d);
    }
    toDate() {
      return this.d;
    }
  },
}));

vi.mock("../../src/services/firestore", () => ({
  getDocument: async (path: string, id: string) => {
    const d = backend.read(path, id);
    return d ? { id, ...d } : null;
  },
  queryDocuments: async (path: string, ...constraints: Constraint[]) =>
    backend
      .list(path)
      .filter((d) =>
        constraints.every((c) =>
          c.type === "where" && c.op === "==" ? d[c.field] === c.value : true,
        ),
      ),
  setDocument: async (path: string, id: string, data: Doc) => {
    backend.seed(path, id, data);
  },
  updateDocument: async (path: string, id: string, data: Doc) => {
    const existing = backend.read(path, id);
    if (!existing) throw new Error(`not-found: ${path}/${id}`);
    backend.seed(path, id, applyUpdate(existing, data));
  },
  deleteDocument: async (path: string, id: string) => {
    backend.store.delete(`${path}/${id}`);
  },
  subscribeToCollection: () => () => {},
  toTimestamp: (date: Date) => date,
  convertTimestamps: <T>(raw: Doc) => raw as T,
}));

const teamService = await import("../../src/services/teamService");
const { ROLE_PERMISSIONS } = await import("../../src/types/invitation");
const { canWriteTasksAsRole, canMergeAsRole } =
  await import("../../src/lib/teamRoles");

const PROJECT = "proj-team";
const OWNER = "uid-owner";
const INVITEE = "uid-invitee";
const INVITEE_EMAIL = "Invitee@Example.com";
const INVITEE_EMAIL_NORM = "invitee@example.com";

function seedProject(members: string[] = [OWNER]) {
  backend.seed("projects", PROJECT, {
    name: "Team",
    ownerId: OWNER,
    members,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  });
}

function project() {
  return backend.read("projects", PROJECT) as { members: string[] };
}

function roleDoc(uid: string) {
  return backend.read("memberRoles", `${PROJECT}_${uid}`);
}

function invitationDoc(id: string) {
  return backend.read("invitations", id);
}

beforeEach(() => {
  backend.reset();
});

// ═════════════════════════════════════════════════════════════════════════════
// 역할 게이트 — viewer 는 쓰지 못한다
// ═════════════════════════════════════════════════════════════════════════════

describe("역할 게이트 — ROLE_PERMISSIONS 의 write 한 칸", () => {
  it("★viewer 만 write 가 없다 (서버 ROLE_CAN_WRITE 와 같은 표)", () => {
    // functions/src/githubApp.ts ROLE_CAN_WRITE = {owner,admin,member: true, viewer: false}
    const canWrite = Object.fromEntries(
      (["owner", "admin", "member", "viewer"] as const).map((r) => [
        r,
        ROLE_PERMISSIONS[r].includes("write"),
      ]),
    );
    expect(canWrite).toEqual({
      owner: true,
      admin: true,
      member: true,
      viewer: false,
    });
    expect(canWriteTasksAsRole("viewer")).toBe(false);
    expect(canWriteTasksAsRole("member")).toBe(true);
  });

  it("★viewer 는 read 외 아무것도 못 한다", () => {
    expect(ROLE_PERMISSIONS.viewer).toEqual(["read"]);
  });

  it("checkPermission: memberRoles 문서의 viewer 는 write 거부, read 허용", async () => {
    seedProject([OWNER, INVITEE]);
    backend.seed("memberRoles", `${PROJECT}_${INVITEE}`, {
      projectId: PROJECT,
      userId: INVITEE,
      role: "viewer",
    });
    expect(await teamService.checkPermission(PROJECT, INVITEE, "read")).toBe(
      true,
    );
    expect(await teamService.checkPermission(PROJECT, INVITEE, "write")).toBe(
      false,
    );
    expect(await teamService.checkPermission(PROJECT, INVITEE, "merge")).toBe(
      false,
    );
  });

  it("checkPermission: owner 는 역할 문서와 무관하게 owner (ownerId 가 이긴다)", async () => {
    seedProject([OWNER]);
    // 잘못 써진 viewer 문서가 있어도 ownerId 가 우선한다 — 룰·서버와 같은 규약.
    backend.seed("memberRoles", `${PROJECT}_${OWNER}`, {
      projectId: PROJECT,
      userId: OWNER,
      role: "viewer",
    });
    expect(await teamService.getMemberRole(PROJECT, OWNER)).toBe("owner");
    expect(await teamService.checkPermission(PROJECT, OWNER, "write")).toBe(
      true,
    );
    expect(
      await teamService.checkPermission(PROJECT, OWNER, "delete_project"),
    ).toBe(true);
  });

  it("역할 문서가 없는 멤버는 member 로 접힌다 (서버 normalizeMemberRole(undefined) 과 같은 기본값)", async () => {
    seedProject([OWNER, INVITEE]);
    expect(await teamService.getMemberRole(PROJECT, INVITEE)).toBe("member");
    expect(await teamService.checkPermission(PROJECT, INVITEE, "write")).toBe(
      true,
    );
    expect(await teamService.checkPermission(PROJECT, INVITEE, "merge")).toBe(
      false,
    );
  });

  it("모르는 action 은 어떤 역할이든 false (fail-closed)", async () => {
    seedProject([OWNER]);
    expect(
      await teamService.checkPermission(PROJECT, OWNER, "launch_rockets"),
    ).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 초대 플로우 전 단계 — 각 단계에서 역할이 보존된다
// ═════════════════════════════════════════════════════════════════════════════

describe("초대 플로우: 생성 → 수락 → 역할 부여 → 역할 변경 → 제거", () => {
  it("★viewer 로 초대하면 끝까지 viewer 다 — 수락 후 write 가 나가지 않는다 (#1299 회귀)", async () => {
    seedProject([OWNER]);

    // 1) 생성 — 역할·이메일 정규화·7일 만료가 문서에 실린다.
    const invId = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "viewer",
      OWNER,
    );
    expect(invId).toBe(`${PROJECT}_${INVITEE_EMAIL_NORM}`);
    const inv = invitationDoc(invId)!;
    expect(inv.role).toBe("viewer");
    expect(inv.status).toBe("pending");
    expect(inv.invitedEmail).toBe(INVITEE_EMAIL_NORM);
    expect(inv.invitedBy).toBe(OWNER);
    const ttlMs =
      (inv.expiresAt as Date).getTime() - (inv.createdAt as Date).getTime();
    expect(ttlMs).toBe(7 * 24 * 60 * 60 * 1000);
    expect(inv).not.toHaveProperty("gitRemoteUrl"); // undefined 를 싣지 않는다

    // 2) 수락 — 역할 문서 + 멤버십 + status 셋이 모두 맞아야 한다.
    await teamService.acceptInvitation(invId, INVITEE);
    expect(roleDoc(INVITEE)).toEqual({
      projectId: PROJECT,
      userId: INVITEE,
      role: "viewer",
    });
    expect(project().members).toEqual([OWNER, INVITEE]);
    expect(invitationDoc(invId)!.status).toBe("accepted");

    // 3) 역할이 서비스 조회·권한 판정까지 그대로 흐른다.
    expect(await teamService.getMemberRole(PROJECT, INVITEE)).toBe("viewer");
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
      [INVITEE]: "viewer",
    });
    // ★여기서 true 가 나오면 #1299 가 재발한 것이다.
    expect(await teamService.checkPermission(PROJECT, INVITEE, "write")).toBe(
      false,
    );

    // 4) 역할 변경 — updateMemberRole 이 memberRoles 의 유일한 writer 다.
    await teamService.updateMemberRole(PROJECT, INVITEE, "admin");
    expect(roleDoc(INVITEE)!.role).toBe("admin");
    expect(await teamService.getMemberRole(PROJECT, INVITEE)).toBe("admin");
    expect(await teamService.checkPermission(PROJECT, INVITEE, "merge")).toBe(
      true,
    );
    expect(
      canMergeAsRole(await teamService.getMemberRole(PROJECT, INVITEE)),
    ).toBe(true);
    // 강등도 그대로 반영된다.
    await teamService.updateMemberRole(PROJECT, INVITEE, "viewer");
    expect(await teamService.checkPermission(PROJECT, INVITEE, "write")).toBe(
      false,
    );

    // 5) 제거 — 멤버십과 역할 문서가 함께 사라진다.
    await teamService.removeMember(PROJECT, INVITEE);
    expect(project().members).toEqual([OWNER]);
    expect(roleDoc(INVITEE)).toBeNull();
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
    });
    expect(await teamService.getProjectMembers(PROJECT)).toHaveLength(1);
  });

  it.each(["admin", "member", "viewer"] as const)(
    "%s 초대는 수락 후 정확히 그 역할 문서가 된다",
    async (role) => {
      seedProject([OWNER]);
      const id = await teamService.createInvitation(
        PROJECT,
        INVITEE_EMAIL,
        role,
        OWNER,
      );
      await teamService.acceptInvitation(id, INVITEE);
      expect(roleDoc(INVITEE)!.role).toBe(role);
      expect(await teamService.getMemberRole(PROJECT, INVITEE)).toBe(role);
    },
  );

  it("★수락은 역할 문서를 addMember 보다 먼저 쓴다 — 역할 쓰기 실패 시 '문서 없는 멤버' 를 만들지 않는다", async () => {
    seedProject([OWNER]);
    const id = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "viewer",
      OWNER,
    );
    const firestore = await import("../../src/services/firestore");
    const spy = vi
      .spyOn(firestore, "setDocument")
      .mockImplementationOnce(async () => {
        throw new Error("permission-denied");
      });
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow(
      "permission-denied",
    );
    spy.mockRestore();
    expect(project().members).toEqual([OWNER]); // 멤버가 되지 않았다
    expect(roleDoc(INVITEE)).toBeNull();
    expect(invitationDoc(id)!.status).toBe("pending"); // 재시도 가능

    // 재시도는 멱등하게 성립한다.
    await teamService.acceptInvitation(id, INVITEE);
    expect(roleDoc(INVITEE)!.role).toBe("viewer");
    expect(project().members).toEqual([OWNER, INVITEE]);
  });

  it("거절하면 status=rejected 이고 멤버·역할 문서는 생기지 않는다", async () => {
    seedProject([OWNER]);
    const id = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "member",
      OWNER,
    );
    await teamService.rejectInvitation(id);
    expect(invitationDoc(id)!.status).toBe("rejected");
    expect(project().members).toEqual([OWNER]);
    expect(roleDoc(INVITEE)).toBeNull();
    // 거절된 초대는 더 이상 pending 목록에 없고, 수락도 못 한다.
    expect(await teamService.getPendingInvitations(PROJECT)).toEqual([]);
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow();
  });

  it("취소하면 초대 문서가 지워지고 같은 이메일을 다시 초대할 수 있다", async () => {
    seedProject([OWNER]);
    const id = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "member",
      OWNER,
    );
    await teamService.cancelInvitation(id);
    expect(invitationDoc(id)).toBeNull();
    const again = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "viewer",
      OWNER,
    );
    expect(invitationDoc(again)!.role).toBe("viewer");
  });

  it("초대 조회는 이메일 대소문자를 무시하고 pending 만 돌려준다", async () => {
    seedProject([OWNER]);
    const id = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "member",
      OWNER,
    );
    const mine = await teamService.getMyInvitations("INVITEE@example.COM");
    expect(mine.map((i) => i.id)).toEqual([id]);
    await teamService.acceptInvitation(id, INVITEE);
    expect(await teamService.getMyInvitations(INVITEE_EMAIL)).toEqual([]);
    expect(await teamService.getPendingInvitations(PROJECT)).toEqual([]);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 경계 케이스
// ═════════════════════════════════════════════════════════════════════════════

describe("경계 케이스", () => {
  it("같은 이메일에 pending 초대가 있으면 중복 초대를 거부한다 (대소문자 달라도)", async () => {
    seedProject([OWNER]);
    await teamService.createInvitation(PROJECT, INVITEE_EMAIL, "member", OWNER);
    await expect(
      teamService.createInvitation(
        PROJECT,
        "invitee@EXAMPLE.com",
        "admin",
        OWNER,
      ),
    ).rejects.toThrow();
    // 원래 초대의 역할이 덮어써지지 않았다.
    expect(invitationDoc(`${PROJECT}_${INVITEE_EMAIL_NORM}`)!.role).toBe(
      "member",
    );
  });

  it("다른 프로젝트의 pending 초대는 중복으로 치지 않는다", async () => {
    seedProject([OWNER]);
    backend.seed("projects", "other", {
      ownerId: OWNER,
      members: [OWNER],
    });
    await teamService.createInvitation("other", INVITEE_EMAIL, "member", OWNER);
    await expect(
      teamService.createInvitation(PROJECT, INVITEE_EMAIL, "viewer", OWNER),
    ).resolves.toBe(`${PROJECT}_${INVITEE_EMAIL_NORM}`);
  });

  it("이미 멤버인 이메일에는 초대장을 만들지 않고 안내한다", async () => {
    seedProject([OWNER, INVITEE]);
    backend.seed("users", INVITEE, {
      email: "Invitee@Example.com",
      displayName: "Invitee",
      photoURL: "",
      createdAt: new Date(),
    });

    await expect(
      teamService.createInvitation(
        PROJECT,
        "invitee@example.COM",
        "viewer",
        OWNER,
      ),
    ).rejects.toThrow();
    expect(backend.list("invitations")).toEqual([]);
  });

  it("★만료된 초대는 status=expired 로 바뀌고 멤버·역할 문서가 생기지 않는다", async () => {
    seedProject([OWNER]);
    const id = `${PROJECT}_${INVITEE_EMAIL_NORM}`;
    backend.seed("invitations", id, {
      projectId: PROJECT,
      invitedEmail: INVITEE_EMAIL_NORM,
      invitedBy: OWNER,
      role: "admin",
      status: "pending",
      createdAt: new Date(Date.now() - 8 * 24 * 3600 * 1000),
      expiresAt: new Date(Date.now() - 24 * 3600 * 1000),
    });
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow();
    expect(invitationDoc(id)!.status).toBe("expired");
    expect(project().members).toEqual([OWNER]);
    expect(roleDoc(INVITEE)).toBeNull();
    // 만료된 초대는 두 번째 시도에서도 열리지 않는다(pending 이 아니므로).
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow();
    expect(project().members).toEqual([OWNER]);
  });

  it("이미 accepted 인 초대를 다시 수락해도 아무것도 쓰지 않는다", async () => {
    seedProject([OWNER]);
    const id = await teamService.createInvitation(
      PROJECT,
      INVITEE_EMAIL,
      "viewer",
      OWNER,
    );
    await teamService.acceptInvitation(id, INVITEE);
    await teamService.updateMemberRole(PROJECT, INVITEE, "admin");
    // 낡은 초대장(viewer)을 다시 수락해도 현재 역할(admin)을 되돌리지 못한다.
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow();
    expect(roleDoc(INVITEE)!.role).toBe("admin");
    expect(project().members).toEqual([OWNER, INVITEE]);
  });

  it("없는 초대 id 는 거부하고 아무 프로젝트에도 쓰지 않는다", async () => {
    seedProject([OWNER]);
    await expect(
      teamService.acceptInvitation("nope_nobody@example.com", INVITEE),
    ).rejects.toThrow();
    expect(project().members).toEqual([OWNER]);
    expect(backend.list("memberRoles")).toEqual([]);
  });

  it("★문서 id 와 본문 projectId 가 어긋난 초대는 어느 프로젝트에도 쓰지 않는다", async () => {
    seedProject([OWNER]);
    backend.seed("projects", "victim", { ownerId: OWNER, members: [OWNER] });
    const id = `${PROJECT}_${INVITEE_EMAIL_NORM}`;
    backend.seed("invitations", id, {
      projectId: "victim", // ← id 는 PROJECT 를 가리키는데 본문은 다른 프로젝트
      invitedEmail: INVITEE_EMAIL_NORM,
      invitedBy: OWNER,
      role: "admin",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
    });
    await expect(teamService.acceptInvitation(id, INVITEE)).rejects.toThrow();
    expect(project().members).toEqual([OWNER]);
    expect((backend.read("projects", "victim") as Doc).members).toEqual([
      OWNER,
    ]);
    expect(backend.list("memberRoles")).toEqual([]);
    expect(invitationDoc(id)!.status).toBe("pending");
  });

  it("이미 멤버인 사람이 과거 초대를 수락해도 members 는 중복되지 않는다", async () => {
    seedProject([OWNER, INVITEE]);
    backend.seed("memberRoles", `${PROJECT}_${INVITEE}`, {
      projectId: PROJECT,
      userId: INVITEE,
      role: "admin",
    });
    const id = `${PROJECT}_${INVITEE_EMAIL_NORM}`;
    backend.seed("invitations", id, {
      projectId: PROJECT,
      invitedEmail: INVITEE_EMAIL_NORM,
      invitedBy: OWNER,
      role: "viewer",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
    });
    await teamService.acceptInvitation(id, INVITEE);
    expect(project().members).toEqual([OWNER, INVITEE]); // arrayUnion 멱등
    expect(roleDoc(INVITEE)!.role).toBe("viewer"); // 초대장이 최신 의사
  });

  it("★초대장의 'owner' 는 owner 역할 문서가 되지 않는다 — member 로 접힌다", async () => {
    seedProject([OWNER]);
    const id = `${PROJECT}_${INVITEE_EMAIL_NORM}`;
    backend.seed("invitations", id, {
      projectId: PROJECT,
      invitedEmail: INVITEE_EMAIL_NORM,
      invitedBy: OWNER,
      role: "owner",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 86400_000),
    });
    await teamService.acceptInvitation(id, INVITEE);
    expect(roleDoc(INVITEE)!.role).toBe("member");
    expect(await teamService.getMemberRole(PROJECT, INVITEE)).toBe("member");
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
      [INVITEE]: "member",
    });
  });

  it("memberRoleFromInvitation 은 서버 normalizeMemberRole 과 같은 접기다", () => {
    const f = teamService.memberRoleFromInvitation;
    expect(f(undefined)).toBe("member");
    expect(f(null)).toBe("member");
    expect(f("owner")).toBe("member");
    expect(f("OWNER")).toBe("member");
    expect(f(" Viewer ")).toBe("viewer");
    expect(f("ADMIN")).toBe("admin");
    expect(f("superuser")).toBe("member");
    expect(f(42)).toBe("member");
  });

  it("역할 필드가 없는 레거시 memberRoles 문서는 write 를 열어 주지 않는다 (fail-closed)", async () => {
    seedProject([OWNER, INVITEE]);
    backend.seed("memberRoles", `${PROJECT}_${INVITEE}`, {
      projectId: PROJECT,
      userId: INVITEE,
      // role 없음
    });
    const role = await teamService.getMemberRole(PROJECT, INVITEE);
    expect(["owner", "admin", "member"]).not.toContain(role);
    expect(await teamService.checkPermission(PROJECT, INVITEE, "write")).toBe(
      false,
    );
    expect(await teamService.checkPermission(PROJECT, INVITEE, "merge")).toBe(
      false,
    );
  });

  it("자기 자신(owner) 제거: 서비스는 막지 않지만 owner 판정은 ownerId 에서 나와 살아남는다", async () => {
    // 화면 게이트는 TeamManagement 의 isCurrentUser + canEditMemberRole(owner→false)
    // 가 막고, 룰은 ownerId 를 불변으로 둔다. 서비스 계층은 그 최종 진실원
    // (projects.ownerId)을 건드릴 수 없으므로, members 에서 빠져도 owner 다.
    seedProject([OWNER]);
    await teamService.removeMember(PROJECT, OWNER);
    expect(project().members).toEqual([]);
    expect(await teamService.getMemberRole(PROJECT, OWNER)).toBe("owner");
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
    });
  });

  it("역할 문서가 없는 멤버를 제거해도 던지지 않는다 (레거시 멤버)", async () => {
    seedProject([OWNER, INVITEE]);
    await expect(
      teamService.removeMember(PROJECT, INVITEE),
    ).resolves.toBeUndefined();
    expect(project().members).toEqual([OWNER]);
  });

  it("없는 프로젝트: 멤버 목록은 빈 배열, 역할은 문서 기준으로만 판정된다", async () => {
    expect(await teamService.getProjectMembers("ghost")).toEqual([]);
    expect(await teamService.getMemberRoles("ghost")).toEqual({});
    expect(await teamService.getMemberRole("ghost", OWNER)).toBe("member");
    expect(
      await teamService.checkPermission("ghost", OWNER, "manage_members"),
    ).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// 빈 팀 · 1인 팀 — 오늘 대부분의 프로젝트
// ═════════════════════════════════════════════════════════════════════════════

describe("빈 팀 · 1인 팀", () => {
  it("members 가 비어 있어도(레거시) owner 는 owner 이고 목록은 빈 배열이다", async () => {
    seedProject([]);
    expect(await teamService.getProjectMembers(PROJECT)).toEqual([]);
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
    });
    expect(await teamService.getMemberRole(PROJECT, OWNER)).toBe("owner");
    expect(await teamService.getPendingInvitations(PROJECT)).toEqual([]);
  });

  it("1인 팀: users 문서가 없어도 owner 행이 uid 로 보이고 역할은 owner 하나뿐이다", async () => {
    seedProject([OWNER]);
    const members = await teamService.getProjectMembers(PROJECT);
    expect(members).toHaveLength(1);
    expect(members[0].id).toBe(OWNER);
    expect(members[0].displayName).toBe(OWNER); // 빈 이름 칸을 남기지 않는다
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
    });
  });

  it("1인 팀에서 첫 초대를 만들면 pending 1건이고 아직 멤버는 1명이다", async () => {
    seedProject([OWNER]);
    await teamService.createInvitation(PROJECT, INVITEE_EMAIL, "member", OWNER);
    expect(await teamService.getPendingInvitations(PROJECT)).toHaveLength(1);
    expect(await teamService.getProjectMembers(PROJECT)).toHaveLength(1);
    expect(await teamService.getMemberRoles(PROJECT)).toEqual({
      [OWNER]: "owner",
    });
  });

  it("비멤버가 1인 팀에 대해 묻는 권한은 기본값 member 로 접힌다 — 최종 게이트는 룰·서버의 멤버십 검사다", async () => {
    // 클라이언트 getMemberRole 은 membership 을 보지 않는다(룰이 projects 읽기
    // 자체를 막는다). 이 값이 어디에서 '허가' 로 쓰이면 안 된다는 것을 고정한다.
    seedProject([OWNER]);
    expect(await teamService.getMemberRole(PROJECT, "stranger")).toBe("member");
    expect(
      (await teamService.getMemberRoles(PROJECT))["stranger"],
    ).toBeUndefined();
  });
});
