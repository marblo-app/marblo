// 통합 뷰 `v_install_unified` — 설치 1행에 채널·활성화·리텐션·결제를 붙인다.
// 순수 로직(BQ/Firebase 무의존). personAxis.ts / ga4Bridge.ts 와 같은 규약으로
// node --test 로 단위검증한다.
//
// 설계 정본: v3/docs/install-unified-view-2026-08-24.md (ticket L8RvsReu6Vch5eNYYCJR).
//   + GA4 이커머스 축: v3/docs/ga4-ecommerce-unified-2026-08-24.md (VV733VRpsfGvijYuPWCl).
// ★이 파일은 그 문서를 구현한다. 다르게 가야 할 이유를 찾으면 여기서 고치지 말고
//   문서를 고치는 티켓을 내라 — 코드와 문서가 갈리면 다음 사람이 코드를 믿는다.
//
// ── 이 모듈이 지키는 것 네 가지 ─────────────────────────────────────────────
//
//  1) ★0 과 미적재를 가른다. 채널을 모르는 설치는 `'(unknown)'` 이 아니라
//     **NULL + 사유 컬럼**이다. 사유 사다리는 아래 배열 하나가 정본이고, SQL 의
//     CASE 도 TS 판정 함수도 **그 배열에서 생성**된다 — 두 벌을 손으로 맞추면
//     반드시 갈린다.
//  2) ★가명 = 가명으로만 조인한다. `install_attribution.gaKeyHmac = gaKey` 다.
//     원시 `gaClientId` 로 조인하면 에러 없이 영원히 0행이다(#1195 문서 §1).
//  3) ★행수를 보존한다. 붙는 쪽은 전부 유일키이거나 **사전 집계된 1행**이다.
//     설치가 늘지도 사라지지도 않는다.
//  4) ★솔트도 uid 도 SQL 에 넣지 않는다. BQ 는 쿼리 본문을 job 히스토리에
//     수개월 보관한다(#915 계승). 이 파일이 만드는 SQL 에는 원시 식별자가 없다.
//
// ── ★결제 축이 왜 다른 데이터셋에 있나 ─────────────────────────────────────
//   설치↔사람을 잇는 자리는 설계상 `marblo_identity.analytics_user_install`
//   **하나뿐**이고(person-axis 설계 §4.2-5), 그 데이터셋은 IAM 이 좁혀져 있다.
//   결제 컬럼을 `marblo_telemetry` 뷰에 넣으면 텔레메트리 읽기 권한만 있는
//   사람이 뷰를 통해 링크표를 읽는다 — 이름만 다른 같은 방이 된다. 그래서
//   결제가 붙은 완전체는 **링크표가 사는 데이터셋**에 둔다.

import {
  IDENTITY_DATASET,
  TELEMETRY_DATASET,
  TABLE_USER_INSTALL,
  type PersonAxisGate,
} from "./personAxis";

export { IDENTITY_DATASET, TELEMETRY_DATASET };

// ════════════════════════════════════════════════════════════════════════════
// 1. 좌표 — 읽는 표와 만드는 뷰
// ════════════════════════════════════════════════════════════════════════════

/** ★알갱이의 정본. 이 표의 행 하나가 통합 뷰의 행 하나다. */
export const SOURCE_INSTALL_PROFILE = "analytics_install_profile";

/** 앱 원장(링크백). `gaKeyHmac` 을 들고 있는 유일한 표다(#1195). */
export const SOURCE_INSTALL_ATTRIBUTION = "install_attribution";

/** GA4 브리지 정본 읽기 뷰 — `gaKey` 당 가장 이른 유입 1행. */
export const SOURCE_GA4_CURRENT = "ga4_first_touch_current";

/** 일별 활동. `install_key`(원시)와 `install_key_hmac`(가명)이 같이 있는 유일한 표. */
export const SOURCE_USER_DAILY = "analytics_user_daily";

/** 결제 원장. 알갱이는 **사람**(`user_key`)이라 설치로 접으려면 링크표를 거친다. */
export const SOURCE_PURCHASE = "analytics_purchase";

/**
 * GA4 이커머스 정본 읽기 뷰 — `gaKey` 당 퍼널·결제 1행 (ga4Bridge.ts).
 *
 * ★이게 이 티켓이 여는 **두 번째 경로**다. 원장 수익 축은
 *   `analytics_purchase → user_key → 링크표 → analytics_user_daily.install_key_hmac`
 *   로 가는데 그 마지막 다리가 **전량 NULL** 이라(§6-2) 오늘 수익이 미상이다.
 *   GA4 는 같은 세션에 채널과 결제가 같이 실려 있어 `gaKey` **하나로** 채널→결제가
 *   이어진다 — 끊어진 다리를 안 거친다.
 * ★단 GA4 를 매출의 **정본으로 쓰지 않는다.** 광고차단·쿠키거부로 샌다. 정본은
 *   원장이고 GA4 는 채널 귀속용 보조축이다. 두 값이 갈리면 하나를 고르지 않고
 *   `revenueDivergenceReason` 으로 **둘 다 보이게** 한다.
 */
export const SOURCE_GA4_ECOMMERCE_CURRENT = "ga4_ecommerce_current";

/** 결제 없는 축약본 — 텔레메트리 데이터셋. */
export const VIEW_INSTALL_UNIFIED = "v_install_unified";

/** 결제가 붙은 완전체 — ★링크표가 사는 데이터셋(IAM 경계). */
export const VIEW_INSTALL_UNIFIED_REVENUE = "v_install_unified_revenue";

/** 사람 단위로 접은 결제 읽기 뷰 — ★SUM(revenueLedger) 금지의 안전한 경로. */
export const VIEW_INSTALL_UNIFIED_REVENUE_PERSON =
  "v_install_unified_revenue_person";

/** 원장 매출로 볼 수 있는 결제 종류. ★grant 는 여기에 절대 들어오지 않는다. */
export const REVENUE_LEDGER_KINDS: ReadonlyArray<string> = ["paid", "renew"];

// ════════════════════════════════════════════════════════════════════════════
// 2. ★사유 사다리 — 0 과 미적재를 가르는 자리
// ════════════════════════════════════════════════════════════════════════════

/**
 * 사다리 한 칸. `sql` 과 `test` 는 **같은 조건의 두 표현**이고, 순서는 배열
 * 순서다(위에서부터 첫 번째 해당). SQL CASE 도 TS 판정도 이 배열에서 나온다.
 */
export interface ReasonRung<F> {
  readonly reason: string;
  /** BigQuery WHEN 절. 별칭은 각 빌더의 주석에 고정돼 있다. */
  readonly sql: string;
  /** 같은 조건의 TS 표현 — 단위 테스트가 SQL 과 함께 잠근다. */
  readonly test: (facts: F) => boolean;
  /**
   * 이 사유가 "모른다" 인가 "없다(진짜 0)" 인가. 문서 §4 의 표와 같다.
   *
   * ★`divergent` 는 세 번째 부류다 — **양쪽 다 아는데 서로 다르다.** 원장↔GA4
   *   대조에만 나온다(VV733VRp). `unknown` 으로 뭉치면 "못 봤다" 와 "봤는데
   *   안 맞는다" 가 같은 칸에 들어가 대조 자체가 무의미해진다.
   */
  readonly kind: "unknown" | "true_zero" | "divergent";
}

