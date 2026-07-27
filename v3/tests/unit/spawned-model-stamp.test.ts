/**
 * 스폰된 에이전트의 **구체 모델**(model@effort)이 알림 경로까지 실려 나가는지.
 *
 * 배경: 보드·에이전트 목록은 오래도록 벤더(claude/gpt)만 보여줬다. 같은 claude
 * 안에서 fable5 로 띄운 것과 opus 로 띄운 것이 화면상 동일해서, 모델을 지정해
 * 스폰한 사람이 지정대로 떴는지 확인할 방법이 없었다.
 *
 * ★이 파일이 못박는 핵심은 **타이밍**이다. 스폰 알림(agent:spawned)은
 * `onPtyReady` 안에서 만들어지는데, 그 시점은 `AgentManager.launch` 가
 * `this.agents.set` 을 하기 **전**이다. 그래서 수신 측이 `getSpawnedModel(id)`
 * 로 조회하면 null 이 나오고, 조회 기반으로 짜면 배지가 영원히 비어 있다.
 * 그래서 launch 가 콜백 인자로 직접 넘긴다 — 그 계약을 여기서 고정한다.
 *
 * argv ↔ 모델의 역방향 해석 자체(spawnedModelFromArgs)는
 * `model-pin-launch-args.test.ts` 가 덮는다. 여기선 배선만 본다.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// --- node-pty fake (hoisted so the vi.mock factory can use it) ---------------
const { spawned, FakePty, telemetry } = vi.hoisted(() => {
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
 * 진짜 CLI 인자 조립(buildCLICommand)은 이 테스트의 대상이 아니다. 대신 실제
 * 형태와 **같은 모양**의 argv 를 내는 최소 스텁을 둔다 — claude 는
 * `--model <id>`, codex 는 `-c model="…"` / `-c model_reasoning_effort="…"`.
 */
vi.mock("../../electron/agent-config", () => ({
  AgentConfigGenerator: class {
    getLaunchConfig(
      agent: { model: string },
      _cwd: string,
      _prompt?: string,
      _projectId?: string,
      _resume?: string,
      _pin?: boolean,
      _complexity?: string,
      modelPin?: {
        claudeModel?: string;
        codexModel?: string;
        codexEffort?: string;
      },
    ) {
      const args: string[] = [];
      if (agent.model === "claude" && modelPin?.claudeModel) {
        args.push("--model", modelPin.claudeModel);
      }
      if (agent.model === "gpt") {
        if (modelPin?.codexModel) {
          args.push("-c", `model="${modelPin.codexModel}"`);
        }
        if (modelPin?.codexEffort) {
          args.push("-c", `model_reasoning_effort="${modelPin.codexEffort}"`);
        }
      }
      return {
        command: agent.model === "gpt" ? "codex" : "claude",
        args,
        env: { MARBLO_PROJECT: "" },
        initialPrompt: undefined,
        skillContent: undefined,
        claudeSessionId: undefined,
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
import { AgentManager } from "../../electron/agent-manager";

// PtyManager.create() rejects a non-existent cwd, so use a real temp dir.
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-spawnmodel-"));

beforeEach(() => {
  spawned.length = 0;
});

describe("onPtyReady 가 구체 모델을 실어 나른다", () => {
  it("★완료기준: claude fable5 스폰 → 콜백이 'claude-fable-5' 를 받는다", () => {
    const am = new AgentManager(new PtyManager());
    let seen: string | undefined | "not-called" = "not-called";

    am.launch({
      id: "ag-fable",
      name: "fable-worker",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      claudeModelOverride: "claude-fable-5",
      onPtyReady: (_sid, spawnedModel) => {
        seen = spawnedModel;
      },
    });

    expect(seen).toBe("claude-fable-5");
  });

  it("★완료기준: codex 는 effort 까지 붙는다 — 'gpt-5.6-sol@high'", () => {
    const am = new AgentManager(new PtyManager());
    let seen: string | undefined | "not-called" = "not-called";

    am.launch({
      id: "ag-codex",
      name: "codex-worker",
      model: "gpt",
      role: "backend",
      command: "codex",
      cwd: TEST_CWD,
      codexModelOverride: "gpt-5.6-sol",
      codexEffortOverride: "high",
      onPtyReady: (_sid, spawnedModel) => {
        seen = spawnedModel;
      },
    });

    expect(seen).toBe("gpt-5.6-sol@high");
  });

  it("모델을 핀하지 않은 launch 는 undefined — 값을 지어내지 않는다", () => {
    const am = new AgentManager(new PtyManager());
    let called = false;
    let seen: string | undefined;

    am.launch({
      id: "ag-nopin",
      name: "plain-worker",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      onPtyReady: (_sid, spawnedModel) => {
        called = true;
        seen = spawnedModel;
      },
    });

    expect(called).toBe(true);
    expect(seen).toBeUndefined();
  });

  it("★이 인자가 필요한 이유: 콜백 시점엔 getSpawnedModel(id) 이 아직 null", () => {
    const am = new AgentManager(new PtyManager());
    let atCallbackTime: unknown = "unset";
    let fromCallbackArg: string | undefined;

    am.launch({
      id: "ag-timing",
      name: "timing-worker",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      claudeModelOverride: "claude-fable-5",
      onPtyReady: (_sid, spawnedModel) => {
        // agents.set 은 launch 의 뒷부분에서 일어난다 — 조회 경로는 여기서
        // 아무것도 못 준다. 조회 기반으로 스폰 알림을 짜면 배지가 영영 빈다.
        atCallbackTime = am.getSpawnedModel("ag-timing");
        fromCallbackArg = spawnedModel;
      },
    });

    expect(atCallbackTime).toBeNull();
    expect(fromCallbackArg).toBe("claude-fable-5");
    // launch 가 반환된 뒤에는 조회 경로도 정상 — 스폰 응답/재접속처럼 launch
    // 이후에 읽는 자리들은 계속 getSpawnedModel 을 써도 된다.
    expect(am.getSpawnedModel("ag-timing")).toEqual({
      modelId: "claude-fable-5",
    });
  });

  it("재시작은 같은 콜백을 재사용하므로 새 모델이 다시 통보된다(재스탬프)", () => {
    const am = new AgentManager(new PtyManager());
    const seen: Array<string | undefined> = [];
    const onPtyReady = (_sid: string, spawnedModel?: string) => {
      seen.push(spawnedModel);
    };

    am.launch({
      id: "ag-restart",
      name: "restart-worker",
      model: "claude",
      role: "backend",
      command: "claude",
      cwd: TEST_CWD,
      claudeModelOverride: "claude-fable-5",
      onPtyReady,
    });
    // restart() 는 저장된 onPtyReady 를 그대로 재사용하므로 relaunch 의 모델이
    // 다시 통보된다. ★그 모델은 재시작 후에도 **같아야** 한다 — restart 는
    // 인스턴스에 보존된 모델 핀(claudeModelOverride)과 난도(complexity)를 그대로
    // 실어 재기동하기 때문이다. 여기가 갈리면 재시작이 모델을 조용히 CLI
    // 기본값으로 강등시키고 배지·KG·cost_logs 가 한꺼번에 "모델미상" 이 된다.
    am.restart("ag-restart");

    expect(seen).toHaveLength(2);
    expect(seen[0]).toBe("claude-fable-5");
    expect(seen[1]).toBe("claude-fable-5");
  });
});
