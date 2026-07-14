import { describe, expect, it } from "vitest";
import {
  formatForModel,
  newParseState,
  parseSessionDelta,
} from "../../electron/session-parsers";

describe("formatForModel", () => {
  it("maps CLI model ids to session formats", () => {
    expect(formatForModel("claude")).toBe("claude");
    expect(formatForModel("gpt")).toBe("codex");
    expect(formatForModel("gemini")).toBe("gemini");
  });

  it("returns null for formats without a JSONL parser", () => {
    expect(formatForModel("antigravity")).toBeNull();
    expect(formatForModel("custom")).toBeNull();
    expect(formatForModel(undefined)).toBeNull();
    expect(formatForModel("")).toBeNull();
  });
});

describe("parseSessionDelta — claude", () => {
  const lines = [
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 100,
          output_tokens: 50,
          cache_read_input_tokens: 10,
          cache_creation_input_tokens: 5,
        },
      },
    }),
    JSON.stringify({ type: "user", message: { content: "hi" } }),
    JSON.stringify({
      type: "assistant",
      message: {
        model: "claude-opus-4-7",
        usage: {
          input_tokens: 200,
          output_tokens: 70,
          cache_read_input_tokens: 20,
          cache_creation_input_tokens: 0,
        },
      },
    }),
  ];

  it("sums usage across new assistant lines", () => {
    const { delta, newState } = parseSessionDelta(
      "claude",
      lines,
      newParseState(),
    );
    expect(delta).toEqual({
      input: 300,
      output: 120,
      cacheRead: 30,
      cacheWrite: 5,
    });
    expect(newState.lastLineCount).toBe(3);
    expect(newState.model).toBe("claude-opus-4-7");
  });

  it("only counts lines past lastLineCount on the next poll", () => {
    const first = parseSessionDelta("claude", lines, newParseState());
    // No new lines → zero delta, state unchanged
    const second = parseSessionDelta("claude", lines, first.newState);
    expect(second.delta).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
    expect(second.newState.lastLineCount).toBe(3);
  });

  it("skips malformed lines without throwing", () => {
    const dirty = ["not json", ...lines, "{bad"];
    const { delta } = parseSessionDelta("claude", dirty, newParseState());
    expect(delta.input).toBe(300);
  });
});

