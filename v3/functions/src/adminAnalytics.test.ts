// adminAnalytics 순수 로직 단위테스트 (marketingContacts.test.ts 규약).
// 실행:
//   tsc src/adminAnalytics.ts src/adminAnalytics.test.ts --outDir .test-out/admin \
//       --module commonjs --target es2020 --esModuleInterop --strict \
//   && node --test .test-out/admin/adminAnalytics.test.js
// package.json: npm run test:admin-analytics
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  parseIncludeAdmin,
  parseMetricMode,
  metricCountExpr,
  coerceNumber,
  buildOnboardingFunnel,
  buildActivationHeadline,
  buildFunnelCoverageMap,
  classifyStepCoverage,
  ONBOARDING_FUNNEL_STEPS,
  ONBOARDING_FAILURE_EVENTS,
  safeRate,
  computeNpsFromStars,
  buildBetaExitGauges,
  BETA_EXIT_TARGETS,
  buildCliSetupSummary,
  buildDemoFunnel,
  buildConsentSummary,
  buildReuseSummary,
  buildSpawnHealth,
  foldKeyCounts,
  buildKpiCockpit,
  buildBetaScorecard,
  SCORECARD_HERO_KEY,
  SCORECARD_SMALL_SAMPLE_MAX,
  buildRetentionCohorts,
  buildActiveUserMetrics,
  buildActivationGateFunnel,
  buildOnboardingStallSummary,
  buildZeroFrictionKpis,
  MULTI_AGENT_TARGET_WINDOW_MINUTES,
  MODEL_CONNECT_ANCHOR_EVENTS,
  modelConnectedPredicateSql,
  buildStreakRetention,
  analyticsUnitLabel,
  countedRate,
  dayNumber,
  dayString,
  daysBetween,
  IDENTITY_SCHEME_SWITCH_ON,
  STREAK_GRID_DAYS,
  ACTIVITY_DEFINITION_INSTALL,
  type UnitDayActivityRow,
  deriveEffectiveModel,
  foldEffectiveModelDistribution,
} from "./adminAnalytics";

// ── parseIncludeAdmin ──────────────────────────────────────────────────────
test("parseIncludeAdmin defaults to false (exclude) when absent", () => {
  assert.equal(parseIncludeAdmin(undefined), false);
  assert.equal(parseIncludeAdmin(null), false);
  assert.equal(parseIncludeAdmin({}), false);
});

test("parseIncludeAdmin only true for boolean true (hardening)", () => {
  assert.equal(parseIncludeAdmin({ includeAdmin: true }), true);
  assert.equal(parseIncludeAdmin({ includeAdmin: false }), false);
  // 문자열/숫자 truthy 는 받지 않는다 — 콜러블은 실제 boolean 을 보낸다.
  assert.equal(parseIncludeAdmin({ includeAdmin: "true" }), false);
  assert.equal(parseIncludeAdmin({ includeAdmin: 1 }), false);
});

// ── parseMetricMode ────────────────────────────────────────────────────────
test("parseMetricMode defaults to 'events' (backward compat) when absent", () => {
  assert.equal(parseMetricMode(undefined), "events");
  assert.equal(parseMetricMode(null), "events");
  assert.equal(parseMetricMode({}), "events");
  // 알 수 없는 값은 'events' 로 폴백(하위호환).
  assert.equal(parseMetricMode({ metricMode: "nope" }), "events");
  assert.equal(parseMetricMode({ metricMode: 1 }), "events");
});

test("parseMetricMode selects 'clients' only for exact string", () => {
  assert.equal(parseMetricMode({ metricMode: "clients" }), "clients");
  assert.equal(parseMetricMode({ metricMode: "events" }), "events");
});

// ── metricCountExpr ────────────────────────────────────────────────────────
test("metricCountExpr maps mode → SQL count expression", () => {
  assert.equal(metricCountExpr("events"), "COUNT(*)");
  assert.equal(metricCountExpr("clients"), "COUNT(DISTINCT userId)");
  assert.equal(
    metricCountExpr("clients", "sessionId"),
    "COUNT(DISTINCT sessionId)"
  );
});

test("metricCountExpr rejects unsafe distinct column (injection guard)", () => {
  assert.throws(() => metricCountExpr("clients", "userId; DROP TABLE x"));
  assert.throws(() => metricCountExpr("clients", "1bad"));
  assert.throws(() => metricCountExpr("clients", "a b"));
  // events 모드는 distinctCol 을 안 쓰므로 검증 대상 아님.
  assert.equal(metricCountExpr("events", "anything at all"), "COUNT(*)");
});

// ── coerceNumber ───────────────────────────────────────────────────────────
test("coerceNumber handles BQ int64-as-string and junk", () => {
  assert.equal(coerceNumber(42), 42);
  assert.equal(coerceNumber("822"), 822);
  assert.equal(coerceNumber(undefined), 0);
  assert.equal(coerceNumber(null), 0);
  assert.equal(coerceNumber("nope"), 0);
  assert.equal(coerceNumber(NaN), 0);
});

// ── buildOnboardingFunnel ──────────────────────────────────────────────────
test("funnel: empty row yields all-zero steps, no max-drop", () => {
  const f = buildOnboardingFunnel(undefined, []);
  assert.equal(f.steps.length, ONBOARDING_FUNNEL_STEPS.length);
  for (const s of f.steps) {
    assert.equal(s.clients, 0);
    assert.equal(s.events, 0);
    assert.equal(s.isMaxDrop, false);
  }
  // 첫 단계는 drop 없음.
  assert.equal(f.steps[0].dropFromPrev, null);
  assert.equal(f.steps[0].dropRateFromPrev, null);
  assert.equal(f.failureBranches.length, ONBOARDING_FAILURE_EVENTS.length);
});

test("funnel: computes drop-off and flags the single largest drop (22→6 shape)", () => {
  // first_run 22 → login_attempt 20 → login_success 18 → folder_connected 8
  //   → orchestrator_opened 6 → agent_spawned 6
  // 최대 이탈은 login_success(18) → folder_connected(8) = 10.
  const row = {
    d_install: 22,
    n_install: 22,
    d_first_run: 22,
    n_first_run: 22,
    d_login_attempt: 20,
    n_login_attempt: 24,
    d_login_success: 18,
    n_login_success: 18,
    d_folder_connected: 8,
    n_folder_connected: 8,
    d_orchestrator_opened: 6,
    n_orchestrator_opened: 9,
    d_agent_spawned: 6,
    n_agent_spawned: 40,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));

  assert.equal(byKey.install.clients, 22);
  assert.equal(byKey.install.dropFromPrev, null);
  assert.equal(byKey.first_run.clients, 22);
  assert.equal(byKey.first_run.dropFromPrev, 0);
  assert.equal(byKey.login_attempt.dropFromPrev, 2);
  assert.equal(byKey.folder_connected.dropFromPrev, 10);
  assert.equal(byKey.folder_connected.dropRateFromPrev, 10 / 18);
  assert.equal(byKey.agent_spawned.dropFromPrev, 0);

  // 최대 이탈 구간은 folder_connected 단 한 곳.
  const maxDropSteps = f.steps.filter((s) => s.isMaxDrop);
  assert.equal(maxDropSteps.length, 1);
  assert.equal(maxDropSteps[0].key, "folder_connected");

  // events(발생량)와 clients(도달)는 별개로 보존.
  assert.equal(byKey.agent_spawned.events, 40);
  assert.equal(byKey.agent_spawned.clients, 6);
});

test("funnel: sequential rows stay monotonic across every stage", () => {
  const row = {
    d_install: 11,
    d_first_run: 10,
    d_login_attempt: 9,
    d_login_success: 8,
    d_folder_connected: 6,
    d_orchestrator_opened: 5,
    d_first_conversation: 5,
    d_first_ticket: 5,
    d_agent_spawned: 4,
    d_task_completed: 3,
    d_first_merge: 3,
    d_core_experience: 2,
    d_retained_7d: 1,
  };
  const f = buildOnboardingFunnel(row, []);
  for (let i = 1; i < f.steps.length; i += 1) {
    assert.ok(
      f.steps[i].clients <= f.steps[i - 1].clients,
      `${f.steps[i].key} must be <= ${f.steps[i - 1].key}`
    );
  }
});

test("funnel: failure branches decompose errorCategory (cli_auth vs launch_error)", () => {
  const row = {
    d_orchestrator_blocked: 5,
    n_orchestrator_blocked: 7,
    d_agent_crashed: 3,
    n_agent_crashed: 12,
  };
  const reasonRows = [
    {
      event: "onboarding:orchestrator_blocked",
      category: "cli_auth",
      n: 5,
      clients: 4,
    },
    {
      event: "onboarding:orchestrator_blocked",
      category: "launch_error",
      n: 2,
      clients: 2,
    },
    { event: "agent:crashed", category: "fast_fail_config", n: 8, clients: 2 },
    { event: "agent:crashed", category: "runtime_crash", n: 4, clients: 2 },
    { event: "auth:login_failed", category: null, n: 1, clients: 1 },
  ];
  const f = buildOnboardingFunnel(row, reasonRows);
  const branches = Object.fromEntries(f.failureBranches.map((b) => [b.key, b]));

  const blocked = branches.orchestratorBlocked;
  assert.equal(blocked.clients, 5);
  assert.equal(blocked.events, 7);
  // 내림차순 정렬: cli_auth(5) 먼저.
  assert.equal(blocked.byCategory[0].key, "cli_auth");
  assert.equal(blocked.byCategory[0].count, 5);
  assert.equal(blocked.byCategory[1].key, "launch_error");

  const crashed = branches.agentCrashed;
  assert.equal(crashed.byCategory[0].key, "fast_fail_config");
  assert.equal(crashed.byCategory[0].count, 8);

  // null category → "(none)".
  const loginFailed = branches.loginFailed;
  assert.equal(loginFailed.byCategory[0].key, "(none)");
});

// ── 스폰 이후 활성화 단계 ──────────────────────────────────────────────────
test("funnel: post-spawn activation steps read injected scalars, tagged 'activation'", () => {
  const row = {
    d_first_run: 22,
    d_login_attempt: 20,
    d_login_success: 18,
    d_folder_connected: 8,
    d_orchestrator_opened: 8,
    d_agent_spawned: 8,
    n_agent_spawned: 30,
    // 활성화 단계 — index.ts 순차 CTE 가 주입하는 스칼라.
    d_task_completed: 5,
    n_task_completed: 12,
    d_core_experience: 4, // 스폰 2회+
    d_retained_7d: 2, // 7일내 2세션/2프로젝트
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));

  assert.equal(byKey.task_completed.clients, 5);
  assert.equal(byKey.task_completed.events, 12);
  assert.equal(byKey.task_completed.kind, "activation");
  assert.equal(byKey.core_experience.clients, 4);
  assert.equal(byKey.core_experience.kind, "activation");
  assert.equal(byKey.retained_7d.clients, 2);
  assert.equal(byKey.retained_7d.kind, "activation");

  // reach 본선은 kind='reach'.
  assert.equal(byKey.first_run.kind, "reach");
  assert.equal(byKey.agent_spawned.kind, "reach");
});

test("funnel: max-drop stays within reach steps, never an activation step", () => {
  // activation 감소는 isMaxDrop 후보에서 제외 — 본선 최대 이탈
  // (login_success 18 → folder 3 = 15)이 남는다.
  const row = {
    d_first_run: 22,
    d_login_attempt: 21,
    d_login_success: 18,
    d_folder_connected: 3,
    d_orchestrator_opened: 3,
    d_agent_spawned: 3,
    d_task_completed: 1,
    d_core_experience: 1,
    d_retained_7d: 0,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  // drop 값 자체는 activation 에도 계산된다(참고용).
  assert.equal(byKey.task_completed.dropFromPrev, 2);
  // 그러나 최대 이탈 플래그는 reach 안에서만.
  const flagged = f.steps.filter((s) => s.isMaxDrop);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].key, "folder_connected");
  assert.equal(flagged[0].kind, "reach");
});

// ── 전 구간 확장(티켓 ygoWP1VJ): 설치·첫대화·첫티켓·첫머지 + gating ─────────
test("funnel: 티켓이 요구한 전 스텝이 한 칸도 빠짐없이 존재한다", () => {
  const f = buildOnboardingFunnel(undefined, []);
  const keys = f.steps.map((s) => s.key);
  for (const required of [
    "install",
    "login_success",
    "folder_connected",
    "first_conversation",
    "first_ticket",
    "agent_spawned",
    "task_completed",
    "first_merge",
  ]) {
    assert.ok(keys.includes(required as never), `missing step: ${required}`);
  }
  // needsAuth / authedButUnfunded 는 전진 단계가 아니라 실패 분기로 존재한다.
  const branchKeys = f.failureBranches.map((b) => b.key);
  for (const required of ["spawnBlocked", "needsAuth", "authedButUnfunded"]) {
    assert.ok(branchKeys.includes(required), `missing branch: ${required}`);
  }
});

test("funnel: 비-gating 칸이 하류 이탈률 기준선을 오염시키지 않는다", () => {
  // 첫대화/첫티켓 계측이 아직 0 인 구간(신규 빌드 이전)을 재현한다.
  // 이 둘을 체인에 끼웠다면 agent_spawned 의 drop 이 0→8 로 뒤집혀
  // "스폰 구간에서 8명이 죽었다"는 없는 사실이 만들어진다.
  const row = {
    d_install: 20,
    d_first_run: 20,
    d_login_attempt: 18,
    d_login_success: 16,
    d_folder_connected: 10,
    d_orchestrator_opened: 8,
    d_first_conversation: 0, // 계측 공백
    d_first_ticket: 0, // 계측 공백(오케 MCP 우회)
    d_agent_spawned: 8,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));

  // 기준선은 직전 gating 칸(orchestrator_opened=8) — 공백 칸이 아니다.
  assert.equal(byKey.agent_spawned.dropFromPrev, 0);
  assert.equal(byKey.agent_spawned.conversionFromPrev, 1);
  // 공백 칸 자신의 이탈은 그대로 보인다(숨기지 않는다).
  assert.equal(byKey.first_conversation.dropFromPrev, 8);
  assert.equal(byKey.first_conversation.gating, false);
  assert.equal(byKey.first_ticket.gating, false);
  assert.equal(byKey.agent_spawned.gating, true);
  // 최대 이탈 플래그도 gating 칸 안에서만 — 계측 공백이 '최대 누수'로 둔갑 금지.
  const flagged = f.steps.filter((s) => s.isMaxDrop);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].key, "folder_connected");
});

