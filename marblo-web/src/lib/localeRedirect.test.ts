import { test } from "node:test";
import assert from "node:assert/strict";
import {
  isPermanentLocaleRedirect,
  stripDefaultLocalePrefix,
} from "./localeRedirect";

const KO = "ko";
const REQ = (path: string) => `https://marblo.app${path}`;

test("stripDefaultLocalePrefix collapses only the default locale's prefix", () => {
  assert.equal(stripDefaultLocalePrefix("/ko/pricing", KO), "/pricing");
  assert.equal(
    stripDefaultLocalePrefix("/ko/blog/what-is-marblo", KO),
    "/blog/what-is-marblo"
  );
  assert.equal(stripDefaultLocalePrefix("/ko", KO), "/");
  assert.equal(stripDefaultLocalePrefix("/ko/", KO), "/");

  // Other locales keep their prefix — this is the guard that stops the
  // migration from silently un-prefixing /en and /ja too.
  assert.equal(stripDefaultLocalePrefix("/en/pricing", KO), null);
  assert.equal(stripDefaultLocalePrefix("/ja/pricing", KO), null);
  assert.equal(stripDefaultLocalePrefix("/en", KO), null);

  // Already-stripped paths have nothing to do.
  assert.equal(stripDefaultLocalePrefix("/pricing", KO), null);
  assert.equal(stripDefaultLocalePrefix("/", KO), null);

  // A path that merely STARTS with the letters "ko" is not a locale prefix.
  assert.equal(stripDefaultLocalePrefix("/korean-guide", KO), null);
  assert.equal(stripDefaultLocalePrefix("/kokomo", KO), null);
});

test("trailing slashes are normalized before comparison", () => {
  assert.equal(stripDefaultLocalePrefix("/ko/pricing/", KO), "/pricing");
});

test("the default-prefix strip is permanent", () => {
  // /ko/pricing → /pricing. Structural, identical for every visitor, and the
  // status code that actually moves the existing index entry.
  assert.equal(
    isPermanentLocaleRedirect(
      "/ko/pricing",
      "https://marblo.app/pricing",
      REQ("/ko/pricing"),
      KO
    ),
    true
  );
  assert.equal(
    isPermanentLocaleRedirect("/ko", "https://marblo.app/", REQ("/ko"), KO),
    true
  );
  // next-intl preserves the query string on the hop; that must not defeat the
  // pathname comparison.
  assert.equal(
    isPermanentLocaleRedirect(
      "/ko/checkout",
      "https://marblo.app/checkout?plan=pro",
      REQ("/ko/checkout?plan=pro"),
      KO
    ),
    true
  );
});

test("negotiated locale redirects stay temporary", () => {
  // /pricing → /en/pricing is chosen from Accept-Language or the NEXT_LOCALE
  // cookie. A 301 here would pin a visitor's browser to English forever.
  assert.equal(
    isPermanentLocaleRedirect(
      "/pricing",
      "https://marblo.app/en/pricing",
      REQ("/pricing"),
      KO
    ),
    false
  );
  assert.equal(
    isPermanentLocaleRedirect("/", "https://marblo.app/ja", REQ("/"), KO),
    false
  );
  // Non-default prefixes are never stripped, so nothing about them is permanent.
  assert.equal(
    isPermanentLocaleRedirect(
      "/en/pricing",
      "https://marblo.app/ja/pricing",
      REQ("/en/pricing"),
      KO
    ),
    false
  );
});

test("a /ko URL that redirects somewhere unexpected is NOT treated as permanent", () => {
  // Defensive: only the exact strip target earns a 301. If next-intl ever sends
  // a /ko/* URL anywhere else, fall back to its own 307 rather than burning a
  // permanent redirect into every browser cache.
  assert.equal(
    isPermanentLocaleRedirect(
      "/ko/pricing",
      "https://marblo.app/en/pricing",
      REQ("/ko/pricing"),
      KO
    ),
    false
  );
});

test("no redirect at all is never permanent", () => {
  assert.equal(
    isPermanentLocaleRedirect("/ko/pricing", null, REQ("/ko/pricing"), KO),
    false
  );
  assert.equal(
    isPermanentLocaleRedirect("/pricing", undefined, REQ("/pricing"), KO),
    false
  );
});
