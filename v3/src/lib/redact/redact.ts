/**
 * First-pass redaction engine (§5.2~§5.5). Feature-agnostic pure function:
 * arbitrary structured object in → de-identified object out. No firebase,
 * no react, no I/O.
 *
 * Invariants:
 *  - ★F3: every string that survives into the output — values AND keys —
 *    passes the single scanner chokepoint (`scanString`). There is no
 *    "structured so it's safe" bypass.
 *  - Rule order (§5.4): R7 key names → R3~R6 structural secrets → R17
 *    mnemonic → R8 entropy → R1/R1b/R1c paths → R2 PII → R12 infra →
 *    level filters. Secrets are detected BEFORE path masking mutates the
 *    string (masking first would break key patterns → miss).
 *  - P2: ambiguous ⇒ mask; unmaskable ⇒ drop. A maskable pattern that is
 *    only detectable in a decoded/normalized variant cannot be masked in
 *    place, so the item is dropped.
 *  - ★F7: findings carry rule + path only, never the offending value.
 */

import type {
  RedactFinding,
  RedactOptions,
  RedactResult,
  RedactRuleId,
  PublishGuardResult,
} from "../../types/redact";
import {
  BIP39_WORDS,
  CREDENTIAL_URL,
  EMAIL,
  HOME_PATH,
  JWT,
  KNOWN_KEY_PATTERNS,
  MNEMONIC_MIN_RUN,
  PEM_PRIVATE_KEY,
  PHONE_INTL,
  PHONE_KR,
  RESIDUAL_ABS_PATH,
  SECRET_KEY_NAME,
  SECRET_KEY_NAME_EXTENDED,
  TICKET_REF,
  URL_BASIC_AUTH,
  WORKTREE_PATH,
  INFRA_PATTERNS,
} from "./patterns";
import { containsHighEntropyToken } from "./entropy";
import { classifyField, decideForLevel } from "./rules";
import { verifyRedacted } from "./verify";

const MAX_DEPTH = 12;

// ---------------------------------------------------------------------------
// Normalization variants (escape/evasion hardening — §5.6 test 2)
// ---------------------------------------------------------------------------

/** Zero-width characters used to split tokens invisibly. */
const ZERO_WIDTH = /[​-‍⁠﻿]/g;

/** Common Cyrillic/Greek homoglyphs folded to ASCII (after NFKC). */
const CONFUSABLES: Record<string, string> = {
  а: "a",
  е: "e",
  о: "o",
  р: "p",
  с: "c",
  у: "y",
  х: "x",
  і: "i",
  ј: "j",
  ѕ: "s",
  к: "k",
  м: "m",
  т: "t",
  в: "b",
  н: "h",
  ԁ: "d",
  ɡ: "g",
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
  Ѕ: "S",
  І: "I",
  Ј: "J",
  α: "a",
  β: "b",
  ε: "e",
  ι: "i",
  κ: "k",
  ο: "o",
  ρ: "p",
  τ: "t",
  υ: "u",
  χ: "x",
  γ: "y",
  ν: "v",
  Α: "A",
  Β: "B",
  Ε: "E",
  Ζ: "Z",
  Η: "H",
  Ι: "I",
  Κ: "K",
  Μ: "M",
  Ν: "N",
  Ο: "O",
  Ρ: "P",
  Τ: "T",
  Υ: "Y",
  Χ: "X",
};

function foldConfusables(s: string): string {
  let out = s.normalize("NFKC").replace(ZERO_WIDTH, "");
  let changed = false;
  for (const ch of out) {
    if (CONFUSABLES[ch] !== undefined) {
      changed = true;
      break;
    }
  }
  if (changed) {
    out = Array.from(out, (ch) => CONFUSABLES[ch] ?? ch).join("");
  }
  return out;
}

