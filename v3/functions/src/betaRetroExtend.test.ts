// betaRetroExtend 단위 테스트 — node:test. devDependency 추가 없음.
//   npm run test:beta-retro-extend
//
// 이 테스트가 지키는 것은 세 가지다:
//  1) 현역 유료 구독을 절대 건드리지 않는다(과금 중단 사고).
//  2) 계정 O / 계정 X 문면이 **서로 다르고**, 계정 X 문면에 "돌아왔습니다"류의
//     거짓 전제가 들어가지 않는다.
//  3) 수신동의 철회자에게는 어떤 근거로도 메일이 나가지 않되, **접근권 소급은
//     그대로 간다**(메일 못 보내는 것과 권리를 뺏는 것은 다른 문제).
import assert from "node:assert/strict";
import test from "node:test";

import {
  BETA_RETRO_EXTEND_REASON,
  RETRO_CONSENT_BASIS,
  buildBetaRetroExtendEmail,
  classifyRetroTarget,
  isLivePaidSubscription,
  addMonthsMs,
  retroBlockReasons,
  selectRetroAudience,
  toExpiresOn,
  type RetroCandidate,
  type RetroContactFacts,
  type RetroFounderFacts,
  type RetroLocale,
  type RetroSubscriptionFacts,
} from "./betaRetroExtend";

const NOW = Date.parse("2026-08-29T00:00:00.000Z");
const BETA_MONTHS = 3;
const DAY = 24 * 60 * 60 * 1000;

/** 실측 패턴: 2026-07-14 선정 → 구 정책으로 2026-08-14 만료. */
const ACCESS_GRANTED = Date.parse("2026-07-14T00:00:00.000Z");
const OLD_END = Date.parse("2026-08-14T00:00:00.000Z");

function founder(over: Partial<RetroFounderFacts> = {}): RetroFounderFacts {
  return {
    status: "selected",
    accessGrantedAtMs: ACCESS_GRANTED,
    betaExpiresAtMs: OLD_END,
    proExpiresAtMs: null,
    ...over,
  };
}

function sub(
  over: Partial<RetroSubscriptionFacts> = {},
): RetroSubscriptionFacts {
  return {
    status: "canceled",
    founderGrant: true,
    paymentProvider: "founder_grant",
    hasPaymentEvidence: false,
    currentPeriodEndMs: OLD_END,
    ...over,
  };
}

function contact(over: Partial<RetroContactFacts> = {}): RetroContactFacts {
  return {
    hasEmail: true,
    marketingConsentStatus: "pending",
    unsubscribeStatus: "subscribed",
    ...over,
  };
}

function candidate(
  idHash: string,
  over: Partial<RetroCandidate> = {},
): RetroCandidate {
  return {
    docId: `${idHash}@example.com`,
    idHash,
    email: `${idHash}@example.com`,
    uid: "uid-1",
    locale: "ko",
    founder: founder(),
    sub: sub(),
    contact: contact(),
    lastSentAtMs: null,
    ...over,
  };
}

// ── 1. 소급 판정 ────────────────────────────────────────────────────────────

test("addMonthsMs 는 setMonth 규약(월경계 넘김)을 그대로 따른다", () => {
  const jan31 = Date.parse("2026-01-31T00:00:00.000Z");
  // 1/31 + 1개월 = 3/3 (2026 은 평년) — index.ts addMonths 와 같은 동작.
  assert.equal(toExpiresOn(addMonthsMs(jan31, 1)), "2026-03-03");
});

test("만료된 founder_grant 는 revive — 창이 7/14+3개월로 열린다", () => {
  const v = classifyRetroTarget(founder(), sub(), NOW, BETA_MONTHS);
  if (v.action === "skip") {
    assert.fail(`revive 여야 하는데 skip(${v.reason}) 이 나왔다`);
  }
  assert.equal(v.action, "revive");
  assert.equal(toExpiresOn(v.targetMs), "2026-10-14");
  assert.ok(v.addedDays > 0);
});

