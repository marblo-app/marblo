/**
 * Firestore Security Rules 테스트
 *
 * 실행 방법:
 *   1. Firebase Emulator 설치: npm install -g firebase-tools
 *   2. 한 방에: npm run test:rules
 *      (= firebase emulators:exec --only firestore
 *           "vitest run --config vitest.rules.config.mjs")
 *
 * ⚠️ 반드시 vitest.rules.config.mjs 로 실행할 것. 기본 vitest.config.mjs 는
 *    firebase/firestore 를 mock 으로 alias 하므로 이 규칙 테스트가 깨진다.
 */

import {
  initializeTestEnvironment,
  assertSucceeds,
  assertFails,
  type RulesTestEnvironment,
  type RulesTestContext,
} from "@firebase/rules-unit-testing";
import {
  doc,
  getDoc,
  getDocs,
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
  arrayUnion,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { describe, it, beforeAll, afterAll, beforeEach } from "vitest";

let testEnv: RulesTestEnvironment;

// 테스트 사용자
const OWNER_ID = "owner-user";
const OWNER_EMAIL = "owner@test.com";
const ADMIN_ID = "admin-user";
const ADMIN_EMAIL = "admin@test.com";
const MEMBER_ID = "member-user";
const MEMBER_EMAIL = "member@test.com";
const OUTSIDER_ID = "outsider-user";
const OUTSIDER_EMAIL = "outsider@test.com";
const PROJECT_ID = "test-project";
// 두 번째 테넌트 — MEMBER 는 여기에 속하지 않는다(크로스테넌트 격리 검증용).
const OTHER_PROJECT_ID = "other-project";
// 플랫폼 admin — projectId="" 유실 마커를 읽을 수 있는 유일한 주체.
const PLATFORM_ADMIN_ID = "platform-admin-user";
const PLATFORM_ADMIN_EMAIL = "padmin@test.com";

function getContext(uid: string, email: string): RulesTestContext {
  return testEnv.authenticatedContext(uid, { email });
}

// 커스텀 토큰 클레임(admin: true)을 실은 컨텍스트 — isPlatformAdmin() 이 true.
function adminContext(): RulesTestContext {
  return testEnv.authenticatedContext(PLATFORM_ADMIN_ID, {
    email: PLATFORM_ADMIN_EMAIL,
    admin: true,
  });
}

function unauthContext(): RulesTestContext {
  return testEnv.unauthenticatedContext();
}

// ===== 공개 Replay 시드 (Phase 4-1) =====
// 실제 발행 경로가 만드는 id 는 130비트 난수다(publicReplayService). 테스트는
// 값을 고정해야 하므로 같은 모양(접두사 r + base32 26자)의 상수를 쓴다.
const PUBLISHED_REPLAY_ID = "r0123456789abcdefghjkmnpqr";
const UNPUBLISHED_REPLAY_ID = "rzyxwvtsrqpnmkjhgfedcba987";

function publicReplayOwnerSeed(status: "published" | "unpublished") {
  return {
    replayId: PUBLISHED_REPLAY_ID,
    projectId: PROJECT_ID,
    missionId: "mission-1",
    publisherUid: OWNER_ID,
    level: "L2",
    includeCost: false,
    status,
    publishedAt: new Date(),
    unpublishedAt: null,
  };
}

function publicReplayDocSeed(overrides: Record<string, unknown> = {}) {
  return {
    schemaVersion: 1,
    replayVersion: 1,
    level: "L2",
    status: "published",
    payload: '{"goal":"redacted goal"}',
    publishedAt: new Date(),
    ...overrides,
  };
}

beforeAll(async () => {
  testEnv = await initializeTestEnvironment({
    projectId: "marblo-test",
    firestore: {
      rules: readFileSync("firestore.rules", "utf8"),
      host: "127.0.0.1",
      port: 8080,
    },
  });
});

afterAll(async () => {
  await testEnv.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();

  // 시드 데이터 설정
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();

    // 프로젝트 생성
    await setDoc(doc(db, "projects", PROJECT_ID), {
      name: "Test Project",
      ownerId: OWNER_ID,
      members: [OWNER_ID, ADMIN_ID, MEMBER_ID],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 멤버 역할 설정
    await setDoc(doc(db, "memberRoles", `${PROJECT_ID}_${OWNER_ID}`), {
      projectId: PROJECT_ID,
      userId: OWNER_ID,
      role: "owner",
    });
    await setDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`), {
      projectId: PROJECT_ID,
      userId: ADMIN_ID,
      role: "admin",
    });
    await setDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`), {
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
      role: "member",
    });

    // 사용자 프로필
    await setDoc(doc(db, "users", OWNER_ID), {
      email: OWNER_EMAIL,
      displayName: "Owner",
      photoURL: "",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "users", ADMIN_ID), {
      email: ADMIN_EMAIL,
      displayName: "Admin",
      photoURL: "",
      createdAt: new Date(),
    });

    // 태스크
    await setDoc(doc(db, "tasks", "task-1"), {
      projectId: PROJECT_ID,
      title: "Test Task",
      status: "TODO",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 에이전트
    await setDoc(doc(db, "agents", "agent-1"), {
      projectId: PROJECT_ID,
      ownerId: OWNER_ID,
      name: "Test Agent",
      model: "claude",
      status: "idle",
      createdAt: new Date(),
    });

    // 플로우
    await setDoc(doc(db, "flows", "flow-1"), {
      projectId: PROJECT_ID,
      name: "Test Flow",
      status: "draft",
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // 채팅 메시지 (협업 — 멤버 전용)
    await setDoc(doc(db, "chatMessages", "chat-1"), {
      projectId: PROJECT_ID,
      type: "user",
      senderId: MEMBER_ID,
      senderName: "member",
      senderPhotoURL: "",
      content: "hello team",
      createdAt: new Date(),
    });

    // 태스크 코멘트 (협업 — 멤버 전용)
    await setDoc(doc(db, "taskComments", "comment-1"), {
      taskId: "task-1",
      projectId: PROJECT_ID,
      authorId: MEMBER_ID,
      authorName: "member",
      authorPhotoURL: "",
      content: "looks good",
      createdAt: new Date(),
    });

    // Pending instruction (PTY-injection 큐 entry)
    await setDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
      projectId: PROJECT_ID,
      taskId: "task-1",
      targetAgentId: "agent-1",
      message: "Initial message",
      fromUserId: MEMBER_ID,
      fromUserName: "member",
      sourceType: "chat",
      isDelivered: false,
      createdAt: new Date(),
      deliveredAt: null,
    });

    await setDoc(doc(db, "activities", "activity-1"), {
      taskId: "task-1",
      agentId: "agent-1",
      message: "Initial activity",
      createdAt: new Date(),
    });

    // 초대
    await setDoc(doc(db, "invitations", "inv-1"), {
      projectId: PROJECT_ID,
      invitedEmail: OUTSIDER_EMAIL,
      invitedBy: OWNER_ID,
      role: "member",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // B2 self-join 룰이 조회하는 결정적 ID({projectId}_{소문자 이메일}) 초대 —
    // teamService.invitationDocId 규약과 동일. inv-1(레거시 랜덤 ID)은
    // 초대 문서 자체의 read/update 테스트용으로 그대로 둔다.
    await setDoc(doc(db, "invitations", `${PROJECT_ID}_${OUTSIDER_EMAIL}`), {
      projectId: PROJECT_ID,
      invitedEmail: OUTSIDER_EMAIL,
      invitedBy: OWNER_ID,
      role: "member",
      status: "pending",
      createdAt: new Date(),
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    });

    // 구독
    await setDoc(doc(db, "subscriptions", OWNER_ID), {
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date(),
    });

    // ── 원장 계열 시드 (L2 read 스코프 검증) ──────────────────────────

    // 두 번째 테넌트 — MEMBER 는 비멤버. 크로스테넌트 격리를 실제로 검증하려면
    // "내가 못 읽어야 할 다른 테넌트 문서"가 실재해야 한다.
    await setDoc(doc(db, "projects", OTHER_PROJECT_ID), {
      name: "Other Tenant",
      ownerId: OUTSIDER_ID,
      members: [OUTSIDER_ID],
      createdAt: new Date(),
      updatedAt: new Date(),
    });

    // projectAuditLog: 사람 행위 감사(owner/admin 전용 read)
    await setDoc(doc(db, "projectAuditLog", "paudit-ours"), {
      projectId: PROJECT_ID,
      actorUid: MEMBER_ID,
      actorName: "Member",
      type: "chat.message.sent",
      taskId: null,
      targetId: "msg-1",
      metadata: { messageType: "user", contentLength: 12 },
      createdAt: new Date(),
    });
    await setDoc(doc(db, "projectAuditLog", "paudit-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      actorUid: OUTSIDER_ID,
      actorName: "Outsider",
      type: "chat.message.sent",
      taskId: null,
      targetId: "msg-x",
      metadata: { messageType: "user", contentLength: 5 },
      createdAt: new Date(),
    });

    // audit_logs: 우리 프로젝트 정상 레코드 / 타 테넌트 레코드 / projectId="" 유실 마커
    await setDoc(doc(db, "audit_logs", "audit-ours"), {
      projectId: PROJECT_ID,
      agentId: "agent-1",
      toolName: "add_activity",
      result: "ok",
      success: true,
      kind: "tool",
      actorUid: MEMBER_ID,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "audit_logs", "audit-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      agentId: "agent-x",
      toolName: "add_activity",
      result: "secret",
      success: true,
      kind: "tool",
      actorUid: OUTSIDER_ID,
      createdAt: new Date(),
    });
    // 오버플로/미해결 tombstone — ledger-spool.ts 가 귀속 prior 없을 때 projectId=""
    await setDoc(doc(db, "audit_logs", "audit-tombstone-empty-project"), {
      projectId: "",
      agentId: "agent-1",
      toolName: "__ledger_spool_overflow__",
      result: "감사 이벤트 N건이 유실되었습니다",
      success: false,
      kind: "lifecycle",
      actorUid: null,
      createdAt: new Date(),
    });

    // merge_history: 우리 프로젝트 / 타 테넌트
    await setDoc(doc(db, "merge_history", "merge-ours"), {
      projectId: PROJECT_ID,
      taskId: "task-1",
      mergedAt: new Date(),
    });
    await setDoc(doc(db, "merge_history", "merge-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      taskId: "task-x",
      mergedAt: new Date(),
    });

    // ledger_checkpoints (L3 머클 체크포인트): 우리 프로젝트 / 타 테넌트.
    // 명부만 새어도 타 테넌트의 에이전트 id·활동량이 드러나므로 read 게이트는
    // audit_logs 와 같아야 한다.
    await setDoc(doc(db, "ledger_checkpoints", "cp-ours"), {
      projectId: PROJECT_ID,
      kind: "periodic",
      seqNo: 1,
      atMs: 1_700_000_000_000,
      chains: [
        { projectId: PROJECT_ID, agentId: "agent-1", seq: 4, hash: "sha256:a" },
      ],
      merkleRoot: "sha256:root",
      prevCheckpointHash: "sha256:prev",
      hash: "sha256:cp",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "ledger_checkpoints", "cp-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      kind: "periodic",
      seqNo: 1,
      atMs: 1_700_000_000_000,
      chains: [
        {
          projectId: OTHER_PROJECT_ID,
          agentId: "agent-x",
          seq: 9,
          hash: "sha256:x",
        },
      ],
      merkleRoot: "sha256:root-x",
      prevCheckpointHash: "sha256:prev-x",
      hash: "sha256:cp-x",
      createdAt: new Date(),
    });

    // telemetry_events: 우리 프로젝트 / 타 테넌트
    await setDoc(doc(db, "telemetry_events", "telemetry-ours"), {
      projectId: PROJECT_ID,
      event: "task:merged",
      createdAt: new Date(),
    });
    await setDoc(doc(db, "telemetry_events", "telemetry-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      event: "task:merged",
      createdAt: new Date(),
    });

    // ===== 공개 Replay (Phase 4-1) =====
    // 발행 중인 1건 + 해제된 1건. 해제본은 소유권 기록만 남고 공개 문서는 없다.
    await setDoc(
      doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID),
      publicReplayOwnerSeed("published"),
    );
    await setDoc(
      doc(db, "publicReplays", PUBLISHED_REPLAY_ID),
      publicReplayDocSeed(),
    );
    await setDoc(doc(db, "publicReplayOwners", UNPUBLISHED_REPLAY_ID), {
      ...publicReplayOwnerSeed("unpublished"),
      replayId: UNPUBLISHED_REPLAY_ID,
      unpublishedAt: new Date(),
    });
  });
});

// ===== Users =====

describe("users collection", () => {
  it("인증된 사용자는 다른 사용자 프로필을 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "users", OWNER_ID)));
  });

  it("미인증 사용자는 프로필을 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "users", OWNER_ID)));
  });

  it("본인 프로필만 생성할 수 있다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "users", OUTSIDER_ID), {
        email: OUTSIDER_EMAIL,
        displayName: "Outsider",
        photoURL: "",
        createdAt: new Date(),
      }),
    );
  });

  it("타인 프로필은 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "users", "other-user"), {
        email: "other@test.com",
        displayName: "Other",
        photoURL: "",
        createdAt: new Date(),
      }),
    );
  });

  it("본인 프로필만 수정할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "users", OWNER_ID), { displayName: "New Name" }),
    );
  });

  it("타인 프로필은 수정할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "users", OWNER_ID), { displayName: "Hacked" }),
    );
  });
});

