/**
 * Training-data capture — server-side gate + BigQuery row mapping.
 *
 * Ticket IqcXHVbT0rXnHloXpV7n. The client (Electron main process) already
 * refuses to upload unless the server told it the account is eligible; this
 * module is the gate that decision comes from AND the one that re-runs on every
 * insert. A tampered client must not be able to write a single row.
 *
 * ★Isolation. These rows carry RAW prompt/completion text — code, file paths,
 * whatever the user typed. They go to the `marblo_training` dataset, NOT to
 * `marblo_telemetry`, so BigQuery IAM can grant analytics access to the
 * de-identified telemetry without also handing over transcripts. Nothing in
 * this file may be wired into the telemetry/events path.
 *
 * ★Scope today: admin (ADMIN_UID) only, by explicit self-consent. Opening this
 * to other users is a separate, larger design (roadmap ticket ZFgn4zpt) that
 * needs a real consent surface, retention policy, and deletion path — none of
 * which exist yet. So the eligibility test here is deliberately a single-uid
 * equality, not a role or a claim.
 *
 * Pure functions only (no firebase-admin, no BigQuery client) so `node --test`
 * can exercise the gate directly — see trainingCapture.test.ts.
 */

/** BigQuery dataset that holds transcripts. Separate from marblo_telemetry. */
export const TRAINING_DATASET = "marblo_training";
export const TRAINING_SAMPLES_TABLE = "training_samples";

/** Max samples accepted in one callable invocation. */
export const MAX_SAMPLES_PER_BATCH = 50;

/** Per-field caps. The client caps too; the server never trusts that it did. */
export const MAX_TEXT_CHARS = 200_000;
export const MAX_THINKING_CHARS = 100_000;
export const MAX_JSON_CHARS = 200_000;

export interface TrainingConsentDoc {
  privacyConsent?: {
    trainingDataCapture?: unknown;
  } | null;
}

export interface CaptureGateDecision {
  /** uid === ADMIN_UID. */
  eligible: boolean;
  /** Consent as resolved from the user doc (admin defaults to ON). */
  consent: boolean;
  /** Both — the only thing an insert may act on. */
  allowed: boolean;
  /** Machine-readable reason when not allowed. Never contains a uid. */
  reason: "ok" | "not_admin" | "no_consent" | "server_unconfigured";
}

/**
 * Decide whether `uid` may capture training data.
 *
 * Consent semantics:
 *   - Admin with NO stored flag → consent granted. 사장님's own transcripts,
 *     captured by the owner's own explicit instruction; requiring a separate
 *     click before anything is collected would lose exactly the days this
 *     ticket exists to stop losing. An explicit `false` still turns it off.
 *   - Anyone else → never eligible today, whatever the flag says.
 *
 * A missing ADMIN_UID is a server misconfiguration, and it resolves CLOSED. The
 * failure mode of the other choice (treating "unset" as "everyone is admin") is
 * unbounded transcript collection from real users.
 */
export function resolveCaptureGate(
  uid: string | null | undefined,
  adminUid: string | null | undefined,
  userDoc: TrainingConsentDoc | null | undefined,
): CaptureGateDecision {
  const admin = (adminUid ?? "").trim();
  if (!admin) {
    return {
      eligible: false,
      consent: false,
      allowed: false,
      reason: "server_unconfigured",
    };
  }
  if (!uid || uid !== admin) {
    return {
      eligible: false,
      consent: false,
      allowed: false,
      reason: "not_admin",
    };
  }

  const stored = userDoc?.privacyConsent?.trainingDataCapture;
  const consent =
    stored === undefined || stored === null ? true : stored === true;
  return {
    eligible: true,
    consent,
    allowed: consent,
    reason: consent ? "ok" : "no_consent",
  };
}

/** One row of `marblo_training.training_samples`. */
export interface TrainingSampleRow {
  sampleId: string;
  schemaVersion: number;
  capturedAt: string;
  turnTimestamp: string | null;
  ingestedAt: string;
  harness: string | null;
  source: string | null;
  messageRole: string | null;
  turnKey: string | null;
  parentKey: string | null;
  isSidechain: boolean | null;
  sessionId: string | null;
  agentId: string | null;
  parentAgentId: string | null;
  projectId: string | null;
  taskId: string | null;
  role: string | null;
  model: string | null;
  cwd: string | null;
  text: string | null;
  thinking: string | null;
  toolCalls: string | null;
  toolResults: string | null;
  textChars: number | null;
  thinkingChars: number | null;
  truncated: boolean | null;
  appVersion: string | null;
  /** Account that produced the sample. Admin-only data, so it IS identified —
   *  that is the point of keeping it out of the de-identified dataset. */
  accountUserId: string;
}

/**
 * BigQuery schema for the samples table. The callable creates the dataset and
 * table on first insert (same pattern as the marketing mirror), so shipping
 * this needs no manual BigQuery migration — which is what "즉시 적재" requires.
 *
 * Partitioned by ingest day and clustered on the axes an export query filters
 * by (harness, model, source), so a fine-tune export scans a slice, not the
 * whole table.
 */
