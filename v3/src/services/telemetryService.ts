import { httpsCallable } from "firebase/functions";
import { auth, functions } from "../lib/firebase";
import { scrubValue } from "../lib/telemetry/scrub";
import { firstPartyTelemetryDefaultEnabled } from "../lib/telemetry/firstPartyGate";
import { recordTaskRetry } from "./taskRollups";

export type TelemetryEvent =
  | "agent:spawned"
  | "agent:spawn_failed"
  | "agent:stopped"
  | "agent:crashed"
  | "agent:restarted"
  | "agent:went_stale"
  | "agent:heartbeat"
  | "task:created"
  | "task:status_changed"
  | "task:completed"
  | "flow:started"
  | "flow:node_executed"
  | "flow:completed"
  | "token:usage"
  // ★고스트 비용 감지기. cost-tracker 가 단가를 모르는 model id 를 만났다 =
  // 그 토큰은 $0 으로 적재된다(= 지출 과소보고). 종전엔 미매칭 id 를 조용히
  // Sonnet 요율($3/$15)로 청구했고, 그건 없는 돈을 발명하는 쪽의 오류였다.
  // 이제 0 으로 청구하되 이 이벤트가 그 공백을 드러낸다. model 은 1급 컬럼,
  // 누적횟수/최초목격은 metadata JSON 으로 간다(electron/telemetry.ts 참조).
  | "cost:pricing_unmatched"
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
  // 첫 실행 샘플 프로젝트 시드(티켓 yk8ouW2pS6nGzH272rXy). 바로 뒤에 붙는
  // folder_connected("new") 를 "자동 연결" 로 식별해 주는 짝 신호다 — 이게
  // 없으면 제로셋업 온램프의 도달률을 수동 폴더 픽과 구분할 수 없다.
  | "onboarding:sample_project_seeded"
  | "onboarding:orchestrator_opened"
  | "onboarding:orchestrator_blocked"
  // 연결 마법사(CliSetupGate) 단계별 진입/성공/실패 (ticket CecrriY8). 위
  // 퍼널이 "앱실행→로그인→폴더연결→오케오픈"의 큰 골격을 잡는다면, 이 이벤트는
  // 그 사이의 최대 사각인 "CLI 연결(설치·터미널 로그인·인증확인)" 구간을
  // 단계 해상도로 채운다. errorCategory 는 orchestrator_blocked 와 동일한
  // 어휘(cli_auth/launch_error)를 재사용해 두 신호가 조인 가능하게 유지한다.
  | "onboarding:cli_setup_step"
  | "onboarding:survey_cli_fail"
  | "onboarding:survey_first_project"
  | "onboarding:marketing_consent_shown"
  | "onboarding:marketing_consent_granted"
  // 인증 전 샘플 데모(Demo Mode P3, ticket qQLGS3NW). 미인증 상태에서 '오케가
  // 티켓을 분해→에이전트를 배정하는 장면'을 스크립티드 재생으로 보여주고(실제
  // CLI 스폰·LLM·과금 0), 종료 시 연결 마법사(CliSetupGate)로 유도한다. 아래
  // 3 이벤트가 데모 퍼널(진입→완주→CTA클릭)을 채운다. ★전송 한계: 이 이벤트는
  // 로그인 이전에 큐잉되고 flushTelemetry 는 auth.currentUser 가 있을 때만
  // 전송하므로(anti-abuse), app:first_run 과 동일하게 "다음 성공 로그인" 시점에
  // 함께 flush 된다 — 끝내 로그인 안 한 방문자의 데모 이탈은 전송되지 않는다.
  | "onboarding:demo_started"
  | "onboarding:demo_completed"
  | "onboarding:demo_cta_click"
  // ── 비기너 모드 퍼널 (ticket qpOpVJCtK06mq6Qa2a1S, 설계 docs/BEGINNER-MODE-DESIGN.md) ──
  // 활성화 진단 §S4 가 관측한 유일한 실 dead-end("첫 티켓 전달 성공 후 화면에서
  // 아무 일도 안 일어남")를 고치는 셸의 퍼널. 기존 first_run→login_success 축
  // 뒤에 붙어 beginner_entered → beginner_first_completion → beginner_promoted
  // 로 이어진다. ★durationMs 를 클라가 계산해 싣는 이유는 진단 §3 — 서버
  // timestamp 는 수신시각이라 단계 지연을 계산할 수 없기 때문이다.
  | "onboarding:beginner_entered"
  | "onboarding:beginner_first_completion"
  | "onboarding:beginner_promoted"
  // ── 코치마크 투어 (ticket m7mpxqSw) ──────────────────────────────────────
  // 비기너 셸 첫 실행에 뜨는 순차 스포트라이트 안내. 위 퍼널과 같은 설치·같은
  // 세션에 붙으므로 beginner_entered → coachmark_* → beginner_first_completion
  // 으로 조인해 "안내를 본 유저가 첫 완료까지 더 잘 가는가" 를 볼 수 있다.
  // ★started 는 '띄운 횟수' 지 '완주' 가 아니다 — skipped 와 합쳐야 분모가 된다.
  | "onboarding:coachmark_started"
  | "onboarding:coachmark_completed"
  | "onboarding:coachmark_skipped"
  // ── 온보딩 스톨 계측 (ticket 9dXgBdkGn1LyJokShh1g) ───────────────────────
  // 온램프 스파이크 #883/#885 의 공통 결론: 무료→유료 티어에 투자하기 전에
  // "구독/크레딧/인증이 없어 **최초에 멈추는** 유저" 가 몇 명인지부터 세야 하는데,
  // 그 순간의 이벤트가 BigQuery 에 **0건**이라 문제 크기를 알 수 없었다(grep 0건).
  // 아래 5개가 그 공백을 채운다 — 스키마/쿼리는
  // docs/onboarding-stall-telemetry.md.
  //
  // 전부 기존 파이프라인 그대로다: 이 파일의 logTelemetry choke point(비식별
  // scrub + firstParty 게이트) → 기존 logTelemetryBatch → BigQuery `events`.
  // 새 테이블도, 서버 스키마 변경도 없다(서버는 event 문자열을 화이트리스트 없이
  // 적재하고 model/errorCategory/metadata 컬럼은 이미 존재한다).
  //
  // main 프로세스 발화(App.tsx IPC 브리지 경유):
  | "onboarding:spawn_blocked"
  | "onboarding:agent_needs_auth"
  // ★needs_auth 는 철회될 수 있다(readiness 도달 = 오탐). 이 짝 이벤트를 빼지
  // 않고 세면 인증 팝업 오탐이 스톨 수치를 부풀린다.
  | "onboarding:agent_auth_resolved"
  // 렌더러 발화(#884 의 funding 감지 지점):
  | "onboarding:funding_probe"
  | "onboarding:funding_guide_shown"
  // ── L0 온램프 (ticket VzR1izqW6hzwF0YRfkgL · 설계 #886 §9-B) ─────────────
  // 위 스톨 계측(#888)이 "막힌 사람" 을 세기 시작했다면, 아래 둘은 그 **앞칸**을
  // 센다: 계정이 없는 사람이 자기 말로 티켓을 만들었는가(decompose_used), 그리고
  // 그걸 실행하려다 벽을 만났는가(exec_blocked). 설계 §9-C 의 퍼널이
  //   beginner_entered → onramp:decompose_used → onramp:exec_blocked
  //   → cliSetupStep(성공) → beginner_first_completion
  // 이라 이 두 칸이 비면 사다리의 0→1층 전이를 관측할 수 없다.
  //
  // ★`onramp:exec_blocked` 는 main 의 `onboarding:spawn_blocked` 와 **다른 축**이다.
  // spawn_blocked = 게이트가 막았다(사실). exec_blocked = 그 차단이 **화면이 되어
  // 유저에게 말을 걸었다**(경험). 온램프가 고쳐야 하는 숫자는 후자이고, 둘이
  // 갈리는 지점(세션 상한·MCP 축 억제)이 곧 이 설계의 튜닝 손잡이다.
  | "onramp:decompose_used"
  | "onramp:exec_blocked";

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
  dispatchReason?: string;
  outcome?: "completed" | "crashed" | "stale" | "spawn_failed" | "blocked";
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
 * localStorage. BigQuery rows keep this as the de-identified row key, while the
 * callable adds a server-side accountUserId into metadata for admin-only user
 * dedup. Clearing storage still mints a new install id.
 *
 * Shared with taskService so the task-outcome ML rows use the same install id.
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
  if (clean.outcome !== undefined || clean.dispatchReason !== undefined) {
    clean.metadata = {
      ...(clean.metadata ?? {}),
      ...(clean.outcome !== undefined ? { outcome: clean.outcome } : {}),
      ...(clean.dispatchReason !== undefined
        ? { dispatchReason: clean.dispatchReason }
        : {}),
    };
  }

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
    model?: string,
    dispatchReason?: string,
    errorCategory?: string,
    errorMessage?: string,
  ) {
    logTelemetry({
      event: "agent:crashed",
      agentId,
      taskId,
      model,
      exitCode,
      success: false,
      outcome: "crashed",
      dispatchReason,
      // §5-4 갭 메우기: 크래시가 "왜" 났는지. main 프로세스가 이미 계산하는
      // coarse 분류(fast_fail_config = 바이너리 부재/설정 오류, runtime_crash =
      // 재시작 예산 소진)를 그대로 싣는다. 원인 상세 문자열은 짧게 유지하고
      // scrub 를 거친다(경로/이메일 마스킹).
      errorCategory,
      errorMessage,
    });
  },

  agentRestarted(
    agentId: string,
    attempt: number,
    taskId?: string,
    model?: string,
    dispatchReason?: string,
  ) {
    logTelemetry({
      event: "agent:restarted",
      agentId,
      taskId,
      model,
      outcome: "crashed",
      dispatchReason,
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
      ...(toStatus === "BLOCKED" ? { outcome: "blocked" as const } : {}),
    });
  },

  taskCompleted(taskId: string, durationMs?: number, agentId?: string) {
    logTelemetry({
      event: "task:completed",
      taskId,
      durationMs,
      agentId,
      success: true,
      outcome: "completed",
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

  /** 첫 실행 샘플 프로젝트 시드 결과(티켓 yk8ouW2pS6nGzH272rXy).
   *  outcome = created(새로 시드) | reused(이미 있어 재사용) | failed.
   *  이어지는 folderConnected("new") 와 짝을 이뤄 "자동 연결" 을 수동 픽과
   *  구분한다 — 경로는 싣지 않는다. */
  sampleProjectSeeded(outcome: "created" | "reused" | "failed") {
    logTelemetry({
      event: "onboarding:sample_project_seeded",
      success: outcome !== "failed",
      ...(outcome === "failed" ? { errorCategory: "seed_error" } : {}),
      metadata: { outcome },
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

  /** 연결 마법사(CliSetupGate)의 한 단계 이벤트.
   *  ★활성화 퍼널(ticket ir94m9C6): 선형 4스텝으로 확장 —
   *  step = install(CLI 설치) | auth(인증, claude/codex 하나) | prd(폴더연결·샘플 PRD) |
   *         firstTicket(첫 티켓 프롬프트 전송, 아하 모먼트).
   *  하위호환: 구 3스텝(notice/connect/project) 값도 그대로 받는다 —
   *  BQ 퍼널 스키마(event/metadata.step)를 깨지 않고 install/auth/prd/firstTicket 로
   *  세분화만 한 것이라 과거 이벤트와 한 축에서 조인된다.
   *  phase = enter(진입) | success(단계 완료) | fail(단계 실패).
   *  reason = 실패 사유. install/auth 단계 실패는 orchestrator_blocked 와 같은
   *  cli_auth 어휘를, firstTicket 단계 실패는 launch_error 를 재사용해 두 퍼널을
   *  같은 축으로 조인할 수 있게 한다. 경로/자유텍스트는 절대 싣지 않는다. */
  cliSetupStep(
    step:
      | "install"
      | "auth"
      | "prd"
      | "firstTicket"
      // 하위호환용 구 3스텝 값 (재배치 전 이벤트와 스키마 호환)
      | "notice"
      | "connect"
      | "project",
    phase: "enter" | "success" | "fail",
    reason?: string,
  ) {
    logTelemetry({
      event: "onboarding:cli_setup_step",
      success: phase !== "fail",
      metadata: { step, phase },
      ...(reason ? { errorCategory: reason } : {}),
    });
  },

  surveyCliFail(reason: string) {
    logTelemetry({
      event: "onboarding:survey_cli_fail",
      metadata: { reason },
    });
  },

  surveyFirstProject(rating: number, feedback?: unknown) {
    logTelemetry({
      event: "onboarding:survey_first_project",
      metadata: { rating, ...(feedback ? { feedback } : {}) },
    });
  },

  marketingConsentShown(surface: string) {
    logTelemetry({
      event: "onboarding:marketing_consent_shown",
      metadata: { surface },
    });
  },

  marketingConsentGranted(surface: string, method: string) {
    logTelemetry({
      event: "onboarding:marketing_consent_granted",
      success: true,
      metadata: { surface, method },
    });
  },

  // ── 인증 전 샘플 데모 퍼널 (Demo Mode P3, ticket qQLGS3NW) ──────────────
  /** 데모 진입(재생 시작). surface = 데모를 연 화면(auth_screen 등). */
  demoStarted(surface: string) {
    logTelemetry({
      event: "onboarding:demo_started",
      metadata: { surface },
    });
  },

  /** 데모 완주. reason = played(끝까지 재생) | skipped(건너뛰기로 종료 도달). */
  demoCompleted(reason: string) {
    logTelemetry({
      event: "onboarding:demo_completed",
      success: true,
      metadata: { reason },
    });
  },

  /** 데모 종료 CTA('이제 내 계정을 연결해 실제로 실행하기') 클릭 = 연결 마법사로
   *  유도된 시점. 이후 로그인 성공 시 CliSetupGate 위저드가 열린다. */
  demoCtaClick() {
    logTelemetry({ event: "onboarding:demo_cta_click", success: true });
  },

  // ── 비기너 모드 퍼널 (설계 docs/BEGINNER-MODE-DESIGN.md §8) ────────────
  /** 비기너 셸 진입. reason = fresh_install(최초 판정) | settings(설정에서 복귀). */
  beginnerEntered(reason: string) {
    logTelemetry({
      event: "onboarding:beginner_entered",
      success: true,
      metadata: { reason },
    });
  },

  /** ★비기너 챗 안에서 첫 완료를 관측(설치당 1회). durationMs = 진입→첫완료.
   *  서버 timestamp 로는 이 지연을 못 구한다(진단 §3) — 클라 계산값을 싣는다. */
  beginnerFirstCompletion(durationMs: number) {
    logTelemetry({
      event: "onboarding:beginner_first_completion",
      success: true,
      durationMs,
    });
  },

  /** 어드밴스드 모드로 승격. trigger = completed|merged|days|manual,
   *  manual = 유저가 스스로 전환했나(모달 CTA 가 아니라 상단바/설정). */
  beginnerPromoted(trigger: string, manual: boolean) {
    logTelemetry({
      event: "onboarding:beginner_promoted",
      success: true,
      metadata: { trigger, manual },
    });
  },

  // ── 코치마크 투어 (ticket m7mpxqSw) ──────────────────────────────────────
  /** 투어를 화면에 띄웠다. tourId 로 투어를 구분한다(비기너 첫 실행 외에도 쓰인다). */
  coachmarkStarted(tourId: string, stepCount: number) {
    logTelemetry({
      event: "onboarding:coachmark_started",
      success: true,
      metadata: { tourId, stepCount },
    });
  },

  /** 마지막 스텝까지 봤다. durationMs = 시작→완주(클라 계산 — 진단 §3 와 동일 이유). */
  coachmarkCompleted(tourId: string, stepCount: number, durationMs: number) {
    logTelemetry({
      event: "onboarding:coachmark_completed",
      success: true,
      durationMs,
      metadata: { tourId, stepCount },
    });
  },

  /** 중간에 닫았다. stepIndex = 몇 번째에서 이탈했나(0-based),
   *  permanent = '다시 보지 않기'(true) vs 그냥 건너뛰기(false). */
  coachmarkSkipped(
    tourId: string,
    stepIndex: number,
    stepCount: number,
    permanent: boolean,
  ) {
    logTelemetry({
      event: "onboarding:coachmark_skipped",
      success: true,
      metadata: { tourId, stepIndex, stepCount, permanent },
    });
  },

  // ── 온보딩 스톨 계측 (ticket 9dXgBdkGn1LyJokShh1g) ─────────────────────
  //
  // #884 가 만든 funding 프로브("로그인은 됐는데 그 계정이 한 턴이라도 도는가")의
  // 판정을 그대로 계측한다. 스폰차단 쪽 두 이벤트는 main 프로세스가 IPC 브리지로
  // 보내므로 여기 헬퍼가 없다(electron/telemetry.ts).

  /**
   * ★프로브 판정 1건. **정상(`ok`)도 반드시 싣는다** — 분모가 없으면 "인증까지 온
   * 유저 중 몇 %가 못 도는가" 라는 이 계측의 유일한 질문에 답할 수 없다.
   *
   * `trigger` = auto(인증 성립 직후 자동 1회) | recheck(가이드 모달의 "다시 확인").
   * recheck 는 같은 설치에서 여러 번 나올 수 있으므로 유저수 집계는 auto 로 하거나
   * clientId 단위로 접어야 한다(문서 §쿼리).
   *
   * ★프로브 원문(`outcome.detail` — 벤더 CLI 의 출력 꼬리)은 **절대 싣지 않는다**.
   * 자유 텍스트라 무엇이 섞여 있을지 알 수 없고, 판정에 필요한 정보는 verdict 와
   * blockedReason 코드가 전부다.
   */
  fundingProbe(
    verdict: "ok" | "unfunded" | "blocked" | "inconclusive",
    model: string,
    trigger: "auto" | "recheck",
    blockedReason?: string,
  ) {
    logTelemetry({
      event: "onboarding:funding_probe",
      model,
      success: verdict === "ok",
      ...(verdict === "unfunded" || verdict === "blocked"
        ? { outcome: "blocked" as const }
        : {}),
      // 사유 코드만(원문 금지). blocked 는 하위 사유까지 붙여 rate_limit(=요금제
      // 있음) 과 진짜 스톨을 구분할 수 있게 한다.
      errorCategory:
        verdict === "blocked"
          ? `blocked:${blockedReason ?? "unknown"}`
          : verdict,
      metadata: {
        verdict,
        trigger,
        ...(blockedReason ? { blockedReason } : {}),
      },
    });
  },

  /**
   * 스톨 가이드 모달이 **실제로 화면에 떴다** = 사용자가 눈으로 막힌 순간.
   * 판정(fundingProbe)과 따로 세는 이유는 둘이 갈리기 때문이다 — 판정이
   * unfunded 라도 사용자가 이미 닫았거나(dismissed) 셸이 안 떠 있으면 모달은
   * 안 뜬다. 온램프가 고쳐야 할 숫자는 "본 사람" 쪽이다.
   */
  fundingGuideShown(
    state: "authedButUnfunded" | "authedButBlocked",
    model?: string,
  ) {
    logTelemetry({
      event: "onboarding:funding_guide_shown",
      model,
      success: false,
      outcome: "blocked",
      errorCategory: state,
      metadata: { state },
    });
  },

  // ── L0 온램프 (ticket VzR1izqW6hzwF0YRfkgL · 설계 #886 §9-B) ───────────

  /**
   * 룰 분해 1회. **유저 문장은 절대 싣지 않는다** — 자유 텍스트라 무엇이 섞여
   * 있을지 알 수 없고, 판정에 필요한 정보는 어떤 규칙이 걸렸는지와 몇 장이
   * 나왔는지뿐이다(funding 프로브가 원문 detail 을 안 싣는 것과 같은 규율).
   *
   * `matchedRule` 이 이 계측의 핵심이다: "어떤 입력이 fallback 으로 떨어지는가"
   * 가 다음 룰의 유일한 근거이고, 설계 T4 의 판정선(fallback 비율 < 40%)이
   * 이 필드로만 측정된다.
   */
  onrampDecomposeUsed(payload: {
    mode: "rule" | "llm";
    matchedRule: string;
    fallback: boolean;
    ticketCount: number;
    /** 티켓이 실제로 보드에 쓰였는가(권한·오프라인 실패와 구분). */
    persisted: boolean;
    /** 어느 표면에서 — beginner_connect | start_here_tab. */
    surface: string;
  }) {
    logTelemetry({
      event: "onramp:decompose_used",
      success: payload.persisted,
      errorCategory: payload.fallback ? "fallback" : payload.matchedRule,
      metadata: {
        mode: payload.mode,
        matchedRule: payload.matchedRule,
        fallback: payload.fallback,
        ticketCount: payload.ticketCount,
        persisted: payload.persisted,
        surface: payload.surface,
      },
    });
  },

  /**
   * 실행 시도가 막혀 **연결 안내(M1)가 떴다**. 설계 §9-A 의 P0 이벤트.
   *
   * ★`shown` 을 함께 싣는 이유: 억제된 차단(세션 상한 초과·MCP 축)도 세야
   * "우리가 몇 번 말을 걸 기회를 스스로 버렸나" 가 보인다. 분자만 세면 상한을
   * 조일지 풀지 판단할 근거가 없다.
   */
  onrampExecBlocked(payload: {
    trigger: string;
    model: string;
    installed: boolean;
    shown: boolean;
    suppressedReason?: string;
  }) {
    logTelemetry({
      event: "onramp:exec_blocked",
      model: payload.model,
      success: false,
      outcome: "blocked",
      errorCategory: payload.trigger,
      metadata: {
        trigger: payload.trigger,
        installed: payload.installed,
        shown: payload.shown,
        ...(payload.suppressedReason
          ? { suppressedReason: payload.suppressedReason }
          : {}),
      },
    });
  },

  flush: flushTelemetry,
};

export default telemetry;
