/**
 * Server-side rate limiter — Firestore-backed sliding window.
 *
 * Stops brute-force coupon guessing (P0-10) and any other endpoint we
 * later wire through `enforce()`. Each key tracks a rolling list of
 * attempt timestamps; we trim entries older than the window on every
 * check, so storage stays bounded at ~max entries per key.
 *
 * Atomicity: Firestore transaction read-modify-write so two concurrent
 * callers can't both squeeze through the last allowed slot.
 *
 * The judgement itself lives in `rateLimitCore.ts` — dependency-free so the
 * shipped budgets are provable by `node --test` without an emulator.
 */
import * as admin from "firebase-admin";
import { decide, type RateCheck, type RateRule } from "./rateLimitCore";

// Lazy — admin.firestore() must NOT run at module load. index.ts imports this
// module (which executes it) before it calls admin.initializeApp(), so a
// top-level admin.firestore() throws app/no-app and, under firebase-functions
// v5 source discovery, fails analysis for the ENTIRE codebase (blocking every
// function deploy). Resolve on first use instead.
let _db: admin.firestore.Firestore | null = null;
const db = (): admin.firestore.Firestore => (_db ??= admin.firestore());
const COLLECTION = "rate_limits";

export { decide } from "./rateLimitCore";
export type { RateRule, RateCheck, RateDecision } from "./rateLimitCore";

/**
 * Check + atomically record an attempt against a key.
 * Returns whether the call should proceed. When `allowed=false`, the
 * caller should throw `resource-exhausted` (HTTP 429-equivalent).
 *
 * Pass multiple rules to enforce them jointly: ALL must pass.
 *
 * ★Two callers that must NOT share a budget must pass **different keys** —
 * one key is one attempt list, so same key + different rules means the two
 * budgets eat the same array. (See `installationTokenRateKey` in
 * `githubApp.ts`, which encodes the access level into the key for exactly
 * this reason.)
 */
export async function enforce(
  key: string,
  rules: RateRule[]
): Promise<RateCheck> {
  if (!rules.length)
    return { allowed: true, remaining: Infinity, retryAfter: 0 };
  const docRef = db().collection(COLLECTION).doc(key);
  const nowMs = Date.now();

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const existing = (snap.data()?.attempts as number[] | undefined) ?? [];
    const { attempts, ...check } = decide(existing, rules, nowMs);
    tx.set(docRef, { attempts, updatedAt: nowMs }, { merge: true });
    return check;
  });
}

/**
 * Best-effort client-IP extraction from a callable function's raw request.
 * Falls back to "unknown" so callers can still group anonymous traffic.
 *
 * Cloud Functions for Firebase puts the client IP behind GFE, so the
 * canonical source is `x-forwarded-for` first hop. `req.ip` is the GFE
 * loopback, useless for rate limiting.
 */
export function extractIp(rawRequest: unknown): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const req = rawRequest as any;
  const xff = req?.headers?.["x-forwarded-for"];
  if (typeof xff === "string" && xff.length > 0) {
    return xff.split(",")[0].trim();
  }
  if (Array.isArray(xff) && xff.length > 0) {
    return String(xff[0]).split(",")[0].trim();
  }
  return typeof req?.ip === "string" ? req.ip : "unknown";
}

/** Coupon-specific limits: per-uid 5/min + 30/5min, per-ip 20/min + 100/10min. */
export const COUPON_RULES_UID: RateRule[] = [
  { windowSeconds: 60, max: 5 },
  { windowSeconds: 300, max: 30 },
];
export const COUPON_RULES_IP: RateRule[] = [
  { windowSeconds: 60, max: 20 },
  { windowSeconds: 600, max: 100 },
];

/**
 * 설치 어트리뷰션 링크백(`linkInstallAttribution`) 한도 — 미인증 엔드포인트라
 * IP 만으로 막는다. 정상 사용자는 설치당 1회만 호출하므로 한도는 넉넉히 낮다.
 * 공유 NAT(사무실/학교)에서 여러 명이 같은 날 설치하는 경우를 감안해 분당 10,
 * 10분당 40 으로 둔다.
 */
export const ATTRIBUTION_RULES_IP: RateRule[] = [
  { windowSeconds: 60, max: 10 },
  { windowSeconds: 600, max: 40 },
];

/**
 * 로그인 전 익명 텔레메트리 한도. 정상 첫 실행/데모/로그인 실패 퍼널은 설치당
 * 한 자릿수 이벤트라 낮게 잡는다. IP 는 공유 NAT 를 감안하고, clientId 는
 * 재시도 루프/스크립트 남용을 좁게 막는다.
 */
export const ANONYMOUS_TELEMETRY_RULES_IP: RateRule[] = [
  { windowSeconds: 60, max: 30 },
  { windowSeconds: 600, max: 120 },
];

export const ANONYMOUS_TELEMETRY_RULES_CLIENT: RateRule[] = [
  { windowSeconds: 60, max: 12 },
  { windowSeconds: 600, max: 40 },
];
