/**
 * Rate limiter — the judgement, with **no Firestore and no dependencies.**
 *
 * `rateLimit.ts` is the Firestore transaction around this: it reads the
 * attempt list for a key, calls `decide()`, and writes the result back. It
 * makes no judgement of its own, so what this file says is what ships.
 *
 * ★Why this is a separate file: `rateLimit.ts` imports `firebase-admin`, so a
 * test that imports it needs an installed SDK (and, in CI, an emulator). The
 * budgets we ship — how many token mints per hour a compromised account gets
 * — are exactly the thing that must be provable by a plain `node --test` run.
 * Same split as `githubApp.ts` (pure) ↔ `index.ts` (wired).
 */

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

export interface RateDecision extends RateCheck {
  /** The attempt list to persist (trimmed + this attempt). */
  attempts: number[];
}

/**
 * Check one attempt against a rule set, given the attempts already recorded.
 *
 * Multiple rules are enforced jointly: ALL must pass. A blocked attempt is
 * still appended — otherwise the window slides forward for an attacker who
 * keeps banging the door.
 */
export function decide(
  existing: number[],
  rules: RateRule[],
  nowMs: number
): RateDecision {
  if (!rules.length) {
    return {
      allowed: true,
      remaining: Infinity,
      retryAfter: 0,
      attempts: [...existing, nowMs],
    };
  }
  const maxWindowMs = Math.max(...rules.map((r) => r.windowSeconds)) * 1000;
  // Drop entries older than the longest window — bounds storage.
  const trimmed = existing.filter((t) => nowMs - t < maxWindowMs);

  // Each rule independently: count attempts within its own window.
  let worstRemaining = Infinity;
  for (const rule of rules) {
    const windowMs = rule.windowSeconds * 1000;
    const inWindow = trimmed.filter((t) => nowMs - t < windowMs);
    const remaining = rule.max - inWindow.length;
    if (remaining < worstRemaining) worstRemaining = remaining;
    if (remaining <= 0) {
      // retryAfter = when the oldest in-window slot expires.
      const oldest = inWindow[0] ?? nowMs;
      const retryAfterSec = Math.ceil((oldest + windowMs - nowMs) / 1000);
      return {
        allowed: false,
        remaining: 0,
        retryAfter: Math.max(1, retryAfterSec),
        attempts: [...trimmed, nowMs],
      };
    }
  }

  return {
    allowed: true,
    remaining: Math.max(0, worstRemaining - 1),
    retryAfter: 0,
    attempts: [...trimmed, nowMs],
  };
}
