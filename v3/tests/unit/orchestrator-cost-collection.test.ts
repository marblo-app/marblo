/**
 * 회귀 가드: 오케스트레이터 사용량이 **조용히** 비용 수집에서 빠지는 사고
 * (ticket TaDiWyLNi5ihBnjfVmMs).
 *
 * 사고의 모양:
 *   `cost_logs` 에서 `agentId LIKE 'orchestrator-%'` 가 2026-06-22 이후 0행이었다.
 *   두 달 동안 아무도 몰랐다 — 에러가 없었기 때문이다. 실측해 보니 6월의 그
 *   4,711행조차 진짜 오케 비용이 아니라, 콜드부트 reconnect 가 오케 doc 을
 *   되살려 **남의 Claude 세션**에 붙였던 오귀속이었다(같은 초에 최대 11개
 *   agentId 가 한 토큰 번들을 동시 청구, 명목 $22,329 중 $5,605 가 워커 행과
 *   바이트 동일). 그 경로는 #231/#235 에서 **의도적으로** 제거됐다.
 *
 * 그래서 이 파일이 지키는 것은 두 가지다.
 *   1) 오케 세션이 비용 추적에 **등록된다**.
 *   2) 근거 없는 세션에는 **절대 등록되지 않는다** — 미수집이 오귀속보다 낫다.
 *
 * 순수 로직 테스트 + 배선 소스 스캔을 함께 둔다. 이 사고의 재발 형태는 로직이
 * 틀리는 것이 아니라 **배선이 빠지는 것**이라서, 로직만 테스트하면 또 두 달을
 * 놓친다.
 */

import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import {
  classifyPtySessionId,
  isOrchestratorAgentId,
  orchestratorCostAgentId,
  planOrchestratorCostTracking,
  type OrchestratorCostSession,
} from "../../electron/session-kind";
import { isCliHomeTracked } from "../../electron/session-parsers";

const ELECTRON_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "..",
  "electron"
);
const readElectron = (f: string): string =>
  fs.readFileSync(path.join(ELECTRON_DIR, f), "utf-8");

/** orchestrator-manager.ts 가 실제로 만드는 PTY sid 와 같은 모양. */
const orchPtySid = (sessionId: string, at = 1_766_000_000_000): string =>
  `orch-${sessionId}-${at}`;

const startEvent = (
  over: Partial<OrchestratorCostSession> = {}
): OrchestratorCostSession => ({
  phase: "start",
  costAgentId: "orchestrator-proj1",
  rootPath: "/repo",
  projectId: "proj1",
  model: "claude",
  claudeSessionId: "11111111-2222-3333-4444-555555555555",
  ...over,
});

describe("classifyPtySessionId — 세션 종류를 명시적으로 판정한다", () => {
  it("워커 PTY 는 agent 로, 접두를 뗀 agentId 를 준다", () => {
    expect(classifyPtySessionId("agent-abc123")).toEqual({
      kind: "agent",
      costAgentId: "abc123",
    });
  });

  it("★오케 PTY 는 agent 가 아니다 — 종전 `startsWith('agent-')` 가 놓치던 바로 그 케이스", () => {
    const sid = orchPtySid(orchestratorCostAgentId("board", "proj1"));
    const identity = classifyPtySessionId(sid);
    expect(identity.kind).toBe("orchestrator");
    expect(identity.kind).not.toBe("agent");
  });

  it("★오케 PTY sid → 비용 축 agentId 왕복이 규약과 일치한다 (board)", () => {
    const costId = orchestratorCostAgentId("board", "proj1");
    expect(costId).toBe("orchestrator-proj1");
    expect(classifyPtySessionId(orchPtySid(costId)).costAgentId).toBe(costId);
  });

  it("★오케 PTY sid → 비용 축 agentId 왕복이 규약과 일치한다 (mission)", () => {
    const costId = orchestratorCostAgentId("mission", "proj1");
    expect(costId).toBe("orchestrator-mission-proj1");
    expect(classifyPtySessionId(orchPtySid(costId)).costAgentId).toBe(costId);
  });

  it("모르는 sid 는 unknown 이고 id 를 지어내지 않는다", () => {
    expect(classifyPtySessionId("terminal-7")).toEqual({
      kind: "unknown",
      costAgentId: null,
    });
    expect(classifyPtySessionId("")).toEqual({
      kind: "unknown",
      costAgentId: null,
    });
    expect(classifyPtySessionId("agent-")).toEqual({
      kind: "unknown",
      costAgentId: null,
    });
  });

  it("isOrchestratorAgentId 가 오케/워커 축을 가른다", () => {
    expect(isOrchestratorAgentId("orchestrator-proj1")).toBe(true);
    expect(isOrchestratorAgentId("orchestrator-mission-proj1")).toBe(true);
    expect(isOrchestratorAgentId("abc123")).toBe(false);
    expect(isOrchestratorAgentId(null)).toBe(false);
  });
});

