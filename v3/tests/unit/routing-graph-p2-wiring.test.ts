/**
 * P2 배선 증명 — "키 해상도가 코드에 있다" 와 "실제로 그 키로 학습된다" 는 다르다.
 *
 * 이 파일은 두 실경로를 끝까지 통과시킨다:
 *   (1) 읽기/쓰기 배선: 실제 `BridgeServer.dispatchTask` → `dispatchMetaHook` 이
 *       `taskType` 과 `spawnedModelKey` 를 정말로 실어 보내는가.
 *   (2) 쓰기 경로: 실제 `GraphUpdater.recordOutcome` 이 그 dispatchMeta 를 되읽어
 *       `complexity × taskType × model@effort` 셀에 접는가 — 그리고 그 셀이 뒤이은
 *       dispatch 조회에서 실제로 읽히는가(구키 폴백과 함께).
 *
 * ★유닛 증명과 "재시작 후 라이브 확인" 은 별개다. 여기 있는 전부는 유닛이고,
 * `~/.marblo/routing-graph.json` 에 `gpt-5.6-terra@medium` 류 키가 실제로 생기는지는
 * 앱 재시작(dist-electron/dist-mcp 재로드) 뒤 육안 확인 항목이다.
 */
import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterEach,
  vi,
} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/**
 * ★결정성 — (1) 블록의 실 dispatch 가 읽는 **라이브 기기 상태**를 끊는다
 * (티켓 gW6Z2xtS). 계정 잔여 쿼터(CLI 셸아웃)·`usage-weekly.json`·개발 기기의
 * `routing-graph.json` 세 가지다. 끊지 않으면 codex 주간 쿼터가 100% 에 닿는 날
 * 잔여 0% → `budgetBiasScore` 하드게이트 → "All eligible models are budget
 * exhausted — dispatch blocked" 로 이 블록 5건이 통째로 빨개진다
 * (`enabledModels: ["gpt"]` 라 유일 후보가 소진 판정을 받는다). 배선 증명이
 * 그날의 소진율에 좌우돼선 안 된다.
 *
 * ★`loadRoutingGraph`(기기 실파일)만 콜드로 갈아끼운다 — 이 파일 (2) 블록이
 * 쓰는 `loadRoutingGraphFile`/`GraphUpdater` 는 임시파일을 쓰는 **진짜 코드**로
 * 남아야 한다. 그 축이 이 파일의 본 증명이다.
 */
vi.mock("../../electron/account-usage", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/account-usage")>();
  return {
    ...actual,
    getAccountRateLimits: async () => ({ claude: null, gpt: null, grok: null }),
  };
});
vi.mock("../../electron/usage-rollup", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/usage-rollup")>();
  return { ...actual, loadUsageRollup: () => null };
});
vi.mock("../../electron/routing-graph", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("../../electron/routing-graph")>();
  return { ...actual, loadRoutingGraph: () => actual.emptyRoutingGraph() };
});

/** ε-greedy 탐색을 끈다 — 자동선택 칸이 확률로 흔들리면 키 단언이 간헐 실패한다. */
beforeAll(() => {
  process.env.MARBLO_ROUTING_EXPLORE = "0";
});

import {
  BridgeServer,
  type DispatchTaskRequest,
} from "../../electron/bridge-server";
import type { AgentInstance, AgentStatus } from "../../electron/agent-manager";
import { GraphUpdater } from "../../electron/graph-updater";
import {
  graphBiasForModel,
  loadRoutingGraphFile,
  type GraphContext,
} from "../../electron/routing-graph";
import { graphModelKeys } from "../../electron/routing-model-key";

// ── (1) bridge 배선 ────────────────────────────────────────────

/**
 * bridge 의 spawn 경로가 실제로 부르는 표면만 갖춘 최소 fake
 * (`bridge-dispatch.test.ts` 의 FakeAgentManager 와 같은 표면). 이 테스트가
 * 관심 있는 지점은 딱 하나 — `getSpawnedModel` 이 돌려주는 argv 관측값이
 * dispatchMeta 의 `spawnedModelKey` 로 접히는가다. codex 자동선택은 모델과 effort 를
 * 함께 핀하지만, 구버전/미관측 세션처럼 effort 만 돌아오는 경우도 폴백으로 다룬다.
 */
