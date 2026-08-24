// 이탈 사용자 사유 청취 아웃리치 — 순수 로직(Firestore/BQ/네트워크 무의존).
// 티켓 qcwgC4h3XPm2IZQrhntq (사장님 지시: "이탈 사용자에게 물어보고, 피드백 주시면
// Pro 3개월 무료").
//
// ── 이 모듈이 존재하는 이유 ────────────────────────────────────────────────
// 이 캠페인의 위험은 "메일을 못 보내는 것"이 아니라 **보내면 안 될 사람에게
// 보내는 것**과 **줄 수 없는 걸 약속하는 것** 두 가지다. 실측(2026-08-24) 결과
// 토큰을 쓴 비운영자 4명 중
//   - 2명은 이메일 마케팅 수신동의를 **명시적으로 철회**했고,
//   - 1명은 portone 실결제 고객이라 grant 를 넣으면 결제 정체성이 덮어써지고,
//   - 1명은 이미 Pro 가 4개월 남아서 "3개월 무료"가 **0일**을 준다.
// 즉 대상 선정과 약속 이행 가능성은 문면보다 먼저 판정돼야 하고, 그 판정은
// 사람이 매번 눈으로 하면 반드시 틀린다. 그래서 순수 함수로 내려 테스트한다.
//
// ── 발송은 여기서 하지 않는다 ──────────────────────────────────────────────
// 이 모듈은 (a) 대상 적격 판정, (b) 그랜트 실효 기간 계산, (c) 메일 문안 생성만
// 한다. Resend 호출·Firestore 쓰기는 전혀 없다. 사장님 승인 전까지 발송 경로에
// 배선하지 않는다(index.ts 미참조).
//
// 실행:
//   tsc src/churnOutreach.ts src/churnOutreach.test.ts \
//       --outDir .test-out/churn-outreach --module commonjs --target es2020 \
//       --esModuleInterop --strict --skipLibCheck \
//   && node --test .test-out/churn-outreach/churnOutreach.test.js
//   package.json: npm run test:churn-outreach

/** index.ts FounderEmailContent 와 동일 형태(배선 시 그대로 postResendEmail 에 전달). */
export interface ChurnEmailContent {
  subject: string;
  html: string;
  text: string;
}

export type ChurnOutreachLocale = "ko" | "en";

/**
 * 세그먼트. 사용량 차이가 커서(진성 이탈 1명 vs 맛보기 3명) 문면을 나눈다 —
 * "깊이 써보고 떠난 사람"과 "한 번 열어보고 만 사람"에게 같은 문장을 쓰면
 * 전자에겐 무성의하고 후자에겐 사실과 안 맞는다.
 */
export type ChurnSegment = "deep_churn" | "light_trial";

/** 발송 차단 사유. 하나라도 있으면 보내지 않는다. */
export type ChurnBlockReason =
  /** 이메일 마케팅 수신동의 철회 — 문면과 무관하게 넘을 수 없는 선. */
  | "marketing_consent_revoked"
  /** 수신거부(unsubscribe) 처리됨. */
  | "unsubscribed"
  /** 현역 유료 결제자 — grant 가 결제 정체성을 덮어쓴다. */
  | "live_paid_subscriber"
  /** 아직 쓰고 있다 — "왜 멈추셨나요"가 거짓 전제가 된다. */
  | "still_active"
  /** 토큰을 쓴 적이 없다 — 이 캠페인의 질문 대상이 아니다(미활성 팔로업 소관). */
  | "never_activated"
  /** 연락 가능한 이메일이 없다. */
  | "no_email";

/** 적격 판정에 필요한 사실들. 전부 호출부가 조회해서 넣는다(이 모듈은 IO 금지). */
export interface ChurnOutreachFacts {
  /** 연락 가능한 이메일이 존재하는가(주소 자체는 받지 않는다 — PII 를 이 축에 들이지 않는다). */
  hasEmail: boolean;
  /** cost_logs 합산 토큰. 0 이면 미활성. */
  totalTokens: number;
  /** cost_logs 마지막 사용 시각(ms). 사용 이력이 없으면 null. */
  lastUsageAtMs: number | null;
  /** Firebase Auth lastRefreshAt/lastLoginAt 중 더 최근(ms). 앱이 살아있는지 신호. */
  lastSeenAtMs: number | null;
  /** marketing_contacts.emailMarketingConsent.status */
  marketingConsentStatus: "granted" | "pending" | "revoked" | null;
  /** marketing_contacts.unsubscribe.status */
  unsubscribeStatus: "subscribed" | "unsubscribed" | null;
  /** subscriptions.currentPeriodEnd (ms). 구독 문서가 없으면 null. */
  currentPeriodEndMs: number | null;
  /** subscriptions.status */
  subscriptionStatus: string | null;
  /**
   * 결제 흔적이 있는가(tossBillingKey / portoneBillingKey / portonePaymentId 등).
   * ★index.ts 의 isLivePaidSubscription 은 founderGrant 플래그가 남아 있으면
   * 이 사람을 무료 grant 로 오판한다(실측 사례 있음). 그래서 여기서는
   * founderGrant 를 보지 않고 **결제 흔적만** 본다 — 오판 방향을 "안전"쪽으로
   * 뒤집기 위해서다. 결제 흔적이 있으면 grant 를 넣지 않는다.
   */
  hasPaymentEvidence: boolean;
}