test("funnel: 단계별 전환율(직전 gating 대비 · 시작 대비)", () => {
  const row = {
    d_install: 20,
    d_first_run: 20,
    d_login_attempt: 10,
    d_login_success: 5,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));

  assert.equal(byKey.install.conversionFromPrev, null);
  assert.equal(byKey.install.conversionFromStart, null);
  assert.equal(byKey.login_attempt.conversionFromPrev, 0.5);
  assert.equal(byKey.login_attempt.conversionFromStart, 0.5);
  assert.equal(byKey.login_success.conversionFromPrev, 0.5);
  assert.equal(byKey.login_success.conversionFromStart, 0.25);
  // 전환율 + 이탈률 = 1 (같은 분모를 쓴다는 계약).
  assert.equal(
    (byKey.login_success.conversionFromPrev ?? 0) +
      (byKey.login_success.dropRateFromPrev ?? 0),
    1
  );
});

test("funnel: 시작 분모 0 이면 전환율은 null (0% 로 오도 금지)", () => {
  const f = buildOnboardingFunnel({ d_agent_spawned: 3 }, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  assert.equal(byKey.agent_spawned.conversionFromStart, null);
  assert.equal(byKey.agent_spawned.conversionFromPrev, null);
  assert.equal(byKey.agent_spawned.dropRateFromPrev, null);
});

test("funnel: 스톨 분기(needsAuth/authedButUnfunded)가 errorCategory 로 쪼개진다", () => {
  const row = {
    d_needs_auth: 4,
    n_needs_auth: 6,
    d_funding_guide_shown: 3,
    n_funding_guide_shown: 5,
    d_spawn_blocked: 2,
    n_spawn_blocked: 2,
  };
  const reasonRows = [
    {
      event: "onboarding:funding_guide_shown",
      category: "authedButUnfunded",
      n: 4,
      clients: 3,
    },
    {
      event: "onboarding:funding_guide_shown",
      category: "authedButBlocked",
      n: 1,
      clients: 1,
    },
    {
      event: "onboarding:spawn_blocked",
      category: "not-authenticated",
      n: 2,
      clients: 2,
    },
  ];
  const f = buildOnboardingFunnel(row, reasonRows);
  const branches = Object.fromEntries(f.failureBranches.map((b) => [b.key, b]));

  assert.equal(branches.needsAuth.clients, 4);
  assert.equal(branches.needsAuth.events, 6);
  assert.equal(branches.authedButUnfunded.clients, 3);
  assert.equal(
    branches.authedButUnfunded.byCategory[0].key,
    "authedButUnfunded"
  );
  assert.equal(branches.authedButUnfunded.byCategory[0].count, 4);
  assert.equal(branches.spawnBlocked.byCategory[0].key, "not-authenticated");
});

test("funnel: note 가 설치·첫티켓의 한계를 감추지 않는다", () => {
  const f = buildOnboardingFunnel(undefined, []);
  assert.match(f.note, /app:first_run 을 대체 신호/);
  assert.match(f.note, /MCP/); // 오케 MCP 우회로 인한 과소계상 명시
  assert.match(f.note, /7일 창/);
});

// ── buildActivationHeadline (★가입 후 24h내 첫 티켓 완료 비율) ──────────────
test("headline: rate = activated / signup base, 24h window", () => {
  const h = buildActivationHeadline({ d_activated_30m: 3, d_signup_base: 12 });
  assert.equal(h.activatedClients, 3);
  assert.equal(h.baseClients, 12);
  assert.equal(h.rate, 3 / 12);
  assert.equal(h.windowMinutes, 24 * 60);
  assert.match(h.label, /24시간/);
});

test("headline: base 0 yields null rate (no divide-by-zero)", () => {
  const h = buildActivationHeadline({ d_activated_30m: 0, d_signup_base: 0 });
  assert.equal(h.activatedClients, 0);
  assert.equal(h.baseClients, 0);
  assert.equal(h.rate, null);
});

test("headline: absent row is all-zero, null rate; custom window respected", () => {
  const h = buildActivationHeadline(undefined, 60);
  assert.equal(h.activatedClients, 0);
  assert.equal(h.baseClients, 0);
  assert.equal(h.rate, null);
  assert.equal(h.windowMinutes, 60);
  assert.match(h.label, /1시간/);
});

test("funnel: result carries headline built from same row", () => {
  const f = buildOnboardingFunnel(
    { d_task_completed: 4, d_activated_30m: 4, d_signup_base: 10 },
    []
  );
  assert.equal(f.headline.activatedClients, 4);
  assert.equal(f.headline.baseClients, 10);
  assert.equal(f.headline.rate, 0.4);
  assert.equal(
    f.steps.find((s) => s.key === "task_completed")?.clients,
    f.headline.activatedClients
  );
});

// ════════════════════════════════════════════════════════════════════════════
// KPI 코크핏 — 베타종료 게이지 · NPS · 신규 온보딩 이벤트 · 리텐션 · 스폰 헬스
// ════════════════════════════════════════════════════════════════════════════

// ── safeRate ────────────────────────────────────────────────────────────────
test("safeRate: divides, returns null on zero denominator (no 0% mislead)", () => {
  assert.equal(safeRate(3, 12), 0.25);
  assert.equal(safeRate("8", "10"), 0.8);
  assert.equal(safeRate(5, 0), null);
  assert.equal(safeRate(0, 0), null);
  assert.equal(safeRate("junk", 10), 0); // 분자 junk → 0/10 = 0
});

// ── computeNpsFromStars ──────────────────────────────────────────────────────
test("nps: 5=promoter, 4=passive, 1-3=detractor; nps=(pro-det)/total*100", () => {
  // 5점×6, 4점×2, 3점×1, 1점×1 = total 10. pro=6 det=2 → nps=(6-2)/10*100=40.
  const r = computeNpsFromStars([
    { rating: 5, count: 6 },
    { rating: 4, count: 2 },
    { rating: 3, count: 1 },
    { rating: 1, count: 1 },
  ]);
  assert.equal(r.total, 10);
  assert.equal(r.promoters, 6);
  assert.equal(r.passives, 2);
  assert.equal(r.detractors, 2);
  assert.equal(r.nps, 40);
  assert.equal(r.avgRating, (5 * 6 + 4 * 2 + 3 * 1 + 1 * 1) / 10);
  assert.equal(r.byStar["5"], 6);
  assert.equal(r.byStar["2"], 0);
});

test("nps: no responses → nps/avg null, all star buckets 0", () => {
  const r = computeNpsFromStars([]);
  assert.equal(r.total, 0);
  assert.equal(r.nps, null);
  assert.equal(r.avgRating, null);
  assert.equal(r.byStar["1"], 0);
  assert.equal(r.byStar["5"], 0);
});

test("nps: out-of-range stars ignored, BQ int64-as-string coerced", () => {
  const r = computeNpsFromStars([
    { rating: 0, count: 5 }, // 무시
    { rating: 6, count: 5 }, // 무시
    { rating: "5", count: "3" }, // 문자열 좌표 → promoter 3
    { rating: 2, count: -1 }, // count<=0 무시
  ]);
  assert.equal(r.total, 3);
  assert.equal(r.promoters, 3);
  assert.equal(r.nps, 100);
});

// ── buildBetaExitGauges ──────────────────────────────────────────────────────
test("gauges: 8 gauges in flow order (D1/D7/D30), targets from strategy memo", () => {
  const nps = computeNpsFromStars([]);
  const gauges = buildBetaExitGauges({}, nps);
  assert.equal(gauges.length, 8);
  // ★순서 계약: 잔존 3칸은 창 길이 순서로 D1 → D7 → D30 이어야 한다. 종전엔
  // 인덱스로 조립해서 메타 상수에 칸을 넣으면 순서가 조용히 어긋났다.
  assert.deepEqual(
    gauges.map((g) => g.key),
    [
      "cli_auth_success",
      "first_project_run",
      "first_ticket_completed",
      "retention_1d",
      "retention_7d",
      "retention_30d",
      "satisfaction_nps",
      "activation_30m",
    ]
  );
  const byKey = new Map(gauges.map((g) => [g.key, g]));
  assert.equal(
    byKey.get("cli_auth_success")?.target,
    BETA_EXIT_TARGETS.cli_auth_success
  );
  assert.equal(byKey.get("cli_auth_success")?.target, 0.8);
  assert.equal(byKey.get("first_project_run")?.target, 0.6);
  assert.equal(byKey.get("first_ticket_completed")?.target, 0.5);
  assert.equal(byKey.get("retention_7d")?.target, 0.3);
  assert.equal(byKey.get("satisfaction_nps")?.target, 40);
  assert.equal(byKey.get("satisfaction_nps")?.unit, "nps");
});

test("gauges: D1/D7/D30 read their own columns (same definition, 창만 다름)", () => {
  const gauges = buildBetaExitGauges(
    {
      d_signup_base: 20,
      d_retained_1d: 10, // 0.5
      d_retained_7d: 6, // 0.3
      d_retained_30d: 4, // 0.2
    },
    computeNpsFromStars([])
  );
  const byKey = new Map(gauges.map((g) => [g.key, g]));
  assert.equal(byKey.get("retention_1d")?.current, 0.5);
  assert.equal(byKey.get("retention_7d")?.current, 0.3);
  assert.equal(byKey.get("retention_30d")?.current, 0.2);
  // 같은 정의·다른 창이므로 단조 감소여야 한다(D1 ≥ D7 ≥ D30).
  assert.ok(
    (byKey.get("retention_1d")?.current ?? 0) >=
      (byKey.get("retention_7d")?.current ?? 0)
  );
  assert.ok(
    (byKey.get("retention_7d")?.current ?? 0) >=
      (byKey.get("retention_30d")?.current ?? 0)
  );
});

test("gauges: empty row → all rate gauges null (데이터 대기), not met", () => {
  const gauges = buildBetaExitGauges({}, computeNpsFromStars([]));
  for (const g of gauges) {
    assert.equal(g.current, null);
    assert.equal(g.met, false);
  }
});

test("gauges: rate = numerator/denominator, met when >= target", () => {
  const row = {
    d_cli_connect_enter: 10,
    d_cli_connect_success: 9, // 0.9 >= 0.8 → met
    d_signup_base: 20,
    d_cli_project_success: 10, // 0.5 < 0.6 → not met
    d_task_completed: 12, // 0.6 >= 0.5 → met
    d_retained_7d: 4, // 0.2 < 0.3 → not met
    d_activated_30m: 8, // 0.4 >= 0.3 → met
  };
  const gauges = buildBetaExitGauges(row, computeNpsFromStars([]));
  const byKey = Object.fromEntries(gauges.map((g) => [g.key, g]));
  assert.equal(byKey.cli_auth_success.current, 0.9);
  assert.equal(byKey.cli_auth_success.met, true);
  assert.equal(byKey.cli_auth_success.numerator, 9);
  assert.equal(byKey.cli_auth_success.denominator, 10);
  assert.equal(byKey.first_project_run.current, 0.5);
  assert.equal(byKey.first_project_run.met, false);
  assert.equal(byKey.first_ticket_completed.current, 0.6);
  assert.equal(byKey.first_ticket_completed.met, true);
  assert.equal(byKey.retention_7d.met, false);
  assert.equal(byKey.activation_30m.met, true);
});

test("gauges: nps gauge reads NpsResult, met at >= 40", () => {
  const nps = computeNpsFromStars([
    { rating: 5, count: 5 },
    { rating: 1, count: 1 },
  ]); // (5-1)/6*100 = 67
  const gauges = buildBetaExitGauges({}, nps);
  const npsGauge = gauges.find((g) => g.key === "satisfaction_nps");
  assert.ok(npsGauge);
  assert.equal(npsGauge?.current, 67);
  assert.equal(npsGauge?.met, true);
  assert.equal(npsGauge?.numerator, 6);
});

// ── buildCliSetupSummary ─────────────────────────────────────────────────────
test("cliSetup: groups by step, aggregates enter/success/fail, successRate", () => {
  const rows = [
    { step: "connect", phase: "enter", clients: 10, events: 12 },
    { step: "connect", phase: "success", clients: 7, events: 7 },
    { step: "connect", phase: "fail", clients: 3, events: 5 },
    { step: "project", phase: "enter", clients: 7, events: 7 },
    { step: "project", phase: "success", clients: 6, events: 6 },
    { step: "notice", phase: "enter", clients: 12, events: 12 },
  ];
  const out = buildCliSetupSummary(rows);
  // 항상 3 스텝 고정 순서(notice, connect, project).
  assert.deepEqual(
    out.map((s) => s.step),
    ["notice", "connect", "project"]
  );
  const connect = out.find((s) => s.step === "connect");
  assert.equal(connect?.clients.enter, 10);
  assert.equal(connect?.clients.success, 7);
  assert.equal(connect?.clients.fail, 3);
  assert.equal(connect?.events.fail, 5);
  assert.equal(connect?.successRate, 0.7);
  // notice 는 success 없음 → successRate null 아님? enter 12, success 0 → 0.
  const notice = out.find((s) => s.step === "notice");
  assert.equal(notice?.successRate, 0);
});

test("cliSetup: empty rows → 3 zeroed steps, null successRate (enter 0)", () => {
  const out = buildCliSetupSummary([]);
  assert.equal(out.length, 3);
  for (const s of out) {
    assert.equal(s.clients.enter, 0);
    assert.equal(s.successRate, null);
  }
});

test("cliSetup: unknown phase/step ignored (schema drift guard)", () => {
  const out = buildCliSetupSummary([
    { step: "connect", phase: "bogus", clients: 99, events: 99 },
    { step: "", phase: "enter", clients: 99, events: 99 },
  ]);
  const connect = out.find((s) => s.step === "connect");
  assert.equal(connect?.clients.enter, 0);
});

// ── buildDemoFunnel ──────────────────────────────────────────────────────────
test("demo: completion & cta rates against started clients", () => {
  const d = buildDemoFunnel({
    startedClients: 20,
    completedClients: 12,
    ctaClients: 5,
    startedEvents: 25,
    completedEvents: 12,
    ctaEvents: 5,
  });
  assert.equal(d.completionRate, 0.6);
  assert.equal(d.ctaRate, 0.25);
  assert.equal(d.startedEvents, 25);
});

test("demo: zero started → null rates", () => {
  const d = buildDemoFunnel({
    startedClients: 0,
    completedClients: 0,
    ctaClients: 0,
    startedEvents: 0,
    completedEvents: 0,
    ctaEvents: 0,
  });
  assert.equal(d.completionRate, null);
  assert.equal(d.ctaRate, null);
});

// ── buildConsentSummary ──────────────────────────────────────────────────────
test("consent: grant rate = granted/shown; zero shown → null", () => {
  assert.equal(
    buildConsentSummary({
      shownClients: 10,
      grantedClients: 4,
      shownEvents: 10,
      grantedEvents: 4,
    }).grantRate,
    0.4
  );
  assert.equal(
    buildConsentSummary({
      shownClients: 0,
      grantedClients: 0,
      shownEvents: 0,
      grantedEvents: 0,
    }).grantRate,
    null
  );
});

// ── foldKeyCounts ────────────────────────────────────────────────────────────
test("foldKeyCounts: sorts desc, null/empty key → (none)", () => {
  const out = foldKeyCounts([
    { key: "cli_missing", count: 2 },
    { key: "cli_auth", count: 9 },
    { key: null, count: 1 },
  ]);
  assert.deepEqual(out, [
    { key: "cli_auth", count: 9 },
    { key: "cli_missing", count: 2 },
    { key: "(none)", count: 1 },
  ]);
});

// ── buildReuseSummary ────────────────────────────────────────────────────────
test("reuse: second-session rate & DAU/WAU stickiness", () => {
  const r = buildReuseSummary({
    weeklyActiveProjects: 8,
    weeklyCompletedTasks: 42,
    secondSessionClients: 6,
    signupBase: 20,
    avgDau: 4,
    wau: 16,
  });
  assert.equal(r.weeklyActiveProjects, 8);
  assert.equal(r.weeklyCompletedTasks, 42);
  assert.equal(r.secondSessionRate, 0.3);
  assert.equal(r.stickiness, 0.25);
});

test("reuse: zero base/wau → null rates (no divide-by-zero)", () => {
  const r = buildReuseSummary({
    weeklyActiveProjects: 0,
    weeklyCompletedTasks: 0,
    secondSessionClients: 0,
    signupBase: 0,
    avgDau: 0,
    wau: 0,
  });
  assert.equal(r.secondSessionRate, null);
  assert.equal(r.stickiness, null);
});

// ── buildSpawnHealth ─────────────────────────────────────────────────────────
test("spawn: successRate = completed/(completed+crashed), restart excluded from base", () => {
  const s = buildSpawnHealth({
    spawned: 40,
    crashed: 8,
    restarted: 6,
    completed: 32,
  });
  // 32/(32+8)=0.8
  assert.equal(s.successRate, 0.8);
  assert.equal(s.crashRate, 0.2); // 8/40
  assert.equal(s.avgRestartPerSpawn, 6 / 40);
});

test("spawn: zero spawned/outcomes → null rates", () => {
  const s = buildSpawnHealth({
    spawned: 0,
    crashed: 0,
    restarted: 0,
    completed: 0,
  });
  assert.equal(s.successRate, null);
  assert.equal(s.crashRate, null);
  assert.equal(s.avgRestartPerSpawn, null);
});

// ── buildKpiCockpit (전체 조립) ──────────────────────────────────────────────
test("cockpit: assembles gauges, onboarding events, reuse, spawn health", () => {
  const result = buildKpiCockpit({
    gaugeRow: {
      d_cli_connect_enter: 10,
      d_cli_connect_success: 8,
      d_signup_base: 20,
      d_cli_project_success: 12,
      d_task_completed: 10,
      d_retained_7d: 6,
      d_activated_30m: 6,
    },
    starRatingRows: [
      { rating: 5, count: 4 },
      { rating: 1, count: 1 },
    ],
    cliSetupRows: [
      { step: "connect", phase: "enter", clients: 10, events: 10 },
      { step: "connect", phase: "success", clients: 8, events: 8 },
    ],
    cliFailReasonRows: [{ key: "cli_auth", count: 3 }],
    demo: {
      startedClients: 10,
      completedClients: 6,
      ctaClients: 2,
      startedEvents: 10,
      completedEvents: 6,
      ctaEvents: 2,
    },
    consent: {
      shownClients: 10,
      grantedClients: 5,
      shownEvents: 10,
      grantedEvents: 5,
    },
    reuse: {
      weeklyActiveProjects: 3,
      weeklyCompletedTasks: 20,
      secondSessionClients: 5,
      signupBase: 20,
      avgDau: 3,
      wau: 12,
    },
    spawn: { spawned: 30, crashed: 5, restarted: 3, completed: 25 },
  });

  assert.equal(result.betaExitGauges.length, 8);
  // 구버전 호출부 호환: 입력이 없으면 새 섹션은 null 이고 나머지는 그대로 조립된다.
  assert.equal(result.zeroFriction, null);
  assert.equal(result.onboardingEvents.cliSetup.length, 3);
  assert.equal(result.onboardingEvents.survey.nps.total, 5);
  assert.equal(
    result.onboardingEvents.survey.cliFailReasons[0].key,
    "cli_auth"
  );
  assert.equal(result.onboardingEvents.demo.completionRate, 0.6);
  assert.equal(result.onboardingEvents.consent.grantRate, 0.5);
  assert.equal(result.reuse.secondSessionRate, 0.25);
  assert.equal(result.spawnHealth.successRate, 25 / 30);
  assert.match(result.note, /3\.0\.19/);
});

// ════════════════════════════════════════════════════════════════════════════
// ★제로마찰 KPI — 10분 첫 multi-agent 성공 · 동시2+ · 주2회+ · 무료→유료
// ════════════════════════════════════════════════════════════════════════════

const ZERO_FRICTION_SAMPLE = {
  firstRunBase: 40,
  // ★최초 실행 40 중 연결까지 온 설치는 20 — 나머지 20 은 앞단 이탈이지
  // '10분 실패' 가 아니다(티켓 Tw6m14gR 의 전부).
  modelConnectedClients: 20,
  signupBase: 25,
  multiAgentActiveClients: 12,
  multiAgentActiveEvents: 55,
  multiAgentSuccessClients: 8,
  multiAgentSuccessEvents: 19,
  firstSuccessClients: 8,
  firstSuccessWithinConnectClients: 7,
  firstSuccessNoConnectClockClients: 1,
  firstSuccessMedianFromConnectMs: 180_000,
  firstSuccessWithinFirstRunClients: 6,
  firstSuccessNoClockClients: 1,
  firstSuccessMedianMs: 420_000,
  weeklyActiveClients: 20,
  weeklyTwicePlusClients: 9,
  paidClients: 5,
};

test("zeroFriction: 10분 시계 분모는 최초 실행이 아니라 모델 연결 완료다", () => {
  const z = buildZeroFrictionKpis(ZERO_FRICTION_SAMPLE);
  // ★핵심: 연결 안 한 20 명은 분모에 없다. 40 으로 나누면 연결조차 안 한
  // 사람을 '10분 실패' 로 세는 것이라 사장님 결정과 어긋난다.
  assert.equal(z.tenMinuteMultiAgent.anchor, "model_connect");
  assert.equal(z.tenMinuteMultiAgent.base, 20);
  assert.equal(z.tenMinuteMultiAgent.rate, 7 / 20);
  assert.notEqual(z.tenMinuteMultiAgent.rate, 7 / 40);
  // 판정은 연결 시계 기준 분자를 쓴다(first_run 기준 6 이 아니라 7).
  assert.equal(z.tenMinuteMultiAgent.withinClients, 7);
  // 창 무관 첫 성공률은 같은 분모로 따로 낸다(10분 밖 성공도 성공이다).
  assert.equal(z.tenMinuteMultiAgent.successRate, 8 / 20);
  assert.equal(z.tenMinuteMultiAgent.medianMs, 180_000); // 연결→성공
  assert.equal(z.tenMinuteMultiAgent.windowMinutes, 10);
  assert.equal(MULTI_AGENT_TARGET_WINDOW_MINUTES, 10);
  assert.match(z.tenMinuteMultiAgent.label, /10분/);
  assert.match(z.tenMinuteMultiAgent.label, /모델 연결/);
});

test("zeroFriction: 앞단(설치→연결) 이탈은 별도 구간으로 보존된다", () => {
  const z = buildZeroFrictionKpis(ZERO_FRICTION_SAMPLE);
  assert.equal(z.connectFunnel.firstRunBase, 40);
  assert.equal(z.connectFunnel.connectedClients, 20);
  assert.equal(z.connectFunnel.connectRate, 20 / 40);
  assert.equal(z.connectFunnel.notConnectedClients, 20);
  // 참고 축(앵커 변경 전과 같은 계산)도 함께 남아 전/후 대조가 된다.
  assert.equal(z.fromFirstRunReference.base, 40);
  assert.equal(z.fromFirstRunReference.rate, 6 / 40);
  assert.equal(z.fromFirstRunReference.medianMs, 420_000);
});

test("zeroFriction: 연결 수가 최초 실행보다 크면 앞단 이탈을 음수로 만들지 않는다", () => {
  // 창 경계가 달라(연결은 창 안, first_run 은 창 밖) 실제로 일어날 수 있다.
  const z = buildZeroFrictionKpis({
    ...ZERO_FRICTION_SAMPLE,
    firstRunBase: 3,
    modelConnectedClients: 9,
  });
  assert.equal(z.connectFunnel.notConnectedClients, 0);
});

test("zeroFriction: 표본 0 이면 0% 가 아니라 null(데이터 대기)", () => {
  const z = buildZeroFrictionKpis({
    firstRunBase: 0,
    modelConnectedClients: 0,
    signupBase: 0,
    multiAgentActiveClients: 0,
    multiAgentActiveEvents: 0,
    multiAgentSuccessClients: 0,
    multiAgentSuccessEvents: 0,
    firstSuccessClients: 0,
    firstSuccessWithinConnectClients: 0,
    firstSuccessNoConnectClockClients: 0,
    firstSuccessMedianFromConnectMs: 0,
    firstSuccessWithinFirstRunClients: 0,
    firstSuccessNoClockClients: 0,
    firstSuccessMedianMs: 0,
    weeklyActiveClients: 0,
    weeklyTwicePlusClients: 0,
    paidClients: 0,
  });
  assert.equal(z.tenMinuteMultiAgent.rate, null);
  assert.equal(z.tenMinuteMultiAgent.successRate, null);
  // ★중앙값 0 은 "0분 만에 성공" 이 아니라 표본 없음이다.
  assert.equal(z.tenMinuteMultiAgent.medianMs, null);
  assert.equal(z.connectFunnel.connectRate, null);
  assert.equal(z.multiAgentUsage.activeRate, null);
  assert.equal(z.weeklyTwicePlus.rate, null);
  assert.equal(z.freeToPaid.rate, null);
});

test("zeroFriction: 동시2+ 는 연결 분모, 무료→유료는 최초 실행 분모를 쓴다", () => {
  const z = buildZeroFrictionKpis(ZERO_FRICTION_SAMPLE);
  // 동시 2대+ 도 연결 전엔 원천적으로 불가능하므로 같은 분모(연결)를 쓴다.
  assert.equal(z.multiAgentUsage.base, 20);
  assert.equal(z.multiAgentUsage.activeRate, 12 / 20);
  assert.equal(z.multiAgentUsage.successRate, 8 / 20);
  // 주2회+ 만 분모가 다르다(그 창의 활동 설치) — 화면이 병기해야 하는 이유.
  assert.equal(z.weeklyTwicePlus.rate, 9 / 20);
  assert.equal(z.weeklyTwicePlus.base, 20);
  // ★결제는 연결 안 한 사람도 한다 — 좁히면 전환율이 낙관 편향된다.
  assert.equal(z.freeToPaid.base, 40);
  assert.equal(z.freeToPaid.rate, 5 / 40);
  assert.equal(z.freeToPaid.rateOfSignups, 5 / 25); // 참고치는 가입 분모
});

test("zeroFriction: BQ int64-as-string 을 강제 변환하고, note 가 한계를 말한다", () => {
  const z = buildZeroFrictionKpis({
    ...ZERO_FRICTION_SAMPLE,
    modelConnectedClients: "20",
    firstSuccessWithinConnectClients: "7",
    firstSuccessMedianFromConnectMs: "180000",
  });
  assert.equal(z.tenMinuteMultiAgent.rate, 7 / 20);
  assert.equal(z.tenMinuteMultiAgent.medianMs, 180_000);
  assert.equal(z.tenMinuteMultiAgent.noClockClients, 1);
  // 정직성 계약: 시계 시작점·앞단 분리·web 경계·결제 관측시점 한계가 note 에.
  assert.match(z.note, /모델 연결 완료/);
  assert.match(z.note, /앞단/);
  assert.match(z.note, /GA4|Vercel/);
});

test("앵커 계약: 정본 이벤트 + 하위호환 두 신호가 한 predicate 로 접힌다", () => {
  // 클라(telemetryService 의 앵커 지점)와 서버 분모가 어긋나면 KPI 가 조용히
  // 틀어진다 — 목록을 코드로 고정한다.
  assert.deepEqual(MODEL_CONNECT_ANCHOR_EVENTS.slice(), [
    "onboarding:model_connected",
    "onboarding:cli_setup_step",
    "onboarding:funding_probe",
  ]);
  const sql = modelConnectedPredicateSql({
    event: "event",
    step: "S",
    phase: "P",
    verdict: "V",
  });
  assert.match(sql, /onboarding:model_connected/);
  // 하위호환 신호는 **조건부**여야 한다(cli_setup_step 전부가 연결은 아니다).
  assert.match(sql, /S = 'auth' AND P = 'success'/);
  assert.match(sql, /V = 'ok'/);
});

test("zeroFriction: 목표창은 주입 가능하고, 잘못된 값이면 기본 10분", () => {
  assert.equal(
    buildZeroFrictionKpis({ ...ZERO_FRICTION_SAMPLE, targetWindowMinutes: 30 })
      .tenMinuteMultiAgent.windowMinutes,
    30
  );
  assert.equal(
    buildZeroFrictionKpis({ ...ZERO_FRICTION_SAMPLE, targetWindowMinutes: 0 })
      .tenMinuteMultiAgent.windowMinutes,
    10
  );
});

test("cockpit: zeroFriction 입력이 있으면 섹션이 조립된다", () => {
  const result = buildKpiCockpit({
    gaugeRow: { d_signup_base: 25, d_retained_1d: 10, d_retained_30d: 3 },
    starRatingRows: [],
    cliSetupRows: [],
    cliFailReasonRows: [],
    demo: {
      startedClients: 0,
      completedClients: 0,
      ctaClients: 0,
      startedEvents: 0,
      completedEvents: 0,
      ctaEvents: 0,
    },
    consent: {
      shownClients: 0,
      grantedClients: 0,
      shownEvents: 0,
      grantedEvents: 0,
    },
    reuse: {
      weeklyActiveProjects: 0,
      weeklyCompletedTasks: 0,
      secondSessionClients: 0,
      signupBase: 25,
      avgDau: 0,
      wau: 0,
    },
    spawn: { spawned: 0, crashed: 0, restarted: 0, completed: 0 },
    zeroFriction: ZERO_FRICTION_SAMPLE,
  });
  assert.equal(result.zeroFriction?.tenMinuteMultiAgent.rate, 7 / 20);
  assert.equal(result.zeroFriction?.connectFunnel.connectRate, 20 / 40);
  assert.equal(result.zeroFriction?.freeToPaid.paidClients, 5);
  const byKey = new Map(result.betaExitGauges.map((g) => [g.key, g]));
  assert.equal(byKey.get("retention_1d")?.current, 10 / 25);
  assert.equal(byKey.get("retention_30d")?.current, 3 / 25);
  // 코크핏 note 가 "동시작업 미포함" 이라는 옛 사실을 더는 말하지 않아야 한다.
  assert.match(result.note, /멀티에이전트/);
});

// ── 필수 활성유저 확충: 리텐션 · Stickiness · 30일+ 잔존 · 순차 게이트 ────────
test("retention cohorts: computes D1/D7/D14/D30 return rates by day and week", () => {
  const r = buildRetentionCohorts([
    {
      period: "day",
      cohort: "2026-07-01",
      cohortUsers: 10,
      d1Users: 4,
      d7Users: 3,
      d14Users: 2,
      d30Users: 1,
    },
    {
      period: "week",
      cohort: "2026-06-29",
      cohortUsers: "20",
      d1Users: "8",
      d7Users: "5",
      d14Users: "4",
      d30Users: "2",
    },
  ]);

  assert.equal(r.day.length, 1);
  assert.equal(r.week.length, 1);
  assert.equal(r.day[0].rates.d1, 0.4);
  assert.equal(r.day[0].rates.d7, 0.3);
  assert.equal(r.day[0].rates.d14, 0.2);
  assert.equal(r.day[0].rates.d30, 0.1);
  assert.equal(r.week[0].rates.d30, 0.1);
  assert.match(r.note, /accountUserId/);
});

test("active user metrics: computes DAU/WAU/MAU stickiness and 30d+ retention trend", () => {
  const r = buildActiveUserMetrics(
    [
      { date: "2026-07-02", dau: 5, events: 50 },
      { date: "2026-07-01", dau: "3", events: "30" },
    ],
    { dau: 5, wau: 10, mau: 20 },
    [
      { date: "2026-06-01", eligibleUsers: 10, retainedUsers: 4 },
      { date: "2026-06-02", eligibleUsers: "8", retainedUsers: "2" },
    ]
  );

  assert.equal(r.dauWauRatio, 0.5);
  assert.equal(r.dauMauRatio, 0.25);
  assert.deepEqual(
    r.activeByDay.map((d) => d.date),
    ["2026-07-01", "2026-07-02"]
  );
  assert.equal(r.thirtyDayRetention.trend[0].retentionRate, 0.4);
  assert.equal(r.thirtyDayRetention.current?.date, "2026-06-02");
  assert.equal(r.thirtyDayRetention.current?.retentionRate, 0.25);
});

test("activation gate: sequential subset counts drop-off and flags the largest gate", () => {
  const r = buildActivationGateFunnel({
    d_install: 100,
    d_first_run: 80,
    d_login: 50,
    d_folder_connected: 25,
    d_orchestrator_opened: 20,
    d_agent_spawned: 18,
    d_first_ticket_complete: 9,
  });
  const byKey = Object.fromEntries(r.steps.map((s) => [s.key, s]));

  assert.equal(byKey.first_run.dropFromPrev, 20);
  assert.equal(byKey.login.dropFromPrev, 30);
  assert.equal(byKey.folder_connected.dropFromPrev, 25);
  assert.equal(byKey.first_ticket_complete.dropRateFromPrev, 0.5);
  assert.equal(r.maxDrop?.key, "login");
  assert.equal(byKey.login.isMaxDrop, true);
});
// ════════════════════════════════════════════════════════════════════════════
// 릴리스·버전 헬스 + 모델 하위분해 (ticket F7OUUkNSD6FqoWxktWcp)
// ════════════════════════════════════════════════════════════════════════════
// 고정값은 전부 2026-07-28 BQ 실측 형태를 본뜬 것이다(수치 자체는 테스트용 축약).
import {
  parseSemver,
  compareReleaseRows,
  buildReleaseVersions,
  buildReleaseAdoption,
  buildReleaseHealth,
  buildCostByDayModel,
  VERSION_UNRECORDED,
  VERSION_CI_LABEL,
  COST_BY_DAY_OTHER_KEY,
} from "./adminAnalytics";

test("parseSemver: semver 만 파싱하고 라벨은 null", () => {
  assert.deepEqual(parseSemver("3.0.17"), [3, 0, 17]);
  assert.deepEqual(parseSemver(" 3.0.0 "), [3, 0, 0]);
  assert.equal(parseSemver("github-actions"), null);
  assert.equal(parseSemver(""), null);
});

test("buildReleaseVersions: 크래시율 계산 + 스폰0 이면 null", () => {
  const rows = buildReleaseVersions([
    {
      version: "3.0.16",
      clients: 1,
      events: 3251,
      sessions: 4,
      spawned: 373,
      crashed: 171,
      firstSeen: "2026-07-17",
      lastSeen: "2026-07-18",
    },
    {
      version: VERSION_CI_LABEL,
      clients: 1,
      events: 49,
      sessions: 0,
      spawned: 0,
      crashed: 0,
      firstSeen: "2026-07-20",
      lastSeen: "2026-07-23",
    },
  ]);
  const v316 = rows.find((r) => r.version === "3.0.16");
  assert.ok(v316);
  assert.equal(v316.crashRate, 171 / 373);
  assert.equal(v316.isSemver, true);
  assert.equal(v316.isCi, false);

  // 스폰 0 → 0% 가 아니라 null("데이터 없음"). 0% 로 오도하면 안 된다.
  const ci = rows.find((r) => r.version === VERSION_CI_LABEL);
  assert.ok(ci);
  assert.equal(ci.crashRate, null);
  assert.equal(ci.isCi, true);
  assert.equal(ci.isSemver, false);
});

test("buildReleaseVersions: NULL/빈 버전은 (미기록) 라벨", () => {
  const rows = buildReleaseVersions([
    { version: null, events: 5321, spawned: 1090, crashed: 471 },
    { version: "   ", events: 1 },
  ]);
  assert.ok(rows.every((r) => r.version === VERSION_UNRECORDED));
  assert.ok(rows.every((r) => r.isSemver === false));
});

test("compareReleaseRows: semver 최신순 → 라벨 → 미기록 순", () => {
  const rows = buildReleaseVersions([
    { version: null, events: 99999 }, // 이벤트가 제일 많아도 맨 뒤
    { version: "3.0.0", events: 55640 },
    { version: VERSION_CI_LABEL, events: 49 },
    { version: "3.0.18", events: 119 },
    { version: "3.0.17", events: 28866 },
  ]);
  assert.deepEqual(
    rows.map((r) => r.version),
    ["3.0.18", "3.0.17", "3.0.0", VERSION_CI_LABEL, VERSION_UNRECORDED]
  );
  // 비교자 자체도 직접 검증(정렬 안정성 회귀 방지).
  assert.ok(compareReleaseRows(rows[0], rows[1]) < 0);
});

test("buildReleaseAdoption: 결측 칸은 0 으로 채우고 versionOrder 를 따른다", () => {
  const adoption = buildReleaseAdoption(
    [
      { date: "2026-07-18", version: "3.0.17", clients: 2 },
      { date: "2026-07-17", version: "3.0.16", clients: 1 },
      { date: "2026-07-18", version: "3.0.16", clients: 1 },
    ],
    ["3.0.17", "3.0.16"]
  );
  assert.deepEqual(adoption.dates, ["2026-07-17", "2026-07-18"]);
  assert.deepEqual(
    adoption.series.map((s) => s.version),
    ["3.0.17", "3.0.16"]
  );
  // 3.0.17 은 07-17 에 관측이 없으므로 0(실제 0 = 그날 활동 없음)
  assert.deepEqual(adoption.series[0].values, [0, 2]);
  assert.deepEqual(adoption.series[1].values, [1, 1]);
});

test("buildReleaseAdoption: versionOrder 에 없는 버전도 버리지 않고 뒤에 붙인다", () => {
  const adoption = buildReleaseAdoption(
    [{ date: "2026-07-21", version: "3.0.18", clients: 4 }],
    ["3.0.17"]
  );
  assert.deepEqual(
    adoption.series.map((s) => s.version),
    ["3.0.18"]
  );
});

test("buildReleaseHealth: 전체 합계와 크래시율", () => {
  const res = buildReleaseHealth(
    [
      { version: "3.0.17", spawned: 615, crashed: 15, events: 28866 },
      { version: "3.0.16", spawned: 373, crashed: 171, events: 3251 },
    ],
    [{ date: "2026-07-18", version: "3.0.17", clients: 2 }]
  );
  assert.equal(res.totals.versions, 2);
  assert.equal(res.totals.spawned, 615 + 373);
  assert.equal(res.totals.crashed, 15 + 171);
  assert.equal(res.totals.crashRate, 186 / 988);
  assert.ok(res.note.includes("appVersion"));
});

test("buildReleaseHealth: 빈 입력도 안전(0/null, 예외 없음)", () => {
  const res = buildReleaseHealth([], []);
  assert.deepEqual(res.versions, []);
  assert.deepEqual(res.adoption.dates, []);
  assert.equal(res.totals.crashRate, null);
});

test("buildCostByDayModel: 상위N 밖 모델은 버리지 않고 '그 외'로 합산", () => {
  const rows = [
    { date: "2026-07-27", model: "a", cost: 100 },
    { date: "2026-07-27", model: "b", cost: 50 },
    { date: "2026-07-28", model: "c", cost: 10 },
    { date: "2026-07-28", model: "d", cost: 5 },
  ];
  const res = buildCostByDayModel(rows, 2);
  assert.deepEqual(res.dates, ["2026-07-27", "2026-07-28"]);
  assert.deepEqual(
    res.models.map((m) => m.model),
    ["a", "b", COST_BY_DAY_OTHER_KEY]
  );
  assert.equal(res.truncatedModels, 2);
  // ★총합 보존 — 접혀도 합계는 원본과 같아야 한다(수치 왜곡 금지)
  assert.equal(res.grandTotal, 165);
  // 행렬은 models 순서와 1:1
  assert.deepEqual(res.matrix[0], [100, 0]);
  assert.deepEqual(res.matrix[1], [50, 0]);
  assert.deepEqual(res.matrix[2], [0, 15]);
  assert.equal(res.models[0].share, 100 / 165);
});

test("buildCostByDayModel: 접힘 없으면 truncatedModels=0 이고 '그 외' 없음", () => {
  const res = buildCostByDayModel(
    [{ date: "2026-07-28", model: "gpt-5.5", cost: 3 }],
    6
  );
  assert.equal(res.truncatedModels, 0);
  assert.deepEqual(
    res.models.map((m) => m.model),
    ["gpt-5.5"]
  );
  assert.deepEqual(res.matrix, [[3]]);
});

test("buildCostByDayModel: 같은 (날짜,모델) 중복행 합산 + 날짜 없는 행 무시", () => {
  const res = buildCostByDayModel(
    [
      { date: "2026-07-28", model: "x", cost: 1 },
      { date: "2026-07-28", model: "x", cost: 2 },
      { date: null, model: "x", cost: 999 },
    ],
    6
  );
  assert.deepEqual(res.matrix, [[3]]);
  assert.equal(res.grandTotal, 3);
});

test("buildCostByDayModel: 빈 입력 안전(NaN 없음)", () => {
  const res = buildCostByDayModel([], 6);
  assert.deepEqual(res.dates, []);
  assert.deepEqual(res.models, []);
  assert.equal(res.grandTotal, 0);
});

// ── 하위모델 분해(buildModelBreakdown) 테스트는 은퇴했다 ─────────────────────
// 그 표는 events↔cost_logs 를 agentId 로 조인해 만들었고, 그 조인이 곧 익명
// 텔레메트리를 계정으로 되짚는 마지막 다리였다(ticket U5OPOKf0D3I2TSRP8yUq).
// 조인키 가명화로 다리를 끊으면서 빌더와 함께 지웠다 —
// 남은 계약은 analyticsPseudonym.test.ts 가 지킨다.

// ── 온보딩 스톨 (티켓 9dXgBdkGn1LyJokShh1g) ──────────────────────────────────
// 온램프 스파이크 #883/#885 가 멈춘 지점 = "구독/크레딧/인증이 없어 최초에 멈추는
// 유저가 몇 명인지 모른다". 이 요약이 그 수를 만든다. 여기서 지키는 계약은 둘:
// (1) needsAuth 오탐(철회)을 스톨로 세지 않는다, (2) 비율의 분모에 정상(ok)이 든다.
const stallInput = {
  spawnBlockedClients: 4,
  spawnBlockedEvents: 9,
  spawnBlockedReasonRows: [
    { key: "not-authenticated", count: 6 },
    { key: "not-installed", count: 3 },
  ],
  needsAuthClients: 3,
  needsAuthAgents: 10,
  needsAuthResolvedAgents: 4,
  fundingOkClients: 6,
  fundingUnfundedClients: 2,
  fundingBlockedClients: 2,
  fundingInconclusiveClients: 5,
  guideShownClients: 3,
  guideShownEvents: 4,
  stalledClients: 7,
  signupBase: 20,
};

test("buildOnboardingStallSummary: 스톨 규모와 사유 분포를 만든다", () => {
  const s = buildOnboardingStallSummary(stallInput);
  assert.equal(s.stalledClients, 7);
  assert.equal(s.stalledRate, 7 / 20);
  assert.equal(s.spawnBlocked.clients, 4);
  assert.equal(s.spawnBlocked.events, 9);
  assert.deepEqual(s.spawnBlocked.byReason, [
    { key: "not-authenticated", count: 6 },
    { key: "not-installed", count: 3 },
  ]);
  assert.equal(s.guideShown.clients, 3);
});

// ── 차단 사유 정규 어휘 분해 (티켓 iyxb4KsJpgPgoKYUBPsu) ─────────────────────
// 온보딩 96% 이탈(cli_setup 531 → multi_agent_success 21)의 원인이 구독 공백인지
// 인증인지 CLI 부재인지를 가르는 축. errorCategory(원어휘)와 **다른 축**이라 두
// 분포가 공존한다.
const blockReasonRows = [
  // 건수는 needs_auth 가 많지만 설치 수는 no_subscription 이 많은 배치 —
  // 정렬 기준이 사람 수여야 하는 이유를 그대로 담았다.
  { key: "needs_auth", count: 12, clients: 2 },
  { key: "no_subscription", count: 5, clients: 5 },
  { key: "no_cli", count: 2, clients: 2 },
];

test("★차단 사유 정규 어휘를 분해한다 — 구독 공백이 몇 '명'인지가 답이다", () => {
  const s = buildOnboardingStallSummary({
    ...stallInput,
    spawnBlockedBlockReasonRows: blockReasonRows,
  });
  // 정렬은 설치 수 내림차순 — 건수로 정렬하면 재시도 많은 한 사람이 만든 꼬리가
  // 최대 문제로 보인다.
  assert.deepEqual(s.spawnBlocked.byBlockReason, [
    { key: "no_subscription", count: 5, clients: 5 },
    { key: "needs_auth", count: 12, clients: 2 },
    { key: "no_cli", count: 2, clients: 2 },
  ]);
  assert.equal(s.spawnBlocked.noSubscriptionClients, 5);
  // 원어휘 분포는 그대로 남는다(기존 화면·쿼리 하위호환).
  assert.equal(s.spawnBlocked.byReason.length, 2);
});

test("정규 어휘 축이 없는 구버전 응답도 안전하다(빈 배열 · 0)", () => {
  const s = buildOnboardingStallSummary(stallInput);
  assert.deepEqual(s.spawnBlocked.byBlockReason, []);
  assert.equal(s.spawnBlocked.noSubscriptionClients, 0);
});

test("★needsAuth 는 철회분(오탐)을 뺀 수를 쓴다 — 팝업 오탐이 문제 크기를 부풀리지 않게", () => {
  const s = buildOnboardingStallSummary(stallInput);
  assert.equal(s.needsAuth.agents, 10);
  assert.equal(s.needsAuth.resolvedAgents, 4);
  assert.equal(s.needsAuth.unresolvedAgents, 6);
  assert.equal(s.needsAuth.falsePositiveRate, 0.4);
});

test("★철회가 발화보다 많아도(창 경계) 음수로 새지 않는다", () => {
  const s = buildOnboardingStallSummary({
    ...stallInput,
    needsAuthAgents: 2,
    needsAuthResolvedAgents: 5,
  });
  assert.equal(s.needsAuth.unresolvedAgents, 0);
});

test("★unfunded 비율의 분모는 '판정이 난 설치'(ok 포함) — inconclusive 는 뺀다", () => {
  const s = buildOnboardingStallSummary(stallInput);
  // ok 6 + unfunded 2 + blocked 2 = 10. inconclusive 5 는 아무 주장도 아니다.
  assert.equal(s.funding.decidedClients, 10);
  assert.equal(s.funding.unfundedRate, 0.2);
  assert.equal(s.funding.inconclusiveClients, 5);
});

test("데이터가 없으면 0% 가 아니라 null 이다(데이터 대기 ≠ 문제 없음)", () => {
  const s = buildOnboardingStallSummary({
    spawnBlockedClients: 0,
    spawnBlockedEvents: 0,
    spawnBlockedReasonRows: [],
    needsAuthClients: 0,
    needsAuthAgents: 0,
    needsAuthResolvedAgents: 0,
    fundingOkClients: 0,
    fundingUnfundedClients: 0,
    fundingBlockedClients: 0,
    fundingInconclusiveClients: 0,
    guideShownClients: 0,
    guideShownEvents: 0,
    stalledClients: 0,
    signupBase: 0,
  });
  assert.equal(s.stalledRate, null);
  assert.equal(s.funding.unfundedRate, null);
  assert.equal(s.needsAuth.falsePositiveRate, null);
});

test("BQ 문자열/undefined 수치도 안전하게 접힌다(스키마 드리프트 방어)", () => {
  const s = buildOnboardingStallSummary({
    ...stallInput,
    stalledClients: "7",
    signupBase: undefined,
    needsAuthAgents: null,
  });
  assert.equal(s.stalledClients, 7);
  assert.equal(s.stalledRate, null);
  assert.equal(s.needsAuth.unresolvedAgents, 0);
});

test("코크핏은 stall 입력이 없으면 null(구버전 호출부 하위호환)", () => {
  const base = {
    gaugeRow: {},
    starRatingRows: [],
    cliSetupRows: [],
    cliFailReasonRows: [],
    demo: {
      startedClients: 0,
      completedClients: 0,
      ctaClients: 0,
      startedEvents: 0,
      completedEvents: 0,
      ctaEvents: 0,
    },
    consent: {
      shownClients: 0,
      grantedClients: 0,
      shownEvents: 0,
      grantedEvents: 0,
    },
    reuse: {
      weeklyActiveProjects: 0,
      weeklyCompletedTasks: 0,
      secondSessionClients: 0,
      signupBase: 0,
      avgDau: 0,
      wau: 0,
    },
    spawn: { spawned: 0, crashed: 0, restarted: 0, completed: 0 },
  };
  assert.equal(buildKpiCockpit(base).onboardingStall, null);
  assert.equal(
    buildKpiCockpit({ ...base, stall: stallInput }).onboardingStall
      ?.stalledClients,
    7
  );
});

// ═══════════════════════════════════════════════════════════════════════════
// D7/D14 리텐션 + 스트릭 (buildStreakRetention) — ticket b1L3L2zmL2HFWMo91BVr
//
// 이 블록이 지키는 것은 세 가지 함정이다. 전부 2026-08-21 BQ 실측에서 나왔다:
//   1) 하트비트 존재를 활동으로 세면 좀비 프로세스가 코호트를 부풀린다.
//   2) 분모를 숨기면 1/2 이 "50%" 로 보인다.
//   3) 2026-06-13 식별자 교체를 이탈로 읽으면 안 된다.
// ═══════════════════════════════════════════════════════════════════════════

// ── 날짜 유틸 ──────────────────────────────────────────────────────────────
test("dayNumber/dayString round-trip and reject malformed dates", () => {
  const n = dayNumber("2026-06-13");
  assert.notEqual(n, null);
  assert.equal(dayString(n as number), "2026-06-13");
  assert.equal(dayNumber("2026-6-13"), null);
  assert.equal(dayNumber("not-a-date"), null);
  assert.equal(dayNumber(""), null);
  assert.equal(daysBetween("2026-08-01", "2026-08-15"), 14);
  assert.equal(daysBetween("2026-08-15", "2026-08-01"), -14);
  assert.equal(daysBetween("bad", "2026-08-01"), null);
});

// ── countedRate: N 을 숨기지 않는다 ────────────────────────────────────────
test("countedRate always carries numerator/denominator in display", () => {
  assert.equal(countedRate(1, 2).display, "1/2 (50.0%)");
  assert.equal(countedRate(1, 2).rate, 0.5);
  assert.equal(countedRate(0, 3).display, "0/3 (0.0%)");
});

test("countedRate with zero denominator is '판단 불가', not 0%", () => {
  const r = countedRate(0, 0);
  // ★분모 0 을 0% 로 눕히면 "아무도 안 돌아왔다" 로 읽힌다. 다른 말이다.
  assert.equal(r.rate, null);
  assert.equal(r.display, "0/0 (—)");
});

// ── 라벨 안정성 ────────────────────────────────────────────────────────────
test("analyticsUnitLabel is stable and never leaks the raw identifier", () => {
  const raw = "b3f1c2d4-1111-2222-3333-444455556666";
  const a = analyticsUnitLabel("install", raw);
  const b = analyticsUnitLabel("install", raw);
  // 같은 입력 → 같은 라벨. 다음 조회에서도 같은 사람이 같은 라벨이어야
  // 시계열 추적이 된다.
  assert.equal(a, b);
  assert.match(a, /^I-[0-9a-f]{6}$/);
  assert.ok(!a.includes(raw));
  // 축이 다르면 다른 공간.
  assert.notEqual(analyticsUnitLabel("account", raw), a);
  assert.match(analyticsUnitLabel("account", raw), /^A-[0-9a-f]{6}$/);
});

// ── 테스트 픽스처 헬퍼 ─────────────────────────────────────────────────────
function day(base: string, offset: number): string {
  return dayString((dayNumber(base) as number) + offset);
}
/** 활동일 목록 → (유닛×날짜) 행. working 신호로 활동을 만든다. */
function activeRows(
  unit: string,
  base: string,
  offsets: number[],
): UnitDayActivityRow[] {
  return offsets.map((o) => ({
    unit,
    date: day(base, o),
    workingSignals: 1,
    presenceSignals: 3,
    eventSignals: 0,
  }));
}

// ── ★함정 1: 좀비 프로세스 ─────────────────────────────────────────────────
test("zombie install (heartbeats only, working=0, events=0) is not activity", () => {
  const today = "2026-08-21";
  // 실측 I10: 14일 중 13일 하트비트가 있는데 working 0 · 이벤트 0.
  const zombieRows: UnitDayActivityRow[] = [];
  for (let i = 0; i < 13; i += 1) {
    zombieRows.push({
      unit: "zombie-uuid-0000-0000-000000000000",
      date: day(today, -i),
      workingSignals: 0,
      presenceSignals: 2_700,
      eventSignals: 0,
    });
  }
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: zombieRows,
    cohortWindowDays: 30,
  });
  const z = res.units[0];
  assert.equal(res.unitsObserved, 1);
  // 하트비트가 13일 있어도 활동일은 0 이다.
  assert.equal(z.presentDays, 13);
  assert.equal(z.activeDays, 0);
  assert.equal(z.workingDays, 0);
  assert.equal(z.firstActive, null);
  assert.equal(z.zombie, true);
  // ★코호트에 들어오지 않는다 — 들어오면 리텐션이 부풀려진다.
  assert.equal(res.unitsCohort, 0);
  assert.equal(res.unitsZombie, 1);
  assert.equal(res.units[0].firstActive, null);
  // 격자에서도 활동(x)이 아니라 '떠 있음'(~)으로 그려져야 오독을 막는다.
  assert.ok(z.grid.includes("~"));
  assert.ok(!z.grid.includes("x"));
});

