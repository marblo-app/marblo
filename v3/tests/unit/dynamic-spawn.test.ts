/**
 * Patent claim 3 회귀 테스트:
 *
 *   "매칭점수가 기준이상인 에이전트가 존재하지 않는 경우 해당 태스크를
 *    수행하기 위한 신규에이전트를 생성하고, 해당 신규에이전트에 할당한다.
 *    신규에이전트할당단계는, (a) 신규 에이전트를 격리하는 가상터미널(PTY)
 *    및 신규 에이전트 생성, (b) 표준화된 통신프로토콜 설정,
 *    (c) 역할정보 정의를 포함한다."
 *
 * 우리는 dispatch 로직을 직접 테스트해서, 매칭 미달 / 미존재 시 spawn
 * 경로가 트리거되는지 가드한다. (PTY/MCP/역할정보 자체 setup 은 spawn
 * 경로 안에서 AgentConfigGenerator 가 수행 — 그쪽은 별도 unit 으로 이미
 * 다른 곳에서 검증되므로 여기서는 라우팅 분기만 본다.)
 *
 * 참고: 프로젝트 vitest 설정이 Node22+vitest4 ESM 충돌로 ERR_REQUIRE_ESM
 * 발생 (사전 존재 이슈, 본 패치와 무관). standalone Node 로 실행:
 *   npx tsc tests/unit/dynamic-spawn.test.ts --module commonjs --target es2020 \
 *     --moduleResolution node --esModuleInterop --skipLibCheck --outDir /tmp/...
 *   node /tmp/.../dynamic-spawn.test.js
 */

import {
  scoreAgents,
  checkSpawnConstraints,
  MAX_AGENTS,
  MAX_PER_ROLE,
  type AgentInfo,
} from "../../electron/dispatch-scoring";

// ── tiny harness ────────────────────────────────────────────

const tests: Array<{ name: string; fn: () => void }> = [];
function test(name: string, fn: () => void) {
  tests.push({ name, fn });
}
function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

// ── helpers ────────────────────────────────────────────────

function makeAgent(o: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "a1",
    name: "backend-x",
    model: "claude",
    role: "backend",
    status: "idle",
    restartCount: 0,
    ...o,
  };
}

/**
 * Mirror of bridge-server.dispatchTask's reuse decision: an agent is
 * "reusable" iff scoreAgents picks it AND status is idle AND score >= 100.
 * If no reusable agent exists we know dispatchTask falls into the
 * spawnNewAgent path → patent claim 3 신규에이전트할당단계.
 */
function wouldSpawnNew(
  agents: AgentInfo[],
  role: string,
  tags: string[] = [],
): boolean {
  const scored = scoreAgents(agents, role, undefined, tags);
  const reusable = scored.filter(
    (s) => s.score >= 100 && s.agent.status === "idle",
  );
  return reusable.length === 0;
}

// ── tests ──────────────────────────────────────────────────

test("dispatch with no agents at all → spawn new (claim 3 trigger)", () => {
  assert(wouldSpawnNew([], "backend"), "empty agent list must trigger spawn");
});

test("dispatch with role mismatch only → spawn new (claim 3 trigger)", () => {
  // 명세서 도 2(b) 시나리오: backend/frontend/design 만 있는데 translation
  // 요청 들어오면 어떤 에이전트도 매칭 안 됨 → 신규 에이전트 생성.
  const agents = [
    makeAgent({ id: "a1", name: "backend", model: "claude", role: "backend" }),
    makeAgent({
      id: "a2",
      name: "frontend",
      model: "gemini",
      role: "frontend",
    }),
    makeAgent({ id: "a3", name: "design", model: "gpt", role: "design" }),
  ];
  assert(
    wouldSpawnNew(agents, "translation"),
    "no role match must trigger spawn for new role 'translation'",
  );
});

test("dispatch with idle role-matched agent → reuse (no spawn)", () => {
  const agents = [makeAgent({ status: "idle", role: "backend" })];
  assert(
    !wouldSpawnNew(agents, "backend"),
    "idle role-match must reuse, not spawn",
  );
});

test("dispatch with only working role-matched agent → spawn new", () => {
  // working 에이전트는 mid-task 라 안전하게 reuse 못함 → 새로 spawn.
  const agents = [makeAgent({ status: "working", role: "backend" })];
  assert(
    wouldSpawnNew(agents, "backend"),
    "working agents must NOT be reused; trigger spawn",
  );
});

test("dispatch with only stopped role-matched agent → spawn new (restart not reuse)", () => {
  // bridge-server.dispatchTask separates restart vs reuse; from a
  // "would-spawn-something-new" perspective both qualify as not-reuse.
  // Stopped agents have status='stopped' → not in reusable filter.
  const agents = [makeAgent({ status: "stopped", role: "backend" })];
  assert(
    wouldSpawnNew(agents, "backend"),
    "stopped agents not reusable; restart/spawn path triggers",
  );
});

test("spawn constraint check blocks at MAX_AGENTS", () => {
  const agents: AgentInfo[] = [];
  for (let i = 0; i < MAX_AGENTS; i++) {
    agents.push(makeAgent({ id: `a${i}`, status: "working", role: "backend" }));
  }
  const r = checkSpawnConstraints(agents, "backend");
  assert(!r.allowed, "MAX_AGENTS reached must block spawn");
  assert(
    typeof r.error === "string" && r.error.includes("max agents"),
    "error message must explain",
  );
});

test("spawn constraint check blocks at MAX_PER_ROLE", () => {
  const agents: AgentInfo[] = [];
  for (let i = 0; i < MAX_PER_ROLE; i++) {
    agents.push(makeAgent({ id: `a${i}`, status: "working", role: "backend" }));
  }
  const r = checkSpawnConstraints(agents, "backend");
  assert(!r.allowed, "MAX_PER_ROLE reached must block spawn for that role");
  // But other roles still allowed
  const r2 = checkSpawnConstraints(agents, "translation");
  assert(r2.allowed, "different role unaffected by per-role cap");
});

test("spawn constraint allows when only stopped/error agents present (slot frees)", () => {
  const agents = [
    makeAgent({ id: "a1", status: "stopped", role: "backend" }),
    makeAgent({ id: "a2", status: "error", role: "backend" }),
  ];
  const r = checkSpawnConstraints(agents, "backend");
  assert(r.allowed, "stopped/error agents don't count toward active cap");
});

// ── runner ────────────────────────────────────────────────

let pass = 0;
let fail = 0;
for (const t of tests) {
  try {
    t.fn();
    console.log("✓ " + t.name);
    pass++;
  } catch (err) {
    console.log("✗ " + t.name);
    console.log("  " + (err instanceof Error ? err.message : String(err)));
    fail++;
  }
}
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail > 0 ? 1 : 0);