describe("planOrchestratorCostTracking — 오케 세션이 비용 추적에 잡힌다", () => {
  it("★claude 오케: 세션 id 가 확정되면 그 파일로 추적한다 (이 티켓의 본론)", () => {
    const plan = planOrchestratorCostTracking(startEvent(), isCliHomeTracked);
    expect(plan).toEqual({
      action: "track",
      costAgentId: "orchestrator-proj1",
      rootPath: "/repo",
      sessionId: "11111111-2222-3333-4444-555555555555",
      model: "claude",
    });
  });

  it("★claude 오케: 세션 id 를 모르면 추적하지 않는다 — 오귀속 금지선", () => {
    // 이 분기를 track 으로 바꾸면 cost-tracker 가 "프로젝트 폴더에서 제일 최근
    // JSONL" 을 집는다. 그것이 2026-06 오귀속의 정확한 메커니즘이다.
    const plan = planOrchestratorCostTracking(
      startEvent({ claudeSessionId: null }),
      isCliHomeTracked
    );
    expect(plan).toEqual({
      action: "skip",
      costAgentId: "orchestrator-proj1",
      reason: "session-id-pending",
    });
  });

  it("격리 홈 하네스(codex/gpt·grok)는 세션 id 없이도 자기 홈만 보므로 바로 추적한다", () => {
    for (const model of ["gpt", "grok"]) {
      expect(
        planOrchestratorCostTracking(
          startEvent({ model, claudeSessionId: null }),
          isCliHomeTracked
        )
      ).toEqual({
        action: "track",
        costAgentId: "orchestrator-proj1",
        rootPath: "/repo",
        sessionId: null,
        model,
      });
    }
  });

  it("미션 오케도 자기 id 로 추적된다 (board 와 축이 섞이지 않는다)", () => {
    const costAgentId = orchestratorCostAgentId("mission", "proj1");
    const plan = planOrchestratorCostTracking(
      startEvent({ costAgentId }),
      isCliHomeTracked
    );
    expect(plan).toMatchObject({ action: "track", costAgentId });
  });

  it("하네스를 모르면 추적하지 않고 사유를 남긴다", () => {
    expect(
      planOrchestratorCostTracking(
        startEvent({ model: null }),
        isCliHomeTracked
      )
    ).toEqual({
      action: "skip",
      costAgentId: "orchestrator-proj1",
      reason: "unknown-harness",
    });
  });

  it("사용량 출처가 없는 하네스는 0 이 아니라 명시적 skip 사유로 남는다", () => {
    expect(
      planOrchestratorCostTracking(
        startEvent({ model: "antigravity" }),
        isCliHomeTracked
      )
    ).toEqual({
      action: "skip",
      costAgentId: "orchestrator-proj1",
      reason: "no-usage-source",
    });
  });

  it("세션이 끝나면 폴러를 놓아준다", () => {
    expect(
      planOrchestratorCostTracking(
        startEvent({ phase: "stop" }),
        isCliHomeTracked
      )
    ).toEqual({ action: "stop", costAgentId: "orchestrator-proj1" });
  });
});