// ===== Projects =====

describe("projects collection", () => {
  it("프로젝트 멤버는 프로젝트를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "projects", PROJECT_ID)));
  });

  it("외부인은 프로젝트를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_ID)));
  });

  it("프로젝트 생성 시 ownerId가 본인이어야 한다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "projects", "new-project"), {
        name: "New Project",
        ownerId: OUTSIDER_ID,
        members: [OUTSIDER_ID],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("프로젝트 생성 시 ownerId를 타인으로 설정할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "projects", "new-project"), {
        name: "New Project",
        ownerId: OWNER_ID,
        members: [OUTSIDER_ID],
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("프로젝트 멤버는 프로젝트를 수정할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), { name: "Updated Name" }),
    );
  });

  it("Owner만 프로젝트를 삭제할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "projects", PROJECT_ID)));
  });

  it("Admin은 프로젝트를 삭제할 수 없다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "projects", PROJECT_ID)));
  });
});

// ===== Tasks =====

describe("tasks collection", () => {
  it("프로젝트 멤버는 태스크를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "tasks", "task-1")));
  });

  it("owner라도 project.members에 없으면 태스크를 읽을 수 없다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "projects", "legacy-no-members"), {
        name: "Legacy No Members",
        ownerId: OWNER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, "tasks", "legacy-task-no-members"), {
        projectId: "legacy-no-members",
        title: "Legacy Task",
        status: "TODO",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "tasks", "legacy-task-no-members")));
  });

  it("owner가 project.members에 백필되면 태스크를 읽을 수 있다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "projects", "legacy-with-owner-member"), {
        name: "Legacy With Owner Member",
        ownerId: OWNER_ID,
        members: [OWNER_ID],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(doc(db, "tasks", "legacy-task-with-owner-member"), {
        projectId: "legacy-with-owner-member",
        title: "Legacy Task",
        status: "TODO",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      getDoc(doc(db, "tasks", "legacy-task-with-owner-member")),
    );
  });

  it("외부인은 태스크를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "tasks", "task-1")));
  });

  it("프로젝트 멤버는 태스크를 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "tasks"), {
        projectId: PROJECT_ID,
        title: "New Task",
        status: "TODO",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("외부인은 태스크를 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "tasks"), {
        projectId: PROJECT_ID,
        title: "Hacked Task",
        status: "TODO",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("프로젝트 멤버는 태스크를 수정할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-1"), { title: "Updated" }),
    );
  });

  it("외부인은 태스크를 수정할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "tasks", "task-1"), { title: "Hacked" }),
    );
  });

  it("프로젝트 멤버는 태스크를 삭제할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "tasks", "task-1")));
  });

  it("외부인은 태스크를 삭제할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "tasks", "task-1")));
  });
});

