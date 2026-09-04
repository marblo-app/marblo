/**
 * 프로젝트 귀속 쓰기 = 역할·플랜 게이트 — 소스 스캔 가드 (티켓 RwWV5d0dQ8EbDPITp7Ve, F3).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 무엇이 갈라졌었나
 * ─────────────────────────────────────────────────────────────────────────
 * 역할 게이트(`canWriteTasks`, 지금의 `canWriteProjectScoped`)가 tasks 블록
 * **하나에만** 걸려 있었다. 나머지 프로젝트 귀속 컬렉션은 전부 평문
 * `isProjectMember` 라, 감사 PR #1378 프로브 A 실측에서 viewer 가
 * chatMessages · taskComments · flows · agents · botDefinitions ·
 * pendingInstructions · activities 에 **전부 쓰기 성공**했다(대조군 /tasks 만 거부).
 * 그 중 pendingInstructions 는 남의 기기에서 도는 에이전트 PTY 에 문자열을
 * 주입하는 큐다 — "읽기 전용"으로 초대한 사람이 타인의 기기에서 코드를 돌린다.
 * 같은 이유로 플랜 게이트(#1353)도 이 컬렉션들에 미적용이었다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * 왜 에뮬레이터 테스트만으로 부족한가 — 이 파일이 존재하는 이유
 * ─────────────────────────────────────────────────────────────────────────
 * `firestore.rules.test.ts` 는 "**지금 있는** 컬렉션에서 viewer 가 막히는가"를
 * 확인한다. 그런데 이 사고의 본질은 "컬렉션이 하나 늘 때 게이트를 빠뜨린 것"
 * 이고, 새 컬렉션용 케이스는 아무도 안 써 준다 — 정확히 그래서 7개가 한꺼번에
 * 열려 있었다. 다음번에 또 빠지지 않게 하려면 **목록 자체**를 고정해야 한다.
 *
 * ★룰 문법으로는 "기본 게이트"를 만들 수 없다(불가능의 근거):
 *   Firestore 의 allow 는 **합집합**이다. 여러 match 가 걸리면 하나라도 허용하면
 *   허용이다. 그래서 `match /{col}/{doc} { allow write: if <게이트> }` 같은
 *   와일드카드로 "모든 컬렉션에 기본 제한"을 걸 수 없다 — 넓은 규칙은 좁은 규칙을
 *   **좁히지 못하고 더 열기만 한다**. 룰 파일 안에서 "새 컬렉션이 자동으로
 *   게이트를 탄다"를 강제하는 문법은 존재하지 않는다.
 *   → 차선: 판정은 룰 안 함수 하나(`canWriteProjectScoped`)로 모으고, **빠뜨림은
 *     여기 소스 스캔이 잡는다.** 아래 스냅샷 두 개가 그 역할이다:
 *       (1) match 경로 전수 목록 — 컬렉션이 늘면 무조건 깨진다.
 *       (2) 쓰기 op 별 분류표 — 게이트를 빼면 무조건 깨진다.
 *     둘 다 "고쳐야 통과"라서, 새 컬렉션은 **리뷰를 거쳐야만** 목록에 들어온다.
 *
 * 이 테스트가 깨졌을 때 할 일: 새 컬렉션이 프로젝트 귀속 쓰기를 가진다면
 * `canWriteProjectScoped(projectId)`(태스크 귀속이면 `canWriteTaskScopedDoc(taskId)`)
 * 를 태우고 아래 표에 GATED 로 추가한다. 게이트를 태우지 않을 근거가 있다면
 * EXCEPTIONS 에 **사유와 함께** 넣는다 — 사유 없는 예외는 이 파일이 거부한다.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const V3_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../..",
);

/** 주석은 판정에서 제외한다 — 주석 안의 `isProjectMember` 가 분류를 오염시킨다. */
const RULES_SRC = readFileSync(path.join(V3_DIR, "firestore.rules"), "utf8")
  .split("\n")
  .map((line) => line.replace(/\/\/.*$/, ""))
  .join("\n");

