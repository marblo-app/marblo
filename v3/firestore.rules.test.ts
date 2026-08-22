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
 *
 * ⚠️ 한국어 로케일 함정 (티켓 GOiAnCMjqrEPNcmBaiBY 에서 실측):
 *    ko_KR 로케일 JVM 에서는 룰 컴파일러가 검증 메시지 번들을 못 찾아
 *    (MissingResourceException: JValidationMessages_messages, locale ko_KR)
 *    룰 업로드가 500 으로 죽는다 — 룰 문법 오류처럼 보이지만 아니다.
 *    에뮬레이터를 직접 띄운다면 JVM 에 `-Duser.language=en -Duser.country=US`
 *    를 주고, 에뮬레이터에는 Java 11+ 가 필요하다(시스템 java 가 8이면 실패).
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
  deleteField,
  query,
  where,
  orderBy,
} from "firebase/firestore";
import { readFileSync } from "fs";
import { describe, it, beforeAll, afterAll, beforeEach, expect } from "vitest";
import { applyProjection } from "./electron/mcp-server/projection";

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

    // missions: 우리 프로젝트 / 타 테넌트 / projectId 없는 손상 문서.
    // ★이 셋이 크로스테넌트 티켓(Ciriq5ASEvAlA8TnKxhW)의 관측 대상이다 — 옛 룰은
    //   `allow read: if isAuthenticated()` 라 로그인만 하면 셋 다 읽혔다.
    await setDoc(doc(db, "missions", "mission-ours"), {
      projectId: PROJECT_ID,
      status: "active",
      goal: "our mission",
      taskIds: [],
      lastActivityAt: new Date(),
    });
    await setDoc(doc(db, "missions", "mission-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      status: "planning",
      goal: "other tenant mission",
      taskIds: [],
      lastActivityAt: new Date(),
    });
    // projectId 필드가 아예 없는 구/손상 문서 — 귀속할 테넌트가 없으므로
    // 아무도 못 읽어야 한다(fail-closed). projection.ts 가 이미 이 경우를
    // "스코프 쿼리를 만들 수 없다"며 건너뛴다.
    await setDoc(doc(db, "missions", "mission-legacy-no-project"), {
      status: "active",
      goal: "legacy mission without projectId",
      taskIds: [],
      lastActivityAt: new Date(),
    });

    // cost_logs: 우리 프로젝트 / 타 테넌트 / projectId 없는 구 문서.
    // ★살아 있는 Firestore 읽기 경로는 0건이다(코드베이스의 cost_logs 는 전부
    //   BigQuery 테이블). 그래도 잔존 문서가 로그인만으로 읽히던 구멍이라 닫는다.
    await setDoc(doc(db, "cost_logs", "cost-ours"), {
      projectId: PROJECT_ID,
      userId: MEMBER_ID,
      model: "test-model",
      totalCost: 0.01,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "cost_logs", "cost-other-tenant"), {
      projectId: OTHER_PROJECT_ID,
      userId: OUTSIDER_ID,
      model: "test-model",
      totalCost: 9.99,
      createdAt: new Date(),
    });
    await setDoc(doc(db, "cost_logs", "cost-legacy-no-project"), {
      userId: OUTSIDER_ID,
      model: "test-model",
      totalCost: 1.23,
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

  /**
   * ★동의 폼 ↔ 룰 드리프트 재발 가드(waitlist 사고와 같은 종류).
   *
   * 그 사고의 진범은 "폼이 필드를 늘렸는데 룰의 hasOnly 를 안 늘려서 전면
   * permission-denied" 였다. 그래서 여기서는 룰 문법이 아니라 **클라이언트가
   * 실제로 보내는 payload 그대로** 를 쓴다 — privacyConsentService.saveConsent
   * 가 만드는 모양(플래그 + version + acceptedAt + locale). 필드가 늘어난 뒤에도
   * 이 테스트가 통과해야 온보딩 동의 카드가 살아 있다.
   *
   * 오늘 users/{uid} 의 update 규칙에는 키 allowlist(hasOnly)가 없고 소유자
   * 검사만 있다 — 그래서 새 필드가 막히지 않는다. 이 테스트는 그 성질이
   * 조용히 뒤집히는(누군가 hasOnly 를 도입하는) 순간을 잡는다.
   */
  it("본인 privacyConsent(학습데이터 기여 필드 포함) 를 저장할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "users", OWNER_ID),
        {
          privacyConsent: {
            firstPartyTelemetry: true,
            sentry: false,
            ga4: false,
            mixpanel: false,
            overseasTransfer: false,
            // 원문 기여 옵트인 + "한 번 물어봤다" 마커 (ticket QFNrT4Z4dG9nGoRYmTlr)
            trainingDataCapture: true,
            trainingDataPrompted: true,
            version: "2026-06-01",
            acceptedAt: new Date(),
            locale: "ko",
          },
        },
        { merge: true },
      ),
    );
  });

  it("타인의 privacyConsent 는 저장할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      setDoc(
        doc(db, "users", OWNER_ID),
        {
          privacyConsent: {
            firstPartyTelemetry: true,
            trainingDataCapture: true,
            trainingDataPrompted: true,
            version: "2026-06-01",
            acceptedAt: new Date(),
            locale: "ko",
          },
        },
        { merge: true },
      ),
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

  it("레거시 프로젝트에서 ownerId는 members 누락이어도 프로젝트를 읽을 수 있다", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "projects", "legacy-project-owner-only"), {
        name: "Legacy Owner Only",
        ownerId: OWNER_ID,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const ownerDb = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    const outsiderDb = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      getDoc(doc(ownerDb, "projects", "legacy-project-owner-only")),
    );
    await assertFails(
      getDoc(doc(outsiderDb, "projects", "legacy-project-owner-only")),
    );
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

  it("프로젝트 멤버는 멤버 티어 필드를 수정할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        gitRemoteUrl: "github.com/acme/repo",
        updatedAt: new Date(),
      }),
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

// ===== projects 필드별 쓰기 권한 (티켓 wWl44fSBwmQ4vRylmHsF, P1) =====
//
// 규칙은 allowlist 다: 멤버 티어 / 관리자(owner·admin) 티어 / 그 외 전부 차단.
// 아래는 **양방향** 검증이다 — 허용 필드가 그대로 되는지(회귀 0)와 금지 필드가
// 실제로 거부되는지를 같은 블록에서 못박는다. 한쪽만 있으면 "전부 막혔는데
// 테스트는 통과"하거나 그 반대가 된다.
//
// 필드 목록의 근거(어느 코드가 무엇을 쓰는지)는 firestore.rules 의
// projectMemberWritableFields 주석에 census 로 남겼다.

