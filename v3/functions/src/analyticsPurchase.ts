/**
 * `analytics_purchase` — 결제 원장 → BigQuery 행 매핑(순수 로직).
 *
 * installAttribution.ts / analyticsPseudonym.ts 와 같은 규약: Firestore·BigQuery
 * 의존이 0 이라 `node --test` 로 단위검증한다. 실제 읽기/적재는
 * analyticsPurchaseLoad.ts 와 scripts/backfill-analytics-purchase.ts 가 한다.
 *
 * ── ★왜 이 테이블이 필요한가 (ticket 6EnTiEzL7T2NpjOnTTSj) ──────────────────
 * `marblo_telemetry` 에는 결제 테이블이 아예 없었다(agent_heartbeats / cost_logs
 * / events / flow_executions / install_attribution / task_outcomes 6개뿐).
 * 결제는 Firestore 에만 있었고, 그래서 어드민 '수익' 탭은 **채울 수 있는 소스가
 * 없어서** 비어 있었다. 여기서 그 소스를 만든다.
 *
 * ── ★소스는 셋이다(티켓 본문의 "subscriptions 에만 있다" 는 실측과 다르다) ──
 *  1. `billingCharges` — **금액의 정본**. 토스 구독 청구(first/renewal/manual),
 *     PortOne 구독 청구, PortOne 단건(one_time)이 전부 여기로 들어온다.
 *     문서 ID 가 결정적이라(`${uid}_${cycleAnchorMs}`, `first_${provider}_...`,
 *     `portone_${paymentId}`) 재실행 멱등의 앵커로 그대로 쓸 수 있다.
 *  2. `lecturePurchases` — **토스 단건 강의결제**. 이 경로만 billingCharges 를
 *     거치지 않는다(index.ts confirmLecturePayment). PortOne 단건은 여기에도
 *     행이 생기지만 `provider:"portone"` 이 붙어 있어 그걸로 갈라 중복을 뺀다.
 *  3. `subscriptions` — **금액이 아니라 상태**. 해지/환불 사실만 여기서 읽는다.
 *
 * ── ★환불 금액은 지금 어디에도 없다 ────────────────────────────────────────
 * index.ts:2962 가 "중도/부분 환불 자동화는 범위 밖" 이라고 못박는다. 환불은 PG
 * 콘솔에서 수동으로 일어나고, 우리 쪽에 남는 흔적은 Toss 웹훅이 구독 문서를
 * `status=canceled, planType=free` 로 바꾼 것뿐이다 — **금액도 시각도 없다.**
 * 그래서 `kind='refund'` 행은 사실만 남기고 `amount=NULL, amount_known=false`
 * 로 적재한다. 0 으로 적으면 순매출이 총매출과 같아 보여서 "환불이 없었다" 로
 * 읽힌다 — 그게 이 컬럼이 있는 이유다. 정확한 순매출은 환불 원장을 남기는
 * 후속 작업이 필요하다(결제 흐름 변경이라 이 티켓 범위 밖).
 *
 * ── ★내부·테스트 결제를 매출에서 가른다 (ticket cDvehpHhz1sn0ZHNpNq5) ──────
 * 실측(2026-08-21): 운영 `subscriptions` 34건 중 활성 portone 구독 1건이
 * **운영자 본인의 테스트 결제**고 실제 결제 고객은 0명이다. 그 1건을 매출로
 * 적으면 대시보드의 첫 숫자가 틀린 값이 된다 — 매출 0 을 0 으로 보여주는 건
 * 정확한 것이고, 테스트 1건을 매출로 보여주는 게 부정확한 것이다.
 *
 * ★지우지 않고 **가른다.** `account_class` 컬럼을 붙여 기본 매출에서는 빼되
 *   건수는 남긴다. 지워 버리면 다음 사람이 "왜 결제가 하나도 안 잡히지" 로
 *   다시 판다.
 *
 * ★#1071(installAttribution.buildChannel)이 어트리뷰션에서 **개발 재실행을
 *   실유입과 가른** 패턴을 그대로 재사용한다 — 새 개념을 만들지 않는다:
 *     NULLABLE 컬럼 · 허용값 화이트리스트 · 집계는 한쪽만 · null = 표식 이전.
 *
 * ★판정은 **사람이 아니라 성격**으로 한다. 운영자 uid 를 코드에 박지 않고
 *   기존 운영자 축(`ADMIN_UID` → analyticsProfiles 의 `is_admin`, 어드민
 *   콜러블의 `adminExcluded`)을 그대로 쓴다. 운영자가 바뀌면 env 만 바뀌고
 *   판정은 계속 동작한다. 게다가 그 축은 **가명키 집합으로 주입**되므로 이
 *   모듈은 원시 uid 를 비교하지도 않는다.
 *
 * ★`account_class` 는 "PG 테스트키로 결제됐나" 를 뜻하지 않는다. 그건 계정 축이다.
 *   테스트/실거래 축은 결제 시점에 원장에 남긴 파생 enum(`pgEnv`)만 믿고,
 *   없던 과거 구간은 `pg_env=NULL` 로 둔다. storeId/channelKey/env 원값은
 *   크레덴셜이라 웨어하우스에 싣지 않는다.
 *
 * ── ★로그·컬럼에 남기지 않는 것 ────────────────────────────────────────────
 *  - 원시 uid: `user_key` 는 사람 축(PR #1084)이 넣은 **공용 HMAC 함수**
 *    (`analyticsPseudonym` 의 `user` kind)를 주입받아 만든다. 여기서 두 번째
 *    벌을 만들면 계정축 안의 조인이 조용히 갈라진다. 주입이 없으면 행을 만들지
 *    않는다 — 임시 해시로 메꾸지 않는다. ★이 키로 익명축(analytics_identity)과
 *    조인하지 마라 — analyticsPseudonym.ts 의 축 경계와 처리방침이 금지한다.
 *  - 원시 주문번호/paymentKey: `order_id` 는 HMAC 가명(`od_...`)만 싣는다.
 *  - PG 응답 원문(`billingCharges.error`, paymentKey, 카드정보): 컬럼 자체가
 *    없다. 아래 REJECTED_FIELDS 가 그 결정을 테스트로 고정한다.
 *  - 금액·주문번호는 **로그에 남기지 않는다.** 이 모듈은 로깅을 하지 않고,
 *    호출부가 남길 수 있게 사유 코드(SkipReason)만 돌려준다.
 */

