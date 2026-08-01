import { describe, expect, it } from "vitest";
import { probeGrokUsage } from "../../electron/grok-usage-probe";

describe("probeGrokUsage", () => {
  it("returns null while Grok Build exposes no account quota command", async () => {
    await expect(probeGrokUsage()).resolves.toBeNull();
  });
});
