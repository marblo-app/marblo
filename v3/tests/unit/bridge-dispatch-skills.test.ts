/**
 * P4-1 — dispatch_task(skills[]) 의 벤더 게이트 + 지시문 주입을 BridgeServer
 * 라우팅 위에서 검증한다.
 *
 * 핵심 계약 3개:
 *   1. 미설치/오타 스킬명은 **스폰 없이** 즉시 실패한다(조용한 무효 금지).
 *   2. 스킬 요구는 프로바이더 선택의 하드 제약이다 — 스킬이 없는 벤더의 유휴
 *      에이전트를 재사용하거나 그 벤더로 스폰하지 않는다.
 *   3. 통과하면 지시문 맨 앞에 지정 블록이 주입되어 실제 CLI 로 전달된다.
 *
 * 스킬 발견은 디스크 실측이므로 tmp 픽스처 + CLAUDE_CONFIG_DIR/CODEX_HOME 으로
 * 향하게 한다 — 사용자 홈은 읽지도 쓰지도 않는다.
 */
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  BridgeServer,
  type DispatchTaskRequest,
} from "../../electron/bridge-server";
import {
  spawnedModelFromArgs,
  type AgentInstance,
  type AgentStatus,
} from "../../electron/agent-manager";
import { clearSkillRegistryCache } from "../../electron/mcp-server/skill-registry";

// 실 usage 프로브(claude/codex CLI 서브프로세스)는 이 테스트의 관심사가 아니고
// 수십 초가 걸린다. 중립 스냅샷으로 고정해 budgetBias 를 0으로 만든다 —
// 스킬 게이트만 남겨 판정한다.
vi.mock("../../electron/account-usage", () => ({
  getAccountRateLimits: async () => ({ claude: null, gpt: null, grok: null }),
}));

// ── 스킬 픽스처 ─────────────────────────────────────────────

let fixtureRoot: string;
let claudeCfg: string;
let codexHome: string;
const savedEnv: Record<string, string | undefined> = {};

function writeSkill(root: string, name: string) {
  const dir = path.join(root, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, "SKILL.md"),
    `---\nname: ${name}\ndescription: fixture\n---\n\n# ${name}\n`,
  );
}

beforeAll(() => {
  fixtureRoot = fs.mkdtempSync(
    path.join(os.tmpdir(), "marblo-dispatch-skill-"),
  );
  claudeCfg = path.join(fixtureRoot, "claude");
  codexHome = path.join(fixtureRoot, "codex");
  writeSkill(path.join(claudeCfg, "skills"), "seo-geo-full");
  writeSkill(path.join(codexHome, "skills"), "tf-start");
  for (const key of ["CLAUDE_CONFIG_DIR", "CODEX_HOME"]) {
    savedEnv[key] = process.env[key];
  }
  process.env.CLAUDE_CONFIG_DIR = claudeCfg;
  process.env.CODEX_HOME = codexHome;
});

afterAll(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  fs.rmSync(fixtureRoot, { recursive: true, force: true });
});

afterEach(() => {
  clearSkillRegistryCache();
});

// ── Fakes (bridge-dispatch.test.ts 와 같은 계열, 프롬프트 캡처만 추가) ──

interface LaunchRecord {
  id: string;
  model: string;
  initialPrompt?: string;
}

function makeInstance(init: {
  id: string;
  model?: string;
  status?: AgentStatus;
  projectId?: string;
  cwd?: string;
}): AgentInstance & { projectId?: string } {
  return {
    id: init.id,
    name: `agent-${init.id}`,
    model: (init.model ?? "claude") as AgentInstance["model"],
    role: "backend",
    status: init.status ?? "idle",
    ptySessionId: `pty-${init.id}`,
    cwd: init.cwd ?? "/repo",
    currentTaskId: null,
    restartCount: 0,
    spawnedAt: Date.now(),
    projectId: init.projectId,
  } as unknown as AgentInstance & { projectId?: string };
}