import { pseudonymizeAnalyticsId } from "./analyticsPseudonym";

/** BigQuery 테이블/스테이징 이름. marblo_telemetry 데이터셋 안에 있다. */
export const ANALYTICS_PURCHASE_TABLE = "analytics_purchase";
export const ANALYTICS_PURCHASE_STAGING_TABLE = "analytics_purchase_staging";

/**
 * 계정 성격. #1071 의 `BUILD_CHANNELS`(["dev","prod"]) 와 같은 규약 —
 * 화이트리스트 밖의 값은 만들지 않고, **집계는 한쪽("external")만 센다.**
 *  - `internal` : 운영자(내부) 계정에서 일어난 결제·구독. 매출이 아니다.
 *  - `external` : 그 외 = 실제 고객.
 * `null` 은 **표식이 붙기 전(2026-08-21 이전) 적재된 행**이거나 운영자 축이
 * 설정되지 않아 판정 자체를 못 한 행이다. 0 도 아니고 external 도 아니다 —
 * 화면은 이 수를 따로 세어 보여야 한다.
 */
export const ACCOUNT_CLASSES = ["internal", "external"] as const;
export type AccountClass = (typeof ACCOUNT_CLASSES)[number];

/**
 * 매출로 합산해도 되는 계정 성격. 질의가 이 상수를 쓰게 해서 "external 만"
 * 이라는 규약이 코드 한 곳에만 있게 한다.
 */
export const REVENUE_ACCOUNT_CLASS: AccountClass = "external";

/**
 * ★#1071 에는 `parseBuildChannel`(클라가 보낸 값 검증)이 있지만 여기엔 없다.
 * 이 컬럼의 값은 **우리 매퍼가 직접 만든다** — 신뢰할 수 없는 입력 경로가
 * 없으므로 파서를 두면 절대 안 도는 코드가 된다. 값을 만드는 곳은
 * `classifyAccount()` 하나뿐이고, 그래서 화이트리스트 밖의 값이 나올 수 없다.
 */

/**
 * PG 환경. 결제 시점의 서버 env 에서 만든 파생 enum 만 저장한다.
 * `null` 은 표식 이전 행이거나 서버 설정 미비로 판정 불가였던 행이다.
 */
export const PG_ENVS = ["test", "live"] as const;
export type PgEnv = (typeof PG_ENVS)[number];
export const REVENUE_PG_ENV: PgEnv = "live";

/**
 * 구매 이벤트 종류.
 *  - `trial`  : 금액 0 으로 자격만 부여된 건(쿠폰 전액할인 = 원장 status 'comped').
 *  - `paid`   : 첫 결제 / 수동 청구 / 단건 결제.
 *  - `renew`  : 정기 갱신 청구.
 *  - `refund` : PG 쪽에서 결제가 취소(환불)된 사실. **금액 미상**(위 주석 참조).
 *  - `cancel` : 사용자가 다음 결제를 멈춘 것. 돈이 움직이지 않는다.
 *  - `grant`  : PG 를 거치지 않은 **무상 자격 부여**(founder_grant). 매출이
 *               아니지만 **건수 자체가 경영 정보**다 — 예전엔 `not_a_payment`
 *               로 조용히 버려져 33건이 어디에도 남지 않았다. 지우지 않고
 *               가른다: 금액은 없고(`amount_known=false`) 매출 합산에 들어갈
 *               수 없다.
 */
export type PurchaseKind =
  | "trial"
  | "paid"
  | "renew"
  | "refund"
  | "cancel"
  | "grant";

/**
 * 행의 사유. 매출 축이 아니라 "왜 이 행이 생겼나" 를 남긴다.
 *  - 청구 원장에서: first | renewal | manual | one_time
 *  - 구독 상태에서: user_cancel | billing_failure | pg_cancel | founder_grant
 */
