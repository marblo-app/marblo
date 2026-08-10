/**
 * Training-data capture — RAW prompt/completion text for generative
 * fine-tuning (ticket IqcXHVbT0rXnHloXpV7n).
 *
 * ★What makes this different from every other sink in the app
 *
 * The always-on first-party telemetry (`electron/telemetry.ts` → renderer
 * `logTelemetry` → BigQuery `events`) is 비식별 by construction: it scrubs PII
 * at a choke point and stores `promptHash`/`promptLength`, never text. That is
 * the right policy for a default-on sink, and it is exactly why generative
 * fine-tuning is impossible from it (BQ audit, 2026-08).
 *
 * This module makes the opposite trade, and therefore carries the opposite
 * guarantees:
 *
 *   1. RAW text — prompts, completions, reasoning, tool IO. It is code and it
 *      is PII. It never touches the telemetry queue, the renderer, or any
 *      de-identified path. Main process → `logTrainingSamples` callable →
 *      BigQuery dataset `marblo_training` — a DIFFERENT dataset from
 *      `marblo_telemetry`, so access is separable at the IAM level.
 *   2. Two independent gates. The client uploads only when the SERVER has said
 *      this account is eligible, so a non-eligible user's text never leaves the
 *      machine at all. The server then re-checks `uid === ADMIN_UID` and the
 *      user's `privacyConsent.trainingDataCapture` on every insert, so a
 *      tampered client cannot write either. ADMIN_UID exists only in server env.
 *   3. Fail-closed. Unknown gate state (not fetched yet, fetch failed, signed
 *      out, anonymous) means DO NOT capture. Consent-gated capture must never
 *      be the thing that "worked because we didn't know".
 *
 * Durability: samples are appended to a local JSONL spool and dropped only
 * after the server confirms the insert, so an offline stretch, a crash, or an
 * app restart does not lose a day of transcripts ("하루도 안 놓치게").
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { getAuth } from "firebase/auth";
import { getFunctions, httpsCallable } from "firebase/functions";
import { getMissionFirebaseApp } from "./mission-engine/firebase-app";
import { encodeClaudeProjectDir } from "./claude-paths";
import type { SessionFormat } from "./session-parsers";
import {
  extractTranscriptTurns,
  newTranscriptState,
  transcriptCaptureSupported,
  type TranscriptState,
} from "./session-transcripts";
import {
  buildTrainingSample,
  type TrainingCaptureMeta,
  type TrainingSample,
} from "./training-sample";

const FIREBASE_FUNCTIONS_REGION = "us-central1";

const UPLOAD_BATCH_SIZE = 20;
const UPLOAD_INTERVAL_MS = 30_000;
/** Hard ceiling on the on-disk spool. Oldest lines are dropped past this. */
const MAX_SPOOL_BYTES = 256 * 1024 * 1024;
/** How often the client re-asks the server whether capture is still allowed. */
const GATE_REFRESH_MS = 10 * 60_000;
/** Minimum spacing between gate attempts after a failure (poll is every 15s). */
const GATE_RETRY_MS = 60_000;

/** Server verdict on whether this account may capture. */
interface CaptureGate {
  /** uid === ADMIN_UID (server-decided; the client never learns ADMIN_UID). */
  eligible: boolean;
  /** privacyConsent.trainingDataCapture (admin defaults ON — self-consent). */
  consent: boolean;
  /** eligible && consent. The only thing the upload path reads. */
  effective: boolean;
  fetchedAt: number;
}

let gate: CaptureGate | null = null;
let gateFetchInFlight: Promise<CaptureGate | null> | null = null;
let lastGateAttempt = 0;
let uploadTimer: ReturnType<typeof setInterval> | null = null;
let uploadInFlight = false;
let appVersion: string | null = null;
let disabledReason: string | null = null;

/** Per-session streaming carry-over (grok chunk accumulation). */
const transcriptStates = new Map<string, TranscriptState>();

// ── Spool ───────────────────────────────────────────────────────────────

