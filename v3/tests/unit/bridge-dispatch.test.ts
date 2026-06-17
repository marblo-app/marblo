/**
 * BridgeServer.dispatchTask / spawnNewAgent behavior guards for the
 * concurrency bug-fix batch:
 *
 *   [M2] per-plan concurrency cap on the backend dispatch/spawn path, with the
 *        orchestrator / internal / system whitelist.
 *   [M6] reuse idle→working race: a candidate scored idle but now live-working
 *        must NOT be reused (no 2nd task injected into a live session); a
 *        freshly-spawned agent is claimed "working" immediately.
 *   [L3] concurrent dispatch for the SAME task must yield exactly one agent.
 *
 * Uses lightweight in-memory fakes for AgentManager / PtyManager /
 * WorktreeCoordinator so we exercise the real BridgeServer routing without
 * Electron / node-pty / git.
 */
import { describe, it, expect } from "vitest";
import * as path from "node:path";
import {
  BridgeServer,
  type DispatchTaskRequest,
  type SpawnAgentRequest,
} from "../../electron/bridge-server";
import type { AgentInstance, AgentStatus } from "../../electron/agent-manager";

// ── Fakes ───────────────────────────────────────────────────

interface FakeInstanceInit {
  id: string;
  name?: string;
  model?: string;
  role?: string;
  status?: AgentStatus;
  cwd?: string;
  projectId?: string;
  currentTaskId?: string | null;
  restartCount?: number;
}

function makeInstance(init: FakeInstanceInit): AgentInstance & {
  projectId?: string;
} {
  return {
    id: init.id,
    name: init.name ?? `agent-${init.id}`,
    model: (init.model ?? "claude") as AgentInstance["model"],
    role: init.role ?? "backend",
    status: init.status ?? "idle",
    ptySessionId: `pty-${init.id}`,
    cwd: init.cwd ?? "/repo",
    currentTaskId: init.currentTaskId ?? null,
    restartCount: init.restartCount ?? 0,
    // projectId is what our FakeAgentManager filters on (real code reads
    // launchConfig.env.MARBLO_PROJECT; we keep the fake simple).
    projectId: init.projectId,
  } as unknown as AgentInstance & { projectId?: string };
}

class FakeAgentManager {
  agents = new Map<string, AgentInstance & { projectId?: string }>();
  launchCalls = 0;
  restartCalls = 0;

  seed(inst: AgentInstance & { projectId?: string }): void {
    this.agents.set(inst.id, inst);
  }

  listAgents(): AgentInstance[] {
    return [...this.agents.values()];
  }

  listAgentsByProject(projectId: string | undefined): AgentInstance[] {
    if (!projectId) return this.listAgents();
    return this.listAgents().filter(
      (a) => (a as { projectId?: string }).projectId === projectId,
    );
  }

  getAgent(id: string): AgentInstance | null {
    return this.agents.get(id) ?? null;
  }

  getAgentByName(name: string): AgentInstance | null {
    return this.listAgents().find((a) => a.name === name) ?? null;
  }

  setStatus(id: string, status: AgentStatus): void {
    const a = this.agents.get(id);
    if (a && a.status !== status) a.status = status;
  }

  setCurrentTask(id: string, taskId: string | null): void {
    const a = this.agents.get(id);
    if (a) a.currentTaskId = taskId;
  }

  restart(id: string): AgentInstance | null {
    this.restartCalls++;
    const a = this.agents.get(id);
    if (!a) return null;
    a.status = "idle";
    return a;
  }

  remove(id: string): void {
    this.agents.delete(id);
  }

  launch(params: {
    id: string;
    name: string;
    model: string;
    role: string;
    cwd: string;
    projectId?: string;
    currentTaskId?: string | null;
    onPtyReady?: (sid: string) => void;
  }): AgentInstance {
    this.launchCalls++;
    const inst = makeInstance({
      id: params.id,
      name: params.name,
      model: params.model,
      role: params.role,
      status: "idle",
      cwd: params.cwd,
      projectId: params.projectId,
      currentTaskId: params.currentTaskId ?? null,
    });
    this.agents.set(params.id, inst);
    params.onPtyReady?.(inst.ptySessionId);
    return inst;
  }
}

