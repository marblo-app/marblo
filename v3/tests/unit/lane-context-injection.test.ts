/**
 * 레인 에이전트 MARBLO_CONTEXT 주입 검증 (#71 isolate-lane-agent-context 회귀가드).
 *
 * 레인 launch 는 lane:<taskId> 컨텍스트를 AgentConfigGenerator 까지 전달하고
 * (main.ts resolveLaneLaunchContext → AgentManager.launch → getLaunchConfig 의
 * marbloContextId 인자), 그 값이
 *   (1) PTY env (LaunchConfig.env) — agent-manager 가 process.env 와 머지해 주입
 *   (2) 모델별 MCP config 파일의 marblo 서버 env
 * 양쪽에 MARBLO_CONTEXT 로 박혀야 MCP 서버(mcp-server/context.ts resolveContext)
 * 가 레인 스코프로 동작한다. contextId 미지정(보드 워커/오케 경로)이면 키 자체가
 * 없어야 한다(unscoped 무회귀).
 */
import fs from "fs";
import { describe, expect, it } from "vitest";
import { AgentConfigGenerator } from "../../electron/agent-config";
import { buildLaneContextId } from "../../electron/mcp-server/context";

describe("lane MARBLO_CONTEXT injection", () => {
  it("injects MARBLO_CONTEXT into PTY env and claude MCP config for lane launches", () => {
    const agentId = `test-lane-ctx-${Date.now()}`;
    const generator = new AgentConfigGenerator();
    const laneContext = buildLaneContextId("lane-task-1");

    try {
      // getLaunchConfig 의 9번째 위치 인자가 marbloContextId (#71).
      const cfg = generator.getLaunchConfig(
        { id: agentId, model: "claude", role: "backend", command: "claude" },
        process.cwd(),
        "빠른 개선 작업입니다",
        "marblo-test-project",
        undefined, // resumeSessionId
        true, // pinClaudeSession
        undefined, // complexity
        undefined, // claudeModelOverride
        laneContext, // marbloContextId
      );

      // (1) PTY env — agent-manager 가 process.env 와 머지해 PTY 에 주입한다.
      expect(cfg.env.MARBLO_CONTEXT).toBe("lane:lane-task-1");

      // (2) MCP config 파일 — MCP 서버 자식 프로세스의 env.
      const config = JSON.parse(fs.readFileSync(cfg.mcpConfigPath, "utf-8"));
      expect(config.mcpServers.marblo.env.MARBLO_CONTEXT).toBe(
        "lane:lane-task-1",
      );
    } finally {
      generator.cleanup(agentId);
    }
  });

  it("omits MARBLO_CONTEXT entirely when contextId is not given (unscoped 무회귀)", () => {
    const agentId = `test-noctx-${Date.now()}`;
    const generator = new AgentConfigGenerator();

    try {
      const cfg = generator.getLaunchConfig(
        { id: agentId, model: "claude", role: "backend", command: "claude" },
        process.cwd(),
        "work on the task",
        "marblo-test-project",
      );

      expect(cfg.env.MARBLO_CONTEXT).toBeUndefined();
      const config = JSON.parse(fs.readFileSync(cfg.mcpConfigPath, "utf-8"));
      expect(config.mcpServers.marblo.env.MARBLO_CONTEXT).toBeUndefined();
    } finally {
      generator.cleanup(agentId);
    }
  });
});
