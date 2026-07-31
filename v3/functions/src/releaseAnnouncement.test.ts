// releaseAnnouncement 순수 로직 테스트 — node --test (devDep 추가 없음).
//   npm run test:release-announcement
//
// 핵심 불변식: 발송 대상 = beta_active ∩ 동의 ∩ 미발송(쿨다운).
// 셋 중 하나라도 빠지면 불법발송/중복발송이라 여기서 못 나가게 막는다.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  RELEASE_ANNOUNCEMENT_SENT_AT_FIELD,
  RELEASE_ANNOUNCEMENT_SUBJECT,
  buildReleaseAnnouncementEmail,
  classifyFounderGrant,
  domainDistribution,
  selectReleaseAudience,
  type ReleaseAudienceCandidate,
} from "./releaseAnnouncement";

const NOW = Date.UTC(2026, 6, 31); // 2026-07-31
const DAY = 24 * 60 * 60 * 1000;
const COOLDOWN = 365 * DAY;

function candidate(
  over: Partial<ReleaseAudienceCandidate> & { email: string },
): ReleaseAudienceCandidate {
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

// ─── classifyFounderGrant ────────────────────────────────────────────

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
  // 기간 미상(null)도 active 로 본다 — index.ts hasActiveFounderGrant 와 동일.
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

// ─── selectReleaseAudience ───────────────────────────────────────────

test("beta_active·동의·미발송 교집합만 남는다", () => {
  const r = selectReleaseAudience(
    [
      candidate({ email: "ok@a.com" }),
      candidate({ email: "rejected@a.com", selected: false }),
      candidate({ email: "paid@a.com", grant: "no_active_grant" }),
      candidate({ email: "expired@a.com", grant: "grant_expired" }),
      candidate({
        email: "noconsent@a.com",
        gateOk: false,
        gateReason: "consent_not_granted",
      }),
      candidate({
        email: "unsub@a.com",
        gateOk: false,
        gateReason: "unsubscribed",
      }),
      candidate({ email: "sent@a.com", lastSentAtMs: NOW - DAY }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );

  assert.deepEqual(emails(r), ["ok@a.com"]);
  assert.deepEqual(r.skipped, {
    notSelected: 1,
    grantExpired: 1,
    noActiveGrant: 1,
    noConsent: 2,
    cooldown: 1,
  });
  // 동의 사유 분포는 그랜트 통과자에 대해서만 집계된다(진단용).
  assert.deepEqual(r.gateReasonCounts, {
    ok: 2,
    consent_not_granted: 1,
    unsubscribed: 1,
  });
});

test("컨택트가 아예 없으면(no_contact) 발송 대상이 아니다", () => {
  const r = selectReleaseAudience(
    [
      candidate({
        email: "ghost@a.com",
        gateOk: false,
        gateReason: "no_contact",
      }),
    ],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.deepEqual(r.eligible, []);
  assert.equal(r.skipped.noConsent, 1);
});

test("쿨다운이 지난 주소는 다시 대상이 된다", () => {
  const r = selectReleaseAudience(
    [candidate({ email: "old@a.com", lastSentAtMs: NOW - COOLDOWN - 1 })],
    { nowMs: NOW, cooldownMs: COOLDOWN },
  );
  assert.deepEqual(emails(r), ["old@a.com"]);
  assert.equal(r.skipped.cooldown, 0);
});

test("동일 이메일 다중 문서: 1통으로 합치고 doc 전부에 스탬프한다", () => {
  const r = selectReleaseAudience(
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
  const r = selectReleaseAudience(
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
  const r = selectReleaseAudience(
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
  const r = selectReleaseAudience([], { nowMs: NOW, cooldownMs: COOLDOWN });
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

// ─── 본문 렌더 ───────────────────────────────────────────────────────

test("제목은 확정본 그대로", () => {
  assert.equal(
    buildReleaseAnnouncementEmail().subject,
    RELEASE_ANNOUNCEMENT_SUBJECT,
  );
  assert.match(RELEASE_ANNOUNCEMENT_SUBJECT, /마블로 3\.0\.19/);
});

test("본문에 확정 문구·다운로드 링크가 들어간다", () => {
  const { html, text } = buildReleaseAnnouncementEmail();
  for (const needle of [
    "안녕하세요, 마블로 베타테스터님",
    "[이번 버전에서 달라진 점]",
    "퀵레인(Quick Lanes)",
    "[한 가지 부탁드려요 🙏]",
    "BYOM(Bring Your Own Model)",
    "Pro 플랜 3개월을 연장",
    "[시작하는 법]",
    "마블로 팀 드림",
    "team@marblo.app",
  ]) {
    assert.ok(html.includes(needle), `html 에 없음: ${needle}`);
    assert.ok(text.includes(needle), `text 에 없음: ${needle}`);
  }
  assert.ok(html.includes('href="https://marblo.app/download"'));
  assert.ok(text.includes("https://marblo.app/download"));
});

test("외부 리소스(이미지·CSS·스크립트) 를 로드하지 않는다", () => {
  const { html } = buildReleaseAnnouncementEmail();
  assert.ok(!/<img/i.test(html), "이미지 없음");
  assert.ok(!/<script/i.test(html), "스크립트 없음");
  assert.ok(!/<link/i.test(html), "외부 CSS 없음");
  // 남는 원격 URL 은 다운로드 링크·mailto 뿐.
  const urls = html.match(/https?:\/\/[^"'\s<]+/g) || [];
  assert.deepEqual([...new Set(urls)], ["https://marblo.app/download"]);
});

test("스탬프 필드명은 3.0.19 로 고정(멱등 키)", () => {
  assert.equal(
    RELEASE_ANNOUNCEMENT_SENT_AT_FIELD,
    "releaseAnnouncement_3_0_19_SentAt",
  );
});
