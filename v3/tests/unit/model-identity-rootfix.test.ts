/**
 * "모델미상/null" 근본 수정 — 스폰 시 구체 실행 모델이 **모든 관측 싱크**에 실린다.
 *
 * 증상은 화면 세 곳에서 따로 보였지만 뿌리는 하나였다: 하네스족 문자열
 * (`claude`/`gpt`)이 모델 id 자리에 앉거나, argv 로 관측된 구체 모델이 싱크까지
 * 안 흘렀다.
 *
 *   - 사용량 "벤더미상"        ← agents doc 에 모델 근거 없음
 *   - 라우팅 KG "232 모델미상" ← dispatchMeta.spawnedModelKey = null
 *   - BQ cost_logs('claude' 90행) / task_outcomes('-' 95행)
 *
 * 이 파일이 못박는 계약 4개:
 *   ① 하네스족 문자열은 모델 id 가 아니다 — 씨앗/폴백에서 걸러진다.
 *   ② ★재시작이 난도를 잃지 않는다. 명시 핀 없는 dispatch 스폰의 모델은 난도
 *      파생(`complexity="standard"` → `--model claude-opus-5`)이라, 난도를 안
 *      옮기면 relaunch argv 에서 `--model` 이 사라져 (a) 실제 서빙 모델이 CLI
 *      기본값으로 조용히 강등되고 (b) 관측이 통째로 미상이 된다.
 *   ③ 관측 사다리 — argv 되읽기 → 과금 세션이 기록한 실제 모델 id. 둘 다 없으면
 *      null 이지 "지어낸 값" 이 아니다.
 *   ④ 비용 트래커 씨딩 계약: onSessionDetected 가 구체 모델을 **인자로** 실어
 *      나른다(그 콜백은 agents.set 보다 먼저 발화해 조회 경로가 비어 있다).
 *
 * argv ↔ 모델의 역방향 해석 자체는 `model-pin-launch-args.test.ts`,
 * 스폰 알림 배선은 `spawned-model-stamp.test.ts` 가 각각 덮는다.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// --- node-pty fake (hoisted so the vi.mock factory can use it) ---------------
const { spawned, FakePty, telemetry, launchConfigCalls } = vi.hoisted(() => {
  class FakePty {
    written: string[] = [];
    killed = false;
    dataCbs: Array<(d: string) => void> = [];
    exitCbs: Array<(e: { exitCode: number }) => void> = [];
    write(d: string) {
      this.written.push(d);
    }
    resize() {}
    kill() {
      this.killed = true;
    }
    onData(cb: (d: string) => void) {
      this.dataCbs.push(cb);
      return {
        dispose: () => {
          this.dataCbs = this.dataCbs.filter((c) => c !== cb);
        },
      };
    }
    onExit(cb: (e: { exitCode: number }) => void) {
      this.exitCbs.push(cb);
      return { dispose: () => {} };
    }
    emitExit(code: number) {
      for (const cb of [...this.exitCbs]) cb({ exitCode: code });
    }
  }
  return {
    spawned: [] as FakePty[],
    FakePty,
    launchConfigCalls: [] as Array<{
      model: string;
      complexity?: string;
      override?: string;
    }>,
    telemetry: {
      agentSpawned: vi.fn(),
      heartbeat: vi.fn(),
      agentStopped: vi.fn(),
      agentRestarted: vi.fn(),
      agentCrashed: vi.fn(),
      modelTierResolved: vi.fn(),
      topModelFallback: vi.fn(),
    },
  };
});

vi.mock("node-pty", () => ({
  spawn: () => {
    const p = new FakePty();
    spawned.push(p);
    return p;
  },
}));

vi.mock("electron", () => ({ BrowserWindow: class {} }));

vi.mock("../../electron/claude-paths", () => ({
  encodeClaudeProjectDir: (p: string) => p.replace(/\//g, "-"),
}));

vi.mock("../../electron/telemetry", () => ({ mainTelemetry: telemetry }));

/**
 * 난도 → 모델 티어 정책을 **실물과 같은 모양**으로만 흉내낸 스텁. 진짜 resolver
 * (버전가드·env)는 이 테스트의 대상이 아니다. 여기서 증명할 것은 "난도가
 * relaunch 까지 전달되는가" 이므로, 난도가 argv 를 바꾼다는 사실만 있으면 된다.
 */