type Classification =
  | "GATED" // canWriteProjectScoped / canWriteTaskScopedDoc 를 탄다
  | "MEMBER_ONLY" // 평문 isProjectMember / isTaskProjectMember — ★이 사고의 모양
  | "ADMIN" // isAdminOrOwner 등 더 좁은 게이트
  | "CLOSED" // if false
  | "OTHER"; // 그 외(원장 create=isAuthenticated, 본인 문서 등)

interface WriteClause {
  matchPath: string;
  /** 한 allow 절이 여러 op 를 묶을 수 있다: `allow create, update:` */
  ops: string;
  classification: Classification;
}

const WRITE_OPS = new Set(["create", "update", "delete", "write"]);

/** `match <경로> {` 헤더부터 중괄호 균형이 맞는 지점까지. */
function blockOf(source: string, headerStart: number, header: string): string {
  const bodyStart = headerStart + header.lastIndexOf("{");
  let depth = 0;
  for (let i = bodyStart; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}") {
      depth--;
      if (depth === 0) return source.slice(headerStart, i + 1);
    }
  }
  throw new Error(`'${header}' 블록의 중괄호가 닫히지 않았다`);
}

function classify(clause: string): Classification {
  if (
    clause.includes("canWriteProjectScoped(") ||
    clause.includes("canWriteTaskScopedDoc(")
  ) {
    return "GATED";
  }
  if (/\bif\s+false\b/.test(clause)) return "CLOSED";
  if (
    clause.includes("isProjectMember(") ||
    clause.includes("isTaskProjectMember(")
  ) {
    return "MEMBER_ONLY";
  }
  if (
    clause.includes("isAdminOrOwner(") ||
    clause.includes("isProjectOwner(") ||
    clause.includes("canManagePublicReplay(")
  ) {
    return "ADMIN";
  }
  return "OTHER";
}

/**
 * 중첩된 하위 match 블록을 지운 "그 블록 자신의" 본문.
 *
 * ★없으면 오분류한다: `/projects/{projectId}` 안에 `assistantWebhookEvents` 가
 * 중첩돼 있어, 그냥 스캔하면 자식의 allow 절이 부모 것으로도 집계된다
 * (`/projects update` 가 MEMBER_ONLY 와 GATED 로 동시에 잡혔다).
 */
