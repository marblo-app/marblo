/**
 * Webhook signature verification (H1) — extracted as a pure, side-effect-free
 * module so the security-critical HMAC logic can be unit-tested without booting
 * firebase-admin or hitting the network. Same extraction pattern as
 * rateLimit.ts / reconciliation.ts / redact.ts.
 *
 * 위조된 웹훅으로 구독 상태를 조작하는 것을 막는다. 서명은 반드시 원본
 * 바이트(req.rawBody)에 대해 계산해야 한다 — JSON.parse 후 재직렬화하면
 * 키 순서/공백이 달라져 HMAC 이 깨진다. 비교는 timing-safe 하게 한다.
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

/**
 * Toss 웹훅 서명 검증. 백엔드(payment_service.verify_webhook)와 동일 스킴:
 * HMAC-SHA256(secret, `${timestamp}.${rawBody}`) hex, 헤더
 * x-toss-webhook-signature / x-toss-webhook-timestamp.
 *
 * secret / signature / timestamp / rawBody 중 하나라도 비면 즉시 거부(false).
 */
export function verifyTossWebhook(
  signature: string,
  timestamp: string,
  rawBody: Buffer | undefined,
  secret: string,
): boolean {
  if (!secret || !signature || !timestamp || !rawBody) return false;
  const message = `${timestamp}.${rawBody.toString("utf8")}`;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(message)
    .digest("hex");
  return timingSafeEqualHex(signature, expected);
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
