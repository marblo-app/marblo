/**
 * grok 사용량이 cost_logs 에 한 행도 안 남던 진범 — **트래커를 아무도 시작하지
 * 않았다**(#630 반쪽 배선).
 *
 * #630 은 파이프의 하류를 전부 깔았다: `session-parsers.grokLineUsage` 가 ACP
 * `turn_completed.usage` 를 읽고, `CostTracker.trackSession(model="grok")` 이
 * `grokSessionsDir()` 를 훑는다. 라이브 격리 GROK_HOME 을 실측하면 그 파일도
 * 필드까지 정확히 존재한다. 그런데 그 `trackSession` 을 부르는 **트리거**인
 * agent-manager 의 비용추적 킥오프가
 *
 *     if (params.model === "gpt" || params.model === "gemini")
 *
 * 로 게이트돼 grok 만 어느 분기에도 없었다(claude·antigravity 는 각자 분기 보유).
 * 결과: `onSessionDetected` 미발화 → 트래커 미생성 → cost_logs 0행. 사용량 탭의
 * 벤더→하위모델 분해에서 grok 이 통째로 사라진 반면, events 소스인 모델별/
 * 에이전트별 축에는 멀쩡히 떴던 비대칭이 이것이다.
 *
 * 콜드부트 재접속(main.ts)은 `agentData.model` 을 그대로 넘겨 grok 도 트래킹됐다
 * — 즉 유실은 **신규 스폰 경로 한정**이었다.
 *
 * 이 파일이 못박는 계약 2개:
 *   ① 신규 스폰된 grok 에이전트는 비용추적 킥오프를 받는다(트리거 계약).
 *   ② 그 킥오프가 도달하는 하류는 실제 라이브 updates.jsonl 을 과금 행으로
 *      바꾼다(파이프 계약, 라이브 캡처 원문 기반).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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

/** 실물 launch config 는 이 테스트의 대상이 아니다 — argv 모양만 흉내낸다.
 *  grok 은 네이티브 하네스라 `-m <model>` 로 모델을 핀한다(agent-config 실물과
 *  같은 축). */
