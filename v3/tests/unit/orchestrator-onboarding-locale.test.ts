import { describe, expect, it } from "vitest";
import {
  buildBoardOrchestratorOnboarding,
  selectBoardOrchestratorOpeningLine,
} from "../../electron/orchestrator-manager";

describe("board orchestrator onboarding locale", () => {
  it("selects the Korean opening line for ko", () => {
    expect(selectBoardOrchestratorOpeningLine("ko")).toBe(
      "작업 요청하시면 보드에 티켓 생성하고 에이전트 스폰해드릴게요.",
    );
  });

  it("selects the English opening line for en", () => {
    expect(selectBoardOrchestratorOpeningLine("en")).toBe(
      "When you request work, I'll create tickets on the board and spawn agents for you.",
    );
  });

  it("falls back to English for unknown or missing locales", () => {
    expect(selectBoardOrchestratorOpeningLine("ja")).toBe(
      selectBoardOrchestratorOpeningLine("en"),
    );
    expect(selectBoardOrchestratorOpeningLine(undefined)).toBe(
      selectBoardOrchestratorOpeningLine("en"),
    );
  });

  it("keeps the instruction text English while localizing only the opening message", () => {
    const prompt = buildBoardOrchestratorOnboarding("en");

    expect(prompt).toContain(
      "greet the user first in the same language as this localized opening message",
    );
    expect(prompt).toContain(selectBoardOrchestratorOpeningLine("en"));
    expect(prompt).not.toContain(selectBoardOrchestratorOpeningLine("ko"));
  });
});
