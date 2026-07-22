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
    "COUNT(DISTINCT sessionId)",
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

  assert.equal(byKey.first_run.clients, 22);
  assert.equal(byKey.first_run.dropFromPrev, null);
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

test("funnel: non-monotonic reach (resume path) clamps drop to 0, keeps reach honest", () => {
  // folder_connected=0 인데 orchestrator_opened=6 (전부 resumed:true).
  const row = {
    d_first_run: 6,
    d_login_attempt: 6,
    d_login_success: 6,
    d_folder_connected: 0,
    d_orchestrator_opened: 6,
    d_agent_spawned: 5,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  // reach 는 있는 그대로.
  assert.equal(byKey.folder_connected.clients, 0);
  assert.equal(byKey.orchestrator_opened.clients, 6);
  // folder(0) → orch(6) 는 증가라 drop=0 (음수 clamp).
  assert.equal(byKey.orchestrator_opened.dropFromPrev, 0);
  // 최대 이탈은 login_success(6) → folder_connected(0) = 6.
  assert.equal(byKey.folder_connected.dropFromPrev, 6);
  assert.equal(byKey.folder_connected.isMaxDrop, true);
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
    // 활성화 단계 — index.ts 가 별도 subquery 로 주입하는 스칼라.
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
  // agent_spawned(20) → task_completed(1) 은 drop 19 로 최대치지만 activation 이라
  // isMaxDrop 후보에서 제외 — 본선 최대 이탈(login_success 18 → folder 3 = 15)이 남는다.
  const row = {
    d_first_run: 22,
    d_login_attempt: 21,
    d_login_success: 18,
    d_folder_connected: 3,
    d_orchestrator_opened: 21,
    d_agent_spawned: 20,
    d_task_completed: 1,
    d_core_experience: 1,
    d_retained_7d: 0,
  };
  const f = buildOnboardingFunnel(row, []);
  const byKey = Object.fromEntries(f.steps.map((s) => [s.key, s]));
  // drop 값 자체는 activation 에도 계산된다(참고용).
  assert.equal(byKey.task_completed.dropFromPrev, 19);
  // 그러나 최대 이탈 플래그는 reach 안에서만.
  const flagged = f.steps.filter((s) => s.isMaxDrop);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].key, "folder_connected");
  assert.equal(flagged[0].kind, "reach");
});

// ── buildActivationHeadline (★가입 후 30분내 첫 티켓 완료 비율) ──────────────
test("headline: rate = activated / signup base, 30min window", () => {
  const h = buildActivationHeadline({ d_activated_30m: 3, d_signup_base: 12 });
  assert.equal(h.activatedClients, 3);
  assert.equal(h.baseClients, 12);
  assert.equal(h.rate, 3 / 12);
  assert.equal(h.windowMinutes, 30);
  assert.match(h.label, /30분/);
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
  assert.match(h.label, /60분/);
});

test("funnel: result carries headline built from same row", () => {
  const f = buildOnboardingFunnel(
    { d_activated_30m: 4, d_signup_base: 10 },
    [],
  );
  assert.equal(f.headline.activatedClients, 4);
  assert.equal(f.headline.baseClients, 10);
  assert.equal(f.headline.rate, 0.4);
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
test("gauges: 6 gauges in flow order, targets from strategy memo", () => {
  const nps = computeNpsFromStars([]);
  const gauges = buildBetaExitGauges({}, nps);
  assert.equal(gauges.length, 6);
  assert.deepEqual(
    gauges.map((g) => g.key),
    [
      "cli_auth_success",
      "first_project_run",
      "first_ticket_completed",
      "retention_7d",
      "satisfaction_nps",
      "activation_30m",
    ],
  );
  assert.equal(gauges[0].target, BETA_EXIT_TARGETS.cli_auth_success);
  assert.equal(gauges[0].target, 0.8);
  assert.equal(gauges[1].target, 0.6);
  assert.equal(gauges[2].target, 0.5);
  assert.equal(gauges[3].target, 0.3);
  assert.equal(gauges[4].target, 40);
  assert.equal(gauges[4].unit, "nps");
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
    ["notice", "connect", "project"],
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
    0.4,
  );
  assert.equal(
    buildConsentSummary({
      shownClients: 0,
      grantedClients: 0,
      shownEvents: 0,
      grantedEvents: 0,
    }).grantRate,
    null,
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

  assert.equal(result.betaExitGauges.length, 6);
  assert.equal(result.onboardingEvents.cliSetup.length, 3);
  assert.equal(result.onboardingEvents.survey.nps.total, 5);
  assert.equal(
    result.onboardingEvents.survey.cliFailReasons[0].key,
    "cli_auth",
  );
  assert.equal(result.onboardingEvents.demo.completionRate, 0.6);
  assert.equal(result.onboardingEvents.consent.grantRate, 0.5);
  assert.equal(result.reuse.secondSessionRate, 0.25);
  assert.equal(result.spawnHealth.successRate, 25 / 30);
  assert.match(result.note, /3\.0\.19/);
});
