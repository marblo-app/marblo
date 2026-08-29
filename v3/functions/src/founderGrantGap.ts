// 선정 65 vs founder_grant 34 — **왜 31명에게 grant 가 안 붙었나**의 판정 로직.
// 티켓 cw6lqyiFtspyx3LONt8y (사장님 지시: "접근권 34명 되살리는 티켓 열어줘.")
//
// ── 이 모듈이 존재하는 이유 ────────────────────────────────────────────────
// 되살리기보다 **원인이 먼저**다. 원인을 모른 채 백필만 하면 다음 선정자에게
// 그대로 다시 생긴다 — 그리고 이미 한 번 그랬다:
//   · 2026-07 티켓 bi1zzeidtqm6sxzgguyP / PR#468 이
//     `scripts/backfill-founder-pro-grants.mjs` 로 "계정 O · grant 없음" 덩어리를
//     0 으로 청소했다(index.ts L5906~ 주석의 실측: ③=0, 2026-07-17).
//   · 그런데 2026-08 에 다시 31 이 벌어졌다.
// 청소해도 다시 새는 것은 백필이 부족했기 때문이 아니라 **부여 경로에 수렴
// 장치가 없기 때문**이다. 그래서 이 모듈은 백필 계획(2절)보다 **진단(1절)**을
// 먼저 둔다. 진단 분포가 근본 수리의 우선순위를 정한다.
//
// ── 부여가 일어나는 순간은 딱 두 번뿐이다(index.ts) ────────────────────────
//   ① markFounderSelectedInternal — 선정 시점에 lookupUidByEmail 로 uid 를
//      찾으면 즉시 materialize. **uid 가 없으면 아무 일도 하지 않는다.**
//   ② grantBetaProOnSignup(auth onCreate) — 가입하는 순간 뒤늦게 부여.
// 그리고 **재시도·수렴 경로가 없다.** 만료 스윕(scheduledExpireBetaGrants)은
// 있는데 미부여 수렴 크론은 없다. 두 순간을 놓치면 영구히 안 붙는다.
//
// ── ★조용한 게이트: materializeFounderProGrantForUid 의 window_expired ─────
// ①②는 모두 materializeFounderProGrantForUid 를 통과하고, 거기엔
//   resolveFounderGrantWindowEnd(founder) <= now → skippedReason="window_expired"
// 가 있다. 이 경로는 구독을 만들지 않고, founders 문서에 흔적도 남기지 않고,
// **로그조차 남기지 않는다.** 게다가 betaExpiresAt 이 없는 legacy 문서의 창은
// accessGrantedAt + FOUNDER_LEGACY_BETA_MONTHS(=1) 로 재구성된다.
// → **선정 후 창이 닫힌 뒤에 가입한 사람은 가입해도 부여가 0이다.**
// 이건 추론이 아니라 src/betaRetroExtend.ts 머리주석이 #1305 드라이런 실측으로
// 이미 적어 둔 사실이다(계정 X 30명 = "가입해도 부여 0").
//
// ── 왜 "갭 31" 을 곧바로 "못 쓰는 31" 로 세면 안 되는가 ────────────────────
// 결제 웹훅(toss/paddle/portone)은 subscriptions.paymentProvider 를 덮어쓴다
// (index.ts L1492·1724·2949·3253…). 즉 grant 를 받은 뒤 유료로 전환한 사람은
// "founder_grant" 카운트에서 빠진다. 그 사람은 접근권이 없는 게 아니라 **돈을
// 내고 쓰고 있다.** 그래서 진단은 paid_live 를 별도 칸으로 뽑아 갭에서 뺀다.
// 이 칸을 안 만들면 되살릴 필요 없는 사람까지 대상에 넣고, 최악의 경우
// upsertProSubscription 의 유료 보호 가드를 시험하게 된다.
//
// 쓰기는 이 모듈에 없다. 판정만 한다. 실행은 승인 후 별도 스크립트다.
//
// 실행: npm run test:founder-grant-gap

import { addMonths } from "./founderLadder";
import { resolveGrantPlanType } from "./grantPlan";

/**
 * 이 캠페인의 사유 마커. ★나중에 코호트에서 이 인원을 분리하는 유일한 표식이다.
 * `grantPlan.ts` 의 TEAM_GRANT_REASONS 에 등록돼 있어야 team 이 부여된다 —
 * 등록을 빠뜨리면 31명만 조용히 pro 를 받아 협업 기능이 안 열린다.
 */
export const SELECTED_GAP_BACKFILL_REASON =
  "grant_backfill_selected_gap_2026_08";

/** founders 문서 백필 스탬프. 재실행이 중복 부여를 하지 않게 하는 멱등키. */
export const SELECTED_GAP_BACKFILL_AT_FIELD = "selectedGapBackfillAppliedAt";

