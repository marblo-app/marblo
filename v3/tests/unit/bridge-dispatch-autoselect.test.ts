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
 *
 * ★결정성 2 — **라이브 기기 상태를 이 파일에서 끊는다**(티켓 QtZDho1d).
 * dispatch 경로는 두 군데서 실제 기기 상태를 읽는다:
 *   · `getAccountRateLimits()` — 이 기기 구독 계정의 **실제 잔여 쿼터**.
 *   · `loadRoutingGraph()` — `~/.marblo/routing-graph.json` **실파일**.
 * 둘 다 모킹하지 않으면 같은 코드가 기기마다 다른 칸을 고른다. 실제로 잔량이
 * 41% 인 개발 Mac 에서 "opus5 편중 해소" 테스트가 결정적으로 빨개졌다 —
 * `model-autoselect` 는 잔량 50% 미만이면 `conserving` 로 판단해 **동률 회전과
 * ε 탐색을 의도적으로 끄기** 때문이다(탐색은 미래를 위한 지출인데, 쿼터가 마르면
 * 그 지출이 다음 티켓의 스폰 자체를 막는다). 라이브 로직은 정상이고 harness 가
 * 다양성 발동 조건을 못 만든 것이었다. 그래서 아래 두 mock 이 쿼터·그래프를
 * **테스트가 지정하는 값**으로 고정하고, 다양성은 그 조건을 세팅해 검증한다.
 */
import { verdictFor } from "../../electron/composer-gate";
import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  beforeAll,
  afterEach,
} from "vitest";
import os from "os";
import fs from "fs";
import path from "path";
import { useVerifiedClaudeCli } from "../fixtures/verified-claude-cli";

useVerifiedClaudeCli();

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
 * 이 기기 구독 계정의 실제 잔여 쿼터를 끊는다. 기본값은 **넉넉한 잔량**(5% 사용)
 * — 라우팅이 탐색·회전을 살려 두는 정상 운용 구간이다. 반대쪽(쿼터 고갈 →
 * conserving)은 아래 "★쿼터가 마르면" 케이스가 이 값을 갈아끼워 증명한다.
 */
const account = vi.hoisted(() => ({
  claudeUsedPercent: 5 as number | null,
  // ★gpt 도 실측이 온다(라이브 확인 2026-08-07: codex app-server
  // account/rateLimits/read → primary usedPercent, windowDurationMins 10080).
  // 기본은 null(= 종전 케이스 무회귀), 쿼터 케이스가 값을 넣는다.
  gptUsedPercent: null as number | null,
}));
vi.mock("../../electron/account-usage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/account-usage")>();
  const info = (
    percent: number | null,
    planType: string,
    windowMins: number,
  ) =>
    percent === null
      ? null
      : ({
          planType,
          primaryPercent: percent,
          primaryResetAt: null,
          primaryWindowDurationMins: windowMins,
          secondaryPercent: null,
          secondaryResetAt: null,
          secondaryWindowDurationMins: null,
        } as never);
  return {
    ...actual,
    getAccountRateLimits: async () => ({
      claude: info(account.claudeUsedPercent, "max", 300),
      // prolite 플랜은 주간창만 있다(라이브 실측 그대로).
      gpt: info(account.gptUsedPercent, "prolite", 10080),
      grok: null,
    }),
  };
});

/**
 * ★결정성 3 — `~/.marblo/usage-weekly.json`(cost_logs 로컬 거울) 도 끊는다.
 *
 * dispatch 는 이 **실파일**을 동기로 읽어 주간 한도 압력을 만든다. 개발 기기의
 * 하루치가 soft-limit 을 이미 넘겨(측정 2026-08-07: claude 201%, gpt 850%)
 * 롤업이 상시 포화라, 모킹하지 않으면 같은 코드가 기기마다 다른 칸을 고른다.
 * 기본은 null(콜드 = 사용량 항 0)이고, 필요한 케이스가 직접 주입한다.
 */
