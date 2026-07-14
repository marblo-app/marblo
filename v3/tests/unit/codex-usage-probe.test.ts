import { describe, expect, it } from "vitest";
import {
  CODEX_RATE_LIMIT_TIMEOUT_MS,
  parseRateLimitsReadResponse,
} from "../../electron/codex-usage-probe";

const REQ_ID = 2;

/**
 * Wrap a `result` payload in the JSON-RPC response envelope the app-server
 * emits for `account/rateLimits/read`. parseRateLimitsReadResponse matches
 * on `obj.id === requestId` and reads `obj.result`.
 */
function rpc(result: unknown, id: number = REQ_ID): unknown {
  return { jsonrpc: "2.0", id, result };
}

/** `account/rateLimits/read` result (camelCase, codex-cli 0.142.2 spec). */
function camelResult(overrides?: Record<string, unknown>): unknown {
  return {
    rateLimits: {
      primary: { usedPercent: 1.0, windowMinutes: 300, resetsAt: 1780650953 },
      secondary: {
        usedPercent: 15.0,
        windowMinutes: 10080,
        resetsAt: 1781149096,
      },
      planType: "plus",
      ...(overrides ?? {}),
    },
  };
}

describe("parseRateLimitsReadResponse", () => {
  it("maps the documented camelCase app-server shape to a snapshot", () => {
    const snap = parseRateLimitsReadResponse(rpc(camelResult()), REQ_ID);
    expect(snap).not.toBeNull();
    expect(snap!.planType).toBe("plus");
    expect(snap!.primaryPercent).toBe(1);
    expect(snap!.secondaryPercent).toBe(15);
    expect(snap!.primaryResetAt).toBe(1780650953);
    expect(snap!.secondaryResetAt).toBe(1781149096);
    expect(snap!.primaryWindowDurationMins).toBe(300);
    expect(snap!.secondaryWindowDurationMins).toBe(10080);
    expect(snap!.capturedAt).toBeGreaterThan(0);
  });

  it("reads the rateLimitsByLimitId.codex shape when rateLimits is absent", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimitsByLimitId: {
          codex: {
            primary: { usedPercent: 33, resetsAt: 1780650953 },
            secondary: { usedPercent: 7, resetsAt: 1781149096 },
            planType: "pro",
          },
        },
      }),
      REQ_ID,
    );
    expect(snap).not.toBeNull();
    expect(snap!.planType).toBe("pro");
    expect(snap!.primaryPercent).toBe(33);
    expect(snap!.secondaryPercent).toBe(7);
    expect(snap!.primaryResetAt).toBe(1780650953);
  });

  it("reads rateLimitsByLimitId entries even when the limit id is versioned", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimitsByLimitId: {
          "gpt-5-codex": {
            primary: { usedPercent: 21, resetsAt: 1780650953 },
            secondary: { usedPercent: 64, resetsAt: 1781149096 },
            planType: "plus",
          },
        },
      }),
      REQ_ID,
    );
    expect(snap).not.toBeNull();
    expect(snap!.primaryPercent).toBe(21);
    expect(snap!.secondaryPercent).toBe(64);
  });

  it("accepts snake_case status-style windows for Codex weekly limits", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          five_hour: { used_percent: 3, resets_at: 1780650953 },
          seven_day: { used_percent: 42, resets_at: 1781149096 },
          plan_type: "pro",
        },
      }),
      REQ_ID,
    );
    expect(snap).not.toBeNull();
    expect(snap!.planType).toBe("pro");
    expect(snap!.primaryPercent).toBe(3);
    expect(snap!.secondaryPercent).toBe(42);
    expect(snap!.secondaryResetAt).toBe(1781149096);
  });

  it("keeps a single populated window and nulls the missing one", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          primary: { usedPercent: 33, resetsAt: 1780650953 },
          secondary: null,
          planType: "plus",
        },
      }),
      REQ_ID,
    );
    expect(snap!.primaryPercent).toBe(33);
    expect(snap!.secondaryPercent).toBeNull();
    expect(snap!.secondaryResetAt).toBeNull();
  });

  it("classifies a single prolite weekly primary window by duration", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          limitId: "codex",
          primary: {
            usedPercent: 11,
            windowDurationMins: 10080,
            resetsAt: 1784510639,
          },
          secondary: null,
          planType: "prolite",
        },
      }),
      REQ_ID,
    );
    expect(snap).not.toBeNull();
    expect(snap!.planType).toBe("prolite");
    expect(snap!.primaryPercent).toBeNull();
    expect(snap!.secondaryPercent).toBe(11);
    expect(snap!.secondaryResetAt).toBe(1784510639);
    expect(snap!.secondaryWindowDurationMins).toBe(10080);
  });

  it("classifies windows by duration even when app-server order changes", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          primary: {
            usedPercent: 77,
            windowDurationMins: 10080,
            resetsAt: 222,
          },
          secondary: {
            usedPercent: 9,
            windowDurationMins: 300,
            resetsAt: 111,
          },
          planType: "plus",
        },
      }),
      REQ_ID,
    );
    expect(snap).not.toBeNull();
    expect(snap!.primaryPercent).toBe(9);
    expect(snap!.primaryResetAt).toBe(111);
    expect(snap!.secondaryPercent).toBe(77);
    expect(snap!.secondaryResetAt).toBe(222);
  });

  it("accepts an ISO-string resetsAt and converts to epoch seconds", () => {
    const iso = "2026-06-11T06:00:00+00:00";
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          primary: { usedPercent: 5, resetsAt: iso },
          secondary: null,
        },
      }),
      REQ_ID,
    );
    expect(snap!.primaryResetAt).toBe(Math.floor(Date.parse(iso) / 1000));
  });

  it("clamps out-of-range usedPercent into 0–100", () => {
    const snap = parseRateLimitsReadResponse(
      rpc({
        rateLimits: {
          primary: { usedPercent: 250 },
          secondary: { usedPercent: -5 },
        },
      }),
      REQ_ID,
    );
    expect(snap!.primaryPercent).toBe(100);
    expect(snap!.secondaryPercent).toBe(0);
  });

  it("tolerates a non-string planType", () => {
    const snap = parseRateLimitsReadResponse(
      rpc(camelResult({ planType: 42 })),
      REQ_ID,
    );
    expect(snap!.planType).toBeNull();
    expect(snap!.primaryPercent).toBe(1);
  });

  it("returns null when neither window has a usable percent", () => {
    expect(
      parseRateLimitsReadResponse(
        rpc({ rateLimits: { primary: null, secondary: null } }),
        REQ_ID,
      ),
    ).toBeNull();
    expect(
      parseRateLimitsReadResponse(
        rpc({ rateLimits: { primary: {}, secondary: {} } }),
        REQ_ID,
      ),
    ).toBeNull();
  });

  it("returns null when the result has no rate-limit payload", () => {
    expect(parseRateLimitsReadResponse(rpc({}), REQ_ID)).toBeNull();
    expect(
      parseRateLimitsReadResponse(rpc({ rateLimits: 7 }), REQ_ID),
    ).toBeNull();
  });

  it("returns null when result is missing or null (e.g. a JSON-RPC error)", () => {
    expect(parseRateLimitsReadResponse(rpc(null), REQ_ID)).toBeNull();
    expect(
      parseRateLimitsReadResponse(
        { jsonrpc: "2.0", id: REQ_ID, error: { code: -32000, message: "no" } },
        REQ_ID,
      ),
    ).toBeNull();
  });

  it("returns null when the response id does not match the request id", () => {
    expect(
      parseRateLimitsReadResponse(rpc(camelResult(), 1), REQ_ID),
    ).toBeNull();
    expect(
      parseRateLimitsReadResponse(rpc(camelResult(), 99), REQ_ID),
    ).toBeNull();
  });

  it("returns null (not a crash) on non-object / null input", () => {
    expect(parseRateLimitsReadResponse("nope", REQ_ID)).toBeNull();
    expect(parseRateLimitsReadResponse(null, REQ_ID)).toBeNull();
    expect(parseRateLimitsReadResponse(undefined, REQ_ID)).toBeNull();
    expect(parseRateLimitsReadResponse(42, REQ_ID)).toBeNull();
  });
});

describe("CODEX_RATE_LIMIT_TIMEOUT_MS", () => {
  it("is a sane positive probe timeout", () => {
    expect(CODEX_RATE_LIMIT_TIMEOUT_MS).toBeGreaterThan(0);
    expect(Number.isFinite(CODEX_RATE_LIMIT_TIMEOUT_MS)).toBe(true);
  });
});