describe("projects 필드별 쓰기 권한 (wWl44fSBwmQ4vRylmHsF)", () => {
  // ── 멤버 티어: 지금 멤버가 정당하게 쓰는 필드는 계속 써진다 ──────────
  //   각 케이스 옆 주석이 그 필드를 실제로 쓰는 코드 경로다.

  it("멤버: gitRemoteUrl 을 쓸 수 있다 (RepoConnectModal / teamService backfill)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        gitRemoteUrl: "github.com/acme/repo",
        updatedAt: new Date(),
      }),
    );
  });

  it("멤버: folderPaths 기기 칸을 merge 로 쓸 수 있다 (setProjectFolderPathForMachine)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_ID),
        {
          folderPaths: {
            m_machine1: { path: "/Users/x/repo", platform: "darwin" },
          },
          updatedAt: new Date(),
        },
        { merge: true },
      ),
    );
  });

  it("멤버: telegramChannel 을 쓸 수 있다 (telegram-channel-sync.writeChannelMeta)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_ID),
        { telegramChannel: { chatId: "123" }, updatedAt: new Date() },
        { merge: true },
      ),
    );
  });

  it("멤버: telegramChannel 을 deleteField 로 지울 수 있다 (채널 연결 해제)", async () => {
    // telegram-channel-sync.writeChannelMeta 는 meta 가 null 이면
    // `{ telegramChannel: deleteField() }` 를 merge 로 보낸다. 필드 삭제도
    // affectedKeys 에 잡히므로 allowlist 에 걸리는지 확인한다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(
        doc(db, "projects", PROJECT_ID),
        { telegramChannel: deleteField(), updatedAt: new Date() },
        { merge: true },
      ),
    );
  });

  it("멤버: enabledModels 를 쓸 수 있다 (디스패치 설정)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        enabledModels: ["claude"],
        updatedAt: new Date(),
      }),
    );
  });

  it("★ 멤버는 assistantTriggers 를 쓸 수 없다 (서버 전용)", async () => {
    // census 결과 이 앱에는 쓰기 경로가 아예 없다(읽기만 존재). 이 값은
    // 오케스트레이터를 깨우는 실행 스위치라 멤버가 임의로 켜면 남의 기기에서
    // 에이전트가 돈다. 콘솔·서버는 Admin SDK 라 규칙을 우회해 그대로 설정한다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        assistantTriggers: { enabled: true },
        updatedAt: new Date(),
      }),
    );
  });

  it("★ owner/admin 도 assistantTriggers 를 쓸 수 없다 (서버 전용)", async () => {
    const ownerDb = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(ownerDb, "projects", PROJECT_ID), {
        assistantTriggers: { enabled: true },
        updatedAt: new Date(),
      }),
    );
    const adminDb = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(adminDb, "projects", PROJECT_ID), {
        assistantTriggers: { enabled: true },
        updatedAt: new Date(),
      }),
    );
  });

  // ── 관리자 티어: name / kind / members ────────────────────────────────

  it("멤버: name 은 쓸 수 없다 (관리자 티어)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        name: "Renamed By Member",
        updatedAt: new Date(),
      }),
    );
  });

  it("멤버: kind 는 쓸 수 없다 (관리자 티어)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        kind: "assistant",
        updatedAt: new Date(),
      }),
    );
  });

  it("멤버: 허용 필드에 금지 필드를 끼워 넣어도 통째로 거부된다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        gitRemoteUrl: "github.com/acme/repo",
        name: "Smuggled",
        updatedAt: new Date(),
      }),
    );
  });

  it("멤버: 다른 사람을 members 에 추가할 수 없다 (manage_members 는 owner/admin)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion("smuggled-user"),
        updatedAt: new Date(),
      }),
    );
  });

  it("owner: name / kind 를 쓸 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        name: "Renamed By Owner",
        kind: "assistant",
        updatedAt: new Date(),
      }),
    );
  });

  it("admin: name 과 members 를 쓸 수 있다 (TeamManagement 경로)", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        name: "Renamed By Admin",
        members: [OWNER_ID, ADMIN_ID],
        updatedAt: new Date(),
      }),
    );
  });

  // ── 서버 전용 / 불변 필드: 누구도 클라이언트에서 못 쓴다 ───────────────

  it("★ 멤버는 githubInstallationId 를 쓸 수 없다 (크로스테넌트 권한 상승 차단)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        githubInstallationId: "12345678",
        updatedAt: new Date(),
      }),
    );
  });

  it("★ owner/admin 도 githubInstallationId 를 쓸 수 없다 (서버 전용)", async () => {
    const ownerDb = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(ownerDb, "projects", PROJECT_ID), {
        githubInstallationId: "12345678",
        updatedAt: new Date(),
      }),
    );
    const adminDb = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(adminDb, "projects", PROJECT_ID), {
        githubInstallationId: "12345678",
        updatedAt: new Date(),
      }),
    );
  });

  // ── GitHub App 자동상속: 서버 전용 컬렉션 + 탈퇴 차단 ──────────────────
  // (티켓 ddbN2KvxHZ08rakiVfL0, 설계 §3·§7.1)

  it("★ github_app_setup_states 는 누구도 읽거나 쓸 수 없다 (state 위조 재료 차단)", async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "github_app_setup_states", "n1"), {
        uid: OWNER_ID,
        projectId: PROJECT_ID,
        expiresAt: Date.now() + 60_000,
        consumedAt: null,
      });
    });
    for (const ctx of [
      getContext(OWNER_ID, OWNER_EMAIL),
      getContext(MEMBER_ID, MEMBER_EMAIL),
      getContext(OUTSIDER_ID, OUTSIDER_EMAIL),
    ]) {
      const db = ctx.firestore();
      await assertFails(getDoc(doc(db, "github_app_setup_states", "n1")));
      await assertFails(
        setDoc(doc(db, "github_app_setup_states", "n2"), {
          uid: OUTSIDER_ID,
          projectId: PROJECT_ID,
        }),
      );
    }
  });

  it("★ github_app_access_logs 는 클라이언트가 쓸 수 없다 (감사 원장 위조 차단)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "github_app_access_logs"), {
        uid: MEMBER_ID,
        projectId: PROJECT_ID,
        outcome: "issued",
      }),
    );
  });

  it("★ 탈퇴 차단: members 에서 빠지는 즉시 프로젝트 문서를 못 읽는다 (T+0)", async () => {
    // 설계 §7.1 의 첫 줄 — 오너가 removeMember() 하면 그 순간부터 그 사람은
    // projects/{id} 를 못 읽는다. 서버의 발급 함수도 같은 문서를 Admin SDK 로
    // 읽어 같은 판정을 하므로(githubApp.evaluateInstallationTokenRequest),
    // "룰이 막는 것"과 "발급이 막히는 것"이 같은 사실 하나에 묶여 있다.
    const memberDb = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(memberDb, "projects", PROJECT_ID)));

    await testEnv.withSecurityRulesDisabled(async (context) => {
      await updateDoc(doc(context.firestore(), "projects", PROJECT_ID), {
        members: [OWNER_ID, ADMIN_ID],
        githubInstallationId: "12345678",
      });
    });

    await assertFails(getDoc(doc(memberDb, "projects", PROJECT_ID)));
    // 남은 멤버는 영향 없다 — 제거는 O(1) 이고 다른 사람에게 번지지 않는다.
    const ownerDb = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(ownerDb, "projects", PROJECT_ID)));
  });

  it("★ 멤버는 gitRemoteUrl 을 바꿀 수 있다 — 그래서 서버가 GitHub 에 되묻는다", async () => {
    // 이 성공은 버그가 아니라 **전제**다. gitRemoteUrl 은 멤버 쓰기 필드라
    // (projectMemberWritableFields) 크로스테넌트 공격의 입력이 될 수 있고,
    // 그래서 issueRepoInstallationToken 이 슬러그를 믿지 않고
    // GET /repos/{owner}/{repo}/installation 로 되물어 installation id 일치를
    // 확인한다(githubApp.verifyRepoInstallationBinding). 이 테스트가 실패하면
    // (=룰이 막게 되면) 서버의 되묻기 방어를 재검토해야 한다는 신호다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        gitRemoteUrl: "https://github.com/victim/private.git",
        updatedAt: new Date(),
      }),
    );
  });

  it("★ 생성 시점에도 githubInstallationId 를 심을 수 없다 (create 우회로 차단)", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "projects", "gh-smuggle-project"), {
        name: "Smuggle",
        ownerId: OUTSIDER_ID,
        members: [OUTSIDER_ID],
        githubInstallationId: "12345678",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("owner 도 ownerId 를 바꿀 수 없다 (소유권 이전 경로 없음 = 불변)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        ownerId: ADMIN_ID,
        updatedAt: new Date(),
      }),
    );
  });

  it("멤버는 createdAt 을 바꿀 수 없다 (불변)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });

  it("모르는 신규 필드는 기본 차단된다 (allowlist 이므로 fail-closed)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        someFutureServerField: "x",
        updatedAt: new Date(),
      }),
    );
  });

  // ── 정상 생성 경로 회귀 가드 ───────────────────────────────────────────

  it("앱이 실제로 만드는 형태의 프로젝트 생성은 그대로 성공한다", async () => {
    // useProjectSetup.autoRegisterProject / Header.handleCreateProject 가
    // 보내는 필드 조합 그대로.
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      setDoc(doc(db, "projects", "app-shaped-project"), {
        name: "new-project",
        ownerId: OUTSIDER_ID,
        members: [OUTSIDER_ID],
        kind: "dev",
        folderPath: "/Users/x/new-project",
        gitRemoteUrl: "github.com/acme/new-project",
        createdAt: new Date(),
        updatedAt: new Date(),
      }),
    );
  });
});

