import { describe, expect, it } from "vitest";
import { isPathUnderNpmPrefix } from "../../electron/harness-manager";

describe("isPathUnderNpmPrefix", () => {
  it("treats a binary inside the npm prefix as npm-managed", () => {
    // npm `claude` symlink resolves into the global node_modules.
    expect(
      isPathUnderNpmPrefix(
        "/opt/homebrew/lib/node_modules/@anthropic-ai/claude-code/cli.js",
        "/opt/homebrew",
      ),
    ).toBe(true);
  });

  it("treats the npm bin dir itself as npm-managed", () => {
    expect(
      isPathUnderNpmPrefix("/opt/homebrew/bin/codex", "/opt/homebrew"),
    ).toBe(true);
  });

  it("treats a native install (~/.local/share) as NOT npm-managed", () => {
    // Claude Code native install — the real cause of the bug.
    expect(
      isPathUnderNpmPrefix(
        "/Users/me/.local/share/claude/versions/2.1.163",
        "/opt/homebrew",
      ),
    ).toBe(false);
  });

  it("does not match on a shared path prefix that isn't a real parent", () => {
    // "/opt/homebrew-extra" must not count as under "/opt/homebrew".
    expect(
      isPathUnderNpmPrefix("/opt/homebrew-extra/bin/claude", "/opt/homebrew"),
    ).toBe(false);
  });

  it("returns true when prefix equals the path (edge)", () => {
    expect(isPathUnderNpmPrefix("/opt/homebrew", "/opt/homebrew/")).toBe(true);
  });

  it("returns false on empty inputs", () => {
    expect(isPathUnderNpmPrefix("", "/opt/homebrew")).toBe(false);
    expect(isPathUnderNpmPrefix("/opt/homebrew/bin/claude", "")).toBe(false);
  });
});
