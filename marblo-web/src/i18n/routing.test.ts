import { test } from "node:test";
import assert from "node:assert/strict";
import {
  localeCookieAssignment,
  localeHasPrefix,
  localeHref,
  LOCALE_COOKIE_NAME,
  routing,
  searchLocales,
  xDefaultLocale,
} from "./routing";
import { localeUrl, SITE_URL } from "@/lib/seo";

const servedLocales = ["ko", "en", "ja"] as const;

test("Korean owns the site root; every other locale keeps its prefix", () => {
  assert.equal(routing.defaultLocale, "ko");
  assert.equal(routing.localePrefix, "as-needed");

  assert.equal(localeHasPrefix("ko"), false);
  assert.equal(localeHasPrefix("en"), true);
  assert.equal(localeHasPrefix("ja"), true);
});

test("localeHref drops the prefix for Korean and keeps it for en/ja", () => {
  assert.deepEqual(
    servedLocales.map((locale) => [locale, localeHref(locale, "/pricing")]),
    [
      ["ko", "/pricing"],
      ["en", "/en/pricing"],
      ["ja", "/ja/pricing"],
    ],
  );
});

test("localeHref never emits an empty href for the home page", () => {
  // `<Link href="">` is a same-page link, not the root — the `|| "/"` in
  // localeHref is what keeps every "go home" link pointing at the home page.
  assert.equal(localeHref("ko", ""), "/");
  assert.deepEqual(
    servedLocales.map((locale) => [locale, localeHref(locale, "/")]),
    [
      ["ko", "/"],
      ["en", "/en"],
      ["ja", "/ja"],
    ],
  );
});

test("localeHref carries query strings and hashes through untouched", () => {
  assert.equal(localeHref("ko", "/checkout?plan=pro"), "/checkout?plan=pro");
  assert.equal(localeHref("en", "/checkout?plan=pro"), "/en/checkout?plan=pro");
  assert.equal(localeHref("ko", "/#features"), "/#features");
  assert.equal(localeHref("en", "/#features"), "/en/#features");
});

test("localeCookieAssignment persists the next-intl locale cookie before navigation", () => {
  assert.equal(LOCALE_COOKIE_NAME, "NEXT_LOCALE");
  assert.deepEqual(
    servedLocales.map((locale) => localeCookieAssignment(locale)),
    [
      "NEXT_LOCALE=ko; path=/; SameSite=Lax",
      "NEXT_LOCALE=en; path=/; SameSite=Lax",
      "NEXT_LOCALE=ja; path=/; SameSite=Lax",
    ],
  );
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
