import { describe, it, expect } from "vitest";
import { encodeClaudeProjectDir } from "../../electron/claude-paths";

/**
 * Regression: Claude Code names its ~/.claude/projects/<dir> by replacing
 * EVERY non-alphanumeric char with "-". The old encoding swapped only "/",
 * so projects with "_"/"."/space pointed at a nonexistent dir and all Claude
 * session lookups (resume/reconnect/labels/cost) silently failed.
 */
describe("encodeClaudeProjectDir", () => {
  it("matches Claude's encoding for an underscore+subdir path (the real bug)", () => {
    expect(
      encodeClaudeProjectDir(
        "/Users/dongwonkim/Documents/programming/hankang_prj/temu_to_coupang",
      ),
    ).toBe(
      "-Users-dongwonkim-Documents-programming-hankang-prj-temu-to-coupang",
    );
  });

  it("is unchanged for a plain slash-only path (no regression)", () => {
    expect(
      encodeClaudeProjectDir("/Users/dongwonkim/Documents/programming/marblo"),
    ).toBe("-Users-dongwonkim-Documents-programming-marblo");
  });

  it("replaces dots and spaces too", () => {
    expect(encodeClaudeProjectDir("/a/b.c/d e")).toBe("-a-b-c-d-e");
  });

  it("preserves existing dashes and digits", () => {
    expect(encodeClaudeProjectDir("/proj-2/v3")).toBe("-proj-2-v3");
  });
});
