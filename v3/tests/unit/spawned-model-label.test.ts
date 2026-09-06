import { describe, expect, it } from "vitest";
import {
  agentModelDisplayLabel,
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../src/lib/spawnedModelLabel";

describe("spawned model display labels", () => {
  it("keeps missing spawnedModel as null so callers do not invent a model", () => {
    expect(spawnedModelLabel(undefined)).toBeNull();
    expect(spawnedModelLabel("   ")).toBeNull();
  });

  it("shows observed billing model before spawned argv, then harness fallback", () => {
    expect(
      agentModelDisplayLabel({
        model: "gpt",
        spawnedModel: "solar-pro4@high",
        detectedModelId: "solar-pro4",
      }),
    ).toBe("solar-pro4");
    expect(
      agentModelDisplayLabel({
        model: "gpt",
        spawnedModel: "solar-pro4@high",
      }),
    ).toBe("solar-pro4@high");
    expect(agentModelDisplayLabel({ model: "gpt" })).toBe("gpt");
  });

  it("puts the concrete model first when a narrow badge exposes the harness in title", () => {
    expect(spawnedModelTitle("solar-pro4@high", "gpt")).toBe(
      "solar-pro4@high · gpt",
    );
    expect(spawnedModelTitle("gpt", "gpt")).toBe("gpt");
  });
});
