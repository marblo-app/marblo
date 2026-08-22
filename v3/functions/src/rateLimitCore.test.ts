// 발급 예산 단위검증 — node --test (npm run test:rate-limit).
//
// ★여기서 증명하는 것:
//   1. read 예산이 **v1 값 그대로**다 (20/시간, 6/분) — 이 티켓은 read 를
//      느슨하게 만들지 않는다.
//   2. write 예산이 **분리**돼 있고, 에이전트 주도 워크플로가 통과한다.
//      ★같은 트래픽이 v1 의 합쳐진 예산에서는 **막힌다** — 이 티켓의 존재 이유가
//      회귀 테스트로 박혀 있다.
//   3. 초과하면 거부되고(`allowed:false`), 정확히 N+1 번째에서 거부된다.
//   4. read/write 가 **다른 키**를 쓴다 — 같은 키면 두 예산이 한 배열을
//      갉아먹어 분리가 무의미해진다.
//   5. 분당 상한이 시간당 상한과 정합한다 — 시간당만 올리고 분당을 두면
//      버스트에서 여전히 막힌다.
//   6. ★**write push 가 실제로 write 예산을 쓴다** — 이 티켓의 유일한 성공
//      기준이다. 상수와 룰만 맞고 배선이 `"read"` 로 굳어 있으면 컴파일도
//      테스트도 통과하면서 **효과가 0**이다. 그 상태를 여기서 잡는다.

import * as assert from "node:assert/strict";
import { test } from "node:test";

import { decide, type RateDecision, type RateRule } from "./rateLimitCore";
import {
  evaluateInstallationTokenRequest,
  installationTokenBudgetFor,
  installationTokenRateKey,
  installationTokenRules,
  INSTALLATION_TOKEN_RULES_READ,
  INSTALLATION_TOKEN_RULES_WRITE,
  type AuthorizedIssueDecision,
  type ProjectSnapshotForIssue,
  type RepoAccess,
} from "./githubApp";

const T0 = 1_700_000_000_000; // 고정 기준시각. Date.now() 를 쓰지 않는다.
const SEC = 1000;
const MIN = 60 * SEC;

/**
 * 시각 목록을 순서대로 시도한다. 각 시도는 앞선 시도들의 결과 배열을 물려받아
 * `enforce()` 가 Firestore 로 하는 것과 **같은 상태 전이**를 만든다.
 */
function replay(
  atMs: number[],
  rules: ReadonlyArray<RateRule>
): RateDecision[] {
  let attempts: number[] = [];
  const out: RateDecision[] = [];
  for (const t of atMs) {
    const d = decide(attempts, [...rules], t);
    attempts = d.attempts;
    out.push(d);
  }
  return out;
}

/** n 회를 `spacingMs` 간격으로 민다. */
function evenly(n: number, spacingMs: number, startMs = T0): number[] {
  return Array.from({ length: n }, (_, i) => startMs + i * spacingMs);
}

const hourlyMax = (rules: ReadonlyArray<RateRule>): number =>
  rules.find((r) => r.windowSeconds === 3600)!.max;
const minuteMax = (rules: ReadonlyArray<RateRule>): number =>
  rules.find((r) => r.windowSeconds === 60)!.max;

// ── 1. read 예산은 v1 그대로 ────────────────────────────────────────────────

test("★read 예산은 v1 값 그대로다 — 이 티켓은 read 를 느슨하게 하지 않는다", () => {
  // ★이 숫자가 바뀌면 테스트가 죽는다. read 상한을 올리는 변경은 의도적이어야
  // 하고, 이 티켓의 근거(read 는 횟수로 폭발 반경이 안 줄어든다)는 올릴 이유가
  // 되지 못한다 — 오히려 올릴 이유가 없다는 근거다.
  assert.deepEqual(
    [...INSTALLATION_TOKEN_RULES_READ],
    [
      { windowSeconds: 3600, max: 20 },
      { windowSeconds: 60, max: 6 },
    ]
  );
});

