// teamUsage 순수 로직 단위테스트 (personAxis.test.ts 규약).
// 실행:
//   cd v3/functions && npm run test:team-usage
//
// ★이 파일이 지키는 것 여섯 — 전부 설계 문서(docs/team-usage-overview-design-2026-08-21.md)
//   와 티켓이 "이게 핵심" 이라고 적은 자리다.
//
//   1) 게이트가 unset 이면 팀 스코프는 **0행 + 사유**다. 던지지도, 전체를 보여주지도 않는다.
//      본인(self) 스코프는 게이트 밖이라 닫혀 있어도 산다.
//   2) `0` · `미수집` · `적재 전` 은 **셋 다 다른 뜻**이고 응답에서 구분된다.
//   3) 금액을 '청구액' 이라고 부르지 않는다.
//   4) 일반 멤버는 남의 사용량도, 팀 총계도 못 본다.
//   5) 클라가 준 projectId 로 권한이 넓어지지 않는다(교집합만).
//   6) 밖으로 나가는 가명은 팀 전용 공간이고 사람 축 키와 **다르다**.
import test from "node:test";
import assert from "node:assert/strict";

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";
import {
  MEMBER_SELF_ONLY_NOTE,
  ORCHESTRATOR_LEGACY_SEGMENT,
  ORCHESTRATOR_NOT_COLLECTED_NOTE,
  TEAM_MEMBER_KEY_PREFIX,
  TEAM_SCOPE_DENIED_NOTE,
  TEAM_USAGE_BASIS,
  TEAM_USAGE_CACHE_SCHEMA_VERSION,
  TEAM_USAGE_CACHE_TTL_SECONDS,
  TEAM_USAGE_COST_LABEL,
  TEAM_USAGE_DAILY_SCHEMA,
  TEAM_USAGE_EFFECTIVE_FROM_ENV,
  TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS,
  TEAM_USAGE_MAX_PROJECTS_IN_SCOPE,
  TEAM_USAGE_MAX_RANGE_DAYS,
  REDACTED_IDENTITY_LABEL,
  TEAM_USAGE_EFFECTIVE_FROM_UNSET_OPERATOR_NOTE,
  scrubIdentityLike,
  TEAM_USAGE_NOTE_CODES,
  TEAM_USAGE_NOTE_TEXT_KO,
  TEAM_USAGE_UNATTRIBUTED_SCHEMA,
  TELEMETRY_OPT_OUT_NOTE,
  VIEW_TEAM_USAGE_DAILY,
  VIEW_TEAM_USAGE_UNATTRIBUTED,
  addUtcDays,
  buildSelfUsageDailyQuery,
  buildTeamUsageCacheDocId,
  buildTeamUsageDailyQuery,
  buildTeamUsageDailyViewDdl,
  buildTeamUsageDailyViewSql,
  buildTeamUsageEnvelope,
  buildTeamUsageUnattributedViewDdl,
  buildTeamUsageUnattributedViewSql,
  buildUnattributedRowsQuery,
  TEAM_USAGE_DELIBERATE_MISMATCHES,
  TEAM_USAGE_SUMMARY_INVARIANTS,
  canManualRefresh,
  canSeeTeamBreakdown,
  capProjectScope,
  sumToleranceUsd,
  clampWindowToGate,
  computeUsageWindow,
  foldCachedTeamUsage,
  foldTeamUsage,
  intersectProjectScope,
  isCacheUsable,
  resolveOrchestratorAxis,
  resolveTeamUsageGate,
  resolveUsageScope,
  teamMemberKey,
  toCacheRows,
  type TeamUsageDailyRow,
} from "./teamUsage";

const SALT = "test-salt-do-not-use-in-prod";
const UID_A = "AAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const UID_B = "BBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const NOW = Date.parse("2026-08-21T09:30:00Z");

function win(days = 30, nowMs = NOW) {
  return computeUsageWindow(nowMs, days);
}

function envelope(
  over: Partial<Parameters<typeof buildTeamUsageEnvelope>[0]> = {}
) {
  return buildTeamUsageEnvelope({
    scope: "team",
    scopeNoteCode: null,
    window: win(),
    generatedAtMs: NOW,
    gate: resolveTeamUsageGate({}),
    projectsInScope: 1,
    cache: { hit: false, ageSeconds: 0, ttlSeconds: 900 },
    folded: null,
    env: {},
    ...over,
  });
}

// ── 1. 게이트 ────────────────────────────────────────────────────────────────

test("게이트: unset 이면 닫히고 **사유를 들고 다닌다** (던지지 않는다)", () => {
  const gate = resolveTeamUsageGate({});
  assert.equal(gate.open, false);
  assert.equal(gate.reasonCode, "unset");
  assert.ok(gate.reason && gate.reason.length > 0);
  assert.equal(gate.effectiveFrom, null);
});

test("게이트: 코드에 기본값이 없다 — env 를 빠뜨리면 열리지 않는다", () => {
  // 값이 없으면 무슨 수를 써도 open 이 되지 않는다.
  for (const raw of [undefined, "", "   "]) {
    const gate = resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: raw });
    assert.equal(gate.open, false, `raw=${JSON.stringify(raw)}`);
  }
});

test("게이트: 날짜 모양이 아니면 닫은 채로 둔다(잘못된 상한으로 여는 것보다 안전)", () => {
  for (const bad of ["2026-13-01", "2026-02-31", "20260821", "yesterday"]) {
    const gate = resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: bad });
    assert.equal(gate.open, false, bad);
    assert.equal(gate.reasonCode, "invalid");
  }
});

test("게이트: 실재하는 날짜면 열린다", () => {
  const gate = resolveTeamUsageGate({
    [TEAM_USAGE_EFFECTIVE_FROM_ENV]: " 2026-08-21 ",
  });
  assert.equal(gate.open, true);
  assert.equal(gate.effectiveFrom, "2026-08-21");
  assert.equal(gate.reason, null);
});

// ── 2. 봉투: 닫힘 = 0행 + 사유 ───────────────────────────────────────────────

test("팀 스코프 + 게이트 닫힘 → state=disabled, 숫자 0행, 사유 있음", () => {
  const res = envelope();
  assert.equal(res.teamUsage.state, "disabled");
  assert.ok(res.teamUsage.disabledReason);
  assert.equal(res.totals.costUsd, 0);
  assert.deepEqual(res.byDay, []);
  assert.deepEqual(res.byMember, []);
  // ★닫혀 있어도 basis 라벨은 실린다 — 라벨 없는 숫자 금지 규약.
  assert.equal(res.teamUsage.basis, TEAM_USAGE_BASIS);
  assert.ok(res.teamUsage.basisLabel.length > 0);
});

test("★self 스코프는 게이트 밖 — 게이트가 닫혀도 disabled 가 아니다", () => {
  const res = envelope({ scope: "self" });
  assert.notEqual(res.teamUsage.state, "disabled");
  assert.equal(res.teamUsage.disabledReason, null);
  assert.equal(res.teamUsage.scope, "self");
});

// ── 3. ★0 / 미수집 / 적재 전 — 셋 다 다른 뜻 ─────────────────────────────────

test("★`적재 전`(뷰 없음)은 empty 가 아니라 not_provisioned 다", () => {
  const res = envelope({
    notProvisioned: true,
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
  });
  assert.equal(res.teamUsage.state, "not_provisioned");
  assert.ok(res.teamUsage.disabledReason?.includes("적재 전"));
  assert.equal(res.totals.costUsd, 0);

  // ★게이트가 닫혀 있으면 그쪽이 우선이다 — 닫힌 화면에 "적재 전" 을 그리면
  //   오너가 프로비저닝을 고치려 든다(원인이 다르다).
  const closed = envelope({ notProvisioned: true });
  assert.equal(closed.teamUsage.state, "disabled");
});

test("★`0`(행은 있고 합이 0)과 `empty`(행이 0)는 다른 상태다", () => {
  const zeroRow: TeamUsageDailyRow = {
    day: "2026-08-20",
    project_id: "p1",
    account_uid: UID_A,
    model: "claude-opus-5",
    actor_kind: "worker",
    rows_n: 7,
    rows_zero: 7,
    input_tokens: 0,
    output_tokens: 0,
    cost_usd: 0,
    distinct_agents: 1,
    distinct_tasks: 0,
    rows_without_task: 7,
  };
  const folded = foldTeamUsage([zeroRow], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
  });
  const res = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
    folded,
  });
  assert.equal(res.teamUsage.state, "complete"); // 행이 있다 → empty 가 아니다
  assert.equal(res.totals.costUsd, 0); // 그런데 합은 0 이다
  assert.equal(res.coverage.rowsInWindow, 7);
  assert.equal(res.coverage.rowsZeroPct, 100);

  const empty = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
    folded: foldTeamUsage([], {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
    }),
  });
  assert.equal(empty.teamUsage.state, "empty");
  assert.equal(empty.coverage.rowsInWindow, 0);
});

test("★`미수집`: 오케 칸은 0 이 아니라 상태 + 사유다", () => {
  const res = envelope();
  assert.equal(res.orchestratorAxis.state, "not_collected");
  assert.equal(res.orchestratorAxis.reason, ORCHESTRATOR_NOT_COLLECTED_NOTE);
  assert.equal(res.orchestratorAxis.collectingSince, null);
  // ★0 으로 그리지 않는다 — byActorKind 에 orchestrator 항목이 실리지 않는다.
  assert.equal(
    res.byActorKind.some((r) => r.actorKind === "orchestrator"),
    false
  );
});

test("오케 사유 문장이 '0 이 아니라 미수집' 을 명시한다", () => {
  assert.ok(ORCHESTRATOR_NOT_COLLECTED_NOTE.includes("미수집"));
  assert.ok(ORCHESTRATOR_NOT_COLLECTED_NOTE.includes("29%"));
});

test("수집 배선이 배포되면 env 로 collecting 이 된다(코드 배포 아님)", () => {
  const axis = resolveOrchestratorAxis(
    { fromDay: "2026-09-01", toDayExclusive: "2026-09-30" },
    false,
    { TEAM_USAGE_ORCHESTRATOR_COLLECTING_SINCE: "2026-09-01" }
  );
  assert.equal(axis.state, "collecting");
  assert.equal(axis.collectingSince, "2026-09-01");
  assert.equal(axis.reason, null);
});