test("아직 살아있는 사람은 revive 가 아니라 extend 로 센다", () => {
  const alive = sub({
    status: "active",
    currentPeriodEndMs: NOW + 10 * DAY,
  });
  const v = classifyRetroTarget(founder(), alive, NOW, BETA_MONTHS);
  assert.equal(v.action, "extend");
});

test("★현역 유료 구독은 절대 건드리지 않는다(live_paid_guard)", () => {
  const paid = sub({
    status: "active",
    founderGrant: false,
    paymentProvider: "portone",
    hasPaymentEvidence: true,
    currentPeriodEndMs: NOW + 5 * DAY,
  });
  assert.equal(isLivePaidSubscription(paid), true);
  const v = classifyRetroTarget(founder(), paid, NOW, BETA_MONTHS);
  assert.equal(v.action, "skip");
  if (v.action !== "skip") return;
  assert.equal(v.reason, "live_paid_guard");
});

test("founderGrant 플래그가 남아 있으면 status=active 여도 유료가 아니다", () => {
  const grantLeftover = sub({
    status: "active",
    founderGrant: true,
    hasPaymentEvidence: true,
  });
  assert.equal(isLivePaidSubscription(grantLeftover), false);
});

test("이미 더 긴 기간을 가진 사람은 already_longer — 기간을 줄이지 않는다", () => {
  const longer = sub({
    currentPeriodEndMs: Date.parse("2027-01-01T00:00:00Z"),
  });
  const v = classifyRetroTarget(founder(), longer, NOW, BETA_MONTHS);
  assert.equal(v.action, "skip");
  if (v.action !== "skip") return;
  assert.equal(v.reason, "already_longer");
});

test("소급해도 이미 지난 창이면 still_expired_after_retro", () => {
  const old = founder({
    accessGrantedAtMs: Date.parse("2026-01-01T00:00:00.000Z"),
    betaExpiresAtMs: Date.parse("2026-02-01T00:00:00.000Z"),
  });
  const v = classifyRetroTarget(old, sub(), NOW, BETA_MONTHS);
  assert.equal(v.action, "skip");
  if (v.action !== "skip") return;
  assert.equal(v.reason, "still_expired_after_retro");
});

test("proExpiresAt(설문·인터뷰 보상)이 더 길면 그쪽을 target 으로 쓴다", () => {
  const rewarded = founder({
    proExpiresAtMs: Date.parse("2026-12-14T00:00:00.000Z"),
  });
  const v = classifyRetroTarget(rewarded, sub(), NOW, BETA_MONTHS);
  assert.notEqual(v.action, "skip");
  if (v.action === "skip") return;
  assert.equal(toExpiresOn(v.targetMs), "2026-12-14");
});

test("반려·선정흔적 없음은 소급 대상이 아니다", () => {
  const rejected = classifyRetroTarget(
    founder({ status: "rejected" }),
    sub(),
    NOW,
    BETA_MONTHS,
  );
  assert.equal(rejected.action, "skip");
  const noGrant = classifyRetroTarget(
    founder({ accessGrantedAtMs: null }),
    sub(),
    NOW,
    BETA_MONTHS,
  );
  assert.equal(noGrant.action, "skip");
});

test("구독 문서가 아예 없어도(계정 X) revive 로 판정된다", () => {
  const v = classifyRetroTarget(founder(), null, NOW, BETA_MONTHS);
  assert.equal(v.action, "revive");
});

// ── 2. 동의 게이트 ──────────────────────────────────────────────────────────

test("코호트별 발송 근거: 계정 O 는 relationship, 계정 X 는 granted_only", () => {
  assert.equal(RETRO_CONSENT_BASIS.account, "relationship");
  assert.equal(RETRO_CONSENT_BASIS.no_account, "granted_only");
});

test("★철회자는 어떤 근거로도 통과하지 못한다", () => {
  const revoked = contact({ marketingConsentStatus: "revoked" });
  for (const basis of ["granted_only", "relationship"] as const) {
    assert.ok(
      retroBlockReasons(revoked, basis).includes("marketing_consent_revoked"),
      `basis=${basis} 에서 철회자가 통과했다`,
    );
  }
});

