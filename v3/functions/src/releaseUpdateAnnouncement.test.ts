// releaseUpdateAnnouncement 순수 로직 테스트 — node --test (devDep 추가 없음).
//   npm run test:release-update-announcement
//
// 핵심 불변식: 발송 대상 = beta_active ∩ (하드옵트아웃/무효주소 아님) ∩ 미발송.
// ★마케팅 동의(isEmailable)와 달리 "동의 없음"은 여기서 걸리지 않는다 — 광고가
// 아니라 서비스 공지이기 때문. 이 셋 중 하나라도 무너지면 불법발송/중복발송/
// 옵트아웃 위반이라 여기서 못 나가게 막는다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RELEASE_UPDATE_CONFIRM,
  RELEASE_UPDATE_SENT_AT_FIELD,
  RELEASE_UPDATE_SUBJECT,
  buildReleaseUpdateEmail,
  classifyFounderGrant,
  domainDistribution,
  selectReleaseUpdateAudience,
  serviceMailGate,
  type ReleaseUpdateAudienceCandidate,
} from "./releaseUpdateAnnouncement";

const NOW = Date.UTC(2026, 6, 31); // 2026-07-31
const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN = 365 * DAY;

function candidate(
  over: Partial<ReleaseUpdateAudienceCandidate> & { email: string },
): ReleaseUpdateAudienceCandidate {
  return {
    docId: over.email,
    selected: true,
    grant: "beta_active",
    gateOk: true,
    gateReason: "ok",
    lastSentAtMs: null,
    ...over,
  };
}

const emails = (r: { eligible: Array<{ email: string }> }) =>
  r.eligible.map((e) => e.email).sort();

// ─── classifyFounderGrant (releaseAnnouncement.ts 와 동일 로직) ───────

test("classifyFounderGrant: active founder_grant = beta_active", () => {
  assert.equal(
    classifyFounderGrant(
      {
        status: "active",
        paymentProvider: "founder_grant",
        currentPeriodEndMs: NOW + 30 * DAY,
      },
      NOW,
    ),
    "beta_active",
  );
  assert.equal(
    classifyFounderGrant(
      {
        status: "active",
        paymentProvider: "founder_grant",
        currentPeriodEndMs: null,
      },
      NOW,
    ),
    "beta_active",
  );
});

test("classifyFounderGrant: 만료된 그랜트는 grant_expired (기본 제외)", () => {
  assert.equal(
    classifyFounderGrant(
      {
        status: "active",
        paymentProvider: "founder_grant",
        currentPeriodEndMs: NOW - 1,
      },
      NOW,
    ),
    "grant_expired",
  );
});

test("classifyFounderGrant: 그랜트 아님/비활성은 no_active_grant", () => {
  assert.equal(classifyFounderGrant(null, NOW), "no_active_grant");
  assert.equal(
    classifyFounderGrant(
      { status: "active", paymentProvider: "toss", currentPeriodEndMs: null },
      NOW,
    ),
    "no_active_grant",
  );
  assert.equal(
    classifyFounderGrant(
      {
        status: "canceled",
        paymentProvider: "founder_grant",
        currentPeriodEndMs: NOW + DAY,
      },
      NOW,
    ),
    "no_active_grant",
  );
});

// ─── serviceMailGate ───────────────────────────────────────────────────

test("serviceMailGate: 정상 주소·비수신거부 = ok", () => {
  assert.deepEqual(serviceMailGate({ email: "a@b.com", unsubscribed: false }), {
    ok: true,
    reason: "ok",
  });
});

test("serviceMailGate: 마케팅 동의 여부와 무관하게 통과한다(동의없음은 제외 사유가 아님)", () => {
  // gateOk 는 marketing_contacts.emailMarketingConsent 를 아예 참조하지 않는다 —
  // 인풋 자체에 동의 필드가 없다는 것 자체가 그 불변식의 증거.
  assert.equal(
    serviceMailGate({ email: "noconsent@b.com", unsubscribed: false }).ok,
    true,
  );
});