// ===== Tasks — 머지성 write 게이트 (코드 머지 = owner/admin 만) =====
// REVIEW→DONE 전이는 renderer 의 merged→DONE 화해(shouldMarkMergedTaskDone)가
// 수행하는 "머지 완료 처리"다. member 는 REVIEW 제출까지, 랜딩은 관리자만.

describe("tasks — 머지성 write 게이트 (REVIEW→DONE)", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tasks", "task-review"), {
        projectId: PROJECT_ID,
        title: "Reviewed Task",
        status: "REVIEW",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  });

  it("owner 는 REVIEW→DONE 전이(머지 완료)가 가능하다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-review"), { status: "DONE" }),
    );
  });

  it("admin 은 REVIEW→DONE 전이(머지 완료)가 가능하다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-review"), { status: "DONE" }),
    );
  });

  it("member 는 REVIEW→DONE 전이(머지 완료)를 할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "tasks", "task-review"), { status: "DONE" }),
    );
  });

  it("member 도 REVIEW 태스크의 비머지성 수정(제목 등)은 가능하다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-review"), { title: "retitled" }),
    );
  });

  it("member 도 REVIEW→IN_PROGRESS(반려/재작업) 전이는 가능하다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-review"), { status: "IN_PROGRESS" }),
    );
  });

  it("member 의 비-REVIEW 태스크 DONE 전이는 여전히 가능하다(머지성 아님)", async () => {
    // task-1 은 TODO — 오케/에이전트의 일반 완료 흐름을 깨지 않는다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "task-1"), { status: "DONE" }),
    );
  });
});

// ===== Chat Messages (크로스테넌트 격리) =====

describe("chatMessages collection", () => {
  it("프로젝트 멤버는 자기 프로젝트 채팅을 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "chatMessages", "chat-1")));
  });

  it("외부인(비멤버)은 타 프로젝트 채팅을 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "chatMessages", "chat-1")));
  });

  it("프로젝트 멤버는 자기 프로젝트에 채팅을 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatMessages"), {
        projectId: PROJECT_ID,
        type: "user",
        senderId: MEMBER_ID,
        senderName: "member",
        senderPhotoURL: "",
        content: "hi",
        createdAt: new Date(),
      }),
    );
  });

  it("외부인(비멤버)은 타 프로젝트에 채팅을 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "chatMessages"), {
        projectId: PROJECT_ID,
        type: "user",
        senderId: OUTSIDER_ID,
        senderName: "outsider",
        senderPhotoURL: "",
        content: "inject",
        createdAt: new Date(),
      }),
    );
  });

  it("멤버라도 user 메시지의 senderId 를 타인 uid 로 위조할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "chatMessages"), {
        projectId: PROJECT_ID,
        type: "user",
        senderId: OWNER_ID, // 위조: 본인이 아닌 다른 멤버 uid
        senderName: "impersonator",
        senderPhotoURL: "",
        content: "spoofed",
        createdAt: new Date(),
      }),
    );
  });

  it("system 메시지는 senderId 가 라벨('system')이어도 멤버면 생성 가능", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "chatMessages"), {
        projectId: PROJECT_ID,
        type: "system",
        senderId: "system",
        senderName: "System",
        senderPhotoURL: "",
        content: "agent spawned",
        createdAt: new Date(),
      }),
    );
  });

  it("채팅 수정/삭제는 거부된다 (append-only)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "chatMessages", "chat-1"), { content: "tampered" }),
    );
    await assertFails(deleteDoc(doc(db, "chatMessages", "chat-1")));
  });

  it("미인증 사용자는 채팅에 접근할 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "chatMessages", "chat-1")));
  });
});

// ===== Task Comments (크로스테넌트 격리) =====

describe("taskComments collection", () => {
  it("프로젝트 멤버는 자기 프로젝트 코멘트를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "taskComments", "comment-1")));
  });

  it("외부인(비멤버)은 타 프로젝트 코멘트를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "taskComments", "comment-1")));
  });

  it("프로젝트 멤버는 자기 프로젝트에 코멘트를 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "taskComments"), {
        taskId: "task-1",
        projectId: PROJECT_ID,
        authorId: MEMBER_ID,
        authorName: "member",
        authorPhotoURL: "",
        content: "nice",
        createdAt: new Date(),
      }),
    );
  });

  it("외부인(비멤버)은 타 프로젝트에 코멘트를 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "taskComments"), {
        taskId: "task-1",
        projectId: PROJECT_ID,
        authorId: OUTSIDER_ID,
        authorName: "outsider",
        authorPhotoURL: "",
        content: "leak",
        createdAt: new Date(),
      }),
    );
  });

  it("멤버라도 authorId 를 타인 uid 로 위조할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "taskComments"), {
        taskId: "task-1",
        projectId: PROJECT_ID,
        authorId: OWNER_ID, // 위조
        authorName: "impersonator",
        authorPhotoURL: "",
        content: "spoofed",
        createdAt: new Date(),
      }),
    );
  });

  it("코멘트 수정/삭제는 거부된다 (append-only)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "taskComments", "comment-1"), { content: "tampered" }),
    );
    await assertFails(deleteDoc(doc(db, "taskComments", "comment-1")));
  });

  it("미인증 사용자는 코멘트에 접근할 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "taskComments", "comment-1")));
  });
});

// ===== Pending Instructions =====

describe("pendingInstructions collection", () => {
  it("프로젝트 멤버는 pending instruction을 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "pendingInstructions"), {
        projectId: PROJECT_ID,
        taskId: "task-1",
        targetAgentId: "agent-1",
        message: "do the thing",
        fromUserId: MEMBER_ID,
        fromUserName: "member",
        sourceType: "chat",
        isDelivered: false,
        createdAt: new Date(),
        deliveredAt: null,
      }),
    );
  });

  it("외부인은 타 프로젝트 pending instruction을 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "pendingInstructions"), {
        projectId: PROJECT_ID,
        taskId: "task-1",
        targetAgentId: "agent-1",
        message: "inject",
        fromUserId: OUTSIDER_ID,
        fromUserName: "outsider",
        sourceType: "chat",
        isDelivered: false,
        createdAt: new Date(),
        deliveredAt: null,
      }),
    );
  });

  it("멤버라도 fromUserId 를 타인 uid 로 위조할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "pendingInstructions"), {
        projectId: PROJECT_ID,
        taskId: "task-1",
        targetAgentId: "agent-1",
        message: "spoofed",
        fromUserId: OWNER_ID,
        fromUserName: "member",
        sourceType: "chat",
        isDelivered: false,
        createdAt: new Date(),
        deliveredAt: null,
      }),
    );
  });

  it("미인증 사용자는 pending instruction을 생성할 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(collection(db, "pendingInstructions"), {
        projectId: PROJECT_ID,
        taskId: "task-1",
        targetAgentId: "agent-1",
        message: "hacked",
        fromUserId: "hacker",
        fromUserName: "hacker",
        sourceType: "other",
        isDelivered: false,
        createdAt: new Date(),
        deliveredAt: null,
      }),
    );
  });

  it("프로젝트 멤버는 delivery 마킹(isDelivered + deliveredAt)을 할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
        isDelivered: true,
        deliveredAt: new Date(),
      }),
    );
  });

  it("외부인은 delivery 마킹을 할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
        isDelivered: true,
        deliveredAt: new Date(),
      }),
    );
  });

  it("message 변조는 거부된다 (immutable 필드)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
        message: "tampered message",
      }),
    );
  });

  it("targetAgentId 변조는 거부된다 (immutable 필드)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
        targetAgentId: "attacker-controlled-agent",
      }),
    );
  });

  it("fromUserId 변조는 거부된다 (immutable 필드)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "pendingInstructions", "pending-inst-1"), {
        fromUserId: "someone-else",
      }),
    );
  });

  it("pending instruction 삭제는 거부된다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      deleteDoc(doc(db, "pendingInstructions", "pending-inst-1")),
    );
  });
});

// ===== Agents =====

