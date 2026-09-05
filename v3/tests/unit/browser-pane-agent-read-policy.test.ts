import { describe, expect, it } from "vitest";
import {
  AgentReadRateLimiter,
  GlobalBrowserAccessSwitch,
  capReadText,
  classifyAgentNavigationRequest,
  classifyAgentReadRequest,
  redactLikelySecrets,
  type AgentReadRequestInput,
} from "../../electron/browser-pane-agent-read-policy";

const BASE: AgentReadRequestInput = {
  paneExists: true,
  granted: true,
  globalStopActive: false,
  rateLimitOk: true,
  currentUrl: "https://example.com/dashboard",
};

describe("classifyAgentReadRequest", () => {
  it("allows a granted, non-suspended, non-rate-limited, ordinary page", () => {
    expect(classifyAgentReadRequest(BASE)).toEqual({ allowed: true });
  });

  it("denies with pane-not-found before checking anything else", () => {
    expect(
      classifyAgentReadRequest({
        ...BASE,
        paneExists: false,
        granted: false,
        globalStopActive: true,
      }),
    ).toEqual({ allowed: false, reason: "pane-not-found" });
  });

  it("denies with global-stop even on an already-granted pane", () => {
    expect(
      classifyAgentReadRequest({ ...BASE, globalStopActive: true }),
    ).toEqual({ allowed: false, reason: "global-stop" });
  });

  it("global-stop wins over not-granted (checked first)", () => {
    expect(
      classifyAgentReadRequest({
        ...BASE,
        granted: false,
        globalStopActive: true,
      }),
    ).toEqual({ allowed: false, reason: "global-stop" });
  });

  it("denies an ungranted pane", () => {
    expect(classifyAgentReadRequest({ ...BASE, granted: false })).toEqual({
      allowed: false,
      reason: "not-granted",
    });
  });

  it("denies when the rate limiter says no", () => {
    expect(classifyAgentReadRequest({ ...BASE, rateLimitOk: false })).toEqual({
      allowed: false,
      reason: "rate-limited",
    });
  });

  it("denies a granted pane sitting on an auth page", () => {
    expect(
      classifyAgentReadRequest({
        ...BASE,
        currentUrl: "https://accounts.google.com/signin",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies a granted pane sitting on a payment page", () => {
    expect(
      classifyAgentReadRequest({
        ...BASE,
        currentUrl: "https://checkout.stripe.com/pay/123",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies an invalid URL rather than throwing", () => {
    expect(
      classifyAgentReadRequest({ ...BASE, currentUrl: "not a url" }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });
});

describe("classifyAgentNavigationRequest", () => {
  const input = {
    globalStopActive: false,
    rateLimitOk: true,
    url: "https://www.google.com/search?q=upstage+usage+api",
  };

  it("allows an ordinary public HTTPS investigation URL", () => {
    expect(classifyAgentNavigationRequest(input)).toEqual({ allowed: true });
  });

  it("the global stop wins before a URL can be loaded", () => {
    expect(
      classifyAgentNavigationRequest({ ...input, globalStopActive: true }),
    ).toEqual({ allowed: false, reason: "global-stop" });
  });

  it("denies a navigation burst", () => {
    expect(
      classifyAgentNavigationRequest({ ...input, rateLimitOk: false }),
    ).toEqual({ allowed: false, reason: "rate-limited" });
  });

  it("reuses the app-tab auth/payment classification", () => {
    expect(
      classifyAgentNavigationRequest({
        ...input,
        url: "https://accounts.google.com/signin",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
    expect(
      classifyAgentNavigationRequest({
        ...input,
        url: "https://checkout.stripe.com/pay/example",
      }),
    ).toEqual({ allowed: false, reason: "sensitive-navigation" });
  });

  it("denies a redirect target independently of the initially public URL", () => {
    // `will-redirect` invokes this same policy for every server-side target;
    // a public search URL must not smuggle an agent pane into sign-in.
    const initial = classifyAgentNavigationRequest(input);
    const redirectTarget = classifyAgentNavigationRequest({
      ...input,
      url: "https://console.upstage.ai/login?redirect=%2Fbilling",
    });
    expect(initial).toEqual({ allowed: true });
    expect(redirectTarget).toEqual({
      allowed: false,
      reason: "non-public-url",
    });
  });

  it("denies non-HTTPS and private-network destinations in the isolated session", () => {
    expect(
      classifyAgentNavigationRequest({ ...input, url: "http://example.com" }),
    ).toEqual({ allowed: false, reason: "non-public-url" });
    expect(
      classifyAgentNavigationRequest({
        ...input,
        url: "https://localhost/admin",
      }),
    ).toEqual({ allowed: false, reason: "non-public-url" });
    expect(
      classifyAgentNavigationRequest({ ...input, url: "https://192.168.1.1" }),
    ).toEqual({ allowed: false, reason: "non-public-url" });
  });
});

describe("GlobalBrowserAccessSwitch", () => {
  it("starts not suspended with nothing in flight", () => {
    const sw = new GlobalBrowserAccessSwitch();
    expect(sw.isSuspended()).toBe(false);
    expect(sw.inFlightCount).toBe(0);
  });

  it("suspend() aborts every registered in-flight read and reports the count", () => {
    const sw = new GlobalBrowserAccessSwitch();
    let abortedA = false;
    let abortedB = false;
    sw.register("a", {
      paneId: "pane-a",
      agentId: "agent-1",
      abort: () => {
        abortedA = true;
      },
    });
    sw.register("b", {
      paneId: "pane-b",
      agentId: "agent-2",
      abort: () => {
        abortedB = true;
      },
    });

    const result = sw.suspend();

    expect(result.abortedCount).toBe(2);
    expect(abortedA).toBe(true);
    expect(abortedB).toBe(true);
    expect(sw.isSuspended()).toBe(true);
    expect(sw.inFlightCount).toBe(0);
  });

  it("suspend() with nothing in flight still trips the switch and reports 0", () => {
    const sw = new GlobalBrowserAccessSwitch();
    expect(sw.suspend()).toEqual({ abortedCount: 0 });
    expect(sw.isSuspended()).toBe(true);
  });

  it("resume() clears the suspension", () => {
    const sw = new GlobalBrowserAccessSwitch();
    sw.suspend();
    sw.resume();
    expect(sw.isSuspended()).toBe(false);
  });

  it("unregister() removes an entry without aborting it", () => {
    const sw = new GlobalBrowserAccessSwitch();
    let aborted = false;
    sw.register("a", {
      paneId: "pane-a",
      agentId: "agent-1",
      abort: () => {
        aborted = true;
      },
    });
    sw.unregister("a");
    expect(sw.inFlightCount).toBe(0);
    sw.suspend();
    expect(aborted).toBe(false);
  });
});

describe("AgentReadRateLimiter", () => {
  it("allows the first read of a pane", () => {
    const limiter = new AgentReadRateLimiter({ now: () => 0 });
    expect(limiter.allow("pane-a")).toBe(true);
  });

  it("denies a second read of the same pane inside the cooldown", () => {
    let now = 0;
    const limiter = new AgentReadRateLimiter({
      minIntervalMsPerPane: 2000,
      now: () => now,
    });
    expect(limiter.allow("pane-a")).toBe(true);
    limiter.record("pane-a");
    now = 1000;
    expect(limiter.allow("pane-a")).toBe(false);
  });

  it("allows again once the per-pane cooldown has fully elapsed", () => {
    let now = 0;
    const limiter = new AgentReadRateLimiter({
      minIntervalMsPerPane: 2000,
      now: () => now,
    });
    limiter.record("pane-a");
    now = 2000;
    expect(limiter.allow("pane-a")).toBe(true);
  });

  it("a denied check never consumes budget (allow() is pure)", () => {
    let now = 0;
    const limiter = new AgentReadRateLimiter({
      minIntervalMsPerPane: 2000,
      now: () => now,
    });
    limiter.record("pane-a");
    now = 500;
    expect(limiter.allow("pane-a")).toBe(false);
    expect(limiter.allow("pane-a")).toBe(false); // still false, not recorded
    now = 2000;
    expect(limiter.allow("pane-a")).toBe(true);
  });

  it("enforces the global per-minute cap across different panes", () => {
    let now = 0;
    const limiter = new AgentReadRateLimiter({
      minIntervalMsPerPane: 0,
      maxPerMinuteGlobal: 2,
      now: () => now,
    });
    expect(limiter.allow("pane-a")).toBe(true);
    limiter.record("pane-a");
    now = 10;
    expect(limiter.allow("pane-b")).toBe(true);
    limiter.record("pane-b");
    now = 20;
    expect(limiter.allow("pane-c")).toBe(false);
  });

  it("the global cap window rolls off after 60s", () => {
    let now = 0;
    const limiter = new AgentReadRateLimiter({
      minIntervalMsPerPane: 0,
      maxPerMinuteGlobal: 1,
      now: () => now,
    });
    limiter.record("pane-a");
    now = 30_000;
    expect(limiter.allow("pane-b")).toBe(false);
    now = 60_001;
    expect(limiter.allow("pane-b")).toBe(true);
  });
});

describe("redactLikelySecrets", () => {
  it("leaves ordinary page text untouched", () => {
    const input = "Q3 revenue is up 12% and the launch date is Sept 5.";
    expect(redactLikelySecrets(input)).toEqual({
      text: input,
      redactedCount: 0,
    });
  });

  it("redacts an OpenAI/Anthropic-style secret key", () => {
    const result = redactLikelySecrets("api key: sk-abcdEFGH12345678ijklMNOP");
    expect(result.text).not.toContain("sk-abcdEFGH12345678ijklMNOP");
    expect(result.text).toContain("<REDACTED>");
    expect(result.redactedCount).toBe(1);
  });

  it("redacts an AWS access key id", () => {
    const result = redactLikelySecrets("AKIAABCDEFGHIJKLMNOP is the key");
    expect(result.redactedCount).toBe(1);
    expect(result.text).not.toContain("AKIAABCDEFGHIJKLMNOP");
  });

  it("redacts a JWT", () => {
    const jwt =
      "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dQw4w9WgXcQmoiCV5tsyWVYzZUuUUuG8s5s2A9lY";
    const result = redactLikelySecrets(`token=${jwt}`);
    expect(result.redactedCount).toBe(1);
    expect(result.text).not.toContain(jwt);
  });

  it("redacts a credit-card-like digit run", () => {
    const result = redactLikelySecrets("card 4111 1111 1111 1111 on file");
    expect(result.redactedCount).toBe(1);
    expect(result.text).not.toContain("4111 1111 1111 1111");
  });

  it("counts multiple distinct secrets in one page", () => {
    const result = redactLikelySecrets(
      "sk-abcdEFGH12345678ijklMNOP and AKIAABCDEFGHIJKLMNOP both leaked",
    );
    expect(result.redactedCount).toBe(2);
  });
});

describe("capReadText", () => {
  it("returns short text untouched", () => {
    expect(capReadText("hello", 10)).toEqual({
      text: "hello",
      truncated: false,
    });
  });

  it("truncates text past the cap and flags it", () => {
    expect(capReadText("hello world", 5)).toEqual({
      text: "hello",
      truncated: true,
    });
  });

  it("treats exactly-at-cap length as not truncated", () => {
    expect(capReadText("hello", 5)).toEqual({
      text: "hello",
      truncated: false,
    });
  });
});
