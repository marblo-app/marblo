import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("agent fleet tab scope wiring", () => {
  it("keeps Marblo Bots bot-scoped and restores a separate all-fleet surface", () => {
    const source = readFileSync(
      new URL("../../src/components/tabs/AgentsTab.tsx", import.meta.url),
      "utf8",
    );

    expect(source).toContain('export function AgentsTab()');
    expect(source).toContain('<AgentsTabSurface mode="marbloBots" />');
    expect(source).toContain('export function AgentFleetTab()');
    expect(source).toContain('<AgentsTabSurface mode="fleet" />');
    expect(source).toContain('mode === "fleet"');
    expect(source).toContain('scope="all"');
    expect(source).toContain('scope="bot"');
  });
});
