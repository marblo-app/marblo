import { describe, expect, it } from "vitest";
import {
  SITE_DATA_CATEGORIES,
  SITE_DATA_NON_COOKIE_STORAGES,
  SITE_DATA_STORAGES,
  broaderCookieDomains,
  classifySiteDataClearRequest,
  cookieRemovalUrl,
  planCookieRemoval,
  resolveSiteDataOrigin,
  toCookiePreview,
  type SiteDataClearRequestInput,
} from "../../electron/browser-pane-site-data-policy";

describe("resolveSiteDataOrigin", () => {
  it("resolves an ordinary https URL to its origin and host", () => {
    expect(
      resolveSiteDataOrigin("https://www.naver.com/some/path?q=1"),
    ).toEqual({
      ok: true,
      origin: "https://www.naver.com",
      host: "www.naver.com",
    });
  });

  it("keeps a non-default port in the origin", () => {
    expect(resolveSiteDataOrigin("http://localhost:3001/foo")).toEqual({
      ok: true,
      origin: "http://localhost:3001",
      host: "localhost",
    });
  });

  it("rejects an empty URL as no-site", () => {
    expect(resolveSiteDataOrigin("")).toEqual({ ok: false, reason: "no-site" });
  });

  it("rejects about:blank as no-site", () => {
    expect(resolveSiteDataOrigin("about:blank")).toEqual({
      ok: false,
      reason: "no-site",
    });
  });

  it("rejects a malformed URL as invalid-url rather than throwing", () => {
    expect(resolveSiteDataOrigin("not a url")).toEqual({
      ok: false,
      reason: "invalid-url",
    });
  });

  it("rejects a non-http(s) scheme as blocked-scheme", () => {
    expect(resolveSiteDataOrigin("file:///etc/passwd")).toEqual({
      ok: false,
      reason: "blocked-scheme",
    });
    expect(resolveSiteDataOrigin("chrome://settings")).toEqual({
      ok: false,
      reason: "blocked-scheme",
    });
  });
});

describe("SITE_DATA_CATEGORIES / SITE_DATA_STORAGES", () => {
  it("names exactly the four categories the ticket requires", () => {
    expect(SITE_DATA_CATEGORIES.map((c) => c.id)).toEqual([
      "cookies",
      "cache",
      "serviceWorkers",
      "localStorage",
    ]);
  });

  it("flattens to a storages list covering every category's storages", () => {
    for (const category of SITE_DATA_CATEGORIES) {
      for (const storage of category.storages) {
        expect(SITE_DATA_STORAGES).toContain(storage);
      }
    }
  });

  it("never includes an empty-string storage entry", () => {
    expect(SITE_DATA_STORAGES.every((s) => s.length > 0)).toBe(true);
  });
});

describe("classifySiteDataClearRequest", () => {
  const BASE: SiteDataClearRequestInput = {
    paneExists: true,
    currentUrl: "https://www.naver.com/",
    confirmed: true,
    expectedOrigin: "https://www.naver.com",
  };

  it("allows a confirmed clear on a live pane with a real http(s) page whose origin matches", () => {
    expect(classifySiteDataClearRequest(BASE)).toEqual({
      allowed: true,
      origin: "https://www.naver.com",
      host: "www.naver.com",
    });
  });

  it("denies with pane-not-found before checking anything else", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        paneExists: false,
        currentUrl: "about:blank",
        confirmed: false,
        expectedOrigin: "",
      }),
    ).toEqual({ allowed: false, reason: "pane-not-found" });
  });

  it("denies no-site on a blank pane even when confirmed", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "about:blank",
      }),
    ).toEqual({ allowed: false, reason: "no-site" });
  });

  it("denies blocked-scheme for a non-http(s) current URL", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "file:///etc/passwd",
      }),
    ).toEqual({ allowed: false, reason: "blocked-scheme" });
  });

  // ★The load-bearing case: origin resolves fine, pane exists — the ONLY
  // thing standing between this request and a real clearStorageData() call
  // is explicit confirmation. This is the case the ticket's "가드를 꺼서
  // 테스트가 뒤집히는지 확인" instruction targets.
  it("denies not-confirmed when everything else about the request is valid", () => {
    expect(classifySiteDataClearRequest({ ...BASE, confirmed: false })).toEqual(
      { allowed: false, reason: "not-confirmed" },
    );
  });

  it("never allows just because confirmed is true — origin must resolve first", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "not a url",
        confirmed: true,
      }),
    ).toEqual({ allowed: false, reason: "invalid-url" });
  });

  // ★TOCTOU: the pane navigates between the preview the owner saw and the
  // confirm click. The stale confirmation must never clear whatever site
  // happens to be loaded now.
  it("denies origin-changed when the pane has navigated since the preview, even though confirmed is true", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "https://evil.example.com/",
        expectedOrigin: "https://www.naver.com",
        confirmed: true,
      }),
    ).toEqual({ allowed: false, reason: "origin-changed" });
  });

  it("reports origin-changed rather than not-confirmed when both would otherwise apply", () => {
    // A stale, unconfirmed request for a since-navigated pane should surface
    // the more specific/actionable reason so the UI re-previews instead of
    // just asking to reconfirm the wrong site.
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "https://evil.example.com/",
        expectedOrigin: "https://www.naver.com",
        confirmed: false,
      }),
    ).toEqual({ allowed: false, reason: "origin-changed" });
  });

  it("denies origin-changed when expectedOrigin is empty (renderer omitted it)", () => {
    expect(
      classifySiteDataClearRequest({ ...BASE, expectedOrigin: "" }),
    ).toEqual({ allowed: false, reason: "origin-changed" });
  });

  it("origin-changed fires even for an exact-string mismatch (trailing slash, scheme, port)", () => {
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        expectedOrigin: "https://www.naver.com/",
      }),
    ).toEqual({ allowed: false, reason: "origin-changed" });
    expect(
      classifySiteDataClearRequest({
        ...BASE,
        currentUrl: "http://www.naver.com/",
        expectedOrigin: "https://www.naver.com",
      }),
    ).toEqual({ allowed: false, reason: "origin-changed" });
  });
});