class FakePtyManager {
  writes: { sid: string; text: string }[] = [];
  writeAndSubmit(sid: string, text: string): void {
    this.writes.push({ sid, text });
  }
  onData(): void {}
  onExit(): void {}
}

class FakeWorktreeCoordinator {
  prepareCalls = 0;
  constructor(private worktreesRoot = "/wt") {}
  async prepare(input: {
    projectId?: string;
    taskId?: string;
    repoRoot: string;
    requestedCwd?: string;
  }): Promise<{
    taskId: string | null;
    cwd: string;
    worktreeCreated: boolean;
  }> {
    this.prepareCalls++;
    if (input.projectId && input.taskId) {
      return {
        taskId: input.taskId,
        cwd: path.join(this.worktreesRoot, input.projectId, input.taskId),
        worktreeCreated: true,
      };
    }
    return {
      taskId: input.taskId ?? null,
      cwd: input.requestedCwd ?? input.repoRoot,
      worktreeCreated: false,
    };
  }
}

function makeBridge(plan?: string) {
  const am = new FakeAgentManager();
  const pty = new FakePtyManager();
  const wt = new FakeWorktreeCoordinator();
  const bridge = new BridgeServer(
    am as unknown as ConstructorParameters<typeof BridgeServer>[0],
    pty as unknown as ConstructorParameters<typeof BridgeServer>[1],
    new Map(),
    wt as unknown as ConstructorParameters<typeof BridgeServer>[3],
  );
  bridge.setPlanLookup(() => plan);
  return { bridge, am, pty, wt };
}

function dispatch(
  overrides: Partial<DispatchTaskRequest>,
): DispatchTaskRequest {
  return {
    role: "backend",
    instruction: "do the thing",
    cwd: "/repo",
    ...overrides,
  };
}

// ── [M2] per-plan concurrency cap ───────────────────────────