test("레거시 구간과 겹치고 오케 행이 실제로 있으면 legacySegment 를 붙인다", () => {
  const overlap = resolveOrchestratorAxis(
    { fromDay: "2026-06-01", toDayExclusive: "2026-07-01" },
    true,
    {}
  );
  assert.deepEqual(
    { from: overlap.legacySegment?.from, to: overlap.legacySegment?.to },
    { from: ORCHESTRATOR_LEGACY_SEGMENT.from, to: ORCHESTRATOR_LEGACY_SEGMENT.to }
  );
  // 행이 없으면 붙이지 않는다(빈 구간에 잔재 라벨을 그리지 않는다).
  const noRows = resolveOrchestratorAxis(
    { fromDay: "2026-06-01", toDayExclusive: "2026-07-01" },
    false,
    {}
  );
  assert.equal(noRows.legacySegment, null);
});

// ── 4. ★금액을 '청구액' 이라 부르지 않는다 ───────────────────────────────────

test("★금액 라벨은 '사용량 환산 비용(추정)' 이고 '청구액' 이 아니다", () => {
  const res = envelope();
  assert.equal(res.teamUsage.costLabel, TEAM_USAGE_COST_LABEL);
  assert.ok(TEAM_USAGE_COST_LABEL.includes("추정"));
  assert.equal(TEAM_USAGE_COST_LABEL.includes("청구액"), false);
  // 청구액이 아니라는 사실을 화면이 그릴 수 있게 문장으로도 싣는다.
  assert.match(res.teamUsage.costNotBillingNote, /청구액이 아[니닙]/);
});

test("★봉투 어디에도 '청구액' 이라는 라벨이 없다(사유 문장의 부정 표현 제외)", () => {
  const res = envelope();
  const labels = [
    res.teamUsage.basis,
    res.teamUsage.basisLabel,
    res.teamUsage.costLabel,
  ];
  for (const l of labels) assert.equal(l.includes("청구"), false, l);
});

// ── 5. ★권한: 멤버는 자기 것만 ───────────────────────────────────────────────

test("★owner/admin 만 팀 분해를 본다", () => {
  assert.equal(canSeeTeamBreakdown("owner"), true);
  assert.equal(canSeeTeamBreakdown("admin"), true);
  assert.equal(canSeeTeamBreakdown("member"), false);
  assert.equal(canSeeTeamBreakdown("viewer"), false);
  assert.equal(canSeeTeamBreakdown(null), false);
  assert.equal(canSeeTeamBreakdown(undefined), false);
});

test("★팀 프로젝트가 없으면 team 요청이 self 로 내려가고 사유가 붙는다", () => {
  const r = resolveUsageScope("team", false);
  assert.equal(r.scope, "self");
  assert.equal(r.downgradedReasonCode, "no_team_scope");
  assert.equal(TEAM_USAGE_NOTE_TEXT_KO.no_team_scope, TEAM_SCOPE_DENIED_NOTE);
});

test("★'숨긴다는 사실' 자체도 말하지 않는다 — 숨기는 목적이 절반 무효화된다", () => {
  // 존재 여부를 안 말하는 것만으로는 부족하다. "있는지 없는지는 답하지 않습니다"
  // 같은 문장은 **숨기고 있다는 사실을 노출**해서 "아, 뭔가 있긴 하구나" 를 알려준다.
  // (형제 티켓 IcjPf2SEs0ORUGLZgCHS 의 `no_role` 문장이 정확히 그랬다. 규칙을
  //  알면서도 문장에 적혀 있었다 — ★아는 것과 검사가 있는 것은 다르다.)
  for (const leak of ["존재", "있는지", "없는지", "숨기"]) {
    assert.equal(
      TEAM_SCOPE_DENIED_NOTE.includes(leak),
      false,
      `'${leak}' 가 사유 문장에 있다: ${TEAM_SCOPE_DENIED_NOTE}`
    );
  }
});

test("★멤버 분해를 끄면 byMember 는 빈 배열이다 — 팀 총계도 안 나간다", () => {
  const rows: TeamUsageDailyRow[] = [
    {
      day: "2026-08-20",
      project_id: "p1",
      account_uid: UID_A,
      model: "m",
      actor_kind: "worker",
      rows_n: 1,
      rows_zero: 0,
      input_tokens: 10,
      output_tokens: 5,
      cost_usd: 1,
      distinct_agents: 1,
      distinct_tasks: 1,
      rows_without_task: 0,
    },
    {
      day: "2026-08-20",
      project_id: "p1",
      account_uid: UID_B,
      model: "m",
      actor_kind: "worker",
      rows_n: 1,
      rows_zero: 0,
      input_tokens: 20,
      output_tokens: 5,
      cost_usd: 3,
      distinct_agents: 1,
      distinct_tasks: 1,
      rows_without_task: 0,
    },
  ];
  const folded = foldTeamUsage(rows, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: false,
  });
  assert.deepEqual(folded.byMember, []);
});

test("멤버 사유 문장이 규칙의 **근거**까지 말한다 (금지만 말하지 않는다)", () => {
  // ★"차분 공격" 같은 보안 용어는 화면에 쓰지 않는다 — 오너가 알아야 할 것은
  //   용어가 아니라 산수다. 규칙만 말하고 이유를 안 말하면 다음 사람이
  //   "예산 감각" 을 이유로 총계를 열고, 그 순간 약속이 산술로 깨진다.
  assert.ok(MEMBER_SELF_ONLY_NOTE.includes("팀 합계 − 내 사용량"));
  assert.ok(MEMBER_SELF_ONLY_NOTE.includes("상대방"));
  assert.equal(MEMBER_SELF_ONLY_NOTE.includes("차분 공격"), false);
});

// ── 6. ★크로스테넌트: 클라 입력은 필터로만 ───────────────────────────────────

test("★클라가 준 projectId 는 교집합 필터로만 쓰인다 — 확장 불가", () => {
  assert.deepEqual(intersectProjectScope(["p1", "p9"], ["p1", "p2"]), ["p1"]);
  // 요청이 없으면 서버가 만든 집합 전체
  assert.deepEqual(intersectProjectScope(null, ["p2", "p1"]), ["p1", "p2"]);
  assert.deepEqual(intersectProjectScope([], ["p1"]), ["p1"]);
  // 남의 프로젝트만 요청하면 빈 배열 → 호출측이 "권한 없음" 으로 0행
  assert.deepEqual(intersectProjectScope(["p9"], ["p1"]), []);
  // 형이 흔들려도 넓어지지 않는다
  assert.deepEqual(
    intersectProjectScope(
      ["p1", 1 as unknown as string, "", "  "],
      ["p1", "p2"]
    ),
    ["p1"]
  );
});

// ── 7. ★가명 공간 분리 ───────────────────────────────────────────────────────

test("★팀 가명은 tm_ 접두이고 사람 축 키(us_)와 값이 다르다", () => {
  const tm = teamMemberKey(UID_A, SALT);
  const us = pseudonymizeAnalyticsId("user", UID_A, SALT);
  assert.ok(tm?.startsWith(TEAM_MEMBER_KEY_PREFIX));
  assert.equal(TEAM_MEMBER_KEY_PREFIX, "tm_");
  assert.notEqual(tm, us);
  // 같은 uid·같은 솔트인데 값이 다르다 = 두 축을 잇는 조인이 성립하지 않는다.
  assert.equal(typeof us, "string");
});

test("솔트가 없으면 가명을 만들지 않는다(원시 uid 폴백 금지)", () => {
  assert.equal(teamMemberKey(UID_A, null), null);
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 1,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: null, includeMemberBreakdown: true }
  );
  // 멤버 분해는 비지만 총계는 산다 — 조용한 원시값 노출보다 빈 분해가 낫다.
  assert.deepEqual(folded.byMember, []);
  assert.equal(folded.totals.costUsd, 1);
});

test("★응답 어디에도 원시 uid 가 없다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        input_tokens: 3,
        output_tokens: 2,
        cost_usd: 1,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      displayNames: new Map([[UID_A, "홍길동"]]),
    }
  );
  const res = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
    folded,
  });
  const json = JSON.stringify(res);
  assert.equal(json.includes(UID_A), false);
  assert.ok(json.includes(TEAM_MEMBER_KEY_PREFIX));
  // 표시명은 owner/admin 응답 본문에만 실린다.
  assert.equal(res.byMember[0]?.displayName, "홍길동");
});

test("표시명을 모르면 null 이다 — 이메일로 채우지 않는다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 1,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  assert.equal(folded.byMember[0]?.displayName, null);
});

// ── 8. ★빈 상태 — 팀이 들어왔을 때 답이 준비된 화면 ──────────────────────────

test("★멤버 1명(빈 팀)이어도 화면이 깨지지 않는다 — 0행 + 명부 그대로", () => {
  const folded = foldTeamUsage([], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A],
  });
  assert.equal(folded.byMember.length, 1);
  assert.equal(folded.byMember[0].hasRows, false);
  assert.equal(folded.byMember[0].costUsd, 0);
  assert.equal(folded.byMember[0].share, 0);
  assert.equal(folded.coverage.membersWithNoRows, 1);
  assert.equal(folded.coverage.telemetryOptOutNote, TELEMETRY_OPT_OUT_NOTE);
});

test("★행이 없는 멤버도 목록에서 사라지지 않는다(0 과 '안 보냄' 을 화면이 구분하게)", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 2,
        rows_zero: 0,
        input_tokens: 10,
        output_tokens: 10,
        cost_usd: 4,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      rosterUids: [UID_A, UID_B],
    }
  );
  assert.equal(folded.byMember.length, 2);
  const b = folded.byMember.find((m) => m.memberKey === teamMemberKey(UID_B, SALT));
  assert.equal(b?.hasRows, false);
  assert.equal(b?.costUsd, 0);
  assert.equal(folded.coverage.membersWithNoRows, 1);
  // share 는 총계 기준 비율
  const a = folded.byMember.find((m) => m.memberKey === teamMemberKey(UID_A, SALT));
  assert.equal(a?.share, 1);
});