// ===== 계정 격리: projects 쿼리(list) — 티켓 GOiAnCMjqrEPNcmBaiBY =====
//
// 위 describe 는 전부 단건 `get` 이다. 그런데 앱이 프로젝트 리스트를 채우는
// 실제 모양은 **쿼리(list)** 다:
//   projectStore.subscribeToProjects / projectService.getProjects
//     → query(projects, where("members", "array-contains", uid))
// get 이 격리돼 있다고 list 도 격리된 것은 아니다 — 룰 평가 단위가 다르다
// ("security rules are not filters", 이 파일 tasks 섹션 주석의 그 규율).
// 계정 전환 후 이전 계정 프로젝트가 보인 P0 의 심각도 판정(rules breach 인가,
// 렌더러 스테일 상태인가)이 걸린 지점이므로 여기서 명시적으로 못 박는다.
describe("projects 계정 격리 (list 쿼리)", () => {
  // 방금 로그인한 새 계정 — 어떤 프로젝트에도 속하지 않는다(datagadapida 역).
  const SWITCHED_ID = "switched-account-user";
  const SWITCHED_EMAIL = "switched@test.com";

  it("새 계정의 스코프 쿼리는 남의 프로젝트를 0건 반환한다", async () => {
    const db = getContext(SWITCHED_ID, SWITCHED_EMAIL).firestore();
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(db, "projects"),
          where("members", "array-contains", SWITCHED_ID),
        ),
      ),
    );
    expect(snap.docs.map((d) => d.id)).toEqual([]);
  });

  it("멤버의 스코프 쿼리는 자기 프로젝트만 반환한다(타 테넌트 제외)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    const snap = await assertSucceeds(
      getDocs(
        query(
          collection(db, "projects"),
          where("members", "array-contains", MEMBER_ID),
        ),
      ),
    );
    expect(snap.docs.map((d) => d.id).sort()).toEqual([PROJECT_ID]);
  });

  it("무스코프 list 는 통째로 거부된다(룰은 필터가 아니다)", async () => {
    const db = getContext(SWITCHED_ID, SWITCHED_EMAIL).firestore();
    await assertFails(getDocs(collection(db, "projects")));
  });

  // ★이 테스트가 (a) 스테일 세션 시나리오의 fail-closed 보증이다: 렌더러가
  // 버그로 **이전 계정 uid** 로 구독을 계속하더라도, 인증 주체가 새 계정인 한
  // Firestore 가 쿼리를 거부한다 → 남의 프로젝트가 스냅샷으로 흘러들 수 없다.
  it("이전 계정 uid 로 스코프한 쿼리는 거부된다(스테일 구독 fail-closed)", async () => {
    const db = getContext(SWITCHED_ID, SWITCHED_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, "projects"),
          where("members", "array-contains", OWNER_ID),
        ),
      ),
    );
  });

  it("미인증 상태에서는 프로젝트를 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "projects", PROJECT_ID)));
    await assertFails(
      getDocs(
        query(
          collection(db, "projects"),
          where("members", "array-contains", OWNER_ID),
        ),
      ),
    );
  });
});

// ===== Tasks =====

