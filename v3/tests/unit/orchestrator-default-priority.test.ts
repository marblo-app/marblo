/**
 * 오케 기본 모델 자동선택 우선순위 — Claude > Codex > Grok
 * (티켓 mwYD1YxEc9aARgmZ4bX7).
 *
 * 사용자가 settings.orchestratorModel 을 명시하지 않았을 때만 쓰이는 순수
 * 함수. env-swap 벤더는 후보가 아니다.
 */
import { describe, it, expect } from "vitest";
import {
  pickPreferredOrchestratorHarness,
  ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY,
} from "../../electron/model-selection";
import { ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY as STORE_PRIORITY } from "../../src/stores/orchestratorStore";

describe("ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY", () => {
  it("Claude > Codex > Grok 순서다", () => {
    expect([...ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY]).toEqual([
      "claude",
      "codex",
      "grok",
    ]);
  });

  it("renderer store 미러와 원소·순서가 같다 (드리프트 방지)", () => {
    expect([...STORE_PRIORITY]).toEqual([
      ...ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY,
    ]);
  });
});

describe("pickPreferredOrchestratorHarness", () => {
  it("세 하네스 모두 연결 → Claude", () => {
    expect(
      pickPreferredOrchestratorHarness(["grok", "codex", "claude"]),
    ).toBe("claude");
  });

  it("Claude 없고 Codex+Grok → Codex", () => {
    expect(pickPreferredOrchestratorHarness(["grok", "codex"])).toBe("codex");
  });

  it("Grok 만 → Grok", () => {
    expect(pickPreferredOrchestratorHarness(["grok"])).toBe("grok");
  });

  it("내부 ModelType gpt 를 codex 로 정규화한다", () => {
    expect(pickPreferredOrchestratorHarness(["gpt", "grok"])).toBe("codex");
  });

  it("env-swap 벤더 이름은 무시한다 (오케 후보 아님)", () => {
    expect(
      pickPreferredOrchestratorHarness(["zai", "minimax", "moonshot", "grok"]),
    ).toBe("grok");
    expect(pickPreferredOrchestratorHarness(["zai", "minimax"])).toBeNull();
  });

  it("빈 입력 → null (호출부가 hard default claude)", () => {
    expect(pickPreferredOrchestratorHarness([])).toBeNull();
  });

  it("antigravity 는 자동 기본 우선순위에 없다", () => {
    expect(pickPreferredOrchestratorHarness(["antigravity"])).toBeNull();
    expect(
      pickPreferredOrchestratorHarness(["antigravity", "codex"]),
    ).toBe("codex");
  });
});