const usage = vi.hoisted(() => ({
  rollup: null as unknown,
}));
vi.mock("../../electron/usage-rollup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/usage-rollup")>();
  return { ...actual, loadUsageRollup: () => usage.rollup ?? null };
});

/**
 * `~/.marblo/routing-graph.json`(개발 기기의 **실제 학습 결과**)을 끊는다.
 * 기본은 콜드(빈 그래프)고, 관측이 필요한 케이스가 `routing.graph` 에 직접
 * 만들어 넣는다 — UCB1 저표본 보너스가 실제로 배선돼 있는지는 관측이 있어야만
 * 보이기 때문이다.
 */
const routing = vi.hoisted(() => ({
  graph: null as unknown,
}));
vi.mock("../../electron/routing-graph", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/routing-graph")>();
  return {
    ...actual,
    loadRoutingGraph: () => routing.graph ?? actual.emptyRoutingGraph(),
  };
});

import { BridgeServer } from "../../electron/bridge-server";
import { AgentConfigGenerator } from "../../electron/agent-config";
import type { AgentInstance, AgentStatus } from "../../electron/agent-manager";
import { spawnedModelFromArgs } from "../../electron/agent-manager";
import { resetAutoSelectRotation } from "../../electron/model-autoselect";
import { entryRung } from "../../electron/model-ladder";
import { usageSnapshotFromRows } from "../../electron/usage-rollup";
import {
  applyOutcome,
  emptyRoutingGraph,
  type GraphContext,
} from "../../electron/routing-graph";

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
  // 티켓 RtyOMpOArfI7a5JNSzsg — 쓰기 전 컴포저 판정. 화면 없는 페이크는
  // indeterminate(= 종전대로 쓴다)를 준다.
  composerVerdict(): ReturnType<typeof verdictFor> {
    return verdictFor("indeterminate");
  }
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

function codexConf(args: string[], key: string): string | undefined {
  for (let i = 0; i < args.length - 1; i++) {
    if (args[i] !== "-c") continue;
    const m = new RegExp(`^${key}="(.*)"$`).exec(args[i + 1]);
    if (m) return m[1];
  }
  return undefined;
}

/** 매번 새 브리지로 한 건 dispatch(재사용 경로를 타지 않게). */
async function dispatchOnce(opts: {
  complexity?: "simple" | "standard" | "complex";
  model?: string;
  enabledModels?: string[];
}): Promise<{ am: RealishAgentManager; agentId: string; model: string }> {
  const { bridge, am } = makeBridge();
  const enabledModels = opts.enabledModels ?? ["claude"];
  const res = await bridge.dispatchTask({
    role: "backend",
    instruction: "do it",
    cwd: TMP,
    enabledModels,
    ...opts,
  });
  expect(res.success).toBe(true);
  expect(res.action).toBe("spawned");
  return { am, agentId: res.agentId!, model: claudeModelOf(am, res.agentId!) };
}

/**
 * ★hyKsSYYM(env-swap 자동선택 편입) 이후, 이 파일의 실물 dispatch 경로가 부르는
 * `vendorEnvReadiness()` 는 **이 기기의 실제 env** 를 읽는다(모킹 없음). 그래서
 * 기존 "opus5 편중 해소" 류 단언(정확히 sonnet5/opus5 만 나온다)은 이 세 키가
 * 설정된 기기(예: MiniMax 라이브 검증을 이미 마친 개발 Mac)에서 조용히 깨진다 —
 * env-swap 이 진짜로 후보가 되기 때문이다(버그가 아니라 이 티켓의 목적). 그래서
 * 이 describe 블록 밖의 기존 테스트들은 **키를 강제로 비워** 결정적으로 재현하고,
 * 아래 새 describe("★env-swap 실물 스폰")가 키를 **채워서** 반대쪽을 증명한다.
 */