function ownBody(block: string): string {
  const header = /^[ \t]*match[ \t]+\S+[ \t]*\{[ \t]*$/m.exec(block);
  let body = block;
  // 첫 줄(자기 헤더)을 지난 뒤부터 등장하는 match 헤더가 자식이다.
  const offset = header ? header.index + header[0].length : 0;
  for (;;) {
    const child = /^[ \t]*match[ \t]+\S+[ \t]*\{[ \t]*$/m.exec(
      body.slice(offset),
    );
    if (!child) return body;
    const start = offset + child.index;
    const sub = blockOf(body, start, child[0]);
    body = body.slice(0, start) + body.slice(start + sub.length);
  }
}

/** firestore.rules 의 모든 match 블록에서 쓰기 allow 절을 뽑아 분류한다. */
function scanWriteClauses(): WriteClause[] {
  const headers = [
    ...RULES_SRC.matchAll(/^[ \t]*match[ \t]+(\S+)[ \t]*\{[ \t]*$/gm),
  ];
  const found: WriteClause[] = [];
  for (const h of headers) {
    const matchPath = h[1];
    if (matchPath.startsWith("/databases")) continue;
    const block = ownBody(blockOf(RULES_SRC, h.index!, h[0]));
    const clauses = [...block.matchAll(/allow\s+([\w\s,]+?)\s*:/g)];
    clauses.forEach((c, i) => {
      const ops = c[1]
        .split(",")
        .map((o) => o.trim())
        .filter((o) => WRITE_OPS.has(o));
      if (ops.length === 0) return;
      const end = i + 1 < clauses.length ? clauses[i + 1].index! : block.length;
      const body = block.slice(c.index! + c[0].length, end);
      found.push({
        matchPath,
        ops: ops.join(","),
        classification: classify(body),
      });
    });
  }
  return found;
}

// ─────────────────────────────────────────────────────────────────────────
// (1) match 경로 전수 스냅샷 — 컬렉션이 늘면 무조건 깨진다.
//     "새 컬렉션은 기본으로 게이트를 탄다"를 룰 문법으로 못 만드는 대신,
//     "새 컬렉션은 기본으로 이 테스트를 깬다"로 강제한다.
// ─────────────────────────────────────────────────────────────────────────
const KNOWN_MATCH_PATHS = [
  "/activities/{activityId}",
  "/agents/{agentId}",
  "/assistantWebhookEvents/{eventId}",
  "/assistant_webhook_secrets/{webhookId}",
  "/audit_logs/{logId}",
  "/betatester50_waitlist/{doc}",
  "/botDefinitions/{botId}",
  "/bugReportThrottle/{uid}",
  "/bugReports/{reportId}",
  "/chatMessages/{messageId}",
  "/consent_events/{eventId}",
  "/cost_logs/{logId}",
  "/couponRedemptions/{redemptionId}",
  "/coupons/{couponCode}",
  "/flows/{flowId}",
  "/founder_feedback/{feedbackId}",
  "/founders/{email}",
  "/github_app_access_logs/{logId}",
  "/github_app_setup_states/{stateId}",
  "/invitations/{invitationId}",
  "/lecturePurchases/{purchaseId}",
  "/lectures/{lectureId}",
  "/lectures_progress/{progressId}",
  "/ledger_checkpoints/{checkpointId}",
  "/marketing_contacts/{contactId}",
  "/memberRoles/{docId}",
  "/merge_history/{mergeId}",
  "/missions/{missionId}",
  "/org_invitations/{invitationId}",
  "/org_members/{memberId}",
  "/org_name_history/{entryId}",
  "/org_project_bindings/{bindingId}",
  "/org_teams/{teamId}",
  "/organizations/{orgId}",
  "/pauseReasons/{uid}",
  "/pendingInstructions/{instId}",
  "/presence/{projectId}/users/{userId}",
  "/projectAuditLog/{eventId}",
  "/projects/{projectId}",
  "/publicReplayOwners/{replayId}",
  "/publicReplays/{replayId}",
  "/push_tokens/{tokenId}",
  "/subscriptions/{userId}",
  "/taskComments/{commentId}",
  "/tasks/{taskId}",
  "/teamUsageCache/{docId}",
  "/telemetry_events/{eventId}",
  "/users/{userId}",
  "/workChains/{projectId}",
];

// ─────────────────────────────────────────────────────────────────────────
// (2) 쓰기 op 분류표 — 게이트를 빼면 무조건 깨진다.
//     GATED 여야 하는 것들. `<match 경로> <ops>` 키.
// ─────────────────────────────────────────────────────────────────────────
const MUST_BE_GATED = [
  "/assistantWebhookEvents/{eventId} update", // 웹훅 이벤트 소비(=오케 실행 트리거) 클레임
  "/activities/{activityId} create", // 태스크 귀속 — canWriteTaskScopedDoc
  "/agents/{agentId} create",
  "/agents/{agentId} update",
  "/agents/{agentId} delete",
  "/botDefinitions/{botId} create",
  "/botDefinitions/{botId} update",
  "/botDefinitions/{botId} delete",
  "/chatMessages/{messageId} create",
  "/flows/{flowId} create",
  "/flows/{flowId} update",
  "/flows/{flowId} delete",
  "/missions/{missionId} create",
  "/missions/{missionId} update",
  "/missions/{missionId} delete",
  "/pendingInstructions/{instId} create", // ★PTY 주입 큐 — 이 티켓에서 가장 날카로운 문
  "/pendingInstructions/{instId} update", // 전달 표시 전이. 여기가 열리면 viewer 가
  //                                          지시를 "전달됨"으로 눌러 **묵살**할 수 있다.
  "/taskComments/{commentId} create",
  "/tasks/{taskId} create",
  "/tasks/{taskId} update",
  "/tasks/{taskId} delete",
  "/workChains/{projectId} create",
  "/workChains/{projectId} update",
];

// ─────────────────────────────────────────────────────────────────────────
// (3) 게이트를 타지 않는 프로젝트 멤버 쓰기 — **사유 필수**.
//     여기 없는 MEMBER_ONLY 가 하나라도 생기면 테스트가 깨진다.
// ─────────────────────────────────────────────────────────────────────────
const EXCEPTIONS: Record<string, string> = {
  "/presence/{projectId}/users/{userId} create,update":
    "접속 표시는 협업 산출물이 아니라 liveness 다. viewer 도 팀에게 '보고 있음'으로 " +
    "보여야 한다(PresenceIndicator). 본인 문서만 쓰고 userId 위조는 이미 막혀 있다.",
  "/projectAuditLog/{eventId} create":
    "사람 행위 감사의 기록면. 감사를 '감사 대상 게이트'에 종속시키지 않는다 — 쓰기 " +
    "게이트가 오작동하는 순간이 기록이 가장 필요한 순간이다. 이 파일의 원장 계열이 " +
    "create 를 isAuthenticated 로 열어 둔 것과 같은 자세이며, actorUid == " +
    "request.auth.uid 로 사칭은 이미 막혀 있다.",
  "/projects/{projectId} update":
    "필드 allowlist 로 이미 좁다(folderPath/folderPaths/gitRemoteUrl/telegramChannel/" +
    "enabledModels/updatedAt). folderPaths 는 '이 기기의 로컬 경로' 등록이라 viewer 도 " +
    "자기 칸을 써야 앱이 프로젝트를 연다. 관리자 티어 필드(name/kind/members/" +
    "assistantTriggers)는 같은 절에서 isAdminOrOwner 로 이미 분리돼 있다. " +
    "★후속 검토 대상: 이 절을 역할축으로 더 좁힐지는 별건이다(#1378 프로브 A 미검출).",
};

describe("프로젝트 귀속 쓰기 — 역할·플랜 게이트 전수 적용 (F3)", () => {
  const clauses = scanWriteClauses();

  it("firestore.rules 의 match 경로 목록이 스냅샷과 같다 — 컬렉션이 늘면 여기서 잡힌다", () => {
    const paths = [...new Set(clauses.map((c) => c.matchPath))];
    // 쓰기 절이 아예 없는 블록도 있으므로 헤더에서 직접 다시 모은다.
    const allPaths = [
      ...new Set(
        [...RULES_SRC.matchAll(/^[ \t]*match[ \t]+(\S+)[ \t]*\{[ \t]*$/gm)]
          .map((m) => m[1])
          .filter((p) => !p.startsWith("/databases")),
      ),
    ].sort();
    expect(paths.length).toBeGreaterThan(0);
    expect(allPaths).toEqual([...KNOWN_MATCH_PATHS].sort());
  });

  it("게이트를 타야 하는 쓰기 op 이 전부 canWriteProjectScoped 를 탄다", () => {
    const gated = clauses
      .filter((c) => c.classification === "GATED")
      .map((c) => `${c.matchPath} ${c.ops}`)
      .sort();
    expect(gated).toEqual([...MUST_BE_GATED].sort());
  });

  it("평문 isProjectMember 로 남은 쓰기는 EXCEPTIONS 에 사유와 함께 있는 것뿐이다", () => {
    const memberOnly = clauses
      .filter((c) => c.classification === "MEMBER_ONLY")
      .map((c) => `${c.matchPath} ${c.ops}`)
      .sort();
    expect(memberOnly).toEqual(Object.keys(EXCEPTIONS).sort());
    // 사유 없는 예외는 예외가 아니라 빠뜨림이다.
    for (const [key, reason] of Object.entries(EXCEPTIONS)) {
      expect(reason.length, `${key} 의 예외 사유가 비어 있다`).toBeGreaterThan(
        40,
      );
    }
  });

  it("★pendingInstructions — PTY 주입 큐의 쓰기는 어떤 op 도 멤버십만으로 열리지 않는다", () => {
    // 이 티켓에서 가장 날카로운 문이라 별도로 못 박는다: 여기가 다시
    // isProjectMember 로 돌아가면 '읽기 전용' 초대자가 남의 기기에서 도는
    // 에이전트에 문자열을 주입할 수 있다.
    const pending = clauses.filter(
      (c) => c.matchPath === "/pendingInstructions/{instId}",
    );
    expect(pending.length).toBeGreaterThan(0);
    for (const c of pending) {
      expect(
        ["GATED", "CLOSED"],
        `pendingInstructions allow ${c.ops} 이 ${c.classification} 로 열렸다`,
      ).toContain(c.classification);
    }
  });

  it("read 는 어디서도 쓰기 게이트를 타지 않는다 — viewer 는 '읽기 전용'이지 '안 보임'이 아니다", () => {
    const headers = [
      ...RULES_SRC.matchAll(/^[ \t]*match[ \t]+(\S+)[ \t]*\{[ \t]*$/gm),
    ];
    for (const h of headers) {
      if (h[1].startsWith("/databases")) continue;
      const block = blockOf(RULES_SRC, h.index!, h[0]);
      const readClauses = [...block.matchAll(/allow\s+([\w\s,]+?)\s*:/g)];
      readClauses.forEach((c, i) => {
        const ops = c[1].split(",").map((o) => o.trim());
        // `allow read, write:` 처럼 쓰기가 섞인 절은 대상이 아니다.
        if (
          !ops.includes("read") &&
          !ops.includes("get") &&
          !ops.includes("list")
        ) {
          return;
        }
        if (ops.some((o) => WRITE_OPS.has(o))) return;
        const end =
          i + 1 < readClauses.length ? readClauses[i + 1].index! : block.length;
        const body = block.slice(c.index! + c[0].length, end);
        expect(
          body.includes("canWriteProjectScoped(") ||
            body.includes("canWriteTaskScopedDoc("),
          `${h[1]} allow ${c[1]} 이 쓰기 게이트를 탄다 — 읽기가 잠긴다`,
        ).toBe(false);
      });
    }
  });

  it("canWriteTaskScopedDoc 는 taskExists 로 fail-closed 를 유지한다", () => {
    // ★뮤테이션 검증에서 **유일하게 생존한 뮤턴트**라 여기서 소스로 못 박는다.
    //   `taskExists(taskId)` 를 지워도 에뮬레이터 테스트는 하나도 안 깨진다:
    //   없는 문서에 `getTask()` 를 부르면 룰 평가가 **던져서** 어차피 거부되기
    //   때문이다. 즉 결과(거부)는 같고 assertFails 는 둘을 구분하지 못한다.
    //   그래도 이 가드는 값을 한다 — 거부가 `false` 가 아니라 evaluation error
    //   로 기록되면 관측·디버깅이 오염된다(이 파일의 ownerHasTeamCollab 주석이
    //   같은 이유로 삼항을 쓴다). 행동으로 증명할 수 없는 불변식이라 소스로 고정한다.
    const fn = /function canWriteTaskScopedDoc\(taskId\)\s*\{[^}]*\}/.exec(
      RULES_SRC,
    );
    expect(fn, "canWriteTaskScopedDoc 가 없다").toBeTruthy();
    expect(fn![0]).toContain("taskExists(taskId)");
    expect(fn![0]).toContain("canWriteProjectScoped(");
  });

  it("단일 출처 — 역할/플랜 판정이 게이트 함수 밖에 복제돼 있지 않다", () => {
    // `!= 'viewer'` 와 `ownerHasTeamCollab(` 는 오직 게이트 함수 안에서만
    // 나와야 한다. 블록마다 손으로 붙이기 시작하면 다음 컬렉션에서 또 빠진다.
    const viewerChecks = [...RULES_SRC.matchAll(/!=\s*'viewer'/g)].length;
    expect(viewerChecks, "역할 판정이 두 곳 이상에 복제됐다").toBe(1);
    const planChecks = [...RULES_SRC.matchAll(/ownerHasTeamCollab\(/g)].length;
    // 정의 1 + canWriteProjectScoped 1 + invitations create 1 = 3.
    // (invitations 는 '신규 초대'라는 별도 초크포인트다 — #1353 이 둔 자리.)
    expect(planChecks, "플랜 게이트 호출부가 예상 밖에서 늘었다").toBe(3);
  });
});
