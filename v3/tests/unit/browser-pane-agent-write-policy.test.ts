import { describe, expect, it } from "vitest";
import {
  classifyAgentWriteRequest,
  isGoogleHost,
  capFillValue,
  MAX_AGENT_FILL_VALUE_CHARS,
  type AgentWriteRequestInput,
} from "../../electron/browser-pane-agent-write-policy";

const BASE: AgentWriteRequestInput = {
  paneExists: true,
  granted: true,
  globalStopActive: false,
  rateLimitOk: true,
  currentUrl: "https://example.com/dashboard",
  actionKind: "fill",
};

describe("classifyAgentWriteRequest", () => {
  it("allows a granted, non-suspended, non-rate-limited fill on an ordinary page", () => {
    expect(classifyAgentWriteRequest(BASE)).toEqual({ allowed: true });
  });

  it("denies with pane-not-found before checking anything else", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        paneExists: false,
        granted: false,
        globalStopActive: true,
      }),
    ).toEqual({ allowed: false, reason: "pane-not-found" });
  });

  it("denies with global-stop even on an already-granted pane", () => {
    expect(
      classifyAgentWriteRequest({ ...BASE, globalStopActive: true }),
    ).toEqual({ allowed: false, reason: "global-stop" });
  });

  it("denies a submit action unconditionally, even fully granted with no stop active", () => {
    expect(
      classifyAgentWriteRequest({ ...BASE, actionKind: "submit" }),
    ).toEqual({ allowed: false, reason: "action-not-reversible" });
  });

  it("denies a submit action even when the pane doesn't exist or is globally stopped isn't the reason reported first", () => {
    // pane-not-found still outranks the submit refusal (existence is checked
    // before the reversibility rule) — this pins that order.
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        actionKind: "submit",
        paneExists: false,
      }),
    ).toEqual({ allowed: false, reason: "pane-not-found" });
  });

  it("denies an ungranted pane", () => {
    expect(classifyAgentWriteRequest({ ...BASE, granted: false })).toEqual({
      allowed: false,
      reason: "not-granted",
    });
  });

  it("a submit request is denied even without a grant, for the submit reason (not-granted never gets checked)", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        actionKind: "submit",
        granted: false,
      }),
    ).toEqual({ allowed: false, reason: "action-not-reversible" });
  });

  it("denies when the rate limiter says no", () => {
    expect(classifyAgentWriteRequest({ ...BASE, rateLimitOk: false })).toEqual({
      allowed: false,
      reason: "rate-limited",
    });
  });

  it("denies a granted pane sitting on an auth page", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        currentUrl: "https://accounts.google.com/signin",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies a granted pane sitting on a payment page", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        currentUrl: "https://checkout.stripe.com/pay/123",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies an invalid URL rather than throwing", () => {
    expect(
      classifyAgentWriteRequest({ ...BASE, currentUrl: "not a url" }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies an ordinary (non-auth) Google content page — google.com is excluded from 3a entirely", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        currentUrl: "https://mail.google.com/mail/u/0/#inbox",
      }),
    ).toEqual({ allowed: false, reason: "google-host" });
  });

  it("denies youtube.com even though it isn't an auth/payment host", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        currentUrl: "https://www.youtube.com/watch?v=example",
      }),
    ).toEqual({ allowed: false, reason: "google-host" });
  });

  it("allows a non-Google, non-sensitive host — the naver.com case the design doc anchors on", () => {
    expect(
      classifyAgentWriteRequest({
        ...BASE,
        currentUrl: "https://www.naver.com/",
      }),
    ).toEqual({ allowed: true });
  });
});

describe("isGoogleHost", () => {
  it("matches the bare apex domain", () => {
    expect(isGoogleHost("https://google.com/search?q=x")).toBe(true);
  });

  it("matches subdomains", () => {
    expect(isGoogleHost("https://mail.google.com/")).toBe(true);
    expect(isGoogleHost("https://drive.google.com/drive/my-drive")).toBe(true);
  });

  it("matches gmail.com and youtube.com as separate registrable domains", () => {
    expect(isGoogleHost("https://gmail.com/")).toBe(true);
    expect(isGoogleHost("https://youtube.com/")).toBe(true);
  });

  it("does not match an unrelated host that merely contains 'google'", () => {
    expect(isGoogleHost("https://notgoogle.com/")).toBe(false);
    expect(isGoogleHost("https://google.com.evil-example.net/")).toBe(false);
  });

  it("returns false for an invalid URL instead of throwing", () => {
    expect(isGoogleHost("not a url")).toBe(false);
  });
});

describe("capFillValue", () => {
  it("returns short text untouched", () => {
    expect(capFillValue("hello")).toEqual({
      value: "hello",
      truncated: false,
    });
  });

  it("truncates text past the cap and flags it", () => {
    const long = "x".repeat(MAX_AGENT_FILL_VALUE_CHARS + 10);
    const result = capFillValue(long);
    expect(result.truncated).toBe(true);
    expect(result.value.length).toBe(MAX_AGENT_FILL_VALUE_CHARS);
  });

  it("treats exactly-at-cap length as not truncated", () => {
    const exact = "x".repeat(MAX_AGENT_FILL_VALUE_CHARS);
    expect(capFillValue(exact)).toEqual({ value: exact, truncated: false });
  });
});
