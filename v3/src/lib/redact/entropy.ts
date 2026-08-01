/**
 * R8 — high-entropy token detection (§5.5). Catches keys from vendors we
 * don't know yet (the prefix table R3 can never be complete — new vendors
 * keep landing: claude/gpt/grok/glm/kimi/minimax/local/…).
 *
 * Scoring is PER TOKEN after splitting on whitespace/delimiters — never a
 * field average. Averaging is exactly what a dilution attack exploits
 * (secret surrounded by dictionary words drags the mean under threshold).
 */

/**
 * ★ Security-review-gated constant (§5.5): LOWERING this threshold is free;
 * RAISING it (= detecting less) requires a security review.
 *
 * NOTE the direction: higher threshold ⇒ fewer tokens flagged ⇒ more misses.
 */
export const ENTROPY_THRESHOLD_BITS_PER_CHAR = 3.5;

/** Minimum candidate token length (§5.5: 24). */
export const ENTROPY_MIN_TOKEN_LENGTH = 24;

/** Candidate token shape (§5.5): base64/hex-ish runs. */
const CANDIDATE_TOKEN = /[A-Za-z0-9_\-+/=]{24,}/g;

const GIT_SHA_40 = /^[0-9a-f]{40}$/;
const SHA256_LABELED = /^sha256:[0-9a-f]{64}$/i;
const DATA_URI_PREFIX = /^data:/i;

/** Shannon entropy in bits per character over the token's own alphabet. */
export function shannonEntropyBitsPerChar(token: string): number {
  if (token.length === 0) return 0;
  const freq = new Map<string, number>();
  for (const ch of token) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let h = 0;
  const n = token.length;
  for (const count of freq.values()) {
    const p = count / n;
    h -= p * Math.log2(p);
  }
  return h;
}

function hasDigit(token: string): boolean {
  return /[0-9]/.test(token);
}

function hasLetter(token: string): boolean {
  return /[A-Za-z]/.test(token);
}

export type EntropyVerdict = "secret" | "gitSha" | "dataUri" | "clean";

/**
 * Judge a single candidate token (§5.5 판정):
 *   H ≥ threshold AND digit+letter mix → "secret" (DROP the item)
 *   git SHA (40 hex)                   → "gitSha" (pass, labeled)
 *   data: URI                          → "dataUri" (caller drops for other reasons)
 *   sha256:-labeled digest             → clean (known constant)
 */
/**
 * Slash-separated path shapes ("marblo/worktrees/Proj1/Task2") are §5.5's
 * "known constants" class: every segment is short, so they are not random
 * key material even though the joined run is long. Random base64 that
 * merely CONTAINS a slash almost never splits into all-short segments.
 */
function isPathLikeToken(token: string): boolean {
  const segments = token.split("/");
  if (segments.length < 3) return false;
  return segments.every((seg) => seg.length <= 12);
}

export function judgeToken(
  token: string,
  threshold: number = ENTROPY_THRESHOLD_BITS_PER_CHAR,
): EntropyVerdict {
  if (DATA_URI_PREFIX.test(token)) return "dataUri";
  if (GIT_SHA_40.test(token)) return "gitSha";
  if (SHA256_LABELED.test(token)) return "clean";
  if (isPathLikeToken(token)) return "clean";
  if (token.length < ENTROPY_MIN_TOKEN_LENGTH) return "clean";
  if (!hasDigit(token) || !hasLetter(token)) return "clean";
  if (shannonEntropyBitsPerChar(token) >= threshold) return "secret";
  return "clean";
}

/**
 * True when the string contains at least one token judged "secret".
 * Tokens are extracted per §5.5 (contiguous base64/hex-ish runs), which is
 * equivalent to splitting on whitespace/delimiters — each run is scored
 * individually, so surrounding prose cannot dilute a hot token.
 */
export function containsHighEntropyToken(
  value: string,
  threshold: number = ENTROPY_THRESHOLD_BITS_PER_CHAR,
): boolean {
  // data: URIs are dropped wholesale by the caller; still treat as hot here
  // so a lone entropy check also refuses them.
  if (DATA_URI_PREFIX.test(value.trim())) return true;
  CANDIDATE_TOKEN.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CANDIDATE_TOKEN.exec(value)) !== null) {
    if (judgeToken(m[0], threshold) === "secret") return true;
  }
  return false;
}
