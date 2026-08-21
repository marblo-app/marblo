// analyticsUserKey — 공용 user_key 배선점 단위검증.
//
// 이 파일이 지키는 것은 하나다: **계정축 키는 공용 함수 한 벌에서만 나온다.**
// 값이 `pseudonymizeAnalyticsId("user", ...)` 와 한 글자라도 다르면 사람 축과
// 결제 원장의 조인이 조용히 빈다(에러가 아니라 0행). 그래서 같은지를 직접 잰다.

import assert from "node:assert/strict";
import test from "node:test";

import {
  ANALYTICS_ID_SALT_ENV,
  pseudonymizeAnalyticsId,
} from "./analyticsPseudonym";
import {
  ANALYTICS_USER_KEY_BLOCKER,
  resolveAnalyticsUserKeyFn,
} from "./analyticsUserKey";

const SALT = "test-salt-analytics-user-key";
const UID = "abcdefghijklmnopqrstuvwxyz12";

/** 솔트 env 를 세팅하고 원상복구한다(테스트 간 누수 금지). */
function withSalt<T>(salt: string | null, fn: () => T): T {
  const prev = process.env[ANALYTICS_ID_SALT_ENV];
  if (salt === null) delete process.env[ANALYTICS_ID_SALT_ENV];
  else process.env[ANALYTICS_ID_SALT_ENV] = salt;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[ANALYTICS_ID_SALT_ENV];
    else process.env[ANALYTICS_ID_SALT_ENV] = prev;
  }
}

test("배선됐다 — 더 이상 null 을 돌려주지 않는다(#1084 가 user kind 를 넣었다)", () => {
  const fn = resolveAnalyticsUserKeyFn();
  assert.equal(typeof fn, "function");
});

test("값이 공용 함수와 **완전히 같다** — 자체 HMAC 을 만들지 않았다는 증거", () => {
  withSalt(SALT, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    const expected = pseudonymizeAnalyticsId("user", UID, SALT);
    assert.equal(fn(UID), expected);
    assert.match(String(expected), /^us_[0-9a-f]{24}$/);
  });
});

test("결정적이다 — 같은 uid·같은 솔트면 같은 키(조인이 성립한다)", () => {
  withSalt(SALT, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    assert.equal(fn(UID), fn(UID));
  });
});

test("계정축 키는 익명축 키와 다르다 — 같은 원시값이어도 kind 가 가른다", () => {
  withSalt(SALT, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    assert.notEqual(fn(UID), pseudonymizeAnalyticsId("install", UID, SALT));
    assert.notEqual(fn(UID), pseudonymizeAnalyticsId("ga", UID, SALT));
  });
});

test("솔트가 없으면 행 단위로 null — 원시 uid 폴백 금지", () => {
  withSalt(null, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    const key = fn(UID);
    assert.equal(key, null);
    // ★혹시라도 원시 uid 가 새는 일이 없어야 한다.
    assert.notEqual(key, UID);
  });
});

test("빈 uid·공백 uid 는 null — 빈 키로 행을 만들지 않는다", () => {
  withSalt(SALT, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    assert.equal(fn(""), null);
    assert.equal(fn("   "), null);
  });
});

test("uid 앞뒤 공백은 다듬어도 같은 키가 된다", () => {
  withSalt(SALT, () => {
    const fn = resolveAnalyticsUserKeyFn();
    assert.ok(fn);
    assert.equal(fn(`  ${UID}  `), fn(UID));
  });
});

test("blocker 문구는 남아 있고, 원시값을 담지 않는다", () => {
  assert.ok(ANALYTICS_USER_KEY_BLOCKER.length > 0);
  assert.ok(!ANALYTICS_USER_KEY_BLOCKER.includes(SALT));
  assert.ok(!ANALYTICS_USER_KEY_BLOCKER.includes(UID));
});
