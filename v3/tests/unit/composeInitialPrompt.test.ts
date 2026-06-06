import { describe, it, expect } from "vitest";
import {
  composeInitialPrompt,
  STARTUP_DIALOG_MATCHERS,
} from "../../electron/agent-manager";

const SKILL = [
  "You are the backend agent.",
  "1. Call mcp__marblo__get_agent_skill('backend')",
  "2. Call mcp__marblo__claim_task(...)",
].join("\n");

describe("composeInitialPrompt", () => {
  it("claude: prepends skill block + keeps mcp__marblo__ prefix in instruction", () => {
    const out = composeInitialPrompt(
      "claude",
      "Use mcp__marblo__claim_task to grab it.",
      SKILL,
    );
    expect(out).toContain(
      "[역할 스킬 — 아래 워크플로우와 도구 사용 규칙을 따르세요]",
    );
    expect(out).toContain("[작업 지시]");
    // Claude keeps the MCP prefix in the instruction (claude-cli expects
    // mcp__server__tool naming convention).
    expect(out).toContain("Use mcp__marblo__claim_task to grab it.");
  });

  it("gemini: prepends skill block + strips mcp__marblo__ prefix from instruction", () => {
    const out = composeInitialPrompt(
      "gemini",
      "Call mcp__marblo__claim_task('abc').",
      SKILL,
    );
    expect(out).toContain(
      "[역할 스킬 — 아래 워크플로우와 도구 사용 규칙을 따르세요]",
    );
    expect(out).toContain("[작업 지시]");
    expect(out).toContain("Call claim_task('abc').");
    // Known limitation: skill content is NOT sanitized — instruction-only
    // regex. Documenting as test expectation so a future broader fix has
    // to update this assertion intentionally.
    expect(out).toContain("mcp__marblo__get_agent_skill");
  });

  it("gpt (codex): prepends skill block, MCP prefix stripped from instruction", () => {
    const out = composeInitialPrompt(
      "gpt",
      "Submit via mcp__marblo__submit_for_review.",
      SKILL,
    );
    expect(out).toContain("[역할 스킬");
    expect(out).toContain("Submit via submit_for_review.");
  });

  it("antigravity: prepends role skill (agy v1.20+ has MCP via global mcp_config.json)", () => {
    const out = composeInitialPrompt(
      "antigravity",
      "Summarize the README.",
      SKILL,
    );
    expect(out).toContain("[역할 스킬");
    expect(out).toContain("[작업 지시]");
    expect(out).toContain("Summarize the README.");
    // Skill content (which includes the MCP prefix names) is still passed
    // through verbatim — sanitize is instruction-only.
    expect(out).toContain("get_agent_skill");
  });

  it("antigravity: strips mcp__marblo__ prefix from instruction (gemini-style bare names)", () => {
    const out = composeInitialPrompt(
      "antigravity",
      "Call mcp__marblo__get_task and tell me what it returns.",
      SKILL,
    );
    expect(out).toContain("Call get_task and tell me what it returns.");
    expect(out).not.toContain("Call mcp__marblo__get_task");
  });

  it("no skill content: returns sanitized instruction for all non-claude vendors", () => {
    for (const model of ["gemini", "gpt", "antigravity"] as const) {
      const out = composeInitialPrompt(
        model,
        "do mcp__marblo__work",
        undefined,
      );
      expect(out).toBe("do work");
    }
  });
});

describe("STARTUP_DIALOG_MATCHERS", () => {
  it("includes codex update-available matcher targeting gpt only", () => {
    const m = STARTUP_DIALOG_MATCHERS.find(
      (x) => x.label === "codex update-available",
    );
    expect(m).toBeDefined();
    expect(m!.applies).toEqual(["gpt"]);
    expect(
      m!.pattern.test("✨ Update available! Skip until next version"),
    ).toBe(true);
  });

  it("includes antigravity trust-folder matcher targeting antigravity only", () => {
    const m = STARTUP_DIALOG_MATCHERS.find(
      (x) => x.label === "antigravity trust-folder",
    );
    expect(m).toBeDefined();
    expect(m!.applies).toEqual(["antigravity"]);
    expect(m!.keys).toBe("\r"); // default highlight is "Yes, I trust this folder"
    expect(m!.pattern.test("Do you trust the contents of this project?")).toBe(
      true,
    );
  });

  it("trust-folder matcher does not false-fire on chat content about trust", () => {
    const m = STARTUP_DIALOG_MATCHERS.find(
      (x) => x.label === "antigravity trust-folder",
    )!;
    // Generic discussions of trust should not match
    expect(m.pattern.test("I trust this folder structure")).toBe(false);
    expect(m.pattern.test("trust the contents")).toBe(false);
    // Only the exact dialog phrasing
    expect(m.pattern.test("Do you trust the contents of this project?")).toBe(
      true,
    );
  });
});