describe("★배선 가드 — 로직이 살아있어도 배선이 빠지면 다시 0 이 된다", () => {
  it("main.ts 가 만드는 모든 OrchestratorManager 에 비용 관측자가 붙는다", () => {
    const main = readElectron("main.ts");
    const constructed = (main.match(/new OrchestratorManager\(/g) ?? []).length;
    const wired = (main.match(/setCostSessionHandler\(/g) ?? []).length;
    expect(constructed).toBeGreaterThan(0);
    expect(wired).toBe(constructed);
  });

  it("orchestrator-manager 가 launch·세션id확정·exit 세 초크포인트에서 발화한다", () => {
    const om = readElectron("orchestrator-manager.ts");
    // 정의 1회 + 발화 3회.
    const emits = (om.match(/this\.emitCostSession\(/g) ?? []).length;
    expect(emits).toBeGreaterThanOrEqual(3);
    expect(om).toContain("setCostSessionHandler");
  });

  it("PTY 훅이 인라인 접두사 비교로 되돌아가지 않았다", () => {
    const main = readElectron("main.ts");
    // 주석은 뺀다 — 이 파일 자신이 "종전엔 이랬다" 를 주석으로 남기고 있다.
    const code = main
      .split("\n")
      .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
      .join("\n");
    expect(code).not.toContain('sid.startsWith("agent-")');
    expect(code).toContain("classifyPtySessionId(sid)");
  });

  it("오케 비용 행의 projectId 해석 경로가 살아있다", () => {
    // 오케는 agent-manager 에 없어서 getAgent() 가 undefined 다. 이 맵이 빠지면
    // 수집은 되는데 테넌트 축이 통째로 비는 절반짜리 상태가 된다.
    const main = readElectron("main.ts");
    expect(main).toContain("orchestratorCostProjects.get(agentId)");
    expect(main).toContain("orchestratorCostProjects.set(");
  });
});

describe("★end-to-end — 오케 agentId 로 비용이 실제로 나간다", () => {
  // 완료 기준의 "오케 비용이 다시 잡힌다" 를 순수 로직이 아니라 **파이프 끝**에서
  // 확인한다: 계획이 시키는 그대로 CostTracker 를 몰아, 오케 id 로 델타가 나오는지.
  // ~/.claude/projects/<encoded> 아래에 임시 세션 파일을 만들고 끝나면 지운다.

  const turn = (model: string, input: number, output: number): string =>
    JSON.stringify({
      type: "assistant",
      message: {
        model,
        usage: {
          input_tokens: input,
          output_tokens: output,
          cache_read_input_tokens: 0,
          cache_creation_input_tokens: 0,
        },
      },
    });

  it("planOrchestratorCostTracking 이 시킨 그대로 등록하면 오케 델타가 emit 된다", async () => {
    const { CostTracker, __setWatermarkPathForTest } = await import(
      "../../electron/cost-tracker"
    );
    const { encodeClaudeProjectDir } = await import(
      "../../electron/claude-paths"
    );
    const os = await import("os");

    const wmDir = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-orch-wm-"));
    __setWatermarkPathForTest(path.join(wmDir, "cost-watermarks.json"));

    const rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "marblo-orch-root-"));
    const projectDir = path.join(
      os.homedir(),
      ".claude",
      "projects",
      encodeClaudeProjectDir(rootPath),
    );
    const sessionId = "0000aaaa-1111-2222-3333-444455556666";
    fs.mkdirSync(projectDir, { recursive: true });
    fs.writeFileSync(
      path.join(projectDir, `${sessionId}.jsonl`),
      turn("claude-opus-5", 1_000, 500) + "\n",
    );

    const emitted: Array<{ agentId: string; deltaCost: number }> = [];
    const tracker = new CostTracker((agentId, cost) =>
      emitted.push({ agentId, deltaCost: cost.deltaCost }),
    );
    // 계정 전역 rate-limit 프로브가 실제 CLI 를 때리지 않게 죽인다.
    (
      tracker as unknown as { ensureClaudeProbe: () => void }
    ).ensureClaudeProbe = () => {};

    try {
      const costAgentId = orchestratorCostAgentId("board", "proj-e2e");
      const plan = planOrchestratorCostTracking(
        {
          phase: "start",
          costAgentId,
          rootPath,
          projectId: "proj-e2e",
          model: "claude",
          claudeSessionId: sessionId,
        },
        isCliHomeTracked,
      );
      expect(plan.action).toBe("track");
      if (plan.action !== "track") return;

      tracker.trackSession(
        plan.costAgentId,
        plan.rootPath,
        plan.sessionId,
        plan.model,
      );

      // ★핵심 단언: 오케 id 로 비용이 나갔다. 2026-06-22 이후 0행이던 축이다.
      expect(emitted.length).toBeGreaterThan(0);
      expect(emitted[0].agentId).toBe("orchestrator-proj-e2e");
      expect(isOrchestratorAgentId(emitted[0].agentId)).toBe(true);
      expect(emitted[0].deltaCost).toBeGreaterThan(0);

      // stop 계획은 폴러를 정말 놓아준다(프로세스에 타이머를 남기지 않는다).
      tracker.stopSession(costAgentId);
      const sessions = (
        tracker as unknown as { sessions: Map<string, unknown> }
      ).sessions;
      expect(sessions.has(costAgentId)).toBe(false);
    } finally {
      tracker.clearAll();
      __setWatermarkPathForTest(null);
      fs.rmSync(projectDir, { recursive: true, force: true });
      fs.rmSync(rootPath, { recursive: true, force: true });
      fs.rmSync(wmDir, { recursive: true, force: true });
    }
  });
});