describe("tasks collection", () => {
  it("프로젝트 멤버는 태스크를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "tasks", "task-1")));
  });

  it("레거시 프로젝트에서 ownerId는 members 누락이어도 태스크를 읽고 쓸 수 있다", async () => {
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
    await assertSucceeds(getDoc(doc(db, "tasks", "legacy-task-no-members")));
    await assertSucceeds(
      updateDoc(doc(db, "tasks", "legacy-task-no-members"), {
        status: "IN_PROGRESS",
      }),
    );
    await assertSucceeds(
      addDoc(collection(db, "activities"), {
        taskId: "legacy-task-no-members",
        agentId: "agent-legacy",
        message: "owner write via legacy project",
        createdAt: new Date(),
      }),
    );
    await assertSucceeds(
      addDoc(collection(db, "pendingInstructions"), {
        projectId: "legacy-no-members",
        taskId: "legacy-task-no-members",
        targetAgentId: "agent-legacy",
        message: "continue",
        fromUserId: OWNER_ID,
        fromUserName: "owner",
        sourceType: "orchestrator",
        isDelivered: false,
        createdAt: new Date(),
        deliveredAt: null,
      }),
    );
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

  // ★오버그랜트 회귀 가드 (티켓 3YSvLFCT707GpV8FEyUp, P0).
  //   위 "초대가 다른 프로젝트 것이면" 케이스는 **본문 projectId 위조**를 막는다.
  //   여기서는 그 거울상 — 초대가 **진짜 유효한** 상태에서, 그 초대 하나가 같은
  //   owner 의 **다른 프로젝트**까지 열어주지 않는지를 못박는다. 콜라보 1명을
  //   프로젝트 1개에 추가했는데 owner 소유 프로젝트 여러 개에 멤버가 박힌 사고의
  //   룰 층 방어선이다. 같은 테스트 안에서 대상 프로젝트 self-join 이 성공하는
  //   것까지 확인해, 거부가 "초대가 애초에 무효라서"가 아님을 보장한다.
  it("유효한 초대 1건은 그 프로젝트 하나만 연다 — 같은 owner 의 다른 프로젝트 self-join 은 거부", async () => {
    const SIBLING_PROJECT_ID = "sibling-project";
    await testEnv.withSecurityRulesDisabled(async (context) => {
      await setDoc(doc(context.firestore(), "projects", SIBLING_PROJECT_ID), {
        name: "Sibling Of Invited Project",
        ownerId: OWNER_ID,
        members: [OWNER_ID],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });

    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    // 초대받은 그 프로젝트는 열린다.
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
    // 같은 초대로 형제 프로젝트까지 열리지는 않는다(그 프로젝트용 초대 문서 없음).
    await assertFails(
      updateDoc(doc(db, "projects", SIBLING_PROJECT_ID), {
        members: arrayUnion(OUTSIDER_ID),
        updatedAt: new Date(),
      }),
    );
  });

  it("기존 멤버의 일반 update 는 계속 허용된다 (회귀 없음)", async () => {
    // 필드별 권한 도입(티켓 wWl44fSBwmQ4vRylmHsF) 이후 name 은 관리자 티어라
    // 여기서는 멤버 티어 필드로 "self-join 게이트가 일반 update 를 막지
    // 않는다"만 확인한다. name 의 티어 자체는 전용 describe 가 검증한다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "projects", PROJECT_ID), {
        gitRemoteUrl: "github.com/acme/repo",
        updatedAt: new Date(),
      }),
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

// ===== missions / cost_logs 크로스테넌트 격리 (티켓 Ciriq5ASEvAlA8TnKxhW) =====
//
// 옛 룰은 둘 다 `allow read: if isAuthenticated()` 였다 — 로그인만 하면 남의
// 테넌트 미션·비용로그를 읽었고 프로젝트 멤버십은 보지도 않았다. 원장 계열은
// #L2 에서 닫혔는데 이 둘만 남아 있었다.
//
// ★가드 실효성: 아래 "타 테넌트/외부인 읽기 거부" 테스트는 **옛 룰에서 읽기가
//   허용돼 assertFails 가 실패**하고 새 룰에서만 통과한다. 즉 구멍을 실제로
//   막는지 증명한다. 반대로 "정당한 읽기 통과" 테스트들은 룰을 과하게 조여
//   앱을 죽이지 않았음을 증명한다 — 이 티켓은 양쪽을 다 못박아야 한다.

describe("missions — 크로스테넌트 read 격리", () => {
  it("프로젝트 멤버는 자기 프로젝트 미션을 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "missions", "mission-ours")));
  });

  it("★멤버라도 타 테넌트 미션은 읽을 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "missions", "mission-other-tenant")));
  });

  it("★외부인은 우리 미션을 읽을 수 없다 (옛 룰에선 로그인만으로 뚫렸음)", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "missions", "mission-ours")));
  });

  it("미인증 사용자는 미션을 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "missions", "mission-ours")));
  });

  it("★projectId 없는 손상 미션은 아무도 못 읽는다 (fail-closed)", async () => {
    // 원장(canReadLedgerDoc)과 다른 점: 저기선 projectId="" 가 '유실의 기록'
    // 이라 플랫폼 admin 에게 열어야 했지만, 미션엔 그런 요구가 없다. 귀속할
    // 테넌트가 없는 문서는 그냥 아무도 못 읽는 게 맞다.
    const member = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(member, "missions", "mission-legacy-no-project")));
    const admin = adminContext().firestore();
    await assertFails(getDoc(doc(admin, "missions", "mission-legacy-no-project")));
  });

  // ── 정당한 읽기 경로가 살아 있는지 (회귀 0 증명) ──────────────────────────
  //
  // "security rules are not filters" — list 는 쿼리 제약식만으로 룰이 증명돼야
  // 한다. 아래 두 테스트가 electron/mcp-server/project-scope.ts 의 규율이
  // missions 에도 적용돼야 하는 이유의 실측 근거다.

  it("★projectId 스코프 쿼리는 통과한다 — missionService/main.ts/tools.ts 실경로", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, "missions"), where("projectId", "==", PROJECT_ID)),
      ),
    );
  });

  it("★projectId + implicitLabel 복합 스코프 쿼리도 통과한다 — resolveImplicitMissionId 실경로", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "missions"),
          where("projectId", "==", PROJECT_ID),
          where("implicitLabel", "==", "some-label"),
        ),
      ),
    );
  });

  it("★무스코프 status 쿼리는 거부된다 — mission-engine 이 스코프돼야 하는 이유", async () => {
    // wire.ts / event-forwarder.ts 가 쓰던 모양. 결과가 전부 내 프로젝트여도
    // 룰은 쿼리 제약식만 보므로 통째로 거부된다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(collection(db, "missions"), where("status", "==", "active")),
      ),
    );
  });

  it("★타 테넌트를 겨냥한 스코프 쿼리는 거부된다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, "missions"),
          where("projectId", "==", OTHER_PROJECT_ID),
        ),
      ),
    );
  });
});

// ★mission-engine 이 의존하는 계약 — 실측으로 정한 것이다(추론 아님).
//
// wire.ts / event-forwarder.ts 는 원래 무스코프 status 쿼리를 쐈고, 멤버 스코프
// 룰에서는 그게 통째로 거부된다(위 "무스코프 status 쿼리는 거부된다" 참조).
// 프로젝트마다 쿼리를 쪼개는 대신 `in` 한 방으로 덮을 수 있는지를 에뮬레이터로
// 재 본 결과가 아래다. 통과하므로 엔진은 `where(projectId,in,내프로젝트들)` 로
// 고친다 — 구독 개수가 프로젝트 수만큼 늘지 않는다.
//
// ★이 describe 가 깨지면 엔진 쿼리 모양을 되돌려야 한다는 신호다.
describe("missions — in-스코프 쿼리 계약 (mission-engine 이 의존)", () => {
  it("★where(projectId,in,[내프로젝트]) 는 통과한다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, "missions"), where("projectId", "in", [PROJECT_ID]))),
    );
  });
  it("★in-스코프 + status 동등조건 조합도 통과한다 — 엔진이 실제로 쏘는 모양", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(query(collection(db, "missions"),
        where("projectId", "in", [PROJECT_ID]), where("status", "==", "active"))),
    );
  });
  it("★in 목록에 남의 프로젝트가 섞이면 통째로 거부된다 (경계가 실재한다)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      getDocs(query(collection(db, "missions"),
        where("projectId", "in", [PROJECT_ID, OTHER_PROJECT_ID]))),
    );
  });
});