function tryUrlDecode(s: string): string | null {
  if (!/%[0-9A-Fa-f]{2}/.test(s)) return null;
  try {
    let decoded = decodeURIComponent(s.replace(/\+/g, " "));
    // second round for double-encoding
    if (/%[0-9A-Fa-f]{2}/.test(decoded)) {
      try {
        decoded = decodeURIComponent(decoded);
      } catch {
        /* keep first round */
      }
    }
    return decoded === s ? null : decoded;
  } catch {
    return null;
  }
}

/**
 * Variants that PRESERVE word boundaries — safe for every detector
 * including entropy and mnemonic.
 */
function boundaryPreservingVariants(s: string): string[] {
  const out = [s];
  const folded = foldConfusables(s);
  if (folded !== s) out.push(folded);
  const url = tryUrlDecode(s);
  if (url !== null) {
    out.push(url);
    const urlFolded = foldConfusables(url);
    if (urlFolded !== url) out.push(urlFolded);
  }
  return out;
}

/**
 * Variants that DESTROY word boundaries (whitespace/backslash stripping,
 * used to catch secrets split by newlines or escapes). Only structural
 * detectors run on these — entropy over joined prose is a false-positive
 * machine.
 */
function boundaryDestroyingVariants(s: string): string[] {
  const out: string[] = [];
  const stripped = s.replace(/\s+/g, "");
  if (stripped !== s) out.push(foldConfusables(stripped));
  const noBackslash = s.replace(/\\+/g, "");
  if (noBackslash !== s) {
    out.push(noBackslash);
    const both = noBackslash.replace(/\s+/g, "");
    if (both !== noBackslash) out.push(both);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Detectors (first pass)
// ---------------------------------------------------------------------------

function matchesAny(s: string, patterns: readonly RegExp[]): boolean {
  for (const re of patterns) {
    re.lastIndex = 0;
    if (re.test(s)) return true;
  }
  return false;
}

/** R3~R6 — structural secret shapes (safe on boundary-destroyed text). */
function hitsStructuralSecret(s: string): RedactRuleId | null {
  if (matchesAny(s, KNOWN_KEY_PATTERNS)) return "R3";
  JWT.lastIndex = 0;
  if (JWT.test(s)) return "R4";
  PEM_PRIVATE_KEY.lastIndex = 0;
  if (PEM_PRIVATE_KEY.test(s)) return "R5";
  CREDENTIAL_URL.lastIndex = 0;
  if (CREDENTIAL_URL.test(s)) return "R6";
  URL_BASIC_AUTH.lastIndex = 0;
  if (URL_BASIC_AUTH.test(s)) return "R6";
  return null;
}

/** R17 — BIP39 mnemonic run (§5.7 F1). camelCase is split before matching. */
function containsMnemonicRun(s: string): boolean {
  const spaced = s.replace(/([a-z])([A-Z])/g, "$1 $2");
  const tokens = spaced.toLowerCase().split(/[^a-z]+/);
  let run = 0;
  for (const t of tokens) {
    if (t.length >= 3 && BIP39_WORDS.has(t)) {
      run += 1;
      if (run >= MNEMONIC_MIN_RUN) return true;
    } else {
      run = 0;
    }
  }
  return false;
}

/** R12 — infrastructure identifiers. */
function hitsInfra(s: string): boolean {
  return matchesAny(s, INFRA_PATTERNS);
}

const BASE64_RUN = /[A-Za-z0-9+/=_-]{20,}/g;

function decodeBase64ish(token: string): string | null {
  const norm = token.replace(/-/g, "+").replace(/_/g, "/");
  if (norm.replace(/=+$/, "").length < 16) return null;
  try {
    let raw: string;
    if (typeof Buffer !== "undefined") {
      raw = Buffer.from(norm, "base64").toString("utf8");
    } else {
      raw = (globalThis as { atob?: (s: string) => string }).atob?.(norm) ?? "";
    }
    if (raw.length < 12) return null;
    let printable = 0;
    for (const ch of raw) {
      const code = ch.codePointAt(0) ?? 0;
      if ((code >= 0x20 && code < 0x7f) || code === 0x0a || code === 0x09) {
        printable += 1;
      }
    }
    if (printable / raw.length < 0.85) return null;
    return raw;
  } catch {
    return null;
  }
}

/**
 * Drop-class detection over a single piece of text.
 * `fullChecks` is false for boundary-destroyed variants (whitespace or
 * backslash stripped): those only get structural secret rules — entropy,
 * mnemonic, and infra detectors over artificially joined words are
 * false-positive machines.
 */
function dropRuleFor(
  text: string,
  fullChecks: boolean,
  base64Depth: number,
): RedactRuleId | null {
  const structural = hitsStructuralSecret(text);
  if (structural) return structural;
  if (fullChecks && containsMnemonicRun(text)) return "R17";
  if (fullChecks && containsHighEntropyToken(text)) return "R8";
  if (fullChecks && hitsInfra(text)) return "R12";
  if (base64Depth > 0) {
    BASE64_RUN.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = BASE64_RUN.exec(text)) !== null) {
      const decoded = decodeBase64ish(m[0]);
      if (decoded !== null) {
        // Anything sensitive inside an encoded blob cannot be masked in
        // place → the whole item is dropped (P2).
        const inner = dropRuleFor(decoded, true, base64Depth - 1);
        if (inner) return inner;
        if (hasMaskablePattern(decoded)) return "R2";
      }
    }
  }
  return null;
}