describe("toCookiePreview", () => {
  it("keeps only name, domain, and a numeric expiry — never a value field", () => {
    const preview = toCookiePreview([
      {
        name: "NID_SES",
        domain: ".naver.com",
        expirationDate: 1893456000,
        // @ts-expect-error -- real Electron Cookie objects carry `value`;
        // proving it is dropped even when present on the input.
        value: "super-secret-session-token",
      },
    ]);
    expect(preview).toEqual([
      { name: "NID_SES", domain: ".naver.com", expiresAt: 1893456000 },
    ]);
    expect(Object.keys(preview[0])).not.toContain("value");
  });

  it("reports a session cookie (no persistent expiry) as expiresAt: null", () => {
    const preview = toCookiePreview([
      { name: "session_id", domain: "example.com", session: true },
    ]);
    expect(preview).toEqual([
      { name: "session_id", domain: "example.com", expiresAt: null },
    ]);
  });

  it("defaults a missing domain to an empty string rather than throwing", () => {
    const preview = toCookiePreview([{ name: "anon" }]);
    expect(preview).toEqual([{ name: "anon", domain: "", expiresAt: null }]);
  });

  it("rounds a fractional expirationDate", () => {
    const preview = toCookiePreview([
      { name: "a", domain: "x.com", expirationDate: 100.6 },
    ]);
    expect(preview[0].expiresAt).toBe(101);
  });
});

// Ticket zYzwb3Q5hKT6o3Nl9aZh — "shown = cleared" invariant: the preview
// modal lists every cookie `session.cookies.get({ url })` returns for the
// pane's origin, which includes parent-domain cookies (`.naver.com` while
// browsing `recoshopping.naver.com`). `clearStorageData({ origin, storages:
// ["cookies"] })` never reaches those — it only clears cookies scoped to the
// exact origin. `cookieRemovalUrl` is what lets `main.ts` instead remove
// each previewed cookie individually via `session.cookies.remove(url,
// name)`, so this fixes the pin at the pure-function boundary: for every raw
// cookie a preview would show, the URL this produces must resolve to exactly
// that cookie's own domain (dot-stripped for domain cookies, verbatim for
// host-only ones) — never the pane's own origin host instead.
describe("cookieRemovalUrl", () => {
  it("strips the leading dot from a parent-domain cookie", () => {
    expect(cookieRemovalUrl({ domain: ".naver.com" }, "https:")).toBe(
      "https://naver.com",
    );
  });

  it("uses the exact host verbatim for a host-only cookie", () => {
    expect(
      cookieRemovalUrl({ domain: "recoshopping.naver.com" }, "https:"),
    ).toBe("https://recoshopping.naver.com");
  });

  it("honors the origin's own protocol rather than hardcoding https", () => {
    expect(cookieRemovalUrl({ domain: "localhost" }, "http:")).toBe(
      "http://localhost",
    );
  });

  it("matches every previewed cookie's own domain — never the pane's origin host", () => {
    const paneHost = "recoshopping.naver.com";
    const rawCookies = [
      { name: "NAC", domain: ".naver.com" },
      { name: "NNB", domain: ".naver.com" },
      { name: "NACT", domain: ".naver.com" },
      { name: "SRT30", domain: "recoshopping.naver.com" },
      { name: "SRT5", domain: "recoshopping.naver.com" },
      { name: "BUC", domain: ".naver.com" },
    ];
    for (const cookie of rawCookies) {
      const removalHost = new URL(cookieRemovalUrl(cookie, "https:")).hostname;
      const previewedDomain = toCookiePreview([cookie])[0].domain;
      expect(removalHost).toBe(previewedDomain.replace(/^\./, ""));
    }
    // Sanity: this fixture actually exercises the bug — some previewed
    // cookies are NOT scoped to the pane's own host, which is exactly the
    // case `clearStorageData({ origin: paneOrigin })` could never reach.
    expect(
      rawCookies.some((c) => c.domain.replace(/^\./, "") !== paneHost),
    ).toBe(true);
  });
});