/**
 * ★설치 → GA4 로 가는 **다리 자체**의 사실. 채널 축과 이커머스 축이 이 다리를
 *   공유한다(둘 다 `install_attribution.gaKeyHmac = gaKey` 로 붙는다).
 *
 * 그래서 두 사다리의 앞 세 칸을 **같은 배열에서 만든다** — 손으로 두 벌 적으면
 * 반드시 갈리고, 갈리면 "채널은 key_mismatch 인데 이커머스는 no_ledger_row" 같은
 * 설명 불가능한 조합이 표에 나온다.
 */
export interface Ga4JoinFacts {
  /** `install_attribution` 에 이 설치의 행이 있나. */
  readonly hasLedgerRow: boolean;
  /** 원시 GA4 client_id(원장). ★조인키가 아니다 — 존재 여부만 쓴다. */
  readonly hasGaClientId: boolean;
  /** 가명 조인키(원장). 없으면 GA4 조인 자체가 불가능하다. */
  readonly hasGaKeyHmac: boolean;
}

/** 채널 사유 판정에 필요한 사실. 전부 조인 결과에서 읽히는 값이다. */
export interface ChannelFacts extends Ga4JoinFacts {
  /** 브리지에 그 `gaKey` 행이 있나. */
  readonly hasGa4Row: boolean;
  /** GA4 캠페인 원문. 센티널(`(direct)` 등)도 그대로 들어온다. */
  readonly campaign: string | null;
}

/** GA4 이커머스 사유 판정에 필요한 사실. */
export interface Ga4EcommerceFacts extends Ga4JoinFacts {
  /** 이커머스 롤업 뷰에 그 `gaKey` 행이 있나. */
  readonly hasEcommerceRow: boolean;
  /** 그 방문자 결제의 distinct 통화 수. 2 이상이면 금액을 못 더한다. */
  readonly currencyCount: number;
}

/**
 * ★채널·이커머스가 **공유하는** 다리 사유 세 칸. 두 사다리의 앞머리가 여기서 나온다.
 *
 * **별칭 규약**: `a` = 원장(dedup 후).
 *
 * ★`key_mismatch` 와 뒤따르는 `no_*_row` 를 반드시 가른다. 전자는 "우리가 키를 안
 *   들고 있어서" 못 붙은 것이고(#1195 배포 전 행의 정상값), 후자는 "GA4 쪽에 그
 *   방문자가 없어서" 못 붙은 것이다. 합치면 배포·백필이 필요한지 GA4 동기화가
 *   필요한지 구분할 수 없다.
 */
export const GA4_JOIN_REASONS: ReadonlyArray<ReasonRung<Ga4JoinFacts>> = [
  {
    reason: "no_ledger_row",
    sql: "a.installId IS NULL",
    test: (f) => !f.hasLedgerRow,
    kind: "unknown",
  },
  {
    reason: "no_ga_client_id",
    sql: "a.gaClientId IS NULL",
    test: (f) => !f.hasGaClientId,
    kind: "unknown",
  },
  {
    reason: "key_mismatch",
    sql: "a.gaKeyHmac IS NULL",
    test: (f) => !f.hasGaKeyHmac,
    kind: "unknown",
  },
];

/**
 * ★GA4 가 "캠페인이 없다" 를 말할 때 쓰는 자기 센티널.
 *
 * 이 값들은 **캠페인 이름이 아니다.** `(direct)` 를 캠페인명으로 세면 자연유입이
 * 광고 성과로 둔갑한다. 그래서 `channelCampaign` 에는 원문을 **그대로 남기되**
 * (값을 지어내지 않는다) 사유는 `no_utm` 으로 찍는다.
 */
export const GA4_CAMPAIGN_SENTINELS: ReadonlyArray<string> = [
  "(direct)",
  "(none)",
  "(not set)",
  "(organic)",
  "(referral)",
];

function isCampaignSentinel(v: string | null): boolean {
  if (v === null) return true;
  const t = v.trim().toLowerCase();
  if (t.length === 0) return true;
  return GA4_CAMPAIGN_SENTINELS.includes(t);
}

/**
 * 채널 사유 사다리. **별칭 규약**: `a` = 원장(dedup 후), `g` = GA4 브리지.
 *
 * ★앞 세 칸은 손으로 안 적는다 — `GA4_JOIN_REASONS` 를 그대로 편다.
 * ★`no_utm` 만 "진짜 0" 이다 — 유입을 **안다**, 캠페인이 없었을 뿐이다.
 */
export const CHANNEL_REASONS: ReadonlyArray<ReasonRung<ChannelFacts>> = [
  ...GA4_JOIN_REASONS,
  {
    reason: "no_ga4_row",
    sql: "g.gaKey IS NULL",
    test: (f) => !f.hasGa4Row,
    kind: "unknown",
  },
  {
    reason: "no_utm",
    sql:
      "g.campaign IS NULL OR TRIM(LOWER(g.campaign)) = '' OR " +
      `TRIM(LOWER(g.campaign)) IN (${GA4_CAMPAIGN_SENTINELS.map(sqlString).join(", ")})`,
    test: (f) => isCampaignSentinel(f.campaign),
    kind: "true_zero",
  },
];

/**
 * GA4 이커머스 **퍼널 카운트**의 사유 사다리. **별칭 규약**: `a` = 원장, `e` = 이커머스.
 *
 * ★채널 사다리와 다리를 공유하되 마지막 칸이 다르다. `no_ga4_row`(유입 브리지에
 *   없다)와 `no_ga4_ecommerce_row`(이커머스 표에 없다)는 **다른 사실**이다 —
 *   유입은 잡혔는데 이커머스 페이지를 한 번도 안 본 방문자가 정확히 후자다.
 * ★사다리를 다 통과하면 카운트는 **실수**다 — 0 이면 "그 단계를 안 밟았다" 이지
 *   "모른다" 가 아니다. 그게 이 프로젝트가 세 번 틀린 자리다.
 * ★`add_to_cart`/`view_cart` 사유는 **없다.** 장바구니 없는 구독 상품이라 그
 *   단계 자체가 존재하지 않는다. 없는 단계를 표에 만들지 않는다.
 */
export const GA4_ECOMMERCE_REASONS: ReadonlyArray<
  ReasonRung<Ga4EcommerceFacts>
> = [
  ...GA4_JOIN_REASONS,
  {
    reason: "no_ga4_ecommerce_row",
    sql: "e.gaKey IS NULL",
    test: (f) => !f.hasEcommerceRow,
    kind: "unknown",
  },
];

/**
 * GA4 **금액**의 사유 사다리 — 퍼널 사다리 + 통화 한 칸.
 *
 * ★왜 사다리를 둘로 나눴나: 통화가 섞이면 **금액만** 못 더한다. 퍼널 카운트는
 *   멀쩡한데 그것까지 NULL 로 지우면 멀쩡한 사실을 통화 때문에 버리는 것이다.
 *   그래서 카운트는 `ga4EcommerceMissingReason`, 금액은 `ga4RevenueMissingReason`
 *   으로 각자 답한다. 두 배열은 앞부분을 **공유**하므로 갈릴 수 없다.
 */
