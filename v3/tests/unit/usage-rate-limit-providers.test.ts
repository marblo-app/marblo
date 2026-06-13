import { describe, expect, it } from "vitest";
import { getRateLimitProviderModels } from "../../src/components/usage/rateLimitProviders";
import type { Agent } from "../../src/types/agent";

describe("getRateLimitProviderModels", () => {
  it("keeps connected Codex visible when no Codex agent was used", () => {
    const agents: Pick<Agent, "model">[] = [{ model: "claude" }];

    expect(getRateLimitProviderModels(agents, ["claude", "gpt"])).toEqual([
      "claude",
      "gpt",
    ]);
  });

  it("preserves in-use providers that are not in the connected rate-limit list", () => {
    const agents: Pick<Agent, "model">[] = [{ model: "antigravity" }];

    expect(getRateLimitProviderModels(agents, ["gpt"])).toEqual([
      "gpt",
      "antigravity",
    ]);
  });
});
