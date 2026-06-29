import { test } from "node:test";
import assert from "node:assert/strict";
import { sanitizeRedirect } from "./sanitizeRedirect";

const FALLBACK = "/ko";

test("allows internal relative paths", () => {
  assert.equal(sanitizeRedirect("/ko/pricing", FALLBACK), "/ko/pricing");
  assert.equal(sanitizeRedirect("/", FALLBACK), "/");
  assert.equal(
    sanitizeRedirect("/dashboard?tab=1#x", FALLBACK),
    "/dashboard?tab=1#x"
  );
});

test("falls back on empty / missing values", () => {
  assert.equal(sanitizeRedirect(null, FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect(undefined, FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("", FALLBACK), FALLBACK);
});

test("rejects protocol-relative URLs", () => {
  assert.equal(sanitizeRedirect("//evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("//evil.com/path", FALLBACK), FALLBACK);
});

test("rejects absolute URLs", () => {
  assert.equal(sanitizeRedirect("http://evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("https://evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("javascript:alert(1)", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("mailto:a@b.com", FALLBACK), FALLBACK);
});

test("rejects backslash tricks (browsers normalize \\ to /)", () => {
  assert.equal(sanitizeRedirect("/\\evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("\\/evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("\\\\evil.com", FALLBACK), FALLBACK);
});

test("rejects non-relative and control-char smuggling", () => {
  assert.equal(sanitizeRedirect("evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("relative/path", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("/\t/evil.com", FALLBACK), FALLBACK);
  assert.equal(sanitizeRedirect("/\nhttp://evil.com", FALLBACK), FALLBACK);
});