describe("dispatchTask — plan cap (M2)", () => {
  it("blocks a free worker dispatch once 2 agents are active", async () => {
    const { bridge, am } = makeBridge("free");
    // Two working backend agents already active in this project, parked in the
    // main checkout (so they are not worktree occupants of the new task).
    am.seed(
      makeInstance({
        id: "w1",
        status: "working",
        projectId: "px",
        cwd: "/repo",
      }),
    );
    am.seed(
      makeInstance({
        id: "w2",
        status: "working",
        projectId: "px",
        cwd: "/repo",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", taskId: "newtaskAAAA" }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("Free");
    expect(am.launchCalls).toBe(0);
  });

  it("allows a free worker dispatch below the 2-agent ceiling", async () => {
    const { bridge, am } = makeBridge("free");
    am.seed(
      makeInstance({
        id: "w1",
        status: "working",
        projectId: "px",
        cwd: "/repo",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", taskId: "newtaskBBBB" }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    expect(am.launchCalls).toBe(1);
  });

  it("EXEMPTS an orchestrator-role dispatch even over the free cap", async () => {
    const { bridge, am } = makeBridge("free");
    am.seed(makeInstance({ id: "w1", status: "working", projectId: "px" }));
    am.seed(makeInstance({ id: "w2", status: "working", projectId: "px" }));

    const res = await bridge.dispatchTask(
      dispatch({ role: "orchestrator", projectId: "px", taskId: "orchTask01" }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    expect(am.launchCalls).toBe(1);
  });

  it("EXEMPTS a system-flagged dispatch even over the free cap", async () => {
    const { bridge, am } = makeBridge("free");
    am.seed(makeInstance({ id: "w1", status: "working", projectId: "px" }));
    am.seed(makeInstance({ id: "w2", status: "working", projectId: "px" }));

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", taskId: "sysTask01", system: true }),
    );

    expect(res.success).toBe(true);
    expect(am.launchCalls).toBe(1);
  });

  it("spawnNewAgent enforces the cap directly (HTTP /spawn-agent path)", async () => {
    const { bridge, am } = makeBridge("free");
    am.seed(makeInstance({ id: "w1", status: "working", projectId: "px" }));
    am.seed(makeInstance({ id: "w2", status: "working", projectId: "px" }));

    const spawn = (
      bridge as unknown as {
        spawnNewAgent: (
          p: SpawnAgentRequest,
        ) => Promise<{ success: boolean; error?: string }>;
      }
    ).spawnNewAgent.bind(bridge);

    const blocked = await spawn({
      name: "backend-x",
      model: "claude",
      role: "backend",
      projectId: "px",
      initialPrompt: "work",
      cwd: "/repo",
    });
    expect(blocked.success).toBe(false);
    expect(am.launchCalls).toBe(0);

    // system flag bypasses (e.g. merge resolver).
    const exempt = await spawn({
      name: "resolver-x",
      model: "claude",
      role: "backend",
      projectId: "px",
      initialPrompt: "resolve",
      cwd: "/repo",
      system: true,
    });
    expect(exempt.success).toBe(true);
    expect(am.launchCalls).toBe(1);
  });
});

// ── [M6] reuse idle→working race ────────────────────────────

describe("dispatchTask — reuse race (M6)", () => {
  it("does NOT reuse a candidate that scored idle but is now live-working", async () => {
    const { bridge, am, pty } = makeBridge();
    const live = makeInstance({
      id: "a1",
      role: "backend",
      status: "working", // live status
      cwd: "/repo",
      projectId: "px",
    });
    am.seed(live);
    // Stale snapshot: scoreAgents sees this agent as idle (it was idle when the
    // dispatch was scored), but the live re-check via getAgent sees "working".
    am.listAgentsByProject = () => [
      { ...live, status: "idle" } as unknown as AgentInstance,
    ];

    const res = await bridge.dispatchTask(dispatch({ projectId: "px" }));

    // Must fall through to a fresh spawn, NOT inject into the live session.
    expect(res.action).toBe("spawned");
    expect(am.launchCalls).toBe(1);
    expect(pty.writes.some((w) => w.sid === "pty-a1")).toBe(false);
  });

  it("reuses a genuinely idle candidate and routes the task to it", async () => {
    const { bridge, am, pty } = makeBridge();
    am.seed(
      makeInstance({
        id: "a1",
        role: "backend",
        status: "idle",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(dispatch({ projectId: "px" }));

    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("a1");
    expect(am.launchCalls).toBe(0);
    expect(pty.writes.some((w) => w.sid === "pty-a1")).toBe(true);
    // Claimed: the reused agent is now working.
    expect(am.getAgent("a1")?.status).toBe("working");
  });

  it("claims a freshly-spawned agent as working immediately (no idle window)", async () => {
    const { bridge, am } = makeBridge();

    const res = await bridge.dispatchTask(dispatch({ projectId: "px" }));

    expect(res.action).toBe("spawned");
    expect(res.agentId).toBeTruthy();
    expect(am.getAgent(res.agentId!)?.status).toBe("working");
  });
});

// ── tracked-model guard — agy progress activity fallback ─────────────

describe("dispatchTask — requireTrackedModel", () => {
  it("excludes idle antigravity agents and spawns a tracked model when tagged", async () => {
    const { bridge, am, pty } = makeBridge();
    am.seed(
      makeInstance({
        id: "agy-idle",
        model: "antigravity",
        role: "backend",
        status: "idle",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        enabledModels: ["antigravity", "gpt"],
        tags: ["require_tracked_model"],
      }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    expect(res.model).toBe("gpt");
    expect(am.launchCalls).toBe(1);
    expect(pty.writes.some((w) => w.sid === "pty-agy-idle")).toBe(false);
  });

  it("does not honor an explicit antigravity hint when tracking is required", async () => {
    const { bridge, am } = makeBridge();

    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        model: "antigravity",
        enabledModels: ["antigravity", "gpt"],
        requireTrackedModel: true,
      }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    expect(res.model).toBe("gpt");
    expect(am.launchCalls).toBe(1);
  });
});

// ── [L3] per-task single agent under concurrency ────────────

describe("dispatchTask — per-task uniqueness (L3)", () => {
  it("concurrent dispatches for the SAME task spawn exactly one agent", async () => {
    const { bridge, am, pty } = makeBridge();
    const req = dispatch({
      projectId: "px",
      taskId: "raceTask0001",
      cwd: "/repo",
    });

    const [a, b] = await Promise.all([
      bridge.dispatchTask(req),
      bridge.dispatchTask(req),
    ]);

    // Exactly one real spawn; the other is routed to the worktree occupant.
    expect(am.launchCalls).toBe(1);
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["reused", "spawned"]);
    expect(a.success && b.success).toBe(true);

    // The routed dispatch wrote to the spawned agent's PTY (same task → one
    // agent), not to a second freshly-launched one.
    const spawned = a.action === "spawned" ? a : b;
    expect(pty.writes.some((w) => w.sid === `pty-${spawned.agentId}`)).toBe(
      true,
    );
  });

  it("routes a later same-task dispatch to the existing worktree occupant", async () => {
    const { bridge, am } = makeBridge();
    // An agent already bound to the task's worktree (working on it).
    const wtCwd = path.join("/wt", "px", "occTask0001");
    am.seed(
      makeInstance({
        id: "occ",
        role: "backend",
        status: "working",
        cwd: wtCwd,
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", taskId: "occTask0001" }),
    );

    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("occ");
    expect(am.launchCalls).toBe(0);
  });

  it("routes to the live task-bound agent instead of reassigning to another idle agent", async () => {
    const { bridge, am, pty } = makeBridge();
    am.seed(
      makeInstance({
        id: "a6b01b58",
        role: "backend",
        status: "working",
        cwd: "/repo",
        projectId: "px",
        currentTaskId: "kYRmosC78fW7wUOyaAKG",
      }),
    );
    am.seed(
      makeInstance({
        id: "9cc0601b",
        role: "backend",
        status: "idle",
        cwd: path.join("/wt", "px", "kYRmosC78fW7wUOyaAKG"),
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", taskId: "kYRmosC78fW7wUOyaAKG" }),
    );

    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("a6b01b58");
    expect(am.launchCalls).toBe(0);
    expect(pty.writes).toContainEqual(
      expect.objectContaining({ sid: "pty-a6b01b58" }),
    );
    expect(pty.writes.some((w) => w.sid === "pty-9cc0601b")).toBe(false);
  });
});

// ── [RG] distinct-task fan-out — 배정 라이프사이클 증상① 회귀 가드 ───────
//
// 사용자 보고(증상①): "여러 태스크를 한 번에 만들면 각각 서로 다른 실제
// 에이전트로 스폰돼야 한다 — 한 에이전트(예: 직전 'fix-restart-regression')로
// claimedBy 가 쏠리면 안 된다."
//
// 기존 L3 테스트는 '동일 태스크 → 정확히 1 에이전트' 방향만 핀했다. 그 반대
// 방향 — 서로 다른 태스크를 동시에 디스패치하면 서로 다른 에이전트로 분산되고
// 직전 유휴 에이전트로 쏠리지 않는다 — 은 미커버였다. dispatchTask 가 돌려주는
// agentId 가 MCP 레이어(tools.ts dispatch_task)에서 task.claimedBy 로 그대로
// 바인딩되므로 'agentId 분산 == claimedBy(=카드 담당자) 분산' 이다.
describe("dispatchTask — distinct-task fan-out (RG, 증상①)", () => {
  it("동시 디스패치된 서로 다른 isolated 태스크는 각각 fresh 에이전트로 — 직전 유휴로 쏠리지 않음", async () => {
    const { bridge, am } = makeBridge();
    // 직전 작업에서 남은 유휴 에이전트 1기 — 메인 체크아웃(/repo)에 주차.
    // 워크트리 격리 게이트(isWorktreeIsolated)가 이 에이전트를 어떤 isolated
    // 태스크에도 reuse 못 하게 막아, 각 태스크가 자기 워크트리로 fresh spawn 된다.
    am.seed(
      makeInstance({
        id: "stale-idle",
        role: "backend",
        status: "idle",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const taskIds = ["fanTask0001", "fanTask0002", "fanTask0003"];
    const results = await Promise.all(
      taskIds.map((taskId) =>
        bridge.dispatchTask(dispatch({ projectId: "px", taskId })),
      ),
    );

    // 전부 성공 + 전부 fresh spawn(유휴 에이전트로 reuse 쏠림 없음).
    expect(results.every((r) => r.success)).toBe(true);
    expect(results.every((r) => r.action === "spawned")).toBe(true);
    expect(am.launchCalls).toBe(3);

    // 핵심: 서로 다른 에이전트로 분산 + 누구도 stale 유휴 에이전트로 귀속되지 않음.
    const agentIds = results.map((r) => r.agentId);
    expect(new Set(agentIds).size).toBe(3); // 3개 모두 distinct
    expect(agentIds).not.toContain("stale-idle");
  });

  it("reuse 가능 컨텍스트에서도 두 distinct 태스크가 한 유휴 에이전트로 동시 쏠리지 않음 (M6 동기 claim)", async () => {
    const { bridge, am } = makeBridge();
    // 비격리(projectId 없음) → 워크트리 게이트 통과, 유휴 에이전트 reuse 허용.
    // 두 태스크가 모두 이 한 기를 reuse 하려 들면 claimedBy 가 같은 id 로 쏠린다.
    // M6 동기 working-claim 이 둘 중 하나만 reuse 하고 나머지는 fresh spawn 시킨다.
    am.seed(
      makeInstance({
        id: "idle-1",
        role: "backend",
        status: "idle",
        cwd: "/repo",
      }),
    );

    const [a, b] = await Promise.all([
      bridge.dispatchTask(dispatch({ taskId: "distA0000001" })),
      bridge.dispatchTask(dispatch({ taskId: "distB0000001" })),
    ]);

    expect(a.success && b.success).toBe(true);
    // 정확히 하나만 유휴 에이전트를 reuse, 다른 하나는 fresh spawn.
    const actions = [a.action, b.action].sort();
    expect(actions).toEqual(["reused", "spawned"]);
    // 두 태스크가 서로 다른 에이전트로 — claimedBy 쏠림(동일 id) 없음.
    expect(a.agentId).not.toBe(b.agentId);
    // 유휴 1기는 reuse 되므로 신규 launch 는 정확히 1회.
    expect(am.launchCalls).toBe(1);
  });
});

// ── SPAWN-MODEL-ALLOCATION-V2 §4 모델 믹스 (complex 전용 opt-in) ──────

describe("dispatchTask — model mix (§4)", () => {
  it("mix=cross-check on complex spawns a Codex companion (action=mixed)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "mixTask00001",
        complexity: "complex",
        model: "claude",
        mix: "cross-check",
      }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("mixed");
    // Primary (claude, worktree-bound) + companion (codex, ad-hoc) = 2 spawns.
    expect(am.launchCalls).toBe(2);
    expect(res.companionAgentId).toBeTruthy();
    // The companion is a Codex(gpt) agent.
    const companion = am.getAgent(res.companionAgentId!);
    expect(companion?.model).toBe("gpt");
  });

  it("split-role also spawns a companion (action=mixed)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "mixTask00002",
        complexity: "complex",
        model: "claude",
        mix: "split-role",
      }),
    );
    expect(res.action).toBe("mixed");
    expect(am.launchCalls).toBe(2);
  });

  it("mix is IGNORED when complexity is not complex (single dispatch)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "mixTask00003",
        complexity: "standard",
        model: "claude",
        mix: "cross-check",
      }),
    );
    expect(res.action).toBe("spawned"); // not "mixed"
    expect(res.companionAgentId).toBeUndefined();
    expect(am.launchCalls).toBe(1);
  });

  it("mix degrades to single when the companion spawn is cap-blocked", async () => {
    // free plan: cap=2. One worker already active → primary spawn takes the 2nd
    // slot, so the companion spawn is blocked. Mix degrades to the primary.
    const { bridge, am } = makeBridge("free");
    am.seed(
      makeInstance({
        id: "w1",
        status: "working",
        projectId: "px",
        cwd: "/repo",
      }),
    );
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "mixTask00004",
        complexity: "complex",
        model: "claude",
        mix: "cross-check",
      }),
    );
    // Primary succeeded; companion blocked → still success, no companion id.
    expect(res.success).toBe(true);
    expect(res.companionAgentId).toBeUndefined();
    expect(res.reason).toContain("단일로 강등");
    expect(am.launchCalls).toBe(1);
  });
});

// ── SPAWN-MODEL-ALLOCATION-V2 §5 단계분할 (complex 전용 opt-in) ──────

describe("dispatchTask — complex stages (§5)", () => {
  it("dispatches each stage and returns stageAgentIds (action=staged)", async () => {
    const { bridge } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "stgTask00001",
        complexity: "complex",
        model: "claude",
        stages: [
          { instruction: "design step", complexity: "complex" },
          {
            instruction: "mechanical step",
            complexity: "standard",
            dependsOnPrevious: true,
          },
        ],
      }),
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe("staged");
    // One result per stage (each carries an agentId — reuse may share one).
    expect(res.stageAgentIds?.length).toBe(2);
  });

  it("a simple stage routes to a logical sub-agent (no spawn for that stage)", async () => {
    const { bridge } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "stgTask00002",
        complexity: "complex",
        model: "claude",
        stages: [
          { instruction: "design", complexity: "complex" },
          { instruction: "trivial rename", complexity: "simple" },
        ],
      }),
    );
    expect(res.action).toBe("staged");
    // The simple stage is logical (no agentId), so only the complex stage
    // contributes an agent id.
    expect(res.stageAgentIds?.length).toBe(1);
  });

  it("stages are IGNORED when complexity is not complex (single dispatch)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "stgTask00003",
        complexity: "standard",
        model: "claude",
        stages: [{ instruction: "x", complexity: "complex" }],
      }),
    );
    expect(res.action).toBe("spawned"); // not "staged"
    expect(res.stageAgentIds).toBeUndefined();
    expect(am.launchCalls).toBe(1);
  });
});

