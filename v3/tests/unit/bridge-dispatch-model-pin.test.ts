/**
 * dispatch_task 지정모델 — 브리지 통합 증명 (P2-3 + 지정 model@effort).
 *
 * `model-pin-launch-args.test.ts` 가 "핀 → argv" 를 증명하고,
 * `model-selection.test.ts` 가 "문자열 → 핀" 을 증명한다. 여기서는 그 둘을 잇는
 * **실제 dispatch 경로**를 통째로 돌린다:
 *
 *     dispatch_task(model:'opus5')
 *       → BridgeServer.dispatchSingle (프로바이더 + 구체모델 해석)
 *       → AgentManager.launch(claudeModelOverride)
 *       → 진짜 AgentConfigGenerator 가 만든 argv (`--model claude-opus-5`)
 *       → dispatch:decision.spawnedModel
 *
 * fake 는 PTY/워크트리/Firestore 만 대체하고, **모델 결정과 argv 생성은 진짜
 * 코드**를 탄다 — 그러지 않으면 fake 를 테스트하게 된다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
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

/**
 * ★결정성 — 이 기기 구독 계정의 **라이브 잔여 쿼터**를 끊는다(티켓 gW6Z2xtS).
 *
 * `dispatchTask` 는 `getAccountRateLimits()` 로 실제 claude/codex CLI 를 셸아웃해
 * 계정 잔여를 읽고, 잔여 0% 는 `budgetBiasScore` 의 하드게이트(bias=null)에 걸려
 * **dispatch 자체를 막는다**(bridge-server: "Explicit model '…' is budget
 * exhausted"). 그래서 모킹하지 않으면 이 파일의 판정이 사장님 계정의 그날 소진율에
 * 좌우된다 — 실제로 codex 주간 쿼터가 100% 에 닿은 날 gpt/codex 케이스 6건이
 * 통째로 빨개졌고(claude 는 36% 라 통과), 같은 실패가 이 테스트를 **작성한** 커밋
 * (#660)에서도 재현됐다. 코드 회귀가 아니라 테스트가 외부 상태를 읽고 있었다.
 *
 * 중립(모든 하네스 no-data)으로 고정한다 — 이 파일이 증명하는 축은 모델 핀 →
 * argv 이지 쿼터가 아니다. 쿼터 축의 증명은 `dispatch-scoring.test.ts`(순수 유닛)와
 * `bridge-dispatch-autoselect.test.ts`(주입값)가 따로 한다.
 */
vi.mock("../../electron/account-usage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/account-usage")>();
  return {
    ...actual,
    getAccountRateLimits: async () => ({ claude: null, gpt: null, grok: null }),
  };
});

import { BridgeServer } from "../../electron/bridge-server";
import { AgentConfigGenerator } from "../../electron/agent-config";
import type { AgentInstance, AgentStatus } from "../../electron/agent-manager";
import { spawnedModelFromArgs } from "../../electron/agent-manager";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-pin-bridge-"));

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

/**
 * PTY 만 없는 AgentManager. `launch` 가 **진짜** AgentConfigGenerator 로
 * launchConfig 를 만들기 때문에 argv 는 프로덕션과 같은 코드가 생성한다.
 */
class RealishAgentManager {
  agents = new Map<string, AgentInstance>();
  launches: LaunchParams[] = [];
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
  /** 관측 사다리(argv → 과금 세션 모델). 이 fake 는 과금 관측이 없어 argv 와 같다. */
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
  restart(
    id: string,
    options?:
      | string
      | {
          initialPrompt?: string;
          claudeModelOverride?: string;
          codexModelOverride?: string;
          codexEffortOverride?: string;
          nativeModelOverride?: string;
        },
  ): AgentInstance | null {
    const current = this.agents.get(id);
    if (!current) return null;
    const restartOptions =
      typeof options === "string"
        ? { initialPrompt: options }
        : (options ?? {});
    this.agents.delete(id);
    return this.launch({
      id: current.id,
      name: current.name,
      model: current.model,
      role: current.role,
      cwd: current.cwd,
      currentTaskId: current.currentTaskId,
      projectId: current.launchConfig?.env.MARBLO_PROJECT,
      claudeModelOverride:
        restartOptions.claudeModelOverride ?? current.claudeModelOverride,
      codexModelOverride:
        restartOptions.codexModelOverride ?? current.codexModelOverride,
      codexEffortOverride:
        restartOptions.codexEffortOverride ?? current.codexEffortOverride,
      nativeModelOverride:
        restartOptions.nativeModelOverride ?? current.nativeModelOverride,
    });
  }
  remove(id: string): void {
    this.agents.delete(id);
  }