export type PurchaseReason =
  | "first"
  | "renewal"
  | "manual"
  | "one_time"
  | "user_cancel"
  | "billing_failure"
  | "pg_cancel"
  | "founder_grant";

/** 행을 만들지 않은 사유. 호출부가 **집계해서 보고**해야 한다(조용히 버리지 말 것). */
export type SkipReason =
  | "not_revenue" // 청구가 pending/failed — 아직 매출이 아니다.
  | "duplicate_portone_lecture" // PortOne 단건은 billingCharges 쪽으로 이미 잡혔다.
  // PG 도 안 거쳤고 무상 부여도 아닌 구독(예: 원장이 없는 paddle). founder
  // grant 는 더 이상 여기로 오지 않는다 — kind='grant' 행이 된다.
  | "not_a_payment"
  | "still_active" // 해지/환불 흔적이 없는 구독.
  | "missing_user" // userId 가 없다(구조적 이상 — 반드시 보고).
  | "missing_timestamp" // 시각을 못 정했다.
  | "missing_amount" // 금액이 있어야 하는데 숫자가 아니다.
  | "no_user_key" // ★공용 HMAC 함수가 없다/키를 못 만들었다.
  | "no_salt"; // ★가명화 솔트가 없다.

/** BigQuery 에 적히는 한 행. 컬럼은 여기 있는 것이 전부다. */
export interface PurchaseRow {
  /** 멱등 키. 소스 문서키의 HMAC 가명(`pu_...`) — 원시 문서키는 uid 를 품는다. */
  row_id: string;
  /**
   * ★공용 HMAC 계정키(계정축). 같은 사람의 결제 행들을 잇는 유일한 축이다.
   * 익명축(analytics_identity)과는 조인하지 않는다 — 축 경계 참조.
   */
  user_key: string;
  /** ISO-8601. 이벤트가 실제로 일어난 시각. */
  event_at: string;
  kind: PurchaseKind;
  plan: string | null;
  /** 정수 KRW. 금액이 없는 종류(refund/cancel)는 null. */
  amount: number | null;
  /** ★이 행의 amount 를 매출 합산에 써도 되는가. false 면 "미상" 이지 0 이 아니다. */
  amount_known: boolean;
  currency: string | null;
  /** toss | portone. */
  provider: string | null;
  /** 주문번호 HMAC 가명(`od_...`). 원문은 절대 싣지 않는다. */
  order_id: string | null;
  reason: PurchaseReason;
  /**
   * ★`internal` | `external` | null. 매출 집계는 `external` 만 센다.
   * null 은 표식 이전 행이거나 운영자 축 미설정으로 판정 불가였던 행이다 —
   * external 로 접지 않는다(접으면 내부 결제가 조용히 매출이 된다).
   */
  account_class: AccountClass | null;
  /**
   * ★`test` | `live` | null. 매출 집계는 `live` 만 센다.
   * null 은 표식 이전/판정 불가이며 test 도 live 도 아니다.
   */
  pg_env: PgEnv | null;
  /** billingCharges | lecturePurchases | subscriptions. 대조·감사용. */
  source: string;
  ingested_at: string;
}

/**
 * ★넣지 않기로 한 필드. 개인정보 처리방침(결제 데이터 최소수집)과 충돌하거나,
 * 웨어하우스에 있을 이유가 없는 값들이다. 테스트가 이 목록이 스키마에 없다는
 * 것을 고정한다 — 나중에 누가 "분석에 편하니까" 로 되살리는 걸 빨갛게 만든다.
 */
export const REJECTED_FIELDS = [
  "userId", // 원시 계정 uid → user_key 로만.
  "orderId", // 원시 주문번호 → order_id(가명)로만.
  "paymentKey", // PG 결제키. 콘솔 조회·취소 요청에 쓰이는 값이다.
  "paymentId", // PortOne 결제 id. 위와 같다.
  "billingKey", // 재청구가 가능한 키. 웨어하우스에 있으면 안 된다.
  "customerKey",
  "customerEmail", // 이메일·이름·전화 = 직접 식별자.
  "customerName",
  "customerPhone",
  "error", // PG 응답 원문(실패 사유 문자열).
  "pgRaw",
  "cardNumber",
  "couponCode", // 쿠폰 코드는 개인 귀속은 아니나 매출 분석에 불필요 — 넣지 않는다.
] as const;

/**
 * BigQuery 스키마. 새 컬럼은 반드시 NULLABLE 로 추가한다 — 기존 테이블에
 * REQUIRED 를 붙이는 건 BigQuery 가 거부한다(installAttribution 과 같은 규약).
 */