class FakeAgentManager {
  agents = new Map<string, AgentInstance>();
  launchCalls = 0;
  lastLaunch:
    | {
        codexModelOverride?: string;
        codexEffortOverride?: string;
        claudeModelOverride?: string;
        nativeModelOverride?: string;
      }
    | undefined;
  constructor(
    private spawnModel: { modelId?: string; effort?: string },
    private inferLaunchModel = true,
  ) {}

  listAgents(): AgentInstance[] {
    return [...this.agents.values()];
  }
  listAgentsByProject(): AgentInstance[] {
    return this.listAgents();
  }
  getAgent(id: string): AgentInstance | null {
    return this.agents.get(id) ?? null;
  }
  getAgentByName(name: string): AgentInstance | null {
    return this.listAgents().find((a) => a.name === name) ?? null;
  }
  getSpawnedModel(): { modelId?: string; effort?: string } {
    if (this.spawnModel.modelId || this.spawnModel.effort) {
      return this.spawnModel;
    }
    if (!this.inferLaunchModel) return {};
    return {
      modelId:
        this.lastLaunch?.codexModelOverride ??
        this.lastLaunch?.claudeModelOverride ??
        this.lastLaunch?.nativeModelOverride,
      effort: this.lastLaunch?.codexEffortOverride,
    };
  }
  /** 관측 사다리(argv → 과금 세션 모델). 이 fake 는 과금 관측을 갖지 않으므로
   * argv 관측을 그대로 돌려준다 — 이 파일이 보는 축은 argv→키 접힘이다. */
  resolveConcreteModel(): { modelId?: string; effort?: string } {
    return this.getSpawnedModel();
  }
  setStatus(id: string, status: AgentStatus): void {
    const a = this.agents.get(id);
    if (a) a.status = status;
  }
  setCurrentTask(id: string, taskId: string | null): void {
    const a = this.agents.get(id);
    if (a) a.currentTaskId = taskId;
  }
  setDispatchReason(id: string, reason: string | null): void {
    const a = this.agents.get(id);
    if (a) a.dispatchReason = reason ?? undefined;
  }
  restart(id: string): AgentInstance | null {
    return this.agents.get(id) ?? null;
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
    currentTaskId?: string | null;
    claudeModelOverride?: string;
    codexModelOverride?: string;
    codexEffortOverride?: string;
    nativeModelOverride?: string;
    onPtyReady?: (sid: string) => void;
  }): AgentInstance {
    this.launchCalls++;
    this.lastLaunch = {
      claudeModelOverride: params.claudeModelOverride,
      codexModelOverride: params.codexModelOverride,
      codexEffortOverride: params.codexEffortOverride,
      nativeModelOverride: params.nativeModelOverride,
    };
    const inst = {
      id: params.id,
      name: params.name,
      model: params.model as AgentInstance["model"],
      role: params.role,
      status: "idle" as AgentStatus,
      ptySessionId: `pty-${params.id}`,
      cwd: params.cwd,
      currentTaskId: params.currentTaskId ?? null,
      restartCount: 0,
      spawnedAt: Date.now(),
    } as unknown as AgentInstance;
    this.agents.set(params.id, inst);
    params.onPtyReady?.(inst.ptySessionId);
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
  }): Promise<{
    taskId: string | null;
    cwd: string;
    worktreeCreated: boolean;
  }> {
    return {
      taskId: input.taskId ?? null,
      cwd: input.requestedCwd ?? input.repoRoot,
      worktreeCreated: false,
    };
  }
}

interface CapturedMeta {
  taskId: string;
  meta: {
    model: string;
    complexity?: string;
    role?: string;
    taskType?: string;
    spawnedModelKey?: string;
  };
}

function makeBridge(
  spawnModel: { modelId?: string; effort?: string },
  inferLaunchModel = true,
) {
  const am = new FakeAgentManager(spawnModel, inferLaunchModel);
  const bridge = new BridgeServer(
    am as unknown as ConstructorParameters<typeof BridgeServer>[0],
    new FakePty() as unknown as ConstructorParameters<typeof BridgeServer>[1],
    new Map(),
    new FakeWorktree() as unknown as ConstructorParameters<
      typeof BridgeServer
    >[3],
  );
  const captured: CapturedMeta[] = [];
  bridge.setDispatchMetaHook((taskId, meta) => {
    captured.push({ taskId, meta: meta as CapturedMeta["meta"] });
  });
  return { bridge, am, captured };
}

