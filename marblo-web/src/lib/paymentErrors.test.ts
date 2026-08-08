import { test } from "node:test";
import assert from "node:assert/strict";
import {
  extractErrorCode,
  isUnsupportedEasyPayCode,
  isUserCancelCode,
  isUserCancelMessage,
  mapFailPageParams,
  mapPaymentError,
  shouldShowTestCardHint,
} from "./paymentErrors";

test("isUserCancelCode accepts PortOne/Toss cancel variants", () => {
  assert.equal(isUserCancelCode("USER_CANCEL"), true);
  assert.equal(isUserCancelCode("user_cancelled"), true);
  assert.equal(isUserCancelCode("PAY_PROCESS_CANCELED"), true);
  assert.equal(isUserCancelCode("INVALID_CARD"), false);
  assert.equal(isUserCancelCode(null), false);
});

test("isUserCancelMessage detects Korean/English cancel phrasing", () => {
  assert.equal(isUserCancelMessage("사용자가 결제를 취소했습니다"), true);
  assert.equal(isUserCancelMessage("Payment cancelled by user"), true);
  assert.equal(isUserCancelMessage("card declined"), false);
});

test("mapPaymentError: USER_CANCEL is soft", () => {
  const m = mapPaymentError({ code: "USER_CANCEL", message: "취소" });
  assert.equal(m.key, "paymentCancelled");
  assert.equal(m.tone, "soft");
  assert.equal(m.canRetryFirstCharge, false);
});

test("mapPaymentError: business codes from callables", () => {
  assert.equal(
    mapPaymentError({ message: "already_subscribed" }).key,
    "alreadySubscribed",
  );
  assert.equal(
    mapPaymentError({ message: "already_subscribed" }).alreadySubscribed,
    true,
  );
  const first = mapPaymentError({
    code: "failed-precondition",
    message: "first_charge_failed",
  });
  assert.equal(first.key, "firstChargeFailed");
  assert.equal(first.canRetryFirstCharge, true);

  assert.equal(
    mapPaymentError({ code: "aborted", message: "payment_in_progress" }).key,
    "paymentInProgress",
  );
  assert.equal(
    mapPaymentError({ message: "payment_not_paid" }).key,
    "paymentNotPaid",
  );
});

test("mapPaymentError: Firebase network codes", () => {
  const m = mapPaymentError({
    code: "functions/unavailable",
    message: "DEADLINE",
  });
  assert.equal(m.key, "networkError");
  assert.equal(m.tone, "network");
});

test("mapPaymentError: unsupported card codes", () => {
  const m = mapPaymentError({
    code: "INVALID_CARD",
    message: "지원하지 않는 카드",
  });
  assert.equal(m.key, "unsupportedCard");
});

test("mapPaymentError: technical payment_not_paid does not pass raw as key", () => {
  const m = mapPaymentError(new Error("payment_not_paid"));
  assert.equal(m.key, "paymentNotPaid");
});

test("mapFailPageParams unifies Toss cancel UX", () => {
  const soft = mapFailPageParams("PAY_PROCESS_CANCELED", "취소");
  assert.equal(soft.tone, "soft");
  assert.equal(soft.key, "paymentCancelled");

  const hard = mapFailPageParams("INVALID_CARD", "카드 오류");
  assert.equal(hard.key, "unsupportedCard");
});

test("extractErrorCode pulls UPPER_SNAKE tokens", () => {
  assert.equal(extractErrorCode("fail USER_CANCEL end"), "USER_CANCEL");
  assert.equal(
    extractErrorCode({ code: "INVALID_CARD", message: "x" }),
    "INVALID_CARD",
  );
});

test("easy-pay (TossPay) cancel codes are soft, not hard failures", () => {
  assert.equal(isUserCancelCode("EASY_PAY_CANCEL"), true);
  assert.equal(isUserCancelCode("tosspay_cancel"), true);
  assert.equal(isUserCancelCode("PORTONE_CANCEL"), true);

  const m = mapPaymentError({ code: "EASY_PAY_CANCEL", message: "" });
  assert.equal(m.key, "paymentCancelled");
  assert.equal(m.tone, "soft");
});

test("unsupported easy-pay maps to paymentMethodUnsupported, not unsupportedCard", () => {
  assert.equal(isUnsupportedEasyPayCode("EASY_PAY_NOT_SUPPORTED"), true);
  assert.equal(isUnsupportedEasyPayCode("easy_pay_provider_unsupported"), true);
  assert.equal(isUnsupportedEasyPayCode("INVALID_CARD"), false);
  assert.equal(isUnsupportedEasyPayCode(null), false);

  // 서버 callable 이 던지는 비즈니스 코드(소문자)도 잡혀야 한다.
  const fromServer = mapPaymentError({
    code: "functions/invalid-argument",
    message: "easy_pay_provider_unsupported",
  });
  assert.equal(fromServer.key, "paymentMethodUnsupported");
  assert.equal(fromServer.canRetryFirstCharge, false);

  // 빌링키 발급 수동 승인 실패도 결제수단을 바꾸라고 안내한다.
  const confirmFail = mapPaymentError(new Error("billing_key_confirm_failed"));
  assert.equal(confirmFail.key, "paymentMethodUnsupported");

  // ★카드 거절은 여전히 카드 문구로 남아야 한다(간편결제 분기가 삼키면 안 됨).
  assert.equal(
    mapPaymentError({ code: "INVALID_CARD" }).key,
    "unsupportedCard",
  );
});

test("shouldShowTestCardHint is true outside production", () => {
  // unit tests run under NODE_ENV=test (or development)
  assert.equal(typeof shouldShowTestCardHint(), "boolean");
  if (process.env.NODE_ENV !== "production") {
    assert.equal(shouldShowTestCardHint(), true);
  }
});