test("a single event with zero working heartbeats still counts as activity", () => {
  const today = "2026-08-21";
  const res = buildStreakRetention({
    axis: "install",
    today,
    // 활동 정의는 working ≥1 "또는" 이벤트 ≥1 이다. 이벤트만 있어도 활동이다.
    rows: [
      {
        unit: "ev-only-uuid-0000-0000-00000000",
        date: today,
        workingSignals: 0,
        presenceSignals: 0,
        eventSignals: 42,
      },
    ],
    cohortWindowDays: 30,
  });
  assert.equal(res.units[0].activeDays, 1);
  assert.equal(res.units[0].zombie, false);
  assert.equal(res.units[0].grid.endsWith("x"), true);
});

// ── ★함정 2: 작은 N ────────────────────────────────────────────────────────
test("D7/D14 report numerator and denominator, and exclude pending units", () => {
  const today = "2026-08-21";
  const base = "2026-08-01"; // today-20 → D7 은 판정 가능, D14 도 판정 가능
  const rows: UnitDayActivityRow[] = [
    // retained: 첫날 + D7 당일 + D14 당일에 활동
    ...activeRows("u-retained-0000-0000-000000", base, [0, 7, 14]),
    // churned: 첫날만
    ...activeRows("u-churned-0000-0000-0000000", base, [0]),
    // pending: 3일 전에 시작 → D7/D14 관측창 미도달
    ...activeRows("u-pending-0000-0000-0000000", day(today, -3), [0]),
  ];
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows,
    cohortWindowDays: 60,
  });
  assert.equal(res.unitsCohort, 3);
  const d7 = res.horizons.find((h) => h.key === "d7");
  assert.ok(d7);
  // ★분모는 3이 아니라 2다 — 관측창이 안 찬 유닛을 분모에 넣으면 최근 유입이
  //   자동으로 이탈로 찍힌다.
  assert.equal(d7.pending, 1);
  assert.equal(d7.exact.denominator, 2);
  assert.equal(d7.exact.numerator, 1);
  assert.equal(d7.exact.display, "1/2 (50.0%)");
  const d14 = res.horizons.find((h) => h.key === "d14");
  assert.ok(d14);
  assert.equal(d14.pending, 1);
  assert.equal(d14.exact.display, "1/2 (50.0%)");
});