test("총계가 0 이면 share 는 NaN 이 아니라 0 이다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 1,
        cost_usd: 0,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  assert.equal(folded.byMember[0].share, 0);
});

// ── 9. 창 계산 / L0 결정적 경계 ──────────────────────────────────────────────

test("창 경계는 UTC 일 단위로 절삭돼 같은 날 같은 창이면 문자 그대로 동일하다", () => {
  const a = computeUsageWindow(Date.parse("2026-08-21T00:00:01Z"), 30);
  const b = computeUsageWindow(Date.parse("2026-08-21T23:59:59Z"), 30);
  assert.deepEqual(a, b);
  assert.equal(a.todayUtc, "2026-08-21");
  assert.equal(a.toDayExclusive, "2026-08-22");
  assert.equal(a.fromDay, "2026-07-23");
  assert.equal(a.windowKey, "d30@2026-08-21");
});

test("days 상한은 365 이고 하한은 1 이다", () => {
  assert.equal(computeUsageWindow(NOW, 100000).rangeDays, TEAM_USAGE_MAX_RANGE_DAYS);
  assert.equal(computeUsageWindow(NOW, 0).rangeDays, 30);
  assert.equal(computeUsageWindow(NOW, -5).rangeDays, 1);
});

test("게이트 상한이 창을 자르면 partial 이 된다(잘린 사실을 숨기지 않는다)", () => {
  const clipped = clampWindowToGate(win(30), "2026-08-15");
  assert.equal(clipped.fromDay, "2026-08-15");
  assert.equal(clipped.clippedByGate, true);
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 2,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  const res = envelope({
    window: clipped,
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-08-15" }),
    folded,
  });
  assert.equal(res.teamUsage.state, "partial");
});

test("발효일이 창 전체보다 뒤면 창이 비고, 경계는 포함(>=)이다", () => {
  const after = clampWindowToGate(win(30), "2026-09-01");
  assert.equal(after.empty, true);
  assert.equal(after.fromDay, after.toDayExclusive);
  // 경계 포함: 발효일 == fromDay 면 자르지 않는다.
  const exact = clampWindowToGate(win(30), "2026-07-23");
  assert.equal(exact.clippedByGate, false);
});

test("오늘 막대에는 partial 배지가 붙는다(전일 대비 계산에서 빼라)", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-21",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 1,
      },
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 1,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  assert.deepEqual(
    folded.byDay.map((d) => [d.day, d.partial]),
    [
      ["2026-08-20", false],
      ["2026-08-21", true],
    ]
  );
});

test("addUtcDays 는 월·연 경계를 넘는다", () => {
  assert.equal(addUtcDays("2026-01-01", -1), "2025-12-31");
  assert.equal(addUtcDays("2026-02-28", 1), "2026-03-01");
});

// ── 10. 질의 — 결정적 경계 + 서버 도출 스코프 ────────────────────────────────

test("★질의는 CURRENT_TIMESTAMP() 를 쓰지 않는다(BQ 결과 캐시가 먹게)", () => {
  for (const q of [
    buildTeamUsageDailyQuery("marblo-2253d"),
    buildSelfUsageDailyQuery("marblo-2253d"),
    buildUnattributedRowsQuery("marblo-2253d"),
  ]) {
    assert.equal(q.includes("CURRENT_TIMESTAMP"), false);
    assert.ok(q.includes("@fromDay"));
    assert.ok(q.includes("@toDayExclusive"));
  }
});

test("팀 질의는 서버가 만든 projectId 집합으로만 좁힌다", () => {
  const q = buildTeamUsageDailyQuery("marblo-2253d");
  assert.ok(q.includes("project_id IN UNNEST(@projectIds)"));
  assert.ok(q.includes(VIEW_TEAM_USAGE_DAILY));
});

test("self 질의는 계정 uid 로 좁힌다", () => {
  const q = buildSelfUsageDailyQuery("marblo-2253d");
  assert.ok(q.includes("account_uid = @accountUid"));
});

test("★귀속 불가 질의는 금액·토큰을 고르지 않는다", () => {
  const q = buildUnattributedRowsQuery("marblo-2253d");
  assert.equal(q.includes("cost"), false);
  assert.equal(q.includes("tokens"), false);
  assert.ok(q.includes(VIEW_TEAM_USAGE_UNATTRIBUTED));
});

// ── 11. 뷰 DDL — ★원본 표 무변경 ─────────────────────────────────────────────

test("★뷰 DDL 은 CREATE VIEW 뿐이다 — DROP/ALTER/DELETE 를 한 줄도 내보내지 않는다", () => {
  for (const ddl of [
    buildTeamUsageDailyViewDdl("marblo-2253d"),
    buildTeamUsageUnattributedViewDdl("marblo-2253d"),
  ]) {
    assert.ok(ddl.startsWith("CREATE OR REPLACE VIEW"));
    for (const forbidden of ["DROP ", "ALTER ", "DELETE ", "TRUNCATE ", "INSERT ", "UPDATE ", "MERGE "]) {
      assert.equal(ddl.includes(forbidden), false, `${forbidden} in DDL`);
    }
  }
});

test("★솔트도 원시 uid 도 SQL 에 들어가지 않는다", () => {
  const sql = buildTeamUsageDailyViewSql("marblo-2253d");
  assert.equal(sql.includes("HMAC"), false);
  assert.equal(sql.includes(SALT), false);
  assert.equal(sql.includes(UID_A), false);
  // 뷰는 원장에 이미 있는 계정 uid 를 그대로 낸다(가명화는 Node 안에서).
  assert.ok(sql.includes("userId"));
  assert.ok(sql.includes("AS account_uid"));
});

test("뷰는 프로젝트 식별자 결측 행을 제외하고, 규모 뷰는 그 행만 센다", () => {
  const daily = buildTeamUsageDailyViewSql("marblo-2253d");
  assert.ok(daily.includes("WHERE projectId IS NOT NULL AND projectId != ''"));
  const un = buildTeamUsageUnattributedViewSql("marblo-2253d");
  assert.ok(un.includes("WHERE projectId IS NULL OR projectId = ''"));
});

test("actor_kind 는 기존 agentId 접두 규약의 파생이다(스키마 변경 없음)", () => {
  const sql = buildTeamUsageDailyViewSql("marblo-2253d");
  assert.ok(sql.includes("STARTS_WITH(agentId, 'orchestrator-')"));
});

test("뷰 스키마에 익명축 조인키가 없다", () => {
  const names = [
    ...TEAM_USAGE_DAILY_SCHEMA.map((f) => f.name),
    ...TEAM_USAGE_UNATTRIBUTED_SCHEMA.map((f) => f.name),
  ];
  for (const bad of [
    "install_key",
    "install_id",
    "client_id",
    "ga_key",
    "install_label",
  ]) {
    assert.equal(names.includes(bad), false, bad);
  }
});

test("★규모 뷰 스키마에는 금액·토큰 컬럼이 자리조차 없다", () => {
  const names = TEAM_USAGE_UNATTRIBUTED_SCHEMA.map((f) => f.name);
  assert.deepEqual(names, ["day", "account_uid", "rows_n"]);
});

// ── 12. 캐시 ─────────────────────────────────────────────────────────────────

test("★캐시 행에는 원시 uid 도 표시명도 없다 — 가명과 숫자뿐", () => {
  const rows = toCacheRows(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        model: "m",
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        input_tokens: 5,
        output_tokens: 5,
        cost_usd: 2,
      },
    ],
    SALT
  );
  const json = JSON.stringify(rows);
  assert.equal(json.includes(UID_A), false);
  assert.equal(json.includes("displayName"), false);
  assert.ok(rows[0].member_key === teamMemberKey(UID_A, SALT));
});

test("캐시 행을 다시 접어도 같은 멤버가 갈리지 않는다(이중 가명화 금지)", () => {
  const raw: TeamUsageDailyRow[] = [
    {
      day: "2026-08-20",
      project_id: "p1",
      account_uid: UID_A,
      model: "m",
      actor_kind: "worker",
      rows_n: 1,
      rows_zero: 0,
      input_tokens: 5,
      output_tokens: 5,
      cost_usd: 2,
    },
  ];
  const live = foldTeamUsage(raw, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
  });
  const cached = foldCachedTeamUsage(toCacheRows(raw, SALT), {
    todayUtc: "2026-08-21",
    includeMemberBreakdown: true,
  });
  assert.deepEqual(cached.byMember, live.byMember);
  assert.deepEqual(cached.totals, live.totals);
});

test("캐시 무효: schemaVersion / windowKey / 게이트 발효일 / TTL", () => {
  const base = {
    schemaVersion: TEAM_USAGE_CACHE_SCHEMA_VERSION,
    gateEffectiveFrom: "2026-08-21",
    windowKey: "d30@2026-08-21",
    expiresAtMs: NOW + 1000,
    rows: [],
  };
  const ctx = {
    windowKey: "d30@2026-08-21",
    gateEffectiveFrom: "2026-08-21",
    nowMs: NOW,
  };
  assert.equal(isCacheUsable(base, ctx), true);
  assert.equal(isCacheUsable({ ...base, schemaVersion: 0 }, ctx), false);
  assert.equal(isCacheUsable({ ...base, windowKey: "d7@2026-08-21" }, ctx), false);
  // ★게이트 값이 바뀌면 잘리는 구간이 달라진다 → 예전 숫자는 거짓말이 된다.
  assert.equal(isCacheUsable({ ...base, gateEffectiveFrom: "2026-01-01" }, ctx), false);
  assert.equal(isCacheUsable({ ...base, expiresAtMs: NOW - 1 }, ctx), false);
  assert.equal(isCacheUsable(null, ctx), false);
});

test("★캐시 키는 프로젝트 단위다 — 권한이 다른 둘이 같은 캐시를 나눠 쓰지 않는다", () => {
  assert.equal(buildTeamUsageCacheDocId("p1", "d30@2026-08-21"), "p1__d30@2026-08-21");
  assert.notEqual(
    buildTeamUsageCacheDocId("p1", "d30@2026-08-21"),
    buildTeamUsageCacheDocId("p2", "d30@2026-08-21")
  );
  assert.equal(buildTeamUsageCacheDocId("a/b", "w").includes("/"), false);
});

