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
  buildRetentionCohorts,
  buildActiveUserMetrics,
  buildActivationGateFunnel,
  buildOnboardingStallSummary,
  buildZeroFrictionKpis,
  MULTI_AGENT_TARGET_WINDOW_MINUTES,
  MODEL_CONNECT_ANCHOR_EVENTS,
  modelConnectedPredicateSql,
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
