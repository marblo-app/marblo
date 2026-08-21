import { test } from "node:test";
import assert from "node:assert/strict";
import { canonicalTarget, isWwwHost, CANONICAL_HOST } from "./canonicalHost";

test("isWwwHost matches only the production www alias", () => {
  assert.equal(isWwwHost("www.marblo.app"), true);
  assert.equal(isWwwHost("WWW.MARBLO.APP"), true);
  assert.equal(isWwwHost("www.marblo.app:443"), true);

  assert.equal(isWwwHost("marblo.app"), false);
  assert.equal(isWwwHost("localhost:3000"), false);
  assert.equal(isWwwHost("marblo-web.vercel.app"), false);
  // Must not match a look-alike that merely ends with the apex.
  assert.equal(isWwwHost("evil-www.marblo.app.attacker.com"), false);
  assert.equal(isWwwHost(null), false);
  assert.equal(isWwwHost(undefined), false);
  assert.equal(isWwwHost(""), false);
});

test("locale-less www root collapses to a single hop at the negotiated locale", () => {
  // This is the whole point: the live chain was
  //   https://www.marblo.app/ →301→ https://marblo.app/ →307→ /en
  // and must become one redirect.
  assert.deepEqual(canonicalTarget("https://www.marblo.app/", "/en"), {
    url: "https://marblo.app/en",
    status: 307,
  });
  assert.deepEqual(canonicalTarget("https://www.marblo.app/", "/ko"), {
    url: "https://marblo.app/ko",
    status: 307,
  });
});

test("already-prefixed www paths keep the permanent hostname swap", () => {
  assert.deepEqual(
    canonicalTarget("https://www.marblo.app/en/pricing", null),
    { url: "https://marblo.app/en/pricing", status: 301 }
  );
  assert.deepEqual(canonicalTarget("https://www.marblo.app/", null), {
    url: "https://marblo.app/",
    status: 301,
  });
});

test("query strings survive both branches", () => {
  assert.equal(
    canonicalTarget("https://www.marblo.app/ko/pricing?utm_source=x", null).url,
    "https://marblo.app/ko/pricing?utm_source=x"
  );
  // next-intl carries the query on its own Location…
  assert.equal(
    canonicalTarget("https://www.marblo.app/pricing?a=1", "/en/pricing?a=1").url,
    "https://marblo.app/en/pricing?a=1"
  );
  // …and if it ever stops doing so, we re-attach it rather than drop it.
  assert.equal(
    canonicalTarget("https://www.marblo.app/pricing?a=1", "/en/pricing").url,
    "https://marblo.app/en/pricing?a=1"
  );
});

test("the target is always https on the apex, never www", () => {
  for (const [requestUrl, location] of [
    ["http://www.marblo.app/", "/en"],
    ["https://www.marblo.app:443/ja/guide", null],
    // A non-default port must be dropped, not carried onto the apex.
    ["http://www.marblo.app:3399/", "/en"],
    ["https://www.marblo.app/en", null],
  ] as const) {
    const { url } = canonicalTarget(requestUrl, location);
    const parsed = new URL(url);
    assert.equal(parsed.protocol, "https:");
    assert.equal(parsed.host, CANONICAL_HOST);
    // No loop is possible: the destination host is never a redirect source.
    assert.equal(isWwwHost(parsed.host), false);
  }
});
