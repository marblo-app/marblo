import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { scrubValue } from "../lib/telemetry/scrub";
import { firstPartyTelemetryDefaultEnabled } from "../lib/telemetry/firstPartyGate";
import { recordTaskRetry } from "./taskRollups";

export type TelemetryEvent =
  | "agent:spawned"
  | "agent:stopped"
  | "agent:crashed"
  | "agent:restarted"
  | "agent:heartbeat"
  | "task:created"
  | "task:status_changed"
  | "task:completed"
  | "flow:started"
  | "flow:node_executed"
  | "flow:completed"
  | "token:usage"
  | "session:started"
  | "session:ended"
  | "chat:message_sent"
  | "chat:active_users"
  // Merge-outcome label emitted from the main process at the merge chokepoint
  // (electron/main.ts recordMergeHistory). Routed to BigQuery `events`.
  | "task:merged"
  // ── "첫 10분" 활성화 퍼널 (ONBOARDING-FIRST10-INSTRUMENT, ticket ixQUBdhx) ──
  // 베타 이탈 근본원인 분석(docs/beta-churn-root-cause-analysis-2026-07-21.md)이
  // 최대 이탈 = 앱실행→첫스폰 22→6(−73%) 인데 그 구간(로그인·폴더연결·오케
  // 자동오픈·첫스폰)이 미계측이라 "왜 죽는지" 데이터가 없다고 판정했다. 아래
  // 이벤트는 그 구간의 도달 + 실패/이탈 사유를 채운다. 전부 기존 logTelemetry
  // choke point(비식별 scrub + firstParty 게이트)를 통과해 BigQuery `events`
  // 테이블의 같은 경로로 적재된다 — 새 파이프라인 없음, 서버 변경 없음(서버
  // logTelemetryBatch 는 event 문자열을 화이트리스트 없이 그대로 적재).
  | "app:first_run"
  | "auth:login_attempt"
  | "auth:login_success"
  | "auth:login_failed"
  | "onboarding:folder_connected"
  | "onboarding:folder_connect_failed"
  | "onboarding:orchestrator_opened"
  | "onboarding:orchestrator_blocked";

interface TelemetryPayload {
  event: TelemetryEvent;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  flowId?: string;
  model?: string;
  role?: string;
  status?: string;
  fromStatus?: string;
  toStatus?: string;
  durationMs?: number;
  tokensInput?: number;
  tokensOutput?: number;
  cost?: number;
  success?: boolean;
  exitCode?: number;
  nodeType?: string;
  nodeCount?: number;
  metadata?: Record<string, unknown>;
  // Installed app version (e.g. "3.0.16"). Populated centrally at the flush
  // choke point from the build-time __APP_VERSION__ constant — callers don't
  // set it. Lets BigQuery slice metrics per release instead of the old server
  // "3.0.0" fallback. See flushTelemetry / getAppVersion below.
  appVersion?: string;
  // ML-ready columns mirrored from BigQuery `events` schema. The IPC bridge
  // in App.tsx passes these through verbatim, so adding them here keeps
  // type-safety on the renderer-side helper.
  promptHash?: string;
  promptLength?: number;
  parentAgentId?: string;
  retryOf?: string;
  // Diff-derived merge features (task:merged). Mirror the BigQuery `events`
  // schema so the IPC bridge stays type-safe passing them through. taskType
  // holds the path-derived change category for merge events.
  filesChanged?: number;
  linesChanged?: number;
  taskType?: string;
  // Crash / failure reason columns. Both already exist first-class in the
  // BigQuery `events` schema (functions/src/index.ts TelemetryRow) but were
  // never populated by the renderer — the churn analysis §5-4 flagged every
  // agent:crashed row as errorCategory/errorMessage NULL, so "왜(인증? CLI
  // 경로? spawn env?)" was unanswerable. agent:crashed now carries the coarse
  // classification the main process already computes (fast_fail_config vs
  // runtime_crash), and auth:login_failed / onboarding:*_blocked reuse the same
  // columns for their failure reason. errorMessage stays short + scrubbed —
  // never raw stderr/prompt text.
  errorCategory?: string;
  errorMessage?: string;
}

/**
 * Installed app version, read from the Vite build-time constant __APP_VERSION__
 * (injected from package.json — identical to Electron's app.getVersion()). This
 * avoids a main-process IPC round-trip; every telemetry path already flows
 * through this renderer module. Undefined only in non-Vite contexts (e.g. unit
 * tests), in which case events ship without appVersion and the server records
 * null rather than a misleading version.
 */
function getAppVersion(): string | undefined {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined;
}

