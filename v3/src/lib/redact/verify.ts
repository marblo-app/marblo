/**
 * Second-pass verifier (§5.2 P4, §5.7 F2). Scans the FINAL serialized
 * payload — the exact bytes that would be published — with detectors that
 * are INDEPENDENT from and strictly BROADER than the first-pass ruleset.
 *
 * ★F2: nothing here imports first-pass rule regexes from patterns.ts or
 * helpers from redact.ts/entropy.ts. A hole in the first-pass ruleset must
 * not be a hole here too (correlated failure). The only shared import is
 * BIP39_WORDS — canonical standard DATA, not detection logic; the mnemonic
 * detection algorithm itself is different on each side (strict consecutive
 * run in pass 1, tolerant sliding window here).
 *
 * A single finding aborts publication. Findings carry detector + offset +
 * length only — never the matched text (★F7).
 */

import type { VerifyFinding, VerifyResult } from "../../types/redact";
import { BIP39_WORDS } from "./patterns";

// ---------------------------------------------------------------------------
// Aggressive thresholds — intentionally stricter than pass 1 (len 20 vs 24,
// 3.3 bits/char vs 3.5).
// ---------------------------------------------------------------------------

const V_ENTROPY_THRESHOLD = 3.3;
const V_ENTROPY_MIN_LENGTH = 20;

/** Placeholders / aliases the first pass legitimately emits. */
const PLACEHOLDER =
  /^(<[A-Z_]+>|<workspace>(\/.*)?|<worktree>(\/.*)?|(member|agent|T)-\d+)$/;

// Broad key-prefix superset. Tails are looser (8+) than pass 1 (16+) on
// purpose — a truncated or lightly mangled key still trips the verifier.
const V_KNOWN_PREFIX =
  /\b(?:sk-[A-Za-z0-9]{0,10}-?|sk_(?:live|test)_|[rp]k_live_|AIza|ya29\.|xai-|gh[pousr]_|github_pat_|glpat-|xox[baprs]-|AKIA|ASIA|hf_|nvapi-|pplx-|r8_|dop_v1_|doo_v1_|SG\.|gsk_|npm_|pypi-AgE|whsec_|shp(?:at|ca|pa|ss)_|sq0(?:atp|csp)-|figd_|lin_api_|tvly-|sntrys_|ntn_|glc_|dckr_pat_|rnd_|vercel_|cda_|flyv1_|fly_api|pat-na\d-|secret_|EAA[A-Z]|AGE-SECRET-KEY-1|key-[a-f0-9]{8})[A-Za-z0-9_\-+/=.]{8,}|hooks\.slack\.com\/services\/[A-Za-z0-9/_-]{8,}/g;