test("수동 새로고침은 프로젝트당 5분에 1회다", () => {
  assert.equal(canManualRefresh(null, NOW), true);
  assert.equal(canManualRefresh(NOW - 1000, NOW), false);
  assert.equal(
    canManualRefresh(NOW - TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS, NOW),
    true
  );
});

// ── 13. 커버리지 — "이 화면은 전부가 아니다" ─────────────────────────────────

test("커버리지가 델타0 비율·티켓결측 비율·귀속불가 행수를 스스로 말한다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 10,
        rows_zero: 5,
        rows_without_task: 8,
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 1,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      unattributedRows: 1234,
    }
  );
  assert.equal(folded.coverage.rowsZeroPct, 50);
  assert.equal(folded.coverage.rowsWithoutTaskPct, 80);
  assert.equal(folded.coverage.unattributedRows, 1234);
  assert.ok(folded.coverage.rowsZeroNote.includes("건수는 활동량이 아닙니다"));
});

test("행이 0이어도 비율이 NaN 이 되지 않는다", () => {
  const folded = foldTeamUsage([], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
  });
  assert.equal(folded.coverage.rowsZeroPct, 0);
  assert.equal(folded.coverage.rowsWithoutTaskPct, 0);
});

test("BigQuery 가 { value } 로 돌려주는 숫자·날짜를 접는다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: { value: "2026-08-20" },
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: { value: "3" },
        rows_zero: 0,
        input_tokens: "10",
        output_tokens: 5,
        cost_usd: { value: "1.5" },
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  assert.equal(folded.byDay[0].day, "2026-08-20");
  assert.equal(folded.totals.costUsd, 1.5);
  assert.equal(folded.totals.tokens, 15);
  assert.equal(folded.coverage.rowsInWindow, 3);
});


// ── 14. ★프론트 계약: 코드와 문장이 둘 다 나간다 ────────────────────────────
//
// 오케스트레이터 지적(에이전트 간 계약 충돌 4건)을 코드로 못박는 자리다.
// 코드는 i18n 키(=계약), 문장은 ko-KR 폴백이다.

test("★모든 노트 코드에 ko-KR 원문이 있다(코드만 늘리고 문장을 빼먹지 못한다)", () => {
  for (const code of TEAM_USAGE_NOTE_CODES) {
    const text = TEAM_USAGE_NOTE_TEXT_KO[code];
    assert.equal(typeof text, "string", code);
    assert.ok(text.length > 0, code);
  }
  assert.equal(
    Object.keys(TEAM_USAGE_NOTE_TEXT_KO).length,
    TEAM_USAGE_NOTE_CODES.length
  );
});

test("★사유는 코드와 문장이 쌍으로 나간다 — 영문 로케일이 한국어를 박지 않게", () => {
  const disabled = envelope();
  assert.equal(disabled.teamUsage.state, "disabled");
  assert.equal(disabled.teamUsage.disabledReasonCode, "gate_unset");
  assert.equal(
    disabled.teamUsage.disabledReason,
    TEAM_USAGE_NOTE_TEXT_KO.gate_unset
  );

  const invalid = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "nope" }),
  });
  assert.equal(invalid.teamUsage.disabledReasonCode, "gate_invalid");

  const notProv = envelope({
    notProvisioned: true,
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
  });
  assert.equal(notProv.teamUsage.disabledReasonCode, "not_provisioned");
});

test("★라벨 코드는 어떤 상태에서도 실린다 — 라벨 없는 숫자 금지", () => {
  for (const res of [envelope(), envelope({ scope: "self" })]) {
    assert.equal(res.teamUsage.basisLabelCode, "basis_account_ledger");
    assert.equal(res.teamUsage.costLabelCode, "cost_estimated_usage");
    assert.equal(res.teamUsage.costNotBillingNoteCode, "cost_not_billing");
    assert.equal(res.coverage.telemetryOptOutNoteCode, "telemetry_opt_out");
  }
});

test("★오케 칸 사유도 코드로 나간다", () => {
  const res = envelope();
  assert.equal(res.orchestratorAxis.reasonCode, "orchestrator_not_collected");
  assert.equal(
    res.orchestratorAxis.reason,
    TEAM_USAGE_NOTE_TEXT_KO.orchestrator_not_collected
  );
});

test("★권한에 따라 봉투가 달라지는 지점은 byMember 하나다(계약 고정)", () => {
  const rows: TeamUsageDailyRow[] = [
    {
      day: "2026-08-20",
      project_id: "p1",
      account_uid: UID_A,
      actor_kind: "worker",
      rows_n: 1,
      rows_zero: 0,
      input_tokens: 1,
      output_tokens: 1,
      cost_usd: 1,
    },
  ];
  const opts = { todayUtc: "2026-08-21", memberSalt: SALT } as const;
  const owner = foldTeamUsage(rows, { ...opts, includeMemberBreakdown: true });
  const self = foldTeamUsage(rows, { ...opts, includeMemberBreakdown: false });
  // 나머지 축은 같은 모양으로 나간다 — 프론트가 분기 없이 그린다.
  assert.deepEqual(owner.totals, self.totals);
  assert.deepEqual(owner.byDay, self.byDay);
  assert.deepEqual(owner.byModel, self.byModel);
  assert.deepEqual(owner.byActorKind, self.byActorKind);
  // 다른 것은 멤버 분해뿐이다.
  assert.ok(owner.byMember.length > 0);
  assert.deepEqual(self.byMember, []);
});


// ── 15. ★게이트가 닫히면 숫자가 한 줄도 안 샌다 (형제 티켓 감사 탭과의 약속) ──
//
// 감사 탭(`getTeamProjectAudit`, 티켓 IcjPf2SEs0ORUGLZgCHS)은 응답에서 금액·토큰을
// **전부 뺐다** — 감사 탭은 이 게이트 밖이라, 거기에 돈을 실으면 감사 탭 경유로
// 게이트가 통째로 우회되기 때문이다. 그 약속의 반대쪽이 여기다: **사용량 탭이
// 게이트가 닫힌 채로 멤버별 숫자를 흘리지 않아야 한다.** 두 탭 중 하나만 새도
// 약속이 깨진다.
//
// ★질의를 건너뛰는 것(콜러블)과 봉투가 비우는 것(여기)은 **다른 방어선**이다.
//   호출측이 언젠가 순서를 잘못 짜도 봉투에서 다시 막힌다.

test("★게이트가 닫히면 folded 가 채워져 있어도 봉투가 통째로 비운다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        model: "claude-opus-5",
        actor_kind: "worker",
        rows_n: 9,
        rows_zero: 0,
        input_tokens: 1000,
        output_tokens: 2000,
        cost_usd: 123.45,
      },
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_B,
        model: "claude-opus-5",
        actor_kind: "worker",
        rows_n: 3,
        rows_zero: 0,
        input_tokens: 10,
        output_tokens: 20,
        cost_usd: 67.89,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      displayNames: new Map([
        [UID_A, "홍길동"],
        [UID_B, "김철수"],
      ]),
    }
  );
  // 접기 자체는 숫자를 만든다 — 여기까지는 정상이다.
  assert.ok(folded.byMember.length === 2);

  // ★그런데 게이트가 닫힌 팀 스코프 봉투는 그 숫자를 하나도 싣지 않는다.
  const res = envelope({ folded }); // gate = unset(닫힘), scope = team
  assert.equal(res.teamUsage.state, "disabled");
  assert.deepEqual(res.byMember, []);
  assert.deepEqual(res.byDay, []);
  assert.deepEqual(res.byProject, []);
  assert.deepEqual(res.byModel, []);
  assert.deepEqual(res.byActorKind, []);
  assert.equal(res.totals.costUsd, 0);
  assert.equal(res.totals.tokens, 0);
  assert.equal(res.coverage.rowsInWindow, 0);

  // 응답 전문에 금액도 표시명도 없다.
  const json = JSON.stringify(res);
  assert.equal(json.includes("123.45"), false);
  assert.equal(json.includes("67.89"), false);
  assert.equal(json.includes("홍길동"), false);
  assert.equal(json.includes("김철수"), false);
  assert.equal(json.includes(UID_A), false);
});

test("★`적재 전` 봉투도 같은 방어선을 탄다 — 숫자를 싣지 않는다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        cost_usd: 42,
      },
    ],
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: true }
  );
  const res = envelope({
    folded,
    notProvisioned: true,
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
  });
  assert.equal(res.teamUsage.state, "not_provisioned");
  assert.deepEqual(res.byMember, []);
  assert.equal(res.totals.costUsd, 0);
  assert.equal(JSON.stringify(res).includes("42"), false);
});

test("★self 스코프는 게이트가 닫혀도 살지만, 멤버 분해는 그때도 빈 배열이다", () => {
  // 화면 절반이 사는 것과 남의 숫자가 새는 것은 다른 얘기다.
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        input_tokens: 5,
        output_tokens: 5,
        cost_usd: 7,
      },
    ],
    // ★self 경로는 includeMemberBreakdown 이 false 다(콜러블이 그렇게 부른다).
    { todayUtc: "2026-08-21", memberSalt: SALT, includeMemberBreakdown: false }
  );
  const res = envelope({ scope: "self", folded });
  assert.notEqual(res.teamUsage.state, "disabled");
  assert.equal(res.totals.costUsd, 7); // 본인 숫자는 산다
  assert.deepEqual(res.byMember, []); // 멤버 분해는 없다
});


