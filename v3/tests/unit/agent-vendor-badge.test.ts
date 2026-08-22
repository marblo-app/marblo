/**
 * 에이전트 탭 배지가 env-swap 벤더(GLM/MiniMax/DeepSeek/...)를 harness 네이티브
 * (claude/codex/grok)와 구분해서 보여주는지.
 *
 * 배경: env-swap 벤더는 자기 CLI 가 없다 — `claude`/`gpt` 하네스를 그대로 스폰하고
 * env 만 갈아끼워 다른 백엔드로 붙는다. 그래서 `Agent.model`(하네스)만 보면 전부
 * "claude" 로 보였다. `resolveAgentVendorKind` 는 `spawnedModel`(스폰 argv 를
 * 되읽어 스탬프한 실제 모델 id)을 레지스트리에 되물어 진짜 벤더를 가려낸다.
 */
import { describe, it, expect } from "vitest";
import { resolveAgentVendorKind } from "../../src/lib/agentVendorBadge";

describe("resolveAgentVendorKind", () => {
  it("★완료기준: GLM(zai) 스폰은 claude 하네스가 아니라 'zai' 배지로 뜬다", () => {
    expect(resolveAgentVendorKind("claude", "glm-5.2")).toBe("zai");
    expect(resolveAgentVendorKind("claude", "glm-4.7")).toBe("zai");
  });

  it("★완료기준: MiniMax 스폰은 'minimax' 배지로 뜬다", () => {
    expect(resolveAgentVendorKind("claude", "MiniMax-M3")).toBe("minimax");
    expect(resolveAgentVendorKind("claude", "MiniMax-M2.7")).toBe("minimax");
  });

  it("★완료기준: DeepSeek 스폰(gpt 하네스를 탄다)은 'deepseek' 배지로 뜬다", () => {
    expect(resolveAgentVendorKind("gpt", "deepseek-v4-flash")).toBe("deepseek");
    expect(resolveAgentVendorKind("gpt", "deepseek-v4-pro")).toBe("deepseek");
  });

  it("Kimi(moonshot)·Upstage(upstage) 도 env-swap 벤더로 구분된다", () => {
    expect(resolveAgentVendorKind("claude", "kimi-for-coding")).toBe(
      "moonshot",
    );
    expect(resolveAgentVendorKind("gpt", "solar-pro4")).toBe("upstage");
  });

  it("하네스 네이티브(claude/codex/grok)는 종전대로 harness 로 뜬다", () => {
    expect(resolveAgentVendorKind("claude", "claude-fable-5")).toBe("claude");
    expect(resolveAgentVendorKind("gpt", "gpt-5.6-sol@high")).toBe("gpt");
    expect(resolveAgentVendorKind("grok", undefined)).toBe("grok");
    expect(resolveAgentVendorKind("gemini", undefined)).toBe("gemini");
    expect(resolveAgentVendorKind("antigravity", undefined)).toBe(
      "antigravity",
    );
  });

  it("모델을 핀하지 않은 launch(spawnedModel 없음)는 harness 로 fallback", () => {
    expect(resolveAgentVendorKind("claude", undefined)).toBe("claude");
    expect(resolveAgentVendorKind("claude", null)).toBe("claude");
    expect(resolveAgentVendorKind("claude", "")).toBe("claude");
    expect(resolveAgentVendorKind("claude", "   ")).toBe("claude");
  });

  it("레지스트리가 모르는 spawnedModel 은 harness 로 fallback(값을 지어내지 않는다)", () => {
    expect(resolveAgentVendorKind("claude", "totally-made-up-model")).toBe(
      "claude",
    );
  });

  it("★완료기준: model/spawnedModel 이 둘 다 미상이면 'custom'(빈칸 아님)으로 떨어진다", () => {
    expect(resolveAgentVendorKind(undefined, undefined)).toBe("custom");
    expect(resolveAgentVendorKind(null, null)).toBe("custom");
    expect(resolveAgentVendorKind("", undefined)).toBe("custom");
    expect(resolveAgentVendorKind("some-unregistered-harness", undefined)).toBe(
      "custom",
    );
  });
});
