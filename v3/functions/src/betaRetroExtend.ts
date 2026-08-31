// 베타 1개월 → 3개월 **소급 연장 + 복귀 안내 메일** — 순수 로직.
// 티켓 F8PAS6bMofxjujDCgPfE (사장님 지시: "소급은 안내메일. 지금 바로 이러이러한
// 걸 트라이해보라고.")
//
// ── 이 모듈이 존재하는 이유 ────────────────────────────────────────────────
// #1304 로 베타가 1→3개월이 됐다(계단 3→5→9). 30일에 창이 닫혔던 사람들의 창을
// 되살릴 수 있게 됐지만, **조용히 되살리는 건 최악의 선택**이다. 그 사람들은 이미
// "베타가 끝났다"를 겪었다. 말없이 구독만 살리면 코호트 노이즈는 지고 리텐션
// 신호는 못 얻는다. 구독 부활은 수단이고 목적은 복귀다 — 그래서 이 모듈의 절반은
// 대상 판정이고 나머지 절반은 **문면**이다.
//
// ── 두 덩어리는 서로 다른 메일을 받는다 ────────────────────────────────────
// 드라이런(scripts/dryrun-founder-beta-retro-extend.mjs) 실측:
//   · 되살아남 · 계정 O 26명 — 가입했고 구독이 만료됐다. 되살릴 구독이 있다.
//   · 되살아남 · 계정 X 30명 — 선정 메일은 받았지만 **가입한 적이 없다**.
//     되살릴 구독 자체가 없다. 이 사람들에게 "돌아왔습니다"라고 쓰면 거짓이다.
// 그래서 cohort 를 타입으로 가르고 문면을 갈랐다. 문면이 두 갈래라는 사실이
// 코드에 없으면 운영자가 언젠가 한 문안을 56명 전원에게 보낸다.
//
// ── ★계정 X 에게 메일만 보내면 그 메일은 거짓말이 된다 ─────────────────────
// index.ts 의 grantBetaProOnSignup(auth onCreate) 은
//   resolveFounderGrantWindowEnd(founder) = max(betaExpiresAt, proExpiresAt)
//   그것도 없으면 accessGrantedAt + FOUNDER_LEGACY_BETA_MONTHS(=1)
// 를 쓴다. 계정 X 30명은 그 값이 전부 과거다 → windowEnd <= now →
// skippedReason="window_expired" → **가입해도 Pro 부여가 0**이다.
// 즉 "가입하시면 {날짜}까지 쓰실 수 있습니다"를 참으로 만들려면 소급 스크립트가
// founders/{email}.betaExpiresAt 를 먼저 써야 한다. 그래서 apply 계획은 계정
// 유무와 무관하게 **항상 founders 쓰기를 포함**한다(RetroApplyPlan.writeFounderWindow).
//
// ── 발송은 여기서 하지 않는다 ──────────────────────────────────────────────
// Resend 호출·Firestore 쓰기는 전혀 없다(index.ts 미참조). 실행은
// scripts/send-beta-retro-extend.ts 가 하고, 그것도 기본이 dry-run 이다.
//
// 실행:
//   npm run test:beta-retro-extend

/** index.ts FounderEmailContent 와 동일 형태(그대로 postResendEmail 에 전달 가능). */
export interface RetroEmailContent {
  subject: string;
  html: string;
  text: string;
}

/** 파운더 메일 로케일 — index.ts normalizeFounderLocale 과 같은 집합. */
export type RetroLocale = "ko" | "en" | "ja";

/**
 * 두 덩어리.
 *  - "account"    : 가입 O. 구독을 되살린다. "다시 열렸습니다"가 참이다.
 *  - "no_account" : 가입 X. 되살릴 구독이 없다. **가입부터** 해야 한다.
 */
export type RetroCohort = "account" | "no_account";

/** 소급 사유 마커. ★나중에 코호트에서 이 인원을 분리하기 위한 유일한 표식. */
export const BETA_RETRO_EXTEND_REASON = "beta_window_retro_extend_2026_08";

/** founders 문서 발송 스탬프(멱등키). 같은 사람에게 두 번 가면 안 된다. */
export const BETA_RETRO_EXTEND_SENT_AT_FIELD = "betaRetroExtendEmailSentAt";

/** 발송 여부 boolean 스탬프(수동 조회용). */
export const BETA_RETRO_EXTEND_SENT_FIELD = "betaRetroExtendEmailSent";

/** 어느 문면이 나갔는지. 계정 O/X 문면이 달라 사후 추적에 필요하다. */
export const BETA_RETRO_EXTEND_COHORT_FIELD = "betaRetroExtendCohort";

/** 소급 쓰기(창 연장) 스탬프. 발송 스탬프와 **별개** — 순서가 갈릴 수 있다. */
export const BETA_RETRO_EXTEND_APPLIED_AT_FIELD = "betaRetroExtendAppliedAt";

/** 소급 쓰기 2차 게이트. --apply 만으로는 부족하다. */
export const BETA_RETRO_APPLY_CONFIRM = "APPLY-BETA-RETRO-EXTEND-2026-08";

/** 실발송 2차 게이트. --send 만으로는 부족하다. */
export const BETA_RETRO_SEND_CONFIRM = "SEND-BETA-RETRO-EXTEND-2026-08";

/**
 * 쿨다운(일). 1회성 캠페인이라 넉넉히 잡는다 — 리마인더를 보내지 않는다.
 * (churnOutreach 와 같은 규약.)
 */