  launch(params: LaunchParams): AgentInstance {
    this.launches.push(params);
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
      claudeModelOverride: params.claudeModelOverride,
      codexModelOverride: params.codexModelOverride,
      codexEffortOverride: params.codexEffortOverride,
      nativeModelOverride: params.nativeModelOverride,
    } as unknown as AgentInstance;
    this.agents.set(params.id, inst);
    params.onPtyReady?.(
      inst.ptySessionId,
      amSpawnedModelFromArgs(inst.model, inst.launchConfig!.args),
    );
    return inst;
  }
}

function amSpawnedModelFromArgs(
  model: AgentInstance["model"],
  args: string[],
): string | undefined {
  const info = spawnedModelFromArgs(model, args);
  if (!info.modelId) return undefined;
  return info.effort ? `${info.modelId}@${info.effort}` : info.modelId;
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

/** 마지막 dispatch:decision 페이로드. */
function lastDecision(): Record<string, unknown> {
  const calls = telemetry.dispatchDecision.mock.calls;
  return calls[calls.length - 1][1] as Record<string, unknown>;
}

/** 이 에이전트의 실제 argv. */
function argsOf(am: RealishAgentManager, agentId: string): string[] {
  return am.getAgent(agentId)!.launchConfig!.args;
}

beforeEach(() => {
  for (const fn of Object.values(telemetry)) fn.mockClear();
});

describe("dispatch_task 지정모델 → 실제 스폰 argv", () => {
  it("★완료기준: model='opus5' 가 --model claude-opus-5 로 스폰된다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "opus5",
    });

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    // 프로바이더는 claude 로 접혔다 — 'opus5' 가 미지 문자열로 버려지지 않았다.
    expect(res.model).toBe("claude");
    const args = argsOf(am, res.agentId!);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-opus-5");
  });

  it("model='fable' 이 --model claude-fable-5 로 스폰된다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "fable",
    });
    const args = argsOf(am, res.agentId!);
    expect(args[args.indexOf("--model") + 1]).toBe("claude-fable-5");
  });

  it("★codex 구체모델 + effort 가 -c 로 스폰된다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "gpt-5.6-terra",
      effort: "xhigh",
    });
    expect(res.model).toBe("gpt");
    const args = argsOf(am, res.agentId!);
    expect(args).toContain('model="gpt-5.6-terra"');
    expect(args).toContain('model_reasoning_effort="xhigh"');
  });

  it("model 에 붙은 @effort 도 같은 결과를 낸다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "gpt-5.6-terra@xhigh",
    });
    expect(argsOf(am, res.agentId!)).toContain(
      'model_reasoning_effort="xhigh"',
    );
  });

  it("★무회귀: 프로바이더만 준 기존 호출은 모델 핀 없이 티어 정책을 탄다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "codex",
      complexity: "simple",
    });
    expect(res.model).toBe("gpt");
    const args = argsOf(am, res.agentId!);
    // 모델 핀은 없고(사용자 config 유지), simple 티어의 effort 만 붙는다.
    expect(args.some((a) => a.startsWith('model="'))).toBe(false);
    expect(args).toContain('model_reasoning_effort="low"');
  });

  it("★무회귀: 미지 모델 문자열은 스폰을 깨지 않고 스코어링으로 폴백한다", async () => {
    const { bridge } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "완전히-없는-모델",
    });
    expect(res.success).toBe(true);
    // 명시 모델로 인정되지 않았으므로 점수 경쟁이 돌았다.
    expect(lastDecision().explicitModel).toBe(false);
  });

  it("★재시작 회귀: stopped agent 재시작도 요청 model pin 을 보존한다", async () => {
    const { bridge, am } = makeBridge();
    const existing = am.launch({
      id: "codex-stopped",
      name: "codex-stopped",
      model: "gpt",
      role: "backend",
      cwd: TMP,
    });
    am.setStatus(existing.id, "stopped");

    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "gpt-5.6-terra@max",
    });

    expect(res.success).toBe(true);
    expect(res.action).toBe("restarted");
    expect(res.agentId).toBe(existing.id);
    expect(res.spawnedModel).toBe("gpt-5.6-terra@max");
    const args = argsOf(am, existing.id);
    expect(args).toContain('model="gpt-5.6-terra"');
    expect(args).toContain('model_reasoning_effort="max"');
    expect(lastDecision().spawnedModel).toBe("gpt-5.6-terra@max");
    expect(lastDecision().reuseVsSpawn).toBe("restart");
  });
});