// ── 16. ★화면에 나가는 문장은 오너가 읽을 문장이어야 한다 ────────────────────
//
// 형제 티켓(감사 탭 IcjPf2SEs0ORUGLZgCHS)이 자기 쪽에서 잡은 버그와 같은 부류다:
// 공용 매퍼의 note 를 그대로 흘렸더니 **그 뷰에서는 참이 아닌 문장**이 나갔다.
// 재사용은 맞지만 재사용한 문장이 내 뷰에서도 참인지는 별개다.
//
// 내 쪽에서 실제로 났던 문제는 조금 다르고 더 흔하다: 문장은 참인데 **독자가
// 틀렸다.** env 키 이름·npm 명령·내부 문서 경로는 참이지만 오너가 읽을 것이 아니다.
//
// ★그리고 하필 제일 잘 보이는 자리였다. 화면규칙 1 이 `state === "disabled"` 일 때
//   `disabledReason` **문장만** 그리라고 하는데, 게이트는 고지 개정 전까지 닫혀
//   있는 게 정상이다 — 즉 배포 직후 이 화면의 기본 모습이 그 문장 하나다.
//   거기 env 키가 박혀 있으면 오너가 보는 건 제품이 아니라 남의 배포 런북이다.

test("★봉투가 싣는 모든 문장에 운영자 전용 내용이 없다", () => {
  const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
    [/npm run/, "npm 명령"],
    [/TEAM_USAGE_[A-Z_]/, "env 키 이름"],
    [/PERSON_AXIS_[A-Z_]/, "env 키 이름"],
    [/ANALYTICS_ID_SALT/, "솔트 env 키"],
    [/docs\//, "내부 문서 경로"],
    [/\.ts\b/, "소스 파일명"],
    [/§/, "설계 절 번호"],
    [/cd v3/, "쉘 경로"],
    [/cost_logs|v_team_usage|BigQuery|Firestore/, "내부 표·저장소 이름"],
  ];
  for (const code of TEAM_USAGE_NOTE_CODES) {
    const text = TEAM_USAGE_NOTE_TEXT_KO[code];
    for (const [re, label] of forbidden) {
      assert.equal(
        re.test(text),
        false,
        `${code} 문장에 ${label} 이 들어 있다 — 화면이 그대로 그리는 문장이다: ${text}`
      );
    }
  }
});

test("★운영자용 사유는 따로 있고, 봉투에는 실리지 않는다", () => {
  const gate = resolveTeamUsageGate({});
  assert.equal(gate.open, false);
  // 운영자용에는 조치가 들어 있다.
  assert.ok(gate.operatorReason.includes("TEAM_USAGE_EFFECTIVE_FROM"));
  assert.equal(gate.operatorReason, TEAM_USAGE_EFFECTIVE_FROM_UNSET_OPERATOR_NOTE);
  // ★화면용에는 없다.
  assert.equal(gate.reason.includes("TEAM_USAGE_EFFECTIVE_FROM"), false);
  // ★봉투 어디에도 운영자용 문장이 없다.
  const json = JSON.stringify(envelope());
  assert.equal(json.includes(TEAM_USAGE_EFFECTIVE_FROM_UNSET_OPERATOR_NOTE), false);
  assert.equal(json.includes("operatorReason"), false);
});

test("게이트가 열리면 화면용·운영자용 사유가 둘 다 null 이다", () => {
  const gate = resolveTeamUsageGate({
    [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-08-21",
  });
  assert.equal(gate.reason, null);
  assert.equal(gate.operatorReason, null);
});

test("★사유 문장이 오너에게 '지금 뭘 할 수 있는지' 를 말한다", () => {
  // 닫힌 화면이 "안 됩니다" 로만 끝나면 오너는 고장으로 읽는다.
  assert.ok(TEAM_USAGE_NOTE_TEXT_KO.gate_unset.includes("본인 사용량은"));
  // 적재 전이 0 으로 오해되지 않게 그 자리에서 부정한다.
  assert.ok(TEAM_USAGE_NOTE_TEXT_KO.not_provisioned.includes("0 이라는 뜻이 아닙니다"));
  // 오케 칸은 "아래 숫자가 전부가 아니다" 까지 말한다.
  assert.ok(
    TEAM_USAGE_NOTE_TEXT_KO.orchestrator_not_collected.includes("전부가 아닙니다")
  );
});


// ── 17. ★값 수준 신원 차단 — 키 검사만으로는 안 막힌다 ───────────────────────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 자기 쪽 `claimedBy`/`agentId` 에서 찾은 구멍과
// 같은 부류다: 에이전트를 자기 이메일로 이름 지으면 **키 스캐너를 그대로 통과**했다.
// 내 봉투에도 사람이 자유롭게 짓는 문자열이 둘 실린다 — `displayName`, `projectName`.
//
// ★그리고 반대쪽도 결함이다: 멀쩡한 이름을 가리면 화면이 "가려진 이름" 투성이가
//   되고, 그건 오너에게 **있지도 않은 문제를 보고하는 것**이다. 그래서 차단과
//   통과를 **양쪽 다** 테스트한다.

test("★이메일 모양은 그 부분만 가린다 — 나머지 이름은 살린다", () => {
  assert.equal(scrubIdentityLike("hong@example.com"), REDACTED_IDENTITY_LABEL);
  assert.equal(
    scrubIdentityLike("홍길동 <hong.kim+dev@sub.example.co.kr>"),
    `홍길동 <${REDACTED_IDENTITY_LABEL}>`
  );
});

test("★계정 uid 모양(정확히 28자·대소문자·숫자 혼재)을 가린다", () => {
  const uid = "aB3dEfGhIjKlMnOpQrStUvWxYz01"; // 28자, 혼재
  assert.equal(uid.length, 28);
  assert.equal(scrubIdentityLike(uid), REDACTED_IDENTITY_LABEL);
  assert.equal(
    scrubIdentityLike(`팀 ${uid} 프로젝트`),
    `팀 ${REDACTED_IDENTITY_LABEL} 프로젝트`
  );
});

test("★과잉 차단 금지 — 멀쩡한 이름은 그대로 통과한다", () => {
  // 화면이 없는 문제를 보고하지 않게 하는 쪽의 테스트다.
  for (const ok of [
    "backend-1",
    "orchestrator-claude-p1",
    "홍길동",
    "John Kim",
    "마블로 v3 백엔드",
    "team-usage-overview",
    "abcdefghijklmnopqrstuvwxyzab", // 28자지만 소문자뿐 → uid 모양 아님
    "ABCDEFGHIJKLMNOPQRSTUVWXYZAB", // 28자지만 대문자뿐
    "aB3dEfGhIjKlMnOpQrStUvWxYz012", // 29자 → uid 아님
    "aB3dEfGhIjKlMnOpQrStUvWxY", // 25자 → uid 아님
  ]) {
    assert.equal(scrubIdentityLike(ok), ok, `과잉 차단: ${ok}`);
  }
});

test("★null(이름 미상)과 (가려짐)(있는데 못 보여줌)은 다른 값이다", () => {
  assert.equal(scrubIdentityLike(null), null);
  assert.equal(scrubIdentityLike("   "), null);
  assert.notEqual(REDACTED_IDENTITY_LABEL, null);
});

test("★표시명을 이메일로 해 둔 멤버가 있어도 봉투에 이메일이 안 실린다", () => {
  const folded = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_A,
        actor_kind: "worker",
        rows_n: 1,
        rows_zero: 0,
        input_tokens: 1,
        output_tokens: 1,
        cost_usd: 1,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      // ★사용자가 표시명을 이메일로 정해 둔 경우. 필드명은 displayName 이라
      //   어떤 키 검사도 안 걸린다 — 값을 봐야 잡힌다.
      displayNames: new Map([[UID_A, "hong@example.com"]]),
      projectNames: new Map([["p1", "정산 hong@example.com 프로젝트"]]),
    }
  );
  const res = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
    folded,
  });
  const json = JSON.stringify(res);
  assert.equal(json.includes("hong@example.com"), false);
  assert.equal(json.includes("@example.com"), false);
  assert.equal(res.byMember[0]?.displayName, REDACTED_IDENTITY_LABEL);
  assert.equal(res.byProject[0]?.projectName, `정산 ${REDACTED_IDENTITY_LABEL} 프로젝트`);
});

// ── 18. ★스캐너가 실제로 잡는지 검사한다(위양성 방지) ────────────────────────
//
// 형제 티켓이 제안한 것: 패턴이 다 죽어 있으면 §16 의 본 검사가 **조용히 통과**한다.
// 검사기를 검사하지 않으면 "통과" 가 "안 돌았다" 와 구분되지 않는다.