export const BETA_RETRO_COOLDOWN_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// 1. 소급 판정 — upsertProSubscription 의 보호 규칙을 그대로 복제한다
// ════════════════════════════════════════════════════════════════════════════
//
// ★여기서 규칙이 index.ts 와 어긋나면 드라이런 숫자가 실행과 달라져 판단 근거가
// 되지 못한다. dryrun-founder-beta-retro-extend.mjs 가 .mjs 로 복제해 둔 것을
// 타입 있는 단일 소스로 옮긴 것이 이 절이다.

/** subscriptions/{uid} 에서 판정에 필요한 사실만. 문서가 없으면 null 을 넘긴다. */
export interface RetroSubscriptionFacts {
  /** subscriptions.status — "active" | "past_due" | "canceled" | … */
  status: string | null;
  /** founderGrant === true (무료 grant 의 authoritative 마커). */
  founderGrant: boolean;
  /** paymentProvider — "toss" | "paddle" | "portone" | "founder_grant" | … */
  paymentProvider: string | null;
  /**
   * 결제 흔적(billingKey·paymentId·paymentProvider). ★index.ts hasPaymentEvidence
   * 는 portone 키를 일부만 본다(churnOutreach 주석의 실측 사례). 조회부가
   * **넓게** 채워 넣어 오판 방향을 안전쪽으로 둔다.
   */
  hasPaymentEvidence: boolean;
  /** subscriptions.currentPeriodEnd(ms). 문서가 없으면 null. */
  currentPeriodEndMs: number | null;
}

/** founders/{email} 에서 판정에 필요한 사실만. */
export interface RetroFounderFacts {
  /** founders.status — "selected" | "rejected" | … */
  status: string | null;
  accessGrantedAtMs: number | null;
  betaExpiresAtMs: number | null;
  proExpiresAtMs: number | null;
}

export type RetroSkipReason =
  /** 반려된 파운더 — 되살릴 대상이 아니다. */
  | "rejected"
  /** 선정 흔적(accessGrantedAt)이 없다 — 창 자체를 계산할 수 없다. */
  | "no_access_grant"
  /** ★현역 유료 구독. 덮어쓰면 과금이 끊긴다. 어떤 플래그로도 넘지 않는다. */
  | "live_paid_guard"
  /** 소급해도 이미 지난 창 — 되살아나지 않는다. */
  | "still_expired_after_retro"
  /** 이미 더 긴 기간 보유 — 기간을 줄이는 부여는 없다(max 규칙). */
  | "already_longer";

export type RetroVerdict =
  | { action: "skip"; reason: RetroSkipReason; targetMs: number | null }
  | {
      /** 창이 닫혀 있던 사람 — 되살아난다. */
      action: "revive";
      targetMs: number;
      existingEndMs: number | null;
      addedDays: number;
    }
  | {
      /** 아직 안 끊긴 사람 — 되살리는 게 아니라 만료일만 늘어난다. */
      action: "extend";
      targetMs: number;
      existingEndMs: number | null;
      addedDays: number;
    };

/** JS Date setMonth 규약(index.ts / founderLadder addMonths 와 같은 동작). */
export function addMonthsMs(baseMs: number, months: number): number {
  const d = new Date(baseMs);
  d.setMonth(d.getMonth() + months);
  return d.getTime();
}

/** 무료 grant 구독인가. founderGrant 플래그가 authoritative. */
export function isFounderGrantSubscription(
  sub: RetroSubscriptionFacts | null
): boolean {
  if (!sub) return false;
  return sub.founderGrant || sub.paymentProvider === "founder_grant";
}

/**
 * ★현역 유료 구독 판정. index.ts isLivePaidSubscription 과 동일한 순서다:
 * founder grant 는 유료가 아니고, status 가 현역이며, 결제 흔적이 있어야 한다.
 */
export function isLivePaidSubscription(
  sub: RetroSubscriptionFacts | null
): boolean {
  if (!sub || isFounderGrantSubscription(sub)) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  return sub.hasPaymentEvidence;
}

/**
 * "새 정책(accessGrantedAt + betaMonths)을 적용하면 이 사람에게 무슨 일이
 * 일어나는가". 쓰기는 하지 않는다 — 판정만 돌려준다.
 */