test("exact and window definitions are both reported and can differ", () => {
  const today = "2026-08-21";
  const base = "2026-08-01";
  // D7 당일에는 없고 D3 에만 돌아온 유닛 → exact 0, window 1.
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: activeRows("u-window-0000-0000-00000000", base, [0, 3]),
    cohortWindowDays: 60,
  });
  const d7 = res.horizons.find((h) => h.key === "d7");
  assert.ok(d7);
  assert.equal(d7.exact.display, "0/1 (0.0%)");
  assert.equal(d7.window.display, "1/1 (100.0%)");
  // 두 정의가 이렇게 갈리므로 하나만 인용하면 결론이 뒤집힌다.
  assert.notEqual(d7.exact.rate, d7.window.rate);
});

test("first-day-only activity does not count as its own retention", () => {
  const today = "2026-08-21";
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: activeRows("u-oneshot-0000-0000-0000000", "2026-08-01", [0]),
    cohortWindowDays: 60,
  });
  const d1 = res.horizons.find((h) => h.key === "d1");
  assert.ok(d1);
  // window 는 firstActive+1 부터 센다 — 첫날 자신이 리텐션으로 잡히면 안 된다.
  assert.equal(d1.window.numerator, 0);
  assert.equal(d1.exact.numerator, 0);
});

