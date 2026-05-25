import { describe, expect, it } from "vitest";
import {
  inferLabelForAgent,
  inferStatusLabel,
  lastInformativeLine,
  summarizeActivity,
} from "../../src/lib/statusInfer";

describe("summarizeActivity", () => {
  it("returns first line trimmed", () => {
    expect(summarizeActivity("editing X.tsx\nmore detail")).toBe(
      "editing X.tsx",
    );
  });

  it("truncates over 60 chars", () => {
    const long = "a".repeat(80);
    expect(summarizeActivity(long)).toHaveLength(60);
    expect(summarizeActivity(long).endsWith("…")).toBe(true);
  });

  it("returns empty for empty input", () => {
    expect(summarizeActivity("")).toBe("");
  });
});

describe("lastInformativeLine", () => {
  it("returns last non-empty non-prompt line", () => {
    expect(lastInformativeLine(["foo", "bar", "$ "])).toBe("bar");
  });

  it("skips empty trailing lines", () => {
    expect(lastInformativeLine(["meaningful", "", "  "])).toBe("meaningful");
  });

  it("returns empty for empty buffer", () => {
    expect(lastInformativeLine([])).toBe("");
    expect(lastInformativeLine(undefined)).toBe("");
  });

  it("strips ANSI before evaluating", () => {
    expect(lastInformativeLine(["\x1b[31mrunning tests\x1b[0m"])).toBe(
      "running tests",
    );
  });
});

describe("inferStatusLabel", () => {
  it("error status wins over everything", () => {
    expect(
      inferStatusLabel({
        status: "error",
        lastActivityMessage: "doing work",
        recentLines: ["last line"],
      }),
    ).toBe("Error");
  });

  it("stopped status wins next", () => {
    expect(inferStatusLabel({ status: "stopped" })).toBe("Stopped");
  });

  it("activity message wins over PTY tail when both present (Claude path)", () => {
    expect(
      inferStatusLabel({
        status: "working",
        lastActivityMessage: "editing ansi.ts",
        recentLines: ["$ ", "some terminal output"],
      }),
    ).toBe("editing ansi.ts");
  });

  it("falls back to PTY last informative line (Codex/Gemini path)", () => {
    expect(
      inferStatusLabel({
        status: "working",
        recentLines: ["compiling…", "$ "],
      }),
    ).toBe("compiling…");
  });

  it("defaults to Working… when working with no signal", () => {
    expect(inferStatusLabel({ status: "working" })).toBe("Working…");
  });

  it("defaults to Idle when idle with no signal", () => {
    expect(inferStatusLabel({ status: "idle" })).toBe("Idle");
  });
});

describe("inferLabelForAgent (smoke)", () => {
  it("Claude with activity message", () => {
    expect(
      inferLabelForAgent(
        { status: "working", model: "claude" },
        {
          lastActivityMessage: "T4 구현 완료",
          recentLines: [],
        },
      ),
    ).toBe("T4 구현 완료");
  });

  it("Codex fallback to PTY tail", () => {
    expect(
      inferLabelForAgent(
        { status: "working", model: "gpt" },
        { recentLines: ["running cargo test"] },
      ),
    ).toBe("running cargo test");
  });

  it("Gemini fallback to PTY tail", () => {
    expect(
      inferLabelForAgent(
        { status: "working", model: "gemini" },
        { recentLines: ["fetching files…"] },
      ),
    ).toBe("fetching files…");
  });
});