// ── SPAWN-MODEL-ALLOCATION §B: simple cheap 물리스폰 opt-in (isolate) ──

describe("dispatchTask — simple isolate (§B)", () => {
  it("simple WITHOUT isolate → logical sub-agent (no physical spawn)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "isoTask00001",
        complexity: "simple",
        model: "claude",
      }),
    );
    expect(res.action).toBe("logical");
    expect(am.launchCalls).toBe(0);
  });

  it("simple WITH isolate=true → physical spawn (action=spawned)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "isoTask00002",
        complexity: "simple",
        model: "claude",
        isolate: true,
      }),
    );
    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned"); // logical 단락을 건너뜀
    expect(am.launchCalls).toBe(1);
  });

  it("isolate is a no-op for non-simple (standard still spawns normally)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "isoTask00003",
        complexity: "standard",
        model: "claude",
        isolate: true,
      }),
    );
    expect(res.action).toBe("spawned");
    expect(am.launchCalls).toBe(1);
  });
});

// ── §C: complexity→provider 라우팅이 dispatch 경로까지 전달되는지(통합) ──

describe("dispatchTask — simple→antigravity routing (§C)", () => {
  let savedBias: string | undefined;
  beforeEach(() => {
    savedBias = process.env.MARBLO_AGY_SIMPLE_BIAS;
  });
  afterEach(() => {
    if (savedBias === undefined) delete process.env.MARBLO_AGY_SIMPLE_BIAS;
    else process.env.MARBLO_AGY_SIMPLE_BIAS = savedBias;
  });

  it("simple+isolate + bias → antigravity 로 스폰(complexity 가 scoreModels 까지 전달)", async () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "agyTask00001",
        complexity: "simple",
        isolate: true,
        enabledModels: [
          "claude",
          "antigravity",
        ] as DispatchTaskRequest["enabledModels"],
        // 명시 model 없음 → scoreModels 가 고른다.
      }),
    );
    expect(res.action).toBe("spawned");
    const spawned = [...am.agents.values()];
    expect(spawned.some((a) => a.model === "antigravity")).toBe(true);
  });

  it("명시 model 힌트는 bias 보다 우선(simple+isolate, model=claude → claude)", async () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({
        projectId: "px",
        taskId: "agyTask00002",
        complexity: "simple",
        isolate: true,
        model: "claude",
        enabledModels: [
          "claude",
          "antigravity",
        ] as DispatchTaskRequest["enabledModels"],
      }),
    );
    expect(res.action).toBe("spawned");
    const spawned = [...am.agents.values()];
    expect(spawned.every((a) => a.model !== "antigravity")).toBe(true);
  });
});