describe("agents collection", () => {
  it("프로젝트 멤버는 에이전트를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "agents", "agent-1")));
  });

  it("외부인은 에이전트를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "agents", "agent-1")));
  });

  it("프로젝트 멤버는 에이전트를 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "agents"), {
        projectId: PROJECT_ID,
        ownerId: MEMBER_ID,
        name: "New Agent",
        model: "gpt",
        status: "idle",
        createdAt: new Date(),
      }),
    );
  });
});

// ===== Flows =====

describe("flows collection", () => {
  it("프로젝트 멤버는 플로우를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "flows", "flow-1")));
  });

  it("외부인은 플로우를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "flows", "flow-1")));
  });

  it("프로젝트 멤버는 플로우를 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "flows"), {
        projectId: PROJECT_ID,
        name: "New Flow",
        status: "draft",
        createdBy: MEMBER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });
});

// ===== Invitations =====

describe("invitations collection", () => {
  it("프로젝트 멤버는 초대를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "invitations", "inv-1")));
  });

  it("초대 대상자는 초대를 읽을 수 있다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "invitations", "inv-1")));
  });

  it("Admin+만 초대를 생성할 수 있다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "invitations"), {
        projectId: PROJECT_ID,
        invitedEmail: "newuser@test.com",
        invitedBy: ADMIN_ID,
        role: "member",
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
  });

  it("일반 멤버는 초대를 생성할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "invitations"), {
        projectId: PROJECT_ID,
        invitedEmail: "newuser@test.com",
        invitedBy: MEMBER_ID,
        role: "member",
        status: "pending",
        createdAt: new Date(),
        expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      }),
    );
  });

  it("초대 대상자가 수락할 수 있다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "invitations", "inv-1"), { status: "accepted" }),
    );
  });

  it("초대 대상자가 거절할 수 있다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "invitations", "inv-1"), { status: "rejected" }),
    );
  });

  it("제3자는 초대를 수락할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "invitations", "inv-1"), { status: "accepted" }),
    );
  });

  it("Admin+만 초대를 삭제(취소)할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "invitations", "inv-1")));
  });

  it("일반 멤버는 초대를 삭제할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "invitations", "inv-1")));
  });

  it("초대 대상자는 status 외 다른 필드를 함께 바꿀 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "invitations", "inv-1"), {
        status: "accepted",
        role: "admin",
      }),
    );
  });
});

// ===== B2: 초대 수락 self-join (projects.members 자가 추가) =====
//
// acceptInvitation 의 실제 쓰기 경로: 결정적 ID({projectId}_{소문자 이메일})의
// pending 초대를 근거로, 아직 멤버가 아닌 초대 대상자가 자신의 uid 만
// members 에 추가한다(arrayUnion + updatedAt).

describe("projects self-join via invitation (B2)", () => {
  const BASE_MEMBERS = [OWNER_ID, ADMIN_ID, MEMBER_ID];

  it("(a) 유효한 pending 초대가 있으면 자신의 uid 를 members 에 추가할 수 있다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("(a') 재시도(이미 멤버) no-op 도 멱등 통과한다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "projects", PROJECT_ID), {
        members: [...BASE_MEMBERS, OUTSIDER_ID],
      });
    });
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("(b) 초대가 없는 사용자의 self-join 은 거부된다", async () => {
    const db = getContext("stranger-user", "stranger@test.com").firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion("stranger-user"),
        updatedAt: new Date(),
      }),
    );
  });

  it("(c) 초대가 있어도 타인 uid 를 함께 추가할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: [...BASE_MEMBERS, OUTSIDER_ID, "smuggled-user"],
        updatedAt: new Date(),
      }),
    );
  });

  it("(c') 초대가 있어도 자신 대신 타인 uid 만 추가할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: [...BASE_MEMBERS, "smuggled-user"],
        updatedAt: new Date(),
      }),
    );
  });

  it("초대가 있어도 기존 멤버를 제거할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: [OWNER_ID, ADMIN_ID, OUTSIDER_ID], // MEMBER_ID 제거 시도
        updatedAt: new Date(),
      }),
    );
  });

  it("초대가 있어도 members/updatedAt 외 필드는 함께 바꿀 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
        name: "pwned",
      }),
    );
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
        ownerId: OUTSIDER_ID,
      }),
    );
  });

  it("만료된 초대로는 self-join 이 거부된다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(
          context.firestore(),
          "invitations",
          `${PROJECT_ID}_${OUTSIDER_EMAIL}`,
        ),
        { expiresAt: new Date(Date.now() - 60_000) },
      );
    });
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("이미 처리된(accepted) 초대로는 self-join 이 거부된다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(
        doc(
          context.firestore(),
          "invitations",
          `${PROJECT_ID}_${OUTSIDER_EMAIL}`,
        ),
        { status: "accepted" },
      );
    });
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("초대가 다른 프로젝트 것이면 self-join 이 거부된다", async () => {
    // 결정적 ID 는 대상 프로젝트 기준이지만 필드 projectId 를 위조한 문서 —
    // ID 규약과 문서 필드가 함께 검증되는지 확인. (OUTSIDER 가 멤버가 아닌
    // 전용 프로젝트를 시드 — OTHER_PROJECT 는 OUTSIDER 소유라 부적합)
    const THIRD_PROJECT_ID = "third-project";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const adminDb = context.firestore();
      await setDoc(doc(adminDb, "projects", THIRD_PROJECT_ID), {
        name: "Third Tenant",
        ownerId: OWNER_ID,
        members: [OWNER_ID],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await setDoc(
        doc(adminDb, "invitations", `${THIRD_PROJECT_ID}_${OUTSIDER_EMAIL}`),
        {
          projectId: PROJECT_ID,
          invitedEmail: OUTSIDER_EMAIL,
          invitedBy: OWNER_ID,
          role: "member",
          status: "pending",
          createdAt: new Date(),
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        },
      );
    });
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", THIRD_PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("기존 멤버의 일반 update 는 계속 허용된다 (회귀 없음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), { name: "Renamed" }),
    );
  });
});

// ===== B3: Presence =====

describe("presence collection (B3)", () => {
  const presenceDoc = (
    db: ReturnType<RulesTestContext["firestore"]>,
    userId: string,
  ) => doc(db, "presence", PROJECT_ID, "users", userId);

  it("프로젝트 멤버는 자기 presence 를 쓸 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(presenceDoc(db, MEMBER_ID), {
        userId: MEMBER_ID,
        displayName: "Member",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      }),
    );
  });

  it("타인의 presence 문서에는 쓸 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      setDoc(presenceDoc(db, OWNER_ID), {
        userId: OWNER_ID,
        displayName: "Fake Owner",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      }),
    );
  });

  it("자기 문서라도 userId 필드는 위조할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      setDoc(presenceDoc(db, MEMBER_ID), {
        userId: OWNER_ID,
        displayName: "Member",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      }),
    );
  });

  it("비멤버는 presence 를 쓸 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      setDoc(presenceDoc(db, OUTSIDER_ID), {
        userId: OUTSIDER_ID,
        displayName: "Outsider",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      }),
    );
  });

  it("프로젝트 멤버는 멤버들의 presence 를 읽을 수 있다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(presenceDoc(context.firestore(), OWNER_ID), {
        userId: OWNER_ID,
        displayName: "Owner",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      });
    });
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(collection(db, "presence", PROJECT_ID, "users")),
    );
  });

  it("비멤버는 presence 를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDocs(collection(db, "presence", PROJECT_ID, "users")));
  });

  it("본인 presence 문서는 삭제할 수 있다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(presenceDoc(context.firestore(), MEMBER_ID), {
        userId: MEMBER_ID,
        displayName: "Member",
        photoURL: "",
        location: "app",
        lastSeen: new Date(),
      });
    });
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(presenceDoc(db, MEMBER_ID)));
  });
});

// ===== Member Roles =====