const TIER_MODEL: Record<string, string> = {
  simple: "claude-sonnet-5",
  standard: "claude-opus-5",
  complex: "claude-fable-5",
};

vi.mock("../../electron/agent-config", () => ({
  AgentConfigGenerator: class {
    getLaunchConfig(
      agent: { model: string },
      _cwd: string,
      _prompt?: string,
      _projectId?: string,
      _resume?: string,
      _pin?: boolean,
      complexity?: string,
      modelPin?: {
        claudeModel?: string;
        codexModel?: string;
        codexEffort?: string;
        nativeModel?: string;
      },
    ) {
      launchConfigCalls.push({
        model: agent.model,
        complexity,
        override: modelPin?.claudeModel,
      });
      const args: string[] = [];
      if (agent.model === "claude") {
        // 실물 순서와 같다: 명시 핀 > 난도 파생 > (없으면 CLI 기본 상속).
        const claudeModel =
          modelPin?.claudeModel ??
          (complexity ? TIER_MODEL[complexity] : undefined);
        if (claudeModel) args.push("--model", claudeModel);
      }
      if (agent.model === "gpt") {
        if (modelPin?.codexModel)
          args.push("-c", `model="${modelPin.codexModel}"`);
        if (modelPin?.codexEffort)
          args.push("-c", `model_reasoning_effort="${modelPin.codexEffort}"`);
      }
      return {
        command: agent.model === "gpt" ? "codex" : "claude",
        args,
        env: { MARBLO_PROJECT: "" },
        initialPrompt: undefined,
        skillContent: undefined,
        claudeSessionId: "sess-fixed",
      };
    }
    cleanup() {}
    cleanupAll() {}
    hasSavedSession() {
      return false;
    }
  },
}));

import fs from "fs";
import os from "os";
import path from "path";
import { PtyManager } from "../../electron/pty-manager";
import {
  AgentManager,
  spawnedModelFromArgs,
  formatModelAtEffort,
} from "../../electron/agent-manager";
import { isHarnessFamilyId } from "../../electron/model-registry";
import { normalizeSeedModel } from "../../electron/cost-tracker";
import { modelKeyFromSpawn } from "../../electron/routing-model-key";
import { buildTaskOutcome } from "../../src/lib/telemetry/taskOutcome";

// PtyManager.create() rejects a non-existent cwd → use a real temp dir.
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-modelid-"));