test("read: 시간당 20회까지 통과하고 21번째가 거부된다", () => {
  const rules = INSTALLATION_TOKEN_RULES_READ;
  const max = hourlyMax(rules); // 20
  // 분당 상한에 걸리지 않도록 30초 간격 — 시간당 상한만 시험한다.
  const results = replay(evenly(max + 1, 30 * SEC), rules);
  assert.equal(
    results.slice(0, max).every((r) => r.allowed),
    true
  );
  assert.equal(results[max].allowed, false);
  assert.equal(results[max].remaining, 0);
  assert.ok(results[max].retryAfter > 0);
});

test("read: 분당 6회까지 통과하고 7번째가 거부된다", () => {
  const rules = INSTALLATION_TOKEN_RULES_READ;
  const max = minuteMax(rules); // 6
  const results = replay(evenly(max + 1, 1 * SEC), rules);
  assert.equal(
    results.slice(0, max).every((r) => r.allowed),
    true
  );
  assert.equal(results[max].allowed, false);
});

test("read 정상 사용: 프로젝트 clone 은 사실상 1회 — 넉넉히 통과", () => {
  // v1 이 이 예산으로 충분했던 이유. clone 1 + 간헐적 fetch 몇 번.
  const results = replay(
    [T0, T0 + 10 * MIN, T0 + 25 * MIN],
    INSTALLATION_TOKEN_RULES_READ
  );
  assert.equal(
    results.every((r) => r.allowed),
    true
  );
});

// ── 2. write 예산 — 분리의 효과 ─────────────────────────────────────────────

test("★write 예산은 read 와 다르고, 더 크다", () => {
  assert.notDeepEqual(
    [...INSTALLATION_TOKEN_RULES_WRITE],
    [...INSTALLATION_TOKEN_RULES_READ]
  );
  assert.ok(
    hourlyMax(INSTALLATION_TOKEN_RULES_WRITE) >
      hourlyMax(INSTALLATION_TOKEN_RULES_READ)
  );
  assert.ok(
    minuteMax(INSTALLATION_TOKEN_RULES_WRITE) >
      minuteMax(INSTALLATION_TOKEN_RULES_READ)
  );
});

/**
 * ★이 티켓의 회귀 테스트.
 *
 * 에이전트 주도 워크플로 한 시간치 — 티켓 4건 × push 6회(최초 1 + 리베이스
 * 재시도 2 + 리뷰 반영 3) = 24회. 토큰 캐시가 없으므로 push 1회 = 발급 1회다.
 * 버스트도 재현한다: 각 티켓의 6회가 2분 안에 몰린다(리베이스 재시도 루프).
 */
function agentHour(): number[] {
  const out: number[] = [];
  for (let ticket = 0; ticket < 4; ticket++) {
    const base = T0 + ticket * 13 * MIN;
    for (let push = 0; push < 6; push++) out.push(base + push * 20 * SEC);
  }
  return out;
}

test("★write: 에이전트 워크플로 한 시간(티켓 4 × push 6 = 24회)이 통과한다", () => {
  const results = replay(agentHour(), INSTALLATION_TOKEN_RULES_WRITE);
  assert.equal(
    results.every((r) => r.allowed),
    true,
    `거부된 시도 ${results.filter((r) => !r.allowed).length}건`
  );
});

test("★같은 트래픽이 v1 의 합쳐진 예산에서는 막힌다 — 이 티켓의 존재 이유", () => {
  // v1 값(= 지금의 read 예산)으로 같은 24회를 돌리면 거부가 나온다.
  // 거부 = `resource-exhausted` = device 폴백 = 콜라보레이터 아닌 팀원 push 실패
  // = "팀원은 GitHub 초대가 필요 없다" 는 전제가 깨지는 지점.
  const results = replay(agentHour(), INSTALLATION_TOKEN_RULES_READ);
  assert.ok(
    results.some((r) => !r.allowed),
    "v1 예산에서 24회가 전부 통과하면 이 티켓의 전제가 틀린 것이다"
  );
});