describe("memberRoles collection", () => {
  it("프로젝트 멤버는 역할 정보를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`)),
    );
  });

  it("외부인은 역할 정보를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      getDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`)),
    );
  });

  it("Owner는 멤버 역할을 생성할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_new-user`), {
        projectId: PROJECT_ID,
        userId: "new-user",
        role: "viewer",
      }),
    );
  });

  it("Admin은 멤버 역할을 생성할 수 있다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_another-user`), {
        projectId: PROJECT_ID,
        userId: "another-user",
        role: "member",
      }),
    );
  });

  it("일반 멤버는 역할을 생성할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_someone`), {
        projectId: PROJECT_ID,
        userId: "someone",
        role: "viewer",
      }),
    );
  });

  it("owner 역할은 부여할 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_someone`), {
        projectId: PROJECT_ID,
        userId: "someone",
        role: "owner",
      }),
    );
  });

  it("Owner는 멤버 역할을 변경할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`), {
        role: "admin",
      }),
    );
  });

  it("Owner는 멤버 역할을 삭제할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      deleteDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`)),
    );
  });
});

// ===== Member Roles — admin 승격/강등 owner 전용 + docId 결속 =====

describe("memberRoles — admin 승격/강등 owner 전용 + docId 결속", () => {
  it("Owner 는 멤버를 admin 으로 승격할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`), {
        role: "admin",
      }),
    );
  });

  it("Admin 은 다른 멤버를 admin 으로 승격할 수 없다(owner 전용)", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`), {
        role: "admin",
      }),
    );
  });

  it("Admin 은 admin role 문서를 신규 생성할 수 없다(owner 전용)", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_new-admin`), {
        projectId: PROJECT_ID,
        userId: "new-admin",
        role: "admin",
      }),
    );
  });

  it("Owner 는 admin role 문서를 신규 생성할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "memberRoles", `${PROJECT_ID}_new-admin`), {
        projectId: PROJECT_ID,
        userId: "new-admin",
        role: "admin",
      }),
    );
  });

  it("Admin 은 다른 admin 을 강등할 수 없다(owner 전용)", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`), {
        role: "member",
      }),
    );
  });

  it("Owner 는 admin 을 member 로 강등할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`), {
        role: "member",
      }),
    );
  });

  it("Admin 은 admin role 문서를 삭제(사실상 강등)할 수 없다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      deleteDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`)),
    );
  });

  it("Owner 는 admin role 문서를 삭제할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      deleteDoc(doc(db, "memberRoles", `${PROJECT_ID}_${ADMIN_ID}`)),
    );
  });

  it("docId 와 본문(projectId,userId) 불일치 문서는 생성할 수 없다(크로스프로젝트 권한상승 차단)", async () => {
    // A 프로젝트(PROJECT_ID) owner 가 본문 projectId=A 로 권한검사를 통과시키며
    // docId 는 B 프로젝트(OTHER_PROJECT_ID) 규약으로 위조하는 공격 — 이전 룰의
    // 실제 구멍. docId 결속으로 거부돼야 한다.
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "memberRoles", `${OTHER_PROJECT_ID}_${OWNER_ID}`), {
        projectId: PROJECT_ID,
        userId: OWNER_ID,
        role: "admin",
      }),
    );
  });

  it("update 로 projectId 를 갈아끼울 수 없다(불변)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "memberRoles", `${PROJECT_ID}_${MEMBER_ID}`), {
        projectId: OTHER_PROJECT_ID,
      }),
    );
  });
});

// ===== Subscriptions =====

describe("subscriptions collection", () => {
  it("본인 구독 정보만 읽을 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "subscriptions", OWNER_ID)));
  });

  it("타인 구독 정보는 읽을 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "subscriptions", OWNER_ID)));
  });

  it("클라이언트에서 구독 정보를 쓸 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "subscriptions", OWNER_ID), {
        plan: "team",
        status: "active",
      }),
    );
  });
});

// ===== Coupons =====

describe("coupons collection", () => {
  it("클라이언트에서 쿠폰을 읽거나 쓸 수 없다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();

    await assertFails(getDoc(doc(db, "coupons", "WELCOME2026")));
    await assertFails(
      setDoc(doc(db, "coupons", "WELCOME2026"), {
        code: "WELCOME2026",
        type: "discount",
        discountPercent: 50,
        maxUses: 100,
        usedCount: 0,
        createdAt: new Date(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "coupons", "WELCOME2026"), {
        usedCount: 999,
      }),
    );
    await assertFails(deleteDoc(doc(db, "coupons", "WELCOME2026")));
  });
});

describe("couponRedemptions collection", () => {
  it("클라이언트에서 쿠폰 사용 기록을 읽거나 쓸 수 없다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();

    await assertFails(getDoc(doc(db, "couponRedemptions", "redemption-1")));
    await assertFails(
      setDoc(doc(db, "couponRedemptions", "redemption-1"), {
        couponCode: "WELCOME2026",
        userId: ADMIN_ID,
        redeemedAt: new Date(),
      }),
    );
    await assertFails(
      updateDoc(doc(db, "couponRedemptions", "redemption-1"), {
        userId: OUTSIDER_ID,
      }),
    );
    await assertFails(deleteDoc(doc(db, "couponRedemptions", "redemption-1")));
  });
});

// ===== Marketing Contacts (#488 — 서버 전용 SoT) =====

describe("marketing_contacts collection", () => {
  const CONTACT_ID = "a".repeat(64); // sha256 hex 형태의 docId

  it("클라이언트에서 마케팅 컨택트를 읽거나 쓸 수 없다 (인증 여부 무관)", async () => {
    for (const db of [
      getContext(ADMIN_ID, ADMIN_EMAIL).firestore(),
      unauthContext().firestore(),
    ]) {
      await assertFails(getDoc(doc(db, "marketing_contacts", CONTACT_ID)));
      await assertFails(
        setDoc(doc(db, "marketing_contacts", CONTACT_ID), {
          emailMarketingConsent: { status: "granted" },
        }),
      );
      await assertFails(deleteDoc(doc(db, "marketing_contacts", CONTACT_ID)));
    }
  });

  it("consent_events 감사로그도 클라이언트 접근 전면 차단", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      getDoc(doc(db, "marketing_contacts", CONTACT_ID, "consent_events", "e1")),
    );
    await assertFails(
      addDoc(
        collection(db, "marketing_contacts", CONTACT_ID, "consent_events"),
        { type: "granted", channel: "email" },
      ),
    );
  });
});

describe("betatester50_waitlist collection (marblo-web public signup)", () => {
  // marblo-web BetaTester50SignupForm 이 실제로 보내는 9필드 payload.
  const validPayload = (overrides: Record<string, unknown> = {}) => ({
    email: "test@example.com",
    locale: "ko",
    source: "home",
    agreed: true,
    agreedAt: new Date(),
    createdAt: new Date(),
    marketingConsent: false,
    marketingConsentVersion: null,
    marketingConsentAt: null,
    ...overrides,
  });

  it("미인증 사용자가 마케팅 동의 미체크(9필드, null 2개)로 신청할 수 있다", async () => {
    const db = unauthContext().firestore();
    await assertSucceeds(
      addDoc(collection(db, "betatester50_waitlist"), validPayload()),
    );
  });

  it("미인증 사용자가 마케팅 동의 체크(9필드, 값 채움)로 신청할 수 있다", async () => {
    const db = unauthContext().firestore();
    await assertSucceeds(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({
          marketingConsent: true,
          marketingConsentVersion: "2026-07-31",
          marketingConsentAt: new Date(),
        }),
      ),
    );
  });

  it("marketingConsent 가 bool 이 아니면 거부된다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({ marketingConsent: "true" }),
      ),
    );
  });

  it("marketingConsentVersion 이 string/null 이 아니면 거부된다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({ marketingConsentVersion: 123 }),
      ),
    );
  });

  it("marketingConsentAt 이 timestamp/null 이 아니면 거부된다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({ marketingConsentAt: "2026-07-31" }),
      ),
    );
  });

  it("스키마에 없는 추가 필드가 섞이면 거부된다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({ utmCampaign: "x" }),
      ),
    );
  });

  it("이메일 형식이 틀리면 거부된다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(
        collection(db, "betatester50_waitlist"),
        validPayload({ email: "not-an-email" }),
      ),
    );
  });

  it("list/get 은 여전히 전면 차단(존재해도 열람 불가)", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDocs(collection(db, "betatester50_waitlist")));
    await assertFails(getDoc(doc(db, "betatester50_waitlist", "any-id")));
  });
});