test("units outside the cohort window are counted, not silently dropped", () => {
  const today = "2026-08-21";
  const res = buildStreakRetention({
    axis: "install",
    today,
    // 90일 전 시작 → 30일 코호트 창 밖
    rows: activeRows("u-old-0000-0000-0000000000", day(today, -90), [0, 7]),
    cohortWindowDays: 30,
  });
  assert.equal(res.unitsObserved, 1);
  assert.equal(res.unitsCohort, 0);
  // ★조용히 빠지면 "관측된 사람이 없다" 로 읽힌다. 세어서 밖으로 내보낸다.
  assert.equal(res.unitsBeforeWindow, 1);
  // 스트릭 격자에는 그대로 남는다.
  assert.equal(res.units.length, 1);
});

// ── ★함정 3: 2026-06-13 식별자 스킴 교체 ───────────────────────────────────
test("legacy 28-char install id churning at the switch date is flagged, not churn", () => {
  const today = "2026-08-21";
  const legacyId = "a".repeat(28); // Firebase uid 길이
  const uuidId = "b3f1c2d4-1111-2222-3333-444455556666"; // 36
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: [
      // 구 스킴: 4월부터 쓰다가 교체일에 끊김 → 이탈이 아니라 id 교체다
      ...activeRows(legacyId, "2026-04-19", [0, 1, 2]),
      ...activeRows(legacyId, IDENTITY_SCHEME_SWITCH_ON, [0]),
      // 신 스킴: 같은 날 시작
      ...activeRows(uuidId, IDENTITY_SCHEME_SWITCH_ON, [0, 1]),
    ],
    cohortWindowDays: 400,
  });
  const legacy = res.units.find((u) => u.legacyIdScheme);
  const current = res.units.find((u) => !u.legacyIdScheme);
  assert.ok(legacy);
  assert.ok(current);
  assert.equal(legacy.lastActive, IDENTITY_SCHEME_SWITCH_ON);
  assert.equal(legacy.suspectedIdSwitchChurn, true);
  assert.equal(current.suspectedIdSwitchChurn, false);
  assert.equal(res.identityScheme.date, IDENTITY_SCHEME_SWITCH_ON);
  assert.equal(res.identityScheme.legacyUnits, 1);
  assert.equal(res.identityScheme.currentUnits, 1);
  assert.equal(res.identityScheme.suspectedIdSwitchChurn, 1);
  // 두 id 를 같은 사람으로 이어붙이지 않는다 — 유닛은 여전히 2개다.
  assert.equal(res.unitsObserved, 2);
});