vi.mock("../../electron/agent-config", async (importOriginal) => ({
  // 경로 헬퍼(grokSessionsDir 등)는 **실물** 을 쓴다 — 트래커가 훑는 루트가
  // 실제 격리 GROK_HOME 레이아웃과 어긋나면 ② 가 깨져야 하기 때문이다.
  ...(await importOriginal<typeof import("../../electron/agent-config")>()),
  AgentConfigGenerator: class {
    getLaunchConfig(
      agent: { model: string },
      _cwd: string,
      _prompt?: string,
      _projectId?: string,
      _resume?: string,
      _pin?: boolean,
      _complexity?: string,
      modelPin?: { nativeModel?: string },
    ) {
      const args: string[] = [];
      if (agent.model === "grok") {
        args.push("-m", modelPin?.nativeModel ?? "grok-4.5");
      }
      return {
        command: agent.model === "grok" ? "grok" : "claude",
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
import { AgentManager } from "../../electron/agent-manager";
import { CostTracker, type CostEntry } from "../../electron/cost-tracker";
import { grokSessionsDir } from "../../electron/agent-config";

// PtyManager.create() rejects a non-existent cwd → use a real temp dir.
const TEST_CWD = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-grokusage-"));

beforeEach(() => {
  spawned.length = 0;
  for (const fn of Object.values(telemetry)) fn.mockClear();
});

// ─────────────────────────────────────────────────────────────────────────
// ① 트리거 계약 — 신규 스폰된 grok 이 비용추적 킥오프를 받는다
// ─────────────────────────────────────────────────────────────────────────

describe("① grok 스폰이 비용추적 킥오프를 발화한다", () => {
  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
  });

  function launchAndFlush(model: "grok" | "gpt", id: string) {
    const seen: Array<{ agentId: string; rootPath: string }> = [];
    vi.useFakeTimers();
    const am = new AgentManager(
      new PtyManager(),
      undefined,
      (rootPath, _sid, _label, agentId) => {
        seen.push({ agentId, rootPath });
      },
    );
    am.launch({
      id,
      name: id,
      model,
      role: "backend",
      command: model,
      cwd: TEST_CWD,
    });
    // 파일기반 하네스의 킥오프는 CLI 가 첫 세션 파일을 쓸 여유를 주는 지연
    // 타이머 뒤에 온다. 넉넉히 흘린다.
    vi.advanceTimersByTime(30_000);
    return seen;
  }

  it("★grok: 킥오프가 발화한다 — 종전엔 게이트에서 빠져 cost_logs 0행이었다", () => {
    const seen = launchAndFlush("grok", "ag-grok-kick");
    expect(seen).toHaveLength(1);
    expect(seen[0].agentId).toBe("ag-grok-kick");
    expect(seen[0].rootPath).toBe(TEST_CWD);
  });

  it("gpt(codex)는 종전과 동일하게 발화한다(무회귀 기준선)", () => {
    const seen = launchAndFlush("gpt", "ag-gpt-kick");
    expect(seen).toHaveLength(1);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ② 파이프 계약 — 킥오프가 닿는 하류가 실제 라이브 파일을 과금 행으로 만든다
// ─────────────────────────────────────────────────────────────────────────

/**
 * 라이브 캡처 원문(격리 GROK_HOME, grok 에이전트 10d1ea4e…, 2026-07-28 11:30).
 * 필드 이름/중첩을 손대지 않는다 — 파서가 실물과 어긋나면 여기서 깨져야 한다.
 */
const LIVE_TURN_COMPLETED = {
  jsonrpc: "2.0",
  method: "session/update",
  params: {
    update: {
      sessionUpdate: "turn_completed",
      prompt_id: "30007c0d-0ca2-4b50-911f-9987bfe26394",
      stop_reason: "end_turn",
      usage: {
        inputTokens: 30125,
        outputTokens: 108,
        totalTokens: 30233,
        cachedReadTokens: 29696,
        reasoningTokens: 98,
        modelCalls: 1,
        apiDurationMs: 2390,
        costUsdTicks: 104148000,
        modelUsage: {
          "grok-4.5-build": {
            inputTokens: 30125,
            outputTokens: 108,
            totalTokens: 30233,
            cachedReadTokens: 29696,
            reasoningTokens: 98,
            modelCalls: 1,
            apiDurationMs: 2390,
          },
        },
        numTurns: 1,
      },
    },
  },
};

describe("② grok updates.jsonl → cost_logs 행", () => {
  const made: string[] = [];
  const trackers: CostTracker[] = [];

  afterEach(() => {
    for (const t of trackers.splice(0)) t.clearAll();
    for (const dir of made.splice(0)) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* best-effort */
      }
    }
  });

  /** 실물과 같은 트리를 깐다: <GROK_HOME>/sessions/<encoded-cwd>/<uuid>/updates.jsonl */
  function writeLiveSession(agentId: string, lines: unknown[]): void {
    const sessionRoot = grokSessionsDir(agentId);
    made.push(path.dirname(sessionRoot));
    const dir = path.join(
      sessionRoot,
      encodeURIComponent(TEST_CWD),
      "019fa682-402a-7912-8ad4-12f737cd8198",
    );
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, "updates.jsonl"),
      lines.map((l) => JSON.stringify(l)).join("\n") + "\n",
      "utf-8",
    );
  }

  it("★turn_completed 한 턴이 토큰·모델이 붙은 과금 행으로 적재된다", () => {
    const agentId = "ag-grok-pipe";
    writeLiveSession(agentId, [
      { params: { update: { sessionUpdate: "agent_message_chunk" } } },
      LIVE_TURN_COMPLETED,
    ]);

    const emitted: Array<{ agentId: string; cost: CostEntry }> = [];
    const t = new CostTracker((id, cost) =>
      emitted.push({ agentId: id, cost }),
    );
    trackers.push(t);
    // trackSession 은 grok 을 파일기반 경로로 보낸다(#630). 초기 스캔이 동기라
    // 폴 타이머를 기다릴 필요가 없다.
    t.trackSession(agentId, TEST_CWD, null, "grok", "grok-4.5");

    expect(emitted).toHaveLength(1);
    const cost = emitted[0].cost;
    // inputTokens 는 캐시 읽기를 포함하므로 잔여만 청구된다(30125-29696).
    expect(cost.inputTokens).toBe(429);
    expect(cost.cacheReadTokens).toBe(29696);
    // reasoning 은 이미 output 안에 있다 — 더하지 않는다.
    expect(cost.outputTokens).toBe(108);
    // 실제로 서빙한 모델이 붙는다(하네스족 "grok" 이 아니라).
    expect(cost.model).toBe("grok-4.5-build");
    // 단가가 매겨진다 — 0 이면 고스트 비용(사용량 탭에서 또 안 보인다).
    expect(cost.totalCost).toBeGreaterThan(0);
  });
});