describe("push_tokens collection", () => {
  it("클라이언트에서 푸시 토큰을 읽거나 쓸 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "push_tokens", `${OWNER_ID}_device1`)));
    await assertFails(
      setDoc(doc(db, "push_tokens", `${OWNER_ID}_device1`), {
        uid: OWNER_ID,
        tokenHash: "h",
      }),
    );
  });
});

// ===== Audit Logs (불변 원장 + 멱등 재시도) =====

/**
 * 이 describe 가 지키는 성질은 하나다: **불변성을 유지한 채 멱등 재시도가 가능한가.**
 *
 * L1(#522) 은 ack 만 유실된 쓰기를 재시도해도 중복 문서가 안 생기게 문서 id 를
 * 로컬에서 1회 생성해 setDoc 으로 재사용한다. 그 재시도가 기존 문서에 닿으면
 * Firestore 는 update 로 판정한다 — `update: if false` 였을 때 스풀이 그 레코드에서
 * 영원히 고착했다(L1.6 회귀).
 *
 * 아래 두 테스트가 짝이다. 하나만 보면 룰을 잘못 되돌리기 쉽다:
 *  - 동일 내용 재쓰기는 **성공**해야 한다 (멱등 재시도 성립)
 *  - 한 글자라도 다르면 **실패**해야 한다 (불변성 유지)
 */
describe("audit_logs collection", () => {
  const LOG_ID = "audit-idempotent-1";
  // 재시도 페이로드는 결정적으로 동일해야 한다 — createdAt 이 serverTimestamp 가
  // 아니라 발생 시각에서 유도된 고정 Timestamp 인 이유(ledger-spool.ts).
  const OCCURRED_AT = new Date("2026-07-20T00:00:00.000Z");
  const auditDoc = () => ({
    projectId: PROJECT_ID,
    agentId: "agent-1",
    toolName: "add_activity",
    params: { taskId: "task-1" },
    result: "ok",
    duration: 12,
    success: true,
    kind: "tool",
    actorUid: OWNER_ID,
    createdAt: OCCURRED_AT,
  });

  it("인증 사용자는 감사 로그를 생성할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
  });

  it("★동일 내용 재쓰기는 성공한다 — ack 유실 후 멱등 재시도가 성립해야 한다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
    // 같은 id, 같은 내용으로 두 번 더 — 스풀 재시도가 하는 것과 정확히 같은 호출.
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
  });

  it("★내용이 다르면 실패한다 — 불변성은 그대로다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));

    // 결과 위조
    await assertFails(
      setDoc(doc(db, "audit_logs", LOG_ID), {
        ...auditDoc(),
        result: "조작된 결과",
      }),
    );
    // 성공/실패 뒤집기
    await assertFails(
      setDoc(doc(db, "audit_logs", LOG_ID), { ...auditDoc(), success: false }),
    );
    // 발생 시각 옮기기
    await assertFails(
      setDoc(doc(db, "audit_logs", LOG_ID), {
        ...auditDoc(),
        createdAt: new Date("2026-07-19T00:00:00.000Z"),
      }),
    );
    // 귀속 바꿔치기
    await assertFails(
      setDoc(doc(db, "audit_logs", LOG_ID), {
        ...auditDoc(),
        actorUid: OUTSIDER_ID,
      }),
    );
    // 필드 삭제(부분 쓰기로 원장을 깎아내기)
    await assertFails(
      updateDoc(doc(db, "audit_logs", LOG_ID), { result: "다른 값" }),
    );
  });

  it("감사 로그는 삭제할 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
    await assertFails(deleteDoc(doc(db, "audit_logs", LOG_ID)));
  });

  it("미인증 사용자는 감사 로그를 읽거나 쓸 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "audit_logs", LOG_ID)));
    await assertFails(setDoc(doc(db, "audit_logs", LOG_ID), auditDoc()));
  });
});

describe("ledger_checkpoints collection (L3 머클 체크포인트)", () => {
  const CP_ID = "test-project_7";
  const checkpointDoc = () => ({
    projectId: PROJECT_ID,
    kind: "periodic",
    seqNo: 7,
    atMs: 1_700_000_100_000,
    chains: [
      { projectId: PROJECT_ID, agentId: "agent-1", seq: 4, hash: "sha256:a" },
    ],
    merkleRoot: "sha256:root",
    prevCheckpointHash: "sha256:prev",
    hash: "sha256:cp7",
    createdAt: new Date("2026-07-20T00:00:00.000Z"),
  });

  it("인증 사용자(메인 프로세스)는 체크포인트를 생성할 수 있다", async () => {
    // ★멤버 스코프로 조이지 않는 이유: 쓰는 쪽이 메인 프로세스이고 그 인증 경로는
    // 렌더러와 다르다(#406 이 정확히 이 지점에서 터졌다). 위조 체크포인트를 끼워
    // 넣어도 prevCheckpointHash 사슬이 어긋나 검증에서 드러난다 — 무결성은 룰이
    // 아니라 해시가 보증한다.
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), checkpointDoc()),
    );
  });

  it("★체크포인트는 고칠 수 없다 — 고칠 수 있으면 봉인이 아니다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), checkpointDoc()),
    );

    // 명부에서 체인 하나를 빼 삭제를 정당화하려는 시도.
    await assertFails(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), {
        ...checkpointDoc(),
        chains: [],
      }),
    );
    // 머클 루트 갈아끼우기.
    await assertFails(
      updateDoc(doc(db, "ledger_checkpoints", CP_ID), {
        merkleRoot: "sha256:조작됨",
      }),
    );
    // ★audit_logs 와 달리 **동일 내용 재쓰기도** 막는다. 체크포인트 쓰기는
    // 결정적 id 로 1회만 일어나고 스풀 재시도 경로를 타지 않아, L1.6 고착을
    // 부르는 멱등 재시도 요구가 없다.
    await assertFails(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), checkpointDoc()),
    );
  });

  it("체크포인트는 삭제할 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), checkpointDoc()),
    );
    await assertFails(deleteDoc(doc(db, "ledger_checkpoints", CP_ID)));
  });

  it("프로젝트 멤버는 자기 프로젝트 체크포인트를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "ledger_checkpoints", "cp-ours")));
  });

  it("★타 테넌트 체크포인트는 읽을 수 없다 — 명부만 새어도 에이전트 구성이 드러난다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "ledger_checkpoints", "cp-other-tenant")));
  });

  it("비멤버는 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "ledger_checkpoints", "cp-ours")));
  });

  it("미인증 사용자는 읽지도 쓰지도 못한다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "ledger_checkpoints", "cp-ours")));
    await assertFails(
      setDoc(doc(db, "ledger_checkpoints", CP_ID), checkpointDoc()),
    );
  });
});

// ===== 원장 계열 L2 read 스코프 (크로스테넌트 격리) =====
//
// audit_logs / merge_history / telemetry_events 는 이전에 `allow read: if
// isAuthenticated()` 라 로그인만 하면 전 테넌트가 읽혔다. L2 는 이 셋을
// isProjectMember 로 조이되, projectId="" 유실 마커만 플랫폼 admin 에게 연다.
//
// ★가드 실효성: 아래 "타 테넌트/외부인 읽기 거부" 테스트들은 옛 룰
//   (isAuthenticated())에서는 읽기가 허용돼 assertFails 가 **실패**하고, 새 룰에서만
//   통과한다. 즉 이 테스트들이 구멍을 실제로 막는지 증명한다.