/** Detection-only check for mask-class patterns (paths + PII). */
function hasMaskablePattern(s: string): boolean {
  WORKTREE_PATH.lastIndex = 0;
  if (WORKTREE_PATH.test(s)) return true;
  HOME_PATH.lastIndex = 0;
  if (HOME_PATH.test(s)) return true;
  EMAIL.lastIndex = 0;
  if (EMAIL.test(s)) return true;
  PHONE_KR.lastIndex = 0;
  if (PHONE_KR.test(s)) return true;
  PHONE_INTL.lastIndex = 0;
  if (PHONE_INTL.test(s)) return true;
  // Absolute-path shapes count as unmaskable too when they only show up in
  // a decoded/normalized variant (R1c semantics).
  if (RESIDUAL_ABS_PATH.test(s.trim())) return true;
  if (ABS_PATH_TOKEN.test(s)) return true;
  return false;
}

/** R1c — token-level residual absolute path (2+ segments or bare root file). */
const ABS_PATH_TOKEN = /(?:^|\s)(\/[^/\s]+\/[^\s]*|[A-Za-z]:\\[^\s]+)/;

// ---------------------------------------------------------------------------
// Redaction context (per-run alias maps)
// ---------------------------------------------------------------------------

interface Ctx {
  opts: RedactOptions;
  findings: RedactFinding[];
  members: Map<string, string>;
  agents: Map<string, string>;
  tickets: Map<string, string>;
  baseTimeMs: number | undefined;
}

function alias(map: Map<string, string>, raw: string, prefix: string): string {
  const existing = map.get(raw);
  if (existing !== undefined) return existing;
  const created = `${prefix}-${map.size + 1}`;
  map.set(raw, created);
  return created;
}

function record(
  ctx: Ctx,
  rule: RedactRuleId,
  action: RedactFinding["action"],
  path: string,
): void {
  ctx.findings.push({ rule, action, path });
}

// ---------------------------------------------------------------------------
// The single string chokepoint (★F3)
// ---------------------------------------------------------------------------

type ScanOutcome =
  | { kind: "drop"; rule: RedactRuleId }
  | { kind: "keep"; value: string };

/**
 * Every string that would be retained in the output goes through here —
 * field values, array elements, and object keys alike.
 */