const V_JWT = /\beyJ[A-Za-z0-9_-]{8,}\./g;
const V_PEM = /BEGIN[ A-Z]{0,24}PRIVATE KEY/g;
const V_CONN = /[a-z][a-z0-9+]{1,19}:\/\/[^\s/@"']{1,64}:[^\s@"']{1,64}@/gi;
const V_EMAIL = /[A-Za-z0-9._%+-]{1,64}@[A-Za-z0-9.-]{1,253}\.[A-Za-z]{2,}/g;
const V_PHONE_KR = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const V_PHONE_INTL = /\+\d[\d().\s-]{8,}\d/g;
const V_HOME_PATH =
  /(?:^|[\s"'`:=(,[])\/(?:Users|home|root|private\/var|var\/folders|etc|opt)\/[^\s"'`]+|[A-Za-z]:\\+Users\\+[^\s"'`]+/g;
const V_PRIVATE_IP =
  /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g;
const V_INFRA =
  /\b(?:gs|s3):\/\/[a-z0-9._-]+|\b[a-z0-9-]+\.iam\.gserviceaccount\.com\b|\b[a-z0-9.-]+\.(?:internal|svc\.cluster\.local)\b/gi;

/**
 * Generic secret-assignment shape: `<secret-ish name> [:=] <value>`.
 * Catches key/value pairs whose NAME leaks intent even when the value
 * matches no known shape. Placeholder values are exempt.
 */
const V_ASSIGNMENT =
  /(key|token|secret|passw(?:or)?d|credential|passphrase|bearer|auth)["'`]{0,2}\s*[:=]\s*["'`]?((?=[^\s"'`,;{}[\]]*[A-Za-z])[^\s"'`,;{}[\]]{8,})/gi;

// ---------------------------------------------------------------------------
// Independent entropy implementation
// ---------------------------------------------------------------------------

function vShannon(token: string): number {
  const counts = new Map<string, number>();
  for (const ch of token) counts.set(ch, (counts.get(ch) ?? 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / token.length;
    h -= p * Math.log2(p);
  }
  return h;
}

const V_TOKEN = /[A-Za-z0-9_\-+/=]{20,}/g;
const V_GIT_SHA = /^[0-9a-f]{40}$/;
const V_SHA256_LABELED = /^sha256:[0-9a-f]{64}$/i;

function vTokenIsHot(token: string): boolean {
  if (V_GIT_SHA.test(token)) return false;
  if (V_SHA256_LABELED.test(token)) return false;
  if (token.length < V_ENTROPY_MIN_LENGTH) return false;
  if (!/[0-9]/.test(token) || !/[A-Za-z]/.test(token)) return false;
  // Repo-relative path shapes (L2 legitimately publishes them): 3+ short
  // slash segments and no base64 markers. Independent from — and slightly
  // stricter than — the first pass's path exemption.
  if (!/[+=]/.test(token)) {
    const segments = token.split("/");
    if (segments.length >= 3 && segments.every((s) => s.length <= 12)) {
      return false;
    }
  }
  return vShannon(token) >= V_ENTROPY_THRESHOLD;
}

function vDecodeBase64(token: string): string | null {
  if (token.length < 20) return null;
  const norm = token.replace(/-/g, "+").replace(/_/g, "/");
  try {
    if (typeof Buffer === "undefined") return null;
    const raw = Buffer.from(norm, "base64").toString("utf8");
    if (raw.length < 12) return null;
    let printable = 0;
    for (const ch of raw) {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x20 && code < 0x7f) || code === 0x0a || code === 0x09) {
        printable += 1;
      }
    }
    return printable / raw.length >= 0.85 ? raw : null;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Independent mnemonic detection: tolerant sliding window (vs pass 1's
// strict consecutive run) — one decoy word inserted into a seed phrase
// does not evade this side.
// ---------------------------------------------------------------------------

const V_MNEMONIC_WINDOW = 12;
const V_MNEMONIC_MIN_HITS = 11;

function vHasMnemonicWindow(text: string): boolean {
  const spaced = text.replace(/([a-z])([A-Z])/g, "$1 $2");
  const words = spaced.toLowerCase().match(/[a-z]{3,}/g);
  if (!words || words.length < V_MNEMONIC_WINDOW) return false;
  const hits = words.map((w) => (BIP39_WORDS.has(w) ? 1 : 0));
  let windowSum = 0;
  for (let i = 0; i < words.length; i += 1) {
    windowSum += hits[i];
    if (i >= V_MNEMONIC_WINDOW) windowSum -= hits[i - V_MNEMONIC_WINDOW];
    if (i >= V_MNEMONIC_WINDOW - 1 && windowSum >= V_MNEMONIC_MIN_HITS) {
      return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Normalization (independent, minimal)
// ---------------------------------------------------------------------------

// eslint-disable-next-line no-irregular-whitespace -- intentional: matches zero-width evasion chars, not real whitespace
const V_ZERO_WIDTH = /[​-‍⁠﻿]/g;
const V_CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ѕ: "s",
  к: "k",
  м: "m",
  т: "t",
  А: "A",
  В: "B",
  Е: "E",
  К: "K",
  М: "M",
  Н: "H",
  О: "O",
  Р: "P",
  С: "C",
  Т: "T",
  Х: "X",
  α: "a",
  ε: "e",
  ι: "i",
  κ: "k",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
};

function vFold(s: string): string {
  const n = s.normalize("NFKC").replace(V_ZERO_WIDTH, "");
  return Array.from(n, (ch) => V_CONFUSABLES[ch] ?? ch).join("");
}

function vUrlDecode(s: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return null;
  try {
    let d = decodeURIComponent(s);
    if (/%[0-9A-Fa-f]{2}/.test(d)) {
      try {
        d = decodeURIComponent(d);
      } catch {
        /* single round */
      }
    }
    return d === s ? null : d;
  } catch {
    return null;
  }
}

/** Strip JSON escape sequences so split secrets rejoin (\n, \t, \\, \"). */
function vStripEscapes(s: string): string {
  return s.replace(/\\[ntr"'`\\/u]/g, "");
}

