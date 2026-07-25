/**
 * SPAWN-MODEL-ALLOCATION-V2 §3.4-3 — Fable5 런타임 2차 안전망.
 *
 * complex 작업으로 claude-fable-5 를 띄운 에이전트가 FAST_FAIL_WINDOW 안에서
 * 빠르게 죽으면(미지원 모델 오류 등), 자동 재시작 경로가 --model 을 opus 로
 * 강등해서 다시 띄워야 한다. 강등은 한 번만(claudeModelOverride 가드), opus 가
 * 또 fast-fail 하면 일반 예산을 따른다.
 *
 * node-pty / electron / telemetry / agent-config 를 제어 가능한 페이크로 대체해
 * 실제 프로세스/일렉트론 없이 exit 이벤트를 결정적으로 발사한다.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
      return { dispose: () => {} };
    }
    onExit(cb: (e: { exitCode: number }) => void) {
      this.exitCbs.push(cb);
      return { dispose: () => {} };
    }
    emitExit(code: number) {
      for (const cb of [...this.exitCbs]) cb({ exitCode: code });
    }
    emitData(d: string) {
      for (const cb of [...this.dataCbs]) cb(d);
    }
  }
  return {
    spawned: [] as FakePty[],
    FakePty,
    telemetry: {
      agentSpawned: vi.fn(),
      heartbeat: vi.fn(),
      agentStopped: vi.fn(),
      agentRestarted: vi.fn(),
      agentCrashed: vi.fn(),
      modelTierResolved: vi.fn(),
      topModelFallback: vi.fn(),
      modelMixDispatched: vi.fn(),
      complexStagesDispatched: vi.fn(),
    },
    // Records (complexity, claudeModelOverride) per getLaunchConfig call so the
    // test can assert the relaunch pinned opus.
    launchConfigCalls: [] as Array<{
      complexity?: string;
      override?: string;
    }>,
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

vi.mock("../../electron/agent-config", () => ({
  FALLBACK_TOP_CLAUDE_MODEL: "opus",
  AgentConfigGenerator: class {
    // launch() calls: getLaunchConfig(agent, cwd, prompt, projectId, resume,
    // pinSession, complexity, modelPin, contextId).
    // args[6]=complexity, [7]=modelPin{claudeModel,codexModel,codexEffort}.
    // ★[7] 은 예전엔 claudeModelOverride 문자열이었다 — codex 축(모델+effort)이
    // 생기면서 객체로 일반화됐다. claude 모델 핀은 이제 그 안의 한 필드다.
    getLaunchConfig(...args: unknown[]) {
      const complexity = args[6] as string | undefined;
      const override = (args[7] as { claudeModel?: string } | undefined)
        ?.claudeModel;
      launchConfigCalls.push({ complexity, override });
      // complex claude with no override → resolver picked Fable5 (no fallback).
      // override path (downgrade) → no resolution meta (mirrors real code).
      const modelResolution =
        complexity === "complex" && !override
          ? { model: "claude-fable-5", fallback: null }
          : undefined;
      return {
        command: "claude",
        args: [],
        env: { MARBLO_PROJECT: "" },
        initialPrompt: undefined,
        skillContent: undefined,
        claudeSessionId: undefined,
        modelResolution,
      };
    }
    cleanup() {}
    cleanupAll() {}
    hasSavedSession() {
      return false;
    }
  },
}));

import { PtyManager } from "../../electron/pty-manager";
import { AgentManager } from "../../electron/agent-manager";
import fs from "fs";
import os from "os";
import path from "path";

// A REAL directory: PtyManager.create() now rejects a cwd that does not exist,
// because a pty spawned into a deleted directory dies in ~6ms with no error
// (ticket 4xSVtpGzt5NJE4FISfmj). These tests only need *some* valid cwd.
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-test-"));

type FakePtyInst = InstanceType<typeof FakePty>;

beforeEach(() => {
  spawned.length = 0;
  launchConfigCalls.length = 0;
  for (const fn of Object.values(telemetry)) fn.mockClear();
  vi.useFakeTimers();
});
afterEach(() => {
  vi.clearAllTimers();
  vi.useRealTimers();
});

describe("AgentManager — Fable5 runtime downgrade (§3.4-3)", () => {
  function launchFable5(am: AgentManager) {
    return am.launch({
      id: "ag-fab",
      name: "ag-fab",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      complexity: "complex",
    });
  }

  it("tags the instance with the resolved Fable5 model + fires tier telemetry", () => {
    const am = new AgentManager(new PtyManager());
    launchFable5(am);
    const agent = am.getAgent("ag-fab");
    expect(agent?.topClaudeModel).toBe("claude-fable-5");
    expect(agent?.claudeModelOverride).toBeUndefined();
    expect(telemetry.modelTierResolved).toHaveBeenCalledTimes(1);
  });

  it("fast-fail → downgrades to opus, restarts, and pins opus on relaunch", () => {
    const am = new AgentManager(new PtyManager());
    launchFable5(am);

    // Immediate exit(1) → within FAST_FAIL_WINDOW_MS → fast-fail crash.
    (spawned[0] as FakePtyInst).emitExit(1);

    const agent = am.getAgent("ag-fab");
    // Downgrade applied once.
    expect(agent?.claudeModelOverride).toBe("opus");
    // Runtime-downgrade telemetry emitted.
    expect(telemetry.topModelFallback).toHaveBeenCalledWith(
      null,
      "runtime_downgrade",
      "claude-fable-5",
      "runtime",
      "opus",
      "ag-fab",
    );

    // Drive the backoff timer → performAutoRestart relaunches.
    vi.advanceTimersByTime(2000);

    // The relaunch passed claudeModelOverride="opus" to getLaunchConfig.
    const last = launchConfigCalls[launchConfigCalls.length - 1];
    expect(last.override).toBe("opus");
    // New instance still carries the override (guard holds → no re-downgrade).
    expect(am.getAgent("ag-fab")?.claudeModelOverride).toBe("opus");
  });

  it("a non-Fable5 complex claude fast-fail does NOT downgrade", () => {
    // Resolver returned opus (env unset) — modelResolution.model would be opus,
    // but our mock only emits fable5 for the complex+no-override case. Simulate
    // a plain opus launch by using standard complexity (no resolver meta).
    const am = new AgentManager(new PtyManager());
    am.launch({
      id: "ag-std",
      name: "ag-std",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      complexity: "standard",
    });
    (spawned[0] as FakePtyInst).emitExit(1);
    expect(am.getAgent("ag-std")?.claudeModelOverride).toBeUndefined();
    expect(telemetry.topModelFallback).not.toHaveBeenCalled();
  });
});
