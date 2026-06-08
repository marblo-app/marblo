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
 * Run with:
 *   npx vitest run tests/unit/dynamic-spawn.test.ts
 */

import * as os from "os";
import * as path from "path";
import { describe, expect, it } from "vitest";
import {
  scoreAgents,
  checkSpawnConstraints,
  isWorktreeIsolated,
  MAX_AGENTS,
  MAX_PER_ROLE,
  type AgentInfo,
} from "../../electron/dispatch-scoring";

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

// ── Worktree isolation gate (FU1: dispatch reuse must not break isolation) ──
//
// Full reuse decision as bridge-server.dispatchTask runs it: an idle, role/
// model-matched agent is only reused when it's ALSO sitting in the task's
// target worktree. Otherwise dispatch falls through to a fresh coordinator-
// routed spawn. cwd is carried separately here because AgentInfo has none.
function wouldReuseInWorktree(
  agentCwd: string | undefined,
  projectId: string | undefined,
  taskId: string | undefined,
  role = "backend",
): boolean {
  const agents = [makeAgent({ status: "idle", role })];
  const scored = scoreAgents(agents, role, undefined, []);
  const reusable = scored.filter(
    (s) =>
      s.score >= 100 &&
      s.agent.status === "idle" &&
      isWorktreeIsolated(agentCwd, projectId, taskId),
  );
  return reusable.length > 0;
}

const PROJ = "GFB8JnJrrX6AgahqmGB3";
const TASK = "x2AaMaMUpUagHyuI5kRb";
const targetWt = path.join(os.homedir(), ".marblo", "worktrees", PROJ, TASK);

describe("dynamic spawn routing", () => {
  it("dispatch with no agents at all → spawn new (claim 3 trigger)", () => {
    expect(wouldSpawnNew([], "backend")).toBe(true);
  });

  it("dispatch with role mismatch only → spawn new (claim 3 trigger)", () => {
    // 명세서 도 2(b) 시나리오: backend/frontend/design 만 있는데 translation
    // 요청 들어오면 어떤 에이전트도 매칭 안 됨 → 신규 에이전트 생성.
    const agents = [
      makeAgent({
        id: "a1",
        name: "backend",
        model: "claude",
        role: "backend",
      }),
      makeAgent({
        id: "a2",
        name: "frontend",
        model: "gemini",
        role: "frontend",
      }),
      makeAgent({ id: "a3", name: "design", model: "gpt", role: "design" }),
    ];
    expect(wouldSpawnNew(agents, "translation")).toBe(true);
  });

  it("dispatch with idle role-matched agent → reuse (no spawn)", () => {
    const agents = [makeAgent({ status: "idle", role: "backend" })];
    expect(wouldSpawnNew(agents, "backend")).toBe(false);
  });

  it("dispatch with only working role-matched agent → spawn new", () => {
    // working 에이전트는 mid-task 라 안전하게 reuse 못함 → 새로 spawn.
    const agents = [makeAgent({ status: "working", role: "backend" })];
    expect(wouldSpawnNew(agents, "backend")).toBe(true);
  });

  it("dispatch with only stopped role-matched agent → spawn new (restart not reuse)", () => {
    // bridge-server.dispatchTask separates restart vs reuse; from a
    // "would-spawn-something-new" perspective both qualify as not-reuse.
    // Stopped agents have status='stopped' → not in reusable filter.
    const agents = [makeAgent({ status: "stopped", role: "backend" })];
    expect(wouldSpawnNew(agents, "backend")).toBe(true);
  });
});

describe("worktree isolation gate", () => {
  it("reuse: projectId set + agent in MAIN checkout → NOT reused (spawn fresh)", () => {
    expect(wouldReuseInWorktree("/Users/dev/marblo/v3", PROJ, TASK)).toBe(
      false,
    );
  });

  it("reuse: projectId set + agent already in target worktree → reused", () => {
    expect(wouldReuseInWorktree(targetWt, PROJ, TASK)).toBe(true);
  });

  it("reuse: no projectId (isolation not required) → reuse retained", () => {
    expect(wouldReuseInWorktree("/anywhere/at/all", undefined, TASK)).toBe(
      true,
    );
  });
});

describe("spawn constraints", () => {
  it("spawn constraint check blocks at MAX_AGENTS", () => {
    const agents: AgentInfo[] = [];
    for (let i = 0; i < MAX_AGENTS; i++) {
      agents.push(
        makeAgent({ id: `a${i}`, status: "working", role: "backend" }),
      );
    }
    const r = checkSpawnConstraints(agents, "backend");
    expect(r.allowed).toBe(false);
    expect(r.error).toContain("max agents");
  });

  it("spawn constraint check blocks at MAX_PER_ROLE", () => {
    const agents: AgentInfo[] = [];
    for (let i = 0; i < MAX_PER_ROLE; i++) {
      agents.push(
        makeAgent({ id: `a${i}`, status: "working", role: "backend" }),
      );
    }
    const r = checkSpawnConstraints(agents, "backend");
    expect(r.allowed).toBe(false);
    // But other roles still allowed
    const r2 = checkSpawnConstraints(agents, "translation");
    expect(r2.allowed).toBe(true);
  });

  it("spawn constraint allows when only stopped/error agents present (slot frees)", () => {
    const agents = [
      makeAgent({ id: "a1", status: "stopped", role: "backend" }),
      makeAgent({ id: "a2", status: "error", role: "backend" }),
    ];
    const r = checkSpawnConstraints(agents, "backend");
    expect(r.allowed).toBe(true);
  });
});