export function classifyRetroTarget(
  founder: RetroFounderFacts,
  sub: RetroSubscriptionFacts | null,
  nowMs: number,
  betaMonths: number
): RetroVerdict {
  if (founder.status === "rejected") {
    return { action: "skip", reason: "rejected", targetMs: null };
  }
  if (typeof founder.accessGrantedAtMs !== "number") {
    return { action: "skip", reason: "no_access_grant", targetMs: null };
  }

  // 새 정책의 베타 창. pro 보상(설문·인터뷰)을 이미 받은 사람은 그쪽이 더 길다.
  const newBetaEndMs = addMonthsMs(founder.accessGrantedAtMs, betaMonths);
  const targetMs =
    typeof founder.proExpiresAtMs === "number" &&
    founder.proExpiresAtMs > newBetaEndMs
      ? founder.proExpiresAtMs
      : newBetaEndMs;

  // ★유료 보호가 가장 먼저다. 드라이런이 "제외 0명"을 봤어도 실행 시점엔
  // 바뀔 수 있으므로 판정은 매 실행마다 다시 한다.
  if (isLivePaidSubscription(sub)) {
    return { action: "skip", reason: "live_paid_guard", targetMs };
  }
  if (targetMs <= nowMs) {
    return { action: "skip", reason: "still_expired_after_retro", targetMs };
  }

  const existingEndMs = sub?.currentPeriodEndMs ?? null;
  if (typeof existingEndMs === "number" && existingEndMs >= targetMs) {
    return { action: "skip", reason: "already_longer", targetMs };
  }

  // 기존 만료일이 없거나 이미 지났으면 "되살아남", 아직 살아있으면 "연장".
  const wasCutOff = typeof existingEndMs !== "number" || existingEndMs <= nowMs;
  const baseMs =
    typeof existingEndMs === "number" && existingEndMs > nowMs
      ? existingEndMs
      : nowMs;
  const addedDays = Math.max(0, Math.round((targetMs - baseMs) / DAY_MS));

  return wasCutOff
    ? { action: "revive", targetMs, existingEndMs, addedDays }
    : { action: "extend", targetMs, existingEndMs, addedDays };
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 마케팅 동의 — ★판단을 코드에 못 박는다
// ════════════════════════════════════════════════════════════════════════════
//
// 판단(티켓이 "판단하고 근거를 적어라"고 요구한 것):
//
//  · 계정 O 26명 → **거래성 고지**로 본다(consentBasis="relationship").
//    이 사람들은 실제로 무료 Pro 구독을 받아 썼고 2026-08-14 에 그 구독이
//    종료됐다. "당신이 쓰던 베타의 기간이 3개월로 바뀌어 접근권이 복구됐다"는
//    **본인 계정 상태의 변경 통지**다. 광고성으로 읽더라도 정보통신망법 제50조
//    제1항 단서(거래관계를 통해 직접 수집한 연락처 · 거래 종료 6개월 이내 ·
//    동종 재화)에 그대로 들어간다(종료 2026-08-14, 발송 2026-08 → 2주).
//    → pending 까지 발송. **revoked·unsubscribed 는 어떤 근거로도 제외.**
//
//  · 계정 X 30명 → **보수적으로 간다**(consentBasis="granted_only").
//    가입한 적이 없다 = 재화·서비스를 제공받은 거래관계가 없다. 남은 건
//    waitlist 신청뿐이고, 그 폼의 `agreed` 는 "활동·인용 동의"이지 마케팅
//    수신동의가 아니다(marketingContacts.ts decideWaitlistConsentGrant 주석,
//    COMPLIANCE-AUDIT.md D2). 이 사람들에게 보내는 메일의 실질은 "가입하세요"
//    권유 = 광고성에 가깝다. 애매하면 보수적으로 — marketingConsent=true 로
//    granted 인 사람에게만 보낸다.
//
//  · 양쪽 모두 List-Unsubscribe(RFC 8058) 헤더와 수신거부 푸터를 **반드시**
//    싣는다. 거래성이라 판단한 쪽도 예외가 아니다 — 근거가 얇을수록 빠져나갈
//    문을 크게 열어 두는 게 맞다.

/** churnOutreach.ts 와 같은 이름·같은 의미를 쓴다(운영자가 두 캠페인을 오간다). */
export type ConsentBasis = "granted_only" | "relationship";

/** 코호트별 발송 근거. ★위 판단을 코드로 못 박은 것이다. */
export const RETRO_CONSENT_BASIS: Readonly<Record<RetroCohort, ConsentBasis>> =
  {
    account: "relationship",
    no_account: "granted_only",
  };

export type RetroConsentStatus = "granted" | "pending" | "revoked" | null;
export type RetroUnsubscribeStatus = "subscribed" | "unsubscribed" | null;

export type RetroBlockReason =
  /** 연락 가능한 이메일이 없다. */
  | "no_email"
  /** ★수신동의 철회 — 어떤 근거로도 넘을 수 없는 선. */
  | "marketing_consent_revoked"
  /** 수신거부 처리됨. */
  | "unsubscribed"
  /** 동의가 granted 가 아니다(pending/없음). granted_only 근거일 때만 나온다. */
  | "consent_not_granted"
  /** 소급 대상이 아니다(skip 판정) — 되살릴 것도 알릴 것도 없다. */
  | "not_actionable"
  /**
   * ★아직 안 끊긴 사람(action="extend"). 창은 늘려 주되 **메일은 보내지 않는다**.
   * 이 캠페인의 문면은 "30일 만에 끊겼던 접근이 되살아났다"이고, 끊긴 적 없는
   * 사람에게 그 문장은 거짓이다. 실측에서 6명이 여기 해당한다(드라이런의
   * "단순 연장(아직 살아있음)"). 별도 문면이 필요하면 별건으로 판단한다.
   */
  | "not_churned"
  /** 이미 이 캠페인 메일을 받았다(쿨다운 안). */
  | "already_sent";

/** 발송 게이트에 필요한 컨택트 사실. */
export interface RetroContactFacts {
  hasEmail: boolean;
  marketingConsentStatus: RetroConsentStatus;
  unsubscribeStatus: RetroUnsubscribeStatus;
}

/**
 * 발송 차단 사유 **전부**. 하나만 보고 끊지 않는다 — 오케/사장님이 "왜 이 사람은
 * 빠졌나"를 한 번에 봐야 판단이 된다.
 */
export function retroBlockReasons(
  contact: RetroContactFacts,
  consentBasis: ConsentBasis
): RetroBlockReason[] {
  const reasons: RetroBlockReason[] = [];
  if (!contact.hasEmail) reasons.push("no_email");
  if (contact.marketingConsentStatus === "revoked") {
    reasons.push("marketing_consent_revoked");
  } else if (
    consentBasis === "granted_only" &&
    contact.marketingConsentStatus !== "granted"
  ) {
    reasons.push("consent_not_granted");
  }
  if (contact.unsubscribeStatus === "unsubscribed") {
    reasons.push("unsubscribed");
  }
  return reasons;
}

// ════════════════════════════════════════════════════════════════════════════
// 3. 대상 선정
// ════════════════════════════════════════════════════════════════════════════

/** 스크립트가 조회해 채우는 후보 1건. */
export interface RetroCandidate {
  /** founders 컬렉션의 실제 doc id — 스탬프는 반드시 이 경로에 쓴다. */
  docId: string;
  /** sha256 앞 10자. 로그·리포트는 이 값으로만 사람을 지칭한다. */
  idHash: string;
  /** 정규화된 이메일. ★로그에 그대로 찍지 않는다(마스킹은 호출부 책임). */
  email: string;
  /** Firebase Auth uid. 없으면 null = 계정 X 코호트. */
  uid: string | null;
  locale: RetroLocale;
  founder: RetroFounderFacts;
  sub: RetroSubscriptionFacts | null;
  contact: RetroContactFacts;
  /** 이 캠페인의 마지막 발송 시각(ms). 미발송이면 null. */
  lastSentAtMs: number | null;
}

/**
 * 한 사람에게 실제로 무엇을 쓸지. ★계정 유무와 무관하게 founders 창은 **항상**
 * 쓴다 — 그러지 않으면 계정 X 가 가입해도 grantBetaProOnSignup 이
 * window_expired 로 스킵한다(모듈 상단 주석).
 */
export interface RetroApplyPlan {
  docId: string;
  idHash: string;
  /** founders/{docId}.betaExpiresAt 에 쓸 값(ms). 항상 존재한다. */
  writeFounderWindowMs: number;
  /**
   * subscriptions/{uid} 를 upsert 할 uid. 계정 X 면 null — 이때는 founders 창만
   * 쓰고, 부여는 가입하는 순간 grantBetaProOnSignup 이 한다.
   */
  upsertSubscriptionUid: string | null;
  /** 부여 사유 마커. 항상 BETA_RETRO_EXTEND_REASON. */
  reason: typeof BETA_RETRO_EXTEND_REASON;
}

/** 실제로 메일을 보낼 사람 1건. */
export interface RetroAudienceEntry {
  docId: string;
  idHash: string;
  email: string;
  locale: RetroLocale;
  cohort: RetroCohort;
  /** 소급 후 만료일(ms) — 메일 문면에 그대로 들어간다. */
  targetMs: number;
  addedDays: number;
  /** ★revive 만 남는다 — extend(끊긴 적 없음)는 위에서 메일 대상에서 빠진다. */
  action: "revive";
  consentBasis: ConsentBasis;
}

export interface RetroSelection {
  /** 메일 발송 대상. */
  mailable: RetroAudienceEntry[];
  /**
   * 소급 쓰기 대상. ★mailable 의 상위집합이다 — 수신거부자라도 **접근권은
   * 되살린다**. 동의가 없다는 건 "메일을 보내지 마라"이지 "권리를 주지 마라"가
   * 아니다. 반대로 하면 수신거부를 이유로 제품 접근을 뺏는 셈이 된다.
   */
  appliable: RetroApplyPlan[];
  /** 제외된 사람 — idHash 와 사유만. 이메일은 담지 않는다. */
  excluded: Array<{ idHash: string; reasons: RetroBlockReason[] }>;
  /** 사유별 건수(리포트용). */
  reasonCounts: Record<string, number>;
  /** skip 사유별 건수(소급 대상이 아닌 사람들). */
  skipCounts: Record<string, number>;
  /** 코호트 × 로케일 분포 — 완료보고에 쓰는 유일한 인적 정보. */
  distribution: Record<RetroCohort, Record<RetroLocale, number>>;
}

function emptyDistribution(): Record<RetroCohort, Record<RetroLocale, number>> {
  return {
    account: { ko: 0, en: 0, ja: 0 },
    no_account: { ko: 0, en: 0, ja: 0 },
  };
}

/**
 * 후보 목록에서 (a) 소급 쓰기 대상과 (b) 메일 발송 대상을 고른다.
 * 순수 함수 — 조회·쓰기·발송은 전부 호출부.
 */
export function selectRetroAudience(
  candidates: RetroCandidate[],
  opts: {
    nowMs: number;
    betaMonths: number;
    cooldownMs?: number;
    /** 테스트·운영자 오버라이드. 기본은 RETRO_CONSENT_BASIS. */
    consentBasisByCohort?: Readonly<Record<RetroCohort, ConsentBasis>>;
  }
): RetroSelection {
  const { nowMs, betaMonths } = opts;
  const cooldownMs = opts.cooldownMs ?? BETA_RETRO_COOLDOWN_DAYS * DAY_MS;
  const basisTable = opts.consentBasisByCohort ?? RETRO_CONSENT_BASIS;

  const mailable: RetroAudienceEntry[] = [];
  const appliable: RetroApplyPlan[] = [];
  const excluded: Array<{ idHash: string; reasons: RetroBlockReason[] }> = [];
  const reasonCounts: Record<string, number> = {};
  const skipCounts: Record<string, number> = {};
  const distribution = emptyDistribution();

  const bump = (table: Record<string, number>, key: string): void => {
    table[key] = (table[key] ?? 0) + 1;
  };

  for (const c of candidates) {
    const verdict = classifyRetroTarget(c.founder, c.sub, nowMs, betaMonths);
    if (verdict.action === "skip") {
      bump(skipCounts, verdict.reason);
      excluded.push({ idHash: c.idHash, reasons: ["not_actionable"] });
      bump(reasonCounts, "not_actionable");
      continue;
    }

    // ★소급 쓰기는 동의와 무관하다. 메일을 못 보내는 것과 접근권을 못 주는 것은
    // 다른 문제다.
    appliable.push({
      docId: c.docId,
      idHash: c.idHash,
      writeFounderWindowMs: verdict.targetMs,
      upsertSubscriptionUid: c.uid,
      reason: BETA_RETRO_EXTEND_REASON,
    });

    // ★끊긴 적 없는 사람에게 "다시 열렸습니다"를 보내면 거짓말이다.
    // 창은 이미 위에서 늘려 뒀다 — 여기서 막는 건 메일뿐이다.
    if (verdict.action === "extend") {
      excluded.push({ idHash: c.idHash, reasons: ["not_churned"] });
      bump(reasonCounts, "not_churned");
      continue;
    }

    const cohort: RetroCohort = c.uid ? "account" : "no_account";
    const consentBasis = basisTable[cohort];

    if (
      typeof c.lastSentAtMs === "number" &&
      nowMs - c.lastSentAtMs < cooldownMs
    ) {
      excluded.push({ idHash: c.idHash, reasons: ["already_sent"] });
      bump(reasonCounts, "already_sent");
      continue;
    }

    const reasons = retroBlockReasons(c.contact, consentBasis);
    if (reasons.length > 0) {
      excluded.push({ idHash: c.idHash, reasons });
      for (const r of reasons) bump(reasonCounts, r);
      continue;
    }

    mailable.push({
      docId: c.docId,
      idHash: c.idHash,
      email: c.email,
      locale: c.locale,
      cohort,
      targetMs: verdict.targetMs,
      addedDays: verdict.addedDays,
      action: verdict.action,
      consentBasis,
    });
    distribution[cohort][c.locale] += 1;
  }

  return {
    mailable,
    appliable,
    excluded,
    reasonCounts,
    skipCounts,
    distribution,
  };
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 메일 문안
// ════════════════════════════════════════════════════════════════════════════
//
// ── ★"이러이러한 걸 트라이해보라" — 하나만 고른다 ──────────────────────────
// 고른 것: **티켓 하나 열고 그 티켓에 에이전트를 붙인다** (`/tf-add` →
// `/tf-spawn-agents`). 근거 네 가지:
//
//  1) 실측 퍼널에서 최대 이탈 지점이 정확히 여기다. 7/14 코호트 22명 기준
//     앱 실행 22 → 첫 스폰 6 (**−73%**), 첫 스폰 → 첫 토큰 −17%.
//     (docs/beta-churn-root-cause-analysis-2026-07-21.md §1-B) 첫 스폰만 넘기면
//     그 다음 계단은 급격히 완만해진다 — 여기가 병목이고 여기만 넘기면 된다.
//  2) 우리가 세는 ACTIVATED 정의 자체가 이 관문을 지난다(activatedDefinition.ts:
//     설치 + 프로젝트 + **agent:spawned** + task 3개). 메일이 유도하는 행동과
//     회사가 성공이라고 부르는 것이 같아야 한다.
//  3) 앱 안 FirstSpawnGuide 의 "작은 일" 경로가 **이미 이 두 명령**을 띄운다
//     (components/onboarding/FirstSpawnGuide.tsx). 메일에 적은 문장이 앱을 열면
//     그대로 화면에 있다 — 메일과 제품이 다른 말을 하지 않는다.
//  4) 탈락시킨 후보: "저장소 연결 후 첫 PR" 은 스폰 뒤로 단계가 3개 더 있어
//     첫 세션에 끝나지 않는다. "오케에게 일 시키기" 는 완료 판정이 없어 본인도
//     우리도 성공했는지 모른다(측정되는 이벤트가 없다).
//
// ── ★과장 금지 ─────────────────────────────────────────────────────────────
// "그 사이 좋아진 것"은 **출시된 빌드에 들어간 것만** 쓴다. 현재 릴리스는
// v3.0.37 이고, 여기 적은 세 줄은 전부 CHANGELOG 3.0.35 항목이다 — 그리고 그
// 셋은 정확히 이 사람들이 겪은 실패다(스폰 6명 중 다수가 crash·무산출,
// 근본원인 분석 §2). 8/29 에 머지된 것들(앱 안 웹 탭 #1280, 팀 역할 정리
// #1297·#1299, 계정별 상태 격리 #1283)은 **아직 릴리스에 없어서 쓰지 않는다.**
// 확인 안 된 개선을 쓰면 두 번째 이탈은 영구적이다.

const SUPPORT_EMAIL = "team@marblo.app";
const SITE_BASE = "https://marblo.app";

/** 계단 값. ★#1304 로 확정된 값을 그대로 쓴다(founderLadder.ts 와 같아야 한다). */
export const RETRO_BETA_MONTHS = 3;
export const RETRO_SURVEY_MONTHS = 5;
export const RETRO_INTERVIEW_MONTHS = 9;

export interface RetroEmailParams {
  /** 소급 후 만료일 — "YYYY-MM-DD". 사람마다 다르다. */
  expiresOn: string;
}

/** ms → YYYY-MM-DD(UTC). 스크립트와 테스트가 같은 규칙을 쓰게 한다. */
export function toExpiresOn(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

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

function cmd(text: string): string {
  return `<code style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;background:#f1f2f4;padding:2px 6px;border-radius:4px">${text}</code>`;
}

/** 문면 한 벌. 로케일 × 코호트로 갈린다. */
interface RetroCopy {
  subject: string;
  /** 사실관계 — 무슨 일이 있었고 지금 어떤 상태인가. */
  situation: string[];
  /** ★제안. 부탁이 아니다 — "이렇게 한번 해보세요". 제목 + 두 단계. */
  tryTitle: string;
  tryStep1: string;
  tryStep2: string;
  /**
   * ★해자 한 문단. 오케 → 티켓 → 워크트리 → 에이전트 → 오케브레인 미션
   * 클로즈드 루프, 그리고 "단순 병렬이 아니라 의존성에 맞춰 동시에".
   * ★여기 적힌 것은 전부 지금 도는 기능이다(WorktreeCoordinator.prepare 가
   * 스폰 직전 워크트리를 보장하고, DAGResolver 가 ready/blocked 를 갈라
   * dependsOnCompleted 로 풀며, orchestrator.chain.* 패널이 미션 진행을
   * 보드 판정으로 닫는다). ★확인되지 않은 기능을 여기에 쓰지 마라.
   */
  chain: string;
  tryTime: string;
  /** 그 사이 실제로 고쳐진 것(출시된 빌드 기준). */
  changedTitle: string;
  changed: string[];
  /** 계단 안내. 계정 X 쪽은 "피드백 → 기간 연장"을 혜택으로 앞세운다. */
  ladder: string;
  /** 링크 라벨·URL. */
  ctaLabel: string;
  ctaUrl: string;
  signoff: string;
}

function copyFor(
  locale: RetroLocale,
  cohort: RetroCohort,
  params: RetroEmailParams
): RetroCopy {
  const { expiresOn } = params;
  const downloadUrl = `${SITE_BASE}/${locale}/download`;
  const signupUrl = `${SITE_BASE}/${locale}/auth/signup`;

  if (locale === "en") {
    const changed = [
      "An agent could start in a new worktree without ever receiving its instructions, while the board showed it as “working”. Fixed.",
      "The orchestrator could be stuck while the screen still showed a green “running”. It now says what it is waiting on.",
      "On a fresh Mac the orchestrator could stall on the first-run screen and never start. It now gets past that on its own.",
    ];
    const chain = `Orchestrator → ticket → worktree → agent, and the Orchestrator Brain closes all of it as one mission. <strong>This is not plain parallelism</strong> — one live mission is worked by several agents <strong>at the same time, in dependency order</strong>. Tickets that are ready go out at once; a ticket waiting on another one waits, then starts the moment that one clears. And done is decided by the board, not by an agent saying so.`;
    if (cohort === "account") {
      return {
        subject: `Your Marblo beta is now 3 months — your account is open again (until ${expiresOn})`,
        situation: [
          "Your beta window closed after 30 days, and Marblo went back to Free.",
          `We changed the beta from 1 month to 3 months. That change applies to you retroactively — your account is open again until <strong>${expiresOn}</strong>. Sign in and it is there. Nothing to buy, nothing to claim.`,
        ],
        tryTitle: "Try it like this",
        tryStep1: `Open the orchestrator and type ${cmd(
          "/tf-add"
        )} to put tickets on the board. One is fine. A few that depend on each other is better — that is where you see the difference.`,
        tryStep2: `Then type ${cmd(
          "/tf-spawn-agents"
        )}. Every ticket gets its own isolated git worktree, and an agent works inside it. They do not step on each other's files.`,
        chain,
        tryTime:
          "That is the part you will not get elsewhere. Five minutes of watching it run says more than we can.",
        changedTitle: "What actually changed while you were gone",
        changed,
        ladder: `The ladder also moved: <strong>3 months</strong> of beta, <strong>5 months total</strong> if you send a thoughtful beta survey that passes review, and <strong>9 months total</strong> if you also do a short video interview.`,
        ctaLabel: "Download the latest build →",
        ctaUrl: downloadUrl,
        signoff: "Thank you,\nThe Marblo team",
      };
    }
    return {
      subject: `The Marblo beta you signed up for is now 3 months — your spot is held until ${expiresOn}`,
      situation: [
        "You were selected as a Marblo founder, but our records show you never created an account — so there is nothing to restore, and this is not a “welcome back”.",
        `We changed the beta from 1 month to 3 months, and we have held your window open until <strong>${expiresOn}</strong>. Create an account with <em>this same email address</em> and the beta is applied automatically.`,
      ],
      tryTitle: "Create your account, then try it like this",
      tryStep1: `Sign up at <a href="${signupUrl}" style="color:#4f46e5">${signupUrl}</a> with this email address, then download the app.`,
      tryStep2: `In the orchestrator, type ${cmd(
        "/tf-add"
      )} to put tickets on the board — a few that depend on each other is best — then ${cmd(
        "/tf-spawn-agents"
      )}. Every ticket gets its own isolated git worktree, and an agent works inside it.`,
      chain,
      tryTime:
        "Five minutes is enough to see what running agent work at this shape actually feels like.",
      changedTitle: "What used to break on a first spawn, and no longer does",
      changed,
      ladder: `<strong>Send us feedback and your window gets longer.</strong> <strong>3 months</strong> of beta to start, <strong>5 months total</strong> if you send a thoughtful beta survey that passes review, and <strong>9 months total</strong> if you also do a short video interview.`,
      ctaLabel: "Create your account →",
      ctaUrl: signupUrl,
      signoff: "Thank you,\nThe Marblo team",
    };
  }

  if (locale === "ja") {
    const changed = [
      "新しいワークツリーでエージェントが指示を受け取れないまま、ボードには「作業中」と表示されていた問題を修正しました。",
      "オーケストレーターが止まっているのに画面は緑の「実行中」のままだった問題を修正しました。今は何を待っているかを画面が伝えます。",
      "新しい Mac で初回起動画面のままオーケストレーターが起動しないことがありました。今は自動で通過します。",
    ];
    const chain = `オーケストレーター → チケット → ワークツリー → エージェント、そして Orchestrator Brain がその全体を1つのミッションとして閉じます。<strong>単なる並列ではありません</strong> — 生きたミッション1つを、複数のエージェントが<strong>依存関係に沿って同時に</strong>処理します。準備できたチケットはすぐ着手され、前のチケットを待つものは待機し、解けた瞬間に入ります。完了はエージェントの自己申告ではなくボードが判定します。`;
    if (cohort === "account") {
      return {
        subject: `Marblo ベータが3ヶ月に延長 — アカウントが再び開きました（${expiresOn} まで）`,
        situation: [
          "30日でベータ期間が終わり、アカウントは Free に戻っていました。",
          `ベータ期間を1ヶ月から3ヶ月に変更し、その変更を遡って適用しました。<strong>${expiresOn}</strong> までアカウントが再び開いています。ログインすればそのまま使えます。購入も申請も不要です。`,
        ],
        tryTitle: "こんなふうに試してみてください",
        tryStep1: `オーケストレーターで ${cmd(
          "/tf-add"
        )} と入力し、チケットをボードに載せてください。1つでも構いませんが、互いに依存する複数のチケットのほうが違いが見えます。`,
        tryStep2: `続けて ${cmd(
          "/tf-spawn-agents"
        )} と入力します。チケットごとに隔離された git ワークツリーが用意され、エージェントはその中で作業します。互いのファイルを踏みません。`,
        chain,
        tryTime:
          "ここが Marblo の違いです。説明より、5分動かしてご覧いただくほうが早いはずです。",
        changedTitle: "その間に実際に直ったこと",
        changed,
        ladder: `段階も変わりました。ベータ<strong>3ヶ月</strong>、審査を通過する丁寧なベータアンケートで<strong>合計5ヶ月</strong>、さらに短いビデオインタビューまで完了すると<strong>合計9ヶ月</strong>です。`,
        ctaLabel: "最新ビルドをダウンロード →",
        ctaUrl: downloadUrl,
        signoff: "ありがとうございます。\nMarblo チーム",
      };
    }
    return {
      subject: `お申し込みの Marblo ベータが3ヶ月に — ${expiresOn} まで枠をお取りしています`,
      situation: [
        "Marblo のファウンダーに選ばれていますが、記録上まだアカウントを作成されていません。したがって復元するものはなく、これは「おかえりなさい」のご案内ではありません。",
        `ベータ期間を1ヶ月から3ヶ月に変更し、<strong>${expiresOn}</strong> まで枠をお取りしています。<em>このメールアドレスと同じアドレス</em>でアカウントを作成いただくと、ベータが自動的に適用されます。`,
      ],
      tryTitle: "アカウントを作成して、こんなふうに試してみてください",
      tryStep1: `<a href="${signupUrl}" style="color:#4f46e5">${signupUrl}</a> でこのメールアドレスを使って登録し、アプリをダウンロードしてください。`,
      tryStep2: `オーケストレーターで ${cmd(
        "/tf-add"
      )} と入力してチケットをボードに載せ（互いに依存する複数だとなお良いです）、続けて ${cmd(
        "/tf-spawn-agents"
      )} と入力します。チケットごとに隔離された git ワークツリーが用意され、エージェントがその中で作業します。`,
      chain,
      tryTime:
        "より効率の高いエージェント業務がどういうものか、5分で実際にご覧いただけます。",
      changedTitle: "初回スポーンで詰まっていた点は、すでに直っています",
      changed,
      ladder: `<strong>フィードバックをいただくと期間がさらに延びます。</strong>まずベータ<strong>3ヶ月</strong>、審査を通過する丁寧なベータアンケートで<strong>合計5ヶ月</strong>、さらに短いビデオインタビューまで完了すると<strong>合計9ヶ月</strong>。`,
      ctaLabel: "アカウントを作成する →",
      ctaUrl: signupUrl,
      signoff: "ありがとうございます。\nMarblo チーム",
    };
  }

  // 기본: 한국어
  const changed = [
    "새 워크트리에서 에이전트가 지시를 받지 못한 채 보드에는 “일하는 중”으로 보이던 문제를 고쳤습니다.",
    "오케가 멈췄는데 화면은 계속 초록색 “실행 중”으로 보이던 문제를 고쳤습니다. 이제 무엇을 기다리는지 화면이 말합니다.",
    "새 맥에서 오케가 첫 실행 화면에 멈춰 아무것도 시작되지 않던 문제를 고쳤습니다. 이제 사람 손 없이 통과합니다.",
  ];
  const chain = `오케 → 티켓 → 워크트리 → 에이전트, 그리고 오케브레인이 그 전부를 미션 하나로 닫습니다. <strong>단순 병렬이 아닙니다</strong> — 살아있는 미션 하나를 여러 에이전트가 <strong>의존성에 맞춰 동시에</strong> 처리합니다. 준비된 티켓은 바로 나가고, 앞 티켓을 기다려야 하는 것은 기다렸다가 풀리는 순간 들어갑니다. 완료는 에이전트가 그렇다고 말해서가 아니라 보드가 판정합니다.`;
  if (cohort === "account") {
    return {
      subject: `마블로 베타가 3개월로 늘었습니다 — 계정이 다시 열렸습니다 (${expiresOn}까지)`,
      situation: [
        "30일 만에 베타 기간이 끝나 계정이 Free 로 돌아갔었습니다.",
        `베타 기간을 1개월에서 3개월로 바꿨고, 그 변경을 소급 적용했습니다. <strong>${expiresOn}</strong>까지 계정이 다시 열려 있습니다. 로그인하시면 그대로 쓰실 수 있습니다. 결제도, 신청도 필요 없습니다.`,
      ],
      tryTitle: "이렇게 한번 해보세요",
      tryStep1: `오케에 ${cmd(
        "/tf-add"
      )} 를 치고 티켓을 보드에 올리세요. 하나여도 되지만, 서로 물려 있는 여러 개일 때 차이가 보입니다.`,
      tryStep2: `이어서 ${cmd(
        "/tf-spawn-agents"
      )} 를 치세요. 티켓마다 격리된 git 워크트리가 잡히고, 에이전트가 각자 그 안에서 작업합니다. 서로의 파일을 밟지 않습니다.`,
      chain,
      tryTime:
        "마블로가 다른 지점이 여기입니다. 설명보다 5분 돌려 보시는 게 빠릅니다.",
      changedTitle: "그 사이 실제로 고쳐진 것",
      changed,
      ladder: `계단도 바뀌었습니다. 베타 <strong>3개월</strong>, 성실한 베타 설문이 검토를 통과하면 <strong>총 5개월</strong>, 짧은 화상 인터뷰까지 하시면 <strong>총 9개월</strong>입니다.`,
      ctaLabel: "최신 빌드 받기 →",
      ctaUrl: downloadUrl,
      signoff: "감사합니다.\n마블로 팀 드림",
    };
  }
  return {
    subject: `신청하신 마블로 베타가 3개월로 늘었습니다 — ${expiresOn}까지 자리를 비워 뒀습니다`,
    situation: [
      "마블로 파운더로 선정해 드렸지만, 기록상 아직 가입하신 적이 없습니다. 그래서 되살릴 것도 없고, 이 메일은 “돌아오셨습니다” 안내가 아닙니다.",
      `베타 기간을 1개월에서 3개월로 바꾸면서 회원님 몫의 창을 <strong>${expiresOn}</strong>까지 열어 뒀습니다. <em>이 메일을 받으신 바로 그 주소</em>로 가입하시면 베타가 자동으로 적용됩니다.`,
    ],
    tryTitle: "가입하시고, 이렇게 한번 해보세요",
    tryStep1: `<a href="${signupUrl}" style="color:#4f46e5">${signupUrl}</a> 에서 이 주소로 가입하시고 앱을 받으세요.`,
    tryStep2: `오케에 ${cmd(
      "/tf-add"
    )} 를 쳐서 티켓을 보드에 올리고(서로 물려 있는 여러 개면 더 좋습니다), 이어서 ${cmd(
      "/tf-spawn-agents"
    )} 를 치세요. 티켓마다 격리된 git 워크트리가 잡히고, 에이전트가 각자 그 안에서 작업합니다.`,
    chain,
    tryTime:
      "더 효율 높은 에이전트 업무가 어떤 것인지, 5분이면 직접 보실 수 있습니다.",
    changedTitle: "첫 스폰에서 걸리던 것들은 그 사이 고쳤습니다",
    changed,
    ladder: `<strong>써 보시고 피드백을 주시면 기간이 더 늘어납니다.</strong> 우선 베타 <strong>3개월</strong>, 성실한 베타 설문이 검토를 통과하면 <strong>총 5개월</strong>, 짧은 화상 인터뷰까지 하시면 <strong>총 9개월</strong>.`,
    ctaLabel: "가입하러 가기 →",
    ctaUrl: signupUrl,
    signoff: "감사합니다.\n마블로 팀 드림",
  };
}

/** HTML 태그를 걷어낸 평문(text 파트 생성용). 문면을 두 번 쓰지 않게 한다. */
function plain(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"');
}

/**
 * 복귀 안내 메일. 발신·답장은 호출부(postResendEmail 규약)가 team@marblo.app 로
 * 고정한다 — 여기서 From 을 만들지 않는다. 수신거부 푸터도 호출부가 붙인다
 * (index.ts withUnsubscribeFooter 와 같은 규약).
 */
export function buildBetaRetroExtendEmail(
  locale: RetroLocale,
  cohort: RetroCohort,
  params: RetroEmailParams
): RetroEmailContent {
  const c = copyFor(locale, cohort, params);

  const html = shell(
    [
      ...c.situation.map(p),
      `<p style="margin:24px 0 10px;font-size:17px;font-weight:700">${c.tryTitle}</p>`,
      `<ol style="margin:0 0 14px;padding-left:20px"><li style="margin:0 0 8px">${c.tryStep1}</li><li>${c.tryStep2}</li></ol>`,
      // ★해자 문단 — 제안의 알맹이라 본문에서 눈에 띄게 둔다.
      `<p style="margin:0 0 14px;padding:12px 14px;background:#f5f5ff;border-left:3px solid #4f46e5;border-radius:6px">${c.chain}</p>`,
      p(`<span style="color:#555">${c.tryTime}</span>`),
      `<p style="margin:0 0 20px"><a href="${c.ctaUrl}" style="display:inline-block;background:#4f46e5;color:#fff;padding:10px 18px;border-radius:8px;font-weight:600;text-decoration:none">${c.ctaLabel}</a></p>`,
      `<p style="margin:24px 0 8px;font-weight:700">${c.changedTitle}</p>`,
      `<ul style="margin:0 0 14px;padding-left:20px;color:#555">${c.changed
        .map((line) => `<li style="margin:0 0 6px">${line}</li>`)
        .join("")}</ul>`,
      p(`<span style="color:#555">${c.ladder}</span>`),
      p(c.signoff.replace("\n", "<br>")),
    ].join("\n")
  );

  const text = [
    ...c.situation.map(plain),
    "",
    c.tryTitle,
    `1. ${plain(c.tryStep1)}`,
    `2. ${plain(c.tryStep2)}`,
    "",
    plain(c.chain),
    "",
    plain(c.tryTime),
    "",
    `${plain(c.ctaLabel)} ${c.ctaUrl}`,
    "",
    c.changedTitle,
    ...c.changed.map((line) => `- ${plain(line)}`),
    "",
    plain(c.ladder),
    "",
    c.signoff,
    "",
    `Marblo · ${SUPPORT_EMAIL}`,
  ].join("\n");

  return { subject: c.subject, html, text };
}