beforeEach(() => {
  spawned.length = 0;
  launchConfigCalls.length = 0;
  for (const fn of Object.values(telemetry)) fn.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// ① 하네스족 ≠ 모델 id
// ─────────────────────────────────────────────────────────────────────────

describe("① 하네스족 문자열은 모델 id 가 아니다", () => {
  it("모든 하네스 이름을 족으로 인정한다", () => {
    for (const h of [
      "claude",
      "gemini",
      "gpt",
      "grok",
      "antigravity",
      "local",
      "custom",
    ]) {
      expect(isHarnessFamilyId(h)).toBe(true);
    }
  });

  it("구체 모델 id 는 족이 아니다", () => {
    for (const m of ["claude-opus-5", "gpt-5.5", "glm-4.7", "grok-4.5"]) {
      expect(isHarnessFamilyId(m)).toBe(false);
    }
  });

  it("★cost_logs 씨앗은 족을 거부한다 — 'claude' 90행의 발원지", () => {
    expect(normalizeSeedModel("claude")).toBeNull();
    expect(normalizeSeedModel("gpt")).toBeNull();
    expect(normalizeSeedModel("  CLAUDE ")).toBeNull();
    expect(normalizeSeedModel("")).toBeNull();
    expect(normalizeSeedModel(undefined)).toBeNull();
  });

  it("씨앗은 구체 모델만 통과시키고 effort 접미사는 벗긴다(단가축=모델 id)", () => {
    expect(normalizeSeedModel("claude-opus-5")).toBe("claude-opus-5");
    expect(normalizeSeedModel("gpt-5.6-sol@high")).toBe("gpt-5.6-sol");
  });

  it("local 하네스 argv 도 --model 로 읽힌다(env-swap 이라 claude 와 같은 모양)", () => {
    expect(
      spawnedModelFromArgs("local", ["--model", "qwen3-coder:30b"]),
    ).toEqual({ modelId: "qwen3-coder:30b" });
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ② 재시작이 난도(→모델 핀)를 잃지 않는다
// ─────────────────────────────────────────────────────────────────────────

describe("② ★재시작이 난도를 보존한다 — 모델이 조용히 사라지지 않는다", () => {
  function launchStandard(am: AgentManager, id = "ag-std") {
    return am.launch({
      id,
      name: id,
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      // dispatch 의 기본값. 명시 모델 핀은 **없다** — 모델은 난도에서 파생된다.
      complexity: "standard",
    });
  }

  it("최초 스폰은 난도가 준 구체 모델로 뜬다", () => {
    const am = new AgentManager(new PtyManager());
    launchStandard(am);
    expect(am.getSpawnedModel("ag-std")).toEqual({
      modelId: "claude-opus-5",
    });
  });

  it("★restart() 후에도 --model 이 남는다(종전엔 여기서 사라졌다)", () => {
    const am = new AgentManager(new PtyManager());
    launchStandard(am);
    am.restart("ag-std");

    const last = launchConfigCalls[launchConfigCalls.length - 1];
    expect(last.complexity).toBe("standard");
    expect(am.getSpawnedModel("ag-std")).toEqual({
      modelId: "claude-opus-5",
    });
  });

  it("★auto-restart(크래시) 후에도 난도가 살아 남는다", () => {
    vi.useFakeTimers();
    try {
      const am = new AgentManager(new PtyManager());
      launchStandard(am, "ag-crash");
      // 정상 수명을 넘긴 뒤의 비정상 종료 → auto-restart 경로.
      vi.advanceTimersByTime(70_000);
      spawned[0].emitExit(1);
      vi.advanceTimersByTime(5_000);

      const last = launchConfigCalls[launchConfigCalls.length - 1];
      expect(last.complexity).toBe("standard");
      expect(am.getSpawnedModel("ag-crash")).toEqual({
        modelId: "claude-opus-5",
      });
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("명시 핀은 여전히 난도를 이긴다(우선순위 무회귀)", () => {
    const am = new AgentManager(new PtyManager());
    am.launch({
      id: "ag-pin",
      name: "ag-pin",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      complexity: "standard",
      claudeModelOverride: "claude-fable-5",
    });
    am.restart("ag-pin");
    expect(am.getSpawnedModel("ag-pin")).toEqual({
      modelId: "claude-fable-5",
    });
  });

  it("난도 없이 뜬 launch 는 종전대로 모델을 지어내지 않는다", () => {
    const am = new AgentManager(new PtyManager());
    am.launch({
      id: "ag-inherit",
      name: "ag-inherit",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
    });
    expect(am.getSpawnedModel("ag-inherit")).toEqual({});
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ③ 관측 사다리 — argv → 과금 세션 모델
// ─────────────────────────────────────────────────────────────────────────

describe("③ resolveConcreteModel — 관측만, 순서대로", () => {
  function launchUnpinned(am: AgentManager, id: string) {
    am.launch({
      id,
      name: id,
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
    });
  }

  it("argv 관측이 있으면 그것이 1차 근거다", () => {
    const am = new AgentManager(new PtyManager());
    am.launch({
      id: "ag-a",
      name: "ag-a",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      complexity: "simple",
    });
    // 과금 관측이 나중에 달라도 argv 가 이긴다(이 launch 가 넘긴 값이 사실).
    am.setDetectedModel("ag-a", "claude-opus-5");
    expect(am.resolveConcreteModel("ag-a")?.modelId).toBe("claude-sonnet-5");
  });

  it("★argv 에 핀이 없으면 과금 세션 모델이 그 자리를 채운다(KG 미상 탈출)", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-b");
    expect(am.resolveConcreteModel("ag-b")?.modelId).toBeUndefined();

    am.setDetectedModel("ag-b", "claude-opus-5");
    expect(am.resolveConcreteModel("ag-b")).toEqual({
      modelId: "claude-opus-5",
    });
  });

  it("하네스족을 되먹여도 저장하지 않는다 — 미상을 모델인 척 적지 않는다", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-c");
    am.setDetectedModel("ag-c", "claude");
    am.setDetectedModel("ag-c", "  ");
    expect(am.resolveConcreteModel("ag-c")?.modelId).toBeUndefined();
  });

  it("codex 처럼 effort 만 관측된 경우 effort 축을 유지한 채 모델만 채운다", () => {
    const am = new AgentManager(new PtyManager());
    am.launch({
      id: "ag-d",
      name: "ag-d",
      model: "gpt",
      role: "backend",
      command: "codex",
      cwd: TEST_CWD,
      codexEffortOverride: "high",
    });
    expect(am.resolveConcreteModel("ag-d")).toEqual({ effort: "high" });

    am.setDetectedModel("ag-d", "gpt-5.6-sol");
    expect(formatModelAtEffort(am.resolveConcreteModel("ag-d"))).toBe(
      "gpt-5.6-sol@high",
    );
  });

  it("★그 관측이 KG 모델 축 키가 된다(dispatchMeta.spawnedModelKey)", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-e");
    // 종전 동작: argv 근거가 없어 키가 null → 프로바이더 셀 = "모델미상".
    expect(modelKeyFromSpawn("claude", am.getSpawnedModel("ag-e"))).toBeNull();

    am.setDetectedModel("ag-e", "claude-opus-5");
    expect(modelKeyFromSpawn("claude", am.resolveConcreteModel("ag-e"))).toBe(
      "claude-opus-5",
    );
  });

  it("재시작을 건너도 과금 관측이 살아 남는다(같은 세션을 resume 하므로)", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-f");
    am.setDetectedModel("ag-f", "claude-opus-5");
    am.restart("ag-f");
    expect(am.resolveConcreteModel("ag-f")?.modelId).toBe("claude-opus-5");
  });

  it("같은 id 로 다시 launch 해도(▶Start·콜드부트 reconnect) 관측이 이어진다", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-h");
    am.setDetectedModel("ag-h", "claude-opus-5");
    // restart() 가 아니라 launch() 재호출 — Agents 탭 ▶Start 가 타는 경로다.
    launchUnpinned(am, "ag-h");
    expect(am.resolveConcreteModel("ag-h")?.modelId).toBe("claude-opus-5");
  });

  it("auto-restart 를 건너도 과금 관측이 살아 남는다", () => {
    vi.useFakeTimers();
    try {
      const am = new AgentManager(new PtyManager());
      launchUnpinned(am, "ag-i");
      am.setDetectedModel("ag-i", "claude-opus-5");
      vi.advanceTimersByTime(70_000);
      spawned[0].emitExit(1);
      vi.advanceTimersByTime(5_000);
      expect(am.resolveConcreteModel("ag-i")?.modelId).toBe("claude-opus-5");
    } finally {
      vi.clearAllTimers();
      vi.useRealTimers();
    }
  });

  it("근거가 하나도 없으면 null — CLI 기본값을 지어내지 않는다", () => {
    const am = new AgentManager(new PtyManager());
    launchUnpinned(am, "ag-g");
    expect(
      formatModelAtEffort(am.resolveConcreteModel("ag-g")),
    ).toBeUndefined();
    expect(am.resolveConcreteModel("없는-에이전트")).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ④ 비용 트래커 씨딩 계약 (cost_logs.model)
// ─────────────────────────────────────────────────────────────────────────

describe("④ onSessionDetected 가 구체 모델을 인자로 실어 나른다", () => {
  it("★claude 스폰: 콜백 시점엔 조회가 비어 있으므로 인자가 유일한 근거다", () => {
    const seen: Array<{ agentId: string; model?: string; lookup: unknown }> =
      [];
    const am = new AgentManager(
      new PtyManager(),
      undefined,
      (_root, _sid, _label, agentId, spawnedModel) => {
        seen.push({
          agentId,
          model: spawnedModel,
          lookup: am.resolveConcreteModel(agentId),
        });
      },
    );

    am.launch({
      id: "ag-seed",
      name: "ag-seed",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      complexity: "standard",
    });

    expect(seen).toHaveLength(1);
    // 인자에는 구체 모델이 실려 있고 —
    expect(seen[0].model).toBe("claude-opus-5");
    // 같은 순간의 조회는 아직 비어 있다(agents.set 이전).
    expect(seen[0].lookup).toBeNull();
    // 그 씨앗은 트래커가 그대로 쓸 수 있는 모델 id 다(족이 아니다).
    expect(normalizeSeedModel(seen[0].model)).toBe("claude-opus-5");
  });

  it("effort 접미사 없이 모델 id 만 넘긴다 — 단가 조회 축이 모델 id 라서", () => {
    let seen: string | undefined = "unset";
    const am = new AgentManager(
      new PtyManager(),
      undefined,
      (_root, _sid, _label, _agentId, spawnedModel) => {
        seen = spawnedModel;
      },
    );
    am.launch({
      id: "ag-seed2",
      name: "ag-seed2",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      claudeModelOverride: "claude-fable-5",
    });
    expect(seen).toBe("claude-fable-5");
  });

  it("모델을 핀하지 않은 launch 는 undefined 를 넘긴다(지어내지 않는다)", () => {
    let called = false;
    let seen: string | undefined;
    const am = new AgentManager(
      new PtyManager(),
      undefined,
      (_root, _sid, _label, _agentId, spawnedModel) => {
        called = true;
        seen = spawnedModel;
      },
    );
    am.launch({
      id: "ag-seed3",
      name: "ag-seed3",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
    });
    expect(called).toBe(true);
    expect(seen).toBeUndefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ⑤ task_outcomes.model 사다리
// ─────────────────────────────────────────────────────────────────────────

describe("⑤ task_outcomes.model — detected > spawned > 하네스", () => {
  const base = {
    clientId: "c1",
    taskId: "t1",
    status: "DONE" as const,
    task: { projectId: "p1", role: "backend" },
    now: new Date("2026-07-27T00:00:00.000Z"),
  };

  it("과금 관측이 최우선", () => {
    const row = buildTaskOutcome({
      ...base,
      agent: {
        model: "claude",
        detectedModelId: "claude-opus-5",
        spawnedModel: "claude-fable-5",
      },
    });
    expect(row.model).toBe("claude-opus-5");
  });

  it("★과금 관측이 없으면 spawnedModel — 종전엔 이 칸이 통째로 없어 '-' 였다", () => {
    const row = buildTaskOutcome({
      ...base,
      agent: { model: "claude", spawnedModel: "claude-fable-5" },
    });
    expect(row.model).toBe("claude-fable-5");
  });

  it("effort 접미사가 붙은 spawnedModel 도 그대로 보존한다(관측 원문)", () => {
    const row = buildTaskOutcome({
      ...base,
      agent: { model: "gpt", spawnedModel: "gpt-5.6-sol@high" },
    });
    expect(row.model).toBe("gpt-5.6-sol@high");
  });

  it("둘 다 없으면 하네스가 최후 폴백(어느 바이너리였나도 관측된 사실)", () => {
    const row = buildTaskOutcome({ ...base, agent: { model: "claude" } });
    expect(row.model).toBe("claude");
  });

  it("빈 문자열/공백은 근거로 치지 않고 다음 칸으로 내려간다", () => {
    const row = buildTaskOutcome({
      ...base,
      agent: {
        model: "claude",
        detectedModelId: "   ",
        spawnedModel: "claude-opus-5",
      },
    });
    expect(row.model).toBe("claude-opus-5");
  });

  it("에이전트 doc 자체가 없으면 null — 지어내지 않는다", () => {
    const row = buildTaskOutcome({ ...base, agent: null });
    expect(row.model).toBeNull();
  });
});

afterEach(() => {
  vi.clearAllTimers();
});