function dispatch(over: Partial<DispatchTaskRequest>): DispatchTaskRequest {
  return {
    role: "backend",
    instruction: "do the thing",
    cwd: "/repo",
    enabledModels: ["gpt"],
    ...over,
  };
}

describe("P2 배선 — dispatchMeta 가 taskType + spawnedModelKey 를 실어 보낸다", () => {
  it("★gpt 자동선택은 실제 스폰 핀과 같은 model@effort 키를 dispatchMeta 에 기록한다", async () => {
    const { bridge, captured } = makeBridge({});
    const res = await bridge.dispatchTask(
      dispatch({
        taskId: "taskP2AUTO001",
        complexity: "standard",
        taskType: "feature",
      }),
    );
    expect(res.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].meta.spawnedModelKey).toMatch(
      /^gpt-5\.6-(luna|terra|sol)@(low|medium|high|xhigh)$/,
    );
  });

  it("★codex 스폰(effort 만 argv 에 있음) → gpt-5.5@medium 키가 기록된다", async () => {
    // 구버전/미관측 codex 스폰 모습: `-c model_reasoning_effort="medium"` 만 관측.
    const { bridge, captured } = makeBridge({ effort: "medium" });
    const res = await bridge.dispatchTask(
      dispatch({
        taskId: "taskP2AAAAAA",
        complexity: "standard",
        taskType: "feature",
      }),
    );
    expect(res.success).toBe(true);
    expect(captured).toHaveLength(1);
    expect(captured[0].meta.taskType).toBe("feature");
    expect(captured[0].meta.spawnedModelKey).toBe("gpt-5.5@medium");
  });

  it("모델을 핀한 스폰은 그 model@effort 가 기록된다", async () => {
    const { bridge, captured } = makeBridge({
      modelId: "gpt-5.6-terra",
      effort: "high",
    });
    await bridge.dispatchTask(
      dispatch({
        taskId: "taskP2BBBBBB",
        complexity: "complex",
        taskType: "bug-fix",
      }),
    );
    expect(captured[0].meta.spawnedModelKey).toBe("gpt-5.6-terra@high");
  });

  it("★관측이 없으면 키를 지어내지 않는다(spawnedModelKey 미기록)", async () => {
    const { bridge, captured } = makeBridge({}, false);
    await bridge.dispatchTask(
      dispatch({ taskId: "taskP2CCCCCC", complexity: "standard" }),
    );
    expect(captured[0].meta.spawnedModelKey).toBeUndefined();
    // taskType 을 안 넘긴 dispatch 는 종전대로 우아하게 저하한다.
    expect(captured[0].meta.taskType).toBeUndefined();
  });

  it("taskType 은 정규화돼 기록된다(대소문자로 셀이 쪼개지지 않게)", async () => {
    const { bridge, captured } = makeBridge({ effort: "low" });
    await bridge.dispatchTask(
      dispatch({
        taskId: "taskP2DDDDDD",
        complexity: "simple",
        taskType: "  Bug-Fix  ",
      }),
    );
    expect(captured[0].meta.taskType).toBe("bug-fix");
    expect(captured[0].meta.spawnedModelKey).toBe("gpt-5.5@low");
  });
});

// ── (2) 쓰기 경로 → 다음 dispatch 의 읽기 ──────────────────────