function scanString(s: string, ctx: Ctx, path: string): ScanOutcome {
  // 1) drop-class rules over boundary-preserving variants (all detectors)
  for (const variant of boundaryPreservingVariants(s)) {
    const rule = dropRuleFor(variant, true, 2);
    if (rule) return { kind: "drop", rule };
  }
  // 2) drop-class structural rules over boundary-destroying variants
  for (const variant of boundaryDestroyingVariants(s)) {
    const rule = dropRuleFor(variant, false, 2);
    if (rule) return { kind: "drop", rule };
  }

  // 3) mask paths on the raw string (worktree BEFORE home — nested shapes)
  let masked = s;
  WORKTREE_PATH.lastIndex = 0;
  if (WORKTREE_PATH.test(masked)) {
    masked = masked.replace(WORKTREE_PATH, "<worktree>");
    record(ctx, "R1b", "MASK", path);
  }
  HOME_PATH.lastIndex = 0;
  if (HOME_PATH.test(masked)) {
    masked = masked.replace(HOME_PATH, "<workspace>");
    record(ctx, "R1", "MASK", path);
  }

  // 4) R1c — residual absolute path → drop, don't guess. Covers both a
  //    whole-string absolute path ("/secret.txt") and embedded path tokens.
  if (RESIDUAL_ABS_PATH.test(masked.trim()) || ABS_PATH_TOKEN.test(masked)) {
    return { kind: "drop", rule: "R1c" };
  }

  // 5) R2 — PII masking
  EMAIL.lastIndex = 0;
  if (EMAIL.test(masked)) {
    masked = masked.replace(EMAIL, "<EMAIL>");
    record(ctx, "R2", "MASK", path);
  }
  PHONE_KR.lastIndex = 0;
  if (PHONE_KR.test(masked)) {
    masked = masked.replace(PHONE_KR, "<PHONE>");
    record(ctx, "R2", "MASK", path);
  }
  PHONE_INTL.lastIndex = 0;
  if (PHONE_INTL.test(masked)) {
    masked = masked.replace(PHONE_INTL, "<PHONE>");
    record(ctx, "R2", "MASK", path);
  }

  // 6) A maskable pattern detectable only in a decoded/normalized variant of
  //    the masked result cannot be masked in place → drop (P2).
  for (const variant of [
    ...boundaryPreservingVariants(masked).slice(1),
    ...boundaryDestroyingVariants(masked),
  ]) {
    if (hasMaskablePattern(variant)) {
      return { kind: "drop", rule: "R2" };
    }
  }

  // 7) R16 — ticket references. #N anonymized below L2; embedded
  //    Firestore-style ids anonymized at every level.
  if (ctx.opts.level === "L1") {
    TICKET_REF.lastIndex = 0;
    if (TICKET_REF.test(masked)) {
      masked = masked.replace(TICKET_REF, (ref) =>
        alias(ctx.tickets, ref, "T"),
      );
      record(ctx, "R16", "ANON", path);
    }
  }
  const idToken =
    /\b(?=[A-Za-z0-9]*\d)(?=[A-Za-z0-9]*[A-Za-z])[A-Za-z0-9]{20}\b/g;
  if (idToken.test(masked)) {
    idToken.lastIndex = 0;
    masked = masked.replace(idToken, (id) => alias(ctx.tickets, id, "T"));
    record(ctx, "R16", "ANON", path);
  }

  return { kind: "keep", value: masked };
}

// ---------------------------------------------------------------------------
// Timestamp support (R15)
// ---------------------------------------------------------------------------

function parseTimestampMs(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value >= 1e12 && value < 4.1e12) return value; // epoch ms
    if (value >= 1e9 && value < 4.1e9) return value * 1000; // epoch s
    return null;
  }
  if (typeof value === "string" && /\d{4}-\d{2}-\d{2}/.test(value)) {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  return null;
}