const TELEMETRY_ENABLED_KEY = "marblo.telemetry.enabled";

function readPersistedTelemetryEnabled(): boolean | null {
  try {
    const raw = localStorage.getItem(TELEMETRY_ENABLED_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
  } catch {
    // Storage may be unavailable; fall back to the build-time default.
  }
  return null;
}

// First-party telemetry (Firebase Functions → BigQuery) is ON by default for
// de-identified operational metrics, unless the hard kill-switch is set or the
// user has opted out. See lib/telemetry/firstPartyGate.ts for the policy.
let telemetryEnabled =
  readPersistedTelemetryEnabled() ?? firstPartyTelemetryDefaultEnabled();
const eventQueue: TelemetryPayload[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;

const FLUSH_INTERVAL = 10_000;
const MAX_QUEUE_SIZE = 50;

const logTelemetryBatch = httpsCallable(functions, "logTelemetryBatch");
const logHeartbeatFn = httpsCallable(functions, "logHeartbeat");

export function setTelemetryEnabled(
  enabled: boolean,
  options: { persist?: boolean } = {},
) {
  const next = firstPartyTelemetryDefaultEnabled() && enabled;
  telemetryEnabled = next;
  if (options.persist !== false) {
    try {
      localStorage.setItem(TELEMETRY_ENABLED_KEY, String(enabled));
    } catch {
      // Best-effort preference persistence only.
    }
  }
}

export function isTelemetryEnabled(): boolean {
  return telemetryEnabled;
}

const CLIENT_ID_KEY = "marblo.telemetry.clientId";

/**
 * Stable, anonymous per-install identifier. Random UUID persisted in
 * localStorage and NEVER linked to the Firebase account — there is no
 * mapping table anywhere. This is what lets us honestly call the 1st-party
 * BigQuery telemetry 비식별(익명): rows carry this id, never the auth uid.
 * Clearing storage just mints a new id, which is fine for aggregate analytics.
 *
 * Shared with taskService so the task-outcome ML rows use the same anonymous
 * id instead of the account uid.
 */
export function getClientId(): string {
  try {
    let id = localStorage.getItem(CLIENT_ID_KEY);
    if (!id) {
      id = crypto.randomUUID();
      localStorage.setItem(CLIENT_ID_KEY, id);
    }
    return id;
  } catch {
    return "anon";
  }
}

/**
 * Strip identifying / PII fields from a telemetry payload before it ever
 * touches the queue. scrubValue() masks file paths, emails, phones and BYOK
 * keys and drops free-text user-input keys (prompt/message/…); on top of that
 * we explicitly drop the few account identifiers scrub.ts doesn't know about
 * (senderId/userId/uid/email in metadata). The result is de-identified —
 * defense-in-depth for the 1st-party sink. Scrubbing stays always-on so that
 * default-on or opted-in paths never ship PII.
 *
 * Applied at the single logTelemetry() choke point, so it also covers events
 * injected from the main process via the App.tsx IPC bridge.
 */
function anonymize(payload: TelemetryPayload): TelemetryPayload {
  const scrubbed = scrubValue(payload) as TelemetryPayload;
  if (scrubbed.metadata && typeof scrubbed.metadata === "object") {
    const m = { ...(scrubbed.metadata as Record<string, unknown>) };
    delete m.senderId;
    delete m.userId;
    delete m.uid;
    delete m.email;
    scrubbed.metadata = m;
  }
  return scrubbed;
}

// Separate heartbeat queue — goes to agent_heartbeats table, not events
const heartbeatQueue: TelemetryPayload[] = [];
let heartbeatFlushTimer: ReturnType<typeof setTimeout> | null = null;

export function logTelemetry(payload: TelemetryPayload) {
  if (!telemetryEnabled) return;

  // De-identify before anything is queued or sent. Single guarantee point —
  // every telemetry path (convenience helpers + IPC bridge) flows through here.
  const clean = anonymize(payload);

  // Attribute the restart to its task. This is the only place the signal is
  // observable in the renderer: the main process emits agent:restarted over
  // the telemetry IPC bridge, which lands here verbatim rather than through
  // the helper below. Turning it into a durable per-task counter is what makes
  // task_outcomes.retriesCount a real number instead of the hardcoded 0.
  // Fire-and-forget; a failed counter write must never drop the event itself.
  if (clean.event === "agent:restarted" && clean.taskId) {
    void recordTaskRetry(clean.taskId);
  }

  // Route heartbeats to separate queue/table
  if (clean.event === "agent:heartbeat") {
    heartbeatQueue.push(clean);
    if (heartbeatQueue.length >= 10) {
      flushHeartbeats();
    } else if (!heartbeatFlushTimer) {
      heartbeatFlushTimer = setTimeout(flushHeartbeats, 30_000);
    }
    return;
  }

  eventQueue.push(clean);

  if (eventQueue.length >= MAX_QUEUE_SIZE) {
    flushTelemetry();
  } else if (!flushTimer) {
    flushTimer = setTimeout(flushTelemetry, FLUSH_INTERVAL);
  }
}

async function flushHeartbeats() {
  if (heartbeatFlushTimer) {
    clearTimeout(heartbeatFlushTimer);
    heartbeatFlushTimer = null;
  }
  if (heartbeatQueue.length === 0) return;
  if (!auth.currentUser) return;

  const batch = heartbeatQueue.splice(0, 50);
  const clientId = getClientId();
  try {
    await logHeartbeatFn({
      beats: batch.map((b) => ({
        agentId: b.agentId,
        projectId: b.projectId,
        status: b.status,
        tokensAccumulated: b.tokensInput ?? 0,
        costAccumulated: b.cost ?? 0,
        clientId,
        timestamp: new Date().toISOString(),
      })),
    });
  } catch (error) {
    console.warn("[Telemetry] Heartbeat flush failed:", error);
  }
}

async function flushTelemetry() {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (eventQueue.length === 0) return;
  if (!auth.currentUser) return;

  const clientId = getClientId();
  const appVersion = getAppVersion();
  const batch = eventQueue
    .splice(0, MAX_QUEUE_SIZE)
    .map((e) => ({ ...e, clientId, appVersion }));

  try {
    await logTelemetryBatch({ events: batch });
  } catch (error) {
    console.warn("[Telemetry] Flush failed:", error);
    if (eventQueue.length < MAX_QUEUE_SIZE * 2) {
      eventQueue.unshift(...batch);
    } else {
      console.warn("[Telemetry] Dropping failed telemetry batch:", {
        dropped: batch.length,
        queueLength: eventQueue.length,
        maxBuffered: MAX_QUEUE_SIZE * 2,
      });
    }
  }
}

// Convenience functions
export const telemetry = {
  agentSpawned(
    agentId: string,
    name: string,
    model: string,
    role: string,
    projectId?: string,
  ) {
    logTelemetry({
      event: "agent:spawned",
      agentId,
      model,
      role,
      projectId,
      metadata: { name },
    });
  },

  agentStopped(agentId: string, exitCode?: number) {
    logTelemetry({
      event: "agent:stopped",
      agentId,
      exitCode,
      success: exitCode === 0,
    });
  },

  agentCrashed(
    agentId: string,
    exitCode: number,
    taskId?: string,
    errorCategory?: string,
    errorMessage?: string,
  ) {
    logTelemetry({
      event: "agent:crashed",
      agentId,
      taskId,
      exitCode,
      success: false,
      // §5-4 갭 메우기: 크래시가 "왜" 났는지. main 프로세스가 이미 계산하는
      // coarse 분류(fast_fail_config = 바이너리 부재/설정 오류, runtime_crash =
      // 재시작 예산 소진)를 그대로 싣는다. 원인 상세 문자열은 짧게 유지하고
      // scrub 를 거친다(경로/이메일 마스킹).
      errorCategory,
      errorMessage,
    });
  },

  agentRestarted(agentId: string, attempt: number, taskId?: string) {
    logTelemetry({
      event: "agent:restarted",
      agentId,
      taskId,
      metadata: { attempt },
    });
  },

  taskCreated(
    taskId: string,
    projectId: string,
    role: string,
    priority?: number,
  ) {
    logTelemetry({
      event: "task:created",
      taskId,
      projectId,
      role,
      metadata: { priority },
    });
  },

  taskStatusChanged(
    taskId: string,
    fromStatus: string,
    toStatus: string,
    agentId?: string,
  ) {
    logTelemetry({
      event: "task:status_changed",
      taskId,
      fromStatus,
      toStatus,
      agentId,
    });
  },

  taskCompleted(taskId: string, durationMs?: number, agentId?: string) {
    logTelemetry({
      event: "task:completed",
      taskId,
      durationMs,
      agentId,
      success: true,
    });
  },

  flowStarted(flowId: string, nodeCount: number) {
    logTelemetry({ event: "flow:started", flowId, nodeCount });
  },

  flowNodeExecuted(
    flowId: string,
    nodeType: string,
    durationMs: number,
    success: boolean,
  ) {
    logTelemetry({
      event: "flow:node_executed",
      flowId,
      nodeType,
      durationMs,
      success,
    });
  },

  flowCompleted(
    flowId: string,
    status: string,
    durationMs: number,
    nodeCount: number,
  ) {
    logTelemetry({
      event: "flow:completed",
      flowId,
      status,
      durationMs,
      nodeCount,
      success: status === "completed",
    });
  },

  tokenUsage(
    agentId: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    cost: number,
    projectId?: string,
  ) {
    logTelemetry({
      event: "token:usage",
      agentId,
      model,
      tokensInput,
      tokensOutput,
      cost,
      projectId,
    });
  },

  sessionStarted(projectId?: string) {
    logTelemetry({ event: "session:started", projectId });
  },

  sessionEnded(durationMs: number) {
    logTelemetry({ event: "session:ended", durationMs });
  },

  chatMessageSent(projectId: string, type: string, senderId: string) {
    logTelemetry({
      event: "chat:message_sent",
      projectId,
      metadata: { type, senderId },
    });
  },

  chatActiveUsers(projectId: string, count: number) {
    logTelemetry({
      event: "chat:active_users",
      projectId,
      metadata: { count },
    });
  },

  // ── "첫 10분" 활성화 퍼널 헬퍼 (ticket ixQUBdhx) ──────────────────
  //
  // ★전송 한계(정직성): logTelemetry 는 flushTelemetry 에서 auth.currentUser
  // 가 있을 때만 서버로 나간다(anti-abuse). 그래서 아래 로그인-이전 이벤트
  // (app:first_run / login_attempt / login_failed)는 큐에 쌓였다가 "다음
  // 성공적 로그인" 시점에 함께 flush 된다. 즉 로그인을 한 번이라도 성공시킨
  // 유저의 초기 마찰(실패 후 재시도 성공)은 잡히지만, 끝내 로그인에 성공
  // 못 한 유저의 실패는 전송되지 않는다 — 이건 auth-gated 싱크의 구조적
  // 한계이며 §5-2 맹점을 완전히는 못 메운다(보고서에 명시).

  /** 이 설치에서 앱이 처음 실행된 시점(1회). GA4 다운로드 수와 규모(magnitude)
   *  대사(reconcile)용 — 개인 조인은 clientId≠user_pseudo_id 라 불가, 집계만. */
  appFirstRun(platform: string) {
    logTelemetry({ event: "app:first_run", metadata: { platform } });
  },

  /** 사용자가 로그인 방식을 트리거한 시점. method = google|email|signup|github. */
  loginAttempt(method: string) {
    logTelemetry({ event: "auth:login_attempt", metadata: { method } });
  },

  loginSuccess(method: string, isNewUser?: boolean) {
    logTelemetry({
      event: "auth:login_success",
      success: true,
      metadata: { method, isNewUser },
    });
  },

  /** 로그인 실패. code = Firebase 에러코드(auth/network-request-failed 등) —
   *  ★원문 메시지가 아닌 코드만(메시지엔 이메일이 섞일 수 있음). §5-2 최대맹점. */
  loginFailed(method: string, code: string) {
    logTelemetry({
      event: "auth:login_failed",
      success: false,
      errorCategory: code,
      metadata: { method },
    });
  },

  /** 폴더 픽 → 프로젝트 등록 성공(온보딩 "폴더 연결" 도달).
   *  mode = existing(기존 열기) | new(신규 자동등록) | inline(이름 배너 경유). */
  folderConnected(mode: string, hasGitRemote: boolean) {
    logTelemetry({
      event: "onboarding:folder_connected",
      success: true,
      metadata: { mode, hasGitRemote },
    });
  },

  /** 폴더 연결 실패. reason = write_error(등록 쓰기 실패) 등. 경로는 절대 싣지 않음. */
  folderConnectFailed(reason: string) {
    logTelemetry({
      event: "onboarding:folder_connect_failed",
      success: false,
      errorCategory: reason,
    });
  },

  /** 오케스트레이터 자동오픈 성공(첫 에이전트가 뜬 순간). resumed = 이전 세션 재접속 여부. */
  orchestratorOpened(resumed: boolean) {
    logTelemetry({
      event: "onboarding:orchestrator_opened",
      success: true,
      metadata: { resumed },
    });
  },

  /** 오케 자동오픈이 막힌 시점 = "첫 스폰을 시도했으나 실패". ★22→6 의 핵심 사유.
   *  reason = cli_auth(CLI 미설치/미인증) | launch_error(런치 예외). */
  orchestratorBlocked(reason: string) {
    logTelemetry({
      event: "onboarding:orchestrator_blocked",
      success: false,
      errorCategory: reason,
    });
  },

  flush: flushTelemetry,
};

export default telemetry;