// ── [레인-dispatch] 명시 모델이 reuse/restart 후보를 하드필터 (증상①) ──────
//
// 사용자 보고(레인 경로 증상①): "태스크를 codex 로 명시 지정해도 새 codex 가
// 안 뜨고 기존 다른 모델(심지어 claude) idle 에이전트로 reuse 배정된다 — 명시
// 모델이 reuse 후보 하드필터에 반영 안 됨."
//
// dispatchSingle 은 이미 modelMatches(=`!model || agent.model === model`) 로
// reuse(스코어≥100 idle)와 restart(stopped) 양쪽 후보를 명시 모델로 하드필터
// 한다. 요청 모델은 normalizeModel 로 정규화("codex"→"gpt")되고, 스폰 에이전트는
// 그 정규화값(selectedModel)을 model 로 저장하므로 양변이 같은 canonical 로 비교
// 된다. 따라서 codex 요청은 claude idle 을 절대 reuse 못 하고 fresh codex 를
// 스폰해야 한다. 이 방향(모델 존중 reuse)은 기존 테스트에 미커버였다 — 회귀 락.
//
// 주의: claude idle 은 role+load+cost-eff+reuse 합산으로 ~183 점이라 100 임계를
// 한참 넘는다. 모델 필터가 없으면(또는 명시 모델이 누락되면) 바로 이 claude 가
// hijack 하는 게 정확히 보고된 증상이다.
describe("dispatchTask — 명시 모델 하드필터 (레인-dispatch 증상①)", () => {
  it("model=codex 인데 claude idle 만 있으면 → reuse 안 하고 fresh codex(gpt) 스폰", async () => {
    const { bridge, am, pty } = makeBridge();
    am.seed(
      makeInstance({
        id: "claudeIdle",
        role: "backend",
        status: "idle",
        model: "claude",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", model: "codex" }),
    );

    // 명시 codex → claude idle 을 hijack 하지 않고 새 gpt 에이전트를 스폰.
    expect(res.action).toBe("spawned");
    expect(res.model).toBe("gpt");
    // claude idle 은 손대지 않음(주입 없음 + 여전히 idle).
    expect(pty.writes.some((w) => w.sid === "pty-claudeIdle")).toBe(false);
    expect(am.getAgent("claudeIdle")?.status).toBe("idle");
  });

  it("model=gpt 인데 claude idle + gpt idle 공존 → 점수 높은 claude 가 아니라 gpt idle 을 reuse", async () => {
    const { bridge, am, pty } = makeBridge();
    am.seed(
      makeInstance({
        id: "claudeIdle",
        role: "backend",
        status: "idle",
        model: "claude",
        cwd: "/repo",
        projectId: "px",
      }),
    );
    am.seed(
      makeInstance({
        id: "gptIdle",
        role: "backend",
        status: "idle",
        model: "gpt",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", model: "gpt" }),
    );

    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("gptIdle");
    expect(res.model).toBe("gpt");
    // claude idle 은 후보에서 하드필터로 제외 — 주입 없음.
    expect(pty.writes.some((w) => w.sid === "pty-claudeIdle")).toBe(false);
    expect(pty.writes.some((w) => w.sid === "pty-gptIdle")).toBe(true);
  });

  it("model=codex 별칭은 gpt idle 을 reuse (normalizeModel 별칭 폴딩이 필터 앞에서 적용)", async () => {
    const { bridge, am } = makeBridge();
    am.seed(
      makeInstance({
        id: "gptIdle",
        role: "backend",
        status: "idle",
        model: "gpt",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", model: "codex" }),
    );

    // "codex" → "gpt" 정규화 후 동일 모델 idle 을 reuse.
    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("gptIdle");
  });

  it("model=codex 인데 stopped claude 만 있으면 → restart 안 하고 fresh codex 스폰", async () => {
    const { bridge, am } = makeBridge();
    am.seed(
      makeInstance({
        id: "claudeStopped",
        role: "backend",
        status: "stopped",
        model: "claude",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    const res = await bridge.dispatchTask(
      dispatch({ projectId: "px", model: "codex" }),
    );

    // restart 후보(stopped)도 동일 모델 하드필터에 걸려 제외 → fresh gpt.
    expect(res.action).toBe("spawned");
    expect(res.model).toBe("gpt");
    expect(am.restartCalls).toBe(0);
  });

  it("명시 모델 없으면(undefined) reuse 무제한 — claude idle 을 정상 reuse(무회귀 확인)", async () => {
    const { bridge, am } = makeBridge();
    am.seed(
      makeInstance({
        id: "claudeIdle",
        role: "backend",
        status: "idle",
        model: "claude",
        cwd: "/repo",
        projectId: "px",
      }),
    );

    // model 미지정 → modelMatches 가 항상 true → 기존 reuse 동작 유지.
    const res = await bridge.dispatchTask(dispatch({ projectId: "px" }));

    expect(res.action).toBe("reused");
    expect(res.agentId).toBe("claudeIdle");
  });
});