test("account axis never marks legacy scheme (uid is its normal identity)", () => {
  const res = buildStreakRetention({
    axis: "account",
    today: "2026-08-21",
    rows: activeRows("a".repeat(28), "2026-08-01", [0, 7]),
    cohortWindowDays: 60,
  });
  assert.equal(res.units[0].legacyIdScheme, false);
  assert.equal(res.units[0].suspectedIdSwitchChurn, false);
  assert.equal(res.identityScheme.legacyUnits, 0);
  // 계정 축에는 설치→계정 매핑 개념이 없다.
  assert.equal(res.mapping, null);
  assert.equal(res.units[0].mappingStatus, "n/a");
});

// ── 스트릭 계산 ────────────────────────────────────────────────────────────
test("max streak, current streak, and 14-day grid", () => {
  const today = "2026-08-21";
  const res = buildStreakRetention({
    axis: "install",
    today,
    // 5일 연속(오래 전) + 최근 3일 연속(오늘까지)
    rows: [
      ...activeRows("u-streak-0000-0000-00000000", day(today, -30), [
        0, 1, 2, 3, 4,
      ]),
      ...activeRows("u-streak-0000-0000-00000000", day(today, -2), [0, 1, 2]),
    ],
    cohortWindowDays: 400,
  });
  const u = res.units[0];
  assert.equal(u.maxStreak, 5);
  assert.equal(u.currentStreak, 3);
  assert.equal(u.daysSinceLastActive, 0);
  assert.equal(u.grid.length, STREAK_GRID_DAYS);
  assert.equal(u.gridEnd, today);
  assert.equal(u.grid.slice(-3), "xxx");
});

test("a broken streak is not reported as a current streak", () => {
  const today = "2026-08-21";
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: activeRows("u-stale-0000-0000-000000000", day(today, -10), [0, 1, 2]),
    cohortWindowDays: 400,
  });
  const u = res.units[0];
  assert.equal(u.maxStreak, 3);
  // 8일 전에 끊긴 연속을 "현재 연속" 이라 부르면 살아 있는 사용자로 보인다.
  assert.equal(u.currentStreak, 0);
  assert.equal(u.daysSinceLastActive, 8);
});

// ── 운영자 제외 (includeAdmin 토글) ────────────────────────────────────────
test("adminUnits are excluded from the cohort but stay visible with a flag", () => {
  const today = "2026-08-21";
  const adminInstall = "admin-uuid-0000-0000-00000000";
  const rows = [
    ...activeRows(adminInstall, "2026-08-01", [0, 7, 14]),
    ...activeRows("u-real-0000-0000-00000000000", "2026-08-01", [0]),
  ];
  const excluded = buildStreakRetention({
    axis: "install",
    today,
    rows,
    cohortWindowDays: 60,
    adminUnits: [adminInstall],
  });
  assert.equal(excluded.unitsAdminExcluded, 1);
  assert.equal(excluded.unitsCohort, 1);
  assert.equal(
    excluded.horizons.find((h) => h.key === "d7")?.exact.display,
    "0/1 (0.0%)",
  );
  // 화면에서 사라지지는 않는다 — 플래그를 달고 남는다.
  assert.equal(excluded.units.length, 2);
  assert.equal(
    excluded.units.filter((u) => u.adminExcluded).length,
    1,
  );

  // includeAdmin=true 면 호출측이 빈 목록을 준다 → 운영자가 코호트에 들어와
  // 숫자가 완전히 달라진다(실측: 운영자가 cost 행의 99.95%).
  const included = buildStreakRetention({
    axis: "install",
    today,
    rows,
    cohortWindowDays: 60,
    adminUnits: [],
  });
  assert.equal(included.unitsAdminExcluded, 0);
  assert.equal(included.unitsCohort, 2);
  assert.equal(
    included.horizons.find((h) => h.key === "d7")?.exact.display,
    "1/2 (50.0%)",
  );
});

// ── 설치 ↔ 계정 매핑 ───────────────────────────────────────────────────────
test("install→account mapping labels what joins and counts what does not", () => {
  const today = "2026-08-21";
  const mappedInstall = "i-mapped-0000-0000-000000000";
  const ambiguousInstall = "i-ambig-0000-0000-0000000000";
  const unmappedInstall = "i-unmapped-0000-0000-0000000";
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows: [
      ...activeRows(mappedInstall, "2026-08-01", [0]),
      ...activeRows(ambiguousInstall, "2026-08-01", [0]),
      ...activeRows(unmappedInstall, "2026-08-01", [0]),
    ],
    cohortWindowDays: 60,
    mappingRows: [
      { installUnit: mappedInstall, accountUnit: "acct-1", joins: 100 },
      { installUnit: ambiguousInstall, accountUnit: "acct-1", joins: 5 },
      { installUnit: ambiguousInstall, accountUnit: "acct-2", joins: 2 },
    ],
  });
  const byLabel = new Map(res.units.map((u) => [u.label, u]));
  const m = byLabel.get(analyticsUnitLabel("install", mappedInstall));
  const a = byLabel.get(analyticsUnitLabel("install", ambiguousInstall));
  const un = byLabel.get(analyticsUnitLabel("install", unmappedInstall));
  assert.ok(m && a && un);
  assert.equal(m.mappingStatus, "mapped");
  // 계정도 라벨로만 나간다 — 원시 uid 는 응답에 없다.
  assert.equal(m.mappedAccountLabel, analyticsUnitLabel("account", "acct-1"));
  assert.ok(!JSON.stringify(res).includes("acct-1"));
  // 모호한 매핑은 우세 계정으로 표시하되 조용히 확정하지 않는다.
  assert.equal(a.mappingStatus, "ambiguous");
  assert.equal(a.mappedAccountLabel, analyticsUnitLabel("account", "acct-1"));
  assert.equal(un.mappingStatus, "unmapped");
  assert.equal(un.mappedAccountLabel, null);
  assert.equal(res.mapping?.mappedInstalls, 1);
  assert.equal(res.mapping?.ambiguousInstalls, 1);
  // ★못 붙인 것을 빼지 않고 센다 — 조용히 빼면 인원이 줄어 보인다.
  assert.equal(res.mapping?.unmappedInstalls, 1);
});

// ── 응답 위생 ──────────────────────────────────────────────────────────────
test("raw identifiers never appear anywhere in the result", () => {
  const rawInstall = "b3f1c2d4-1111-2222-3333-444455556666";
  const rawAccount = "RSALO1rljtWBSZ70MoBiaeFORxr1";
  const res = buildStreakRetention({
    axis: "install",
    today: "2026-08-21",
    rows: activeRows(rawInstall, "2026-08-01", [0, 7]),
    cohortWindowDays: 60,
    mappingRows: [
      { installUnit: rawInstall, accountUnit: rawAccount, joins: 10 },
    ],
  });
  const json = JSON.stringify(res);
  assert.ok(!json.includes(rawInstall));
  assert.ok(!json.includes(rawAccount));
  // 정의는 반대로 반드시 실려 나가야 한다 — 화면이 그대로 적는다.
  assert.equal(res.activityDefinition, ACTIVITY_DEFINITION_INSTALL);
  assert.ok(res.notes.length > 0);
});

test("malformed rows are skipped without throwing", () => {
  const res = buildStreakRetention({
    axis: "install",
    today: "2026-08-21",
    rows: [
      { unit: "", date: "2026-08-01", workingSignals: 1 },
      { unit: "anon", date: "2026-08-01", workingSignals: 1 },
      { unit: "u-ok-0000-0000-00000000000", date: "nope", workingSignals: 1 },
      { unit: null, date: null },
      {},
      ...activeRows("u-ok-0000-0000-00000000000", "2026-08-01", [0]),
    ],
    cohortWindowDays: 60,
  });
  // "anon" 폴백과 빈 unit 은 사람이 아니다.
  assert.equal(res.unitsObserved, 1);
  assert.equal(res.units[0].activeDays, 1);
});

test("a unit that went zombie recently is flagged, even if it was active long ago", () => {
  const today = "2026-08-21";
  const unit = "u-went-zombie-0000-0000-0000";
  // 실측 케이스: 7월에는 실제로 활동했고, 최근 격자 구간은 순수 하트비트뿐이다.
  // 평생 기준으로 재면 "좀비 0" 이라 뜨는데 격자에는 좀비가 13칸 그려진다 —
  // 헤드라인과 눈에 보이는 격자가 어긋나면 안 된다.
  const rows: UnitDayActivityRow[] = [
    ...activeRows(unit, day(today, -40), [0, 1, 2]),
  ];
  for (let i = 0; i < 13; i += 1) {
    rows.push({
      unit,
      date: day(today, -i - 1),
      workingSignals: 0,
      presenceSignals: 2_700,
      eventSignals: 0,
    });
  }
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows,
    cohortWindowDays: 400,
  });
  const u = res.units[0];
  assert.equal(u.zombie, true);
  assert.equal(res.unitsZombie, 1);
  // 과거 활동은 지워지지 않는다 — 첫 활동일과 최대연속은 그대로 남는다.
  assert.equal(u.activeDays, 3);
  assert.equal(u.maxStreak, 3);
  // ★핵심: 하트비트 13일은 활동으로 세지 않는다. 격자에 x 가 하나도 없어야 한다.
  assert.ok(!u.grid.includes("x"));
  assert.equal(u.grid.split("~").length - 1, 13);
});

test("an active unit is never flagged as a zombie even with idle heartbeats", () => {
  const today = "2026-08-21";
  const unit = "u-active-0000-0000-000000000";
  const rows: UnitDayActivityRow[] = [
    // 대부분의 날은 하트비트만, 하루는 실제 활동 → 좀비가 아니다.
    { unit, date: day(today, -5), workingSignals: 0, presenceSignals: 500 },
    { unit, date: today, workingSignals: 3, presenceSignals: 500 },
  ];
  const res = buildStreakRetention({
    axis: "install",
    today,
    rows,
    cohortWindowDays: 400,
  });
  assert.equal(res.units[0].zombie, false);
  assert.equal(res.unitsZombie, 0);
});

// ── ★단계별 계측 커버리지 (ticket 4KqBDPkH) ────────────────────────────────
// 회귀 대상: 사장님 화면의 "첫 대화 0 / 첫 티켓 0 / 에이전트 스폰 2".
// 실측상 이벤트는 있었고(30일 창 안 4설치·3설치), 0 이 나온 건 그 계측이
// 조회창 도중에 처음 생겼기 때문이다. 값은 그대로 두되 **그 0 이 무슨 0 인지**를
// 화면이 알 수 있어야 한다.

