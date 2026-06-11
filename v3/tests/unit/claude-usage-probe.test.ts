import { describe, expect, it } from "vitest";
import {
  buildProbeArgs,
  isGetUsageError,
  parseGetUsageResponse,
} from "../../electron/claude-usage-probe";

const REQ = "marblo-get-usage-test-1";

/** Real response shape captured from claude CLI 2.1.172 (fields trimmed). */
function successLine(overrides?: {
  rate_limits?: unknown;
  rate_limits_available?: boolean;
  subscription_type?: unknown;
  request_id?: string;
  subtype?: string;
}): unknown {
  return {
    type: "control_response",
    response: {
      subtype: overrides?.subtype ?? "success",
      request_id: overrides?.request_id ?? REQ,
      response: {
        session: { total_cost_usd: 0 },
        subscription_type: overrides?.subscription_type ?? "max",
        rate_limits_available: overrides?.rate_limits_available ?? true,
        rate_limits:
          overrides && "rate_limits" in overrides
            ? overrides.rate_limits
            : {
                five_hour: {
                  utilization: 23,
                  resets_at: "2026-06-11T06:00:00.181543+00:00",
                },
                seven_day: {
                  utilization: 16,
                  resets_at: "2026-06-12T06:00:00.181565+00:00",
                },
                seven_day_oauth_apps: null,
                seven_day_sonnet: { utilization: 0, resets_at: null },
              },
      },
    },
  };
}

describe("parseGetUsageResponse", () => {
  it("maps the verified 2.1.172 success shape to a snapshot", () => {
    const snap = parseGetUsageResponse(successLine(), REQ);
    expect(snap).not.toBeNull();
    expect(snap!.planType).toBe("max");
    expect(snap!.primaryPercent).toBe(23);
    expect(snap!.secondaryPercent).toBe(16);
    // ISO resets_at → epoch seconds
    expect(snap!.primaryResetAt).toBe(
      Math.floor(Date.parse("2026-06-11T06:00:00.181543+00:00") / 1000)
    );
    expect(snap!.secondaryResetAt).toBe(
      Math.floor(Date.parse("2026-06-12T06:00:00.181565+00:00") / 1000)
    );
    expect(snap!.capturedAt).toBeGreaterThan(0);
  });

  it("accepts numeric (epoch-seconds) resets_at too", () => {
    const snap = parseGetUsageResponse(
      successLine({
        rate_limits: {
          five_hour: { utilization: 50, resets_at: 1780650953 },
          seven_day: null,
        },
      }),
      REQ
    );
    expect(snap!.primaryResetAt).toBe(1780650953);
    expect(snap!.secondaryPercent).toBeNull();
    expect(snap!.secondaryResetAt).toBeNull();
  });

  it("clamps out-of-range utilization into 0–100", () => {
    const snap = parseGetUsageResponse(
      successLine({
        rate_limits: {
          five_hour: { utilization: 250, resets_at: null },
          seven_day: { utilization: -5, resets_at: null },
        },
      }),
      REQ
    );
    expect(snap!.primaryPercent).toBe(100);
    expect(snap!.secondaryPercent).toBe(0);
  });

  it("returns null when rate limits do not apply (API key / Bedrock)", () => {
    expect(
      parseGetUsageResponse(successLine({ rate_limits_available: false }), REQ)
    ).toBeNull();
    expect(
      parseGetUsageResponse(successLine({ rate_limits: null }), REQ)
    ).toBeNull();
  });

  it("returns null when neither window has a usable percent", () => {
    expect(
      parseGetUsageResponse(
        successLine({ rate_limits: { five_hour: null, seven_day: null } }),
        REQ
      )
    ).toBeNull();
  });

  it("ignores responses for other request ids and other line types", () => {
    expect(
      parseGetUsageResponse(successLine({ request_id: "someone-else" }), REQ)
    ).toBeNull();
    expect(
      parseGetUsageResponse({ type: "system", subtype: "init" }, REQ)
    ).toBeNull();
    expect(parseGetUsageResponse("not an object", REQ)).toBeNull();
    expect(parseGetUsageResponse(null, REQ)).toBeNull();
  });

  it("returns null (not a crash) on an error response", () => {
    expect(
      parseGetUsageResponse(successLine({ subtype: "error" }), REQ)
    ).toBeNull();
  });

  it("tolerates a non-string subscription_type", () => {
    const snap = parseGetUsageResponse(
      successLine({ subscription_type: 42 }),
      REQ
    );
    expect(snap!.planType).toBeNull();
    expect(snap!.primaryPercent).toBe(23);
  });
});

describe("isGetUsageError", () => {
  it("detects an error control_response for our request", () => {
    expect(isGetUsageError(successLine({ subtype: "error" }), REQ)).toBe(true);
  });

  it("does not flag success responses or other requests", () => {
    expect(isGetUsageError(successLine(), REQ)).toBe(false);
    expect(
      isGetUsageError(
        successLine({ subtype: "error", request_id: "other" }),
        REQ
      )
    ).toBe(false);
    expect(isGetUsageError({ type: "assistant" }, REQ)).toBe(false);
  });
});

describe("buildProbeArgs", () => {
  it("runs print-mode stream-json with full isolation flags", () => {
    const args = buildProbeArgs();
    expect(args).toContain("-p");
    expect(args).toContain("--no-session-persistence");
    expect(args).toContain("--strict-mcp-config");
    expect(args).toContain("--verbose"); // stream-json under --print needs it
    const settingSources = args[args.indexOf("--setting-sources") + 1];
    expect(settingSources).toBe(""); // no user/project settings → no hooks
    const inputFormat = args[args.indexOf("--input-format") + 1];
    expect(inputFormat).toBe("stream-json");
    const outputFormat = args[args.indexOf("--output-format") + 1];
    expect(outputFormat).toBe("stream-json");
  });
});