describe("P2-3 — dispatch:decision 에 실제 model@effort 가 기록된다", () => {
  it("★claude 구체모델이 spawnedModel 로 스탬프된다", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "opus5",
    });
    const d = lastDecision();
    expect(d.spawnedModel).toBe("claude-opus-5");
    // 프로바이더 축은 그대로 — 두 축이 함께 실린다.
    expect(d.selectedModel).toBe("claude");
    expect(d.explicitModel).toBe(true);
    expect(d.reuseVsSpawn).toBe("spawn");
  });

  it("★codex 는 model@effort 형태로 스탬프된다", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "gpt-5.6-terra@max",
    });
    expect(lastDecision().spawnedModel).toBe("gpt-5.6-terra@max");
  });

  it("complexity 파생 모델도 기록된다(지정 없이도 관측된다)", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "claude",
      complexity: "simple",
    });
    // simple 티어 = sonnet5. 지정하지 않았어도 실제로 뜬 모델이 남는다.
    expect(lastDecision().spawnedModel).toBe("claude-sonnet-5");
  });

  it("모델을 핀하지 않은 스폰은 spawnedModel 이 비어 있다(지어내지 않음)", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "codex",
    });
    // codex 는 complexity 파생 effort 만 붙고 모델 핀이 없다 → 라벨 없음.
    expect(lastDecision().spawnedModel).toBeUndefined();
  });
});

/**
 * ★env-swap 벤더 크레덴셜 게이트 — 보드 dispatch·HTTP 스폰 경로(sAw2jP3G).
 *
 * `checkSpawnAuthGate`(#638)는 `agent:launch` IPC 에만 걸려 있어서, 이 경로는
 * 키 없는 env-swap 모델을 그대로 스폰했다. 그 스폰은 **조용히 실패한다**:
 * `applyVendorEnv` 가 전부-아니면-전무로 프로파일을 버리므로 우리 Anthropic
 * 크레덴셜을 든 claude 가 `--model k3` 로 Anthropic 에 붙는다.
 */
describe("env-swap 벤더 크레덴셜 게이트(dispatch 경로)", () => {
  const KEY = "KIMI_API_KEY";
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[KEY];
    delete process.env[KEY];
  });
  afterEach(() => {
    if (saved === undefined) delete process.env[KEY];
    else process.env[KEY] = saved;
  });

  it("★키가 없으면 스폰하지 않고 키 이름을 돌려준다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "kimi-for-coding",
    });
    expect(res.success).toBe(false);
    expect(res.error).toContain(KEY);
    // 죽은 PTY 를 안고 멈추지 않는다 — 스폰 자체가 없었다.
    expect(am.listAgents()).toHaveLength(0);
  });

  it("에러 메시지엔 키 **이름**만 담긴다(값 금지)", async () => {
    process.env[KEY] = "super-secret-value";
    const { bridge } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "k3",
    });
    // 키가 있으니 통과한다(게이트가 항상 막는 것이 아니라 크레덴셜을 본다).
    expect(res.success).toBe(true);
    expect(JSON.stringify(res)).not.toContain("super-secret-value");
  });

  it("키가 있으면 벤더 프로파일이 실제 스폰 env 에 얹힌다", async () => {
    process.env[KEY] = "fixture-kimi";
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "k3",
    });
    expect(res.success).toBe(true);
    // 하네스는 claude(축분리) — 바이너리는 우리 claude 그대로다.
    expect(res.model).toBe("claude");
    const env = am.getAgent(res.agentId!)!.launchConfig!.env;
    expect(env.ANTHROPIC_BASE_URL).toBe("https://api.kimi.com/coding/");
    expect(env.ANTHROPIC_AUTH_TOKEN).toBe("fixture-kimi");
    const args = argsOf(am, res.agentId!);
    expect(args[args.indexOf("--model") + 1]).toBe("k3");
  });

  it("★무회귀: 네이티브 벤더(claude/codex)는 게이트를 그냥 지난다", async () => {
    const { bridge } = makeBridge();
    const claude = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "opus5",
    });
    expect(claude.success).toBe(true);
    const codex = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      model: "gpt-5.6-terra",
    });
    expect(codex.success).toBe(true);
  });
});