describe("P2 배선 — outcome 이 model@effort × taskType 셀로 접히고 다시 읽힌다", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "kg-p2-"));
    file = path.join(dir, "routing-graph.json");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const T0 = Date.parse("2026-07-25T00:00:00Z");
  /** dispatch 가 방금 남긴 dispatchMeta 를 되읽는 실제 경로(main.ts fetchMeta 동형). */
  const META = {
    role: "backend",
    tags: [] as string[],
    taskType: "feature",
    complexity: "standard",
    model: "gpt",
    spawnedModelKey: "gpt-5.5@medium",
  };

  function updater() {
    return new GraphUpdater({
      graphFile: file,
      now: () => T0,
      fetchMeta: async () => META,
    });
  }

  it("★셀 키가 (taskType × complexity × model@effort) 해상도로 생긴다", async () => {
    const mode = await updater().recordOutcome({
      taskId: "T1",
      agentId: "a1",
      rawOutcome: "merged",
    });
    expect(mode).toBe("merged");
    const graph = loadRoutingGraphFile(file);
    expect(Object.keys(graph.cells).sort()).toEqual([
      "complexity:standard|gpt-5.5@medium",
      "role:backend|gpt-5.5@medium",
      "taskType:feature|gpt-5.5@medium",
    ]);
    // ★taskType 축이 실제로 학습에 반영됐다 = complexity 단일축 탈피.
    expect(graph.cells["taskType:feature|gpt-5.5@medium"].n).toBe(1);
  });

  it("★그 셀이 다음 dispatch 의 조회 키(예측 + 구키 폴백)로 실제로 읽힌다", async () => {
    for (let i = 0; i < 8; i++) {
      await updater().recordOutcome({
        taskId: `T${i}`,
        agentId: "a1",
        rawOutcome: "merged",
      });
    }
    const graph = loadRoutingGraphFile(file);
    const ctx: GraphContext = {
      role: "backend",
      complexity: "standard",
      taskType: "feature",
    };
    // dispatch 읽기 경로가 만드는 그 키 목록(티어 정책은 여기선 결정적 fake).
    const keys = graphModelKeys("gpt", "standard", () => ({
      codexReasoning: "medium",
    }));
    expect(keys).toEqual(["gpt-5.6-terra@medium", "gpt-5.5@medium", "gpt"]);
    expect(graphBiasForModel(keys, ctx, graph)).toBeGreaterThan(0);
    // gpt-5.5 학습은 폴백으로만 상속된다. 폴백을 빼면 새 변종 셀은 아직 비어 있다.
    expect(graphBiasForModel(["gpt-5.6-terra@medium"], ctx, graph)).toBe(0);
  });

  it("spawnedModelKey 가 없는 구 dispatchMeta 는 종전 프로바이더 키로 학습한다", async () => {
    const u = new GraphUpdater({
      graphFile: file,
      now: () => T0,
      fetchMeta: async () => ({ ...META, spawnedModelKey: null }),
    });
    await u.recordOutcome({
      taskId: "T9",
      agentId: "a1",
      rawOutcome: "merged",
    });
    const graph = loadRoutingGraphFile(file);
    expect(Object.keys(graph.cells)).toContain("role:backend|gpt");
    // 그리고 그 구키는 새 키 조회의 폴백 칸으로 계속 쓰인다(무손실 마이그레이션).
    expect(
      graphBiasForModel(["gpt-5.5@medium", "gpt"], { role: "backend" }, graph),
    ).toBeGreaterThan(0);
  });

  it("호출자가 modelKey 를 직접 주면 그게 이긴다(dispatchMeta 되읽기 불필요)", async () => {
    const u = new GraphUpdater({
      graphFile: file,
      now: () => T0,
      fetchMeta: async () => META,
    });
    await u.recordOutcome({
      taskId: "T10",
      agentId: "a1",
      rawOutcome: "merged",
      modelKey: "claude-opus-5",
      model: "claude",
      ctx: { role: "backend", complexity: "standard", taskType: "feature" },
    });
    const graph = loadRoutingGraphFile(file);
    expect(Object.keys(graph.cells)).toContain("role:backend|claude-opus-5");
  });

  it("멱등성이 새 키에서도 유지된다(재전달이 두 번 세지 않는다)", async () => {
    const ev = {
      taskId: "T11",
      agentId: "a1",
      rawOutcome: "merged" as const,
    };
    await updater().recordOutcome(ev);
    const once =
      loadRoutingGraphFile(file).cells["taskType:feature|gpt-5.5@medium"].n;
    await updater().recordOutcome(ev);
    const twice =
      loadRoutingGraphFile(file).cells["taskType:feature|gpt-5.5@medium"].n;
    expect(twice).toBe(once);
  });
});
