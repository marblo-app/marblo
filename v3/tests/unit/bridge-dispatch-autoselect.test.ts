/**
 * 다요소 자동선택 — **브리지 통합 증명**(티켓 YkzwnyOk).
 *
 * `model-autoselect.test.ts` 가 "점수 → 칸" 을 증명한다. 여기서는 그 칸이 실제
 * dispatch 를 타고 **진짜 argv** 로 나가는지를 본다:
 *
 *     dispatch_task(model 미지정, complexity=…)
 *       → BridgeServer.dispatchSingle (가용성 필터 + 1층 하네스 + 2층 칸)
 *       → AgentManager.launch(claudeModelOverride)
 *       → 진짜 AgentConfigGenerator 가 만든 `--model <id>`
 *
 * fake 는 PTY/워크트리/Firestore 만 대체하고 모델 결정·argv 생성은 진짜 코드다
 * (bridge-dispatch-model-pin.test.ts 와 같은 하네스).
 *
 * ★결정성: `MARBLO_ROUTING_EXPLORE=0` 으로 ε-greedy 를 끈다. 탐색 자체의 증명은
 * 순수 유닛(model-autoselect.test.ts)이 주입 난수로 한다 — 통합에서 확률을
 * 굴리면 CI 가 6~7번에 한 번 빨개진다.
 */
import { describe, it, expect, vi, beforeEach, beforeAll } from "vitest";
import os from "os";
import fs from "fs";
import path from "path";

const telemetry = vi.hoisted(() => ({
  dispatchDecision: vi.fn(),
  agentSpawnFailed: vi.fn(),
  agentWentStale: vi.fn(),
  modelTierResolved: vi.fn(),
  topModelFallback: vi.fn(),
  modelMixDispatched: vi.fn(),
  complexStagesDispatched: vi.fn(),
  agentSpawned: vi.fn(),
}));
vi.mock("../../electron/telemetry", () => ({
  mainTelemetry: telemetry,
  sendTelemetry: vi.fn(),
}));

import { BridgeServer } from "../../electron/bridge-server";
import { AgentConfigGenerator } from "../../electron/agent-config";
import type { AgentInstance, AgentStatus } from "../../electron/agent-manager";
import { spawnedModelFromArgs } from "../../electron/agent-manager";
import { resetAutoSelectRotation } from "../../electron/model-autoselect";
import { entryRung } from "../../electron/model-ladder";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-autoselect-"));

interface LaunchParams {
  id: string;
  name: string;
  model: string;
  role: string;
  cwd: string;
  projectId?: string;
  currentTaskId?: string | null;
  complexity?: "simple" | "standard" | "complex";
  claudeModelOverride?: string;
  codexModelOverride?: string;
  codexEffortOverride?: string;
  nativeModelOverride?: string;
  onPtyReady?: (sid: string, spawnedModel?: string) => void;
}

class RealishAgentManager {
  agents = new Map<string, AgentInstance>();
  private gen = new AgentConfigGenerator();

  listAgents(): AgentInstance[] {
    return [...this.agents.values()];
  }
  listAgentsByProject(): AgentInstance[] {
    return this.listAgents();
  }
  getAgent(id: string): AgentInstance | null {
    return this.agents.get(id) ?? null;
  }
  getAgentByName(): AgentInstance | null {
    return null;
  }
  getSpawnedModel(id: string): { modelId?: string; effort?: string } | null {
    const a = this.agents.get(id);
    if (!a?.launchConfig) return null;
    return spawnedModelFromArgs(a.model, a.launchConfig.args);
  }
  resolveConcreteModel(
    id: string,
  ): { modelId?: string; effort?: string } | null {
    return this.getSpawnedModel(id);
  }
  setStatus(id: string, status: AgentStatus): void {
    const a = this.agents.get(id);
    if (a) a.status = status;
  }
  setCurrentTask(): void {}
  setDispatchReason(id: string, reason: string | null): void {
    const a = this.agents.get(id);
    if (a) a.dispatchReason = reason;
  }
  restart(): AgentInstance | null {
    return null;
  }
  remove(id: string): void {
    this.agents.delete(id);
  }

  launch(params: LaunchParams): AgentInstance {
    const launchConfig = this.gen.getLaunchConfig(
      {
        id: params.id,
        model: params.model as AgentInstance["model"],
        role: params.role,
        command: "",
      },
      TMP,
      undefined,
      params.projectId,
      undefined,
      true,
      params.complexity,
      {
        claudeModel: params.claudeModelOverride,
        codexModel: params.codexModelOverride,
        codexEffort: params.codexEffortOverride,
        nativeModel: params.nativeModelOverride,
      },
    );
    const inst = {
      id: params.id,
      name: params.name,
      model: params.model,
      role: params.role,
      status: "idle",
      ptySessionId: `pty-${params.id}`,
      cwd: params.cwd,
      currentTaskId: params.currentTaskId ?? null,
      dispatchReason: null,
      restartCount: 0,
      spawnedAt: Date.now(),
      launchConfig,
    } as unknown as AgentInstance;
    this.agents.set(params.id, inst);
    params.onPtyReady?.(inst.ptySessionId, undefined);
    return inst;
  }
}