function spoolDir(): string {
  return path.join(os.homedir(), ".marblo", "training-capture");
}

function spoolPath(): string {
  return path.join(spoolDir(), "samples.jsonl");
}

function appendToSpool(samples: TrainingSample[]): void {
  if (samples.length === 0) return;
  try {
    fs.mkdirSync(spoolDir(), { recursive: true });
    // 0o600: the spool holds raw code/PII — other local accounts must not read it.
    fs.appendFileSync(
      spoolPath(),
      samples.map((s) => JSON.stringify(s)).join("\n") + "\n",
      { mode: 0o600 },
    );
    enforceSpoolCeiling();
  } catch (err) {
    console.warn("[TrainingCapture] spool append failed:", errMsg(err));
  }
}

/**
 * Drop the oldest half of the spool once it passes the ceiling. Losing the
 * oldest samples is the least-bad failure: the alternative is an unbounded
 * file on the user's disk, and the newest transcripts are the ones the ticket
 * is about. The drop is logged with a count — never silent.
 */
function enforceSpoolCeiling(): void {
  try {
    const size = fs.statSync(spoolPath()).size;
    if (size <= MAX_SPOOL_BYTES) return;
    const lines = readSpoolLines();
    const keep = lines.slice(Math.floor(lines.length / 2));
    writeSpoolLines(keep);
    console.warn(
      `[TrainingCapture] spool exceeded ${MAX_SPOOL_BYTES} bytes — dropped ` +
        `${lines.length - keep.length} oldest samples`,
    );
  } catch {
    // stat/rewrite failure is non-fatal — the next append retries.
  }
}

function readSpoolLines(): string[] {
  try {
    const raw = fs.readFileSync(spoolPath(), "utf-8");
    if (!raw) return [];
    const lines = raw.split("\n");
    if (lines[lines.length - 1] === "") lines.pop();
    return lines;
  } catch {
    return [];
  }
}

function writeSpoolLines(lines: string[]): void {
  fs.writeFileSync(spoolPath(), lines.length ? lines.join("\n") + "\n" : "", {
    mode: 0o600,
  });
}

/** Rewrite the spool without the first `count` lines (the server took them). */
function commitSpool(count: number): void {
  if (count <= 0) return;
  try {
    writeSpoolLines(readSpoolLines().slice(count));
  } catch (err) {
    console.warn("[TrainingCapture] spool commit failed:", errMsg(err));
  }
}

// ── Gate ────────────────────────────────────────────────────────────────

function gateIsFresh(): boolean {
  return gate !== null && Date.now() - gate.fetchedAt < GATE_REFRESH_MS;
}

/**
 * Ask the server whether this account may capture. The request carries no
 * transcript and no arguments; the reply is two booleans.
 */
async function fetchGate(): Promise<CaptureGate | null> {
  lastGateAttempt = Date.now();
  try {
    const { app } = getMissionFirebaseApp();
    const user = getAuth(app).currentUser;
    // Anonymous/unauthenticated main-process sessions cannot be the admin, and
    // the callable would reject anyway. Stay closed without a round trip.
    if (!user || user.isAnonymous) return null;

    const callable = httpsCallable<
      Record<string, never>,
      { eligible?: unknown; consent?: unknown }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "getTrainingCaptureStatus");
    const { data } = await callable({});
    const eligible = data?.eligible === true;
    const consent = data?.consent === true;
    const next: CaptureGate = {
      eligible,
      consent,
      effective: eligible && consent,
      fetchedAt: Date.now(),
    };
    if (gate?.effective !== next.effective) {
      console.info(
        `[TrainingCapture] gate → effective=${next.effective} ` +
          `(eligible=${eligible} consent=${consent})`,
      );
    }
    gate = next;
    return next;
  } catch (err) {
    // Fail-closed: an unreadable gate is NOT permission.
    console.warn("[TrainingCapture] gate fetch failed:", errMsg(err));
    return null;
  }
}

