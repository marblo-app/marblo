// 토스페이먼츠 PG 직결 "진입 경로 차단"(1단계) 회귀 테스트.
// 실행: cd v3/functions && npm run test:toss-shutdown
//
// 이 테스트가 지키는 것은 두 방향이다.
//   (A) 토스 신규 진입이 실제로 닫혔는가 — 그리고 fail-closed 인가.
//   (B) ★닫으면서 같이 깨지면 안 되는 것들이 안 깨졌는가.
//       B 가 이 파일의 존재 이유다. 포트원은 지금 유일하게 열려 있는 결제
//       경로이고, hasPaymentEvidence 는 파운더 그랜트 판정에 물려 있다.
//       토스를 끄면서 이 둘 중 하나라도 건드리면 검증할 것도 없어진다.

import {
  isTossEntryEnabled,
  TOSS_ENTRY_DISABLED_CODE,
  TOSS_ENTRY_DISABLED_MESSAGE,
  hasPaymentEvidence,
  selectDueForCharge,
  applyChargeSuccess,
  applyChargeFailure,
  planAmountKRW,
  firstChargeLedgerId,
} from "../lib/billing.js";

let passed = 0;
let failed = 0;
function assert(cond, msg) {
  if (cond) {
    passed++;
  } else {
    failed++;
    console.error("  ✗ FAIL:", msg);
  }
}

// ─── (A) 게이트 자체 — fail-closed ────────────────────────────────────
{
  assert(
    isTossEntryEnabled("true") === true,
    '"true" 는 진입을 연다(롤백 스위치)',
  );
  assert(isTossEntryEnabled("TRUE") === true, "대문자 TRUE 도 연다");
  assert(isTossEntryEnabled(" true ") === true, "공백 패딩은 무시하고 연다");

  // 아래는 전부 "닫힘" 이어야 한다. 하나라도 열리면 의도치 않게 토스가 살아난다.
  assert(isTossEntryEnabled(undefined) === false, "미설정이면 닫힌다(기본값)");
  assert(isTossEntryEnabled(null) === false, "null 이면 닫힌다");
  assert(isTossEntryEnabled("") === false, "빈 문자열은 닫힌다");
  assert(isTossEntryEnabled("  ") === false, "공백만 있으면 닫힌다");
  assert(isTossEntryEnabled("1") === false, '"1" 은 열지 않는다(오타 방지)');
  assert(isTossEntryEnabled("yes") === false, '"yes" 는 열지 않는다');
  assert(isTossEntryEnabled("false") === false, '"false" 는 당연히 닫힌다');
  assert(isTossEntryEnabled("truthy") === false, '"truthy" 는 열지 않는다');

  assert(
    typeof TOSS_ENTRY_DISABLED_CODE === "string" &&
      TOSS_ENTRY_DISABLED_CODE.length > 0,
    "차단 코드가 정의돼 있다(클라이언트가 분기할 수 있게)",
  );
  assert(
    typeof TOSS_ENTRY_DISABLED_MESSAGE === "string" &&
      TOSS_ENTRY_DISABLED_MESSAGE.includes("포트원"),
    "차단 메시지가 사용자에게 대안(포트원)을 알려준다",
  );
}

// ─── (B-1) ★파운더 그랜트 판정이 안 깨졌는가 ──────────────────────────
// hasPaymentEvidence 는 "지금 유료" 가 아니라 "결제한 흔적이 있나" 다.
// 해지·실효한 前토스 결제자도 흔적은 남아야 한다. 토스 필드를 떼면 그랜트가
// 잘못 나간다 — 그래서 진입을 닫아도 이 판정은 그대로 남긴다.
{
  assert(
    hasPaymentEvidence({ tossBillingKey: "bk_live_xxx" }) === true,
    "★토스 빌링키는 진입 차단 후에도 결제 흔적으로 남는다",
  );
  assert(
    hasPaymentEvidence({ paddleSubscriptionId: "sub_123" }) === true,
    "패들 구독 ID 도 결제 흔적이다",
  );
  assert(
    hasPaymentEvidence({ tossBillingKey: "   " }) === false,
    "공백뿐인 빌링키는 흔적이 아니다",
  );
  assert(
    hasPaymentEvidence({ tossBillingKey: "" }) === false,
    "빈 빌링키는 흔적이 아니다",
  );
  assert(hasPaymentEvidence(null) === false, "구독 문서가 없으면 흔적 없음");
  assert(hasPaymentEvidence(undefined) === false, "undefined 도 흔적 없음");
  assert(
    hasPaymentEvidence({}) === false,
    "빈 문서는 흔적 없음(그랜트 대상이 될 수 있어야 한다)",
  );
}

