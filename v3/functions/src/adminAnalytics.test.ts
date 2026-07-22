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
    []
  );
  assert.equal(f.headline.activatedClients, 4);
  assert.equal(f.headline.baseClients, 10);
  assert.equal(f.headline.rate, 0.4);
});