/** 아직 쓰고 있다고 볼 최근성 임계(일). 이 안에 흔적이 있으면 이탈로 부르지 않는다. */
export const STILL_ACTIVE_WINDOW_DAYS = 7;

/** 무료로 얹어줄 개월 수(사장님 지시 = 3개월). */
export const CHURN_OFFER_MONTHS = 3;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * 발송 차단 사유 전부. 하나만 보고 끊지 않고 전부 모은다 — 오케/사장님이
 * "왜 이 사람은 빠졌나"를 한 번에 볼 수 있어야 판단이 된다.
 */
export function churnBlockReasons(
  facts: ChurnOutreachFacts,
  nowMs: number
): ChurnBlockReason[] {
  const reasons: ChurnBlockReason[] = [];

  if (!facts.hasEmail) reasons.push("no_email");
  if (facts.marketingConsentStatus === "revoked") {
    reasons.push("marketing_consent_revoked");
  }
  if (facts.unsubscribeStatus === "unsubscribed") reasons.push("unsubscribed");

  // 결제 흔적 + 현역 status = 건드리면 안 되는 사람.
  const liveStatus =
    facts.subscriptionStatus === "active" ||
    facts.subscriptionStatus === "past_due";
  if (facts.hasPaymentEvidence && liveStatus) {
    reasons.push("live_paid_subscriber");
  }

  if (facts.totalTokens <= 0) reasons.push("never_activated");

  const window = STILL_ACTIVE_WINDOW_DAYS * DAY_MS;
  const recent = [facts.lastUsageAtMs, facts.lastSeenAtMs].filter(
    (t): t is number => typeof t === "number"
  );
  if (recent.some((t) => nowMs - t < window)) reasons.push("still_active");

  return reasons;
}

export function isChurnOutreachEligible(
  facts: ChurnOutreachFacts,
  nowMs: number
): boolean {
  return churnBlockReasons(facts, nowMs).length === 0;
}

/**
 * 세그먼트 판정. 경계는 "이 제품으로 실제 일을 해봤는가"다 — 1천만 토큰이면
 * 하루 이틀이라도 진짜 작업을 돌린 것이고, 그 사람의 이탈 사유가 가장 비싸다.
 */
export const DEEP_CHURN_MIN_TOKENS = 10_000_000;

export function churnSegmentOf(facts: ChurnOutreachFacts): ChurnSegment {
  return facts.totalTokens >= DEEP_CHURN_MIN_TOKENS
    ? "deep_churn"
    : "light_trial";
}

// ── 그랜트 실효 기간 ────────────────────────────────────────────────────────
//
// ★핵심 함정: index.ts 의 upsertProSubscription 은
//     periodEnd = max(기존 currentPeriodEnd, grantStartedAt + months)
// 다. "+3개월 추가"가 아니라 **"3개월까지 채움"**이다. 이미 Pro 가 4개월 남은
// 사람에게 grantStartedAt=now 로 부여하면 실제로 늘어나는 기간은 **0일**이다.
// 그 상태로 "3개월 무료로 드립니다"를 보내면 약속을 못 지킨다.
//
// 해결은 코드 수정이 아니라 **앵커 선택**이다. grantStartedAt 을 "기존 만료일"로
// 주면 target = 기존만료일+3개월 이 되어 max 가 그대로 통과한다 → 진짜 3개월
// 연장. 기존 만료일이 이미 지났으면 now 를 앵커로 쓴다.

/** grantStartedAt 으로 넘겨야 할 앵커 = max(기존 만료일, now). */
export function resolveGrantAnchorMs(
  currentPeriodEndMs: number | null,
  nowMs: number
): number {
  if (typeof currentPeriodEndMs !== "number") return nowMs;
  return currentPeriodEndMs > nowMs ? currentPeriodEndMs : nowMs;
}

