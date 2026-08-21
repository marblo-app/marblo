/**
 * 봉투 계약 테스트.
 *
 * 이 화면의 실패 모드는 버그가 아니라 **오독**이다. 그래서 테스트도 "함수가 돈다"
 * 가 아니라 "미수집이 0 으로 접히지 않나 / 모르는 값이 0 이 되지 않나 / 원시
 * uid·이메일이 통과하지 않나" 를 본다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  deriveOrchestratorCell,
  formatUsd,
  freshnessMinutes,
  isTeamMemberKey,
  isUsageEmpty,
  isUsageNotProvisioned,
  isUsageRenderable,
  maskDisplayName,
  normalizeTeamUsage,
  pickActorKind,
  resolveReason,
  resolveWindow,
} from "./teamUsageContract";

// ── ★미수집은 0 이 아니다 ───────────────────────────────────────────────────

test("not_collected 는 측정값이 딸려 와도 숫자로 접히지 않는다", () => {
  const cell = deriveOrchestratorCell(
    {
      state: "not_collected",
      reason: "오케 세션은 비용 트래커에 붙는 경로가 없다",
      reasonCode: "orchestrator_not_wired",
      collectingSince: null,
      legacySegment: {
        from: "2026-05-05",
        to: "2026-06-22",
        noteCode: null,
        note: null,
      },
    },
    // ★잔재 행이 같이 와도 무시해야 한다 — 규약 이전 id 라 시계열이 아니다.
    { costUsd: 22329, tokens: 1_000_000 },
    { fromDay: "2026-07-22", toDayExclusive: "2026-08-22" }
  );
  assert.equal(cell.kind, "notCollected");
  assert.ok(!("costUsd" in cell), "미수집 칸은 금액 필드를 갖지 않는다");
});

test("봉투에 오케 축이 없으면 0 이 아니라 '미배선' 이다", () => {
  const cell = deriveOrchestratorCell(null, { costUsd: 0, tokens: 0 }, null);
  assert.equal(cell.kind, "unwired");
});

test("수집 중이지만 시작일을 모르면 그릴 기준이 없다 → 적재 전", () => {
  const cell = deriveOrchestratorCell(
    { state: "collecting", reason: null, reasonCode: null, collectingSince: null, legacySegment: null },
    { costUsd: 12, tokens: 3 },
    { fromDay: "2026-08-01", toDayExclusive: "2026-08-22" }
  );
  assert.equal(cell.kind, "pending");
});

test("조회창이 통째로 수집 시작 이전이면 적재 전", () => {
  const cell = deriveOrchestratorCell(
    { state: "collecting", reason: null, reasonCode: null, collectingSince: "2026-09-01", legacySegment: null },
    null,
    { fromDay: "2026-08-01", toDayExclusive: "2026-08-22" }
  );
  assert.equal(cell.kind, "pending");
  assert.equal(cell.kind === "pending" ? cell.since : null, "2026-09-01");
});

test("조회창이 수집 시작을 걸치면 합계가 아니라 '구간 일부' 다", () => {
  const cell = deriveOrchestratorCell(
    { state: "collecting", reason: null, reasonCode: null, collectingSince: "2026-08-10", legacySegment: null },
    { costUsd: 5, tokens: 7 },
    { fromDay: "2026-08-01", toDayExclusive: "2026-08-22" }
  );
  assert.equal(cell.kind, "partial");
  assert.equal(cell.kind === "partial" ? cell.coveredFrom : null, "2026-08-10");
});

test("수집이 창 전체를 덮으면 실측값이고, 0 도 실측 0 이다", () => {
  const cell = deriveOrchestratorCell(
    { state: "collecting", reason: null, reasonCode: null, collectingSince: "2026-07-01", legacySegment: null },
    { costUsd: 0, tokens: 0 },
    { fromDay: "2026-08-01", toDayExclusive: "2026-08-22" }
  );
  assert.equal(cell.kind, "measured");
  assert.equal(cell.kind === "measured" ? cell.costUsd : -1, 0);
});

// ── ★state 다섯 · 0 / 빈 / 적재 전 3분법 ───────────────────────────────────

test("not_provisioned 는 유효한 state 다 — 떨어뜨리지 않는다", () => {
  const env = normalizeTeamUsage({
    teamUsage: { state: "not_provisioned", basis: "account_ledger" },
  });
  assert.equal(env.teamUsage?.state, "not_provisioned");
  assert.equal(isUsageNotProvisioned(env), true);
  // ★`empty` 로 접히면 3분법이 2분법으로 무너진다.
  assert.equal(isUsageEmpty(env), false);
});

test("행이 있는데 합이 0 이면 빈 상태가 아니라 '진짜 0' 이다", () => {
  const env = normalizeTeamUsage({
    teamUsage: { state: "complete", basis: "account_ledger" },
    coverage: { rowsInWindow: 1200 },
    totals: { costUsd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 },
    byDay: [],
    byMember: [],
  });
  assert.equal(isUsageEmpty(env), false, "행이 있었으면 빈 상태가 아니다");
});

test("행이 0 이면 빈 상태다", () => {
  const env = normalizeTeamUsage({
    teamUsage: { state: "empty", basis: "account_ledger" },
    coverage: { rowsInWindow: 0 },
  });
  assert.equal(isUsageEmpty(env), true);
});

test("byMember.hasRows 는 0 과 구별된다 (없으면 모름)", () => {
  const env = normalizeTeamUsage({
    byMember: [
      { memberKey: "tm_aaaa1111", costUsd: 0, tokens: 0, share: 0, hasRows: false },
      { memberKey: "tm_bbbb2222", costUsd: 0, tokens: 0, share: 0 },
    ],
  });
  assert.equal(env.byMember[0].hasRows, false);
  assert.equal(env.byMember[1].hasRows, null, "안 주면 0 이 아니라 모름이다");
});

// ── 정규화: 모르는 것을 0 으로 만들지 않는다 ────────────────────────────────

test("빈 응답도 던지지 않고, 축·게이트는 null 로 남는다(0 이 아니다)", () => {
  const env = normalizeTeamUsage(undefined);
  assert.equal(env.teamUsage, null);
  assert.equal(env.orchestratorAxis, null);
  assert.equal(env.totals, null);
  assert.equal(env.coverage, null);
  assert.deepEqual(env.byMember, []);
  assert.equal(isUsageRenderable(env), false);
  assert.equal(isUsageEmpty(env), true);
});

test("커버리지 결측은 0% 가 아니라 null 이다", () => {
  const env = normalizeTeamUsage({ coverage: { rowsZeroPct: null } });
  assert.equal(env.coverage?.rowsZeroPct, null);
});

test("모르는 state 값은 상태로 인정하지 않는다", () => {
  const env = normalizeTeamUsage({
    teamUsage: { state: "sorta_open", basis: "account_ledger" },
    orchestratorAxis: { state: "maybe" },
  });
  assert.equal(env.teamUsage, null);
  assert.equal(env.orchestratorAxis, null);
});

test("NaN·문자열 숫자는 값으로 통과하지 않는다", () => {
  const env = normalizeTeamUsage({
    coverage: { rowsZeroPct: Number.NaN, unattributedRows: "1200" },
  });
  assert.equal(env.coverage?.rowsZeroPct, null);
  assert.equal(env.coverage?.unattributedRows, null);
});

test("byActorKind 에 없는 종류는 0 이 아니라 null 이다", () => {
  const env = normalizeTeamUsage({
    byActorKind: [{ actorKind: "worker", costUsd: 3, tokens: 4 }],
  });
  assert.deepEqual(pickActorKind(env.byActorKind, "worker"), {
    costUsd: 3,
    tokens: 4,
  });
  assert.equal(pickActorKind(env.byActorKind, "orchestrator"), null);
});

// ── ★프라이버시 — 원시 uid·이메일은 통과하지 못한다 ─────────────────────────

test("가명 공간을 벗어난 멤버 키는 행째로 버린다", () => {
  const env = normalizeTeamUsage({
    byMember: [
      { memberKey: "tm_abcd1234", displayName: "김동원", costUsd: 1, tokens: 2, share: 0.5 },
      // 사람 축 조인 키 — 섞이면 이 화면이 링크표의 이름 사전이 된다(설계 §4.6)
      { memberKey: "us_abcd1234", displayName: "누군가", costUsd: 9, tokens: 9, share: 0.5 },
      // 원시 uid
      { memberKey: "aB3xY7zQ1mN5pR8sT2vW4uK6", displayName: "누군가", costUsd: 9, tokens: 9 },
    ],
  });
  assert.equal(env.byMember.length, 1);
  assert.equal(env.byMember[0].memberKey, "tm_abcd1234");
});

test("isTeamMemberKey 는 tm_ 접두만 통과시킨다", () => {
  assert.equal(isTeamMemberKey("tm_a1b2c3"), true);
  assert.equal(isTeamMemberKey("us_a1b2c3"), false);
  assert.equal(isTeamMemberKey("tm_"), false);
  assert.equal(isTeamMemberKey(42), false);
});

test("이메일과 uid 모양은 표시명으로 통과하지 못한다", () => {
  assert.equal(maskDisplayName("john.kim@hypemarc.com"), null);
  assert.equal(maskDisplayName("aB3xY7zQ1mN5pR8sT2vW4uK6"), null);
  assert.equal(maskDisplayName("  김동원 "), "김동원");
  assert.equal(maskDisplayName(""), null);
});

test("share 는 0~1 밖이면 버린다 (150% 가 화면에 뜨지 않게)", () => {
  const env = normalizeTeamUsage({
    byMember: [{ memberKey: "tm_x1y2z3", share: 1.5, costUsd: 1, tokens: 1 }],
  });
  assert.equal(env.byMember[0].share, null);
});

// ── 사유 해석 — 코드든 문장이든 빈칸이 되지 않는다 ──────────────────────────

test("아는 코드는 로케일 사전으로, 모르는 코드는 서버 산문으로 떨어진다", () => {
  const dict = { unset: "아직 열지 않았습니다" };
  assert.equal(resolveReason("unset", "server prose", dict, "폴백"), "아직 열지 않았습니다");
  assert.equal(resolveReason("brand_new_code", "server prose", dict, "폴백"), "server prose");
  assert.equal(resolveReason(null, null, dict, "폴백"), "폴백");
  // ★사유가 사라지는 경로가 없어야 한다 — 사라지면 미수집이 0 과 구별되지 않는다.
  assert.notEqual(resolveReason("unknown_code", null, dict, "폴백"), "");
});

test("프로토타입 오염된 코드로 사전을 뚫지 못한다", () => {
  assert.equal(resolveReason("toString", null, {}, "폴백"), "폴백");
});

// ── 창 계산 / 포맷 ──────────────────────────────────────────────────────────

test("조회창은 서버 시각 기준이고 끝일을 포함한다", () => {
  const w = resolveWindow("2026-08-21T09:00:00.000Z", 30);
  assert.deepEqual(w, { fromDay: "2026-07-23", toDayExclusive: "2026-08-22" });
});

test("generatedAt 이 없거나 깨졌으면 창을 만들지 않는다", () => {
  assert.equal(resolveWindow(null, 30), null);
  assert.equal(resolveWindow("nope", 30), null);
  assert.equal(resolveWindow("2026-08-21T09:00:00.000Z", 0), null);
});

test("신선도는 서버 시각 기준이고 음수로 내려가지 않는다", () => {
  const gen = "2026-08-21T09:00:00.000Z";
  assert.equal(freshnessMinutes(gen, Date.parse("2026-08-21T09:07:00.000Z")), 7);
  assert.equal(freshnessMinutes(gen, Date.parse("2026-08-21T08:00:00.000Z")), 0);
  assert.equal(freshnessMinutes(null, Date.now()), null);
});

test("금액은 통화 기호와 함께 나온다 (라벨은 호출부가 붙인다)", () => {
  assert.match(formatUsd(1234.5, "en"), /\$/);
  assert.equal(formatUsd(Number.NaN, "en"), "—");
});