export const ANALYTICS_PURCHASE_SCHEMA = [
  { name: "row_id", type: "STRING", mode: "REQUIRED" },
  { name: "user_key", type: "STRING", mode: "REQUIRED" },
  { name: "event_at", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "kind", type: "STRING", mode: "REQUIRED" },
  { name: "plan", type: "STRING", mode: "NULLABLE" },
  // NUMERIC — 지금 소스는 전부 정수 KRW 지만, 소수 통화가 들어오는 날
  // INT64 → NUMERIC 은 BigQuery 가 제자리 변경을 허용하지 않는다.
  { name: "amount", type: "NUMERIC", mode: "NULLABLE" },
  { name: "amount_known", type: "BOOL", mode: "REQUIRED" },
  { name: "currency", type: "STRING", mode: "NULLABLE" },
  { name: "provider", type: "STRING", mode: "NULLABLE" },
  { name: "order_id", type: "STRING", mode: "NULLABLE" },
  { name: "reason", type: "STRING", mode: "NULLABLE" },
  // ★NULLABLE 이어야 한다. 기존 테이블에 REQUIRED 를 붙이면 BigQuery 가
  // 거부하고, 그러면 이 컬럼이 영영 안 생겨 갈라내기가 조용히 죽는다.
  { name: "account_class", type: "STRING", mode: "NULLABLE" },
  // ★NULLABLE. 기존 행은 소급 추정하지 않고 NULL 로 둔다.
  { name: "pg_env", type: "STRING", mode: "NULLABLE" },
  { name: "source", type: "STRING", mode: "REQUIRED" },
  { name: "ingested_at", type: "TIMESTAMP", mode: "REQUIRED" },
] as const;

/** 스키마 컬럼 이름 — MERGE SQL 생성과 스테이징 직렬화가 이 순서를 공유한다. */
export const ANALYTICS_PURCHASE_COLUMNS: readonly string[] =
  ANALYTICS_PURCHASE_SCHEMA.map((f) => f.name);

/**
 * 매핑 컨텍스트.
 *
 * ★`deriveUserKey` 는 **주입**이다. 사람 축(PR #1084)이 내보낸 공용 HMAC 함수를
 * 그대로 넘겨라(analyticsUserKey.ts 가 유일한 배선점 — 지금은 배선돼 있다).
 * 이 모듈이 자체 구현을 갖는 순간 두 벌이 되고, 두 벌은 언젠가 갈라지고,
 * 갈라지면 계정축 안의 조인이 **조용히** 깨진다(행은 그대로 있고 조인만 0 이
 * 되므로 아무도 눈치채지 못한다).
 * 함수를 못 구하면 `null` 을 넘겨라 — 그러면 행이 만들어지지 않는다.
 * 임시 해시를 만들어 넣지 말 것.
 */
export interface PurchaseMapContext {
  /** ANALYTICS_ID_SALT. 없으면 order_id/row_id 를 만들 수 없어 행을 버린다. */
  salt: string | null;
  /** ★공용 계정 가명키 함수. 없으면 null. */
  deriveUserKey: ((uid: string) => string | null) | null;
  /**
   * ★내부(운영자) 계정의 **가명키** 집합. 호출부가 기존 운영자 축
   * (`ADMIN_UID` → `getAdminExclusionUid()`)을 `deriveUserKey` 로 가명화해서
   * 넘긴다 — 이 모듈은 원시 uid 를 비교하지 않는다.
   *
   * `null` 은 "운영자 축을 못 구했다" 는 뜻이고, 그때는 `account_class` 가
   * null 이 된다. **빈 Set 과 다르다**: 빈 Set 은 "축은 있는데 내부 계정이
   * 없다"(= 전부 external)이고, null 은 "판정 불가"다. 두 상태를 합치면
   * 화면이 내부 결제를 매출로 보여주면서 그 사실을 숨긴다.
   */
  internalUserKeys: ReadonlySet<string> | null;
  /** 적재 시각(테스트 주입). */
  ingestedAt: Date;
}

export type MapResult =
  | { ok: true; row: PurchaseRow }
  | { ok: false; reason: SkipReason };

// ─── 소스 입력(Firestore 무의존 정규화 형태) ────────────────────────────────
// 호출부가 DocumentSnapshot 을 이 모양으로 바꿔 넘긴다. Timestamp → ms 변환도
// 호출부 책임이다(admin.firestore 타입이 이 모듈에 새어들지 않게).

/** `billingCharges/{docId}` 한 건. */
export interface BillingChargeSource {
  docId: string;
  userId: unknown;
  /** pending | succeeded | comped | failed */
  status: unknown;
  /** first | renewal | manual | one_time */
  reason: unknown;
  amount: unknown;
  planType: unknown;
  /** 문서에 있으면 "portone", 없으면 토스(레거시 문서는 provider 필드가 없다). */
  provider: unknown;
  /** 토스 경로의 주문번호. */
  orderId: unknown;
  /** PortOne 경로의 결제 id. */
  paymentId: unknown;
  /** 결제 시점 서버 env 에서 파생한 test/live enum. 없으면 표식 이전/판정 불가. */
  pgEnv: unknown;
  createdAtMs: number | null;
  /** 상태가 확정된 시각 — 성공 시각의 최선 근사. */
  updatedAtMs: number | null;
}

/** `lecturePurchases/{autoId}` 한 건. */
export interface LecturePurchaseSource {
  docId: string;
  userId: unknown;
  lectureSlug: unknown;
  amount: unknown;
  orderId: unknown;
  /** "portone" 이면 billingCharges 쪽에 이미 잡혀 있으므로 버린다. */
  provider: unknown;
  /** 토스 강의 단건 결제 시점 서버 env 에서 파생한 test/live enum. */
  pgEnv: unknown;
  purchasedAtMs: number | null;
}