// ===== missions 쓰기 축 테넌트 격리 (티켓 tGQ2c13YNalM5rqRetOE) =====
//
// #1113 은 read 만 닫았고 create/update/delete 는 `isAuthenticated()` 로 남아
// 있었다 — 로그인만 하면 남의 테넌트 미션을 고치거나 **지울 수 있었다**.
// 읽기 유출은 되돌릴 수 있지만 삭제는 못 되돌린다.
//
// ★두 방향을 다 못박는다:
//   (거부) 아래 "★" 테스트들은 **옛 룰에서 전부 통과해 assertFails 가 실패**한다.
//          즉 구멍을 실제로 막았다는 증거다.
//   (통과) "정당한 쓰기" describe 는 앱의 실제 write payload 모양 그대로다.
//          하나라도 깨지면 룰을 과하게 조여 미션 엔진/탭을 죽였다는 신호다.
//
// 참고: OUTSIDER_ID 는 OTHER_PROJECT_ID 의 owner 다 — "남의 테넌트의 정당한
// 멤버"이지 미인증 사용자가 아니다. 경계가 인증이 아니라 **멤버십**임을 검증한다.

describe("missions — 쓰기 축 크로스테넌트 격리 (거부되어야 하는 것)", () => {
  it("★외부인은 우리 미션을 삭제할 수 없다 (옛 룰에선 로그인만으로 지워졌다)", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "missions", "mission-ours")));
  });

  it("★멤버라도 타 테넌트 미션은 삭제할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(deleteDoc(doc(db, "missions", "mission-other-tenant")));
  });

  it("★외부인은 우리 미션을 수정할 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "missions", "mission-ours"), { status: "abandoned" }),
    );
  });

  it("★멤버라도 타 테넌트 미션은 수정할 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "missions", "mission-other-tenant"), {
        goal: "hijacked",
      }),
    );
  });

  it("★남의 프로젝트 이름으로 미션을 만들 수 없다 (create 위조)", async () => {
    // 외부인이 우리 projectId 를 알아내 우리 보드에 미션을 심는 공격.
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "missions"), {
        projectId: PROJECT_ID,
        goal: "injected mission",
        status: "planning",
        taskIds: [],
        lastActivityAt: new Date(),
      }),
    );
  });

  it("★멤버도 자기가 속하지 않은 프로젝트로는 미션을 만들 수 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "missions"), {
        projectId: OTHER_PROJECT_ID,
        goal: "cross-tenant create",
        status: "planning",
        taskIds: [],
        lastActivityAt: new Date(),
      }),
    );
  });

  it("★projectId 없는 미션은 만들 수 없다 (귀속 불가 문서 생성 차단)", async () => {
    // 이게 열려 있으면 "아무도 못 읽고 아무도 못 지우는" 좀비 문서를 누구나
    // 무한히 심을 수 있다 — fail-closed read 의 부작용을 무기로 쓰는 경로다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      addDoc(collection(db, "missions"), {
        goal: "no project",
        status: "planning",
        taskIds: [],
        lastActivityAt: new Date(),
      }),
    );
  });

  it("★미션을 다른 테넌트로 옮길 수 없다 (projectId 핀)", async () => {
    // 멤버는 이 문서에 쓸 권한이 있다. 그래도 projectId 를 바꿔 남의 프로젝트로
    // 밀어넣거나(또는 남의 것을 끌어오거나) 하는 것은 막혀야 한다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(db, "missions", "mission-ours"), {
        projectId: OTHER_PROJECT_ID,
      }),
    );
  });

  it("★projectId 없는 손상 미션은 아무도 수정·삭제할 수 없다 (read 와 같은 fail-closed)", async () => {
    const member = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(
      updateDoc(doc(member, "missions", "mission-legacy-no-project"), {
        status: "completed",
      }),
    );
    await assertFails(
      deleteDoc(doc(member, "missions", "mission-legacy-no-project")),
    );
    // 플랫폼 admin 도 예외가 아니다 — 원장(canReadLedgerDoc)의 projectId="" 예외를
    // 여기 복사하지 않기로 한 #1113 의 판단을 쓰기에도 그대로 유지한다.
    const admin = adminContext().firestore();
    await assertFails(
      deleteDoc(doc(admin, "missions", "mission-legacy-no-project")),
    );
  });

  it("미인증 사용자는 미션을 만들거나 고치거나 지울 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(
      addDoc(collection(db, "missions"), { projectId: PROJECT_ID, goal: "x" }),
    );
    await assertFails(
      updateDoc(doc(db, "missions", "mission-ours"), { goal: "x" }),
    );
    await assertFails(deleteDoc(doc(db, "missions", "mission-ours")));
  });
});

