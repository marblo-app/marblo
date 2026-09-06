import { describe, expect, it } from "vitest";
import {
  claudeSessionArgs,
  grokSessionArgs,
  harnessForLaunch,
} from "../../electron/agent-config";
import { MODEL_REGISTRY } from "../../electron/model-registry";
import { parseModelSpec } from "../../electron/model-selection";

function row(id: string) {
  const found = MODEL_REGISTRY.find((entry) => entry.id === id);
  expect(found, `missing registry row for ${id}`).toBeTruthy();
  return found!;
}

describe("agent reconnect harness axis", () => {
  it("folds boss-requested vendors to the harness that actually owns resume", () => {
    expect(row("glm-5.2").harness).toBe("claude");
    expect(row("MiniMax-M3").harness).toBe("claude");
    expect(row("k3").harness).toBe("claude");
    expect(row("solar-pro4").harness).toBe("gpt");
    expect(row("deepseek-v4-flash").harness).toBe("gpt");

    expect(parseModelSpec("glm")?.harness).toBe("claude");
    expect(parseModelSpec("minimax")?.harness).toBe("claude");
    expect(parseModelSpec("kimi")?.harness).toBe("claude");
    expect(parseModelSpec("solar")?.harness).toBe("gpt");
    expect(parseModelSpec("deepseek")?.harness).toBe("gpt");
  });

  it("uses the pinned model row, not the vendor name, to choose the launch binary", () => {
    expect(harnessForLaunch("claude", "glm-5.2")).toBe("claude");
    expect(harnessForLaunch("claude", "MiniMax-M3")).toBe("claude");
    expect(harnessForLaunch("claude", "k3")).toBe("claude");
    expect(harnessForLaunch("gpt", "solar-pro4")).toBe("gpt");
    expect(harnessForLaunch("gpt", "deepseek-v4-flash")).toBe("gpt");
  });

  it("keeps Claude latest unresolved while Codex/Grok own latest through their isolated homes", () => {
    expect(claudeSessionArgs("latest", "new-id", true)).toEqual({
      args: [],
      sessionId: undefined,
    });
    expect(grokSessionArgs("latest", "new-id")).toEqual({
      args: ["--continue"],
      sessionId: undefined,
    });
  });
});