/** `subscriptions/{uid}` 한 건 — 금액이 아니라 해지/환불 **상태**만 읽는다. */
export interface SubscriptionSource {
  docId: string;
  userId: unknown;
  status: unknown;
  planType: unknown;
  paymentProvider: unknown;
  founderGrant: unknown;
  billingFailedCount: unknown;
  /** 부여/구독 생성 시각. `grant` 행의 event_at 은 이 값을 먼저 쓴다. */
  createdAtMs: number | null;
  canceledAtMs: number | null;
  updatedAtMs: number | null;
}

/**
 * 청구 3회 실패 해지 판정 경계. billing.ts MAX_BILLING_RETRIES 와 같은 값이다.
 * ★두 곳에 흩어진 상수라 여기서 import 하지 않고 복제한 이유: billing.ts 는
 * 결제 흐름 모듈이고 이 티켓은 그쪽을 건드리지 않는다. 대신 테스트가 두 값이
 * 같은지 확인한다.
 */
export const CANCEL_BILLING_FAILURE_THRESHOLD = 3;

/** KRW 정수 금액으로 정규화. 숫자가 아니거나 음수면 null. */
function parseAmount(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw < 0) return null;
  return Math.round(raw);
}

/** 비어 있지 않은 문자열만 통과. 그 외는 null. */
function str(raw: unknown): string | null {
  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : null;
}

/** 원장에 남은 PG 환경 enum 검증. 화이트리스트 밖은 없는 값으로 취급한다. */
export function parsePgEnv(raw: unknown): PgEnv | null {
  const v = str(raw);
  return v === "test" || v === "live" ? v : null;
}

/**
 * 청구 원장 상태 + 사유 → (kind, 사유). 매출이 아닌 상태는 null.
 *
 * ★`pending`/`failed` 를 적재하지 않는 것이 멱등의 절반이다. 실패한 청구가
 * 나중에 성공하면 **같은 문서 ID** 로 status 만 바뀌므로, row_id 가 같아
 * MERGE 가 덮어쓴다 — 행이 둘로 늘지 않는다.
 */
export function classifyCharge(
  status: unknown,
  reason: unknown
): { kind: PurchaseKind; reason: PurchaseReason } | null {
  const st = str(status);
  if (st !== "succeeded" && st !== "comped") return null;

  const rs = str(reason);
  // comped = 금액 0 으로 자격만 준 건. 실제 PG 청구가 없었다.
  if (st === "comped") {
    return { kind: "trial", reason: rs === "renewal" ? "renewal" : "first" };
  }
  switch (rs) {
    case "renewal":
      return { kind: "renew", reason: "renewal" };
    case "manual":
      return { kind: "paid", reason: "manual" };
    case "one_time":
      return { kind: "paid", reason: "one_time" };
    case "first":
    default:
      // 레거시 문서는 reason 이 없다 — 첫 청구로 읽는다(원장에 renewal 은 항상
      // 명시돼 있다).
      return { kind: "paid", reason: "first" };
  }
}

/**
 * PG 를 거치지 않은 **무상 부여**인가.
 *
 * ★정본은 `paymentProvider === "founder_grant"` 다. 레거시 부여 문서에는
 *   provider 없이 `founderGrant: true` 만 있는 것들이 있어(백필 스크립트
 *   계열) 그것도 받는다 — 안 받으면 그만큼이 조용히 사라진다.
 * ★단 **provider 가 명시된 문서는 그 값을 믿는다.** 실측(2026-08-21) 결과
 *   운영 구독은 grant 플래그가 거의 전부에 붙어 있어서, 플래그만 보면
 *   paddle 같은 실제 PG 구독까지 "무상 부여" 로 바뀐다. 라벨을 잘못 붙이는
 *   건 안 붙이는 것보다 나쁘다 — 화면이 확신을 갖고 틀린 말을 한다.
 * ★호출부는 이 함수를 toss/portone 판정 **뒤에** 부른다 — grant 플래그가
 *   붙은 채 PG 를 거친 구독이 실제로 존재하기 때문이다(위 주석 참조).
 */
export function isFounderGrant(sub: SubscriptionSource): boolean {
  const provider = str(sub.paymentProvider);
  if (provider === "founder_grant") return true;
  return provider === null && sub.founderGrant === true;
}

/**
 * 구독 문서 → 해지/환불 판정.
 *
 * ★세 경로를 어떻게 가르는가(index.ts 실측):
 *  - 자발 해지(cancelSubscription): `canceledAt` 을 찍고 planType 은 유지한다.
 *  - 청구 3회 실패 해지(applyChargeFailure): planType='free' + billingFailedCount
 *    가 임계 이상. `canceledAt` 은 찍히지 않는다.
 *  - PG 취소/환불(tossWebhook CANCELED): planType='free' 로 내리지만
 *    `canceledAt` 도 billingFailedCount 도 없다. → 이것만 환불로 읽는다.
 *
 * ★이 판정은 추론이다(원장이 없으니까). 그래서 `reason` 컬럼에 어느 경로로
 * 갈랐는지 남긴다 — 대시보드가 숫자만 믿지 않고 근거를 볼 수 있게.
 */