test("write: 시간당 상한을 넘기면 거부된다 (초과 시 거부)", () => {
  const rules = INSTALLATION_TOKEN_RULES_WRITE;
  const max = hourlyMax(rules);
  // 분당 상한을 피하도록 넉넉히 벌린다 — 시간당 상한만 시험한다.
  const results = replay(evenly(max + 1, 30 * SEC), rules);
  assert.equal(
    results.slice(0, max).every((r) => r.allowed),
    true
  );
  assert.equal(results[max].allowed, false);
  assert.equal(results[max].remaining, 0);
});

test("write: 분당 상한을 넘기면 거부된다 (버스트 상한도 산다)", () => {
  const rules = INSTALLATION_TOKEN_RULES_WRITE;
  const max = minuteMax(rules);
  const results = replay(evenly(max + 1, 1 * SEC), rules);
  assert.equal(
    results.slice(0, max).every((r) => r.allowed),
    true
  );
  assert.equal(results[max].allowed, false);
});

// ── 3. 분당/시간당 정합 ─────────────────────────────────────────────────────

test("★분당 상한이 시간당 상한을 먼저 막지 않는다 — 시간당만 올리면 반쪽이다", () => {
  // 분당 상한 × 60 이 시간당 상한보다 커야, 실제 구속이 시간당 상한이고
  // 분당은 병리적 루프만 끊는 안전핀이 된다.
  for (const rules of [
    INSTALLATION_TOKEN_RULES_READ,
    INSTALLATION_TOKEN_RULES_WRITE,
  ]) {
    assert.ok(
      minuteMax(rules) * 60 > hourlyMax(rules),
      "분당 상한이 너무 낮아 시간당 예산을 다 쓰기 전에 버스트에서 막힌다"
    );
  }
});

test("★write 분당 상한은 v1(6/분) 보다 크다 — 에이전트는 연속으로 민다", () => {
  // 리베이스 재시도 루프가 1분 안에 3~4회, 동시 에이전트 2~3대.
  const burst = evenly(10, 5 * SEC);
  const results = replay(burst, INSTALLATION_TOKEN_RULES_WRITE);
  assert.equal(
    results.every((r) => r.allowed),
    true,
    "1분 안 10회 버스트가 막히면 에이전트 워크플로가 폴백으로 떨어진다"
  );
});

// ── 4. 창이 미끄러지면 다시 열린다 ──────────────────────────────────────────

test("시간당 상한을 채운 뒤 창이 지나면 다시 통과한다", () => {
  const rules = INSTALLATION_TOKEN_RULES_WRITE;
  const max = hourlyMax(rules);
  const filled = evenly(max, 30 * SEC);
  const blockedAt = filled[filled.length - 1] + 30 * SEC;

  const blocked = replay([...filled, blockedAt], rules);
  assert.equal(blocked[blocked.length - 1].allowed, false);

  // 거부된 시도까지 기록되므로 창 안에는 max+1 개가 있다. 다시 통과하려면
  // **둘 이상**이 창 밖으로 나가야 한다 — filled[1] 이 만료되는 시점을 잡는다.
  const afterWindow = filled[1] + 3600 * SEC + SEC;
  const reopened = replay([...filled, blockedAt, afterWindow], rules);
  assert.equal(reopened[reopened.length - 1].allowed, true);
});

// ── 5. 키 분리 — 두 예산이 같은 배열을 갉아먹지 않는다 ──────────────────────

test("★read 와 write 는 다른 키를 쓴다 — 같은 키면 분리가 무의미하다", () => {
  const readKey = installationTokenRateKey("uid-1", "proj-1", "read");
  const writeKey = installationTokenRateKey("uid-1", "proj-1", "write");
  assert.notEqual(readKey, writeKey);
  // uid·projectId 는 여전히 키에 들어간다 — 예산은 사람×프로젝트 단위다.
  assert.notEqual(readKey, installationTokenRateKey("uid-2", "proj-1", "read"));
  assert.notEqual(readKey, installationTokenRateKey("uid-1", "proj-2", "read"));
});

