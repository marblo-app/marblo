// churnOutreach 순수 로직 단위테스트 (grantPlan.test.ts / betaSegments.test.ts 규약).
// 실행:
//   tsc src/churnOutreach.ts src/churnOutreach.test.ts \
//       --outDir .test-out/churn-outreach --module commonjs --target es2020 \
//       --esModuleInterop --strict --skipLibCheck \
//   && node --test .test-out/churn-outreach/churnOutreach.test.js
// package.json: npm run test:churn-outreach
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  churnBlockReasons,
  isChurnOutreachEligible,
  churnSegmentOf,
  resolveGrantAnchorMs,
  addMonthsMs,
  projectGrant,
  naiveAddedDays,
  buildChurnInterviewEmail,
  ChurnOutreachFacts,
  CHURN_OFFER_MONTHS,
  STILL_ACTIVE_WINDOW_DAYS,
  DEEP_CHURN_MIN_TOKENS,
} from "./churnOutreach";

const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 24, 0, 0, 0); // 2026-08-24
const daysAgo = (n: number): number => NOW - n * DAY;

/** 발송해도 되는 기준 사례(실측 A 를 본뜬 값). 각 테스트가 필요한 축만 뒤집는다. */
const baseFacts = (): ChurnOutreachFacts => ({
  hasEmail: true,
  totalTokens: 57_406_548,
  lastUsageAtMs: daysAgo(24),
  lastSeenAtMs: daysAgo(24),
  marketingConsentStatus: "pending",
  unsubscribeStatus: "subscribed",
  currentPeriodEndMs: Date.UTC(2026, 7, 29),
  subscriptionStatus: "active",
  hasPaymentEvidence: false,
});

// ── 적격 판정 ────────────────────────────────────────────────────────────────

test("이탈한 진성 사용자는 적격", () => {
  assert.deepEqual(churnBlockReasons(baseFacts(), NOW), []);
  assert.equal(isChurnOutreachEligible(baseFacts(), NOW), true);
});

test("마케팅 수신동의 철회자는 문면과 무관하게 차단", () => {
  const f = { ...baseFacts(), marketingConsentStatus: "revoked" as const };
  assert.ok(churnBlockReasons(f, NOW).includes("marketing_consent_revoked"));
  assert.equal(isChurnOutreachEligible(f, NOW), false);
});

test("수신거부자는 차단", () => {
  const f = { ...baseFacts(), unsubscribeStatus: "unsubscribed" as const };
  assert.ok(churnBlockReasons(f, NOW).includes("unsubscribed"));
});

test("결제 흔적이 있는 현역 구독자는 차단 — grant 가 결제를 덮어쓴다", () => {
  const f = { ...baseFacts(), hasPaymentEvidence: true };
  assert.ok(churnBlockReasons(f, NOW).includes("live_paid_subscriber"));
});

test("★founderGrant 잔재가 붙은 실결제자도 차단된다 — 결제 흔적만 보기 때문", () => {
  // index.ts isLivePaidSubscription 은 founderGrant===true 면 이 사람을 무료
  // grant 로 오판한다(실측 사례). 이 모듈은 그 플래그를 아예 입력받지 않아
  // 같은 오판을 재현하지 않는다.
  const f: ChurnOutreachFacts = {
    ...baseFacts(),
    hasPaymentEvidence: true,
    subscriptionStatus: "active",
    lastUsageAtMs: daysAgo(11),
    lastSeenAtMs: daysAgo(11),
    totalTokens: 262_875,
  };
  assert.ok(churnBlockReasons(f, NOW).includes("live_paid_subscriber"));
});

test("해지된 前결제자는 결제 흔적이 있어도 차단하지 않는다", () => {
  const f: ChurnOutreachFacts = {
    ...baseFacts(),
    hasPaymentEvidence: true,
    subscriptionStatus: "canceled",
  };
  assert.equal(
    churnBlockReasons(f, NOW).includes("live_paid_subscriber"),
    false
  );
});

test("최근 활동이 있으면 이탈로 부르지 않는다", () => {
  const f = { ...baseFacts(), lastSeenAtMs: daysAgo(0) };
  assert.ok(churnBlockReasons(f, NOW).includes("still_active"));

  const stale = {
    ...baseFacts(),
    lastSeenAtMs: daysAgo(STILL_ACTIVE_WINDOW_DAYS),
  };
  assert.equal(churnBlockReasons(stale, NOW).includes("still_active"), false);
});

test("토큰 사용이 없으면 이 캠페인 대상이 아니다", () => {
  const f = { ...baseFacts(), totalTokens: 0, lastUsageAtMs: null };
  assert.ok(churnBlockReasons(f, NOW).includes("never_activated"));
});

