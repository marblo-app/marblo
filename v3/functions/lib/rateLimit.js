"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.COUPON_RULES_IP = exports.COUPON_RULES_UID = void 0;
exports.enforce = enforce;
exports.extractIp = extractIp;
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
const admin = __importStar(require("firebase-admin"));
// Lazy — admin.firestore() must NOT run at module load. index.ts imports this
// module (which executes it) before it calls admin.initializeApp(), so a
// top-level admin.firestore() throws app/no-app and, under firebase-functions
// v5 source discovery, fails analysis for the ENTIRE codebase (blocking every
// function deploy). Resolve on first use instead.
let _db = null;
const db = () => (_db ?? (_db = admin.firestore()));
const COLLECTION = "rate_limits";
/**
 * Check + atomically record an attempt against a key.
 * Returns whether the call should proceed. When `allowed=false`, the
 * caller should throw `resource-exhausted` (HTTP 429-equivalent).
 *
 * Pass multiple rules to enforce them jointly: ALL must pass.
 */
async function enforce(key, rules) {
    if (!rules.length)
        return { allowed: true, remaining: Infinity, retryAfter: 0 };
    const docRef = db().collection(COLLECTION).doc(key);
    const nowMs = Date.now();
    const maxWindowMs = Math.max(...rules.map((r) => r.windowSeconds)) * 1000;
    return db().runTransaction(async (tx) => {
        const snap = await tx.get(docRef);
        const existing = snap.data()?.attempts ?? [];
        // Drop entries older than the longest window — bounds storage.
        const trimmed = existing.filter((t) => nowMs - t < maxWindowMs);
        // Each rule independently: count attempts within its own window.
        let worstRemaining = Infinity;
        let earliestInWindow = nowMs;
        for (const rule of rules) {
            const windowMs = rule.windowSeconds * 1000;
            const inWindow = trimmed.filter((t) => nowMs - t < windowMs);
            const remaining = rule.max - inWindow.length;
            if (remaining < worstRemaining)
                worstRemaining = remaining;
            if (remaining <= 0) {
                // Record the attempt anyway so the window doesn't slide forward
                // when an attacker keeps banging the door. Caller will reject.
                trimmed.push(nowMs);
                tx.set(docRef, { attempts: trimmed, updatedAt: nowMs }, { merge: true });
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
function extractIp(rawRequest) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const req = rawRequest;
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
exports.COUPON_RULES_UID = [
    { windowSeconds: 60, max: 5 },
    { windowSeconds: 300, max: 30 },
];
exports.COUPON_RULES_IP = [
    { windowSeconds: 60, max: 20 },
    { windowSeconds: 600, max: 100 },
];
//# sourceMappingURL=rateLimit.js.map