test("serviceMailGate: 하드 옵트아웃(unsubscribed)은 제외", () => {
  assert.deepEqual(serviceMailGate({ email: "a@b.com", unsubscribed: true }), {
    ok: false,
    reason: "unsubscribed",
  });
});

test("serviceMailGate: 무효 주소 형식은 제외", () => {
  for (const email of ["", "no-at-sign", "@b.com", "a@"]) {
    assert.deepEqual(
      serviceMailGate({ email, unsubscribed: false }),
      { ok: false, reason: "invalid_email" },
      `email=${JSON.stringify(email)}`,
    );
  }
});

// ─── selectReleaseUpdateAudience ───────────────────────────────────────

test("beta_active·게이트통과·미발송 교집합만 남는다(동의없음은 제외 안 됨)", () => {
  const r = selectReleaseUpdateAudience(
    [
      candidate({ email: "ok@a.com" }),
      candidate({ email: "rejected@a.com", selected: false }),
      candidate({ email: "paid@a.com", grant: "no_active_grant" }),
      candidate({ email: "expired@a.com", grant: "grant_expired" }),
      // ★마케팅 미동의자도 하드옵트아웃이 아니면 대상에 남는다.
      candidate({ email: "noconsent@a.com" }),
      candidate({
        email: "unsub@a.com",
        gateOk: false,
        gateReason: "unsubscribed",
      }),
      candidate({ email: "sent@a.com", lastSentAtMs: NOW - DAY }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );

  assert.deepEqual(emails(r), ["noconsent@a.com", "ok@a.com"]);
  assert.deepEqual(r.skipped, {
    notSelected: 1,
    grantExpired: 1,
    noActiveGrant: 1,
    gateBlocked: 1,
    cooldown: 1,
  });
  // 그랜트 통과자 4명(ok/noconsent/unsub/sent) 중 게이트 사유는 ok 3 + unsubscribed 1.
  assert.deepEqual(r.gateReasonCounts, { ok: 3, unsubscribed: 1 });
});

test("무효 주소는 gateBlocked 로 제외된다", () => {
  const r = selectReleaseUpdateAudience(
    [
      candidate({
        email: "bad@a.com",
        gateOk: false,
        gateReason: "invalid_email",
      }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.deepEqual(r.eligible, []);
  assert.equal(r.skipped.gateBlocked, 1);
});

test("쿨다운이 지난 주소는 다시 대상이 된다", () => {
  const r = selectReleaseUpdateAudience(
    [candidate({ email: "old@a.com", lastSentAtMs: NOW - COOLDOWN - 1 })],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.deepEqual(emails(r), ["old@a.com"]);
  assert.equal(r.skipped.cooldown, 0);
});

test("동일 이메일 다중 문서: 1통으로 합치고 doc 전부에 스탬프한다", () => {
  const r = selectReleaseUpdateAudience(
    [
      candidate({ email: "dup@a.com", docId: "dup@a.com" }),
      candidate({ email: "dup@a.com", docId: "DUP@a.com" }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.equal(r.eligible.length, 1);
  assert.deepEqual(r.eligible[0].docIds.sort(), ["DUP@a.com", "dup@a.com"]);
  assert.equal(r.duplicateDocs, 1);
});

test("중복 문서 중 하나라도 발송 흔적이 있으면 재발송하지 않는다", () => {
  const r = selectReleaseUpdateAudience(
    [
      candidate({ email: "dup@a.com", docId: "a", lastSentAtMs: null }),
      candidate({ email: "dup@a.com", docId: "b", lastSentAtMs: NOW - DAY }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.deepEqual(r.eligible, []);
  assert.equal(r.skipped.cooldown, 1);
});

test("limit 은 배치 상한으로만 작동하고 잘린 수를 보고한다", () => {
  const r = selectReleaseUpdateAudience(
    [
      candidate({ email: "a@x.com" }),
      candidate({ email: "b@x.com" }),
      candidate({ email: "c@x.com" }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN, limit: 2 },
  );
  assert.equal(r.eligible.length, 2);
  assert.equal(r.overLimit, 1);
});

test("대상이 없으면 빈 목록(발송 0통)", () => {
  const r = selectReleaseUpdateAudience([], {
    nowMs: NOW,
    cooldownMs: COOLDOWN,
  });
  assert.deepEqual(r.eligible, []);
  assert.equal(r.overLimit, 0);
});

// ─── domainDistribution ──────────────────────────────────────────────

test("도메인 분포: 1건짜리 도메인은 (other) 로 묶어 개인식별을 막는다", () => {
  assert.deepEqual(domainDistribution(["a@x.com", "b@x.com", "c@rare.com"]), {
    "x.com": 2,
    "(other)": 1,
  });
});

// ─── 본문 렌더(확정본) ──────────────────────────────────────────────

test("제목은 확정본 그대로", () => {
  assert.equal(buildReleaseUpdateEmail().subject, RELEASE_UPDATE_SUBJECT);
  assert.match(RELEASE_UPDATE_SUBJECT, /마블로 3\.0\.19/);
});

test("본문에 확정 문구·다운로드 링크·수신거부 안내가 들어간다", () => {
  const { html, text } = buildReleaseUpdateEmail();
  for (const needle of [
    "안녕하세요, 마블로 베타테스터님",
    "베타 테스트에 참여해 주셔서 감사합니다",
    "[이번 버전에서 달라진 점]",
    "🤖 오케스트레이터를 Claude뿐 아니라 Codex·Grok으로도 운영할 수 있습니다.",
    "🔗 에이전트 연결 확장",
    "🎯 난이도 기반 자동 모델 선택",
    "🗂️ 완료 이력·워크트리 작업",
    "⚡ 퀵레인(Quick Lanes)",
    "[업데이트 방법]",
    "이미 설치돼 있으면 자동 업데이트됩니다",
    "여러분의 피드백이 마블로를 더 좋게 만듭니다",
    "마블로 팀 드림",
    "team@marblo.app",
    "정보성 메일입니다",
    "더 이상 받지 않으시려면",
  ]) {
    assert.ok(html.includes(needle), `html 에 없음: ${needle}`);
    assert.ok(text.includes(needle), `text 에 없음: ${needle}`);
  }
  assert.ok(html.includes('href="https://marblo.app/download"'));
  assert.ok(text.includes("https://marblo.app/download"));
});

test("프로모션/구독유도 문구가 전혀 없다", () => {
  const { html, text } = buildReleaseUpdateEmail();
  for (const forbidden of [
    "구독",
    "Pro 3개월",
    "Pro 플랜",
    "요금제",
    "프로모션",
    "BYOM",
    "결제",
  ]) {
    assert.ok(!html.includes(forbidden), `html 에 금지문구 포함: ${forbidden}`);
    assert.ok(!text.includes(forbidden), `text 에 금지문구 포함: ${forbidden}`);
  }
});

test("외부 리소스(이미지·CSS·스크립트) 를 로드하지 않는다", () => {
  const { html } = buildReleaseUpdateEmail();
  assert.ok(!/<img/i.test(html), "이미지 없음");
  assert.ok(!/<script/i.test(html), "스크립트 없음");
  assert.ok(!/<link/i.test(html), "외부 CSS 없음");
  const urls = html.match(/https?:\/\/[^"'\s<]+/g) || [];
  assert.deepEqual([...new Set(urls)], ["https://marblo.app/download"]);
});

test("스탬프 필드명·confirm 토큰은 마케팅 공지(releaseAnnouncement)와 다른 값으로 고정", () => {
  assert.equal(RELEASE_UPDATE_SENT_AT_FIELD, "releaseUpdate_3_0_19_SentAt");
  assert.equal(RELEASE_UPDATE_CONFIRM, "SEND-UPDATE-3-0-19");
});