test("★노트 스캐너가 운영자 전용 문장을 실제로 잡는다(검사기의 검사)", () => {
  const forbidden: ReadonlyArray<readonly [RegExp, string]> = [
    [/npm run/, "npm run provision:team-usage -- --apply"],
    [/TEAM_USAGE_[A-Z_]/, "TEAM_USAGE_EFFECTIVE_FROM 미설정"],
    [/PERSON_AXIS_[A-Z_]/, "PERSON_AXIS_EFFECTIVE_FROM 게이트"],
    [/ANALYTICS_ID_SALT/, "ANALYTICS_ID_SALT 미설정"],
    [/docs\//, "docs/team-usage-overview-design-2026-08-21.md"],
    [/\.ts\b/, "personAxis.ts 참조"],
    [/§/, "설계 §5.1 참조"],
    [/cd v3/, "cd v3/functions 로 이동"],
    [/cost_logs|v_team_usage|BigQuery|Firestore/, "cost_logs 를 읽는다"],
  ];
  // 각 패턴이 자기 미끼 문장을 **반드시** 잡아야 한다. 하나라도 안 잡으면
  // 그 패턴은 죽어 있는 것이고, 본 검사는 그만큼 눈이 먼 상태다.
  for (const [re, bait] of forbidden) {
    assert.equal(re.test(bait), true, `패턴이 죽어 있다: ${re} / 미끼: ${bait}`);
  }
  // 그리고 멀쩡한 문장은 어느 패턴에도 안 걸려야 한다(위양성 방지).
  const clean = "본인 사용량은 지금도 볼 수 있습니다.";
  for (const [re] of forbidden) {
    assert.equal(re.test(clean), false, `위양성: ${re}`);
  }
});

test("★신원 스캐너도 실제로 잡는지 검사한다", () => {
  // 미끼가 안 잡히면 §17 의 통과 테스트만 남아 검사가 눈이 먼다.
  assert.notEqual(scrubIdentityLike("a@b.co"), "a@b.co");
  assert.notEqual(
    scrubIdentityLike("aB3dEfGhIjKlMnOpQrStUvWxYz01"),
    "aB3dEfGhIjKlMnOpQrStUvWxYz01"
  );
});


// ── 19. ★정규식 상태·구분자 — 형제 티켓이 데인 두 자리 ──────────────────────
//
// (1) `g` 플래그 정규식을 공유하면 `lastIndex` 가 호출 간에 살아남아 어느 호출이
//     **조용히** 못 잡는다. 예외도 안 나고 값만 틀린다.
// (2) 이메일 TLD 를 넓게 잡으면 **구분자를 삼켜** 목록이 뭉개진다.
//
// 둘 다 "지금은 맞게 동작한다" 로 넘어가면 안 되는 부류다 — 실패가 조용하기
// 때문에, 나중에 깨져도 아무도 모른다. 그래서 성질 자체를 테스트로 고정한다.

test("★같은 입력을 연속 호출해도 결과가 흔들리지 않는다(정규식 상태 공유 금지)", () => {
  for (const input of [
    "a@x.com, b@y.com",
    "홍길동 <a@b.com>",
    "aB3dEfGhIjKlMnOpQrStUvWxYz01, aB3dEfGhIjKlMnOpQrStUvWxYz02",
  ]) {
    const first = scrubIdentityLike(input);
    // 세 번 연속 — lastIndex 가 살아남으면 2회차부터 갈린다.
    assert.equal(scrubIdentityLike(input), first, `2회차가 다르다: ${input}`);
    assert.equal(scrubIdentityLike(input), first, `3회차가 다르다: ${input}`);
  }
});

test("★가리기가 구분자를 삼키지 않는다 — 목록이 뭉개지면 안 된다", () => {
  assert.equal(
    scrubIdentityLike("a@x.com, b@y.com"),
    `${REDACTED_IDENTITY_LABEL}, ${REDACTED_IDENTITY_LABEL}`
  );
  assert.equal(
    scrubIdentityLike("a@x.com; b@y.com; c@z.co.kr"),
    `${REDACTED_IDENTITY_LABEL}; ${REDACTED_IDENTITY_LABEL}; ${REDACTED_IDENTITY_LABEL}`
  );
  // 문장 끝 마침표도 살아남는다(도메인 클래스가 삼키지 않는다).
  assert.equal(
    scrubIdentityLike("문의: a@x.com 입니다."),
    `문의: ${REDACTED_IDENTITY_LABEL} 입니다.`
  );
});

test("★한 문자열에 여러 개가 있어도 전부 가린다(첫 개만 가리고 끝나지 않는다)", () => {
  const out = scrubIdentityLike("a@x.com / b@y.com / c@z.io") ?? "";
  assert.equal(out.includes("@"), false);
  assert.equal(out.split(REDACTED_IDENTITY_LABEL).length - 1, 3);
});

test("★가린 뒤 다시 가려도 같다(멱등) — 캐시 경로가 두 번 지나도 안전하다", () => {
  const once = scrubIdentityLike("홍길동 <a@b.com>");
  assert.equal(scrubIdentityLike(once), once);
});


// ── 20. ★조용한 절단 금지 + 임계값은 문장이 아니라 값으로 ───────────────────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 자기 문장에 임계값을 박아 두고 **주석의 규율과
// 정면으로 어긋난** 걸 잡았다. 그 검사가 초록이었던 이유가 더 중요하다 —
// `/\d/` 만 봐서 **한글 수사("여섯 시간")를 놓쳤다.** 규칙의 글자만 검사하고 뜻은
// 안 검사한 거짓 안심이다.
//
// 그 지적으로 내 쪽을 훑었더니 문장 문제는 없었고(임계값이 문장에 없다),
// ★대신 **더 나쁜 걸 찾았다: 프로젝트 상한에서 조용히 잘리고 있었다.**
// 오너가 26개 프로젝트를 가지면 25개만 더해 놓고 화면은 "이번 달 팀 지출" 이라고
// 말한다. 숫자가 조용히 틀린다.

test("★상한을 넘으면 자르되 **잘린 개수를 센다**", () => {
  const many = Array.from({ length: 30 }, (_, i) => `p${i}`);
  const { ids, omitted } = capProjectScope(many);
  assert.equal(ids.length, TEAM_USAGE_MAX_PROJECTS_IN_SCOPE);
  assert.equal(omitted, 30 - TEAM_USAGE_MAX_PROJECTS_IN_SCOPE);
  // 상한 이하면 아무것도 안 잘린다.
  assert.deepEqual(capProjectScope(["a", "b"]), { ids: ["a", "b"], omitted: 0 });
  // 정확히 상한이면 경계에서 안 잘린다.
  const exact = Array.from({ length: TEAM_USAGE_MAX_PROJECTS_IN_SCOPE }, (_, i) => `p${i}`);
  assert.equal(capProjectScope(exact).omitted, 0);
});

test("★잘렸으면 봉투가 그 사실을 말한다 — 합계가 전체가 아니라고", () => {
  const truncated = envelope({ projectsOmitted: 5 });
  assert.equal(truncated.teamUsage.projectsOmitted, 5);
  assert.equal(truncated.teamUsage.projectsTruncatedNoteCode, "projects_truncated");
  assert.ok(truncated.teamUsage.projectsTruncatedNote?.includes("전체 프로젝트의 합이"));

  // 안 잘렸으면 조용하다 — 없는 경고를 그리지 않는다.
  const clean = envelope();
  assert.equal(clean.teamUsage.projectsOmitted, 0);
  assert.equal(clean.teamUsage.projectsTruncatedNoteCode, null);
  assert.equal(clean.teamUsage.projectsTruncatedNote, null);
});

test("★임계값은 문장이 아니라 값으로 나간다(판정 상수 그 자체가 출처)", () => {
  const res = envelope();
  assert.equal(res.criteria.maxRangeDays, TEAM_USAGE_MAX_RANGE_DAYS);
  assert.equal(res.criteria.maxProjectsInScope, TEAM_USAGE_MAX_PROJECTS_IN_SCOPE);
  assert.equal(res.criteria.cacheTtlSeconds, TEAM_USAGE_CACHE_TTL_SECONDS);
  assert.equal(
    res.criteria.manualRefreshMinIntervalSeconds,
    TEAM_USAGE_MANUAL_REFRESH_MIN_INTERVAL_MS / 1000
  );
  // 게이트가 닫혀 있어도 실린다 — 화면이 조건 없이 읽는다.
  assert.equal(res.teamUsage.state, "disabled");
  assert.ok(res.criteria.maxRangeDays > 0);
});

test("★사용자 문장에 임계값이 박혀 있지 않다 — 아라비아 숫자도 한글 수사도", () => {
  // ★`/\d/` 만 보면 "여섯 시간" 을 놓친다(형제 티켓이 실제로 놓쳤다).
  //   규칙은 "임계값을 문장에 넣지 마라" 인데 검사가 그보다 좁으면 거짓 안심이다.
  // ★`도` 는 부정 관용구다 — "한 건도 기록되지 않았습니다" 는 임계값이 아니라
  //   "하나도 없다" 는 **사실**이다. 이걸 안 빼면 검사가 과잉 차단으로 틀린다.
  //   (형제 티켓은 검사가 규칙보다 **좁아서** 놓쳤고, 내 첫 판은 **넓어서** 멀쩡한
  //    문장을 잡았다 — 방향만 반대일 뿐 '검사가 규칙과 다르다' 는 같은 실패다.)
  const COUNTER = "(시간|분|초|일|주|달|개월|년|번|건|개|명|자|가지)";
  const ARABIC_THRESHOLD = new RegExp(`\\d+\\s*${COUNTER}(?!도)`);
  const KOREAN_THRESHOLD = new RegExp(
    `(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른)\\s*${COUNTER}(?!도)`
  );
  for (const code of TEAM_USAGE_NOTE_CODES) {
    const text = TEAM_USAGE_NOTE_TEXT_KO[code];
    assert.equal(
      ARABIC_THRESHOLD.test(text),
      false,
      `${code} 문장에 임계값(아라비아)이 박혀 있다: ${text}`
    );
    assert.equal(
      KOREAN_THRESHOLD.test(text),
      false,
      `${code} 문장에 임계값(한글 수사)이 박혀 있다: ${text}`
    );
  }
});

test("★검사기의 검사 — 임계값 패턴이 실제로 잡는다", () => {
  // ★`도` 는 부정 관용구다 — "한 건도 기록되지 않았습니다" 는 임계값이 아니라
  //   "하나도 없다" 는 **사실**이다. 이걸 안 빼면 검사가 과잉 차단으로 틀린다.
  //   (형제 티켓은 검사가 규칙보다 **좁아서** 놓쳤고, 내 첫 판은 **넓어서** 멀쩡한
  //    문장을 잡았다 — 방향만 반대일 뿐 '검사가 규칙과 다르다' 는 같은 실패다.)
  const COUNTER = "(시간|분|초|일|주|달|개월|년|번|건|개|명|자|가지)";
  const ARABIC_THRESHOLD = new RegExp(`\\d+\\s*${COUNTER}(?!도)`);
  const KOREAN_THRESHOLD = new RegExp(
    `(한|두|세|네|다섯|여섯|일곱|여덟|아홉|열|스무|스물|서른)\\s*${COUNTER}(?!도)`
  );
  assert.equal(ARABIC_THRESHOLD.test("최대 365일까지 조회합니다"), true);
  assert.equal(KOREAN_THRESHOLD.test("'정체' 는 여섯 시간 동안 …"), true);
  assert.equal(KOREAN_THRESHOLD.test("한 달에 한 번만 가능합니다"), true);
  // 날짜·비율 같은 **사실**은 임계값이 아니다 — 걸리면 안 된다.
  assert.equal(ARABIC_THRESHOLD.test("2026-06-22 이후"), false);
  assert.equal(ARABIC_THRESHOLD.test("전체 사용량의 29% 였습니다"), false);
  // ★부정 관용구도 임계값이 아니다 — 과잉 차단 쪽 검사.
  assert.equal(KOREAN_THRESHOLD.test("한 건도 기록되지 않았습니다"), false);
  assert.equal(KOREAN_THRESHOLD.test("한 줄도 내보내지 않습니다"), false);
  // 그래도 진짜 임계값은 계속 잡는다.
  assert.equal(KOREAN_THRESHOLD.test("한 달에 한 번만 가능합니다"), true);
});

test("★사용자 문장에 라틴 낱말이 없다 — 필드명이 새는 길을 문자 종류로 막는다", () => {
  // 형제 티켓이 `criteria`/`withheld` 같은 **평범한 영어 단어**인 필드명을
  // 낱말 목록으로 못 잡은 자리다. 화이트리스트를 늘리는 대신 문자 종류로 막는다 —
  // 새 필드명이 뭐가 됐든 걸린다. (ko 전용 표라서 값싸다.)
  for (const code of TEAM_USAGE_NOTE_CODES) {
    const text = TEAM_USAGE_NOTE_TEXT_KO[code];
    const latin = text.match(/[A-Za-z][A-Za-z0-9_]+/g);
    assert.equal(
      latin,
      null,
      `${code} 문장에 라틴 낱말이 있다(필드명·상수명 유출 의심): ${latin?.join(", ")}`
    );
  }
  // 검사기의 검사 — 실제로 잡는지.
  assert.notEqual("기준 시간은 criteria 에 있습니다".match(/[A-Za-z][A-Za-z0-9_]+/g), null);
});


// ── 21. ★조용한 절단이 파생 판정에 물리면 누락이 아니라 **오탐**이다 ─────────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 잘린 에이전트 목록으로 '주인 없는 클레임' 을
// 판정해 **멀쩡한 티켓을 거짓 경보로** 띄운 걸 잡고 "네 쪽도 절단이 파생 판정에
// 물린 자리가 있는지 봐라" 고 알려줬다. 있었다 — 그리고 더 나쁜 자리였다.
//
// 시나리오: 어떤 멤버가 **포함된 프로젝트와 잘린 프로젝트 양쪽**에 속해 있고,
// 이번 창의 사용량이 잘린 쪽에만 있었다. 그러면 명부에는 있는데 행이 없으므로
// `hasRows: false` 가 찍히고, 화면은 그 옆에 "0 은 안 썼다가 아니라 안 보냈다일
// 수 있습니다" 를 그린다.
//
// ★즉 **절단 부작용이 그 사람의 성실성 문제로 번역된다.** 숫자가 작게 나오는 것과
//   차원이 다르다 — 없던 문제를 만들어내고, 그 대상이 사람이다.

const TRUNCATED_FOLD_ROWS: TeamUsageDailyRow[] = [
  {
    day: "2026-08-20",
    project_id: "p1",
    account_uid: UID_A,
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    input_tokens: 5,
    output_tokens: 5,
    cost_usd: 3,
  },
];

test("★스코프가 잘리면 '기록 없음' 을 단정하지 않는다(false 가 아니라 null)", () => {
  const truncated = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
    scopeTruncated: true,
  });
  const a = truncated.byMember.find((m) => m.memberKey === teamMemberKey(UID_A, SALT));
  const b = truncated.byMember.find((m) => m.memberKey === teamMemberKey(UID_B, SALT));
  // 있는 건 사실이므로 true 는 그대로다.
  assert.equal(a?.hasRows, true);
  // ★없는 쪽만 모름(null)이다 — 잘린 프로젝트에 있었을 수 있다.
  assert.equal(b?.hasRows, null);
  // 그리고 "몇 명이 안 썼나" 도 세지 않는다.
  assert.equal(truncated.coverage.membersWithNoRows, null);
});