/** 실행 2차 게이트. --apply 만으로는 부족하다. */
export const SELECTED_GAP_APPLY_CONFIRM =
  "APPLY-GRANT-BACKFILL-SELECTED-GAP-2026-08";

const DAY_MS = 24 * 60 * 60 * 1000;

// ════════════════════════════════════════════════════════════════════════════
// 0. 조회부가 채워 주는 사실들 — 판정에 필요한 필드만
// ════════════════════════════════════════════════════════════════════════════

/** founders/{email} 에서 판정에 쓰는 값. */
export interface GapFounderFacts {
  /** founders.status — "selected" | "rejected" | … */
  status: string | null;
  accessGrantedAtMs: number | null;
  betaExpiresAtMs: number | null;
  proExpiresAtMs: number | null;
  /** 과거에 grant 를 materialize 한 흔적. 없으면 한 번도 안 붙은 것이다. */
  proSubscriptionUid: string | null;
}

/** Firebase Auth 계정. 계정이 없으면 null 을 넘긴다. */
export interface GapAccountFacts {
  uid: string;
  /**
   * 계정 생성 시각. ★"창이 닫힌 뒤에 가입했는가"를 가르는 유일한 증거라서
   * 진단의 핵심 입력이다. Identity Toolkit 이 안 주면 null(→ 미확인 칸으로).
   */
  createdAtMs: number | null;
}