export function classifySubscriptionEvent(
  sub: SubscriptionSource
): { kind: PurchaseKind; reason: PurchaseReason; atMs: number | null } | null {
  // PG 를 거치지 않은 구독(파운더 grant/베타 부여)은 구매가 아니다.
  //
  // ★`founderGrant === true` 단독으로 버리지 않는다. 실측(2026-08-21) 결과
  //   운영 데이터의 구독 34건이 **전부** founderGrant=true 인데 그중 1건은
  //   paymentProvider="portone" 이다 — grant 플래그가 붙어 있어도 PG 를 거친
  //   구독이 존재한다. 플래그만 보고 버리면 그 실결제자의 해지·환불이 통째로
  //   사라진다. 판단 기준은 "PG 를 거쳤는가"(paymentProvider)여야 한다.
  const provider = str(sub.paymentProvider);
  if (provider !== "toss" && provider !== "portone") {
    // ★매출은 아니지만 **버리지 않는다.** 무상 부여 건수 자체가 경영 정보다
    //   (실측 33건). 예전엔 이 자리에서 null 을 돌려 `not_a_payment` 로 세었고,
    //   그 숫자는 적재 로그에만 남아 화면 어디에도 안 나왔다.
    if (isFounderGrant(sub)) {
      return {
        kind: "grant",
        reason: "founder_grant",
        // 부여 시각이 정본. 없으면 마지막 변경 시각으로 근사한다.
        atMs: sub.createdAtMs ?? sub.updatedAtMs,
      };
    }
    return null;
  }

  if (sub.canceledAtMs !== null) {
    return { kind: "cancel", reason: "user_cancel", atMs: sub.canceledAtMs };
  }
  if (str(sub.status) !== "canceled") return null;

  const failed =
    typeof sub.billingFailedCount === "number" ? sub.billingFailedCount : 0;
  if (failed >= CANCEL_BILLING_FAILURE_THRESHOLD) {
    return {
      kind: "cancel",
      reason: "billing_failure",
      atMs: sub.updatedAtMs,
    };
  }
  if (str(sub.planType) === "free") {
    // planType 이 free 로 내려갔는데 자발 해지도 청구실패도 아니다 →
    // PG 쪽에서 결제가 취소(환불)된 것. 금액은 우리 쪽에 없다.
    return { kind: "refund", reason: "pg_cancel", atMs: sub.updatedAtMs };
  }
  return null;
}

/**
 * 소스 문서키 → 행 멱등키. 재실행해도 같은 값이라 MERGE 가 중복을 만들지 않는다.
 *
 * ★HMAC 을 쓰는 이유: billingCharges 문서 ID 는 `${uid}_${cycleAnchorMs}` 라
 * **원시 uid 를 품는다.** 그대로 row_id 에 넣으면 처리방침이 약속한 "계정
 * 식별자 없음" 이 깨진다.
 */
export function purchaseRowId(
  sourceKey: string,
  salt: string | null
): string | null {
  const v = pseudonymizeAnalyticsId("purchase", sourceKey, salt);
  return typeof v === "string" && v.length > 0 ? v : null;
}

/** 주문번호 가명화. 없으면 null(정상값), 솔트가 없으면 null. */
export function pseudonymizeOrderId(
  raw: unknown,
  salt: string | null
): string | null {
  const v = str(raw);
  if (!v) return null;
  const out = pseudonymizeAnalyticsId("order", v, salt);
  return typeof out === "string" && out.length > 0 ? out : null;
}

/** 공통 마무리 — user_key/row_id/솔트 게이트를 한 곳에서 건다. */
function finish(
  ctx: PurchaseMapContext,
  uidRaw: unknown,
  sourceKey: string,
  partial: Omit<
    PurchaseRow,
    "row_id" | "user_key" | "ingested_at" | "account_class"
  >
): MapResult {
  if (!ctx.salt) return { ok: false, reason: "no_salt" };
  const uid = str(uidRaw);
  if (!uid) return { ok: false, reason: "missing_user" };
  // ★공용 함수가 없으면 여기서 멈춘다. 임시 해시로 메꾸지 않는다 —
  // 그렇게 넣은 행은 진짜 계정키와 영원히 조인되지 않고, 그 사실이
  // 숫자로는 드러나지 않는다(조인 결과가 0 이 아니라 그냥 비어 보인다).
  if (!ctx.deriveUserKey) return { ok: false, reason: "no_user_key" };
  const userKey = ctx.deriveUserKey(uid);
  if (!userKey) return { ok: false, reason: "no_user_key" };

  const rowId = purchaseRowId(sourceKey, ctx.salt);
  if (!rowId) return { ok: false, reason: "no_salt" };

  return {
    ok: true,
    row: {
      row_id: rowId,
      user_key: userKey,
      ingested_at: ctx.ingestedAt.toISOString(),
      account_class: classifyAccount(userKey, ctx.internalUserKeys),
      ...partial,
    },
  };
}