function collectMinTimestamp(
  value: unknown,
  depth: number,
): number | undefined {
  if (depth > MAX_DEPTH || value === null || typeof value !== "object") {
    return undefined;
  }
  let min: number | undefined;
  const consider = (candidate: number | undefined) => {
    if (candidate !== undefined && (min === undefined || candidate < min)) {
      min = candidate;
    }
  };
  if (Array.isArray(value)) {
    for (const v of value) consider(collectMinTimestamp(v, depth + 1));
    return min;
  }
  for (const [k, v] of Object.entries(value)) {
    if (classifyField(k) === "timestamp") {
      const ms = parseTimestampMs(v);
      if (ms !== null) consider(ms);
    }
    consider(collectMinTimestamp(v, depth + 1));
  }
  return min;
}

function relativize(ms: number, baseMs: number): string {
  const delta = ms - baseMs;
  const sign = delta < 0 ? "-" : "+";
  const abs = Math.abs(delta);
  const hours = Math.floor(abs / 3_600_000);
  const minutes = Math.floor((abs % 3_600_000) / 60_000);
  const hh = String(hours).padStart(2, "0");
  const mm = String(minutes).padStart(2, "0");
  return `${sign}${hh}:${mm}`;
}

// ---------------------------------------------------------------------------
// Recursive walk
// ---------------------------------------------------------------------------

const DROPPED: unique symbol = Symbol("dropped");
type Walked = unknown | typeof DROPPED;

function walkValue(
  value: unknown,
  ctx: Ctx,
  path: string,
  depth: number,
): Walked {
  if (depth > MAX_DEPTH) {
    record(ctx, "DEFAULT_DENY", "DROP", path);
    return DROPPED;
  }
  if (value === null) return null;
  const t = typeof value;
  if (t === "number" || t === "boolean") return value;
  if (t === "string") {
    const outcome = scanString(value as string, ctx, path);
    if (outcome.kind === "drop") {
      record(ctx, outcome.rule, "DROP", path);
      return DROPPED;
    }
    return outcome.value;
  }
  if (Array.isArray(value)) {
    const out: unknown[] = [];
    for (let i = 0; i < value.length; i += 1) {
      const walked = walkValue(value[i], ctx, `${path}[${i}]`, depth + 1);
      if (walked !== DROPPED) out.push(walked);
    }
    return out;
  }
  if (t === "object") {
    return walkObject(value as Record<string, unknown>, ctx, path, depth);
  }
  // functions / symbols / bigints — nothing structured to publish
  record(ctx, "DEFAULT_DENY", "DROP", path);
  return DROPPED;
}