describe("audit_logs — L2 read 스코프", () => {
  it("프로젝트 멤버는 자기 프로젝트 감사로그를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "audit_logs", "audit-ours")));
  });

  it("★멤버라도 타 테넌트 감사로그는 읽을 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "audit_logs", "audit-other-tenant")));
  });

  it("★외부인은 감사로그를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "audit_logs", "audit-ours")));
  });

  it('★projectId="" 유실 tombstone 은 일반 멤버가 읽을 수 없다', async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDoc(doc(db, "audit_logs", "audit-tombstone-empty-project")),
    );
  });

  it('★projectId="" 유실 tombstone 은 플랫폼 admin 이 읽을 수 있다 (유실 가시성 보존)', async () => {
    const db = adminContext().firestore();
    await assertSucceeds(
      getDoc(doc(db, "audit_logs", "audit-tombstone-empty-project")),
    );
  });

  it("플랫폼 admin 이라도 projectId 있는 타 테넌트 레코드는 멤버십으로만 읽힌다(=admin은 못 읽음)", async () => {
    // admin 특권은 projectId="" 마커에만 열려 있다. 실 projectId 레코드는
    // 여전히 isProjectMember 로만 결정된다 — admin 이 OTHER_PROJECT_ID 멤버가
    // 아니므로 읽기 거부. (admin 을 만능 백도어로 만들지 않는다.)
    const db = adminContext().firestore();
    await assertFails(getDoc(doc(db, "audit_logs", "audit-other-tenant")));
  });

  it("미인증 사용자는 감사로그를 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "audit_logs", "audit-ours")));
  });
});

describe("projectAuditLog — owner/admin 전용 감사 조회", () => {
  it("owner 는 자기 프로젝트 감사로그를 읽을 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("admin 은 자기 프로젝트 감사로그를 읽을 수 있다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("★일반 멤버는 감사로그를 읽을 수 없다 (이 티켓의 핵심 게이트)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("★자기 자신이 행위자인 레코드라도 일반 멤버는 못 읽는다", async () => {
    // paudit-ours 의 actorUid 는 MEMBER_ID 다. "내 기록이니까 볼 수 있다"는
    // 예외를 두지 않는다 — 감사 대상이 감사 범위를 스스로 확인할 수 있으면
    // 무엇이 기록되는지 보고 회피 행동을 맞출 수 있다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("★owner 라도 타 테넌트 감사로그는 읽을 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      getDoc(doc(db, "projectAuditLog", "paudit-other-tenant")),
    );
  });

  it("외부인은 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("미인증 사용자는 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("플랫폼 admin 이라고 백도어로 읽히지 않는다", async () => {
    // isAdminOrOwner 는 프로젝트 역할이지 플랫폼 역할이 아니다.
    const db = adminContext().firestore();
    await assertFails(getDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("멤버는 자기 행위를 기록할 수 있다 (read 는 못 해도 write 는 됨)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "projectAuditLog"), {
        projectId: PROJECT_ID,
        actorUid: MEMBER_ID,
        actorName: "Member",
        type: "task.claimed",
        taskId: "task-1",
        targetId: "agent-1",
        metadata: { from: "TODO", to: "CLAIMED" },
        createdAt: new Date(),
      }),
    );
  });

  it("★남을 사칭한 기록은 거부된다 (actorUid != auth.uid)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "projectAuditLog"), {
        projectId: PROJECT_ID,
        actorUid: OWNER_ID, // 사칭
        actorName: "Owner",
        type: "task.claimed",
        taskId: "task-1",
        targetId: "agent-1",
        metadata: {},
        createdAt: new Date(),
      }),
    );
  });

  it("★비멤버는 타 프로젝트에 감사기록을 주입할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "projectAuditLog"), {
        projectId: PROJECT_ID,
        actorUid: OUTSIDER_ID,
        actorName: "Outsider",
        type: "chat.message.sent",
        taskId: null,
        targetId: "msg-forged",
        metadata: {},
        createdAt: new Date(),
      }),
    );
  });

  it("★append-only — owner 도 감사기록을 수정할 수 없다", async () => {
    // 사후 수정이 가능하면 감사가 아니다. owner 예외를 두지 않는다.
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projectAuditLog", "paudit-ours"), {
        type: "task.claimed",
      }),
    );
  });

  it("★append-only — owner 도 감사기록을 삭제할 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });

  it("★행위자 본인도 자기 기록을 지울 수 없다 (증거인멸 방지)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "projectAuditLog", "paudit-ours")));
  });
});

describe("merge_history — L2 read 스코프", () => {
  it("프로젝트 멤버는 자기 프로젝트 머지이력을 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "merge_history", "merge-ours")));
  });

  it("★멤버라도 타 테넌트 머지이력은 읽을 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "merge_history", "merge-other-tenant")));
  });

  it("★외부인은 머지이력을 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "merge_history", "merge-ours")));
  });

  // ── ★라이브 지뢰 인코딩: unscoped 쿼리는 거부, 멤버 스코프 쿼리만 허용 ──
  // 코크핏(WorktreeTab/WorkHistoryTab)이 지금 projectId 없이 구독한다.
  // 멤버 스코프 룰 하에서 unscoped orderBy 쿼리는 비멤버 문서를 포함할 수
  // 있으므로 Firestore 가 통째 거부한다 → 배포 전 프론트 스코프가 필수임을
  // 이 테스트가 못 박는다.
  it("★unscoped 크로스프로젝트 list 쿼리는 거부된다 (코크핏 라이브 다운 방지 계약)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(collection(db, "merge_history"), orderBy("mergedAt", "desc")),
      ),
    );
  });

  it("멤버 프로젝트로 스코프한 list 쿼리(where projectId ==)는 허용된다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "merge_history"),
          where("projectId", "==", PROJECT_ID),
          orderBy("mergedAt", "desc"),
        ),
      ),
    );
  });

  it("멤버 프로젝트 목록으로 스코프한 list 쿼리(where projectId in [...])는 허용된다", async () => {
    // mergeHistoryService 의 projectIds 옵션이 만드는 쿼리 형태 — 프론트가
    // 배포 전 채택할 경로.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "merge_history"),
          where("projectId", "in", [PROJECT_ID]),
          orderBy("mergedAt", "desc"),
        ),
      ),
    );
  });
});

describe("telemetry_events — L2 read 스코프", () => {
  it("프로젝트 멤버는 자기 프로젝트 텔레메트리를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "telemetry_events", "telemetry-ours")));
  });

  it("★멤버라도 타 테넌트 텔레메트리는 읽을 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDoc(doc(db, "telemetry_events", "telemetry-other-tenant")),
    );
  });

  it("★외부인은 텔레메트리를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "telemetry_events", "telemetry-ours")));
  });
});

// ===== Activities =====

describe("activities collection", () => {
  it("프로젝트 멤버는 활동 로그를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "activities", "activity-1")));
  });

  it("외부인은 활동 로그를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "activities", "activity-1")));
  });

  it("프로젝트 멤버는 활동 로그를 생성할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "activities"), {
        taskId: "task-1",
        agentId: "agent-1",
        message: "Test activity",
        createdAt: new Date(),
      }),
    );
  });

  it("외부인은 활동 로그를 생성할 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "activities"), {
        taskId: "task-1",
        agentId: "agent-1",
        message: "Cross-tenant activity",
        createdAt: new Date(),
      }),
    );
  });

  it("미인증 사용자는 활동을 생성할 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(collection(db, "activities"), {
        taskId: "task-1",
        agentId: "agent-1",
        message: "Unauthorized",
        createdAt: new Date(),
      }),
    );
  });
});

// ===== 공개 Replay (Phase 4-1) =====
//
// 설계: docs/MISSION-REPLAY-DESIGN.md §7.1 · §5.7 F6.
// 이 앱에서 미인증 read 가 열리는 **유일한** 표면이라 가장 촘촘히 핀한다.

const NEW_REPLAY_ID = "rnewnewnewnewnewnewnewnew1";

/**
 * 새 발행 1건을 룰을 통과하는 순서(소유권 → 공개)로 만든다.
 *
 * ★db 인스턴스를 인자로 받는다 — 같은 RulesTestContext 에서 `.firestore()` 를
 * 두 번 부르면 SDK 가 "settings can no longer be changed" 로 죽는다.
 */
async function seedOwnerDocAs(
  db: ReturnType<RulesTestContext["firestore"]>,
  replayId: string,
  overrides: Record<string, unknown> = {},
) {
  return setDoc(doc(db, "publicReplayOwners", replayId), {
    replayId,
    projectId: PROJECT_ID,
    missionId: "mission-2",
    publisherUid: OWNER_ID,
    level: "L2",
    includeCost: false,
    status: "published",
    publishedAt: new Date(),
    unpublishedAt: null,
    ...overrides,
  });
}

