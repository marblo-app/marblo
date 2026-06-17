/**
 * Firestore Security Rules 테스트
 *
 * 실행 방법:
 *   1. Firebase Emulator 설치: npm install -g firebase-tools
 *   2. 에뮬레이터 시작: firebase emulators:start --only firestore
 *   3. 테스트 실행: npx vitest run firestore.rules.test.ts
 *
 * 또는 CI에서:
 *   firebase emulators:exec --only firestore "npx vitest run firestore.rules.test.ts"
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
  setDoc,
  updateDoc,
  deleteDoc,
  collection,
  addDoc,
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

function getContext(uid: string, email: string): RulesTestContext {
  return testEnv.authenticatedContext(uid, { email });
}

function unauthContext(): RulesTestContext {
  return testEnv.unauthenticatedContext();
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

    // 구독
    await setDoc(doc(db, "subscriptions", OWNER_ID), {
      plan: "pro",
      status: "active",
      currentPeriodEnd: new Date(),
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

  it("프로젝트 멤버는 태스크를 삭제할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(deleteDoc(doc(db, "tasks", "task-1")));
  });
});

// ===== Pending Instructions =====

describe("pendingInstructions collection", () => {
  it("인증된 사용자는 pending instruction을 생성할 수 있다", async () => {
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

  it("인증된 사용자는 delivery 마킹(isDelivered + deliveredAt)을 할 수 있다", async () => {
    const db = getContext(MEMBER_ID, MEMBER_EMAIL).firestore();
    await assertSucceeds(
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

// ===== Activities =====

describe("activities collection", () => {
  it("인증된 사용자는 활동 로그를 읽을 수 있다", async () => {
    // activities는 taskId를 참조하므로 cross-collection 체크가 제한적
    // 인증만 체크
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