test("coverage: 전기간 0건 이벤트는 맵에 안 들어가고 'missing' 으로 판정된다", () => {
  const map = buildFunnelCoverageMap([
    { event: "app:first_run", first_seen_day: "2026-04-18", clients_in_window: 7 },
  ]);
  // app:installed 는 전기간 0건 → 행 자체가 없다.
  assert.equal(map.has("app:installed"), false);
  assert.equal(classifyStepCoverage(map.get("app:installed"), "2026-07-23"), "missing");
});

test("coverage: 최초 발신일이 조회창 시작보다 늦으면 'partial'", () => {
  const map = buildFunnelCoverageMap([
    {
      event: "onboarding:first_conversation",
      first_seen_day: "2026-08-10",
      clients_in_window: 4,
    },
  ]);
  const cov = map.get("onboarding:first_conversation");
  assert.equal(classifyStepCoverage(cov, "2026-07-23"), "partial");
  // 창이 계측 이후로 좁혀지면 더 이상 partial 이 아니다.
  assert.equal(classifyStepCoverage(cov, "2026-08-15"), "ok");
  // 같은 날 시작이면 창 전체가 덮이므로 ok.
  assert.equal(classifyStepCoverage(cov, "2026-08-10"), "ok");
});

test("coverage: 창 시작일을 모르면 partial 딱지를 붙이지 않는다", () => {
  const map = buildFunnelCoverageMap([
    { event: "e", first_seen_day: "2026-08-10", clients_in_window: 1 },
  ]);
  assert.equal(classifyStepCoverage(map.get("e"), null), "ok");
});

test("coverage: 날짜 형식이 아닌 first_seen_day 행은 신호로 치지 않는다", () => {
  const map = buildFunnelCoverageMap([
    { event: "e1", first_seen_day: null, clients_in_window: 9 },
    { event: "e2", first_seen_day: "not-a-date", clients_in_window: 9 },
    { event: "", first_seen_day: "2026-08-10", clients_in_window: 9 },
  ]);
  assert.equal(map.size, 0);
});

test("★funnel: 커버리지를 안 주면 예전과 똑같이 동작한다(회귀 방지)", () => {
  const f = buildOnboardingFunnel({ d_first_run: 7 }, []);
  for (const s of f.steps) {
    assert.equal(s.coverage, "ok");
    assert.equal(s.firstObservedDay, null);
    assert.equal(s.everInWindow, null);
  }
  assert.equal(f.headline.everActivatedInWindow, null);
});

test("★funnel: 사장님 화면 재현 — 첫대화 0 은 '안 했다'가 아니라 '부분 계측'이다", () => {
  // BQ 실측(2026-08-22, 30일 창, 운영자 제외절 적용)을 그대로 넣는다.
  const row = {
    d_install: 7,
    d_first_run: 7,
    d_login_attempt: 5,
    d_login_success: 5,
    d_folder_connected: 2,
    d_orchestrator_opened: 2,
    d_first_conversation: 0,
    d_first_ticket: 0,
    d_agent_spawned: 2,
    n_agent_spawned: 2452,
    d_task_completed: 0,
    d_signup_base: 5,
    d_activated_30m: 0,
  };
  const coverage = [
    { event: "app:first_run", first_seen_day: "2026-04-18", clients_in_window: 7 },
    { event: "auth:login_attempt", first_seen_day: "2026-04-19", clients_in_window: 5 },
    { event: "auth:login_success", first_seen_day: "2026-04-19", clients_in_window: 5 },
    {
      event: "onboarding:folder_connected",
      first_seen_day: "2026-04-19",
      clients_in_window: 6,
    },
    {
      event: "onboarding:orchestrator_opened",
      first_seen_day: "2026-04-19",
      clients_in_window: 7,
    },
    {
      event: "onboarding:first_conversation",
      first_seen_day: "2026-08-10",
      clients_in_window: 4,
    },
    {
      event: "onboarding:first_ticket",
      first_seen_day: "2026-08-09",
      clients_in_window: 3,
    },
    { event: "agent:spawned", first_seen_day: "2026-04-18", clients_in_window: 6 },
    { event: "task:completed", first_seen_day: "2026-06-17", clients_in_window: 2 },
    { event: "session:started", first_seen_day: "2026-04-19", clients_in_window: 10 },
  ];
  const f = buildOnboardingFunnel(row, [], coverage, "2026-07-23");
  const byKey = new Map(f.steps.map((s) => [s.key, s]));

  // ★핵심: 값은 그대로 0 이지만(소급 보정 금지), 상태가 붙는다.
  const conv = byKey.get("first_conversation")!;
  assert.equal(conv.clients, 0);
  assert.equal(conv.coverage, "partial");
  assert.equal(conv.firstObservedDay, "2026-08-10");
  assert.equal(conv.everInWindow, 4); // ← 화면이 "실제로는 4설치" 라고 말할 근거

  const ticket = byKey.get("first_ticket")!;
  assert.equal(ticket.coverage, "partial");
  assert.equal(ticket.everInWindow, 3);

  // ★전기간 0건인 칸은 'missing' — 화면은 숫자가 아니라 '미수집' 을 그린다.
  assert.equal(byKey.get("install")!.coverage, "missing");

  // 계측이 창 전체를 덮는 칸은 손대지 않는다.
  assert.equal(byKey.get("agent_spawned")!.coverage, "ok");
  assert.equal(byKey.get("agent_spawned")!.clients, 2);

  // ★활성화율 0/5 는 그대로 두되, 같은 창의 실측 완료 설치 수를 함께 싣는다.
  assert.equal(f.headline.activatedClients, 0);
  assert.equal(f.headline.baseClients, 5);
  assert.equal(f.headline.rate, 0);
  assert.equal(f.headline.everActivatedInWindow, 2);
});

test("★funnel: 계측 공백 칸은 최대 이탈 구간으로 붉게 칠하지 않는다", () => {
  // install(전기간 0건) 이 0 이고 first_run 이 20 인 억지 상황을 만들어도,
  // 'missing' 칸은 절벽 후보에서 빠져야 한다.
  const row = {
    d_install: 0,
    d_first_run: 20,
    d_login_attempt: 20,
    d_login_success: 4,
  };
  const f = buildOnboardingFunnel(
    row,
    [],
    [
      { event: "app:first_run", first_seen_day: "2026-01-01", clients_in_window: 20 },
      { event: "auth:login_attempt", first_seen_day: "2026-01-01", clients_in_window: 20 },
      { event: "auth:login_success", first_seen_day: "2026-01-01", clients_in_window: 4 },
    ],
    "2026-07-23",
  );
  const byKey = new Map(f.steps.map((s) => [s.key, s]));
  assert.equal(byKey.get("install")!.coverage, "missing");
  assert.equal(byKey.get("install")!.isMaxDrop, false);
  // 진짜 절벽(20 → 4)만 표시된다.
  assert.equal(byKey.get("login_success")!.isMaxDrop, true);
});

test("coverage: note 가 '미수집/부분 계측' 규약을 실제로 말한다", () => {
  const f = buildOnboardingFunnel(undefined, []);
  assert.ok(f.note.includes("미수집"));
  assert.ok(f.note.includes("부분 구간"));
});

// ── buildBetaScorecard (베타 종료 KPI 스코어카드) ────────────────────────────
//
// ★이 블록이 지키는 것은 "틀린 숫자를 예쁘게 그리지 않는다" 하나다:
//   분모 0 → 0% 가 아니라 null, 측정 불가 → 0 이 아니라 null + 사유,
//   다른 봉투에서 오는 값 → 여기서 0 으로 채우지 않는다.

const scorecardInput = (
  over: Partial<{
    install: Record<string, unknown>;
    person: Record<string, unknown> | null;
    personUnavailableReason: string | null;
  }> = {}
) => ({
  install: {
    activeInstalls: 44,
    activatedInstalls: 5,
    firstSpawnInstalls: 18,
    monthlyTasks: 1088,
    powerUsers: 3,
    d7Cohort: 7,
    d7Retained: 3,
    d14Cohort: 7,
    d14Retained: 4,
    d30Cohort: 6,
    d30Retained: 3,
    d30Pending: 1,
    ...(over.install ?? {}),
  },
  person:
    over.person === undefined
      ? { linkedPeople: 2, peopleWithTask: 1, activePeople: 2 }
      : over.person,
  personUnavailableReason: over.personUnavailableReason ?? null,
}) as Parameters<typeof buildBetaScorecard>[0];

const metricOf = (
  r: ReturnType<typeof buildBetaScorecard>,
  key: string
) => {
  const m = r.metrics.find((x) => x.key === key);
  assert.ok(m, `metric ${key} 가 없다`);
  return m;
};

test("buildBetaScorecard: 11개 지표가 전부 나온다", () => {
  const r = buildBetaScorecard(scorecardInput());
  assert.equal(r.metrics.length, 11);
  assert.deepEqual(
    r.metrics.map((m) => m.key),
    [
      "qualified_beta",
      "activated",
      "d7_retention",
      "d14_retention",
      "d30_retention",
      "d30_retained_users",
      "power_user",
      "monthly_agent_tasks",
      "paying_users",
      "design_partners",
      "paid_poc",
    ]
  );
  // 사장님이 못 박으신 최중요 지표 — 화면이 이걸 가장 크게 그린다.
  assert.equal(r.heroKey, SCORECARD_HERO_KEY);
  assert.equal(r.heroKey, "d30_retention");
});

test("buildBetaScorecard: 모든 rate 지표가 분자·분모를 달고 다닌다", () => {
  const r = buildBetaScorecard(scorecardInput());
  for (const m of r.metrics) {
    if (m.unit !== "rate") {
      assert.equal(m.counted, null, `${m.key} 는 count 인데 counted 가 있다`);
      continue;
    }
    assert.ok(m.counted, `${m.key} 에 분자·분모가 없다`);
    // 화면이 그대로 찍을 수 있는 "3/7 (42.9%)" 문자열.
    assert.match(m.counted.display, /^\d+\/\d+ \((\d+\.\d%|—)\)$/);
  }
  const d30 = metricOf(r, "d30_retention");
  assert.equal(d30.counted?.numerator, 3);
  assert.equal(d30.counted?.denominator, 6);
  assert.equal(d30.value, 0.5);
});

test("buildBetaScorecard: 실측값을 그대로 재현한다(설치 축)", () => {
  // 2026-08-29 프로덕션 BQ 실측. 이 값이 바뀌면 정의가 바뀐 것이다.
  const r = buildBetaScorecard(scorecardInput());
  assert.equal(metricOf(r, "d7_retention").counted?.display, "3/7 (42.9%)");
  assert.equal(metricOf(r, "d14_retention").counted?.display, "4/7 (57.1%)");
  assert.equal(metricOf(r, "d30_retention").counted?.display, "3/6 (50.0%)");
  // D30 retained users 는 D30 비율의 분자 그 자체다(같은 수를 두 번 안 센다).
  assert.equal(metricOf(r, "d30_retained_users").value, 3);
});

test("buildBetaScorecard: 분모 0 이면 0% 가 아니라 null 이다", () => {
  const r = buildBetaScorecard(
    scorecardInput({
      install: {
        d7Cohort: 0,
        d7Retained: 0,
        d14Cohort: 0,
        d14Retained: 0,
        d30Cohort: 0,
        d30Retained: 0,
      },
    })
  );
  for (const key of ["d7_retention", "d14_retention", "d30_retention"]) {
    const m = metricOf(r, key);
    assert.equal(m.value, null, `${key} 가 0 으로 접혔다`);
    assert.equal(m.counted?.rate, null);
    // ★분모 0 이어도 분수는 남긴다 — 지우면 측정값을 숨기는 것이다.
    assert.equal(m.counted?.display, "0/0 (—)");
    assert.equal(m.attainment, null);
    assert.equal(m.remaining, null);
    // 분모가 없으면 달성이 아니라 미상이다.
    assert.equal(m.met, false);
  }
});

test("buildBetaScorecard: 빈 데이터에서도 던지지 않고 전부 0/미상이다", () => {
  const r = buildBetaScorecard({
    install: {
      activeInstalls: undefined,
      activatedInstalls: null,
      firstSpawnInstalls: undefined,
      monthlyTasks: "",
      powerUsers: undefined,
      d7Cohort: undefined,
      d7Retained: undefined,
      d14Cohort: undefined,
      d14Retained: undefined,
      d30Cohort: undefined,
      d30Retained: undefined,
      d30Pending: undefined,
    },
    person: null,
    personUnavailableReason: "게이트 닫힘",
  });
  assert.equal(r.metrics.length, 11);
  // ★Qualified Beta 는 계정 축이라 이 응답에서 값이 오지 않는다 — 0 이 아니라 null.
  assert.equal(metricOf(r, "qualified_beta").value, null);
  assert.equal(metricOf(r, "d30_retention").value, null);
  assert.equal(r.personAxisCounts, null);
  assert.equal(r.personUnavailableReason, "게이트 닫힘");
  // 목표를 넘은 것이 하나도 없어야 한다(0 은 달성이 아니다).
  assert.equal(
    r.metrics.filter((m) => m.met).length,
    0
  );
});

test("buildBetaScorecard: 측정 불가 지표는 0 이 아니라 null + 사유다", () => {
  const r = buildBetaScorecard(scorecardInput());
  for (const key of ["design_partners", "paid_poc"]) {
    const m = metricOf(r, key);
    assert.equal(m.measurable, false);
    assert.equal(m.axis, "manual");
    // ★0 으로 그리면 "아직 한 곳도 없다"로 읽히는데, 우리는 그것조차 모른다.
    assert.equal(m.value, null, `${key} 가 0 으로 그려진다`);
    assert.equal(m.met, false);
    assert.ok(
      m.unmeasuredReason && m.unmeasuredReason.length > 0,
      `${key} 에 사유가 없다`
    );
    // 목표치는 그대로 보인다 — 측정을 못 한다고 목표를 지우지는 않는다.
    assert.ok(m.targetMin > 0);
  }
});

test("buildBetaScorecard: Paying Users 는 다른 봉투에서 온다(여기서 0 으로 안 채운다)", () => {
  const m = metricOf(buildBetaScorecard(scorecardInput()), "paying_users");
  assert.equal(m.axis, "account");
  assert.equal(m.value, null);
  assert.equal(
    m.externalSource,
    "getAdminBusinessSummary.subscriptions.paidCurrent"
  );
  // 측정 가능한 지표다 — '측정 불가'와 구분된다(사유가 없어야 한다).
  assert.equal(m.measurable, true);
  assert.equal(m.unmeasuredReason, null);
});