export const GA4_REVENUE_REASONS: ReadonlyArray<ReasonRung<Ga4EcommerceFacts>> =
  [
    ...GA4_ECOMMERCE_REASONS,
    {
      reason: "ga4_mixed_currency",
      sql: "e.currencyCount > 1",
      test: (f) => f.currencyCount > 1,
      kind: "unknown",
    },
  ];

/** 결제 사유 판정에 필요한 사실. */
export interface RevenueFacts {
  /** 사람 축 게이트가 열려 있나(`PERSON_AXIS_EFFECTIVE_FROM`). */
  readonly gateOpen: boolean;
  /** 설치 원시→가명 다리(`analytics_user_daily.install_key_hmac`)가 있나. */
  readonly hasInstallKeyHmac: boolean;
  /** 링크표에 붙은 사람 수. 0 이면 아직 로그인 전이다. */
  readonly personLinkCount: number;
  /** 금액을 아는 결제의 distinct 통화 수. */
  readonly currencyCount: number;
}

/** 게이트가 닫혔을 때의 사유 — SQL 이 아니라 뷰 본문 전체가 이 값으로 고정된다. */
export const REVENUE_REASON_GATE_CLOSED = "person_axis_closed";

/**
 * 결제 사유 사다리. **별칭 규약**: `h` = 설치 가명 다리, `l` = 링크표 집계,
 * `pu` = 결제 집계.
 *
 * ★`shared_device` 는 person-axis 설계의 "공용 기기는 값을 만들지 않고 **센다**"
 *   를 그대로 따른다. 한 설치에 사람이 둘이면 결제를 누구에게 귀속할지 진실이
 *   하나로 안 떨어지므로, 고르지 않고 `personLinkCount` 로 사실만 남긴다.
 * ★사다리를 다 통과하면 사유는 NULL 이고, 그때 `revenueTotal` 은 **실수**다 —
 *   결제가 없으면 0 이다. "0원" 과 "모름" 이 갈리는 자리가 여기다.
 */
export const REVENUE_REASONS: ReadonlyArray<ReasonRung<RevenueFacts>> = [
  {
    reason: "no_install_key_hmac",
    sql: "h.installKeyHmac IS NULL",
    test: (f) => !f.hasInstallKeyHmac,
    kind: "unknown",
  },
  {
    reason: "no_person_link",
    sql: "l.installKeyHmac IS NULL",
    test: (f) => f.personLinkCount === 0,
    kind: "unknown",
  },
  {
    reason: "shared_device",
    sql: "l.personLinkCount > 1",
    test: (f) => f.personLinkCount > 1,
    kind: "unknown",
  },
  {
    reason: "mixed_currency",
    sql: "pu.currencyCount > 1",
    test: (f) => f.currencyCount > 1,
    kind: "unknown",
  },
];

/** 원장 축과 GA4 축을 견주는 데 필요한 사실. 둘 다 이미 계산된 값이다. */
export interface RevenueDivergenceFacts {
  /** 원장 수익 사유. NULL 이 아니면 원장 쪽을 모른다. */
  readonly ledgerReason: string | null;
  /** GA4 금액 사유. NULL 이 아니면 GA4 쪽을 모른다. */
  readonly ga4Reason: string | null;
  /** 원장 수익 합(사유가 NULL 일 때만 의미가 있다). */
  readonly ledgerAmount: number | null;
  /** GA4 수익 합(사유가 NULL 일 때만 의미가 있다). */
  readonly ga4Amount: number | null;
  readonly ledgerCurrency: string | null;
  readonly ga4Currency: string | null;
}

/**
 * ★원장 ↔ GA4 **차이 사유** 사다리. **별칭 규약**: `j` = 조인 결과.
 *
 * ── 이 컬럼이 무엇이고 무엇이 아닌가 ────────────────────────────────────────
 *   정본은 **원장**이다. GA4 는 광고차단·쿠키거부·ITP 로 샌다. 그래서 이 사다리는
 *   "어느 쪽이 맞나" 를 고르지 **않는다.** 두 숫자를 나란히 두고 왜 다른지만 적는다.
 *   `revenueLedger` 와 `revenueGa4` 는 각자 자기 컬럼에 그대로 남는다.
 *
 * ── ★팬아웃을 사유에 넣지 않은 이유 (판단을 남긴다) ─────────────────────────
 *   한 사람이 기기 여러 대면 원장 금액이 여러 행에 반복되고(`personInstallCount`),
 *   한 브라우저에 설치가 480건이면 GA4 금액이 480행에 반복된다(`gaKeyInstallCount`).
 *   그래서 **SUM 은 틀린다.** 하지만 팬아웃은 *합산*을 깨는 것이지 *한 행의 비교*를
 *   깨지 않는다 — 한 행에서 `revenueLedger` 는 그 사람의 총액, `revenueGa4` 는 그
 *   브라우저의 총액으로 각각 잘 정의돼 있고, 반복돼도 값은 같다. 팬아웃을 사유에
 *   넣으면 실측상 거의 모든 행이 `axis_fanout` 으로 덮여 이 컬럼이 상수가 된다 —
 *   즉 아무것도 못 말하게 된다. 그래서 팬아웃은 사유가 아니라 **이미 있는 두 카운트
 *   컬럼**으로 드러낸다(설계 문서 §9-4 에 합산 규칙을 적었다).
 *
 * ★`currency_mismatch` 에서 환산하지 않는다. 환율을 여기서 고르면 그 환율이 어디에도
 *   안 적힌 채 매출 숫자가 된다. 통화가 다르면 다르다고만 말한다.
 */
export const REVENUE_DIVERGENCE_REASONS: ReadonlyArray<
  ReasonRung<RevenueDivergenceFacts>
> = [
  {
    reason: "ledger_unknown",
    sql: "j.revenueMissingReason IS NOT NULL",
    test: (f) => f.ledgerReason !== null,
    kind: "unknown",
  },
  {
    reason: "ga4_unknown",
    sql: "j.ga4RevenueMissingReason IS NOT NULL",
    test: (f) => f.ga4Reason !== null,
    kind: "unknown",
  },
  {
    reason: "currency_mismatch",
    sql:
      "j.revenueCurrency IS NOT NULL AND j.ga4RevenueCurrency IS NOT NULL " +
      "AND j.revenueCurrency != j.ga4RevenueCurrency",
    test: (f) =>
      f.ledgerCurrency !== null &&
      f.ga4Currency !== null &&
      f.ledgerCurrency !== f.ga4Currency,
    kind: "unknown",
  },
  {
    // 원장에는 있는데 GA4 가 못 봤다 — 광고차단·쿠키거부의 정상적인 모습이다.
    reason: "ga4_missed",
    sql: "j.revenueLedgerAmount > 0 AND j.ga4RevenueAmount = 0",
    test: (f) => (f.ledgerAmount ?? 0) > 0 && (f.ga4Amount ?? 0) === 0,
    kind: "divergent",
  },
  {
    // GA4 에는 있는데 원장에 없다 — 원장 적재 지연이거나 귀속이 다른 사람에게 갔다.
    reason: "ledger_missed",
    sql: "j.ga4RevenueAmount > 0 AND j.revenueLedgerAmount = 0",
    test: (f) => (f.ga4Amount ?? 0) > 0 && (f.ledgerAmount ?? 0) === 0,
    kind: "divergent",
  },
  {
    reason: "amount_differs",
    sql: "j.revenueLedgerAmount != j.ga4RevenueAmount",
    test: (f) => (f.ledgerAmount ?? 0) !== (f.ga4Amount ?? 0),
    kind: "divergent",
  },
];