/**
 * 가명키 → 계정 성격. 판정은 **가명 공간에서만** 일어난다(원시 uid 없음).
 *
 * ★집합이 `null`(운영자 축 미설정)이면 external 로 접지 않고 null 을 남긴다.
 *   접으면 "판정을 못 했다" 가 "고객 결제다" 로 승격되고, 그 승격이 정확히
 *   이 티켓이 고치려는 거짓말이다.
 */
export function classifyAccount(
  userKey: string,
  internalUserKeys: ReadonlySet<string> | null
): AccountClass | null {
  if (internalUserKeys === null) return null;
  return internalUserKeys.has(userKey) ? "internal" : "external";
}

/** `billingCharges` 한 건 → 행. */
export function mapBillingCharge(
  doc: BillingChargeSource,
  ctx: PurchaseMapContext
): MapResult {
  const cls = classifyCharge(doc.status, doc.reason);
  if (!cls) return { ok: false, reason: "not_revenue" };

  const atMs = doc.updatedAtMs ?? doc.createdAtMs;
  if (atMs === null) return { ok: false, reason: "missing_timestamp" };

  const amount = parseAmount(doc.amount);
  if (amount === null) return { ok: false, reason: "missing_amount" };

  const provider = str(doc.provider) === "portone" ? "portone" : "toss";
  const rawOrder = provider === "portone" ? doc.paymentId : doc.orderId;

  return finish(ctx, doc.userId, `billingCharges/${doc.docId}`, {
    event_at: new Date(atMs).toISOString(),
    kind: cls.kind,
    plan: str(doc.planType),
    // comped 는 실제로 0 원이 청구된 것 — 미상이 아니라 **아는 0** 이다.
    amount,
    amount_known: true,
    currency: "KRW",
    provider,
    order_id: pseudonymizeOrderId(rawOrder, ctx.salt),
    reason: cls.reason,
    pg_env: parsePgEnv(doc.pgEnv),
    source: "billingCharges",
  });
}

/**
 * `lecturePurchases` 한 건 → 행. **토스 단건만** 여기서 잡는다.
 * PortOne 단건은 billingCharges 에도 행이 있으므로 그쪽 하나만 센다.
 */
export function mapLecturePurchase(
  doc: LecturePurchaseSource,
  ctx: PurchaseMapContext
): MapResult {
  if (str(doc.provider) === "portone") {
    return { ok: false, reason: "duplicate_portone_lecture" };
  }
  if (doc.purchasedAtMs === null) {
    return { ok: false, reason: "missing_timestamp" };
  }
  const amount = parseAmount(doc.amount);
  if (amount === null) return { ok: false, reason: "missing_amount" };

  return finish(ctx, doc.userId, `lecturePurchases/${doc.docId}`, {
    event_at: new Date(doc.purchasedAtMs).toISOString(),
    kind: "paid",
    // 강의 단건은 구독 플랜이 아니다 — 플랜 축을 오염시키지 않도록 slug 를
    // 그대로 두지 않고 접두를 붙인다(`lecture:react-basics`).
    plan: str(doc.lectureSlug) ? `lecture:${str(doc.lectureSlug)}` : null,
    amount,
    amount_known: true,
    currency: "KRW",
    provider: "toss",
    order_id: pseudonymizeOrderId(doc.orderId, ctx.salt),
    reason: "one_time",
    pg_env: parsePgEnv(doc.pgEnv),
    source: "lecturePurchases",
  });
}

/**
 * `subscriptions` 한 건 → 해지/환불/무상부여 행. 금액은 싣지 않는다.
 * (`amount_known=false` 라 어떤 매출 합산에도 들어갈 수 없다.)
 */
export function mapSubscriptionEvent(
  doc: SubscriptionSource,
  ctx: PurchaseMapContext
): MapResult {
  const cls = classifySubscriptionEvent(doc);
  if (!cls) {
    const provider = str(doc.paymentProvider);
    return {
      ok: false,
      reason:
        provider !== "toss" && provider !== "portone"
          ? "not_a_payment"
          : "still_active",
    };
  }
  if (cls.atMs === null) return { ok: false, reason: "missing_timestamp" };

  // ★row_id 에 시각을 넣지 않는다. 넣으면 같은 해지가 updatedAt 이 바뀔 때마다
  // 새 행이 되어 중복이 된다(해지는 사용자당 사이클당 한 번이면 충분하다).
  // 대신 (uid, kind) 로 고정하고 MERGE 가 시각을 갱신한다.
  // grant 도 같다 — 구독 문서당 부여 행은 하나다(해지돼도 부여 사실은 하나).
  return finish(ctx, doc.userId, `subscriptions/${doc.docId}/${cls.kind}`, {
    event_at: new Date(cls.atMs).toISOString(),
    kind: cls.kind,
    plan: str(doc.planType),
    amount: null,
    // ★0 이 아니라 "미상". 이 false 가 순매출을 못 낸다는 사실을 드러낸다.
    amount_known: false,
    currency: null,
    provider: str(doc.paymentProvider),
    order_id: null,
    reason: cls.reason,
    pg_env: null,
    source: "subscriptions",
  });
}