test("★read 예산을 다 써도 write 예산은 그대로다 (그리고 그 역도)", () => {
  // 버킷이 분리돼 있으므로 서로의 배열을 건드리지 않는다. 그 결과 지켜야 하는
  // 불변식: **read 예산으로는 write 토큰을 얻을 수 없다.**
  const readMax = hourlyMax(INSTALLATION_TOKEN_RULES_READ);
  const readBucket = replay(
    evenly(readMax + 1, 30 * SEC),
    INSTALLATION_TOKEN_RULES_READ
  );
  assert.equal(readBucket[readMax].allowed, false);

  // 같은 uid·projectId 의 write 버킷은 비어 있다.
  const writeBucket = replay([T0], INSTALLATION_TOKEN_RULES_WRITE);
  assert.equal(writeBucket[0].allowed, true);
});

test("installationTokenRules 가 접근 수준별로 올바른 예산을 준다", () => {
  assert.equal(installationTokenRules("read"), INSTALLATION_TOKEN_RULES_READ);
  assert.equal(installationTokenRules("write"), INSTALLATION_TOKEN_RULES_WRITE);
});

// ── 6. 예산 상수의 형태 ─────────────────────────────────────────────────────

test("두 예산 모두 시간당·분당 두 룰을 갖는다 (한쪽만 있으면 반쪽이다)", () => {
  for (const rules of [
    INSTALLATION_TOKEN_RULES_READ,
    INSTALLATION_TOKEN_RULES_WRITE,
  ]) {
    assert.equal(rules.length, 2);
    assert.equal(
      rules
        .map((r) => r.windowSeconds)
        .sort((a, b) => a - b)
        .join(","),
      "60,3600"
    );
    assert.equal(
      rules.every((r) => Number.isInteger(r.max) && r.max > 0),
      true
    );
  }
});

test("거부된 시도도 기록된다 — 문을 계속 두드려도 창이 미끄러지지 않는다", () => {
  const rules: RateRule[] = [{ windowSeconds: 60, max: 1 }];
  const first = decide([], rules, T0);
  assert.equal(first.allowed, true);
  const second = decide(first.attempts, rules, T0 + SEC);
  assert.equal(second.allowed, false);
  assert.equal(second.attempts.length, 2);
});

// ── 7. ★배선 — write push 가 정말 write 예산을 쓰는가 ───────────────────────
//
// 여기까지의 테스트는 전부 "예산 **값**이 맞는가" 였다. 그것만으로는 부족하다:
// v2 write 경로가 붙기 전, 발급 콜러블의 예산 선택은 `"read"` 리터럴로 굳어
// 있었고 — 위 테스트는 **전부 초록이었다.** write push 는 여전히 read 예산
// 20회/시간을 썼다. 아래는 그 구멍을 막는다.
//
// `installationTokenBudgetFor` 는 문자열이 아니라 **인가 판정 객체**를 받으므로,
// 아래 테스트는 "판정이 write 면 예산도 write" 를 판정 생성부터 끝까지 꿴다.

const TEAM_PLAN = "team";
const OWNER = "uid-owner";
const PUSHER = "uid-member";
const PROJECT = "proj-1";

function projectFixture(): ProjectSnapshotForIssue {
  return {
    exists: true,
    ownerId: OWNER,
    members: [OWNER, PUSHER],
    githubInstallationId: "12345678",
    gitRemoteUrl: "https://github.com/acme/widgets.git",
  };
}

/** 발급 콜러블이 하는 것과 같은 판정 → 같은 예산 선택. */
function budgetFor(
  memberRole: unknown,
  requestedAccess: RepoAccess,
  uid = PUSHER
): ReturnType<typeof installationTokenBudgetFor> {
  const decision = evaluateInstallationTokenRequest({
    uid,
    project: projectFixture(),
    ownerPlan: TEAM_PLAN,
    memberRole,
    requestedAccess,
  });
  assert.equal(decision.ok, true, `판정이 거부됐다: ${JSON.stringify(decision)}`);
  return installationTokenBudgetFor(uid, PROJECT, decision as AuthorizedIssueDecision);
}

