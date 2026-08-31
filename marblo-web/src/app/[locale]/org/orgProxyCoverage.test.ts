/**
 * ★`src/proxy.ts` matcher 가 `/org` 라우트를 덮는지 소스에서 고정한다.
 *
 * #1333 §3.2 는 "matcher 가 `/org/...` 를 이미 덮으므로 proxy 변경 0" 이라고
 * 판정했다. 이 테스트는 그 판정을 살아 있게 한다 — 누군가 matcher 를 좁히면
 * (예: 특정 경로 나열로 되돌리면) 여기서 깨지고, `/org` 가 로케일 협상 없이
 * 404 로 떨어지는 회귀를 막는다.
 *
 * next/server 를 import 하지 않으려고 소스를 텍스트로 읽는다(`team-usage-axis-guard`
 * 와 같은 소스 스캔 방식).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

function loadMatcher(): RegExp {
  const src = readFileSync(
    join(__dirname, "..", "..", "..", "proxy.ts"),
    "utf8"
  );
  const m = src.match(/matcher:\s*\[\s*"([^"]+)"\s*\]/);
  assert.ok(
    m,
    "proxy.ts 에서 matcher 를 찾지 못했다 — 모양이 바뀌었으면 이 테스트를 고쳐라"
  );
  // 소스 텍스트의 `\\.` 는 TS 문자열 리터럴 이스케이프다 — 정규식으로 쓰려면 푼다.
  const pattern = m[1].replace(/\\\\/g, "\\");
  // Next matcher 는 path-to-regexp 문법이지만, 이 matcher 는 정규식 그룹 하나라
  // 앵커만 붙이면 같은 판정이 된다(선행 `/` 포함 전체 경로에 건다).
  return new RegExp(`^${pattern}$`);
}

test("matcher 가 /org 세 라우트를 전부 덮는다 — #1333 'proxy 변경 0' 판정", () => {
  const re = loadMatcher();
  for (const path of [
    "/org",
    "/org/me",
    "/org/abc123",
    "/en/org",
    "/en/org/me",
    "/ja/org/abc123",
  ]) {
    assert.ok(re.test(path), `${path} 가 matcher 밖이다`);
  }
});

test("matcher 의 제외 대상은 그대로다 — api·_next·파일 확장자", () => {
  const re = loadMatcher();
  for (const path of ["/api/foo", "/_next/static/x", "/sitemap.xml"]) {
    assert.ok(!re.test(path), `${path} 는 matcher 밖이어야 한다`);
  }
});
