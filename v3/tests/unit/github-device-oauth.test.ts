import { describe, expect, it } from "vitest";
import { parseDevicePollResponse } from "../../electron/github-device-oauth";

describe("GitHub device-flow polling state machine", () => {
  it("keeps the interval while authorization is pending", () => {
    expect(parseDevicePollResponse({ error: "authorization_pending" }, 5)).toEqual({
      kind: "pending",
      nextIntervalSeconds: 5,
    });
  });

  it("backs off by five seconds when GitHub asks to slow down", () => {
    expect(parseDevicePollResponse({ error: "slow_down" }, 5)).toEqual({
      kind: "slow_down",
      nextIntervalSeconds: 10,
    });
  });

  it("ends expired and denied sessions without a token", () => {
    expect(parseDevicePollResponse({ error: "expired_token" }, 5)).toEqual({ kind: "expired" });
    expect(parseDevicePollResponse({ error: "access_denied" }, 5)).toEqual({ kind: "denied" });
  });

  it("returns the token only for a bearer success response", () => {
    expect(parseDevicePollResponse({ access_token: "test-token", token_type: "bearer" }, 5)).toEqual({
      kind: "success",
      accessToken: "test-token",
    });
  });
});