class FakePty {
  writeAndSubmit(): void {}
  onData(): void {}
  onExit(): void {}
}
class FakeWorktree {
  async prepare(input: {
    taskId?: string;
    repoRoot: string;
    requestedCwd?: string;
  }) {
    return {
      taskId: input.taskId ?? null,
      cwd: input.requestedCwd ?? input.repoRoot,
      worktreeCreated: false,
    };
  }
}

function makeBridge() {
  const am = new RealishAgentManager();
  const bridge = new BridgeServer(
    am as unknown as ConstructorParameters<typeof BridgeServer>[0],
    new FakePty() as unknown as ConstructorParameters<typeof BridgeServer>[1],
    new Map(),
    new FakeWorktree() as unknown as ConstructorParameters<
      typeof BridgeServer
    >[3],
  );
  return { bridge, am };
}

function lastDecision(): Record<string, unknown> {
  const calls = telemetry.dispatchDecision.mock.calls;
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

function claudeModelOf(am: RealishAgentManager, agentId: string): string {
  const args = am.getAgent(agentId)!.launchConfig!.args;
  return args[args.indexOf("--model") + 1];
}

/** 매번 새 브리지로 한 건 dispatch(재사용 경로를 타지 않게). */
async function dispatchOnce(opts: {
  complexity?: "simple" | "standard" | "complex";
  model?: string;
}): Promise<{ am: RealishAgentManager; agentId: string; model: string }> {
  const { bridge, am } = makeBridge();
  const res = await bridge.dispatchTask({
    role: "backend",
    instruction: "do it",
    cwd: TMP,
    enabledModels: ["claude"],
    ...opts,
  });
  expect(res.success).toBe(true);
  expect(res.action).toBe("spawned");
  return { am, agentId: res.agentId!, model: claudeModelOf(am, res.agentId!) };
}

beforeAll(() => {
  process.env.MARBLO_ROUTING_EXPLORE = "0";
});

beforeEach(() => {
  for (const fn of Object.values(telemetry)) fn.mockClear();
  resetAutoSelectRotation();
});

describe("★단순 → 저단가 / 복잡 → 고성능 (실제 argv)", () => {
  it("simple 은 사다리 바닥 칸으로 뜬다", async () => {
    const { model } = await dispatchOnce({ complexity: "simple" });
    expect(model).toBe("claude-sonnet-5");
  });

  it("complex 는 최상위 칸을 유지한다(하향 사고 없음)", async () => {
    const { model } = await dispatchOnce({ complexity: "complex" });
    expect(model).toBe(entryRung("claude", "complex")!.model);
  });
});

describe("★standard opus5 편중 해소", () => {
  it("연속 dispatch 가 opus5 한 칸에 고이지 않는다", async () => {
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      picks.push((await dispatchOnce({ complexity: "standard" })).model);
    }
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(picks).toContain("claude-sonnet-5");
    // 종전 고정 동작(opus5)도 여전히 나온다 — 강제 분산이 아니라 근거 기반이다.
    expect(picks).toContain("claude-opus-5");
  });

  it("난도 미지정(기본 standard)도 같은 경로를 탄다", async () => {
    const { model } = await dispatchOnce({});
    expect(["claude-sonnet-5", "claude-opus-5"]).toContain(model);
  });
});

describe("★관측성 — dispatchReason 에 근거가 남는다", () => {
  it("선택 근거(난이도·단가·효과·잔액·모드)가 문자열로 실린다", async () => {
    await dispatchOnce({ complexity: "simple" });
    const reason = String(lastDecision().decisionReason);
    expect(reason).toContain("auto-model[simple]");
    expect(reason).toContain("claude-sonnet-5");
    expect(reason).toMatch(/fit [+-]/);
    expect(reason).toMatch(/cost [+-]/);
    expect(reason).toMatch(/kg [+-]/);
    expect(reason).toContain("budget");
    expect(reason).toMatch(/mode=(top-score|tie-rotate|explore|single)/);
  });
});

describe("★무회귀 — 명시 지정이 우선", () => {
  it("model='opus5' 는 자동선택을 타지 않는다", async () => {
    const { am, agentId } = await dispatchOnce({
      complexity: "simple", // 자동선택이면 sonnet 이 됐을 난도
      model: "opus5",
    });
    expect(claudeModelOf(am, agentId)).toBe("claude-opus-5");
    const reason = String(lastDecision().decisionReason);
    expect(reason).toContain("Explicit model");
    expect(reason).not.toContain("auto-model[");
    expect(lastDecision().explicitModel).toBe(true);
  });

  it("model='fable' + simple 도 지정대로 뜬다", async () => {
    const { am, agentId } = await dispatchOnce({
      complexity: "simple",
      model: "fable",
    });
    expect(claudeModelOf(am, agentId)).toBe("claude-fable-5");
  });
});
