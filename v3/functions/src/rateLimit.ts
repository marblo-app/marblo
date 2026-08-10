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
 */
import * as admin from "firebase-admin";

// Lazy — admin.firestore() must NOT run at module load. index.ts imports this
// module (which executes it) before it calls admin.initializeApp(), so a
// top-level admin.firestore() throws app/no-app and, under firebase-functions
// v5 source discovery, fails analysis for the ENTIRE codebase (blocking every
// function deploy). Resolve on first use instead.
let _db: admin.firestore.Firestore | null = null;
const db = (): admin.firestore.Firestore => (_db ??= admin.firestore());
const COLLECTION = "rate_limits";

export interface RateRule {
  /** Window in seconds. Older attempts dropped. */
  windowSeconds: number;
  /** Max attempts allowed in the window. The N+1th is rejected. */
  max: number;
}

export interface RateCheck {
  allowed: boolean;
  /** Attempts remaining inside the window (0 when blocked). */
  remaining: number;
  /** Epoch seconds until the oldest in-window attempt expires. */
  retryAfter: number;
}

/**
 * Check + atomically record an attempt against a key.
 * Returns whether the call should proceed. When `allowed=false`, the
 * caller should throw `resource-exhausted` (HTTP 429-equivalent).
 *
 * Pass multiple rules to enforce them jointly: ALL must pass.
 */
export async function enforce(
  key: string,
  rules: RateRule[]
): Promise<RateCheck> {
  if (!rules.length)
    return { allowed: true, remaining: Infinity, retryAfter: 0 };
  const docRef = db().collection(COLLECTION).doc(key);
  const nowMs = Date.now();
  const maxWindowMs = Math.max(...rules.map((r) => r.windowSeconds)) * 1000;

  return db().runTransaction(async (tx) => {
    const snap = await tx.get(docRef);
    const existing = (snap.data()?.attempts as number[] | undefined) ?? [];
    // Drop entries older than the longest window — bounds storage.
    const trimmed = existing.filter((t) => nowMs - t < maxWindowMs);

    // Each rule independently: count attempts within its own window.
    let worstRemaining = Infinity;
    let earliestInWindow = nowMs;
    for (const rule of rules) {
      const windowMs = rule.windowSeconds * 1000;
      const inWindow = trimmed.filter((t) => nowMs - t < windowMs);
      const remaining = rule.max - inWindow.length;
      if (remaining < worstRemaining) worstRemaining = remaining;
      if (remaining <= 0) {
        // Record the attempt anyway so the window doesn't slide forward
        // when an attacker keeps banging the door. Caller will reject.
        trimmed.push(nowMs);
        tx.set(
          docRef,
          { attempts: trimmed, updatedAt: nowMs },
          { merge: true }
        );
        // retryAfter = when the oldest in-window slot expires
        const oldest = inWindow[0] ?? nowMs;
        const retryAfterSec = Math.ceil((oldest + windowMs - nowMs) / 1000);
        return {
          allowed: false,
          remaining: 0,
          retryAfter: Math.max(1, retryAfterSec),
        };
      }
      if (inWindow.length > 0 && inWindow[0] < earliestInWindow) {
        earliestInWindow = inWindow[0];
      }
    }

    // All rules passed — record this attempt and let caller proceed.
    trimmed.push(nowMs);
    tx.set(docRef, { attempts: trimmed, updatedAt: nowMs }, { merge: true });
    return {
      allowed: true,
      remaining: Math.max(0, worstRemaining - 1),
      retryAfter: 0,
    };
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