function refreshGateSoon(): void {
  if (disabledReason) return;
  if (gateIsFresh() || gateFetchInFlight) return;
  if (Date.now() - lastGateAttempt < GATE_RETRY_MS) return;
  gateFetchInFlight = fetchGate().finally(() => {
    gateFetchInFlight = null;
  });
}

/** True only when the server has affirmatively said capture is allowed. */
export function captureEnabled(): boolean {
  if (disabledReason) return false;
  return gate?.effective === true;
}

/** Diagnostic snapshot for logs/IPC. Never includes transcript text. */
export function trainingCaptureStatus(): {
  enabled: boolean;
  eligible: boolean;
  consent: boolean;
  spooled: number;
  disabledReason: string | null;
} {
  return {
    enabled: captureEnabled(),
    eligible: gate?.eligible === true,
    consent: gate?.consent === true,
    spooled: readSpoolLines().length,
    disabledReason,
  };
}

// ── Ingest ──────────────────────────────────────────────────────────────

/**
 * Turn NEW session-file lines into training samples and spool them.
 *
 * Called from the cost tracker with the exact line slice it just parsed for
 * tokens, so capture adds no file IO. Cheap and synchronous (JSON parse +
 * append); the upload runs on the background flusher.
 *
 * Returns the number of samples spooled — 0 whenever the gate is not open,
 * which is also the state during the first poll after launch (fail-closed).
 */
export function ingestSessionLines(
  format: SessionFormat,
  lines: string[],
  meta: Omit<TrainingCaptureMeta, "appVersion">,
  /** Session file identity — keys the streaming carry-over so a rotated file
   *  (reuse_agent, resume) starts clean instead of inheriting half a turn. */
  sessionKey: string,
): number {
  if (lines.length === 0) return 0;
  if (!transcriptCaptureSupported(format)) return 0;
  refreshGateSoon();
  if (!captureEnabled()) return 0;

  const stateKey = `${format}:${sessionKey}`;
  const prev = transcriptStates.get(stateKey) ?? newTranscriptState();
  let turns;
  try {
    const extraction = extractTranscriptTurns(format, lines, prev);
    transcriptStates.set(stateKey, extraction.state);
    turns = extraction.turns;
  } catch (err) {
    // Capture must never break the agent it observes.
    console.warn("[TrainingCapture] extraction failed:", errMsg(err));
    return 0;
  }
  if (turns.length === 0) return 0;

  const capturedAt = new Date().toISOString();
  const full: TrainingCaptureMeta = { ...meta, appVersion };
  appendToSpool(
    turns.map((turn) => buildTrainingSample(turn, format, full, capturedAt)),
  );
  return turns.length;
}

/** Forget a session's streaming carry-over (agent gone / file rotated). */
export function forgetSession(sessionKey: string): void {
  for (const key of [...transcriptStates.keys()]) {
    if (key.endsWith(`:${sessionKey}`)) transcriptStates.delete(key);
  }
}

// ── Orchestrator sessions ───────────────────────────────────────────────
//
// The orchestrator is NOT an agent-manager agent, so it never reaches the cost
// tracker and therefore never reaches the sink above. Its transcript is the
// single most valuable thing this ticket is about (the orchestrator turn is
// where the planning, decomposition and dispatch reasoning lives), so it gets
// its own small poller here rather than being silently omitted.
//
// Only the claude orchestrator is read: its session file is a known path
// (`~/.claude/projects/<encoded-root>/<sessionId>.jsonl`). A codex/grok
// orchestrator stores a marker instead of a resolvable id, so it is skipped —
// honestly and out loud — rather than guessed at.

const ORCH_POLL_INTERVAL_MS = 15_000;

interface OrchestratorWatch {
  filePath: string;
  projectId: string | null;
  sessionId: string;
  /** Lines already ingested. -1 = not yet initialized (see below). */
  lastLineCount: number;
}

const orchestratorWatches = new Map<string, OrchestratorWatch>();
let orchestratorTimer: ReturnType<typeof setInterval> | null = null;