// Orchestrator review on zYzwb3Q5hKT6o3Nl9aZh: the actual guarantee is not
// "exactly the cookies the preview showed" — `main.ts` re-fetches cookies at
// clear-time rather than trusting the preview, so a cookie the site sets
// *between* preview and confirm gets cleared too (still same-origin only).
// That's the safer direction, kept deliberately — this pins the shape of it:
// `planCookieRemoval` has no notion of "the preview" at all, it just maps
// whatever list it's handed, so feeding it a clear-time list that grew past
// the preview naturally includes the new cookie.
describe("planCookieRemoval", () => {
  it("plans a removal target for every cookie handed to it, by name and domain-derived url", () => {
    const plan = planCookieRemoval(
      [
        { name: "NAC", domain: ".naver.com" },
        { name: "SRT30", domain: "recoshopping.naver.com" },
      ],
      "https:",
    );
    expect(plan).toEqual([
      { name: "NAC", url: "https://naver.com" },
      { name: "SRT30", url: "https://recoshopping.naver.com" },
    ]);
  });

  it("drops a cookie with no domain rather than building a garbage removal url", () => {
    const plan = planCookieRemoval([{ name: "anon" }], "https:");
    expect(plan).toEqual([]);
  });

  it("covers a cookie set after the preview was shown — it plans from whatever list it's given, not a remembered preview", () => {
    const previewedCookies = [
      { name: "SRT30", domain: "recoshopping.naver.com" },
    ];
    // The site set a second cookie after the owner saw the preview but
    // before they clicked confirm — a fresh `cookies.get()` at clear-time
    // would include it.
    const clearTimeCookies = [
      ...previewedCookies,
      { name: "NEW_SESSION", domain: "recoshopping.naver.com" },
    ];
    const plan = planCookieRemoval(clearTimeCookies, "https:");
    expect(plan.map((p) => p.name)).toEqual(["SRT30", "NEW_SESSION"]);
    expect(plan.length).toBeGreaterThan(previewedCookies.length);
  });
});

describe("SITE_DATA_NON_COOKIE_STORAGES", () => {
  it("excludes the cookies category — cookies are cleared separately via cookies.remove", () => {
    expect(SITE_DATA_NON_COOKIE_STORAGES).not.toContain("cookies");
  });

  it("still covers cache, service workers, and local storage", () => {
    const cookieCategory = SITE_DATA_CATEGORIES.find((c) => c.id === "cookies");
    for (const category of SITE_DATA_CATEGORIES) {
      if (category === cookieCategory) continue;
      for (const storage of category.storages) {
        expect(SITE_DATA_NON_COOKIE_STORAGES).toContain(storage);
      }
    }
  });
});

describe("broaderCookieDomains", () => {
  it("returns nothing when every cookie is scoped to the pane's own host", () => {
    expect(
      broaderCookieDomains(
        [{ domain: "example.com" }, { domain: "example.com" }],
        "example.com",
      ),
    ).toEqual([]);
  });

  it("flags a parent-domain cookie as broader than the pane's host", () => {
    expect(
      broaderCookieDomains(
        [{ domain: ".naver.com" }],
        "recoshopping.naver.com",
      ),
    ).toEqual(["naver.com"]);
  });

  it("de-dupes and sorts multiple broader domains", () => {
    expect(
      broaderCookieDomains(
        [
          { domain: ".b.example.com" },
          { domain: ".a.example.com" },
          { domain: ".a.example.com" },
        ],
        "sub.a.example.com",
      ),
    ).toEqual(["a.example.com", "b.example.com"]);
  });
});
