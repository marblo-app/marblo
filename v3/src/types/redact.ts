/**
 * Types for the feature-agnostic redaction (비식별화) primitive.
 *
 * Design authority: docs/MISSION-REPLAY-DESIGN.md §5 (rules R1~R17,
 * entropy §5.5, regression suite §5.6, security findings §5.7).
 *
 * The engine takes an arbitrary structured object and produces a
 * de-identified version. Mission Replay is the first consumer; audit-log
 * export reuses the same primitive later. Nothing in here may depend on
 * firebase or react.
 */

/** Publication levels — see §5.3. L0 (private) never reaches this engine. */
export type RedactLevel = "L1" | "L2" | "L3";

/**
 * Rule identifiers from the §5.4 table plus R17 (BIP39 mnemonic, §5.7 F1)
 * and DEFAULT_DENY (§5.2 P1 — unclassified field dropped as private).
 */
export type RedactRuleId =
  | "R1" // local home absolute path → MASK <workspace>
  | "R1b" // marblo worktree path → MASK <worktree>
  | "R1c" // residual absolute path → DROP item
  | "R2" // email / phone → MASK
  | "R2b" // person identifiers → ANON member-N
  | "R2c" // agent identifiers → ANON agent-N
  | "R3" // known API key prefixes → DROP item
  | "R4" // JWT → DROP item
  | "R5" // PEM private key → DROP item
  | "R6" // credential connection string → DROP item
  | "R7" // secret-looking key name → MASK value <REDACTED>
  | "R8" // high-entropy token → DROP item
  | "R9" // free-text prose field → DROP field (L3: excerpt if clean)
  | "R10" // code / diff → DROP (L3: excerpt if clean)
  | "R11" // repository identifiers → DROP unless verified public
  | "R12" // infra identifiers → DROP item
  | "R13" // repo-relative file paths → pass at L2+ only
  | "R14" // cost / billing → DROP unless explicit opt-in
  | "R15" // absolute timestamps → relativize below L3
  | "R16" // ticket / document ids → ANON T-N
  | "R17" // BIP39 mnemonic phrase → DROP item (§5.7 F1)
  | "DEFAULT_DENY"; // unclassified field → private → DROP

export type RedactActionType =
  | "MASK" // placeholder substitution in place
  | "DROP" // item / field removed entirely
  | "ANON" // stable per-run alias substitution
  | "RELATIVIZE"; // absolute time → relative offset

/**
 * A single redaction event. ★F7: findings identify the rule and the
 * location ONLY — the offending original value must NEVER be carried
 * here (findings end up in logs).
 */
export interface RedactFinding {
  rule: RedactRuleId;
  action: RedactActionType;
  /** JSON-path-ish location, e.g. "tasks[2].title" */
  path: string;
}

/** Field classes assigned by the classifier in rules.ts. */
export type FieldClass =
  | "structuredSafe" // known-safe scalar; strings still pass the scanner (F3)
  | "freeText" // R9: prompt / chat / terminal / stacktrace prose
  | "codeDiff" // R10
  | "personId" // R2b
  | "agentId" // R2c
  | "cost" // R14
  | "timestamp" // R15
  | "ticketId" // R16
  | "repoIdentifier" // R11
  | "relativePath" // R13
  | "secretKeyName" // R7
  | "private"; // default-deny — dropped at every level

export interface RedactOptions {
  level: RedactLevel;
  /**
   * Per-mission salt for anonymous aliases (§5.4 R2b, §5.7 F8). Aliases are
   * per-run counters so cross-mission correlation is impossible either way;
   * the salt only decouples alias assignment order.
   */
  salt?: string;
  /** R14 — cost fields are dropped unless this is explicitly true. */
  includeCost?: boolean;
  /**
   * R11 — repo URLs verified public by the CALLER (fail-closed: anything
   * not in this list is dropped, including when the list is absent).
   * Verification itself (GitHub API, §5.7 F4) is out of engine scope.
   */
  publicRepos?: readonly string[];
  /** R15 — base time for relativization. Defaults to the minimum timestamp found. */
  baseTimeMs?: number;
  /**
   * Optional classifier override for consumers with domain knowledge.
   * Returning undefined falls through to the built-in classifier
   * (which is default-deny).
   */
  classifyOverride?: (key: string, path: string) => FieldClass | undefined;
}

export interface RedactResult {
  payload: unknown;
  findings: RedactFinding[];
}

/**
 * Second-pass verification (§5.2 P4, §5.7 F2). Detectors are independent
 * from — and strictly broader than — the first-pass ruleset.
 */
export interface VerifyFinding {
  /** Independent detector name, e.g. "v-known-prefix", "v-entropy". */
  detector: string;
  /**
   * Location of the hit inside the serialized payload: character offset
   * and length only. ★F7: never the matched text itself.
   */
  offset: number;
  length: number;
}

export interface VerifyResult {
  ok: boolean;
  findings: VerifyFinding[];
}

/**
 * Result of the full publish pipeline (redact → serialize → verify).
 * When ok=false publication MUST be aborted — no payload is exposed
 * (§5.2 P4: a second-pass hit means the first-pass ruleset has a hole).
 */
export interface PublishGuardResult {
  ok: boolean;
  /** Present only when ok=true. This exact string is what gets published. */
  serialized?: string;
  /** Present only when ok=true. */
  payload?: unknown;
  findings: RedactFinding[];
  verifyFindings: VerifyFinding[];
}