/** 활성화 사유 — 경과일을 못 세는 경우만이다. "안 썼다" 는 사유가 아니라 0 이다. */
export const ACTIVATION_REASON_NO_FIRST_RUN = "no_first_run";

/** 리텐션 사유 — 일별 행이 하나도 없어 창을 셀 수 없다. 0 이 아니라 미상이다. */
export const RETENTION_REASON_NO_DAILY_ROWS = "no_daily_rows";

/** 사다리를 걸어 첫 번째 해당 사유를 돌려준다. 다 통과하면 `null`(=안다). */
export function resolveReason<F>(
  rungs: ReadonlyArray<ReasonRung<F>>,
  facts: F,
): string | null {
  for (const rung of rungs) {
    if (rung.test(facts)) return rung.reason;
  }
  return null;
}

/** 채널 사유. `null` 이면 캠페인이 실재한다. */
export function resolveChannelMissingReason(f: ChannelFacts): string | null {
  return resolveReason(CHANNEL_REASONS, f);
}

/** 결제 사유. `null` 이면 결제 축을 안다(금액이 0 일 수 있다). */
export function resolveRevenueMissingReason(f: RevenueFacts): string | null {
  if (!f.gateOpen) return REVENUE_REASON_GATE_CLOSED;
  return resolveReason(REVENUE_REASONS, f);
}

/** GA4 이커머스 퍼널 사유. `null` 이면 카운트가 실수다(0 일 수 있다). */
export function resolveGa4EcommerceMissingReason(
  f: Ga4EcommerceFacts,
): string | null {
  return resolveReason(GA4_ECOMMERCE_REASONS, f);
}

/** GA4 금액 사유. `null` 이면 금액이 실수다(0 일 수 있다). */
export function resolveGa4RevenueMissingReason(
  f: Ga4EcommerceFacts,
): string | null {
  return resolveReason(GA4_REVENUE_REASONS, f);
}

/**
 * 원장↔GA4 차이 사유. `null` 이면 **두 축이 같다**(둘 다 0 이어도 같은 것이다).
 *
 * ★어느 쪽도 정답으로 고르지 않는다. 이 함수는 판정이 아니라 라벨이다.
 */
export function resolveRevenueDivergenceReason(
  f: RevenueDivergenceFacts,
): string | null {
  return resolveReason(REVENUE_DIVERGENCE_REASONS, f);
}

// ════════════════════════════════════════════════════════════════════════════
// 3. SQL 조각
// ════════════════════════════════════════════════════════════════════════════

/** BigQuery 문자열 리터럴. ★식별자·솔트를 여기 통과시키지 마라. */
export function sqlString(v: string): string {
  return `'${v.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
}

function table(projectId: string, dataset: string, name: string): string {
  return `\`${projectId}.${dataset}.${name}\``;
}