// ★회귀 0 증명 — 아래 payload 는 전부 앱의 **실제** 쓰기 모양이다(파일:라인 명시).
//   #1113 이 read 를 조일 때 무스코프 쿼리 3곳을 먼저 찾아 엔진이 죽는 걸 막았듯,
//   쓰기도 "정당한 write 가 살아 있다"를 못박지 않으면 조용히 죽는다.
describe("missions — 정당한 쓰기가 살아 있다 (앱 실경로 payload)", () => {
  it("멤버는 자기 프로젝트에 미션을 만들 수 있다 — MissionsTab.tsx:145 handleLaunch", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "missions"), {
        projectId: PROJECT_ID,
        goal: "ship the thing",
        templateId: "quick-fix",
        status: "planning",
        ownerOrchestratorSessionId: "pending",
        steps: [],
        currentStepIndex: 0,
        taskIds: [],
        contextLog: [],
        launchedAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: null,
      }),
    );
  });

  it("MCP 암묵적 미션 생성도 통과한다 — implicit-mission.ts:162 buildImplicitMissionDoc", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      addDoc(collection(db, "missions"), {
        projectId: PROJECT_ID,
        goal: "implicit",
        templateId: "implicit",
        status: "active",
        missionKind: "implicit",
        implicitLabel: "some-label",
        ownerOrchestratorSessionId: "",
        steps: [],
        currentStepIndex: 0,
        taskIds: [],
        contextLog: [],
        launchedAt: new Date(),
        lastActivityAt: new Date(),
        completedAt: null,
      }),
    );
  });

  it("★projectId 를 안 보내는 부분 패치가 통과한다 — missionService.ts:106 updateMission", async () => {
    // 이 테스트가 이 티켓 설계의 핵심 근거다: 앱의 update 는 전부 부분 패치라
    // projectId 를 보내지 않는다. updateDoc 의 request.resource.data 는 "기존
    // 문서 + 패치" 병합값이므로 projectId 핀이 정상 쓰기를 막지 않는다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "missions", "mission-ours"), {
        status: "completed",
        lastActivityAt: new Date(),
        completedAt: new Date(),
      }),
    );
  });

  it("taskIds arrayUnion 갱신이 통과한다 — tools.ts:1551 / dispatcher-impl.ts:81", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "missions", "mission-ours"), {
        taskIds: arrayUnion("task-1"),
        lastActivityAt: new Date(),
      }),
    );
  });

  it("projection 점표기 갱신이 통과한다 — mcp-server/projection.ts:378 txn.update", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "missions", "mission-ours"), {
        taskIds: ["task-1"],
        "projection.statusCounts": { DONE: 1 },
        "projection.lastTaskActivityAt": new Date(),
        lastActivityAt: new Date(),
      }),
    );
  });

  it("projectId 를 같은 값으로 실어 보내도 통과한다 (핀은 no-op 재확인을 막지 않는다)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "missions", "mission-ours"), {
        projectId: PROJECT_ID,
        status: "active",
      }),
    );
  });

  it("멤버는 자기 프로젝트 미션을 삭제할 수 있다 — MissionsTab.tsx:268 handleDelete", async () => {
    // ★delete 를 `if false` 로 잠갔다면 이 테스트가 깨진다. 그래서 못 잠갔다.
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "missions", "mission-ours")));
  });

  it("owner 도 미션을 삭제할 수 있다 — MissionsTab.tsx:301 handleClearArchive 일괄정리", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "missions", "mission-ours")));
  });

  it("타 테넌트 멤버는 자기 테넌트 미션을 정상적으로 다룰 수 있다 (경계는 대칭이다)", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertSucceeds(
      updateDoc(doc(db, "missions", "mission-other-tenant"), {
        status: "completed",
      }),
    );
    await assertSucceeds(
      deleteDoc(doc(db, "missions", "mission-other-tenant")),
    );
  });
});

describe("cost_logs — 크로스테넌트 read 격리", () => {
  it("프로젝트 멤버는 자기 프로젝트 비용로그를 읽을 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(getDoc(doc(db, "cost_logs", "cost-ours")));
  });

  it("★멤버라도 타 테넌트 비용로그는 읽을 수 없다 (옛 룰에선 뚫렸음)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "cost_logs", "cost-other-tenant")));
  });

  it("★외부인은 우리 비용로그를 읽을 수 없다", async () => {
    const db = getContext(OUTSIDER_ID, OUTSIDER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "cost_logs", "cost-ours")));
  });

  it("미인증 사용자는 비용로그를 읽을 수 없다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "cost_logs", "cost-ours")));
  });

  it("★projectId 없는 구 비용로그는 아무도 못 읽는다 (fail-closed)", async () => {
    const member = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(member, "cost_logs", "cost-legacy-no-project")));
    const admin = adminContext().firestore();
    await assertFails(getDoc(doc(admin, "cost_logs", "cost-legacy-no-project")));
  });

  it("★projectId 스코프 쿼리는 통과한다 (인덱스가 전제하는 모양)", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, "cost_logs"), where("projectId", "==", PROJECT_ID)),
      ),
    );
  });

  it("★무스코프 전체 조회는 거부된다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDocs(query(collection(db, "cost_logs"))));
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

// ===== 팀 오버뷰 캐시 — ★서버 전용 티어 (#1103 설계 §5.5) =====
//
// 이 문서에는 프로젝트 전체의 **멤버별 사용량 숫자**가 들어 있다. 클라 읽기를
// 여는 순간 `getTeamUsageSummary` 콜러블의 역할 게이트(오너/admin 만 팀 분해)가
// 통째로 우회되고, 일반 멤버가 남의 사용량을 본다 — 그건 팀 기능이 아니라 감시다.
//
// ★오너도 못 읽는다. "오너는 어차피 콜러블로 볼 수 있으니 룰도 열자" 가 가장
//   그럴듯한 실수인데, 룰을 열면 **역할 판정 자체가 클라로 내려간다.**
//   서버는 Admin SDK 로 룰을 우회해 읽으므로 여는 이득이 없고 위험만 는다.

describe("teamUsageCache — 서버 전용 티어 (클라는 누구도 못 읽는다)", () => {
  const CACHE_DOC_ID = `${PROJECT_ID}__d30@2026-08-21`;

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "teamUsageCache", CACHE_DOC_ID), {
        schemaVersion: 1,
        gateEffectiveFrom: null,
        windowKey: "d30@2026-08-21",
        generatedAtMs: 0,
        expiresAtMs: 0,
        rows: [],
      });
    });
  });

  it("★오너도 읽지 못한다 — 역할 판정은 서버 콜러블에만 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("★admin 도 읽지 못한다", async () => {
    const db = getContext(ADMIN_ID, ADMIN_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("★일반 멤버는 당연히 읽지 못한다 — 남의 사용량을 보는 길이 없다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertFails(getDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("★플랫폼 admin 클레임으로도 열리지 않는다", async () => {
    const db = adminContext().firestore();
    await assertFails(getDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("미인증도 못 읽는다", async () => {
    const db = unauthContext().firestore();
    await assertFails(getDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("★쓰기도 전부 막혀 있다 — 클라가 캐시를 조작해 숫자를 바꿀 수 없다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      setDoc(doc(db, "teamUsageCache", "forged__d30@2026-08-21"), {
        schemaVersion: 1,
        rows: [],
      }),
    );
    await assertFails(
      updateDoc(doc(db, "teamUsageCache", CACHE_DOC_ID), { rows: [] }),
    );
    await assertFails(deleteDoc(doc(db, "teamUsageCache", CACHE_DOC_ID)));
  });

  it("열거(list)도 막혀 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(getDocs(collection(db, "teamUsageCache")));
  });
});

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

// ===== 프로젝트 스코프 쿼리 규율 (티켓 4ov5wbQZ25XUXHZVhxdh) =====
//
// "task 상태쓰기가 Missing or insufficient permissions" 의 진짜 원인은 룰 드리프트도
// 토큰 만료도 아니라 **쿼리에 projectId 가 빠진 것**이었다.
//
// Firestore 는 list(쿼리)를 문서별로 판정하지 않는다 — 쿼리 제약식만으로 룰을 증명할
// 수 있어야 한다("security rules are not filters"). tasks/agents/flows 의 read 룰이
// isProjectMember(resource.data.projectId) 인 이상, projectId 를 == 로 고정하지 않은
// 쿼리는 결과가 전부 자기 프로젝트여도 통째로 거부된다. 에뮬레이터 원문 에러:
//   "Property projectId is undefined on object. for 'list'"
//
// 아래 테스트가 이 불변식을 고정한다. 실패하면 그건 룰이 이상해진 게 아니라 누군가
// 무스코프 쿼리를 되살렸다는 뜻이다 (electron/mcp-server/project-scope.ts 참조).

