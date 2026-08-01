/**
 * Field classification + level filtering (§5.4 table, §5.2 P1 default-deny).
 *
 * The classifier maps a field NAME to a FieldClass. Anything it does not
 * recognize is "private" and gets dropped at every level — a new field
 * added anywhere in the product is automatically non-public until someone
 * classifies it here (조용한 포함이 최악).
 */

import type { FieldClass, RedactLevel } from "../../types/redact";
import {
  AGENT_KEY,
  CODE_DIFF_KEY,
  COST_KEY,
  FREE_TEXT_KEY,
  PERSON_KEY,
  REL_PATH_KEY,
  REPO_KEY,
  SECRET_KEY_NAME,
  SECRET_KEY_NAME_EXTENDED,
  STRUCTURED_SAFE_KEY,
  TICKET_ID_KEY,
  TIMESTAMP_KEY,
} from "./patterns";

/**
 * Classify a field by its key name. Order matters: secret key names first
 * (R7 outranks everything — a field named `apiKeyCreatedAt` must be treated
 * as a secret name, not a timestamp).
 */
export function classifyField(key: string): FieldClass {
  if (SECRET_KEY_NAME.test(key) || SECRET_KEY_NAME_EXTENDED.test(key)) {
    return "secretKeyName";
  }
  if (PERSON_KEY.test(key)) return "personId";
  if (AGENT_KEY.test(key)) return "agentId";
  if (COST_KEY.test(key)) return "cost";
  if (TICKET_ID_KEY.test(key)) return "ticketId";
  if (REPO_KEY.test(key)) return "repoIdentifier";
  if (REL_PATH_KEY.test(key)) return "relativePath";
  if (CODE_DIFF_KEY.test(key)) return "codeDiff";
  if (FREE_TEXT_KEY.test(key)) return "freeText";
  if (TIMESTAMP_KEY.test(key)) return "timestamp";
  if (STRUCTURED_SAFE_KEY.test(key)) return "structuredSafe";
  // ★ default-deny (§5.2 P1): unknown field ⇒ private ⇒ dropped.
  return "private";
}

/** What the level filter decides for a classified field. */
export type LevelDecision =
  | { kind: "pass" } // keep — value still goes through the string scanner
  | { kind: "drop" }
  | { kind: "anonPerson" }
  | { kind: "anonAgent" }
  | { kind: "anonTicket" }
  | { kind: "relativize" }
  | { kind: "repoGate" }; // pass only if caller-verified public (fail-closed)

/**
 * §5.4 level columns as an exhaustive switch. The default clause returns
 * drop — a FieldClass added without a row here fails SAFE, and the
 * `satisfies never` check makes tsc flag the omission.
 */
export function decideForLevel(
  cls: FieldClass,
  level: RedactLevel,
  opts: { includeCost?: boolean },
): LevelDecision {
  switch (cls) {
    case "structuredSafe":
      return { kind: "pass" };
    case "secretKeyName":
      // R7 — value masked by the engine regardless of level.
      return { kind: "pass" };
    case "personId":
      return { kind: "anonPerson" };
    case "agentId":
      return { kind: "anonAgent" };
    case "ticketId":
      return { kind: "anonTicket" };
    case "freeText":
    case "codeDiff":
      // R9/R10 — L1/L2 drop the field; L3 may keep an excerpt, but only
      // after it survives the full R1~R8 scanner (engine enforces).
      return level === "L3" ? { kind: "pass" } : { kind: "drop" };
    case "relativePath":
      // R13 — at L1 not even file names go out.
      return level === "L1" ? { kind: "drop" } : { kind: "pass" };
    case "repoIdentifier":
      // R11 — fail-closed public-repo gate; L1 drops outright.
      return level === "L1" ? { kind: "drop" } : { kind: "repoGate" };
    case "cost":
      // R14 — independent opt-in, orthogonal to level.
      return opts.includeCost === true ? { kind: "pass" } : { kind: "drop" };
    case "timestamp":
      // R15 — relative below L3 (work-hours inference), absolute at L3.
      return level === "L3" ? { kind: "pass" } : { kind: "relativize" };
    case "private":
      return { kind: "drop" };
    default: {
      // Unreachable when FieldClass is exhaustive — but if a new class is
      // added without a row, the runtime default is still DROP (§5.2 P1).
      const _exhaustive: never = cls;
      void _exhaustive;
      return { kind: "drop" };
    }
  }
}