// ---------------------------------------------------------------------------
// Scan driver
// ---------------------------------------------------------------------------

interface Hit {
  detector: string;
  offset: number;
  length: number;
}

function scanChunk(
  text: string,
  baseOffset: number,
  hits: Hit[],
  opts: { structuralOnly: boolean },
): void {
  const push = (detector: string, index: number, length: number) => {
    hits.push({ detector, offset: baseOffset + index, length });
  };
  const runRegex = (detector: string, re: RegExp) => {
    re.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = re.exec(text)) !== null) {
      push(detector, m.index, m[0].length);
      if (m[0].length === 0) re.lastIndex += 1;
    }
  };

  runRegex("v-known-prefix", V_KNOWN_PREFIX);
  runRegex("v-jwt", V_JWT);
  runRegex("v-pem", V_PEM);
  runRegex("v-conn", V_CONN);

  V_ASSIGNMENT.lastIndex = 0;
  let am: RegExpExecArray | null;
  while ((am = V_ASSIGNMENT.exec(text)) !== null) {
    if (!PLACEHOLDER.test(am[2])) {
      push("v-assignment", am.index, am[0].length);
    }
  }

  if (opts.structuralOnly) return;

  runRegex("v-email", V_EMAIL);
  runRegex("v-phone", V_PHONE_KR);
  runRegex("v-phone", V_PHONE_INTL);
  runRegex("v-home-path", V_HOME_PATH);
  runRegex("v-private-ip", V_PRIVATE_IP);
  runRegex("v-infra", V_INFRA);

  V_TOKEN.lastIndex = 0;
  let tm: RegExpExecArray | null;
  while ((tm = V_TOKEN.exec(text)) !== null) {
    if (vTokenIsHot(tm[0])) {
      push("v-entropy", tm.index, tm[0].length);
      continue;
    }
    const decoded = vDecodeBase64(tm[0]);
    if (decoded !== null) {
      const inner: Hit[] = [];
      scanChunk(decoded, 0, inner, { structuralOnly: false });
      if (inner.length > 0) {
        push("v-base64", tm.index, tm[0].length);
      }
    }
  }

  if (vHasMnemonicWindow(text)) {
    push("v-mnemonic", 0, Math.min(text.length, 1));
  }
}

/**
 * Verify a serialized payload. `ok: false` ⇒ ABORT publication (§5.2 P4).
 *
 * The text is scanned raw, unicode-folded, URL-decoded, and with JSON
 * escapes / whitespace stripped (structural detectors only on the
 * boundary-destroying variants).
 */
export function verifyRedacted(serialized: string): VerifyResult {
  const hits: Hit[] = [];

  scanChunk(serialized, 0, hits, { structuralOnly: false });

  const folded = vFold(serialized);
  if (folded !== serialized) {
    scanChunk(folded, 0, hits, { structuralOnly: false });
  }

  const urlDecoded = vUrlDecode(serialized);
  if (urlDecoded !== null) {
    scanChunk(vFold(urlDecoded), 0, hits, { structuralOnly: false });
  }

  const unescaped = vStripEscapes(serialized);
  if (unescaped !== serialized) {
    scanChunk(vFold(unescaped), 0, hits, { structuralOnly: true });
  }

  const noWhitespace = serialized.replace(/\s+/g, "");
  if (noWhitespace !== serialized) {
    scanChunk(vFold(vStripEscapes(noWhitespace)), 0, hits, {
      structuralOnly: true,
    });
  }

  // Dedupe on (detector, offset) so overlapping variants don't spam.
  const seen = new Set<string>();
  const findings: VerifyFinding[] = [];
  for (const h of hits) {
    const k = `${h.detector}:${h.offset}:${h.length}`;
    if (seen.has(k)) continue;
    seen.add(k);
    findings.push({ detector: h.detector, offset: h.offset, length: h.length });
  }
  return { ok: findings.length === 0, findings };
}