// ─── (B-2) ★포트원 갱신 경로 회귀 0 ───────────────────────────────────
// 토스 크론(scheduledChargeSubscriptions)만 멈춘다. 포트원 갱신은 별도 크론
// (scheduledChargePortOneSubscriptions)이 돌고, 선정 로직은 이 순수 함수를
// 공유한다. 여기가 깨지면 살아 있는 유일한 결제가 갱신되지 않는다.
{
  const now = 1_700_000_000_000;
  const duePortone = {
    paymentProvider: "portone",
    status: "active",
    planType: "pro",
    billingCycle: "monthly",
    portoneBillingKey: "pbk_live_xxx",
    currentPeriodEndMs: now - 1000, // 만료 도래
  };
  assert(
    selectDueForCharge(duePortone, now) === true,
    "★포트원 만료 도래 구독은 여전히 갱신 대상으로 선정된다",
  );

  assert(
    selectDueForCharge(
      { ...duePortone, currentPeriodEndMs: now + 1000 },
      now,
    ) === false,
    "포트원 만료 전 구독은 청구하지 않는다",
  );
  assert(
    selectDueForCharge({ ...duePortone, portoneBillingKey: null }, now) ===
      false,
    "포트원 빌링키가 없으면 청구하지 않는다",
  );
  assert(
    selectDueForCharge({ ...duePortone, status: "past_due" }, now) === true,
    "포트원 past_due 는 재시도 대상이다",
  );
  assert(
    selectDueForCharge(
      { ...duePortone, status: "past_due", nextRetryAtMs: now + 60_000 },
      now,
    ) === false,
    "포트원 재시도 백오프 중에는 청구하지 않는다",
  );
  assert(
    selectDueForCharge({ ...duePortone, founderGrant: true }, now) === false,
    "무료 파운더 grant 는 포트원이어도 청구하지 않는다",
  );

  // 성공/실패 상태전이도 포트원이 그대로 쓴다.
  const ok = applyChargeSuccess(now, "monthly");
  assert(ok.status === "active", "청구 성공은 active 로 이어진다");
  assert(ok.billingFailedCount === 0, "청구 성공은 실패 카운터를 리셋한다");
  assert(
    ok.currentPeriodEnd.getTime() > now,
    "청구 성공은 다음 만료 경계를 미래로 민다",
  );
  const annual = applyChargeSuccess(now, "annual");
  assert(
    annual.billingCycle === "annual",
    "★연간 주기는 갱신 후에도 연간으로 유지된다(월간 강등 금지)",
  );

  const bad = applyChargeFailure({ ...duePortone, billingFailedCount: 0 }, now);
  assert(
    bad.status === "past_due",
    "첫 청구 실패는 즉시 해지가 아니라 past_due 유예다",
  );

  assert(
    planAmountKRW("pro", "monthly") > 0,
    "포트원 청구 금액 산정이 살아있다",
  );
  assert(
    firstChargeLedgerId("portone", "u1", "pro", "monthly").startsWith(
      "first_portone_",
    ),
    "포트원 첫청구 멱등키 생성이 살아있다",
  );
}

// ─── (B-3) 토스 선정 로직 자체는 남긴다 ───────────────────────────────
// 순수 함수는 건드리지 않고 크론 호출부에서 막는다. 함수까지 지우면 되살릴 때
// (롤백) 로직을 복원해야 하고, 과거 동작을 재현하는 테스트도 못 쓰게 된다.
{
  const now = 1_700_000_000_000;
  const dueToss = {
    paymentProvider: "toss",
    status: "active",
    planType: "pro",
    billingCycle: "monthly",
    tossBillingKey: "bk",
    tossCustomerKey: "ck",
    currentPeriodEndMs: now - 1000,
  };
  assert(
    selectDueForCharge(dueToss, now) === true,
    "토스 선정 순수 로직은 보존된다(차단은 크론 호출부에서 한다)",
  );
  assert(
    selectDueForCharge({ ...dueToss, tossBillingKey: null }, now) === false,
    "토스 빌링키가 없으면 선정되지 않는다",
  );
}

console.log(`\ntossEntryShutdown.test: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
