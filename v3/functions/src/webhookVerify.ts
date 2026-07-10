/**
 * Webhook verification & trust helpers — extracted as a pure, side-effect-free
 * module so the security-critical logic can be unit-tested without booting
 * firebase-admin or hitting the network. Same extraction pattern as
 * rateLimit.ts / reconciliation.ts / redact.ts.
 *
 * 위조된 웹훅으로 구독 상태를 조작하는 것을 막는다. 두 결제사는 신뢰 모델이
 * 다르다:
 *   - Paddle: 실제 HMAC 서명 헤더(`ts=..;h1=..`)가 있어 원본 바이트로 검증한다.
 *     서명은 반드시 원본 바이트(req.rawBody)에 대해 계산해야 한다 — JSON.parse
 *     후 재직렬화하면 키 순서/공백이 달라져 HMAC 이 깨진다. 비교는 timing-safe.
 *   - Toss 결제 웹훅(PAYMENT_STATUS_CHANGED 등): 서명 헤더가 없다. HMAC 서명은
 *     정산/셀러 웹훅(payout.changed) 전용이며 `tosspayments-webhook-signature`
 *     라는 별도 헤더/스킴을 쓴다. 따라서 결제 웹훅은 서명으로 검증할 수 없고,
 *     body 를 신뢰하는 대신 paymentKey 로 Payment 조회 API 를 재호출해 Toss 가
 *     알려주는 실제 상태로만 구독을 바꾼다(아래 순수 결정 함수들이 그 로직).
 *     ※ 정산 웹훅을 구현하게 되면 `tosspayments-webhook-signature` 실제 스킴을
 *       라이브 문서로 확인해 별도 검증기를 붙여야 한다(이전의 HMAC 검증기는
 *       실제 스킴과 불일치해 결제 웹훅을 전부 401 로 막았으므로 제거했다).
 *
 * 시크릿은 인자로 주입한다(모듈이 process.env 를 읽지 않음) — 테스트가
 * 알려진 벡터로 검증할 수 있고, index.ts 는 자신의 env 상수를 넘긴다.
 */
import * as crypto from "crypto";

/** 길이까지 포함해 timing-safe 한 hex 문자열 비교. */
export function timingSafeEqualHex(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ─── Toss 결제 웹훅: body 불신 + 재조회 기반 결정(순수) ──────────────────
// 서명이 없으므로 위조 방지의 정석은 "body 의 status 를 절대 신뢰하지 않고
// paymentKey 로 Toss 에 직접 조회한 실제 status 로만 구독을 바꾸는 것". 아래
// 세 함수는 그 결정 로직을 네트워크·firestore 없이 단위테스트할 수 있게 분리
// 한 순수 함수다(실제 fetch 는 index.ts 의 얇은 래퍼가 담당).

/** Toss Payment 재조회 결과. 실패/미존재/미설정은 null 로 표현(안전 무시). */
export type TossPaymentQueryResult = { status: string } | null;

/** 재조회한 실제 status 로 구독에 적용할 액션. */
export type TossSubscriptionAction =
  | { type: "cancel" } // status=canceled, planType=free (해지/만료)
  | { type: "past_due" } // 부분취소 → past_due
  | { type: "none" }; // 변경 없음(활성/진행/미상/재조회 실패)

/**
 * Toss Payment 조회 API(GET /v1/payments/{paymentKey}) 응답을 재조회 결과로
 * 정규화. 2xx 이고 status 문자열이 있을 때만 { status }, 그 외(비-2xx=404
 * 미존재/위조 포함, status 누락)는 null 을 돌려 호출부가 "구독 변경 안 함"
 * 으로 안전 처리하게 한다.
 */
export function classifyTossPaymentResponse(
  ok: boolean,
  body: unknown,
): TossPaymentQueryResult {
  if (!ok) return null;
  const status = (body as { status?: unknown } | null)?.status;
  return typeof status === "string" && status ? { status } : null;
}

/**
 * Toss 가 준 실제 결제 status → 구독 액션. 재조회 API 의 신뢰된 status 에만
 * 적용한다(웹훅 body 의 status 로는 절대 호출하지 말 것). DONE/READY/
 * IN_PROGRESS/WAITING_FOR_DEPOSIT/ABORTED/미상 등은 구독 상태를 바꾸지 않는다.
 */
export function subscriptionActionForTossStatus(
  status: string,
): TossSubscriptionAction {
  switch ((status || "").toUpperCase()) {
    case "CANCELED":
    case "EXPIRED":
      return { type: "cancel" };
    case "PARTIAL_CANCELED":
      return { type: "past_due" };
    default:
      return { type: "none" };
  }
}

/**
 * 재조회 결과(실패/미존재는 null) → 구독 액션. null 이면 none(안전 무시).
 * 결정이 오직 재조회 결과의 함수이므로, 위조 body 가 어떤 status 를 주장하든
 * 무해하다(호출부는 body.status 를 이 경로에 넘기지 않는다).
 */
export function resolveTossWebhookAction(
  query: TossPaymentQueryResult,
): TossSubscriptionAction {
  if (!query) return { type: "none" };
  return subscriptionActionForTossStatus(query.status);
}

/**
 * Paddle Billing 웹훅 서명 검증. 헤더 형식: `ts=<unix>;h1=<hmac-hex>`.
 * HMAC-SHA256(secret, `${ts}:${rawBody}`) 를 h1 과 비교 (Paddle 공식 스킴).
 */
export function verifyPaddleSignature(
  signatureHeader: string,
  rawBody: Buffer | undefined,
  secret: string,
): boolean {
  if (!secret || !signatureHeader || !rawBody) return false;
  const parts = Object.fromEntries(
    signatureHeader.split(";").map((kv) => {
      const idx = kv.indexOf("=");
      return [kv.slice(0, idx).trim(), kv.slice(idx + 1).trim()];
    }),
  );
  const ts = parts["ts"];
  const h1 = parts["h1"];
  if (!ts || !h1) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${ts}:${rawBody.toString("utf8")}`)
    .digest("hex");
  return timingSafeEqualHex(h1, expected);
}