describe("프로젝트 스코프 쿼리 규율 — 무스코프 list 는 거부", () => {
  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tasks", "scoped-task"), {
        projectId: PROJECT_ID,
        title: "Scoped",
        status: "TODO",
        missionId: "mission-x",
        contextId: "mission-x",
        claimedBy: "agent-dead",
        dependsOn: ["task-1"],
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  });

  it("tasks: projectId 를 고정하지 않은 쿼리는 거부된다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(collection(db, "tasks"), where("missionId", "==", "mission-x")),
      ),
    );
  });

  it("tasks: projectId 를 고정하면 같은 쿼리가 통과한다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "tasks"),
          where("projectId", "==", PROJECT_ID),
          where("missionId", "==", "mission-x"),
        ),
      ),
    );
  });

  it("tasks: claimedBy 단독 쿼리(죽은 클레임 해제 경로)는 거부, projectId 동반이면 통과", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(collection(db, "tasks"), where("claimedBy", "==", "agent-dead")),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "tasks"),
          where("projectId", "==", PROJECT_ID),
          where("claimedBy", "==", "agent-dead"),
        ),
      ),
    );
  });

  it("tasks: dependsOn array-contains(의존 해소 경로)도 projectId 가 있어야 통과", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(
      getDocs(
        query(
          collection(db, "tasks"),
          where("dependsOn", "array-contains", "task-1"),
        ),
      ),
    );
    await assertSucceeds(
      getDocs(
        query(
          collection(db, "tasks"),
          where("projectId", "==", PROJECT_ID),
          where("dependsOn", "array-contains", "task-1"),
        ),
      ),
    );
  });

  it("agents / flows 도 같은 규율", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertFails(getDocs(collection(db, "agents")));
    await assertSucceeds(
      getDocs(
        query(collection(db, "agents"), where("projectId", "==", PROJECT_ID)),
      ),
    );
    await assertFails(getDocs(collection(db, "flows")));
    await assertSucceeds(
      getDocs(
        query(collection(db, "flows"), where("projectId", "==", PROJECT_ID)),
      ),
    );
  });

  it("activities 는 taskId 로 증명되므로 projectId 없이도 통과(대조군)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await assertSucceeds(
      getDocs(
        query(collection(db, "activities"), where("taskId", "==", "task-1")),
      ),
    );
  });
});

// ===== 상태전이 권한 회귀 (티켓 4ov5wbQZ25XUXHZVhxdh) =====
//
// 오케(=프로젝트 owner uid 로 인증한 MCP)와 에이전트가 실제로 쓰는 전이 전 구간이
// 룰을 통과하는지 — applyProjection 의 진짜 코드경로로 검증한다. 순수 룰 테스트만으론
// 이 버그를 못 잡았다: 거부된 건 write 가 아니라 write 직전의 **읽기 쿼리**였다.

describe("task 상태전이 — applyProjection 실제 경로", () => {
  const MISSION_ID = "mission-live";

  beforeEach(async () => {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      // ★프로덕션 재현 조건: 미션 컨텍스트 + mission.projection 미초기화
      // (실제 27CNOI0pdxvsSjVwuB3x 가 projection: null 이었다)
      await setDoc(doc(db, "missions", MISSION_ID), {
        projectId: PROJECT_ID,
        status: "active",
        goal: "live mission",
        taskIds: ["mission-task"],
      });
      await setDoc(doc(db, "tasks", "mission-task"), {
        projectId: PROJECT_ID,
        missionId: MISSION_ID,
        contextId: MISSION_ID,
        title: "Mission Task",
        status: "CLAIMED",
        claimedBy: "agent-1",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
  });

  it("오케(owner)가 미션 태스크를 CLAIMED→IN_PROGRESS→REVIEW→DONE 로 전이할 수 있다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    for (const status of ["IN_PROGRESS", "REVIEW", "DONE"] as const) {
      await applyProjection(db as never, "mission-task", {
        newStatus: status,
        lastAgentId: "orchestrator",
        lastActivitySummary: `→ ${status}`,
      });
    }
    const after = await getDoc(doc(db, "tasks", "mission-task"));
    expect(after.data()?.status).toBe("DONE");
  });

  it("에이전트 자기 클레임 태스크의 add_activity 가 미션 컨텍스트에서도 성공한다", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await applyProjection(db as never, "mission-task", {
      lastAgentId: "agent-1",
      lastActivitySummary: "작업 진행중",
      activityPayload: { agentId: "agent-1", message: "작업 진행중" },
    });
    const after = await getDoc(doc(db, "tasks", "mission-task"));
    expect(after.data()?.projection?.lastActivitySummary).toBe("작업 진행중");
  });

  it("미션 statusCounts 가 실제로 seed 된다(스코프 쿼리가 통과했다는 증거)", async () => {
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await applyProjection(db as never, "mission-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });
    const mission = await getDoc(doc(db, "missions", MISSION_ID));
    expect(mission.data()?.projection?.statusCounts?.IN_PROGRESS).toBe(1);
  });

  it("아직 seed 되지 않은 미션의 TODO 태스크도 전이가 커밋된다", async () => {
    // 부기(미션 카운트 seed) 실패가 상태 write 를 죽이면 task_outcomes 가 유실되고
    // 스폰모델 학습축이 손상된다. seed 는 건너뛰되 전이는 반드시 커밋돼야 한다.
    //
    // ★주의(티켓 7PL9wQ2H): 이 케이스는 fixture 가 projectId 를 갖고 있으므로
    // "projectId 없는 손상 문서" 분기(= seed skip + console.error)를 타지 않는다.
    // 룰 아래에서는 그 분기를 재현할 수 없다 — projectId 없는 tasks 문서는
    // isProjectMember(resource.data.projectId) 때문에 seed 이전의 getDoc(taskRef)
    // 에서 먼저 거부되기 때문이다. 진짜 fail-open 분기는 인메모리 mock 을 쓰는
    // tests/unit/projection.test.ts 의 "projectId 없는 손상 태스크: seed 는
    // 건너뛰되 상태 전이는 커밋된다" 가 덮는다.
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tasks", "orphan-task"), {
        projectId: PROJECT_ID, // 룰 통과용 (문서 write 는 스코프 필요 없음)
        missionId: MISSION_ID,
        contextId: MISSION_ID,
        title: "Orphan",
        status: "TODO",
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    });
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();
    await applyProjection(db as never, "orphan-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });
    const after = await getDoc(doc(db, "tasks", "orphan-task"));
    expect(after.data()?.status).toBe("IN_PROGRESS");
  });
});