test("★안 잘렸으면 판정한다 — 모름을 남발하지 않는다", () => {
  const complete = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  const b = complete.byMember.find((m) => m.memberKey === teamMemberKey(UID_B, SALT));
  // ★잘리지 않았으면 "기록 없음" 은 진짜 사실이다. null 로 뭉개면 화면이
  //   말할 수 있는 것도 못 말하게 된다.
  assert.equal(b?.hasRows, false);
  assert.equal(complete.coverage.membersWithNoRows, 1);
  assert.equal(complete.coverage.scopeNoteCode, null);
});

test("★잘린 스코프 위의 비율은 분모를 밝힌다", () => {
  const truncated = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    scopeTruncated: true,
  });
  assert.equal(truncated.coverage.scopeNoteCode, "coverage_partial_scope");
  assert.ok(truncated.coverage.scopeNote?.includes("전체 기준이 아닙니다"));
});

test("★캐시 경로도 같은 문을 지난다 — 절단 판정이 라이브에서만 살면 안 된다", () => {
  const cached = foldCachedTeamUsage(toCacheRows(TRUNCATED_FOLD_ROWS, SALT), {
    todayUtc: "2026-08-21",
    includeMemberBreakdown: true,
    rosterMemberKeys: [
      teamMemberKey(UID_A, SALT) ?? "",
      teamMemberKey(UID_B, SALT) ?? "",
    ],
    scopeTruncated: true,
  });
  const b = cached.byMember.find((m) => m.memberKey === teamMemberKey(UID_B, SALT));
  assert.equal(b?.hasRows, null);
  assert.equal(cached.coverage.membersWithNoRows, null);
  assert.equal(cached.coverage.scopeNoteCode, "coverage_partial_scope");
});

test("★`null`(모름) · `false`(기록 없음) · `0`(썼는데 0) 은 셋 다 다르다", () => {
  // 이 화면의 전부인 3분법이 멤버 축에서도 성립하는지 확인한다.
  const zeroSpend = foldTeamUsage(
    [
      {
        day: "2026-08-20",
        project_id: "p1",
        account_uid: UID_B,
        actor_kind: "worker",
        rows_n: 4,
        rows_zero: 4,
        input_tokens: 0,
        output_tokens: 0,
        cost_usd: 0,
      },
    ],
    {
      todayUtc: "2026-08-21",
      memberSalt: SALT,
      includeMemberBreakdown: true,
      rosterUids: [UID_B],
    }
  );
  const b = zeroSpend.byMember[0];
  // 기록은 있고 금액이 0 이다 — "기록 없음" 이 아니다.
  assert.equal(b.hasRows, true);
  assert.equal(b.costUsd, 0);
  assert.equal(zeroSpend.coverage.membersWithNoRows, 0);
});


// ── 22. ★카운트는 목록에서 센다 — 따로 계산하면 목록과 어긋난다 ─────────────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 자기 `summary.attentionCount` 에서 같은 걸
// 찾고 알려줬다: 좁힌 목록과 매퍼가 준 카운트가 갈리면 **"주의 3건" 이라 써 놓고
// 2건만 보이는 화면**이 된다. ★그건 숫자가 틀린 것보다 나쁘다 — 오너가 못 찾은
// 1건을 계속 찾는다.
//
// 내 `membersWithNoRows` 가 실제로 두 자리에서 어긋나고 있었다.

test("★명부에 없는 전(前) 멤버가 행을 남겨도 카운트가 목록과 일치한다", () => {
  const EX = "CCCCCCCCCCCCCCCCCCCCCCCCCCCC";
  const D = "DDDDDDDDDDDDDDDDDDDDDDDDDDDD";
  const row = (uid: string): TeamUsageDailyRow => ({
    day: "2026-08-20",
    project_id: "p1",
    account_uid: uid,
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 1,
  });
  // 명부는 A·B·D 인데 행은 A 와 **명부에 없는** EX 가 남겼다.
  const folded = foldTeamUsage([row(UID_A), row(EX)], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B, D],
  });
  const listed = folded.byMember.filter((m) => m.hasRows === false).length;
  // ★예전 식(`명부수 − 행있는수`)은 3 − 2 = 1 을 냈지만 목록에는 2명(B·D)이 있었다.
  assert.equal(listed, 2);
  assert.equal(folded.coverage.membersWithNoRows, listed);
});