test("★write push 는 write 예산을 쓴다 — 이 티켓의 성공 기준", () => {
  const budget = budgetFor("member", "write");

  // 룰이 write 예산이어야 한다. `INSTALLATION_TOKEN_RULES_READ` 면 이 티켓은
  // 아무것도 고치지 않은 것이다.
  assert.deepEqual(
    [...budget.rules],
    [...INSTALLATION_TOKEN_RULES_WRITE],
    "write 판정인데 read 예산이 선택됐다 — 배선이 죽어 있다(효과 0)"
  );
  // 키도 write 버킷이어야 한다. 룰만 write 이고 키가 read 면 두 예산이 한
  // 배열을 갉아먹어 분리가 무의미해진다.
  assert.equal(
    budget.key,
    installationTokenRateKey(PUSHER, PROJECT, "write"),
    "write 판정인데 read 버킷 키를 쓴다 — 두 예산이 같은 배열을 공유한다"
  );
});

test("★clone(read) 은 여전히 read 예산을 쓴다 — v1 동작 회귀 0", () => {
  const budget = budgetFor("member", "read");
  assert.deepEqual([...budget.rules], [...INSTALLATION_TOKEN_RULES_READ]);
  assert.equal(budget.key, installationTokenRateKey(PUSHER, PROJECT, "read"));
});

test("★write push 24회가 통과한다 — 판정에서 나온 예산을 그대로 쓴다", () => {
  // 위 `agentHour()` 와 같은 트래픽을, 이번에는 상수를 직접 고르지 않고
  // **판정이 고른 예산**으로 돌린다. 배선이 read 로 굳으면 여기서 거부가 난다.
  const budget = budgetFor("member", "write");
  const results = replay(agentHour(), budget.rules);
  assert.equal(
    results.every((r) => r.allowed),
    true,
    `판정이 고른 예산에서 ${results.filter((r) => !r.allowed).length}건이 거부됐다 — ` +
      "write push 가 read 예산을 쓰고 있다"
  );
});

test("★viewer 는 write 버킷을 고를 수 없다 — 예산 선택 전에 죽는다", () => {
  // 예산 키를 클라이언트 주장으로 잡으면 누구나 `access:"write"` 를 실어
  // 60회/시간 버킷을 고른다 = read 상한 20회/시간이 사실상 사라진다.
  // 그 길이 막혀 있음을 못박는다: 판정이 먼저 거부한다.
  const decision = evaluateInstallationTokenRequest({
    uid: PUSHER,
    project: projectFixture(),
    ownerPlan: TEAM_PLAN,
    memberRole: "viewer",
    requestedAccess: "write",
  });
  assert.equal(decision.ok, false);
  assert.equal(
    decision.ok === false ? decision.code : null,
    "role-cannot-write"
  );

  // viewer 가 read 로 내려오면 통과하되, 예산은 read 다.
  const readBudget = budgetFor("viewer", "read");
  assert.deepEqual([...readBudget.rules], [...INSTALLATION_TOKEN_RULES_READ]);
  assert.equal(
    readBudget.key,
    installationTokenRateKey(PUSHER, PROJECT, "read")
  );
});

test("★write 를 쓴 뒤에도 read 예산은 온전하다 (그리고 그 역도) — 판정 경유", () => {
  const writeBudget = budgetFor("member", "write");
  const readBudget = budgetFor("member", "read");
  assert.notEqual(writeBudget.key, readBudget.key);

  // write 버킷을 시간당 상한까지 채워도 read 버킷은 비어 있다.
  const writeMax = hourlyMax(writeBudget.rules);
  const filled = replay(evenly(writeMax + 1, 30 * SEC), writeBudget.rules);
  assert.equal(filled[writeMax].allowed, false);
  const readFirst = replay([T0], readBudget.rules);
  assert.equal(readFirst[0].allowed, true);
});

test("예산의 키와 룰은 항상 같은 접근 수준에서 나온다", () => {
  // 한쪽만 갈리는 조합(예: write 룰 + read 키)이 만들어질 수 없음을 못박는다.
  for (const [role, access] of [
    ["member", "write"],
    ["member", "read"],
    ["admin", "write"],
    ["owner", "write"],
  ] as const) {
    const uid = role === "owner" ? OWNER : PUSHER;
    const budget = budgetFor(role, access, uid);
    assert.equal(budget.key, installationTokenRateKey(uid, PROJECT, access));
    assert.equal(budget.rules, installationTokenRules(access));
  }
});