/**
 * 매출로 세는 행 종류. `trial`(comped 0원)은 **건수에서 뺀다** — 돈이 오간
 * 적이 없어 "결제 N건" 에 넣으면 건수가 부풀고, 금액은 아는 0 이라 합계엔
 * 어차피 영향이 없다. `refund`/`cancel`/`grant` 는 amount_known=false 라
 * 구조적으로 합산 대상이 아니다.
 */
export const REVENUE_KINDS: readonly PurchaseKind[] = ["paid", "renew"];

/**
 * 한 배치의 행 → 성격별 건수·금액. 적재 로그와 어드민 콜러블이 **같은 정의**를
 * 쓰게 하려고 순수 함수로 둔다(정의가 두 벌이면 화면과 로그가 다른 말을 한다).
 *
 * ★금액은 `external` + `live` + `amount_known` + 매출 종류일 때만 더한다.
 *   테스트와 미상은 건수로만 남는다 — 지우는 게 아니라 가르는 것이다.
 */
export interface PurchaseTally {
  /** 실매출(외부 고객) 합계. 원 단위 정수. 행이 없으면 **0**(미상이 아니다). */
  externalRevenue: number;
  /** 실매출로 센 행 수. */
  externalRevenueRows: number;
  /** 내부(운영자) 계정 결제 건수 — 매출에서 뺐지만 화면에 보여야 하는 수. */
  internalRows: number;
  /** PG 테스트 환경 결제 건수 — 숨기지 않고 별도 표시한다. */
  testPaymentRows: number;
  /** PG 환경 표식이 없는 결제 건수 — 0 이 아니라 미상이다. */
  unknownPgEnvRows: number;
  /** 무상 부여(founder_grant) 건수. */
  grantRows: number;
  /** 계정 성격을 판정하지 못한 행 수(표식 이전 적재분 / 운영자 축 미설정). */
  unclassifiedRows: number;
  /** 금액이 미상인 행 수(환불·해지·부여). 0 으로 읽히면 안 되는 수. */
  amountUnknownRows: number;
  total: number;
}

export function tallyPurchaseRows(
  rows: ReadonlyArray<PurchaseRow>
): PurchaseTally {
  const t: PurchaseTally = {
    externalRevenue: 0,
    externalRevenueRows: 0,
    internalRows: 0,
    testPaymentRows: 0,
    unknownPgEnvRows: 0,
    grantRows: 0,
    unclassifiedRows: 0,
    amountUnknownRows: 0,
    total: rows.length,
  };
  for (const r of rows) {
    if (r.account_class === null) t.unclassifiedRows++;
    else if (r.account_class === "internal") t.internalRows++;
    if (REVENUE_KINDS.includes(r.kind)) {
      if (r.pg_env === "test") t.testPaymentRows++;
      else if (r.pg_env === null) t.unknownPgEnvRows++;
    }
    if (r.kind === "grant") t.grantRows++;
    if (!r.amount_known) t.amountUnknownRows++;
    if (
      r.account_class === REVENUE_ACCOUNT_CLASS &&
      r.pg_env === REVENUE_PG_ENV &&
      r.amount_known &&
      typeof r.amount === "number" &&
      REVENUE_KINDS.includes(r.kind)
    ) {
      t.externalRevenue += r.amount;
      t.externalRevenueRows++;
    }
  }
  return t;
}

/** 스킵 사유별 집계. 호출부가 이걸 그대로 보고한다(조용히 버리지 않기 위해). */
export type SkipTally = Partial<Record<SkipReason, number>>;

export interface BuildResult {
  rows: PurchaseRow[];
  skipped: SkipTally;
}

/** 결과를 모으는 작은 누산기 — 세 소스가 같은 규약으로 집계되게 한다. */
export function collect(
  results: ReadonlyArray<MapResult>,
  into?: BuildResult
): BuildResult {
  const out: BuildResult = into ?? { rows: [], skipped: {} };
  for (const r of results) {
    if (r.ok) out.rows.push(r.row);
    else out.skipped[r.reason] = (out.skipped[r.reason] ?? 0) + 1;
  }
  return out;
}

/**
 * row_id 중복 제거. 마지막 값이 이긴다.
 *
 * ★한 배치 안에 같은 row_id 가 둘 있으면 BigQuery MERGE 가
 * "UPDATE/MERGE must match at most one source row" 로 **통째로 실패**한다.
 * 로드 전에 반드시 통과시켜라.
 */
export function dedupeRows(rows: ReadonlyArray<PurchaseRow>): PurchaseRow[] {
  const byId = new Map<string, PurchaseRow>();
  for (const r of rows) byId.set(r.row_id, r);
  return [...byId.values()];
}

/** 행 → 스테이징 로드용 NDJSON. 컬럼 순서는 스키마를 따른다. */
export function toNdjson(rows: ReadonlyArray<PurchaseRow>): string {
  return rows.map((r) => JSON.stringify(r)).join("\n");
}
