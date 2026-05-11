// Plain-Node smoke test for the plan-throttle helpers. Mirrors the
// production logic in v3/src/lib/planLimits.ts. Run:
//   node v3/tests/lib/planLimits.test.mjs

const AGENT_CONCURRENCY_LIMIT = {
  free: 2,
  pro: 5,
  team: -1,
  team_plus: -1,
  enterprise: -1,
};

const ACTIVE_STATUSES = ["idle", "working"];

function getAgentLimit(plan) {
  const v = AGENT_CONCURRENCY_LIMIT[plan];
  return v === undefined ? -1 : v;
}

function countActiveAgents(agents) {
  return agents.filter((a) => ACTIVE_STATUSES.includes(a.status)).length;
}

function checkAgentSpawn(plan, agents) {
  const limit = getAgentLimit(plan);
  const active = countActiveAgents(agents);
  if (limit < 0) return { allowed: true, active, limit };
  if (active < limit) return { allowed: true, active, limit };
  return { allowed: false, active, limit };
}

const A = (status) => ({ status });

const cases = [
  // ── Limit lookup ──────────────────────────────────────────
  ["free → 2", () => getAgentLimit("free") === 2],
  ["pro → 5", () => getAgentLimit("pro") === 5],
  ["team → unlimited", () => getAgentLimit("team") === -1],
  ["team_plus → unlimited", () => getAgentLimit("team_plus") === -1],
  ["enterprise → unlimited", () => getAgentLimit("enterprise") === -1],
  [
    "unknown plan → unlimited (fail-open)",
    () => getAgentLimit("future_plan") === -1,
  ],

  // ── Active count ──────────────────────────────────────────
  ["empty list → 0", () => countActiveAgents([]) === 0],
  ["1 idle → 1", () => countActiveAgents([A("idle")]) === 1],
  ["1 working → 1", () => countActiveAgents([A("working")]) === 1],
  ["stopped does not count", () => countActiveAgents([A("stopped")]) === 0],
  ["error does not count", () => countActiveAgents([A("error")]) === 0],
  [
    "mixed",
    () =>
      countActiveAgents([A("idle"), A("working"), A("stopped"), A("error")]) ===
      2,
  ],

  // ── Throttle: free ────────────────────────────────────────
  ["free empty → allowed", () => checkAgentSpawn("free", []).allowed === true],
  [
    "free 1 active → allowed",
    () => checkAgentSpawn("free", [A("idle")]).allowed === true,
  ],
  [
    "free 2 active → blocked",
    () => checkAgentSpawn("free", [A("idle"), A("working")]).allowed === false,
  ],
  [
    "free 2 active + 1 stopped → blocked (stopped doesn't free a slot)",
    () =>
      checkAgentSpawn("free", [A("idle"), A("working"), A("stopped")])
        .allowed === false,
  ],
  [
    "free 3 stopped → allowed",
    () =>
      checkAgentSpawn("free", [A("stopped"), A("stopped"), A("stopped")])
        .allowed === true,
  ],

  // ── Throttle: pro ─────────────────────────────────────────
  [
    "pro 4 active → allowed",
    () => checkAgentSpawn("pro", Array(4).fill(A("idle"))).allowed === true,
  ],
  [
    "pro 5 active → blocked",
    () => checkAgentSpawn("pro", Array(5).fill(A("idle"))).allowed === false,
  ],
  [
    "pro 5 working → blocked",
    () => checkAgentSpawn("pro", Array(5).fill(A("working"))).allowed === false,
  ],

  // ── Throttle: team (unlimited) ────────────────────────────
  [
    "team 100 active → allowed",
    () =>
      checkAgentSpawn("team", Array(100).fill(A("working"))).allowed === true,
  ],
  [
    "team_plus 50 active → allowed",
    () =>
      checkAgentSpawn("team_plus", Array(50).fill(A("idle"))).allowed === true,
  ],
  [
    "enterprise 1000 active → allowed",
    () =>
      checkAgentSpawn("enterprise", Array(1000).fill(A("working"))).allowed ===
      true,
  ],

  // ── Counts reported correctly even when allowed ───────────
  [
    "free 1/2 reports correctly",
    () => {
      const r = checkAgentSpawn("free", [A("idle")]);
      return r.allowed === true && r.active === 1 && r.limit === 2;
    },
  ],
  [
    "pro 5/5 reports blocked with correct numbers",
    () => {
      const r = checkAgentSpawn("pro", Array(5).fill(A("idle")));
      return r.allowed === false && r.active === 5 && r.limit === 5;
    },
  ],
];

let pass = 0;
let fail = 0;
for (const [name, fn] of cases) {
  try {
    if (fn()) {
      pass++;
    } else {
      console.log("FAIL:", name);
      fail++;
    }
  } catch (err) {
    console.log("THROW:", name, err.message);
    fail++;
  }
}
console.log(
  `\nplanLimits: ${pass}/${cases.length} passed${fail ? `, ${fail} failed` : ""}`,
);
process.exit(fail ? 1 : 0);