function orchWatermarkPath(): string {
  return path.join(spoolDir(), "orchestrator-watermarks.json");
}

function loadOrchWatermarks(): Record<string, number> {
  try {
    const raw = fs.readFileSync(orchWatermarkPath(), "utf-8");
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function saveOrchWatermark(filePath: string, lastLineCount: number): void {
  try {
    fs.mkdirSync(spoolDir(), { recursive: true });
    const store = loadOrchWatermarks();
    store[filePath] = lastLineCount;
    fs.writeFileSync(orchWatermarkPath(), JSON.stringify(store), {
      mode: 0o600,
    });
  } catch {
    // Best-effort. Losing a watermark re-reads a session once; the sampleId is
    // deterministic (`sessionId:uuid`) so the duplicate stays detectable.
  }
}

/**
 * Watch the claude orchestrator's session file for this project root.
 *
 * Called from the orchestrator manager's single session-id chokepoint, so
 * resume, relaunch and fresh-session detection all register through one path.
 * Idempotent: re-registering the same file keeps its watermark.
 */
export function trackOrchestratorSession(input: {
  rootPath: string;
  sessionId: string;
  projectId?: string | null;
  model?: string | null;
}): void {
  const { rootPath, sessionId } = input;
  // Non-claude orchestrators keep a marker, not a resolvable session file.
  if (input.model && input.model !== "claude") return;
  if (!rootPath || !sessionId || !/^[0-9a-fA-F-]{16,}$/.test(sessionId)) return;

  const filePath = path.join(
    os.homedir(),
    ".claude",
    "projects",
    encodeClaudeProjectDir(rootPath),
    `${sessionId}.jsonl`,
  );
  const existing = orchestratorWatches.get(filePath);
  if (existing) {
    existing.projectId = input.projectId ?? existing.projectId;
    return;
  }
  orchestratorWatches.set(filePath, {
    filePath,
    projectId: input.projectId ?? null,
    sessionId,
    lastLineCount: loadOrchWatermarks()[filePath] ?? -1,
  });
  ensureOrchestratorPoller();
  console.info(
    `[TrainingCapture] watching orchestrator session ${sessionId} (${orchestratorWatches.size} watched)`,
  );
}

function ensureOrchestratorPoller(): void {
  if (orchestratorTimer) return;
  orchestratorTimer = setInterval(
    pollOrchestratorSessions,
    ORCH_POLL_INTERVAL_MS,
  );
  orchestratorTimer.unref?.();
}

function pollOrchestratorSessions(): void {
  refreshGateSoon();
  if (!captureEnabled()) return;
  for (const watch of orchestratorWatches.values()) {
    try {
      pollOrchestratorSession(watch);
    } catch (err) {
      console.warn(
        `[TrainingCapture] orchestrator poll failed (${watch.sessionId}):`,
        errMsg(err),
      );
    }
  }
}

function pollOrchestratorSession(watch: OrchestratorWatch): void {
  if (!fs.existsSync(watch.filePath)) return;
  const raw = fs.readFileSync(watch.filePath, "utf-8");
  if (!raw) return;
  const lines = raw.split("\n");
  if (lines[lines.length - 1] === "") lines.pop();

  // First sighting with no stored watermark: start at the CURRENT end of file.
  // Capturing the backlog would collect turns from before capture was enabled —
  // consent covers what happens from now on, not retroactively.
  if (watch.lastLineCount < 0) {
    watch.lastLineCount = lines.length;
    saveOrchWatermark(watch.filePath, watch.lastLineCount);
    return;
  }
  // The file shrank → a different session rotated into this name. Re-baseline
  // rather than replaying it (the mirror of the cost tracker's watermark rule).
  if (lines.length < watch.lastLineCount) {
    watch.lastLineCount = lines.length;
    saveOrchWatermark(watch.filePath, watch.lastLineCount);
    return;
  }
  if (lines.length === watch.lastLineCount) return;

  const newLines = lines.slice(watch.lastLineCount);
  ingestSessionLines(
    "claude",
    newLines,
    {
      agentId: null,
      source: "orchestrator",
      projectId: watch.projectId,
      // The orchestrator is not bound to one board task by construction — it
      // is the thing that hands tasks out. Leaving this null is the truth.
      taskId: null,
      role: "orchestrator",
      model: null,
      parentAgentId: null,
      sessionId: watch.sessionId,
      cwd: null,
    },
    watch.filePath,
  );
  watch.lastLineCount = lines.length;
  saveOrchWatermark(watch.filePath, watch.lastLineCount);
}

// ── Upload ──────────────────────────────────────────────────────────────

async function flushSpool(): Promise<void> {
  if (uploadInFlight) return;
  refreshGateSoon();
  if (!captureEnabled()) return;

  const lines = readSpoolLines();
  if (lines.length === 0) return;

  uploadInFlight = true;
  try {
    const batchLines = lines.slice(0, UPLOAD_BATCH_SIZE);
    const samples: TrainingSample[] = [];
    for (const line of batchLines) {
      try {
        samples.push(JSON.parse(line) as TrainingSample);
      } catch {
        // A corrupt spool line can never become valid — it still counts as
        // consumed so it cannot wedge the queue forever.
      }
    }
    if (samples.length === 0) {
      commitSpool(batchLines.length);
      return;
    }

    const { app } = getMissionFirebaseApp();
    const callable = httpsCallable<
      { samples: TrainingSample[] },
      { inserted?: unknown }
    >(getFunctions(app, FIREBASE_FUNCTIONS_REGION), "logTrainingSamples");
    const { data } = await callable({ samples });
    // Consume the batch only after the server confirms. A throw leaves the
    // lines in place for the next tick — that is the durability promise.
    commitSpool(batchLines.length);
    console.info(
      `[TrainingCapture] uploaded ${samples.length} samples ` +
        `(inserted=${String(data?.inserted ?? "?")}) — ${
          lines.length - batchLines.length
        } still spooled`,
    );
  } catch (err) {
    const message = errMsg(err);
    // permission-denied = the SERVER refused (not admin / consent off). Stop
    // uploading rather than retrying raw text forever against a closed gate.
    // The spool is left intact so a later re-grant can still ship it.
    if (message.includes("permission-denied")) {
      disabledReason = "server refused (permission-denied)";
      console.warn(
        "[TrainingCapture] server refused the insert — capture disabled for " +
          "this session; spool left in place",
      );
    } else {
      console.warn("[TrainingCapture] upload failed (will retry):", message);
    }
  } finally {
    uploadInFlight = false;
  }
}

// ── Lifecycle ───────────────────────────────────────────────────────────

/**
 * Start the capture subsystem. Safe to call more than once. Nothing is
 * captured or sent until the server confirms eligibility + consent.
 */
export function initTrainingCapture(
  options: { appVersion?: string } = {},
): void {
  appVersion = options.appVersion ?? appVersion;
  if (uploadTimer) return;
  uploadTimer = setInterval(() => {
    void flushSpool();
  }, UPLOAD_INTERVAL_MS);
  uploadTimer.unref?.();
  if (orchestratorWatches.size > 0) ensureOrchestratorPoller();
  refreshGateSoon();
  console.info(
    "[TrainingCapture] initialized (fail-closed; awaiting server gate)",
  );
}

export function stopTrainingCapture(): void {
  if (uploadTimer) {
    clearInterval(uploadTimer);
    uploadTimer = null;
  }
  if (orchestratorTimer) {
    clearInterval(orchestratorTimer);
    orchestratorTimer = null;
  }
}

/** Force a gate re-read + flush — used right after auth or consent changes. */
export async function refreshTrainingCapture(): Promise<void> {
  gate = null;
  disabledReason = null;
  lastGateAttempt = 0;
  await fetchGate();
  await flushSpool();
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
