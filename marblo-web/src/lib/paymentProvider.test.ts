import { test } from "node:test";
import assert from "node:assert/strict";
import { resolveCheckoutProvider } from "./paymentProvider";

test("기본값은 portone — env 미설정이 곧 포트원이다", () => {
  // ★이 테스트가 잡는 회귀가 이 티켓의 본체다. 이전 구현은 env 미설정 시
  // toss 로 떨어졌고, NEXT_PUBLIC_PAYMENT_PROVIDER 는 어느 환경 파일에도
  // 설정된 적이 없었다 — 즉 실 프로덕션 결제가 전부 토스로 가고 있었다.
  assert.equal(resolveCheckoutProvider({}), "portone");
  assert.equal(resolveCheckoutProvider({ envProvider: undefined }), "portone");
  assert.equal(resolveCheckoutProvider({ envProvider: null }), "portone");
  assert.equal(resolveCheckoutProvider({ envProvider: "" }), "portone");
  assert.equal(resolveCheckoutProvider({ envProvider: "   " }), "portone");
});

test("portone 을 명시해도 portone", () => {
  assert.equal(resolveCheckoutProvider({ envProvider: "portone" }), "portone");
  assert.equal(resolveCheckoutProvider({ envProvider: "PORTONE" }), "portone");
});

test("토스 복귀는 운영자가 env 로 명시할 때만 — 롤백 스위치", () => {
  assert.equal(resolveCheckoutProvider({ envProvider: "toss" }), "toss");
  assert.equal(resolveCheckoutProvider({ envProvider: "TOSS" }), "toss");
  assert.equal(resolveCheckoutProvider({ envProvider: " toss " }), "toss");
});

test("오타·유사값으로는 토스가 살아나지 않는다(fail-closed)", () => {
  for (const v of [
    "tos",
    "tosspayments",
    "toss ,portone",
    "1",
    "true",
    "yes",
  ]) {
    assert.equal(
      resolveCheckoutProvider({ envProvider: v }),
      "portone",
      `"${v}" 는 토스로 되돌리지 않아야 한다`,
    );
  }
});