export const TRAINING_SAMPLES_SCHEMA = [
  { name: "sampleId", type: "STRING", mode: "REQUIRED" },
  { name: "schemaVersion", type: "INTEGER" },
  { name: "capturedAt", type: "TIMESTAMP" },
  { name: "turnTimestamp", type: "TIMESTAMP" },
  { name: "ingestedAt", type: "TIMESTAMP", mode: "REQUIRED" },
  { name: "harness", type: "STRING" },
  { name: "source", type: "STRING" },
  { name: "messageRole", type: "STRING" },
  { name: "turnKey", type: "STRING" },
  { name: "parentKey", type: "STRING" },
  { name: "isSidechain", type: "BOOLEAN" },
  { name: "sessionId", type: "STRING" },
  { name: "agentId", type: "STRING" },
  { name: "parentAgentId", type: "STRING" },
  { name: "projectId", type: "STRING" },
  { name: "taskId", type: "STRING" },
  { name: "role", type: "STRING" },
  { name: "model", type: "STRING" },
  { name: "cwd", type: "STRING" },
  { name: "text", type: "STRING" },
  { name: "thinking", type: "STRING" },
  { name: "toolCalls", type: "STRING" },
  { name: "toolResults", type: "STRING" },
  { name: "textChars", type: "INTEGER" },
  { name: "thinkingChars", type: "INTEGER" },
  { name: "truncated", type: "BOOLEAN" },
  { name: "appVersion", type: "STRING" },
  { name: "accountUserId", type: "STRING", mode: "REQUIRED" },
] as const;

function trimmed(v: unknown, limit: number): string | null {
  if (typeof v !== "string" || v === "") return null;
  return v.length > limit ? v.slice(0, limit) : v;
}

function boolOrNull(v: unknown): boolean | null {
  return typeof v === "boolean" ? v : null;
}

function intOrNull(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? Math.trunc(v) : null;
}

/** ISO-8601 or null. BigQuery rejects a malformed TIMESTAMP for the whole
 *  batch, so an unparseable client value becomes null instead of a 400. */
function timestampOrNull(v: unknown): string | null {
  if (typeof v !== "string" || v === "") return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/**
 * Normalize one client sample into a row. Returns null when the sample carries
 * no identity or no content at all — an empty row is worse than a missing one
 * because it inflates every "how much data do we have" count.
 */
export function toTrainingRow(
  sample: unknown,
  accountUserId: string,
  ingestedAt: string,
): TrainingSampleRow | null {
  if (!sample || typeof sample !== "object" || Array.isArray(sample)) {
    return null;
  }
  const s = sample as Record<string, unknown>;
  const sampleId = trimmed(s.sampleId, 512);
  if (!sampleId) return null;

  const text = trimmed(s.text, MAX_TEXT_CHARS);
  const thinking = trimmed(s.thinking, MAX_THINKING_CHARS);
  const toolCalls = trimmed(s.toolCalls, MAX_JSON_CHARS);
  const toolResults = trimmed(s.toolResults, MAX_JSON_CHARS);
  if (!text && !thinking && !toolCalls && !toolResults) return null;

  return {
    sampleId,
    schemaVersion: intOrNull(s.schemaVersion) ?? 0,
    capturedAt: timestampOrNull(s.capturedAt) ?? ingestedAt,
    turnTimestamp: timestampOrNull(s.turnTimestamp),
    ingestedAt,
    harness: trimmed(s.harness, 32),
    source: trimmed(s.source, 32),
    messageRole: trimmed(s.messageRole, 32),
    turnKey: trimmed(s.turnKey, 256),
    parentKey: trimmed(s.parentKey, 256),
    isSidechain: boolOrNull(s.isSidechain),
    sessionId: trimmed(s.sessionId, 256),
    agentId: trimmed(s.agentId, 256),
    parentAgentId: trimmed(s.parentAgentId, 256),
    projectId: trimmed(s.projectId, 256),
    taskId: trimmed(s.taskId, 256),
    role: trimmed(s.role, 64),
    model: trimmed(s.model, 128),
    cwd: trimmed(s.cwd, 1024),
    text,
    thinking,
    toolCalls,
    toolResults,
    textChars: intOrNull(s.textChars),
    thinkingChars: intOrNull(s.thinkingChars),
    truncated: boolOrNull(s.truncated),
    appVersion: trimmed(s.appVersion, 32),
    accountUserId,
  };
}

/** Map a whole batch, dropping unusable samples. Reports both counts so the
 *  caller can tell "nothing arrived" from "everything was junk". */
export function toTrainingRows(
  samples: unknown,
  accountUserId: string,
  ingestedAt: string,
): { rows: TrainingSampleRow[]; skipped: number } {
  if (!Array.isArray(samples)) return { rows: [], skipped: 0 };
  const rows: TrainingSampleRow[] = [];
  let skipped = 0;
  for (const sample of samples.slice(0, MAX_SAMPLES_PER_BATCH)) {
    const row = toTrainingRow(sample, accountUserId, ingestedAt);
    if (row) rows.push(row);
    else skipped++;
  }
  return { rows, skipped };
}