test("buildBetaScorecard: 사람 축은 원수만 내고 비율을 만들지 않는다", () => {
  const r = buildBetaScorecard(scorecardInput());
  assert.deepEqual(r.personAxisCounts, {
    linkedPeople: 2,
    peopleWithTask: 1,
    activePeople: 2,
  });
  assert.equal(r.personUnavailableReason, null);
  // ★사람 축 값을 분모로 쓰는 비율 지표가 하나도 없어야 한다.
  assert.equal(r.metrics.filter((m) => m.axis === "person").length, 0);
});

test("buildBetaScorecard: 달성률은 목표 하한 기준이고 1.0 을 넘을 수 있다", () => {
  const r = buildBetaScorecard(scorecardInput());
  const d30 = metricOf(r, "d30_retention");
  // 0.5 / 0.20 = 2.5 — clamp 하지 않는다. 눕히면 수치를 고치는 것이다.
  assert.ok(d30.attainment != null && Math.abs(d30.attainment - 2.5) < 1e-9);
  assert.equal(d30.met, true);
  assert.equal(d30.remaining, 0);

  const activated = metricOf(r, "activated");
  assert.equal(activated.value, 5);
  assert.equal(activated.targetMin, 200);
  assert.equal(activated.remaining, 195); // 목표까지 얼마나 남았나
  assert.equal(activated.met, false);
  assert.ok(
    activated.attainment != null &&
      Math.abs(activated.attainment - 0.025) < 1e-9
  );
});

test("buildBetaScorecard: 축 경고와 작은표본 임계가 응답에 실려 있다", () => {
  const r = buildBetaScorecard(scorecardInput());
  assert.equal(r.smallSampleMax, SCORECARD_SMALL_SAMPLE_MAX);
  // 화면이 축을 말하지 않으면 숫자가 거짓말이 된다 — 서버가 문장을 들려 보낸다.
  assert.match(r.axisNote, /설치 축/);
  assert.match(r.axisNote, /더하거나/);
  // note 는 D30 > D7 역전이 왜 일어나는지를 화면이 설명할 수 있게 한다.
  assert.match(r.note, /분모/);
  // 모든 설치 축 지표가 자기 단위가 설치임을 스스로 말한다.
  for (const m of r.metrics) {
    if (m.axis !== "install" || m.key === "monthly_agent_tasks") continue;
    assert.match(m.measuredAs, /설치/, `${m.key} 가 축을 말하지 않는다`);
  }
});

test("buildBetaScorecard: 설치 축 조회가 실패하면 0 이 아니라 '미상'이다", () => {
  // ★이게 이 빌더에서 가장 중요한 방어다. 쿼리 실패를 빈 행으로 흘리면 전부 0 이
  //   되고, 화면은 그 0 을 "측정했더니 0" 으로 읽는다 — 조회 실패를 제품 실패로
  //   그리는 것이라 D30 히어로가 "0% (0/0)" 으로 크게 뜨게 된다.
  const r = buildBetaScorecard({
    install: null,
    installUnavailableReason: "kpi.scorecard 실패",
    person: { linkedPeople: 2, peopleWithTask: 1, activePeople: 2 },
  });
  assert.equal(r.installUnavailableReason, "kpi.scorecard 실패");
  const installMetrics = r.metrics.filter((m) => m.axis === "install");
  assert.ok(installMetrics.length >= 7);
  for (const m of installMetrics) {
    assert.equal(m.measurable, false, `${m.key} 가 측정 가능으로 남았다`);
    assert.equal(m.value, null, `${m.key} 가 0 으로 접혔다`);
    assert.equal(m.met, false);
    assert.equal(m.unmeasuredReason, "kpi.scorecard 실패");
  }
  // 사람 축은 살아 있다 — 한 쿼리 실패가 다른 축을 죽이지 않는다.
  assert.deepEqual(r.personAxisCounts, {
    linkedPeople: 2,
    peopleWithTask: 1,
    activePeople: 2,
  });
  // 지표 개수는 그대로다. 실패했다고 칸이 사라지면 화면이 짧아져 눈치채기 어렵다.
  assert.equal(r.metrics.length, 11);
});

test("buildBetaScorecard: 사유를 안 주면 기본 사유가 붙는다(빈 사유 금지)", () => {
  const r = buildBetaScorecard({ install: null, person: null });
  assert.ok(
    r.installUnavailableReason && r.installUnavailableReason.length > 0,
    "사유 없이 '미상'만 그리면 화면이 고장으로 읽힌다"
  );
  assert.equal(r.metrics.find((m) => m.key === "d30_retention")?.value, null);
});

test("buildBetaScorecard: 정상 경로에서는 installUnavailableReason 이 null 이다", () => {
  assert.equal(buildBetaScorecard(scorecardInput()).installUnavailableReason, null);
});

// ── 사장님 최종 확정 정의 (리뷰 반영) ────────────────────────────────────────

test("★Activated 정본은 3 Task 이고 목표는 단일값 200 이다", () => {
  const m = metricOf(buildBetaScorecard(scorecardInput()), "activated");
  assert.equal(m.axis, "install");
  assert.equal(m.value, 5); // 누적 완료 task ≥ 3 인 설치
  assert.equal(m.targetMin, 200);
  assert.equal(m.targetMax, 200, "목표가 범위면 초안이 남아 있는 것이다");
  // 첫 스폰으로 잘못 바뀌지 않았는지 문구로도 못박는다.
  assert.match(m.measuredAs, /누적 완료 task 가 3건 이상/);
  assert.match(m.measuredAs, /최종\s*확정/);
});

test("★첫 스폰은 선행지표이지 Activated 가 아니다 (11개 격자 밖 · 목표 없음)", () => {
  const r = buildBetaScorecard(scorecardInput());
  // 11개 KPI 격자에는 없다.
  assert.equal(r.metrics.length, 11);
  assert.equal(
    r.metrics.filter((m) => m.key === "first_spawn_leading").length,
    0,
    "선행지표가 KPI 격자에 섞였다"
  );
  assert.equal(r.leadingIndicators.length, 1);
  const spawn = r.leadingIndicators[0];
  assert.equal(spawn.key, "first_spawn_leading");
  assert.equal(spawn.value, 18);
  // ★이름에 Activated 가 들어가면 안 된다.
  assert.doesNotMatch(spawn.label, /^Activated/);
  assert.match(spawn.label, /선행지표/);
  assert.match(spawn.label, /Activated 아님/);
  // ★목표를 붙이면 12번째 KPI 가 된다 — 달성/미달 판정 자체가 없어야 한다.
  assert.equal(spawn.targetMin, 0);
  assert.equal(spawn.attainment, null);
  assert.equal(spawn.met, false, "목표 없는 줄이 '달성'으로 떴다");
  assert.equal(spawn.remaining, null, "도달할 목표가 없는데 '남은 양'이 생겼다");
});

test("★Qualified Beta 는 신청·승인(계정 축)이지 설치 수가 아니다", () => {
  const m = metricOf(buildBetaScorecard(scorecardInput()), "qualified_beta");
  assert.equal(m.axis, "account");
  assert.equal(m.definition, "신청하고 우리가 승인한 사람");
  // ★설치 수 44 가 이 자리에 새어 들어오면 안 된다.
  assert.equal(m.value, null);
  assert.equal(m.externalSource, "getAdminBusinessSummary.betaAccess.grantTotal");
  assert.equal(m.targetMin, 500);
  assert.equal(m.targetMax, 500);
  assert.match(m.measuredAs, /설치 축의 '활동 설치 수'를 이 자리에 쓰면 안 됩니다/);
});

test("★목표치는 전부 사장님 최종 확정 단일값이다(범위형 초안 잔존 0)", () => {
  const r = buildBetaScorecard(scorecardInput());
  const t = (k: string) => {
    const m = metricOf(r, k);
    return [m.targetMin, m.targetMax];
  };
  assert.deepEqual(t("qualified_beta"), [500, 500]);
  assert.deepEqual(t("activated"), [200, 200]);
  assert.deepEqual(t("d14_retention"), [0.25, 0.25]);
  assert.deepEqual(t("d30_retention"), [0.2, 0.2]);
  assert.deepEqual(t("power_user"), [20, 20]);
  assert.deepEqual(t("monthly_agent_tasks"), [10000, 10000]);
  // ★사장님이 범위로 확정하신 셋은 범위 그대로 둔다(단일값 강제 아님).
  assert.deepEqual(t("d30_retained_users"), [30, 40]);
  assert.deepEqual(t("design_partners"), [3, 5]);
  assert.deepEqual(t("paid_poc"), [1, 2]);
});

test("★D30 목표가 0.20 으로 올라가 met 판정이 그에 맞게 움직인다", () => {
  // 3/6 = 50% → 여전히 달성. 다만 분모 6이라 화면이 경고를 같이 그린다.
  const met = metricOf(buildBetaScorecard(scorecardInput()), "d30_retention");
  assert.equal(met.targetMin, 0.2);
  assert.equal(met.met, true);
  // 18% 였다면 예전 목표(0.15)로는 달성, 새 목표(0.20)로는 미달이어야 한다.
  const below = metricOf(
    buildBetaScorecard(
      scorecardInput({ install: { d30Cohort: 100, d30Retained: 18 } })
    ),
    "d30_retention"
  );
  assert.equal(below.value, 0.18);
  assert.equal(below.met, false, "목표가 아직 0.15 로 남아 있다");
});

test("★설치 축 조회 실패는 선행지표도 '미상'으로 만든다", () => {
  const r = buildBetaScorecard({ install: null, person: null });
  assert.equal(r.leadingIndicators[0].value, null);
  assert.equal(r.leadingIndicators[0].measurable, false);
});

// ── deriveEffectiveModel / foldEffectiveModelDistribution (티켓 g6TjsfP9NdtHlwuziyt7) ──
// events.model 은 하네스축이다. env-swap 벤더(solar/kimi/glm/deepseek/minimax)는
// 자기 하네스가 없어 codex/claude 를 빌리므로, "실제 모델"은 metadata.spawnedModel
// 에서만 알 수 있다(핀했을 때만). 여기서는 agentId 조인 없이 같은 익명축 안에서
// 그 값을 접는 것만 검증한다 — MODEL_BREAKDOWN_RETIRED 가 끊은 다리(events↔cost_logs
// agentId 조인)를 다시 잇지 않는다는 것도 이 함수들의 시그니처(조인 없음)로 고정된다.

test("deriveEffectiveModel: spawnedModel 이 있으면 효과(@effort)를 벗기고 그것을 쓴다", () => {
  assert.equal(deriveEffectiveModel("gpt", "solar-pro4@high"), "solar-pro4");
  assert.equal(deriveEffectiveModel("claude", "MiniMax-M3"), "MiniMax-M3");
});

test("deriveEffectiveModel: spawnedModel 이 없으면 하네스로 폴백한다 — 지어내지 않는다", () => {
  assert.equal(deriveEffectiveModel("gpt", undefined), "gpt");
  assert.equal(deriveEffectiveModel("claude", null), "claude");
  assert.equal(deriveEffectiveModel("claude", ""), "claude");
  assert.equal(deriveEffectiveModel("claude", "   "), "claude");
});

test("deriveEffectiveModel: 하네스도 없으면 (none) — 빈 문자열을 지어내지 않는다", () => {
  assert.equal(deriveEffectiveModel(undefined, undefined), "(none)");
  assert.equal(deriveEffectiveModel(null, null), "(none)");
  assert.equal(deriveEffectiveModel("", ""), "(none)");
});

test("foldEffectiveModelDistribution: 하네스만 다른 두 행이 spawnedModel 이 같으면 한 키로 합쳐진다", () => {
  // ★이게 이 기능의 핵심 — solar-pro4 가 gpt 하네스와 claude 하네스 양쪽에서
  // 돌아도(같은 모델, 다른 하네스) "실제 모델별" 에서는 한 줄로 보여야 한다.
  const rows = [
    { model: "gpt", spawnedModel: "solar-pro4@low", n: 17 },
    { model: "claude", spawnedModel: "solar-pro4@high", n: 4 },
  ];
  assert.deepEqual(foldEffectiveModelDistribution(rows), [
    { key: "solar-pro4", count: 21 },
  ]);
});

test("foldEffectiveModelDistribution: 하네스축과 총합이 같다 — 표 두 개의 합이 어긋나지 않는다", () => {
  const rows = [
    { model: "claude", spawnedModel: "claude-opus-5", n: 423 },
    { model: "gpt", spawnedModel: null, n: 100 }, // 미핀 스폰 — 하네스로 폴백
    { model: "gpt", spawnedModel: "solar-pro4@medium", n: 5 },
  ];
  const folded = foldEffectiveModelDistribution(rows);
  const total = folded.reduce((s, r) => s + r.count, 0);
  assert.equal(total, 423 + 100 + 5);
  // 미핀 gpt 행은 하네스 "gpt" 로 폴백됐지 사라지지 않았다.
  assert.deepEqual(
    folded.find((r) => r.key === "gpt"),
    { key: "gpt", count: 100 },
  );
});

test("foldEffectiveModelDistribution: 내림차순 정렬 — foldDistribution 계열과 같은 계약", () => {
  const rows = [
    { model: "gpt", spawnedModel: "gpt-5.6-terra@medium", n: 3 },
    { model: "claude", spawnedModel: "claude-opus-5", n: 423 },
    { model: "grok", spawnedModel: "grok-4.6", n: 30 },
  ];
  const folded = foldEffectiveModelDistribution(rows);
  assert.deepEqual(
    folded.map((r) => r.key),
    ["claude-opus-5", "grok-4.6", "gpt-5.6-terra"],
  );
});

test("foldEffectiveModelDistribution: 빈 입력·비문자열 필드에도 안전(NaN 없음)", () => {
  assert.deepEqual(foldEffectiveModelDistribution([]), []);
  const rows = [{ model: 123, spawnedModel: undefined, n: "bad" }];
  assert.deepEqual(foldEffectiveModelDistribution(rows), [
    { key: "(none)", count: 0 },
  ]);
});