describe("publicReplays — anon read (발행된 것만)", () => {
  it("★미인증 사용자도 발행된 Replay 를 읽을 수 있다", async () => {
    const db = unauthContext().firestore();
    await assertSucceeds(getDoc(doc(db, "publicReplays", PUBLISHED_REPLAY_ID)));
  });

  it("★해제된(=문서 없는) replayId 는 읽을 수 없다 — fail-closed", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "publicReplays", UNPUBLISHED_REPLAY_ID)));
  });

  it("★열거 불가 — 컬렉션 list 는 미인증·로그인 사용자 모두 거부된다(F6)", async () => {
    await assertFails(
      getDocs(collection(unauthContext().firestore(), "publicReplays")),
    );
    await assertFails(
      getDocs(
        collection(
          getContext(OWNER_ID, OWNER_EMAIL).firestore(),
          "publicReplays",
        ),
      ),
    );
  });

  it("★status 가 published 가 아닌 문서는 읽히지 않는다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(
        doc(context.firestore(), "publicReplays", "rtamperedtamperedtampered1"),
        publicReplayDocSeed({ status: "unpublished" }),
      );
    });
    await assertFails(
      getDoc(
        doc(
          unauthContext().firestore(),
          "publicReplays",
          "rtamperedtamperedtampered1",
        ),
      ),
    );
  });
});

describe("publicReplays — write 는 owner/admin 만 (Q4)", () => {
  it("owner 는 소유권 문서를 만든 뒤 공개 문서를 발행할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(seedOwnerDocAs(db, NEW_REPLAY_ID));
    await assertSucceeds(
      setDoc(doc(db, "publicReplays", NEW_REPLAY_ID), publicReplayDocSeed()),
    );
  });

  it("admin 도 발행할 수 있다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(
      seedOwnerDocAs(db, NEW_REPLAY_ID, { publisherUid: ADMIN_ID }),
    );
    await assertSucceeds(
      setDoc(doc(db, "publicReplays", NEW_REPLAY_ID), publicReplayDocSeed()),
    );
  });

  it("★일반 멤버는 발행할 수 없다 — 회사 작업 공개는 거버넌스 사안이다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      seedOwnerDocAs(db, NEW_REPLAY_ID, { publisherUid: MEMBER_ID }),
    );
  });

  it("★소유권 문서 없이는 공개 문서를 만들 수 없다(판정 근거 부재 = 거부)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(
        doc(db, "publicReplays", "rorphanorphanorphanorpha1"),
        publicReplayDocSeed(),
      ),
    );
  });

  it("★해제된 replayId 는 되살릴 수 없다(소유권이 unpublished)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(
        doc(db, "publicReplays", UNPUBLISHED_REPLAY_ID),
        publicReplayDocSeed(),
      ),
    );
  });

  it("소유권 문서와 등급이 다르면 거부된다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await seedOwnerDocAs(db, NEW_REPLAY_ID, { level: "L1" });
    await assertFails(
      setDoc(
        doc(db, "publicReplays", NEW_REPLAY_ID),
        publicReplayDocSeed({ level: "L3" }),
      ),
    );
  });

  it("★스키마를 벗어난 문서는 거부된다(필드 추가·등급 오타·상태 위조)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await seedOwnerDocAs(db, NEW_REPLAY_ID);
    const ref = doc(db, "publicReplays", NEW_REPLAY_ID);

    // 내부 식별자를 몰래 실어 보내는 시도 — 공개 문서엔 봉투조차 없어야 한다.
    await assertFails(
      setDoc(ref, publicReplayDocSeed({ projectId: PROJECT_ID })),
    );
    await assertFails(setDoc(ref, publicReplayDocSeed({ level: "L4" })));
    await assertFails(setDoc(ref, publicReplayDocSeed({ status: "draft" })));
    await assertFails(setDoc(ref, publicReplayDocSeed({ payload: "" })));
    await assertFails(setDoc(ref, publicReplayDocSeed({ payload: 42 })));
    await assertFails(setDoc(ref, publicReplayDocSeed({ schemaVersion: 2 })));
  });

  it("★payload 상한(512000자)을 넘으면 거부된다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await seedOwnerDocAs(db, NEW_REPLAY_ID);
    await assertFails(
      setDoc(
        doc(db, "publicReplays", NEW_REPLAY_ID),
        publicReplayDocSeed({ payload: "x".repeat(512001) }),
      ),
    );
  });

  it("★공개 문서는 불변이다 — 이미 공유된 URL 의 내용이 바뀌지 않는다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "publicReplays", PUBLISHED_REPLAY_ID), {
        payload: '{"goal":"swapped"}',
      }),
    );
  });

  it("해제(삭제)는 owner/admin 만, 멤버·미인증은 불가", async () => {
    await assertFails(
      deleteDoc(
        doc(unauthContext().firestore(), "publicReplays", PUBLISHED_REPLAY_ID),
      ),
    );
    await assertFails(
      deleteDoc(
        doc(
          getContext(MEMBER_ID, MEMBER_EMAIL).firestore(),
          "publicReplays",
          PUBLISHED_REPLAY_ID,
        ),
      ),
    );
    await assertSucceeds(
      deleteDoc(
        doc(
          getContext(OWNER_ID, OWNER_EMAIL).firestore(),
          "publicReplays",
          PUBLISHED_REPLAY_ID,
        ),
      ),
    );
  });
});

describe("publicReplayOwners — 비공개 소유권 인덱스", () => {
  it("프로젝트 멤버는 발행 이력을 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDoc(doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID)),
    );
  });

  it("★외부인·미인증은 소유권 인덱스를 읽을 수 없다(내부 id 노출 차단)", async () => {
    await assertFails(
      getDoc(
        doc(
          getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore(),
          "publicReplayOwners",
          PUBLISHED_REPLAY_ID,
        ),
      ),
    );
    await assertFails(
      getDoc(
        doc(
          unauthContext().firestore(),
          "publicReplayOwners",
          PUBLISHED_REPLAY_ID,
        ),
      ),
    );
  });

  it("발행자 uid 를 위조할 수 없다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      seedOwnerDocAs(db, NEW_REPLAY_ID, { publisherUid: OWNER_ID }),
    );
  });

  it("published → unpublished 전이는 허용된다(해제)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID), {
        status: "unpublished",
        unpublishedAt: new Date(),
      }),
    );
  });

  it("★unpublished → published 되살리기는 거부된다(해제는 되돌릴 수 없다)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "publicReplayOwners", UNPUBLISHED_REPLAY_ID), {
        status: "published",
        unpublishedAt: null,
      }),
    );
  });

  it("★projectId·publisherUid 를 나중에 바꿔치기할 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID), {
        projectId: OTHER_PROJECT_ID,
      }),
    );
    await assertFails(
      updateDoc(doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID), {
        status: "unpublished",
        publisherUid: MEMBER_ID,
      }),
    );
  });

  it("★소유권 기록은 삭제할 수 없다(발행했다는 사실 자체가 감사 기록)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      deleteDoc(doc(db, "publicReplayOwners", PUBLISHED_REPLAY_ID)),
    );
  });
});

// ===== 미인증 접근 테스트 =====

describe("unauthenticated access", () => {
  it("미인증 사용자는 어떤 컬렉션도 접근할 수 없다", async () => {
    const db = unauthContext().firestore();

    await assertFails(getDoc(doc(db, "projects", PROJECT_ID)));
    await assertFails(getDoc(doc(db, "tasks", "task-1")));
    await assertFails(getDoc(doc(db, "agents", "agent-1")));
    await assertFails(getDoc(doc(db, "flows", "flow-1")));
    await assertFails(getDoc(doc(db, "invitations", "inv-1")));
    await assertFails(getDoc(doc(db, "subscriptions", OWNER_ID)));
    await assertFails(getDoc(doc(db, "coupons", "WELCOME2026")));
    await assertFails(getDoc(doc(db, "couponRedemptions", "redemption-1")));
  });
});