// ===== #851 인과 고정 — 왜 "미션 컨텍스트 + projection 미초기화" 만 실패했나 =====
// (티켓 7PL9wQ2HTwrIuZ4CpsEy — #851 의 독립 재현·확증에서 나온 갭)
//
// #851 은 간헐성을 "그 seed 는 미션 컨텍스트 + mission.projection 미초기화일 때만
// 돈다. board 컨텍스트 티켓은 이 경로를 아예 안 탄다"로 설명했다
// (실패 OByWwm5i → contextId=missionId=27CNOI0pdxvs / 성공 ekRjwRFS → contextId="board").
// 그런데 회귀 가드는 실패하는 칸만 덮고 있었다 — 통과하던 칸이 왜 통과했는지는
// 아무것도 고정하지 않아서, 누가 seed 진입 조건을 넓히면(예: board 도 미션 취급,
// 또는 projection 초기화 여부와 무관하게 재계산) 조용히 프로덕션 결함이 되살아난다.
//
// 아래가 진입 조건 2x2 를 통째로 못 박는다. projection.ts 를 3d0e6b9d 이전으로
// 되돌리고 실측한 결과:
//
//   컨텍스트          projection      수정 전     수정 후
//   ----------------------------------------------------
//   board             n/a             GREEN      GREEN
//   lane:*            n/a             GREEN      GREEN
//   mission           초기화됨         GREEN      GREEN
//   mission           미초기화        ★RED       GREEN   ← 진범 칸
//
// 즉 red 는 정확히 한 칸에서만 난다. 그게 #851 의 인과 주장이고, 이 describe 가
// 그 주장 자체를 회귀 테스트로 만든다.

describe("#851 인과 — seed 경로 진입 조건 2x2 (missionIdFromTaskContext)", () => {
  const MISSION_ID = "mission-causal";

  async function seedTask(
    taskId: string,
    fields: Record<string, unknown>,
  ): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "tasks", taskId), {
        projectId: PROJECT_ID,
        title: taskId,
        status: "CLAIMED",
        claimedBy: "agent-1",
        createdAt: new Date(),
        updatedAt: new Date(),
        ...fields,
      });
    });
  }

  async function seedMission(fields: Record<string, unknown>): Promise<void> {
    await testEnv.withSecurityRulesDisabled(async (context) => {
      const db = context.firestore();
      await setDoc(doc(db, "missions", MISSION_ID), {
        projectId: PROJECT_ID,
        status: "active",
        goal: "causal matrix",
        ...fields,
      });
    });
  }

  it("board 컨텍스트: seed 경로를 아예 타지 않는다 (수정 전에도 통과했던 이유)", async () => {
    // 이 케이스는 수정 전에도 GREEN 이다. 그게 핵심 — 같은 오케·같은 룰·같은
    // 인증인데 board 티켓만 멀쩡했던 건 무스코프 쿼리를 쏘지 않았기 때문이지
    // 권한이 달라서가 아니었다.
    await seedTask("board-task", { contextId: "board" });
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();

    await applyProjection(db as never, "board-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });

    const after = await getDoc(doc(db, "tasks", "board-task"));
    expect(after.data()?.status).toBe("IN_PROGRESS");
  });

  it("lane 컨텍스트(lane:*): 마찬가지로 seed 경로 밖", async () => {
    await seedTask("lane-task", { contextId: "lane:quick-1" });
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();

    await applyProjection(db as never, "lane-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });

    const after = await getDoc(doc(db, "tasks", "lane-task"));
    expect(after.data()?.status).toBe("IN_PROGRESS");
  });

  it("미션 컨텍스트 + projection 이미 초기화됨: seed 를 건너뛰고 delta 로만 간다", async () => {
    // 이 칸도 수정 전에 GREEN 이었다 — statusCounts 가 이미 있으면 재계산 쿼리를
    // 안 쏘기 때문. "미션 티켓이면 항상 실패"가 아니라 "미션 티켓 중 첫 전이만
    // 실패"였다는 뜻이고, 그래서 간헐로 보였다.
    await seedMission({
      projection: { statusCounts: { CLAIMED: 1, TODO: 1 } },
    });
    await seedTask("seeded-mission-task", {
      missionId: MISSION_ID,
      contextId: MISSION_ID,
    });
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();

    await applyProjection(db as never, "seeded-mission-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });

    const after = await getDoc(doc(db, "tasks", "seeded-mission-task"));
    expect(after.data()?.status).toBe("IN_PROGRESS");
    // delta 경로: CLAIMED -1, IN_PROGRESS +1. TODO 는 건드리지 않는다.
    const mission = await getDoc(doc(db, "missions", MISSION_ID));
    expect(mission.data()?.projection?.statusCounts).toEqual({
      CLAIMED: 0,
      IN_PROGRESS: 1,
      TODO: 1,
    });
  });

  it("★진범 칸 — missionId 필드 없이 contextId 만 미션인 태스크도 스코프 쿼리로 seed 된다", async () => {
    // 프로덕션 실패 문서(27CNOI0pdxvs)는 contextId=missionId 였다. 그런데 기존
    // 가드의 fixture 는 둘 다 채워 두어서 missionId 가 우선 반환된다
    // (missionIdFromTaskContext 는 task.missionId 를 먼저 본다). 즉 "contextId
    // 로만 미션이 식별되는" 분기는 어떤 테스트도 통과하지 않았다.
    // ★projection.ts 를 3d0e6b9d 이전으로 되돌리면 이 테스트는 프로덕션과 똑같이
    //   "FirebaseError: Property projectId is undefined on object. for 'list'" 로 실패한다.
    await seedMission({}); // projection 미초기화 — 진범 조건
    await seedTask("ctx-only-task", { contextId: MISSION_ID });
    await seedTask("ctx-only-sibling", {
      contextId: MISSION_ID,
      status: "TODO",
      claimedBy: null,
    });
    const db = getContext(OWNER_ID, OWNER_EMAIL).firestore();

    await applyProjection(db as never, "ctx-only-task", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
    });

    const after = await getDoc(doc(db, "tasks", "ctx-only-task"));
    expect(after.data()?.status).toBe("IN_PROGRESS");
    // seed 가 sibling 둘을 다 읽었다({CLAIMED:1, TODO:1})는 게 contextId 쿼리가
    // 실제로 룰을 통과했다는 증거다. 그 위에 CLAIMED→IN_PROGRESS delta 가 얹힌다.
    // 쿼리가 거부됐다면 fail-open 으로 seed 가 비어 TODO 가 통째로 사라진다.
    const mission = await getDoc(doc(db, "missions", MISSION_ID));
    expect(mission.data()?.projection?.statusCounts).toEqual({
      TODO: 1,
      CLAIMED: 0,
      IN_PROGRESS: 1,
    });
  });
});