class FakeAgentManager {
  agents = new Map<string, AgentInstance & { projectId?: string }>();
  launches: LaunchRecord[] = [];

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
  /** §P2-3 — 실제 매니저처럼 launchConfig.args 에서 스폰 모델을 되읽는다. */
  getSpawnedModel(id: string): { modelId?: string; effort?: string } | null {
    const agent = this.agents.get(id);
    if (!agent?.launchConfig) return null;
    return spawnedModelFromArgs(agent.model, agent.launchConfig.args);
  }
  getAgentByName(name: string): AgentInstance | null {
    return this.listAgents().find((a) => a.name === name) ?? null;
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
    if (a) a.dispatchReason = reason;
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
    projectId?: string;
    initialPrompt?: string;
    onPtyReady?: (sid: string) => void;
  }): AgentInstance {
    this.launches.push({
      id: params.id,
      model: params.model,
      initialPrompt: params.initialPrompt,
    });
    const inst = makeInstance({
      id: params.id,
      model: params.model,
      status: "idle",
      cwd: params.cwd,
      projectId: params.projectId,
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

function makeBridge() {
  const am = new FakeAgentManager();
  const pty = new FakePtyManager();
  const bridge = new BridgeServer(
    am as unknown as ConstructorParameters<typeof BridgeServer>[0],
    pty as unknown as ConstructorParameters<typeof BridgeServer>[1],
    new Map(),
    new FakeWorktreeCoordinator() as unknown as ConstructorParameters<
      typeof BridgeServer
    >[3],
  );
  bridge.setPlanLookup(() => "team");
  return { bridge, am, pty };
}

function dispatch(
  overrides: Partial<DispatchTaskRequest>,
): DispatchTaskRequest {
  return {
    role: "backend",
    instruction: "do the thing",
    cwd: "/repo",
    enabledModels: ["claude", "gpt"],
    ...overrides,
  };
}

// ── 계약 1: 미설치명은 스폰 없이 즉시 실패 ─────────────────

describe("dispatch_task(skills) — 설치 검증", () => {
  it("★오타 스킬명은 에이전트를 띄우지 않고 실패하고, 실제 설치명을 제안한다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["seo-geo-optimization"] }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("seo-geo-full"); // 제안
    expect(am.launches).toHaveLength(0); // ★조용한 무효가 아니라 무스폰 실패
  });

  it("경로/셸 메타문자가 섞인 이름은 디스크를 보기 전에 거부한다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["../../etc/passwd"] }),
    );
    expect(res.success).toBe(false);
    expect(am.launches).toHaveLength(0);
  });

  it("설치된 스킬은 통과하고 지시문 맨 앞에 지정 블록이 주입된다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["/seo-geo-full"], taskId: "T-abc" }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned");
    expect(am.launches).toHaveLength(1);
    const prompt = am.launches[0].initialPrompt ?? "";
    expect(prompt.startsWith("[지정 스킬")).toBe(true);
    expect(prompt).toContain("- seo-geo-full"); // 앞의 "/" 는 정규화됨
    expect(prompt).toContain("[skill] <이름> invoked"); // 사용 관측 규약
    expect(prompt).toContain("do the thing"); // 원 지시문 보존
  });

  it("스킬 미지정 dispatch 는 지시문을 건드리지 않는다 (무회귀)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(dispatch({}));

    expect(res.success).toBe(true);
    expect(am.launches[0].initialPrompt).toBe("do the thing");
  });
});

// ── 계약 2: 스킬 요구 = 프로바이더 하드 제약 ───────────────

describe("dispatch_task(skills) — 벤더 게이트", () => {
  it("★스킬이 없는 벤더를 명시 지정하면 차단한다 (codex + claude 전용 스킬)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["seo-geo-full"], model: "codex" }),
    );

    expect(res.success).toBe(false);
    expect(res.error).toContain("codex");
    expect(am.launches).toHaveLength(0);
  });

  it("codex 에 설치된 스킬은 codex 로 정상 스폰된다 (설치가 곧 가용성)", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["tf-start"], model: "codex" }),
    );

    expect(res.success).toBe(true);
    expect(am.launches[0].model).toBe("gpt");
    expect(am.launches[0].initialPrompt).toContain("- tf-start");
  });

  it("★스킬이 없는 벤더의 유휴 에이전트는 재사용되지 않는다 (재사용 경로의 조용한 무효 차단)", async () => {
    const { bridge, am } = makeBridge();
    // 역할이 맞는 유휴 codex 에이전트 — 스킬 지정이 없었다면 재사용됐을 후보.
    am.seed(makeInstance({ id: "idle-gpt", model: "gpt", status: "idle" }));

    const res = await bridge.dispatchTask(
      dispatch({ skills: ["seo-geo-full"] }),
    );

    expect(res.success).toBe(true);
    expect(res.action).toBe("spawned"); // 재사용 아님
    expect(am.launches).toHaveLength(1);
    expect(am.launches[0].model).toBe("claude"); // 스킬이 설치된 벤더로만
  });

  it("활성 모델에 스킬 보유 벤더가 하나도 없으면 임의 선택 대신 실패한다", async () => {
    const { bridge, am } = makeBridge();
    const res = await bridge.dispatchTask(
      dispatch({ skills: ["seo-geo-full"], enabledModels: ["gpt"] }),
    );

    expect(res.success).toBe(false);
    expect(am.launches).toHaveLength(0);
  });
});
