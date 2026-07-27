import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RESEND_COOLDOWN_MS,
  buildVerifyContinueUrl,
  cooldownSeconds,
  isContinueUrlError,
  resendCooldownRemainingMs,
  verificationErrorKey,
  verifyPath,
} from "./emailVerification";

const PROD = "https://marblo.app";

test("continue url points at the locale verify route", () => {
  assert.equal(
    buildVerifyContinueUrl({ origin: PROD, locale: "en" }),
    "https://marblo.app/en/auth/verify"
  );
  assert.equal(
    buildVerifyContinueUrl({ origin: PROD, locale: "ko" }),
    "https://marblo.app/ko/auth/verify"
  );
});

test("continue url keeps the dev/preview origin it was given", () => {
  assert.equal(
    buildVerifyContinueUrl({ origin: "http://localhost:3000", locale: "en" }),
    "http://localhost:3000/en/auth/verify"
  );
  // Trailing path on the origin is discarded — URL.origin only keeps scheme+host.
  assert.equal(
    buildVerifyContinueUrl({
      origin: "https://preview.marblo.app/x",
      locale: "ja",
    }),
    "https://preview.marblo.app/ja/auth/verify"
  );
});

test("continue url falls back to production for unusable origins", () => {
  for (const origin of [
    null,
    undefined,
    "",
    "not a url",
    "javascript:alert(1)",
  ]) {
    assert.equal(
      buildVerifyContinueUrl({ origin, locale: "en" }),
      "https://marblo.app/en/auth/verify",
      `origin=${String(origin)}`
    );
  }
});

test("continue url carries a safe redirect through", () => {
  assert.equal(
    buildVerifyContinueUrl({
      origin: PROD,
      locale: "en",
      redirect: "/en/beta-survey",
    }),
    "https://marblo.app/en/auth/verify?redirect=%2Fen%2Fbeta-survey"
  );
});

test("continue url drops hostile redirects — the link ships in an email", () => {
  for (const redirect of [
    "//evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/\\evil.com",
  ]) {
    assert.equal(
      buildVerifyContinueUrl({ origin: PROD, locale: "en", redirect }),
      "https://marblo.app/en/auth/verify",
      `redirect=${redirect}`
    );
  }
});

test("continue url drops a self-referential redirect", () => {
  assert.equal(
    buildVerifyContinueUrl({
      origin: PROD,
      locale: "ko",
      redirect: verifyPath("ko"),
    }),
    "https://marblo.app/ko/auth/verify"
  );
});

test("cooldown counts down and expires", () => {
  const now = 1_000_000;
  assert.equal(resendCooldownRemainingMs(now, now), RESEND_COOLDOWN_MS);
  assert.equal(
    resendCooldownRemainingMs(now - 20_000, now),
    RESEND_COOLDOWN_MS - 20_000
  );
  assert.equal(resendCooldownRemainingMs(now - RESEND_COOLDOWN_MS, now), 0);
  assert.equal(resendCooldownRemainingMs(now - 999_999, now), 0);
});

test("cooldown fails open on missing or corrupt timestamps", () => {
  const now = 1_000_000;
  assert.equal(resendCooldownRemainingMs(null, now), 0);
  assert.equal(resendCooldownRemainingMs(undefined, now), 0);
  assert.equal(resendCooldownRemainingMs(Number.NaN, now), 0);
  // Future-dated (clock skew / tampered storage) must not lock the user out.
  assert.equal(resendCooldownRemainingMs(now + 999_999, now), 0);
});

test("cooldown seconds round up so the label never shows 0 while waiting", () => {
  assert.equal(cooldownSeconds(60_000), 60);
  assert.equal(cooldownSeconds(1), 1);
  assert.equal(cooldownSeconds(0), 0);
  assert.equal(cooldownSeconds(-5), 0);
});

test("error codes map to distinct user-facing keys", () => {
  assert.equal(
    verificationErrorKey("auth/too-many-requests"),
    "error_too_many"
  );
  assert.equal(
    verificationErrorKey("auth/network-request-failed"),
    "error_network"
  );
  assert.equal(
    verificationErrorKey("auth/user-token-expired"),
    "error_session"
  );
  assert.equal(verificationErrorKey("auth/user-disabled"), "error_session");
  assert.equal(verificationErrorKey("auth/internal-error"), "error_generic");
  assert.equal(verificationErrorKey(undefined), "error_generic");
});

test("only continue-url failures trigger the no-continueUrl retry", () => {
  assert.equal(isContinueUrlError("auth/unauthorized-continue-uri"), true);
  assert.equal(isContinueUrlError("auth/invalid-continue-uri"), true);
  assert.equal(isContinueUrlError("auth/missing-continue-uri"), true);
  assert.equal(isContinueUrlError("auth/too-many-requests"), false);
  assert.equal(isContinueUrlError(null), false);
});
