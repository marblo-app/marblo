import { describe, expect, it } from "vitest";
import {
  SITE_DATA_CATEGORIES,
  SITE_DATA_STORAGES,
  classifySiteDataClearRequest,
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