describe("parseSessionDelta — codex (cumulative watermark)", () => {
  const meta = JSON.stringify({
    timestamp: "t",
    type: "session_meta",
    payload: { id: "u", cwd: "/x", model: "gpt-5.5" },
  });
  const tokenCount = (
    input: number,
    cached: number,
    output: number,
    reasoning: number,
  ) =>
    JSON.stringify({
      timestamp: "t",
      type: "event_msg",
      payload: {
        type: "token_count",
        info: {
          total_token_usage: {
            input_tokens: input,
            cached_input_tokens: cached,
            output_tokens: output,
            reasoning_output_tokens: reasoning,
            total_tokens: input + output,
          },
          last_token_usage: {},
          model_context_window: 258400,
        },
        rate_limits: null,
      },
    });
  // info:null variant — rate-limit-only event, must be ignored
  const rateLimitOnly = JSON.stringify({
    type: "event_msg",
    payload: { type: "token_count", info: null, rate_limits: { foo: 1 } },
  });

  it("derives delta from the latest cumulative total, mapping cached/reasoning", () => {
    const lines = [
      meta,
      tokenCount(1000, 800, 40, 10),
      rateLimitOnly,
      tokenCount(1500, 1200, 90, 20),
    ];
    const { delta, newState } = parseSessionDelta(
      "codex",
      lines,
      newParseState(),
    );
    // billable input = input - cached = 1500 - 1200 = 300
    // output = output_tokens (reasoning already included) = 90
    // cacheRead = cached = 1200
    expect(delta).toEqual({
      input: 300,
      output: 90,
      cacheRead: 1200,
      cacheWrite: 0,
    });
    expect(newState.model).toBe("gpt-5.5");
    expect(newState.lastLineCount).toBe(4);
  });

  it("computes incremental delta against the prior cumulative watermark", () => {
    const first = parseSessionDelta(
      "codex",
      [meta, tokenCount(1500, 1200, 90, 20)],
      newParseState(),
    );
    const lines = [
      meta,
      tokenCount(1500, 1200, 90, 20),
      tokenCount(1800, 1400, 120, 25),
    ];
    const second = parseSessionDelta("codex", lines, first.newState);
    // input: (1800-1400) - (1500-1200) = 400 - 300 = 100
    // output: 120 - 90 = 30
    // cacheRead: 1400 - 1200 = 200
    expect(second.delta).toEqual({
      input: 100,
      output: 30,
      cacheRead: 200,
      cacheWrite: 0,
    });
  });

  it("returns zero delta when new lines carry no token usage", () => {
    const first = parseSessionDelta(
      "codex",
      [meta, tokenCount(1000, 800, 40, 10)],
      newParseState(),
    );
    const second = parseSessionDelta(
      "codex",
      [meta, tokenCount(1000, 800, 40, 10), rateLimitOnly],
      first.newState,
    );
    expect(second.delta).toEqual({
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });
  });

  // §Phase1a: 주간(7일/secondary) 윈도우도 캡처돼야 cost-tracker 가
  // rateLimitWeekly* 로 흘려보낸다. primary(5h)와 함께 둘 다 보존되는지 확인.
  it("captures both primary(5h) and secondary(weekly) rate-limit windows", () => {
    const withRl = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
        rate_limits: {
          plan_type: "pro",
          primary: { used_percent: 12, window_minutes: 300, resets_at: 111 },
          secondary: {
            used_percent: 34,
            window_minutes: 10080,
            resets_at: 222,
          },
        },
      },
    });
    const { newState } = parseSessionDelta(
      "codex",
      [meta, withRl],
      newParseState(),
    );
    expect(newState.rateLimit).toMatchObject({
      planType: "pro",
      primaryPercent: 12,
      primaryResetAt: 111,
      primaryWindowDurationMins: 300,
      secondaryPercent: 34,
      secondaryResetAt: 222,
      secondaryWindowDurationMins: 10080,
    });
  });

  it("classifies primary-only weekly rate-limit events by window duration", () => {
    const withRl = JSON.stringify({
      type: "event_msg",
      payload: {
        type: "token_count",
        info: null,
        rate_limits: {
          plan_type: "prolite",
          primary: {
            used_percent: 11,
            window_duration_mins: 10080,
            resets_at: 333,
          },
          secondary: null,
        },
      },
    });
    const { newState } = parseSessionDelta(
      "codex",
      [meta, withRl],
      newParseState(),
    );
    expect(newState.rateLimit).toMatchObject({
      planType: "prolite",
      primaryPercent: null,
      secondaryPercent: 11,
      secondaryResetAt: 333,
      secondaryWindowDurationMins: 10080,
    });
  });
});

describe("parseSessionDelta — gemini", () => {
  const meta = JSON.stringify({
    sessionId: "s",
    projectHash: "h",
    kind: "main",
  });
  const user = JSON.stringify({ id: "1", type: "user", content: "hi" });
  const set = JSON.stringify({ $set: { lastUpdated: "t" } });
  const geminiLine = (
    input: number,
    output: number,
    cached: number,
    thoughts: number,
  ) =>
    JSON.stringify({
      id: "x",
      type: "gemini",
      content: "...",
      thoughts: [],
      tokens: {
        input,
        output,
        cached,
        thoughts,
        tool: 0,
        total: input + output + thoughts,
      },
      model: "gemini-3-flash-preview",
    });

  it("sums per-turn tokens, splitting cached out of input and folding thoughts into output", () => {
    const lines = [
      meta,
      user,
      set,
      geminiLine(16726, 46, 14167, 60),
      geminiLine(17073, 46, 14177, 48),
    ];
    const { delta, newState } = parseSessionDelta(
      "gemini",
      lines,
      newParseState(),
    );
    // input: (16726-14167) + (17073-14177) = 2559 + 2896 = 5455
    // output: (46+60) + (46+48) = 106 + 94 = 200
    // cacheRead: 14167 + 14177 = 28344
    expect(delta).toEqual({
      input: 5455,
      output: 200,
      cacheRead: 28344,
      cacheWrite: 0,
    });
    expect(newState.model).toBe("gemini-3-flash-preview");
    expect(newState.lastLineCount).toBe(5);
  });

  it("ignores $set and non-gemini lines and is incremental", () => {
    const base = [meta, user, set, geminiLine(16726, 46, 14167, 60)];
    const first = parseSessionDelta("gemini", base, newParseState());
    const grown = [...base, set, geminiLine(17073, 46, 14177, 48)];
    const second = parseSessionDelta("gemini", grown, first.newState);
    expect(second.delta).toEqual({
      input: 2896,
      output: 94,
      cacheRead: 14177,
      cacheWrite: 0,
    });
  });
});