function walkObject(
  obj: Record<string, unknown>,
  ctx: Ctx,
  path: string,
  depth: number,
): Walked {
  const out: Record<string, unknown> = {};
  let keyIndex = -1;
  for (const [key, rawValue] of Object.entries(obj)) {
    keyIndex += 1;
    // ★F3 — keys are strings too. A key that trips any drop-class or
    // maskable rule cannot be safely kept or masked → drop the entry.
    // ★F7 — the raw key must NOT leak into finding paths, so until the key
    // is proven clean it is referenced positionally only.
    const keyLabel =
      path === "" ? `<key#${keyIndex}>` : `${path}.<key#${keyIndex}>`;
    const keyScan = scanString(key, ctx, keyLabel);
    if (keyScan.kind === "drop" || keyScan.value !== key) {
      record(
        ctx,
        keyScan.kind === "drop" ? keyScan.rule : "R2",
        "DROP",
        keyLabel,
      );
      continue;
    }
    const childPath = path === "" ? key : `${path}.${key}`;

    const cls =
      ctx.opts.classifyOverride?.(key, childPath) ?? classifyField(key);

    // R7 — secret-looking key name: mask the value, keep the key.
    if (
      cls === "secretKeyName" ||
      SECRET_KEY_NAME.test(key) ||
      SECRET_KEY_NAME_EXTENDED.test(key)
    ) {
      out[key] = "<REDACTED>";
      record(ctx, "R7", "MASK", childPath);
      continue;
    }

    const decision = decideForLevel(cls, ctx.opts.level, {
      includeCost: ctx.opts.includeCost,
    });

    switch (decision.kind) {
      case "drop": {
        const rule: RedactRuleId =
          cls === "freeText"
            ? "R9"
            : cls === "codeDiff"
              ? "R10"
              : cls === "cost"
                ? "R14"
                : cls === "relativePath"
                  ? "R13"
                  : cls === "repoIdentifier"
                    ? "R11"
                    : "DEFAULT_DENY";
        record(ctx, rule, "DROP", childPath);
        continue;
      }
      case "anonPerson": {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          out[key] = alias(ctx.members, String(rawValue), "member");
          record(ctx, "R2b", "ANON", childPath);
        } else {
          record(ctx, "R2b", "DROP", childPath);
        }
        continue;
      }
      case "anonAgent": {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          out[key] = alias(ctx.agents, String(rawValue), "agent");
          record(ctx, "R2c", "ANON", childPath);
        } else {
          record(ctx, "R2c", "DROP", childPath);
        }
        continue;
      }
      case "anonTicket": {
        if (typeof rawValue === "string" || typeof rawValue === "number") {
          out[key] = alias(ctx.tickets, String(rawValue), "T");
          record(ctx, "R16", "ANON", childPath);
        } else {
          record(ctx, "R16", "DROP", childPath);
        }
        continue;
      }
      case "relativize": {
        const ms = parseTimestampMs(rawValue);
        if (ms === null || ctx.baseTimeMs === undefined) {
          record(ctx, "R15", "DROP", childPath);
          continue;
        }
        out[key] = relativize(ms, ctx.baseTimeMs);
        record(ctx, "R15", "RELATIVIZE", childPath);
        continue;
      }
      case "repoGate": {
        // R11 fail-closed: only a caller-verified public repo URL passes.
        if (
          typeof rawValue === "string" &&
          (ctx.opts.publicRepos ?? []).includes(rawValue)
        ) {
          const scanned = scanString(rawValue, ctx, childPath);
          if (scanned.kind === "keep") {
            out[key] = scanned.value;
          } else {
            record(ctx, scanned.rule, "DROP", childPath);
          }
        } else {
          record(ctx, "R11", "DROP", childPath);
        }
        continue;
      }
      case "pass": {
        const walked = walkValue(rawValue, ctx, childPath, depth + 1);
        if (walked !== DROPPED) out[key] = walked;
        continue;
      }
      default: {
        const _exhaustive: never = decision;
        void _exhaustive;
        record(ctx, "DEFAULT_DENY", "DROP", childPath);
        continue;
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function redact(input: unknown, opts: RedactOptions): RedactResult {
  const ctx: Ctx = {
    opts,
    findings: [],
    members: new Map(),
    agents: new Map(),
    tickets: new Map(),
    baseTimeMs: opts.baseTimeMs ?? collectMinTimestamp(input, 0),
  };
  const walked = walkValue(input, ctx, "", 0);
  return {
    payload: walked === DROPPED ? null : walked,
    findings: ctx.findings,
  };
}

/**
 * Full publish pipeline: redact → serialize → independent second-pass
 * verification (§5.2 P4). On any second-pass finding, publication is
 * ABORTED — no payload/serialized output is returned, because a verify hit
 * means the first-pass ruleset has a hole (§5.7 F2).
 *
 * `primaryRedactor` is injectable so the regression suite can prove the
 * second gate holds even when the first pass is disabled (§5.6 test 4).
 */
export function redactAndVerify(
  input: unknown,
  opts: RedactOptions,
  primaryRedactor: (i: unknown, o: RedactOptions) => RedactResult = redact,
): PublishGuardResult {
  const result = primaryRedactor(input, opts);
  const serialized = JSON.stringify(result.payload ?? null, null, 2);
  const verdict = verifyRedacted(serialized);
  if (!verdict.ok) {
    return {
      ok: false,
      findings: result.findings,
      verifyFindings: verdict.findings,
    };
  }
  return {
    ok: true,
    serialized,
    payload: result.payload,
    findings: result.findings,
    verifyFindings: [],
  };
}
