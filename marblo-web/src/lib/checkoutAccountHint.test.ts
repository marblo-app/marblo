import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ACCOUNT_HINT_PARAM,
  createAccountHint,
  verifyAccountHint,
  shouldBlockCheckout,
} from "./checkoutAccountHint";

/**
 * 데스크톱 앱 → 웹 체크아웃 계정 핸드오프 힌트 (티켓 3Notu54M).
 *
 * ★아래 벡터는 v3/tests/lib/checkoutAccountHint.test.ts 와 **같은 값**이어야
 * 한다. 두 저장소는 패키지를 공유하지 않으므로, 알고리즘이 어긋나면 웹이
 * 항상 "불일치" 를 띄워 앱에서 온 결제가 전부 막힌다. 한쪽을 바꾸면 다른
 * 쪽도 같이 바꿔라.
 */
const NONCE = "0123456789abcdef";
const HINT_A = `1.${NONCE}.56317b4a5d2e5ef436750eaeb319aebd`;
const HINT_B = `1.${NONCE}.2400349bb386a6d9f5f6baf41cb99d45`;

test("★공유 벡터: 데스크톱(v3)과 같은 입력에 같은 힌트", async () => {
  assert.equal(await createAccountHint("user-A", NONCE), HINT_A);
  assert.equal(await createAccountHint("user-B", NONCE), HINT_B);
});

test("쿼리 파라미터 이름은 acct (데스크톱과의 계약)", () => {
  assert.equal(ACCOUNT_HINT_PARAM, "acct");
});

test("앱 계정 = 브라우저 계정이면 match, 다르면 mismatch", async () => {
  assert.equal(await verifyAccountHint(HINT_A, "user-A"), "match");
  assert.equal(await verifyAccountHint(HINT_A, "user-B"), "mismatch");
  assert.equal(await verifyAccountHint(HINT_B, "user-B"), "match");
});

test("힌트가 없으면 none — 웹에 직접 들어온 방문은 검사 대상이 아니다", async () => {
  assert.equal(await verifyAccountHint(null, "user-A"), "none");
  assert.equal(await verifyAccountHint(undefined, "user-A"), "none");
});

test("★깨진 힌트는 invalid — 결제를 막지도(오판) 통과시키지도 않는다", async () => {
  for (const bad of [
    "",
    "garbage",
    `2.${NONCE}.56317b4a5d2e5ef436750eaeb319aebd`,
    `1.${NONCE}`,
    `1.${NONCE}.zz317b4a5d2e5ef436750eaeb319aebd`,
  ]) {
    assert.equal(await verifyAccountHint(bad, "user-A"), "invalid", bad);
  }
});

test("★결제 전 차단 규칙: mismatch 이고 사용자가 아직 고르지 않았을 때만 막는다", () => {
  // 앱은 A, 브라우저는 B — 사람이 어느 계정으로 결제할지 고르기 전엔 결제 버튼이 없다.
  assert.equal(shouldBlockCheckout("mismatch", false), true);
  // "이 계정으로 계속" 을 명시적으로 고르면 진행한다(고지는 화면에 남는다).
  assert.equal(shouldBlockCheckout("mismatch", true), false);
  // 나머지는 막지 않는다 — 힌트 없음/깨짐/일치는 기존 흐름 그대로.
  assert.equal(shouldBlockCheckout("none", false), false);
  assert.equal(shouldBlockCheckout("invalid", false), false);
  assert.equal(shouldBlockCheckout("match", false), false);
});