/** subscriptions/{uid}. 문서가 없으면 null 을 넘긴다. */
export interface GapSubscriptionFacts {
  status: string | null;
  /** 기존 플랜. 강등 금지 가드(resolveGrantPlanType)가 참조한다. */
  planType: string | null;
  founderGrant: boolean;
  paymentProvider: string | null;
  /**
   * 결제 흔적. ★index.ts hasPaymentEvidence 는 portone 키를 일부만 본다
   * (churnOutreach 주석의 실측 사례). 조회부가 **넓게** 채워 오판 방향을
   * 안전쪽(=건드리지 않음)으로 둔다.
   */
  hasPaymentEvidence: boolean;
  currentPeriodEndMs: number | null;
  founderGrantReason: string | null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. 진단 — "왜 이 사람에게 grant 가 안 붙었나"
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★상호배타다. 한 사람은 정확히 한 칸에 들어간다 — 그래야 분포의 합이 선정자
 * 수와 맞고, 어느 원인이 몇 명인지 말할 수 있다. 겹치는 분류를 만들면 "대충
 * 이런 이유들이 있다"가 되어 근본 수리의 우선순위를 못 정한다.
 */
export type GrantGapDiagnosis =
  /** 선정자가 아니다(반려 또는 accessGrantedAt 없음) — 분모에서 빠진다. */
  | "not_selected"
  /** grant 문서가 실제로 있다 — 갭이 아니라 34 쪽 사람이다. */
  | "grant_present"
  /**
   * ★현역 유료 구독. grant 마커가 없어 34 에서 빠지지만 **접근권은 있다.**
   * 갭 31 을 "못 쓰는 31" 로 읽으면 안 되는 이유가 이 칸이다.
   */
  | "paid_live"
  /** 계정이 없다 — 붙일 uid 자체가 없다. grant 를 미리 만들 수 없다. */
  | "no_account"
  /**
   * ★계정은 있는데 **창이 닫힌 뒤에 가입**했다. auth onCreate 가
   * window_expired 로 조용히 스킵한 자리다 — 코드 결함의 직접 증거.
   */
  | "signup_after_window"
  /**
   * 계정이 있고 가입 시점에 창도 열려 있었는데 grant 가 없다. 부여가 조용히
   * 실패한 자리 = **미확인 잔여**. 여기 수가 크면 별도 조사가 필요하다.
   */
  | "account_no_grant_window_open"
  /** 계정은 있는데 가입 시각을 못 얻었다 — 위 둘로 못 가른다. 미확인. */
  | "account_no_grant_unknown_signup";

/** index.ts isFounderGrantSubscription 과 동일 규칙. */
export function isFounderGrantSubscription(
  sub: GapSubscriptionFacts | null,
): boolean {
  if (!sub) return false;
  return sub.founderGrant || sub.paymentProvider === "founder_grant";
}

/** index.ts isLivePaidSubscription 과 동일 순서(grant 아님 → 현역 → 결제흔적). */
export function isLivePaidSubscription(
  sub: GapSubscriptionFacts | null,
): boolean {
  if (!sub || isFounderGrantSubscription(sub)) return false;
  if (sub.status !== "active" && sub.status !== "past_due") return false;
  return sub.hasPaymentEvidence;
}

/**
 * index.ts `resolveFounderGrantWindowEnd` 의 복제. ★이 값이 어긋나면 "가입해도
 * 부여가 0이었다"는 진단 자체가 틀린다.
 *
 * legacyBetaMonths 를 인자로 받는 이유: 이 값을 FOUNDER_BETA_MONTHS 로 바꾸는
 * 순간 legacy 선정자 전원의 창이 조용히 늘어나기 때문에, 호출부가 어떤 값을
 * 쓰는지 눈에 보여야 한다(index.ts 는 FOUNDER_LEGACY_BETA_MONTHS = 1 을 쓴다).
 */
export function resolveGrantWindowEndMs(
  founder: GapFounderFacts,
  legacyBetaMonths: number,
): number | null {
  const beta = founder.betaExpiresAtMs;
  const pro = founder.proExpiresAtMs;
  if (typeof beta === "number" && typeof pro === "number") {
    return Math.max(beta, pro);
  }
  if (typeof beta === "number") return beta;
  if (typeof pro === "number") return pro;
  if (typeof founder.accessGrantedAtMs !== "number") return null;
  return addMonths(
    new Date(founder.accessGrantedAtMs),
    legacyBetaMonths,
  ).getTime();
}

/**
 * 한 선정자가 왜 grant 를 못 받았는지 판정한다. 부수효과 없음.
 *
 * 순서에 의미가 있다 — 앞선 칸이 뒤 칸을 흡수한다:
 *   대상 여부 → 이미 있음 → 유료로 대체됨 → 계정 없음 → 창 닫힘 → 미확인.
 */
export function diagnoseGrantGap(
  founder: GapFounderFacts,
  account: GapAccountFacts | null,
  sub: GapSubscriptionFacts | null,
  legacyBetaMonths: number,
): GrantGapDiagnosis {
  if (founder.status === "rejected") return "not_selected";
  if (typeof founder.accessGrantedAtMs !== "number") return "not_selected";

  if (isFounderGrantSubscription(sub)) return "grant_present";
  // ★유료 판정은 grant 판정 **다음**이다. 순서를 뒤집으면, grant 로 시작해
  // 나중에 결제한 사람(founderGrant=true 가 남아 있다)이 유료로 분류돼
  // "갭이 아닌데 갭"이 된다.
  if (isLivePaidSubscription(sub)) return "paid_live";

  if (!account) return "no_account";

  // 여기부터는 "계정 O · grant 없음". 7월 백필이 0으로 만들었던 바로 그 칸이
  // 다시 찬 것이므로, 왜 다시 찼는지를 가입 시각으로 가른다.
  const windowEndMs = resolveGrantWindowEndMs(founder, legacyBetaMonths);
  if (typeof account.createdAtMs !== "number") {
    return "account_no_grant_unknown_signup";
  }
  if (typeof windowEndMs === "number" && account.createdAtMs > windowEndMs) {
    return "signup_after_window";
  }
  return "account_no_grant_window_open";
}

/** 진단이 "이 사람은 접근권을 못 쓰고 있다"를 뜻하는가. 갭의 실질 인원 계산용. */
export function isMissingAccess(diagnosis: GrantGapDiagnosis): boolean {
  return (
    diagnosis === "no_account" ||
    diagnosis === "signup_after_window" ||
    diagnosis === "account_no_grant_window_open" ||
    diagnosis === "account_no_grant_unknown_signup"
  );
}

// ════════════════════════════════════════════════════════════════════════════
// 2. 백필 계획 — "지금 되살리면 무슨 일이 일어나는가"
// ════════════════════════════════════════════════════════════════════════════
//
// ── ★기간 판단: 3개월이 맞다. 그리고 앵커는 accessGrantedAt 이 아니라 now 다 ──
//
// 길이 = FOUNDER_BETA_MONTHS(3). 티켓이 준 근거 그대로다 — 이 사람들은 선정
// 당시의 약속을 **복원**받는 게 아니라(그건 FOUNDER_LEGACY_BETA_MONTHS=1 이
// 쓰이는 #1305 의 일이다) 한 번도 받은 적이 없는 접근권을 **처음** 받는다.
// 처음 주는 것은 오늘의 정책으로 준다.
//
// ★앵커가 더 중요하다. accessGrantedAt + 3개월로 잡으면 6월 선정자는 9월에
// 창이 닫히므로 "되살렸는데 며칠"이 되고, 5월 선정자는 **0일**이 된다. 되살리기
// 자체가 무의미해진다. 이 31명은 접근권을 단 하루도 소비하지 않았다 — 소비하지
// 않은 기간을 소비한 것으로 치는 앵커는 사실과 다르다. 그리고 #1304 가 베타를
// 3개월로 올린 근거("D30 을 재는 시점에 접근권이 살아 있어야 리텐션을 잰다")는
// 창의 시작이 **실제 사용 시작**일 때만 성립한다.
//   → 계정 O: now + 3개월.
//   → 계정 X: 붙일 uid 가 없다. founders 창만 열어 두고, 실제 부여는 가입 시점
//     onCreate 에 맡긴다. ★그래서 창을 now+3 으로 열면 2개월 뒤 가입자는 1개월만
//     받는다 — 이건 창 열기의 구조적 한계이고, 근본 수리(가입시점 앵커)로만
//     없어진다. 드라이런은 이 손실을 숨기지 않고 그대로 보고한다.

/** 백필이 한 사람에게 하려는 일. */
export type GapBackfillPlan =
  | {
      action: "skip";
      reason: /** 선정자가 아니다. */
        | "not_selected"
        /** 이미 grant 가 있다. */
        | "already_granted"
        /** ★현역 유료 — 어떤 플래그로도 넘지 않는다. 덮어쓰면 과금이 끊긴다. */
        | "live_paid_guard"
        /** 이미 더 긴 기간을 들고 있다(기간을 줄이는 부여는 없다). */
        | "already_longer";
    }
  | {
      /** 계정 O — subscriptions/{uid} 를 만들면 즉시 쓸 수 있다. */
      action: "grant";
      uid: string;
      periodEndMs: number;
      /** 실제로 쓸 planType(강등 금지 가드를 통과한 값). */
      planType: string;
      /** 기존 구독 문서가 있었는가(만료·해지 잔재 포함). */
      hadSubscription: boolean;
      addedDays: number;
    }
  | {
      /**
       * 계정 X — 붙일 uid 가 없다. founders.betaExpiresAt 만 열어 두고 실제
       * 부여는 가입 시 onCreate 에 맡긴다. ★창을 안 열면 지금 가입해도
       * window_expired 로 0 부여다(= 메일을 보내면 그 메일이 거짓이 된다).
       */
      action: "open_window";
      newBetaExpiresAtMs: number;
      /** 기존 창(있으면). 전/후 출력용. */
      previousBetaExpiresAtMs: number | null;
    };

/**
 * 백필 계획을 세운다. 쓰기 없음.
 *
 * 보호 규칙은 upsertProSubscription 을 그대로 복제한다 — 여기서 다르게 쓰면
 * 드라이런 숫자가 실행과 어긋나 판단 근거가 되지 못한다.
 */
export function planGrantBackfill(
  founder: GapFounderFacts,
  account: GapAccountFacts | null,
  sub: GapSubscriptionFacts | null,
  nowMs: number,
  betaMonths: number,
): GapBackfillPlan {
  if (founder.status === "rejected")
    return { action: "skip", reason: "not_selected" };
  if (typeof founder.accessGrantedAtMs !== "number") {
    return { action: "skip", reason: "not_selected" };
  }
  if (isFounderGrantSubscription(sub)) {
    return { action: "skip", reason: "already_granted" };
  }
  // ★유료 보호가 가장 먼저다. 드라이런이 "0명"을 봤어도 실행 시점엔 바뀔 수
  // 있으므로 판정은 매 실행마다 다시 한다.
  if (isLivePaidSubscription(sub)) {
    return { action: "skip", reason: "live_paid_guard" };
  }

  // ★앵커 = now. 위 주석의 판단이다.
  const targetMs = addMonths(new Date(nowMs), betaMonths).getTime();

  if (!account) {
    return {
      action: "open_window",
      newBetaExpiresAtMs: targetMs,
      previousBetaExpiresAtMs: founder.betaExpiresAtMs,
    };
  }

  const existingEndMs = sub?.currentPeriodEndMs ?? null;
  if (typeof existingEndMs === "number" && existingEndMs >= targetMs) {
    return { action: "skip", reason: "already_longer" };
  }

  const baseMs =
    typeof existingEndMs === "number" && existingEndMs > nowMs
      ? existingEndMs
      : nowMs;
  return {
    action: "grant",
    uid: account.uid,
    periodEndMs: targetMs,
    // 강등 금지 가드를 통과한 실제 값. 하드코딩하면 보고가 실제 doc 과 어긋난다.
    // (여기 오는 sub 는 grant 문서가 아님이 위에서 걸러졌으므로 가드가 플랜을
    //  계승하지 않는다. 그래도 실제 호출부와 **같은 함수**를 통과시켜야 드라이런
    //  값과 실행 값이 갈리지 않는다.)
    planType: resolveGrantPlanType(
      SELECTED_GAP_BACKFILL_REASON,
      sub
        ? {
            planType: sub.planType,
            founderGrant: sub.founderGrant,
            paymentProvider: sub.paymentProvider,
          }
        : undefined,
    ),
    hadSubscription: Boolean(sub),
    addedDays: Math.max(0, Math.round((targetMs - baseMs) / DAY_MS)),
  };
}
