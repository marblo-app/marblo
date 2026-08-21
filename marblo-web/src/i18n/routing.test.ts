import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localeHasPrefix,
  localeHref,
  routing,
  searchLocales,
  xDefaultLocale,
} from "./routing";
import { localeUrl, SITE_URL } from "@/lib/seo";

test("Korean owns the site root; every other locale keeps its prefix", () => {
  assert.equal(routing.defaultLocale, "ko");
  assert.equal(routing.localePrefix, "as-needed");

  assert.equal(localeHasPrefix("ko"), false);
  assert.equal(localeHasPrefix("en"), true);
  assert.equal(localeHasPrefix("ja"), true);
});

test("localeHref drops the prefix for Korean and keeps it for en/ja", () => {
  assert.equal(localeHref("ko", "/pricing"), "/pricing");
  assert.equal(localeHref("en", "/pricing"), "/en/pricing");
  assert.equal(localeHref("ja", "/pricing"), "/ja/pricing");
});

test("localeHref never emits an empty href for the home page", () => {
  // `<Link href="">` is a same-page link, not the root — the `|| "/"` in
  // localeHref is what keeps every "go home" link pointing at the home page.
  assert.equal(localeHref("ko"), "/");
  assert.equal(localeHref("ko", ""), "/");
  assert.equal(localeHref("ko", "/"), "/");
  assert.equal(localeHref("en"), "/en");
  assert.equal(localeHref("en", "/"), "/en");
});

test("localeHref carries query strings and hashes through untouched", () => {
  assert.equal(localeHref("ko", "/checkout?plan=pro"), "/checkout?plan=pro");
  assert.equal(localeHref("en", "/checkout?plan=pro"), "/en/checkout?plan=pro");
  assert.equal(localeHref("ko", "/#features"), "/#features");
  assert.equal(localeHref("en", "/#features"), "/en/#features");
});

test("localeUrl is the absolute form of the same rule", () => {
  assert.equal(localeUrl("ko", "/pricing"), `${SITE_URL}/pricing`);
  assert.equal(localeUrl("en", "/pricing"), `${SITE_URL}/en/pricing`);
  // Root normalizes to the bare origin so it matches the canonical Next
  // stamps into <head>; see the comment on localeUrl.
  assert.equal(localeUrl("ko"), SITE_URL);
  assert.equal(localeUrl("ko", "/"), SITE_URL);
  assert.equal(localeUrl("en"), `${SITE_URL}/en`);
});

test("x-default follows the default locale and stays inside searchLocales", () => {
  assert.equal(xDefaultLocale, "ko");
  assert.ok((searchLocales as readonly string[]).includes(xDefaultLocale));
  // The sitemap and the <head> cluster must agree; both derive from this.
  assert.equal(localeUrl(xDefaultLocale, "/pricing"), `${SITE_URL}/pricing`);
});