test("★솔트가 없어 목록에서 빠진 멤버가 카운트에 남지 않는다", () => {
  const folded = foldTeamUsage([], {
    todayUtc: "2026-08-21",
    memberSalt: null, // 가명을 못 만든다 → 목록이 통째로 빈다
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  assert.deepEqual(folded.byMember, []);
  // 목록이 비었으면 "안 쓴 사람 2명" 이라고 말하면 안 된다.
  assert.equal(folded.coverage.membersWithNoRows, 0);
});

test("★멤버 분해가 없는 스코프(self)에서는 세지 않는다(null)", () => {
  const folded = foldTeamUsage([], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: false,
    rosterUids: [UID_A],
  });
  assert.deepEqual(folded.byMember, []);
  // 목록 자체가 없는 화면에서 "1명이 안 썼다" 는 셀 대상이 없는 숫자다.
  assert.equal(folded.coverage.membersWithNoRows, null);
});

test("★카운트와 목록은 어떤 조합에서도 어긋나지 않는다(불변식)", () => {
  const D = "DDDDDDDDDDDDDDDDDDDDDDDDDDDD";
  const row = (uid: string): TeamUsageDailyRow => ({
    day: "2026-08-20",
    project_id: "p1",
    account_uid: uid,
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    cost_usd: 1,
  });
  for (const rows of [[], [row(UID_A)], [row(UID_A), row(UID_B)], [row(D)]]) {
    for (const roster of [[], [UID_A], [UID_A, UID_B], [UID_A, UID_B, D]]) {
      for (const truncated of [false, true]) {
        const folded = foldTeamUsage(rows, {
          todayUtc: "2026-08-21",
          memberSalt: SALT,
          includeMemberBreakdown: true,
          rosterUids: roster,
          scopeTruncated: truncated,
        });
        const listed = folded.byMember.filter((m) => m.hasRows === false).length;
        const counted = folded.coverage.membersWithNoRows;
        if (truncated) {
          // 잘렸으면 세지 않는다 — 그리고 목록에도 false 가 없어야 한다.
          assert.equal(counted, null);
          assert.equal(listed, 0);
        } else {
          assert.equal(counted, listed, `불일치 rows=${rows.length} roster=${roster.length}`);
        }
      }
    }
  }
});


// ── 23. ★어느 짝이 불변식인가 — 화면이 대조를 걸 수 있게 ────────────────────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 T9 과 주고받으며 실측한 것: 어느 짝이 같아야
// 하는지 안 적어 두면 화면이 **대조를 못 걸거나 틀린 짝을 걸어 오경보**를 낸다.
//
// ★그리고 이 화면에는 세 번째가 있었다 — **맞는 짝인데 정확히 같지는 않다.**
//   실측으로 `Σ byDay.costUsd` 가 `totals.costUsd` 와 1e-6 벌어졌다(버킷마다 따로
//   반올림하므로). 정확 비교를 걸었으면 **멀쩡한 응답이 매번 빨개졌을 것**이고,
//   그건 안전장치가 반대로 도는 자리다.

const DRIFT_ROWS: TeamUsageDailyRow[] = [
  {
    day: "2026-08-19",
    project_id: "p1",
    account_uid: UID_A,
    model: "m1",
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    input_tokens: 3,
    output_tokens: 4,
    cost_usd: 0.1234567,
  },
  {
    day: "2026-08-20",
    project_id: "p2",
    account_uid: UID_B,
    model: "m2",
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    input_tokens: 5,
    output_tokens: 6,
    cost_usd: 0.7654321,
  },
  {
    day: "2026-08-20",
    project_id: "p1",
    account_uid: UID_A,
    model: "m1",
    actor_kind: "worker",
    rows_n: 1,
    rows_zero: 0,
    input_tokens: 1,
    output_tokens: 1,
    cost_usd: 0.0000004,
  },
];

test("★버킷 합과 총계는 **정확히** 같지 않다 — 허용오차 없이 대조하면 오경보", () => {
  const folded = foldTeamUsage(DRIFT_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  const sum = folded.byDay.reduce((a, d) => a + d.costUsd, 0);
  // ★실측: 벌어진다. 이 사실을 테스트가 알고 있어야 다음 사람이 "정확 비교로
  //   바꾸자" 고 할 때 여기서 막힌다.
  assert.notEqual(sum, folded.totals.costUsd);
  // 그리고 허용오차 안에는 들어온다.
  assert.ok(
    Math.abs(sum - folded.totals.costUsd) <= sumToleranceUsd(folded.byDay.length),
    `허용오차를 넘었다: ${Math.abs(sum - folded.totals.costUsd)}`
  );
});

test("★불변식 목록의 금액 짝이 허용오차 안에서 성립한다", () => {
  const folded = foldTeamUsage(DRIFT_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  const buckets: Array<[string, ReadonlyArray<{ costUsd: number }>]> = [
    ["byDay.costUsd", folded.byDay],
    ["byProject.costUsd", folded.byProject],
    ["byModel.costUsd", folded.byModel],
    ["byActorKind.costUsd", folded.byActorKind],
  ];
  for (const [name, arr] of buckets) {
    assert.ok(
      TEAM_USAGE_SUMMARY_INVARIANTS.some((i) => i.name === name),
      `${name} 이 불변식 목록에 없다`
    );
    const sum = arr.reduce((a, b) => a + b.costUsd, 0);
    assert.ok(
      Math.abs(sum - folded.totals.costUsd) <= sumToleranceUsd(arr.length),
      `${name} 이 허용오차를 넘었다`
    );
  }
  // 정수 축은 정확하다.
  assert.equal(
    folded.totals.tokens,
    folded.totals.inputTokens + folded.totals.outputTokens
  );
});

test("★일부러 다른 짝은 불변식 목록에 **없다** (목록이 넓어지는 걸 막는다)", () => {
  const invariantNames = new Set(TEAM_USAGE_SUMMARY_INVARIANTS.map((i) => i.name));
  for (const m of TEAM_USAGE_DELIBERATE_MISMATCHES) {
    assert.equal(
      invariantNames.has(m.pair),
      false,
      `${m.pair} 가 양쪽 목록에 다 있다`
    );
    // 이유 없이 "다를 수 있음" 으로 미루지 못하게 한다.
    assert.ok(m.why.length > 30, `${m.pair} 에 이유가 부실하다`);
  }
  assert.ok(TEAM_USAGE_DELIBERATE_MISMATCHES.length >= 4);
});

test("★'일부러 다른 짝' 이 실제로 다를 수 있다는 걸 재현한다", () => {
  // (1) 솔트가 없으면 멤버 분해는 비고 총계는 산다.
  const noSalt = foldTeamUsage(DRIFT_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: null,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  assert.deepEqual(noSalt.byMember, []);
  assert.ok(noSalt.totals.costUsd > 0);

  // (2) 스코프에 있어도 사용량이 없는 프로젝트는 byProject 에 안 나온다.
  const oneProject = foldTeamUsage([DRIFT_ROWS[0]], {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    projectNames: new Map([
      ["p1", "쓴 프로젝트"],
      ["p2", "안 쓴 프로젝트"],
    ]),
  });
  assert.equal(oneProject.byProject.length, 1); // 이름은 둘인데 행은 하나
});


// ── 24. ★판정을 뗀 것이 "문제 없음" 으로 읽히지 않게 — 타입 **과** 문장 ───────
//
// 형제 티켓(IcjPf2SEs0ORUGLZgCHS)이 자기 '정체' 판정을 뗄 때 문장에
// "정체가 아니라는 뜻은 아닙니다" 를 넣었고, 나는 타입(`null`)으로만 막고 있었다.
// 둘 다 필요하다는 게 그쪽 지적이고 맞다:
//
//   타입 — 프론트가 `null` 을 `false` 로 **접을 수 없게** 한다. 다만 프론트가
//          지켜야 성립한다.
//   문장 — 화면이 뭘 그리든 **오너에게 바로 닿는다.** 방어선이 한 겹 앞이다.
//
// ★오탐을 고치려다 반대쪽 거짓말을 하는 자리라 둘 다 둔다.

test("★잘려서 판정을 못 했으면 '기록이 없다는 뜻이 아니다' 를 문장으로도 말한다", () => {
  const folded = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
    scopeTruncated: true,
  });
  // 타입 방어
  const b = folded.byMember.find((m) => m.memberKey === teamMemberKey(UID_B, SALT));
  assert.equal(b?.hasRows, null);
  assert.equal(folded.coverage.membersWithNoRows, null);
  // ★문장 방어 — 화면이 타입을 안 봐도 오너가 오독하지 않게.
  assert.equal(folded.coverage.memberRowsUnknownNoteCode, "member_rows_unknown");
  assert.ok(folded.coverage.memberRowsUnknownNote?.includes("없다는 뜻이 아닙니다"));
});

test("★안 잘렸으면 그 문장을 그리지 않는다 — 없는 불확실성을 만들지 않는다", () => {
  const folded = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
  });
  assert.equal(folded.coverage.memberRowsUnknownNoteCode, null);
  assert.equal(folded.coverage.memberRowsUnknownNote, null);
});

test("★멤버 목록이 없는 스코프에서는 그 문장도 없다 — 오독할 대상이 없다", () => {
  const folded = foldTeamUsage(TRUNCATED_FOLD_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: false,
    scopeTruncated: true,
  });
  assert.deepEqual(folded.byMember, []);
  assert.equal(folded.coverage.memberRowsUnknownNoteCode, null);
});

// ── 25. ★건수는 정수다 — 소수가 들어오면 여기서 먼저 죽는다 ─────────────────
//
// 형제 티켓이 자기 응답의 모든 숫자가 정수인지 검사해서 "누가 실수 평균·비율을
// 넣으면 거기서 먼저 죽고, 그때 허용오차를 **의식적으로** 설계하게 된다" 로 갔다.
// 내 쪽은 금액이 실수라 전량 정수 검사는 못 하지만, **건수 축**에는 그대로 적용된다.
// 건수에 소수가 들어오면 그건 평균·추정이 섞였다는 뜻이고, 그 순간 "몇 건" 이라는
// 라벨이 거짓이 된다.

test("★건수 필드는 전부 정수다(평균·추정이 섞이면 여기서 막힌다)", () => {
  const folded = foldTeamUsage(DRIFT_ROWS, {
    todayUtc: "2026-08-21",
    memberSalt: SALT,
    includeMemberBreakdown: true,
    rosterUids: [UID_A, UID_B],
    unattributedRows: 7,
  });
  const res = envelope({
    gate: resolveTeamUsageGate({ [TEAM_USAGE_EFFECTIVE_FROM_ENV]: "2026-01-01" }),
    folded,
    projectsOmitted: 3,
  });
  const counts: Array<[string, number | null]> = [
    ["rowsInWindow", res.coverage.rowsInWindow],
    ["unattributedRows", res.coverage.unattributedRows],
    ["membersWithNoRows", res.coverage.membersWithNoRows],
    ["projectsInScope", res.teamUsage.projectsInScope],
    ["projectsOmitted", res.teamUsage.projectsOmitted],
    ["rangeDays", res.rangeDays],
    ["maxRangeDays", res.criteria.maxRangeDays],
    ["maxProjectsInScope", res.criteria.maxProjectsInScope],
    ["cacheTtlSeconds", res.criteria.cacheTtlSeconds],
    ["manualRefreshMinIntervalSeconds", res.criteria.manualRefreshMinIntervalSeconds],
    ["totals.inputTokens", res.totals.inputTokens],
    ["totals.outputTokens", res.totals.outputTokens],
    ["totals.tokens", res.totals.tokens],
    ["totals.cacheReadTokens", res.totals.cacheReadTokens],
    ["totals.cacheWriteTokens", res.totals.cacheWriteTokens],
  ];
  for (const [name, v] of counts) {
    if (v === null) continue; // null = 모른다. 정수 여부를 물을 값이 아니다.
    assert.equal(Number.isInteger(v), true, `${name} 이 정수가 아니다: ${v}`);
  }
  // 멤버·일자별 토큰도 정수다.
  for (const m of res.byMember) {
    assert.equal(Number.isInteger(m.tokens), true, `byMember.tokens: ${m.tokens}`);
  }
  for (const d of res.byDay) {
    assert.equal(Number.isInteger(d.tokens), true, `byDay.tokens: ${d.tokens}`);
  }
});