test("pending 은 relationship 에선 통과하고 granted_only 에선 막힌다", () => {
  const pending = contact({ marketingConsentStatus: "pending" });
  assert.deepEqual(retroBlockReasons(pending, "relationship"), []);
  assert.deepEqual(retroBlockReasons(pending, "granted_only"), [
    "consent_not_granted",
  ]);
});

test("수신거부자는 근거와 무관하게 막힌다", () => {
  const unsub = contact({
    marketingConsentStatus: "granted",
    unsubscribeStatus: "unsubscribed",
  });
  assert.deepEqual(retroBlockReasons(unsub, "relationship"), ["unsubscribed"]);
});

// ── 3. 대상 선정 ────────────────────────────────────────────────────────────

test("계정 유무로 코호트가 갈리고, 계정 X 는 동의 granted 여야 메일이 나간다", () => {
  const result = selectRetroAudience(
    [
      candidate("aaaa", { uid: "uid-a" }), // 계정 O, pending → relationship 통과
      candidate("bbbb", { uid: null, sub: null }), // 계정 X, pending → 막힘
      candidate("cccc", {
        uid: null,
        sub: null,
        contact: contact({ marketingConsentStatus: "granted" }),
      }), // 계정 X, granted → 통과
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 2);
  assert.deepEqual(result.mailable.map((m) => m.cohort).sort(), [
    "account",
    "no_account",
  ]);
  assert.equal(result.reasonCounts.consent_not_granted, 1);
});

// ★실측에서 6명이 여기 걸린다. 이 사람들은 끊긴 적이 없으므로 "30일 만에
// 접근이 끊겼다가 되살아났다"는 문면이 거짓이 된다. 창만 늘리고 메일은 안 보낸다.
test("★아직 안 끊긴 사람에게는 메일이 나가지 않는다(창은 늘어난다)", () => {
  const result = selectRetroAudience(
    [
      candidate("alive", {
        sub: sub({ status: "active", currentPeriodEndMs: NOW + 10 * DAY }),
        contact: contact({ marketingConsentStatus: "granted" }),
      }),
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 0);
  assert.equal(result.reasonCounts.not_churned, 1);
  assert.equal(result.appliable.length, 1);
});

test("메일 대상은 전원 revive 다 — extend 가 섞이면 문면이 거짓이 된다", () => {
  const result = selectRetroAudience(
    [
      candidate("cut", { contact: contact({ marketingConsentStatus: "granted" }) }),
      candidate("alive", {
        sub: sub({ status: "active", currentPeriodEndMs: NOW + 10 * DAY }),
        contact: contact({ marketingConsentStatus: "granted" }),
      }),
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 1);
  assert.ok(result.mailable.every((m) => m.action === "revive"));
});

test("★수신거부·미동의라도 소급 쓰기(appliable)에는 남는다 — 권리를 뺏지 않는다", () => {
  const result = selectRetroAudience(
    [
      candidate("dddd", {
        contact: contact({ marketingConsentStatus: "revoked" }),
      }),
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 0);
  assert.equal(result.appliable.length, 1);
  assert.equal(result.appliable[0].reason, BETA_RETRO_EXTEND_REASON);
});

test("현역 유료 보호 대상은 메일도 소급 쓰기도 둘 다 빠진다", () => {
  const result = selectRetroAudience(
    [
      candidate("eeee", {
        sub: sub({
          status: "active",
          founderGrant: false,
          paymentProvider: "toss",
          hasPaymentEvidence: true,
          currentPeriodEndMs: NOW + 30 * DAY,
        }),
      }),
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 0);
  assert.equal(result.appliable.length, 0);
  assert.equal(result.skipCounts.live_paid_guard, 1);
});

test("★멱등키: 이미 발송 스탬프가 있으면 두 번 가지 않는다", () => {
  const result = selectRetroAudience(
    [candidate("ffff", { lastSentAtMs: NOW - 3 * DAY })],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.mailable.length, 0);
  assert.equal(result.reasonCounts.already_sent, 1);
  // 발송은 막히지만 소급 쓰기는 남는다(쓰기 멱등은 별도 스탬프가 맡는다).
  assert.equal(result.appliable.length, 1);
});

test("★계정 X 도 founders 창 쓰기가 항상 계획된다 — 없으면 가입해도 부여 0", () => {
  const result = selectRetroAudience(
    [candidate("gggg", { uid: null, sub: null })],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.appliable.length, 1);
  assert.equal(result.appliable[0].upsertSubscriptionUid, null);
  assert.equal(
    toExpiresOn(result.appliable[0].writeFounderWindowMs),
    "2026-10-14",
  );
});

test("코호트 × 로케일 분포만 집계한다(개별 주소 없음)", () => {
  const result = selectRetroAudience(
    [
      candidate("h1", { uid: "u1", locale: "ko" }),
      candidate("h2", { uid: "u2", locale: "en" }),
      candidate("h3", {
        uid: null,
        sub: null,
        locale: "ja",
        contact: contact({ marketingConsentStatus: "granted" }),
      }),
    ],
    { nowMs: NOW, betaMonths: BETA_MONTHS },
  );
  assert.equal(result.distribution.account.ko, 1);
  assert.equal(result.distribution.account.en, 1);
  assert.equal(result.distribution.no_account.ja, 1);
  assert.equal(result.distribution.no_account.ko, 0);
});

// ── 4. 문면 ─────────────────────────────────────────────────────────────────

const LOCALES: RetroLocale[] = ["ko", "en", "ja"];
const EXPIRES = { expiresOn: "2026-10-14" };

test("ko/en/ja × 계정O/X — 6벌이 전부 만들어지고 제목·본문이 비지 않는다", () => {
  for (const locale of LOCALES) {
    for (const cohort of ["account", "no_account"] as const) {
      const mail = buildBetaRetroExtendEmail(locale, cohort, EXPIRES);
      assert.ok(mail.subject.length > 0, `${locale}/${cohort} subject`);
      assert.ok(
        mail.html.includes("</body>"),
        `${locale}/${cohort} html shell`,
      );
      assert.ok(mail.text.length > 200, `${locale}/${cohort} text`);
      // 만료일은 사람마다 다르다 — 제목과 본문 양쪽에 실린다.
      assert.ok(mail.subject.includes("2026-10-14"));
      assert.ok(mail.text.includes("2026-10-14"));
    }
  }
});

test("★두 코호트의 문면은 서로 달라야 한다(제목·본문 모두)", () => {
  for (const locale of LOCALES) {
    const a = buildBetaRetroExtendEmail(locale, "account", EXPIRES);
    const b = buildBetaRetroExtendEmail(locale, "no_account", EXPIRES);
    assert.notEqual(a.subject, b.subject, `${locale} subject 가 같다`);
    assert.notEqual(a.text, b.text, `${locale} 본문이 같다`);
  }
});

// ★이 테스트가 이 티켓의 핵심 계약이다. 계정 X 30명에게 "다시 열렸습니다"는
// 거짓말이다 — 되살릴 구독 자체가 없다. 그래서 (a) 부활 주장이 없어야 하고,
// (b) 가입 이력이 없다는 사실을 **명시**해야 하며, (c) 가입 경로를 줘야 한다.
test("★계정 X 문면은 부활을 주장하지 않고, 가입 이력 없음을 명시하고, 가입으로 보낸다", () => {
  const ko = buildBetaRetroExtendEmail("ko", "no_account", EXPIRES);
  assert.ok(!ko.text.includes("다시 열렸"), "계정 X 에 부활 주장이 있다");
  assert.ok(ko.text.includes("아직 가입하신 적이 없습니다"));
  assert.ok(ko.text.includes("/ko/auth/signup"), "가입 링크가 없다");

  const en = buildBetaRetroExtendEmail("en", "no_account", EXPIRES);
  assert.ok(
    !en.text.includes("your account is open again"),
    "계정 X 에 부활 주장이 있다",
  );
  assert.ok(en.text.includes("never created an account"));
  assert.ok(en.text.includes("/en/auth/signup"));

  const ja = buildBetaRetroExtendEmail("ja", "no_account", EXPIRES);
  assert.ok(!ja.text.includes("再び開いて"), "계정 X 에 부활 주장이 있다");
  assert.ok(ja.text.includes("まだアカウントを作成されていません"));
  assert.ok(ja.text.includes("/ja/auth/signup"));
});

test("계정 O 문면은 반대로 부활을 명시한다(두 문면이 뒤바뀌지 않았다)", () => {
  assert.ok(
    buildBetaRetroExtendEmail("ko", "account", EXPIRES).text.includes(
      "다시 열려 있습니다",
    ),
  );
  assert.ok(
    buildBetaRetroExtendEmail("en", "account", EXPIRES).text.includes(
      "your account is open again",
    ),
  );
  assert.ok(
    buildBetaRetroExtendEmail("ja", "account", EXPIRES).text.includes(
      "再び開いています",
    ),
  );
});

test("계정 O 문면은 로그인하면 바로 쓸 수 있다고 말하고 다운로드로 보낸다", () => {
  const ko = buildBetaRetroExtendEmail("ko", "account", EXPIRES);
  assert.ok(ko.text.includes("/ko/download"));
  assert.ok(!ko.text.includes("auth/signup"), "계정 O 에 가입 링크가 있다");
});

test("★단 하나의 행동 — 세 로케일 모두 /tf-add → /tf-spawn-agents 두 명령만 쓴다", () => {
  for (const locale of LOCALES) {
    for (const cohort of ["account", "no_account"] as const) {
      const mail = buildBetaRetroExtendEmail(locale, cohort, EXPIRES);
      assert.ok(mail.text.includes("/tf-add"), `${locale}/${cohort} /tf-add`);
      assert.ok(
        mail.text.includes("/tf-spawn-agents"),
        `${locale}/${cohort} /tf-spawn-agents`,
      );
      // 다른 시작 경로를 나열하면 아무것도 안 한다 — 후보를 늘어놓지 않는다.
      assert.ok(
        !mail.text.includes("/tf-plan"),
        `${locale}/${cohort} /tf-plan`,
      );
      assert.ok(
        !mail.text.includes("/tf-start"),
        `${locale}/${cohort} /tf-start`,
      );
    }
  }
});

test("계단 숫자는 #1304 확정값(3·5·9)을 쓴다", () => {
  const ko = buildBetaRetroExtendEmail("ko", "account", EXPIRES);
  assert.ok(ko.text.includes("3개월"));
  assert.ok(ko.text.includes("총 5개월"));
  assert.ok(ko.text.includes("총 9개월"));
  const en = buildBetaRetroExtendEmail("en", "account", EXPIRES);
  assert.ok(en.text.includes("3 months"));
  assert.ok(en.text.includes("5 months total"));
  assert.ok(en.text.includes("9 months total"));
  const ja = buildBetaRetroExtendEmail("ja", "account", EXPIRES);
  assert.ok(ja.text.includes("3ヶ月"));
  assert.ok(ja.text.includes("合計5ヶ月"));
  assert.ok(ja.text.includes("合計9ヶ月"));
});

test("★출시 안 된 개선을 문면에 쓰지 않는다(릴리스는 v3.0.37)", () => {
  // 8/29 머지분 — 아직 릴리스에 없다. 어느 로케일에도 들어가면 안 된다.
  const banned = [
    "웹 탭",
    "web tab",
    "WebContentsView",
    "뷰어",
    "viewer",
    "역할",
  ];
  for (const locale of LOCALES) {
    for (const cohort of ["account", "no_account"] as const) {
      const text = buildBetaRetroExtendEmail(locale, cohort, EXPIRES).text;
      for (const word of banned) {
        assert.ok(
          !text.includes(word),
          `${locale}/${cohort} 에 미출시 기능 "${word}" 가 있다`,
        );
      }
    }
  }
});

test("text 파트에 HTML 태그가 새지 않는다", () => {
  for (const locale of LOCALES) {
    for (const cohort of ["account", "no_account"] as const) {
      const text = buildBetaRetroExtendEmail(locale, cohort, EXPIRES).text;
      assert.ok(!/<[a-z/][^>]*>/i.test(text), `${locale}/${cohort} 태그 누수`);
    }
  }
});