/** 사다리 → `CASE WHEN … END`. ★SQL 과 TS 가 같은 배열에서 나온다. */
export function buildReasonCase<F>(
  rungs: ReadonlyArray<ReasonRung<F>>,
  indent = "    ",
): string {
  const lines = ["CASE"];
  for (const r of rungs) {
    lines.push(`${indent}  WHEN ${r.sql} THEN ${sqlString(r.reason)}`);
  }
  lines.push(`${indent}  ELSE NULL`);
  lines.push(`${indent}END`);
  return lines.join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 4. 통합 뷰 — 결제 없는 축약본 (marblo_telemetry)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 뷰 본문 SQL.
 *
 * ── 행수 보존 (이 뷰의 생명) ────────────────────────────────────────────────
 *   `analytics_install_profile` 1행 = 결과 1행. 붙는 쪽은 전부:
 *     - `ledger`  : `installId` 당 1행으로 **QUALIFY 로 접는다**(가장 이른 링크백
 *                   = first-touch). 실측상 이미 유일하지만, 유일성이 깨지는 날
 *                   조용히 행이 부푸는 대신 여기서 막는다.
 *     - `ga4`     : `gaKey` 당 1행으로 접는다(원천 뷰가 이미 그렇지만 방어).
 *     - `daily`   : `install_key` 로 **사전 GROUP BY** 한 1행.
 *   그래서 LEFT JOIN 세 번이 전부 1:1 이거나 1:0 이다.
 *
 * ── ★`gaKeyInstallCount` 를 왜 넣나 ────────────────────────────────────────
 *   실측(2026-08-24): 설치 480건이 **한 브라우저**에서 나온다(원장 631행의
 *   distinct gaClientId 가 5개뿐). 그 480행을 480명으로 읽으면 모든 비율이
 *   틀린다. 주석은 안 읽히므로 **컬럼으로** 표에 드러낸다. NULL 파티션이
 *   한 덩어리로 세지지 않게 `gaKeyHmac IS NULL` 이면 값도 NULL 이다.
 */
export function buildUnifiedViewSql(projectId: string): string {
  const profile = table(projectId, TELEMETRY_DATASET, SOURCE_INSTALL_PROFILE);
  const attribution = table(
    projectId,
    TELEMETRY_DATASET,
    SOURCE_INSTALL_ATTRIBUTION,
  );
  const ga4 = table(projectId, TELEMETRY_DATASET, SOURCE_GA4_CURRENT);
  const ecom = table(
    projectId,
    TELEMETRY_DATASET,
    SOURCE_GA4_ECOMMERCE_CURRENT,
  );
  const daily = table(projectId, TELEMETRY_DATASET, SOURCE_USER_DAILY);

  return `-- ★생성물이다. 손으로 고치지 마라 — v3/functions/src/installUnified.ts 가 정본이다.
-- 설계: v3/docs/install-unified-view-2026-08-24.md (ticket L8RvsReu6Vch5eNYYCJR)
-- 알갱이: 설치 1행(analytics_install_profile.install_key). 결제는 IAM 경계 밖이라
--          ${IDENTITY_DATASET}.${VIEW_INSTALL_UNIFIED_REVENUE} 에 있다.
WITH ledger AS (
  -- ★installId 당 1행. 가장 이른 링크백을 남긴다(first-touch — 재방문이 최초
  --   유입을 덮지 않게).
  SELECT *
  FROM ${attribution}
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (PARTITION BY installId ORDER BY linkedAt ASC) = 1
),
ledger_scoped AS (
  SELECT
    l.*,
    -- ★NULL 키를 한 덩어리로 세지 않는다. 키가 없으면 표본 수도 미상이다.
    IF(
      l.gaKeyHmac IS NULL,
      NULL,
      COUNT(*) OVER (PARTITION BY l.gaKeyHmac)
    ) AS gaKeyInstallCount
  FROM ledger l
),
ga4 AS (
  -- 원천 뷰가 이미 gaKey 당 1행이지만, 그 성질이 깨져도 행이 부풀지 않게 접는다.
  SELECT *
  FROM ${ga4}
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY gaKey ORDER BY firstVisitDate ASC, syncedAt ASC
  ) = 1
),
ecom AS (
  -- ★GA4 이커머스 롤업. 원천 뷰가 이미 gaKey 당 1행이지만, 그 성질이 깨져도
  --   설치 행이 부풀지 않게 접는다(ga4 CTE 와 같은 방어).
  SELECT *
  FROM ${ecom}
  WHERE TRUE
  QUALIFY ROW_NUMBER() OVER (
    PARTITION BY gaKey ORDER BY lastEcommerceDate DESC NULLS LAST
  ) = 1
),
daily_first AS (
  SELECT
    install_key,
    MIN(IF(active, day, NULL)) AS firstActiveDay
  FROM ${daily}
  GROUP BY install_key
),
daily AS (
  -- ★설치당 1행으로 미리 접는다. 여기서 접지 않으면 일수만큼 행이 부푼다.
  SELECT
    d.install_key,
    ANY_VALUE(f.firstActiveDay) AS firstActiveDay,
    COUNT(DISTINCT IF(
      d.active AND f.firstActiveDay IS NOT NULL
        AND d.day >= f.firstActiveDay
        AND d.day < DATE_ADD(f.firstActiveDay, INTERVAL 7 DAY),
      d.day, NULL)) AS activeDays7,
    COUNT(DISTINCT IF(
      d.active AND f.firstActiveDay IS NOT NULL
        AND d.day >= f.firstActiveDay
        AND d.day < DATE_ADD(f.firstActiveDay, INTERVAL 14 DAY),
      d.day, NULL)) AS activeDays14,
    COUNT(DISTINCT IF(
      d.active AND f.firstActiveDay IS NOT NULL
        AND d.day >= f.firstActiveDay
        AND d.day < DATE_ADD(f.firstActiveDay, INTERVAL 30 DAY),
      d.day, NULL)) AS activeDays30
  FROM ${daily} d
  JOIN daily_first f USING (install_key)
  GROUP BY d.install_key
)
SELECT
  -- ── 식별 ────────────────────────────────────────────────────────────────
  --   ★PII 없음 — 계정 식별자·이메일·IP 컬럼이 하나도 없다. 여기 실리는 것은
  --     앱이 스스로 만든 익명 설치 UUID 와 가명키(ga_/us_)뿐이다.
  p.install_key                       AS installKey,
  p.id_scheme                         AS idScheme,
  a.gaKeyHmac                         AS gaKeyHmac,
  a.gaKeyInstallCount                 AS gaKeyInstallCount,
  p.first_run_at                      AS firstRunAt,
  a.linkedAt                          AS linkedAt,
  a.linkSource                        AS linkSource,

  -- ── 채널 (GA4 first-touch) ──────────────────────────────────────────────
  g.source                            AS channelSource,
  g.medium                            AS channelMedium,
  g.campaign                          AS channelCampaign,
  g.content                           AS channelContent,
  g.term                              AS channelTerm,
  g.country                           AS channelCountry,
  g.region                            AS channelRegion,
  g.deviceCategory                    AS channelDevice,
  -- ★랜딩은 앱이 스스로 여는 링크백 페이지(marblo.app/<locale>/link)인 경우가
  --   많다. 광고 랜딩 성과로 읽지 마라(설계 §6-3).
  g.landingPage                       AS channelLandingPage,
  -- ★브리지는 동기화 창 안의 MIN(event_date)를 적는다 — 전 구간 백필 전에는
  --   진짜 최초 방문이 아닐 수 있다(설계 §6-3).
  g.firstVisitDate                    AS channelFirstVisitDate,
  g.attributionSource                 AS channelAttributionSource,
  -- ★조인 실패(모른다)와 자연유입(안다, 캠페인 없음)을 가르는 한 칸.
  g.gaKey IS NOT NULL                 AS hasGa4Row,
  ${buildReasonCase(CHANNEL_REASONS, "  ")}
                                      AS channelMissingReason,

  -- ── GA4 이커머스 (익명 gaKey 축 · ★보조축이다) ──────────────────────────
  --   ★이 칸들이 여는 것: 채널과 결제가 **같은 GA4 세션**에 실려 있어 gaKey 하나로
  --     채널→퍼널→결제가 이어진다. 원장 수익 축이 거쳐야 하는
  --     analytics_user_daily.install_key_hmac 다리(오늘 전량 NULL)를 **안 거친다**.
  --   ★그러나 매출의 정본은 아니다 — GA4 는 광고차단·쿠키거부로 샌다. 정본은
  --     원장(analytics_purchase)이고, 두 축의 대조는 결제 뷰의
  --     revenueDivergenceReason 이 한다.
  --   ★★합산 경고: 이 값들은 **브라우저(gaKey) 단위**다. 같은 gaKey 를 공유하는
  --     설치가 여러 건이면 같은 숫자가 그 행 수만큼 반복된다(실측: 한 브라우저에
  --     설치 480건). 그래서 SUM(ga4RevenueTotal) 은 틀린다 — 옆의
  --     gaKeyInstallCount 가 그 배수이고, 접으려면 gaKey 로 GROUP BY 해라.
  e.viewItemListEvents                AS ga4ViewItemListEvents,
  e.viewItemEvents                    AS ga4ViewItemEvents,
  e.beginCheckoutEvents               AS ga4BeginCheckoutEvents,
  e.addPaymentInfoEvents              AS ga4AddPaymentInfoEvents,
  e.purchaseEvents                    AS ga4PurchaseEvents,
  e.firstEcommerceDate                AS ga4FirstEcommerceDate,
  e.lastEcommerceDate                 AS ga4LastEcommerceDate,
  e.firstPurchaseDate                 AS ga4FirstPurchaseDate,
  -- ★조인 실패(모른다)와 "이커머스 페이지를 안 봤다"(안다, 0)를 가르는 한 칸.
  e.gaKey IS NOT NULL                 AS hasGa4EcommerceRow,
  ${buildReasonCase(GA4_ECOMMERCE_REASONS, "  ")}
                                      AS ga4EcommerceMissingReason,
  -- ★금액은 사다리가 한 칸 더 길다 — 통화가 섞이면 금액만 못 더한다(카운트는 멀쩡).
  e.purchaseRevenue                   AS ga4RevenueTotal,
  e.purchaseCurrency                  AS ga4RevenueCurrency,
  -- ★GA4 가 자기 환율로 환산한 값이다. 통화가 섞여도 합산은 되지만 **근사치**다.
  e.purchaseRevenueUsd                AS ga4RevenueUsdApprox,
  e.currencyCount                     AS ga4RevenueCurrencyCount,
  ${buildReasonCase(GA4_REVENUE_REASONS, "  ")}
                                      AS ga4RevenueMissingReason,

  -- ── 앱 원장 UTM — GA4 와 **다른 축**이다. 섞지 마라 ──────────────────────
  a.utmSource                         AS ledgerUtmSource,
  a.utmMedium                         AS ledgerUtmMedium,
  a.utmCampaign                       AS ledgerUtmCampaign,
  a.utmContent                        AS ledgerUtmContent,
  a.utmTerm                           AS ledgerUtmTerm,
  a.referrerHost                      AS ledgerReferrerHost,
  a.landingPath                       AS ledgerLandingPath,

  -- ── 활성화 ──────────────────────────────────────────────────────────────
  p.first_spawn_at                    AS firstSpawnAt,
  p.first_completed_at                AS firstCompletedAt,
  IF(
    p.first_run_at IS NULL OR p.first_spawn_at IS NULL,
    NULL,
    DATE_DIFF(DATE(p.first_spawn_at), DATE(p.first_run_at), DAY)
  )                                   AS daysToFirstSpawn,
  IF(
    p.first_run_at IS NULL OR p.first_completed_at IS NULL,
    NULL,
    DATE_DIFF(DATE(p.first_completed_at), DATE(p.first_run_at), DAY)
  )                                   AS daysToFirstCompleted,
  -- ★NOT NULL. false 는 "안 썼다"(진짜 0)이지 "모른다" 가 아니다.
  p.first_spawn_at IS NOT NULL        AS hasSpawned,
  IF(p.first_run_at IS NULL, ${sqlString(ACTIVATION_REASON_NO_FIRST_RUN)}, NULL)
                                      AS activationMissingReason,

  -- ── 리텐션 ──────────────────────────────────────────────────────────────
  p.first_active_day                  AS firstActiveDay,
  p.last_active_day                   AS lastActiveDate,
  p.observed_days                     AS observedDays,
  p.active_days                       AS activeDaysTotal,
  -- ★일별 행이 없으면 0 이 아니라 NULL 이다(미적재와 0 을 가른다).
  d.activeDays7                       AS activeDays7,
  d.activeDays14                      AS activeDays14,
  d.activeDays30                      AS activeDays30,
  -- ★창이 아직 안 닫혔는지 읽는 쪽이 판단할 수 있게 경과일을 준다.
  IF(
    d.firstActiveDay IS NULL,
    NULL,
    DATE_DIFF(CURRENT_DATE(), d.firstActiveDay, DAY)
  )                                   AS retentionElapsedDays,
  IF(d.install_key IS NULL, ${sqlString(RETENTION_REASON_NO_DAILY_ROWS)}, NULL)
                                      AS retentionMissingReason,

  -- ── 메타 ────────────────────────────────────────────────────────────────
  p.app_version                       AS appVersion,
  a.platform                          AS platform,
  a.buildChannel                      AS buildChannel,
  p.ft_build_channel                  AS ftBuildChannel,
  -- ★플래그일 뿐이다. 이 뷰는 내부·테스트를 **기본 필터로 숨기지 않는다** —
  --   숨기면 왜 숫자가 다른지 아무도 모른다.
  COALESCE(a.buildChannel = 'dev', FALSE)
    OR COALESCE(p.ft_build_channel = 'dev', FALSE)
                                      AS isDevInstall,
  p.built_at                          AS builtAt
FROM ${profile} p
-- ★원시 = 원시. install_key(UUID) 와 installId(UUID) 는 같은 공간이다.
LEFT JOIN ledger_scoped a ON p.install_key = a.installId
-- ★가명 = 가명. 원시 gaClientId 로 조인하면 에러 없이 영원히 0행이다(#1195).
LEFT JOIN ga4 g ON a.gaKeyHmac = g.gaKey
-- ★이커머스도 같은 다리다 — 같은 gaKeyHmac. 다른 키를 쓰면 두 GA4 축이 갈린다.
LEFT JOIN ecom e ON a.gaKeyHmac = e.gaKey
LEFT JOIN daily d ON p.install_key = d.install_key`;
}

/** `CREATE OR REPLACE VIEW` DDL. ★원본 표는 만들지도 고치지도 않는다. */
export function buildUnifiedViewDdl(projectId: string): string {
  const name = table(projectId, TELEMETRY_DATASET, VIEW_INSTALL_UNIFIED);
  return [
    `CREATE OR REPLACE VIEW ${name} AS`,
    buildUnifiedViewSql(projectId),
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 5. 결제가 붙은 완전체 (marblo_identity)
// ════════════════════════════════════════════════════════════════════════════

/**
 * 게이트가 닫혔을 때의 본문 — 축약본 전부 + 결제 컬럼은 NULL + 사유.
 *
 * ★0행을 돌려주지 않는다. 설치·채널·리텐션은 사람 축과 무관하게 사실이고, 그걸
 *   같이 지우면 "사람 축이 닫혔다" 가 "설치가 없다" 로 읽힌다. 닫힌 것은 결제
 *   축뿐이므로 **결제 컬럼만** 미상으로 만든다.
 */
function buildRevenueClosedSql(projectId: string, reason: string): string {
  const base = table(projectId, TELEMETRY_DATASET, VIEW_INSTALL_UNIFIED);
  return `-- ★생성물이다. 손으로 고치지 마라 — v3/functions/src/installUnified.ts 가 정본이다.
-- ★사람 축 게이트가 닫혀 있다. 설치·채널·리텐션은 그대로 주고 결제만 미상이다.
SELECT
  b.*,
  CAST(NULL AS STRING)    AS personKey,
  CAST(NULL AS INT64)     AS personLinkCount,
  CAST(NULL AS INT64)     AS personInstallCount,
  CAST(NULL AS TIMESTAMP) AS firstPurchaseAt,
  CAST(NULL AS INT64)     AS purchaseCount,
  CAST(NULL AS INT64)     AS paidCount,
  CAST(NULL AS INT64)     AS grantCount,
  CAST(NULL AS NUMERIC)   AS revenueLedger,
  CAST(NULL AS STRING)    AS revenueCurrency,
  CAST(NULL AS INT64)     AS revenueAmountUnknownCount,
  CAST(NULL AS STRING)    AS accountClass,
  CAST(NULL AS BOOL)      AS isInternal,
  ${sqlString(reason)}    AS revenueMissingReason,
  -- ★GA4 축은 사람 축 게이트와 무관하게 살아 있다(b.* 로 그대로 통과한다).
  --   대조만 불가능하다 — 원장 쪽을 모르니까. 그래서 사유는 ledger_unknown 이다.
  ${sqlString(REVENUE_DIVERGENCE_REASONS[0].reason)}
                          AS revenueDivergenceReason,
  CAST(NULL AS DATE)      AS personAxisEffectiveFrom
FROM ${base} b`;
}

/**
 * 게이트가 열렸을 때의 본문.
 *
 * ── 조인 경로 (한 줄도 추측하지 않는다) ─────────────────────────────────────
 *   설치(원시) → `analytics_user_daily.install_key_hmac`(설치 원시→가명의 **유일한
 *   다리**, #1171) → 링크표 `analytics_user_install`(설치↔사람을 잇는 **유일한
 *   자리**) → `analytics_purchase`(사람 알갱이).
 *
 * ★`gaKeyHmac` 으로 설치↔사람을 잇지 **마라.** 한 브라우저에 설치가 480건이라
 *   한 사람의 결제가 480개 설치에 복제된다.
 * ★결제·링크는 전부 사전 집계된 1행이라 행수가 보존된다.
 */
function buildRevenueOpenSql(projectId: string, effectiveFrom: string): string {
  const base = table(projectId, TELEMETRY_DATASET, VIEW_INSTALL_UNIFIED);
  const daily = table(projectId, TELEMETRY_DATASET, SOURCE_USER_DAILY);
  const link = table(projectId, IDENTITY_DATASET, TABLE_USER_INSTALL);
  const purchase = table(projectId, TELEMETRY_DATASET, SOURCE_PURCHASE);

  return `-- ★생성물이다. 손으로 고치지 마라 — v3/functions/src/installUnified.ts 가 정본이다.
-- 설계: v3/docs/install-unified-view-2026-08-24.md (ticket L8RvsReu6Vch5eNYYCJR)
-- ★이 뷰가 ${IDENTITY_DATASET} 에 사는 이유는 링크표가 여기 살기 때문이다(IAM 경계).
WITH hmac AS (
  -- ★설치 원시 → 설치 가명. 이 다리가 없으면 결제 축은 0 이 아니라 **미상**이다.
  SELECT
    install_key,
    ANY_VALUE(install_key_hmac) AS installKeyHmac
  FROM ${daily}
  WHERE install_key_hmac IS NOT NULL
  GROUP BY install_key
),
link AS (
  -- ★공용 기기는 값을 만들지 않고 **센다**(person-axis 설계). 사람이 정확히
  --   1명일 때만 personKey 를 만든다.
  SELECT
    install_key AS installKeyHmac,
    COUNT(DISTINCT user_key) AS personLinkCount,
    IF(COUNT(DISTINCT user_key) = 1, ANY_VALUE(user_key), NULL) AS personKey
  FROM ${link}
  GROUP BY install_key
),
paid AS (
  -- ★사람 축 소급 상한을 여기서 건다(설계 §5.4 와 같은 경계).
  -- ★grant 는 이 CTE 에 절대 들어오지 않는다. 무상 부여는 매출·accountClass·
  --   amount_unknown 을 만들 수 없고, 아래 grant CTE 에서 별도 카운트로만 붙는다.
  SELECT
    user_key,
    MIN(event_at) AS firstPurchaseAt,
    COUNT(*) AS purchaseCount,
    COUNTIF(kind = 'paid') AS paidCount,
    SUM(IF(amount_known, amount, NULL)) AS revenueKnownAmount,
    COUNTIF(NOT amount_known) AS revenueAmountUnknownCount,
    COUNT(DISTINCT IF(amount_known, currency, NULL)) AS currencyCount,
    ANY_VALUE(IF(amount_known, currency, NULL)) AS revenueCurrency,
    -- ★판정 불가(NULL)를 external 로 승격하지 않는다 — analyticsPurchase.ts 규약.
    --   internal 이 하나라도 섞이면 보수적으로 internal 로 본다(매출로 세지 않게).
    CASE
      WHEN COUNTIF(account_class = 'internal') > 0 THEN 'internal'
      WHEN COUNTIF(account_class = 'external') > 0 THEN 'external'
      ELSE NULL
    END AS accountClass
  FROM ${purchase}
  WHERE event_at >= TIMESTAMP(DATE ${sqlString(effectiveFrom)})
    AND kind IN (${REVENUE_LEDGER_KINDS.map(sqlString).join(", ")})
  GROUP BY user_key
),
grant AS (
  -- ★무상 부여는 경영 정보지만 매출이 아니다. paid 와 같은 사람이어도 여기서
  --   따로 접고, revenue/accountClass/amount_unknown 계산에는 절대 섞지 않는다.
  SELECT
    user_key,
    COUNT(*) AS grantCount
  FROM ${purchase}
  WHERE event_at >= TIMESTAMP(DATE ${sqlString(effectiveFrom)})
    AND kind = 'grant'
  GROUP BY user_key
),
joined AS (
  SELECT
    b.*,
    l.personKey AS personKey,
    IFNULL(l.personLinkCount, 0) AS personLinkCount,
    -- ★한 사람이 기기 여러 대면 그 사람의 결제가 **행마다 반복**된다. 설치
    --   알갱이에서 피할 수 없는 성질이라 숨기는 대신 센다 — SUM(revenueTotal)
    --   은 그래서 틀린다. 사람 단위로 접으려면 이 값이 필요하다.
    IF(
      l.personKey IS NULL,
      NULL,
      COUNT(*) OVER (PARTITION BY l.personKey)
    ) AS personInstallCount,
    pu.firstPurchaseAt AS firstPurchaseAt,
    pu.purchaseCount AS purchaseCount,
    pu.paidCount AS paidCount,
    gr.grantCount AS grantCount,
    pu.revenueKnownAmount AS revenueKnownAmount,
    pu.revenueAmountUnknownCount AS revenueAmountUnknownCount,
    pu.revenueCurrency AS revenueCurrency,
    pu.accountClass AS accountClass,
    ${buildReasonCase(REVENUE_REASONS, "    ")} AS revenueMissingReason
  FROM ${base} b
  LEFT JOIN hmac h ON b.installKey = h.install_key
  LEFT JOIN link l ON h.installKeyHmac = l.installKeyHmac
  -- ★공용 기기(personKey IS NULL)는 여기서 자연히 안 붙는다 — 귀속을 고르지 않는다.
  LEFT JOIN paid pu ON l.personKey = pu.user_key
  -- ★grant 는 paid 와 별도 축으로만 붙는다. 매출 계산에 섞지 않는다.
  LEFT JOIN grant gr ON l.personKey = gr.user_key
),
resolved AS (
  -- ★대조하기 **전에** 두 축의 금액을 각자의 규약대로 확정한다. 사유가 있으면
  --   미상(NULL), 없으면 실수(0 일 수 있다). 이 한 층이 없으면 차이 사유가
  --   "미상 vs 0" 을 "값이 다르다" 로 잘못 읽는다.
  SELECT
    j.*,
    IF(
      j.revenueMissingReason IS NULL,
      IFNULL(j.revenueKnownAmount, NUMERIC '0'),
      NULL
    ) AS revenueLedgerAmount,
    -- ga4RevenueTotal 은 이미 규약을 지키고 있다(사유가 있는 자리는 전부 NULL) —
    -- 결제 0건이면 0원이지 NULL 이 아니다(ga4_ecommerce_current 가 그렇게 만든다).
    j.ga4RevenueTotal AS ga4RevenueAmount
  FROM joined j
)
SELECT
  j.* EXCEPT (
    revenueKnownAmount,
    revenueAmountUnknownCount,
    revenueCurrency,
    firstPurchaseAt,
    purchaseCount,
    paidCount,
    grantCount,
    accountClass,
    personKey,
    personLinkCount,
    personInstallCount,
    revenueMissingReason,
    revenueLedgerAmount,
    ga4RevenueAmount
  ),
  -- ★사유가 있으면 값은 전부 NULL 이다. 사유가 없으면 값은 **실수**이고 0 일 수
  --   있다 — 그게 "0 과 미적재를 가른다" 의 실물이다.
  j.personKey AS personKey,
  j.personLinkCount AS personLinkCount,
  -- ★2 이상이면 이 행의 결제 금액이 같은 사람의 다른 설치 행에도 그대로 있다.
  j.personInstallCount AS personInstallCount,
  IF(j.revenueMissingReason IS NULL, j.firstPurchaseAt, NULL) AS firstPurchaseAt,
  IF(j.revenueMissingReason IS NULL, IFNULL(j.purchaseCount, 0), NULL) AS purchaseCount,
  IF(j.revenueMissingReason IS NULL, IFNULL(j.paidCount, 0), NULL) AS paidCount,
  IF(j.revenueMissingReason IS NULL, IFNULL(j.grantCount, 0), NULL) AS grantCount,
  -- ★이름이 revenueTotal 이 아니라 revenueLedger 다. 이 뷰에는 이제 **매출 축이
  --   둘**이고(원장·GA4), 'Total' 은 그중 어느 쪽인지 말하지 않는다. 정본이
  --   원장이라는 사실을 컬럼 이름이 직접 말하게 한다.
  j.revenueLedgerAmount AS revenueLedger,
  IF(j.revenueMissingReason IS NULL, j.revenueCurrency, NULL) AS revenueCurrency,
  IF(j.revenueMissingReason IS NULL, IFNULL(j.revenueAmountUnknownCount, 0), NULL) AS revenueAmountUnknownCount,
  j.accountClass AS accountClass,
  -- ★판정 불가는 NULL 로 남긴다. 빈 집합으로 접으면 전부 external(=실매출)로 승격된다.
  IF(j.accountClass IS NULL, NULL, j.accountClass = 'internal') AS isInternal,
  j.revenueMissingReason AS revenueMissingReason,
  -- ── ★원장 ↔ GA4 대조 ────────────────────────────────────────────────────
  --   숫자를 고르지 않는다. revenueLedger 와 ga4RevenueTotal 은 각자 자기 칸에
  --   그대로 남고, 이 칸은 **왜 다른지**만 말한다. NULL = 두 축이 같다.
  --   ★SUM 하기 전에 personInstallCount / gaKeyInstallCount 를 봐라 — 두 축 모두
  --     설치 알갱이에서 값이 반복된다(설계 문서 §9-4).
  ${buildReasonCase(REVENUE_DIVERGENCE_REASONS, "  ")}
    AS revenueDivergenceReason,
  DATE ${sqlString(effectiveFrom)} AS personAxisEffectiveFrom
FROM resolved j`;
}

/** 결제 뷰 본문. 게이트가 닫혀 있으면 결제 컬럼만 미상인 SQL 이 나온다. */
export function buildRevenueViewSql(
  projectId: string,
  gate: PersonAxisGate,
): string {
  return gate.open
    ? buildRevenueOpenSql(projectId, gate.effectiveFrom)
    : buildRevenueClosedSql(projectId, REVENUE_REASON_GATE_CLOSED);
}

/** `CREATE OR REPLACE VIEW` DDL(결제 뷰). */
export function buildRevenueViewDdl(
  projectId: string,
  gate: PersonAxisGate,
): string {
  const name = table(projectId, IDENTITY_DATASET, VIEW_INSTALL_UNIFIED_REVENUE);
  return [
    `CREATE OR REPLACE VIEW ${name} AS`,
    buildRevenueViewSql(projectId, gate),
  ].join("\n");
}

/**
 * 사람 단위 결제 읽기 뷰.
 *
 * ★설치 뷰에서 `SUM(revenueLedger)` 를 직접 하면 한 사람의 결제가 설치 수만큼
 *   반복된다. 이 뷰는 `personKey` 로 먼저 접은 뒤 읽는 공식 경로다.
 * ★값은 고르지 않는다. 설치 행마다 반복되는 사람 단위 값은 `ANY_VALUE` 로 접고,
 *   반복 배수는 `installRowsRepresented` 로 남긴다.
 */
export function buildRevenuePersonViewSql(projectId: string): string {
  const revenue = table(projectId, IDENTITY_DATASET, VIEW_INSTALL_UNIFIED_REVENUE);
  return `-- ★생성물이다. 손으로 고치지 마라 — v3/functions/src/installUnified.ts 가 정본이다.
-- ★사람 단위 안전 경로. 설치 뷰에서 SUM(revenueLedger) 하지 말고 이 뷰를 읽어라.
SELECT
  personKey AS personKey,
  COUNT(*) AS installRowsRepresented,
  ANY_VALUE(personInstallCount) AS personInstallCount,
  ANY_VALUE(firstPurchaseAt) AS firstPurchaseAt,
  ANY_VALUE(purchaseCount) AS purchaseCount,
  ANY_VALUE(paidCount) AS paidCount,
  ANY_VALUE(grantCount) AS grantCount,
  ANY_VALUE(revenueLedger) AS revenueLedger,
  ANY_VALUE(revenueCurrency) AS revenueCurrency,
  ANY_VALUE(revenueAmountUnknownCount) AS revenueAmountUnknownCount,
  ANY_VALUE(accountClass) AS accountClass,
  ANY_VALUE(isInternal) AS isInternal,
  ANY_VALUE(revenueMissingReason) AS revenueMissingReason,
  ANY_VALUE(revenueDivergenceReason) AS revenueDivergenceReason,
  ANY_VALUE(personAxisEffectiveFrom) AS personAxisEffectiveFrom
FROM ${revenue}
WHERE personKey IS NOT NULL
GROUP BY personKey`;
}

/** `CREATE OR REPLACE VIEW` DDL(사람 단위 결제 읽기 뷰). */
export function buildRevenuePersonViewDdl(projectId: string): string {
  const name = table(
    projectId,
    IDENTITY_DATASET,
    VIEW_INSTALL_UNIFIED_REVENUE_PERSON,
  );
  return [
    `CREATE OR REPLACE VIEW ${name} AS`,
    buildRevenuePersonViewSql(projectId),
  ].join("\n");
}

// ════════════════════════════════════════════════════════════════════════════
// 6. 위생 검사 — 단위 테스트와 프로비저닝 스크립트가 같이 쓴다
// ════════════════════════════════════════════════════════════════════════════

/**
 * ★뷰 SQL 에 **절대** 나타나면 안 되는 것.
 *
 *  - 원시 식별자 컬럼(uid/email/ip) — 이 뷰는 가명키만 다룬다.
 *  - `'(unknown)'` 류 자리표시자 — 모르는 것은 NULL + 사유다. 이 규약이 깨지면
 *    다음 사람이 미적재를 값으로 읽는다(이 프로젝트가 오늘 세 번 틀린 자리다).
 *  - 솔트 env 이름 — 솔트는 SQL 에 등장하지 않는다(BQ job 히스토리 보관).
 */
export const FORBIDDEN_SQL_TOKENS: ReadonlyArray<string> = [
  "uid",
  "user_id",
  "email",
  "ip_address",
  "ANALYTICS_ID_SALT",
  "(unknown)",
  "(unspecified)",
];

/** SQL 위생 검사. 걸린 토큰 목록을 돌려준다(빈 배열이면 통과). */
export function findForbiddenTokens(sql: string): string[] {
  const lower = sql.toLowerCase();
  const hits: string[] = [];
  for (const token of FORBIDDEN_SQL_TOKENS) {
    const t = token.toLowerCase();
    // `uid` 는 `installId`·`gaClientId` 안에 없지만 단어 경계로 본다 —
    // `user_key`(가명)·`user_daily` 같은 정상 이름을 오탐하지 않기 위해서다.
    const re = new RegExp(`(^|[^a-z0-9_])${escapeRe(t)}([^a-z0-9_]|$)`);
    if (re.test(lower)) hits.push(token);
  }
  return hits;
}

function escapeRe(v: string): string {
  return v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