test("이메일이 없으면 차단", () => {
  assert.ok(
    churnBlockReasons({ ...baseFacts(), hasEmail: false }, NOW).includes(
      "no_email"
    )
  );
});

test("차단 사유는 하나만 보고 끊지 않고 전부 모은다", () => {
  const f: ChurnOutreachFacts = {
    ...baseFacts(),
    hasEmail: false,
    marketingConsentStatus: "revoked",
    unsubscribeStatus: "unsubscribed",
    totalTokens: 0,
    lastSeenAtMs: daysAgo(0),
  };
  const reasons = churnBlockReasons(f, NOW);
  assert.ok(reasons.includes("no_email"));
  assert.ok(reasons.includes("marketing_consent_revoked"));
  assert.ok(reasons.includes("unsubscribed"));
  assert.ok(reasons.includes("never_activated"));
  assert.ok(reasons.includes("still_active"));
});

// ── 세그먼트 ────────────────────────────────────────────────────────────────

test("세그먼트는 토큰 임계로 갈린다", () => {
  assert.equal(
    churnSegmentOf({ ...baseFacts(), totalTokens: 57_406_548 }),
    "deep_churn"
  );
  assert.equal(
    churnSegmentOf({ ...baseFacts(), totalTokens: DEEP_CHURN_MIN_TOKENS }),
    "deep_churn"
  );
  assert.equal(
    churnSegmentOf({ ...baseFacts(), totalTokens: 112_709 }),
    "light_trial"
  );
});

// ── 그랜트 실효 기간 ────────────────────────────────────────────────────────

test("앵커는 max(기존 만료일, now)", () => {
  const future = Date.UTC(2026, 10, 15);
  assert.equal(resolveGrantAnchorMs(future, NOW), future);
  assert.equal(resolveGrantAnchorMs(Date.UTC(2026, 6, 1), NOW), NOW);
  assert.equal(resolveGrantAnchorMs(null, NOW), NOW);
});

test("addMonthsMs 는 index.ts addMonths 와 같은 setMonth 규약", () => {
  assert.equal(
    addMonthsMs(Date.UTC(2026, 7, 24), 3),
    new Date(Date.UTC(2026, 7, 24)).setMonth(10)
  );
});

test("★기존 만료일 앵커는 항상 실제로 3개월을 더한다", () => {
  // 이미 Pro 가 4개월 남은 사람: now 앵커면 0일, 만료일 앵커면 온전히 3개월.
  const farEnd = Date.UTC(2026, 11, 24); // 2026-12-24
  assert.equal(naiveAddedDays(farEnd, NOW), 0);

  const projected = projectGrant(farEnd, NOW);
  assert.equal(projected.anchorMs, farEnd);
  assert.equal(
    projected.projectedEndMs,
    addMonthsMs(farEnd, CHURN_OFFER_MONTHS)
  );
  assert.ok(
    projected.addedDays >= 89 && projected.addedDays <= 92,
    `addedDays=${projected.addedDays}`
  );
});

test("만료가 코앞이어도 now 앵커는 3개월에 못 미친다 — 남은 기간만큼 깎인다", () => {
  const soonEnd = Date.UTC(2026, 7, 29); // 5일 뒤
  const projected = projectGrant(soonEnd, NOW);
  assert.equal(projected.anchorMs, soonEnd);
  assert.ok(projected.addedDays >= 89, `addedDays=${projected.addedDays}`);

  // now 앵커: max(8/29, 11/24) = 11/24 인데 기산점은 8/29 → 87일. 만료가
  // 코앞인 사람조차 온전한 3개월을 못 받는다. 남은 기간이 길수록 더 깎인다.
  const naive = naiveAddedDays(soonEnd, NOW);
  assert.equal(naive, 87);
  assert.ok(naive < projected.addedDays);
});

test("만료가 지난 사람은 now 를 앵커로 쓴다", () => {
  const pastEnd = Date.UTC(2026, 5, 1);
  const projected = projectGrant(pastEnd, NOW);
  assert.equal(projected.anchorMs, NOW);
  assert.equal(projected.projectedEndMs, addMonthsMs(NOW, CHURN_OFFER_MONTHS));
});

test("구독 문서가 없으면 now 앵커로 3개월", () => {
  const projected = projectGrant(null, NOW);
  assert.equal(projected.anchorMs, NOW);
  assert.equal(projected.projectedEndMs, addMonthsMs(NOW, CHURN_OFFER_MONTHS));
  assert.ok(projected.addedDays >= 89);
});

