/**
 * 스폰 차단 분류 ↔ 메인 프로세스 표식의 **단일소스 게이트**.
 *
 * 렌더러(`src/lib/orchestratorLaunchBlock.ts`)와 메인(`electron/orchestrator-
 * switch.ts`)은 서로 import 하지 않는다(repo 경계 규약). 그래서 표식 문자열은
 * 미러이고, 벌어지면 여기서 깨진다 — 테스트는 두 경계를 다 import 할 수 있다.
 *
 * 이 파일이 깨졌다면 고칠 곳은 테스트가 아니라 미러 상수다.
 */
import { describe, it, expect } from "vitest";
import {
  ORCHESTRATOR_BLOCK_REASON_MCP as RENDERER_MCP_REASON,
  classifyOrchestratorBlock,
} from "../../src/lib/orchestratorLaunchBlock";
import { ORCHESTRATOR_BLOCK_REASON_MCP as MAIN_MCP_REASON } from "../../electron/orchestrator-switch";

describe("오케 스폰 차단 분류", () => {
  it("★표식 문자열이 main 과 정확히 같다", () => {
    expect(RENDERER_MCP_REASON).toBe(MAIN_MCP_REASON);
  });

  it("MCP 게이트 차단은 위저드를 열지 않는다 — 패널이 직접 설명한다", () => {
    const block = classifyOrchestratorBlock({
      model: "grok",
      action: "grok 오케 차단 — 폴더 신뢰가 없습니다.",
      installed: true,
      reason: MAIN_MCP_REASON,
    });
    expect(block.kind).toBe("mcp");
    expect(block.opensCliSetup).toBe(false);
    // 조치 문구는 main 이 준 값 그대로 흘린다(우리가 지어내지 않는다).
    expect(block.action).toContain("폴더 신뢰");
    expect(block.model).toBe("grok");
  });

  it("인증 차단은 종전대로 위저드가 받는다", () => {
    const block = classifyOrchestratorBlock({
      model: "claude",
      action: "claude login",
      installed: true,
      reason: "not-authenticated",
    });
    expect(block.kind).toBe("auth");
    expect(block.opensCliSetup).toBe(true);
  });

  it("★표식이 없으면 인증으로 읽는다 — 구버전 main 하위호환", () => {
    // 패키지된 옛 main 은 reason 을 안 보낸다. 그 경로의 동작이 한 글자도
    // 바뀌면 안 된다(설치/로그인 차단이 위저드로 안 가면 화면이 죽는다).
    const block = classifyOrchestratorBlock({
      model: "codex",
      action: "codex login",
      installed: false,
    });
    expect(block.kind).toBe("auth");
    expect(block.opensCliSetup).toBe(true);
  });

  it("모르는 reason 도 인증으로 떨어진다(안전한 기본값)", () => {
    const block = classifyOrchestratorBlock({
      model: "claude",
      action: "무언가",
      installed: true,
      reason: "future-reason-we-do-not-know",
    });
    expect(block.opensCliSetup).toBe(true);
  });
});