const ENV_SWAP_KEYS = ["ZAI_API_KEY", "MINIMAX_API_KEY", "KIMI_API_KEY"];
const savedEnvSwapKeys: Record<string, string | undefined> = {};

beforeAll(() => {
  process.env.MARBLO_ROUTING_EXPLORE = "0";
});

beforeEach(() => {
  for (const fn of Object.values(telemetry)) fn.mockClear();
  resetAutoSelectRotation();
  account.claudeUsedPercent = 5;
  account.gptUsedPercent = null;
  usage.rollup = null;
  routing.graph = null;
  for (const k of ENV_SWAP_KEYS) {
    savedEnvSwapKeys[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  for (const k of ENV_SWAP_KEYS) {
    if (savedEnvSwapKeys[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnvSwapKeys[k];
  }
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

  it("gpt 자동선택은 고른 변종을 -c model= 로 핀한다", async () => {
    const { am, agentId } = await dispatchOnce({
      complexity: "standard",
      enabledModels: ["gpt"],
    });
    const args = am.getAgent(agentId)!.launchConfig!.args;
    expect(codexConf(args, "model")).toMatch(/^gpt-5\.6-/);
    expect(codexConf(args, "model_reasoning_effort")).toBeDefined();
    expect(String(lastDecision().decisionReason)).toContain("auto-model[");
  });
});

describe("★standard opus5 편중 해소", () => {
  /**
   * 다양성이 **어떤 조건에서** 도는지가 이 케이스의 핵심이다. standard 진입칸
   * (opus5)과 그 아래 칸(sonnet5)의 점수차는 TIE_BAND(5) 안이라 근거상 동률이고,
   * 그래서 `tie-rotate` 가 두 칸을 번갈아 낸다. 단 그 회전은 **쿼터가 넉넉할
   * 때만** 산다(conserving 가드) — 위 mock 이 그 조건을 고정한다.
   */
  it("연속 dispatch 가 opus5 한 칸에 고이지 않는다", async () => {
    const picks: string[] = [];
    const modes: string[] = [];
    for (let i = 0; i < 4; i++) {
      picks.push((await dispatchOnce({ complexity: "standard" })).model);
      modes.push(String(lastDecision().decisionReason));
    }
    expect(new Set(picks).size).toBeGreaterThan(1);
    expect(picks).toContain("claude-sonnet-5");
    // 종전 고정 동작(opus5)도 여전히 나온다 — 강제 분산이 아니라 근거 기반이다.
    expect(picks).toContain("claude-opus-5");
    // 그리고 그 분산의 사유가 회전(동률)이라는 것이 근거 문자열에 남는다.
    expect(modes.every((r) => r.includes("mode=tie-rotate"))).toBe(true);
  });

  /**
   * ★반대쪽 — 쿼터가 마르면 회전을 사지 않는다. `costPressureForHeadroom > 1`
   * (잔량 50% 미만)이면 `selectAutoModel` 은 conserving 로 판단해 탐색·회전을
   * 끄고 근거상 최선만 쓴다. 개발 기기에서 이 파일이 빨갛던 이유가 정확히
   * 이것이라, 버그가 아니라 **정책**임을 여기서 못박는다.
   */
  it("쿼터가 마르면(잔량<50%) 회전을 사지 않고 진입칸을 유지한다", async () => {
    account.claudeUsedPercent = 59; // 잔량 41%
    const picks: string[] = [];
    for (let i = 0; i < 4; i++) {
      picks.push((await dispatchOnce({ complexity: "standard" })).model);
    }
    expect(new Set(picks)).toEqual(new Set(["claude-opus-5"]));
    expect(String(lastDecision().decisionReason)).toContain("mode=top-score");
  });

  it("난도 미지정(기본 standard)도 같은 경로를 탄다", async () => {
    const { model } = await dispatchOnce({});
    expect(["claude-sonnet-5", "claude-opus-5"]).toContain(model);
  });

  /**
   * ★UCB1 저표본 보너스가 **실물 dispatch 경로까지 배선돼 있나**. 순수 유닛은
   * `diversityBonus()` 를 직접 부르지만, 여기서 보고 싶은 것은 브리지가 넘긴
   * 그래프에서 `observationCountForModel` 이 읽힌 뒤 그 n 이 선택 근거에 실려
   * 나오는가다(콜드 그래프만 쓰면 언제나 `n=0, tot=0` 이라 이 배선이 죽어도
   * 테스트가 못 잡는다).
   */
  it("관측이 쌓이면 다양성 성분이 그 n 을 실제로 읽는다", async () => {
    const graph = emptyRoutingGraph();
    const ctx: GraphContext = {
      role: "backend",
      tags: [],
      complexity: "standard",
    };
    const at = Date.now();
    for (let i = 0; i < 6; i++) {
      applyOutcome(graph, {
        model: "claude-opus-5",
        mode: "success",
        ctx,
        taskId: `T-opus-${i}`,
        agentId: `a-${i}`,
        atMs: at,
      });
    }
    routing.graph = graph;

    await dispatchOnce({ complexity: "standard" });
    const reason = String(lastDecision().decisionReason);
    // 콜드가 아니다 — kg 는 관측 수를 밝히고, diversity 는 tot>0 위에서 계산된다.
    expect(reason).not.toContain("(cold)");
    expect(reason).toMatch(/diversity [+-][\d.]+ \(n=\d+, tot=[1-9]\d*\)/);
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

// ─────────────────────────────────────────────────────────────────────────
// ★구독 우선 — env-swap 키가 있어도 쿼터가 넉넉하면 native 구독 칸 우선.
//
// 여기서는 MINIMAX_API_KEY 를 **채운다** — vendorEnvReadiness 가 ready=true 를 내도
// 구독형 native 칸의 effective 단가가 낮으면 dispatch 가 env-swap 을 쓰지 않는지
// 본다(dist-electron 스폰 경로 그대로, PTY/워크트리만 fake).
// ─────────────────────────────────────────────────────────────────────────
describe("★구독 우선 실물 스폰", () => {
  const savedKey = { value: undefined as string | undefined };

  beforeEach(() => {
    savedKey.value = process.env.MINIMAX_API_KEY;
    process.env.MINIMAX_API_KEY = "fixture-minimax-key";
  });

  afterEach(() => {
    if (savedKey.value === undefined) delete process.env.MINIMAX_API_KEY;
    else process.env.MINIMAX_API_KEY = savedKey.value;
  });

  it("키가 있어도 구독 쿼터가 넉넉하면 simple 자동선택이 구독 칸을 실제로 고른다", async () => {
    const { am, agentId, model } = await dispatchOnce({ complexity: "simple" });
    expect(model).toBe("claude-sonnet-5");

    // 읽는 셀 = 쓰는 셀: argv 에 실제로 그 모델 id 가 그대로 핀된다.
    const args = am.getAgent(agentId)!.launchConfig!.args;
    expect(args).toContain("--model");
    expect(args[args.indexOf("--model") + 1]).toBe("claude-sonnet-5");

    // 구독형 native provider 이므로 env-swap 프로파일은 얹히지 않는다.
    const env = am.getAgent(agentId)!.launchConfig!.env;
    expect(env.ANTHROPIC_AUTH_TOKEN).not.toBe("fixture-minimax-key");

    // 그래프 키(dispatchReason)도 같은 모델을 가리킨다(대소문자는
    // formatModelKey 가 소문자로 정규화 — routing-model-key.ts).
    const reason = String(lastDecision().decisionReason);
    expect(reason).toContain("auto-model[simple]");
    expect(reason).toContain("claude-sonnet-5");
  });

  it("키가 있어도 complex 자동선택은 여전히 claude-fable-5 를 고른다(SWE·비대칭감점 우세)", async () => {
    const { model } = await dispatchOnce({ complexity: "complex" });
    expect(model).toBe("claude-fable-5");
  });

  it("★명시 지정은 자동선택보다 우선한다(env-swap 키가 있어도 무회귀)", async () => {
    const { am, agentId } = await dispatchOnce({
      complexity: "simple",
      model: "opus5",
    });
    expect(claudeModelOf(am, agentId)).toBe("claude-opus-5");
  });
});

/**
 * ★near-limit 디프라이어리티 — 티켓 AS4noeJq 의 완료 기준.
 *
 * 관측: codex 가 100% 소진되면 dispatch 가 하드차단되는데(bias=null), **임박**
 * 구간에서는 계속 codex 로 스폰됐다. 원인은 1층 점수 산수다 — budgetBias 바닥이
 * −20 인데 gpt 태그 보너스(simple-fix/github 25)와 단가 격차(costEff 10 vs 3)가
 * 그걸 넘는다. 아래 첫 케이스가 그 산수를, 나머지가 게이트의 안전장치를 고정한다.
 */
describe("★near-limit 하네스는 후보에서 밀린다(잔여 5% codex)", () => {
  /** 하네스(프로바이더) 축만 본다 — 어느 CLI 로 떴나. */
  async function dispatchHarness(opts: {
    complexity?: "simple" | "standard" | "complex";
    tags?: string[];
    enabledModels?: string[];
  }): Promise<{ harness: string; reason: string }> {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      enabledModels: opts.enabledModels ?? ["claude", "gpt"],
      complexity: opts.complexity ?? "standard",
      tags: opts.tags ?? [],
    });
    expect(res.success).toBe(true);
    return {
      harness: am.getAgent(res.agentId!)!.model,
      reason: String(res.reason ?? ""),
    };
  }

  it("standard: 잔여 5% codex 는 선택되지 않는다(claude 여유)", async () => {
    account.claudeUsedPercent = 20; // 잔여 80%
    account.gptUsedPercent = 95; // 잔여 5%
    for (let i = 0; i < 4; i++) {
      expect((await dispatchHarness({})).harness).toBe("claude");
    }
  });

  it("★태그가 gpt 를 강하게 밀어도 뒤집히지 않는다 — 이게 관측된 결함이었다", async () => {
    account.claudeUsedPercent = 20;
    account.gptUsedPercent = 95;
    // 점수만으로는 gpt 67 vs claude 60 이라 gpt 가 이긴다(dispatch-scoring 유닛 참조).
    for (const tags of [["simple-fix"], ["github"], ["quick-edit"]]) {
      expect((await dispatchHarness({ tags })).harness, tags.join()).toBe(
        "claude",
      );
    }
  });

  it("complex 도 같다 — 어려운 티켓을 마른 쿼터로 시작하지 않는다", async () => {
    account.claudeUsedPercent = 20;
    account.gptUsedPercent = 93;
    expect((await dispatchHarness({ complexity: "complex" })).harness).toBe(
      "claude",
    );
  });

  it("잔여가 예비선 위면(15%) 종전대로 점수 경쟁이다 — 과반응 금지", async () => {
    account.claudeUsedPercent = 20;
    account.gptUsedPercent = 85; // 잔여 15% > 예비선 10%
    const picks = new Set<string>();
    for (const tags of [["simple-fix"], ["github"]]) {
      picks.add((await dispatchHarness({ tags })).harness);
    }
    // 태그가 gpt 를 미는 구간이므로 gpt 가 살아 있어야 한다(게이트 미발동).
    expect(picks.has("gpt")).toBe(true);
  });

  it("★대안이 없으면 게이트가 발동하지 않는다 — dispatch 를 죽이지 않는다", async () => {
    account.claudeUsedPercent = null; // claude 미연결
    account.gptUsedPercent = 95;
    const { harness } = await dispatchHarness({ enabledModels: ["gpt"] });
    expect(harness).toBe("gpt");
  });

  it("★둘 다 임박이면 둘 다 남는다(하나는 떠야 한다)", async () => {
    account.claudeUsedPercent = 92;
    account.gptUsedPercent = 95;
    const { harness } = await dispatchHarness({});
    expect(["claude", "gpt"]).toContain(harness);
  });

  it("★소진(100%)은 종전대로 하드차단 — 게이트가 그 계약을 바꾸지 않는다", async () => {
    account.claudeUsedPercent = 100;
    account.gptUsedPercent = 100;
    const { bridge } = makeBridge();
    const res = await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      enabledModels: ["claude", "gpt"],
      complexity: "standard",
    });
    expect(res.success).toBe(false);
    expect(String(res.error)).toContain("budget exhausted");
  });

  /**
   * ★추정치 포화가 dispatch 를 막지 않는다(harness-quota.weeklyRollupCap).
   * 개발 기기 실측(2026-08-07)에서 usage-weekly 하루치가 soft-limit 의 2~8.5배라
   * 롤업은 상시 100% 였고, 캡이 없으면 그 추정치가 계정 실측과 max 합성돼
   * "모든 후보 소진" 으로 모든 자동선택 dispatch 를 막았다.
   */
  it("포화된 주간 롤업만으로는 dispatch 가 막히지 않는다", async () => {
    account.claudeUsedPercent = 20;
    account.gptUsedPercent = null;
    usage.rollup = usageSnapshotFromRows([
      { model: "claude-opus-5", totalTokens: 161_000_000 }, // soft limit 80M
      { model: "gpt-5.5", totalTokens: 510_000_000 }, // soft limit 60M
    ]);
    const { harness } = await dispatchHarness({});
    expect(["claude", "gpt"]).toContain(harness);
  });
});

describe("★쿼터 예비선 제외는 감사 로그에 남는다", () => {
  it("dispatchReason 에 quota-reserve 와 제외된 하네스가 실린다", async () => {
    account.claudeUsedPercent = 20;
    account.gptUsedPercent = 95;
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      enabledModels: ["claude", "gpt"],
      complexity: "standard",
      tags: ["simple-fix"],
    });
    const reason = String(lastDecision().decisionReason);
    expect(reason).toContain("quota-reserve(10%)");
    expect(reason).toContain("gpt");
  });
});

/**
 * ★라우팅 라벨 계측 — #890 §7 F-1~F-4 (티켓 AdJ1Gon2).
 *
 * 왜 이 파일인가: F-1~F-4 는 전부 **같은 한 줄**(`emitDispatchDecision`)에서
 * 나오고(§7-A), 그 한 줄이 실제로 무엇을 싣는지는 실물 dispatch 를 태워야만
 * 보인다. 위 케이스들이 이미 그 경로를 진짜 코드로 돌리고 있으므로 여기 붙인다.
 *
 * 이 블록이 지키는 계약은 두 가지다:
 *   1. **액션이 model@effort 해상도로 남는다** — 선택된 칸과 **비선택 후보까지**.
 *      이게 없으면 2층 라우팅은 학습이 원리적으로 불가능하다(오늘 유효 7행).
 *   2. **결정 시점에만 알 수 있는 것이 그 시점에 박힌다** — 잔여예산·주간 점유·
 *      활성 수·당시 단가. 나중엔 재구성이 불가능하거나 틀린 값이 된다.
 */
describe("★라우팅 라벨 계측(#890 F-1~F-4)", () => {
  it("F-1 — 액션과 후보집합이 model@effort 해상도로 남는다", async () => {
    const { am, agentId } = await dispatchOnce({ complexity: "standard" });
    const d = lastDecision();

    // 액션(라우터가 고른 칸): 프로바이더가 아니라 구체 칸이어야 한다.
    expect(String(d.plannedModelKey)).toMatch(/^claude-/);
    // 실현(실제 argv): 되읽은 값 + 그 근거.
    expect(d.spawnedModel).toBe(claudeModelOf(am, agentId));
    expect(d.spawnedModelSource).toBe("argv");
    // 후보집합도 같은 해상도 — "무엇과 겨뤄 이겼나" 가 프로바이더까지만
    // 남으면 후보 전개(1 dispatch → N 훈련행)를 할 수 없다.
    const keys = d.candidateKeys as string[];
    expect(keys.length).toBeGreaterThan(0);
    expect(keys.every((k) => k !== "claude")).toBe(true);
  });

  it("F-4 — 결정 시점 단가가 후보 키별로 스냅샷된다", async () => {
    await dispatchOnce({ complexity: "standard" });
    const costs = lastDecision().candidateCostIndex as Record<string, number>;
    const keys = lastDecision().candidateKeys as string[];
    expect(Object.keys(costs).length).toBeGreaterThan(0);
    for (const [key, value] of Object.entries(costs)) {
      expect(keys).toContain(key);
      // 0 은 "공짜" 라는 거짓 근거다 — 미등록 id 는 아예 안 싣는 게 계약이다.
      expect(value).toBeGreaterThan(0);
    }
  });

  it("F-2 — 결정 시점 상태(잔여예산·활성 수)가 함께 박힌다", async () => {
    account.claudeUsedPercent = 37;
    await dispatchOnce({ complexity: "standard" });
    const state = lastDecision().decisionState as Record<string, unknown>;
    expect(state.budgetUsedPercent).toBe(37);
    expect(state.candidateSetSize).toBeGreaterThan(0);
    expect(typeof state.activeAgentCount).toBe("number");
    expect(typeof state.roleAgentCount).toBe("number");
    // 롤업이 콜드면 점유율은 **0 이 아니라 null** 이다 — 모르는 것을 0 으로
    // 적으면 "이 하네스를 안 썼다" 는 없는 사실이 학습셋에 들어간다.
    expect(state.weeklyTokenShare).toBeNull();
  });

  it("F-3 — 근거 8성분이 문자열이 아니라 필드로 남는다", async () => {
    await dispatchOnce({ complexity: "standard" });
    const c = lastDecision().decisionComponents as Record<string, unknown>;
    expect(c).toBeTruthy();
    expect(typeof c.mode).toBe("string");
    expect(typeof c.decidedBy).toBe("string");
    expect(String(c.entryModelKey)).toMatch(/^claude-/);
    for (const part of [
      "fit",
      "cost",
      "bench",
      "capability",
      "kg",
      "diversity",
      "usage",
      "weeklyLimit",
    ]) {
      expect(typeof c[part]).toBe("number");
    }
  });

  it("★명시 모델 경로에도 액션 칸이 남는다(그 구간이 통째로 비어 있었다)", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "do it",
      cwd: TMP,
      enabledModels: ["claude"],
      complexity: "standard",
      model: "claude",
    });
    const d = lastDecision();
    expect(d.explicitModel).toBe(true);
    // 자동선택은 안 돌았지만 티어 정책이 고른 칸은 결정돼 있다 — 그게 액션이다.
    expect(String(d.plannedModelKey)).toMatch(/^claude-/);
    expect(d.decisionState).toBeTruthy();
  });

  it("★비식별 — 페이로드에 프롬프트/경로가 들어가지 않는다", async () => {
    const { bridge } = makeBridge();
    await bridge.dispatchTask({
      role: "backend",
      instruction: "SECRET-INSTRUCTION-TEXT",
      cwd: TMP,
      enabledModels: ["claude"],
      complexity: "standard",
    });
    const serialized = JSON.stringify(lastDecision());
    expect(serialized).not.toContain("SECRET-INSTRUCTION-TEXT");
    expect(serialized).not.toContain(TMP);
  });
});