test("실효 기간은 절대 음수가 되지 않는다", () => {
  assert.ok(projectGrant(Date.UTC(2027, 11, 31), NOW).addedDays >= 0);
  assert.ok(naiveAddedDays(Date.UTC(2027, 11, 31), NOW) >= 0);
});

// ── 메일 문안 ───────────────────────────────────────────────────────────────

test("핵심 질문은 하나뿐이고 본문에 물음표도 하나뿐이다", () => {
  for (const locale of ["ko", "en"] as const) {
    for (const segment of ["deep_churn", "light_trial"] as const) {
      const mail = buildChurnInterviewEmail(locale, segment);
      const questionMarks = (mail.text.match(/[?？]/g) || []).length;
      assert.equal(
        questionMarks,
        1,
        `${locale}/${segment} 물음표 ${questionMarks}개`
      );
    }
  }
});

test("제목과 본문에 '무엇 때문에 멈추셨나요' 가 그대로 들어간다", () => {
  const mail = buildChurnInterviewEmail("ko", "deep_churn");
  assert.equal(mail.subject, "무엇 때문에 멈추셨나요?");
  assert.ok(mail.text.includes("무엇 때문에 멈추셨나요?"));
  assert.ok(mail.html.includes("무엇 때문에 멈추셨나요?"));
});

test("Pro 3개월 제안이 '남은 기간에 이어서' 로 정확히 표현된다", () => {
  const mail = buildChurnInterviewEmail("ko", "deep_churn");
  assert.ok(mail.text.includes("이어서 Pro 3개월"));
  const en = buildChurnInterviewEmail("en", "deep_churn");
  assert.ok(en.text.includes("on top of whatever time you have left"));
});

test("설문·양식 같은 조건을 달지 않는다", () => {
  for (const locale of ["ko", "en"] as const) {
    const mail = buildChurnInterviewEmail(locale, "deep_churn");
    assert.ok(/한 줄이면 충분|One line is enough/.test(mail.text));
    // "설문" 은 "설문도 없습니다" 라는 부정문으로만 등장해야 한다.
    if (mail.text.includes("설문")) {
      assert.ok(mail.text.includes("설문도, 양식도 없습니다"));
    }
  }
});

test("제품 자랑·기능 나열·개선 변명이 들어가지 않는다", () => {
  const banned = [
    "새로운 기능",
    "개선했습니다",
    "업데이트",
    "출시",
    "지원합니다",
    "new feature",
    "we fixed",
    "improved",
    "released",
  ];
  for (const locale of ["ko", "en"] as const) {
    for (const segment of ["deep_churn", "light_trial"] as const) {
      const mail = buildChurnInterviewEmail(locale, segment);
      for (const word of banned) {
        assert.equal(
          mail.text.toLowerCase().includes(word.toLowerCase()),
          false,
          `${locale}/${segment} 에 금지어 "${word}"`
        );
      }
    }
  }
});

test("짧다 — 본문 텍스트가 500자를 넘지 않는다", () => {
  for (const locale of ["ko", "en"] as const) {
    for (const segment of ["deep_churn", "light_trial"] as const) {
      const mail = buildChurnInterviewEmail(locale, segment);
      assert.ok(
        mail.text.length <= 500,
        `${locale}/${segment} ${mail.text.length}자`
      );
    }
  }
});

test("세그먼트별로 첫 문장만 달라진다", () => {
  const deep = buildChurnInterviewEmail("ko", "deep_churn");
  const light = buildChurnInterviewEmail("ko", "light_trial");
  assert.notEqual(deep.text.split("\n")[0], light.text.split("\n")[0]);
  assert.ok(deep.text.includes("실제 작업을 돌려보신 뒤"));
  assert.ok(light.text.includes("한 번 열어보신 뒤"));
  // 질문·제안·서명은 동일해야 한다(문면이 갈라져 관리가 흩어지지 않게).
  assert.equal(deep.subject, light.subject);
  assert.ok(light.text.includes("이어서 Pro 3개월"));
});

test("푸터 문의처는 team@marblo.app 로 고정", () => {
  for (const locale of ["ko", "en"] as const) {
    const mail = buildChurnInterviewEmail(locale, "deep_churn");
    assert.ok(mail.text.includes("team@marblo.app"));
    assert.ok(mail.html.includes("team@marblo.app"));
  }
});

test("HTML 은 수신거부 푸터를 붙일 수 있게 </body> 를 가진다", () => {
  // index.ts withUnsubscribeFooter 가 </body> 직전 삽입을 시도한다.
  const mail = buildChurnInterviewEmail("ko", "deep_churn");
  assert.ok(mail.html.includes("</body>"));
});