/** JS Date 의 setMonth 규약과 동일(index.ts addMonths 와 같은 동작). */
export function addMonthsMs(baseMs: number, months: number): number {
  const d = new Date(baseMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

export interface GrantProjection {
  /** grantStartedAt 으로 넘길 값(ms). */
  anchorMs: number;
  /** 부여 후 실제 만료일(ms) = max(기존, anchor+months). */
  projectedEndMs: number;
  /** 기존 대비 실제로 늘어나는 일수. 0 이면 약속이 빈 껍데기다. */
  addedDays: number;
}

/**
 * 앵커를 만료일로 잡았을 때의 부여 결과. 호출부(운영자 절차)가 발송 전에
 * addedDays > 0 을 확인하는 데 쓴다.
 */
export function projectGrant(
  currentPeriodEndMs: number | null,
  nowMs: number,
  months: number = CHURN_OFFER_MONTHS
): GrantProjection {
  const anchorMs = resolveGrantAnchorMs(currentPeriodEndMs, nowMs);
  const target = addMonthsMs(anchorMs, months);
  const existing =
    typeof currentPeriodEndMs === "number" ? currentPeriodEndMs : 0;
  const projectedEndMs = Math.max(existing, target);
  const base = Math.max(existing, nowMs);
  const addedDays = Math.max(0, Math.round((projectedEndMs - base) / DAY_MS));
  return { anchorMs, projectedEndMs, addedDays };
}

/**
 * 앵커를 now 로 잡았을 때(= 기존 경로가 하는 일) 실제로 늘어나는 일수.
 * "왜 앵커를 바꿔야 하는가"를 수치로 보여주는 비교용.
 */
export function naiveAddedDays(
  currentPeriodEndMs: number | null,
  nowMs: number,
  months: number = CHURN_OFFER_MONTHS
): number {
  const existing =
    typeof currentPeriodEndMs === "number" ? currentPeriodEndMs : 0;
  const projected = Math.max(existing, addMonthsMs(nowMs, months));
  const base = Math.max(existing, nowMs);
  return Math.max(0, Math.round((projected - base) / DAY_MS));
}

// ── 메일 문안 ───────────────────────────────────────────────────────────────
//
// 사장님 제약: 짧게. 핵심 질문은 하나 — "무엇 때문에 멈추셨나요". 제품 자랑·기능
// 나열 금지. 우리가 뭘 고쳤는지도 쓰지 않는다(변명으로 읽힌다). 조건 없이
// "한 줄 답장이면" 준다.
//
// 문면이 지켜야 할 것 하나 더: **줄 수 있는 것만 약속한다.** 그래서 "지금 남은
// 기간에 이어서 3개월"이라고 쓴다 — projectGrant 가 실제로 그렇게 부여한다.

const SUPPORT_EMAIL = "team@marblo.app";

function shell(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"></head>
<body style="margin:0;padding:24px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,'Helvetica Neue',Arial,'Apple SD Gothic Neo','Noto Sans KR',sans-serif;color:#111">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;padding:28px;line-height:1.7;font-size:15px">
${inner}
<p style="margin:24px 0 0;color:#999;font-size:12px">Marblo · ${SUPPORT_EMAIL}</p>
</div></body></html>`;
}

function p(text: string): string {
  return `<p style="margin:0 0 14px">${text}</p>`;
}

interface Copy {
  subject: string;
  /** 첫 문장 — 세그먼트별로만 다르다. */
  opener: string;
  question: string;
  howToReply: string;
  offer: string;
  signoff: string;
}

function copyFor(locale: ChurnOutreachLocale, segment: ChurnSegment): Copy {
  if (locale === "en") {
    return {
      subject: "What made you stop?",
      opener:
        segment === "deep_churn"
          ? "You put Marblo through real work for a couple of days, then stopped."
          : "You opened Marblo once and never came back.",
      question: "What made you stop?",
      howToReply:
        "One line is enough — just reply to this email. No form, no survey.",
      offer:
        "Reply and we'll add 3 months of Pro on top of whatever time you have left. No strings.",
      signoff: "Thank you,\nThe Marblo team",
    };
  }
  return {
    subject: "무엇 때문에 멈추셨나요?",
    opener:
      segment === "deep_churn"
        ? "며칠 동안 마블로로 실제 작업을 돌려보신 뒤, 발길이 끊기셨습니다."
        : "마블로를 한 번 열어보신 뒤, 다시 오지 않으셨습니다.",
    question: "무엇 때문에 멈추셨나요?",
    howToReply:
      "한 줄이면 충분합니다. 이 메일에 그대로 답장만 주세요. 설문도, 양식도 없습니다.",
    offer:
      "답장 주시면 지금 남아 있는 기간에 이어서 Pro 3개월을 무료로 얹어 드리겠습니다. 다른 조건은 없습니다.",
    signoff: "감사합니다.\n마블로 팀 드림",
  };
}

/**
 * 이탈 사유 청취 메일. 발신·답장은 호출부(postResendEmail)가
 * team@marblo.app 로 고정한다 — 여기서 From 을 만들지 않는다.
 */
export function buildChurnInterviewEmail(
  locale: ChurnOutreachLocale,
  segment: ChurnSegment
): ChurnEmailContent {
  const c = copyFor(locale, segment);
  const html = shell(
    [
      p(c.opener),
      `<p style="margin:0 0 14px;font-size:17px;font-weight:700">${c.question}</p>`,
      p(c.howToReply),
      p(`<span style="color:#555">${c.offer}</span>`),
      p(c.signoff.replace("\n", "<br>")),
    ].join("\n")
  );
  const text = [
    c.opener,
    "",
    c.question,
    "",
    c.howToReply,
    "",
    c.offer,
    "",
    c.signoff,
    "",
    `Marblo · ${SUPPORT_EMAIL}`,
  ].join("\n");
  return { subject: c.subject, html, text };
}
