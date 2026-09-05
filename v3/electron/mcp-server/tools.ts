import type {
  McpServer,
  ToolCallback,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import type { ZodRawShapeCompat } from "@modelcontextprotocol/sdk/server/zod-compat.js";
import { z } from "zod";
import {
  collection,
  doc,
  getDoc,
  getDocs,
  addDoc,
  setDoc,
  updateDoc,
  deleteDoc,
  query,
  where,
  orderBy,
  limit as fsLimit,
  runTransaction,
  waitForPendingWrites,
  arrayUnion,
  Timestamp,
  type QueryConstraint,
  type QuerySnapshot,
} from "firebase/firestore";
import {
  callFunction,
  db,
  ensureAuthenticated,
  getCurrentAuthUid,
} from "./firebase.js";
import {
  resolveContext,
  resolveContextForWrite,
  resolveMissionContextForWrite,
  contextReadFilter,
  isLaneContextId,
  isOrchestratorAgentId,
  isTaskInReadContext,
  buildMissionStepReportedEvent,
  type MissionStepReportedEvent,
} from "./context.js";
import {
  applyProjection,
  resolveDependentIfReady,
  areDependenciesComplete,
  isDependencyGateOpen,
  computeTaskProjection,
  type ApplyProjectionInput,
} from "./projection.js";
import {
  selectProjectId,
  looksLikeFirestoreId,
  checkProjectLock,
  type ProjectLockFailure,
} from "./project-resolve.js";
import {
  requireProjectScope,
  isPermissionDeniedError,
  MissingProjectScopeError,
} from "./project-scope.js";
import { resolveToolSurface } from "./tool-surface.js";
import { postOrchestratorNotification } from "./notify-delivery.js";
import {
  validateTaskBodyInput,
  validateTaskBodySections,
  taskBodyStorageFields,
  composeTaskBody,
} from "./task-body.js";
import {
  buildImplicitMissionDoc,
  implicitAdoptionError,
  implicitAdoptionPatch,
  isImplicitMissionDoc,
  normalizeMissionLabel,
  selectJoinableImplicitMission,
  shouldCloseImplicitMission,
  type ImplicitMissionCandidate,
} from "./implicit-mission.js";
import {
  evaluateMissionAdvance,
  isMissionContextId,
  type AdvanceSiblingTask,
} from "./mission-advance.js";
import { describeResyncFollowup } from "./notify-resync-coverage.js";
import {
  emptyAdvanceState,
  isAdvanceSignalEnabled,
  type AdvanceStateSnapshot,
  type HarnessQuotaReading,
} from "./advance-guards.js";
import {
  evaluateMissionHandoff,
  toHandoffChainItem,
} from "./mission-handoff.js";
import { readOwnerInbound } from "./owner-inbound.js";
import { evaluateDeleteGuards, type DeleteMode } from "./task-delete.js";
import {
  addWorkChainItem,
  captureMergeHoldFollowUp,
  captureOwnerMission,
  captureWorkChainPromises,
  loadWorkChain,
  readWorkChain,
  updateWorkChainItem,
  workChainNudgeAfterTransition,
} from "./work-chain.js";
import {
  formatNoisePrunePlan,
  planAutoNoisePrune,
} from "./work-chain-capture.js";
import type { CaptureSurface, CreatedTaskFact } from "./work-chain-capture.js";
import {
  WORK_CHAIN_DONE_WHEN_VALUES,
  formatWorkChain,
  workChainFooter,
  type WorkChainDoneWhen,
} from "./work-chain-core.js";
import {
  getClaimOwnershipError,
  shouldReleaseClaimForStoppedAgent,
  taskStatusAfterClaimRelease,
} from "./task-ownership.js";
import {
  assessClaimHolder,
  decideClaimAuthority,
  formatClaimOverrideAudit,
  type ClaimAuthorityDecision,
  type ClaimHolderAssessment,
} from "./claim-authority.js";
import {
  appendQuestion,
  answerQuestion,
  clampQuestionText,
  formatAnswerDelivery,
  formatQuestionLine,
  formatQuestionNotification,
  markAnswerDelivery,
  markOwnerEscalation,
  newQuestionId,
  MAX_QUESTION_CHARS,
  openQuestions,
  parseQuestionId,
  readQuestions,
  type QuestionEntry,
} from "./question-channel.js";
import {
  classifyQuestionAudience,
  clampForTelegram,
  formatAudienceHint,
  formatOwnerEscalation,
} from "./escalation-policy.js";
import {
  approvalBudgetSpent,
  consumeApproval,
  decideApproval,
  effortFromDispatchArgs,
  formatApprovalDecision,
  formatApprovalRequest,
  isApprovalGatedEffort,
  parseGatedRungSpec,
  pendingRequestFor,
  readEscalationApprovals,
  stripEffortSuffix,
  usableApproval,
  usableApprovalLoose,
  GATED_LADDER_RUNGS,
  MAX_GATED_APPROVALS_PER_TASK,
  type EscalationApprovalRecord,
} from "./escalation-approval.js";
import {
  chunkBulkTasks,
  normalizeBulkTasksPayload,
} from "./bulk-task-payload.js";
import { classifyTaskType } from "./task-type.js";
import {
  aggregateEffectiveness,
  formatEffectivenessReport,
  rollupEffectivenessByModel,
  type EffectivenessInputRow,
} from "./routing-effectiveness.js";
import {
  formatModelGuidance,
  mergeModelGuidance,
  type GuidanceStaticPayload,
} from "./model-guidance-report.js";
import {
  formatAgentTaskRoleLabel,
  normalizeFirestoreFallbackAgentStatus,
} from "./agent-status-labels.js";
import {
  evaluateTerminalTaskReap,
  STALE_TERMINAL_REAP_MS,
} from "./agent-reap.js";
import {
  OPEN_TASK_STATUSES,
  OPEN_FETCH_CAP,
  summarizeListing,
  compareTasksForListing,
} from "./task-listing.js";
import {
  staleBuildNotice,
  staleSourceNotice,
  bakedBuildStamp,
} from "./build-info.js";
import {
  classifyWorktreeDir,
  unionKnownWorktrees,
  buildWorktreeAuditRows,
  summarizeSealStatus,
  pickLatestMerge,
  describeProcessLiveness,
  describeSafeToDelete,
  describeActivityAtDecisionTime,
  evaluateSubmitForReviewRisk,
  type WorktreeAuditEvent,
  type MergeHistoryRow,
  type MergeInfo,
  type ActivityWindowEvent,
} from "./worktree-audit.js";
import {
  MAX_SKILLS_PER_DISPATCH,
  resolveSkillRouting,
} from "./skill-registry.js";
import { preflightDispatchScopeInHead } from "./dispatch-scope-preflight.js";
import {
  formatCompletionReport,
  resolveCompletionReport,
  type CompletionSummary,
} from "./completion-report.js";
import {
  buildLedgerEvent,
  readAgentRuntimeContext,
  worktreeAttributionCwd,
  worktreesRoot,
  type LedgerEventKind,
} from "./ledger.js";
import {
  LedgerSpool,
  defaultSpoolDir,
  formatSpoolStatus,
  requireServerAck,
  spoolNotice,
  type SpoolNotice,
  type SpoolRecord,
} from "./ledger-spool.js";
import {
  ChainHeadStore,
  LedgerChainSealer,
  GENESIS_PREV_HASH,
} from "./ledger-chain.js";
import {
  evaluateMergeCloseout,
  formatMergeWikiDecisionPrompt,
  isWikiDecisionResolvedMessage,
  shouldPromptForMergeWikiDecision,
  parsePrNumber,
  branchMatchesTask,
  WIKI_DECISION_PENDING_MARKER,
  type MergeState,
  type MergeVerdict,
} from "./merge-closeout.js";
import {
  ingestWiki,
  lintWiki,
  queryWiki,
  readWiki,
  resolveWikiRoot,
} from "./wiki-maintenance.js";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawn } from "node:child_process";

// ── State Machine ────────────────────────────────────────────

type TaskStatus =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";

type ManagedAgentModel = "claude" | "gemini" | "gpt" | "grok" | "antigravity";

const MANAGED_AGENT_COMMAND: Readonly<Record<ManagedAgentModel, string>> = {
  claude: "claude",
  gemini: "gemini",
  gpt: "codex",
  grok: "grok",
  antigravity: "agy",
};

function normalizeAgentModel(model: string | undefined): string | undefined {
  return model === "codex" ? "gpt" : model;
}

function isManagedAgentModel(model: string): model is ManagedAgentModel {
  return Object.prototype.hasOwnProperty.call(MANAGED_AGENT_COMMAND, model);
}

function agentDocumentCommand(
  model: string | undefined,
  explicitCommand?: string,
): string {
  const normalized = normalizeAgentModel(model);
  if (normalized && isManagedAgentModel(normalized)) {
    return MANAGED_AGENT_COMMAND[normalized];
  }
  return explicitCommand || normalized || "claude";
}

// The 7-member TaskStatus value domain. Used to validate untrusted `status`
// strings before any transition/force logic (see update_task_status, P2-2).
const TASK_STATUS_VALUES: readonly TaskStatus[] = [
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
];
const TASK_STATUS_SET: ReadonlySet<string> = new Set(TASK_STATUS_VALUES);
function isTaskStatus(s: string): s is TaskStatus {
  return TASK_STATUS_SET.has(s);
}

// The dispatchable worker-role domain. Mirrors
// electron/orchestrator/task-decomposer.ts `VALID_ROLES` and the on-disk
// skills/<role>_agent.md set. A task written with a role no worker claims
// (a typo like "backedn", or a non-worker label) sits in TODO forever —
// invisible to get_available_tasks and every dispatch/watchdog feed — so we
// reject it at create time (P3-13) instead of stranding it silently. NOTE:
// "orchestrator" is a coordinator singleton, not a claimable task role, and is
// deliberately excluded.
const TASK_ROLE_VALUES = ["backend", "frontend", "test", "devops"] as const;
const TASK_ROLE_SET: ReadonlySet<string> = new Set(TASK_ROLE_VALUES);
function isTaskRole(r: string): boolean {
  return TASK_ROLE_SET.has(r);
}

// Priority domain: integer 1 (low) – 5 (urgent). 0 is the reserved
// "unprioritized" default for tasks created without an explicit priority (it
// sorts last under the priority-desc dispatch order). Explicit inputs are
// range-checked (P3-13) so a fat-fingered 50 / -1 / 3.5 can't skew that sort.
const TASK_PRIORITY_MIN = 1;
const TASK_PRIORITY_MAX = 5;
function isValidPriority(p: number): boolean {
  return (
    Number.isInteger(p) && p >= TASK_PRIORITY_MIN && p <= TASK_PRIORITY_MAX
  );
}

// Task status transition rules for the MCP / board write path.
//
// P3-10: this inline table is the authoritative transition set for MCP writes,
// and is kept byte-identical to the renderer's ENFORCEMENT copy in
// src/services/stateMachine.ts (imported by taskService.ts `assertTransition`).
// The two MUST stay in lockstep — an edge legal here but not there (or the
// reverse) lets the board UI and the MCP backend disagree on what a task may do
// next. Edit one, edit the other.
//
// Do NOT confuse this with electron/mcp-server/state-machine.ts, which holds an
// older, STRICTER table (e.g. TODO→CLAIMED only) plus a getAction() map. That
// file currently has no importers in the tree — it is dormant, not the source
// of truth. This table is intentionally a superset of it: the extra edges
// (TODO→DONE direct-complete, CLAIMED→REVIEW/DONE, IN_PROGRESS→DONE, …) are
// deliberate MCP affordances the orchestrator relies on, annotated below.
//
// CLAIMED → TODO is the manual claim-recall path (renderer's `unclaimTask`).
// TODO → DONE is the direct-complete path for logical / never-claimed tasks
// (orchestrator closes an internal sub-task out without a claim cycle) — no
// force=true needed.
const VALID_TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  TODO: ["CLAIMED", "IN_PROGRESS", "DONE"],
  CLAIMED: ["IN_PROGRESS", "REVIEW", "DONE", "FAILED", "TODO"],
  IN_PROGRESS: ["REVIEW", "DONE", "BLOCKED", "FAILED"],
  REVIEW: ["DONE", "TODO", "IN_PROGRESS"],
  BLOCKED: ["IN_PROGRESS", "TODO"],
  FAILED: ["TODO", "IN_PROGRESS"],
  DONE: [],
};

function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Helpers ──────────────────────────────────────────────────

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TASK_NNN_RE = /^TASK-(\d+)$/i;

const DEFAULT_PROJECT = process.env.MARBLO_PROJECT || "";
const SKILLS_DIR =
  process.env.MARBLO_SKILLS_DIR ||
  path.resolve(
    new URL(".", import.meta.url).pathname,
    "..",
    "..",
    "..",
    "skills",
  );

/**
 * Build headers for a bridge request, attaching the per-session bearer token so
 * the bridge's auth gate (local-RCE hardening) accepts the call. The token is
 * injected via MARBLO_BRIDGE_TOKEN by the parent (orchestrator / agent env) or
 * loaded from the ~/.marblo/bridge-token discovery file (external-CLI path) in
 * index.ts. When absent (no bridge reachable) the header is simply omitted —
 * the request fails the same way it would have anyway.
 */
function bridgeHeaders(extra?: Record<string, string>): Record<string, string> {
  const headers: Record<string, string> = { ...(extra ?? {}) };
  const token = process.env.MARBLO_BRIDGE_TOKEN;
  if (token) headers["Authorization"] = `Bearer ${token}`;
  return headers;
}

/**
 * 텔레그램 아웃바운드(브리지 경유). `send_telegram_message` · 사장님 승격
 * (`escalate_to_owner`) · 미션 핸드오프 질문(티켓 F2TAJlSgSP8Ag1qJNkp1)이
 * **같은 경로 하나**를 쓴다 — 봇 토큰은 이 경계를 넘지 않고, 에러 문자열은
 * poller 가 이미 토큰 스크럽한 것이다.
 *
 * ★모듈 스코프에 있는 이유: `registerTools` 안의 도구 핸들러뿐 아니라 완료
 * 후크(`handleMissionHandoffAfterClose`)도 이 경로를 써야 하는데, 아웃바운드가
 * 두 벌이 되면 토큰 취급 규율이 두 곳으로 갈라진다.
 */
async function sendTelegramViaBridge(
  projectId: string,
  messageText: string,
  chatId?: string,
): Promise<{ ok: boolean; chatId?: string; error?: string }> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) {
    return {
      ok: false,
      error: "MARBLO_BRIDGE_PORT not set. Bridge server not available.",
    };
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:${bridgePort}/send-telegram-message`,
      {
        method: "POST",
        headers: bridgeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ projectId, text: messageText, chatId }),
      },
    );
    return (await response.json()) as {
      ok: boolean;
      chatId?: string;
      error?: string;
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "network error",
    };
  }
}

/**
 * 정적 모델 지식을 메인 프로세스에서 가져온다(GET /model-guidance).
 *
 * 이 프로세스는 `model-registry.ts` 를 볼 수 없다(mcp tsconfig rootDir 경계) —
 * 그래서 브리지가 유일한 경로다. ★실패를 성공처럼 만들지 않는다: 못 받으면
 * `payload: null` + 사람이 읽는 사유를 돌려주고, 호출부가 "정적 절반 없음" 을
 * 리포트 첫 줄에 적는다. 빈 목록을 돌려주면 "모델이 없다" 로 오독된다.
 */
async function fetchModelGuidanceStatic(): Promise<{
  payload: GuidanceStaticPayload | null;
  error: string | null;
}> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) {
    return {
      payload: null,
      error:
        "브리지 포트를 모른다(MARBLO_BRIDGE_PORT 없음 — 앱 밖에서 뜬 MCP 프로세스)",
    };
  }
  try {
    const response = await fetch(
      `http://127.0.0.1:${bridgePort}/model-guidance`,
      { headers: bridgeHeaders() },
    );
    if (!response.ok) {
      return { payload: null, error: `브리지 응답 ${response.status}` };
    }
    const data = (await response.json()) as Partial<GuidanceStaticPayload>;
    if (!Array.isArray(data.models)) {
      return { payload: null, error: "브리지 응답에 models 배열이 없다" };
    }
    return {
      payload: {
        payloadVersion:
          typeof data.payloadVersion === "number" ? data.payloadVersion : 0,
        sources: data.sources ?? {},
        models: data.models,
        // 하네스별 잔여 쿼터(브리지가 라우터와 같은 합성으로 만든다). 구버전
        // 브리지는 안 보내므로 없으면 null — 리포트가 절을 통째로 생략한다.
        quota:
          data.quota && Array.isArray(data.quota.harnesses) ? data.quota : null,
      },
      error: null,
    };
  } catch (err) {
    return {
      payload: null,
      error: `브리지 호출 실패: ${
        err instanceof Error ? err.message : String(err)
      }`,
    };
  }
}

/**
 * 배달 경로가 남기는 티켓 activity 1건. `projection.lastActivityAt` 을 건드리지
 * 않는 직접 기록이라 워치독의 침묵 감지를 가리지 않는다. 절대 throw 하지
 * 않는다 — 기록 실패가 배달 경로를 깨면 안 된다.
 */
async function recordNotifyActivity(
  taskId: string,
  message: string,
  source: string,
): Promise<void> {
  try {
    await addDoc(collection(db, "activities"), {
      taskId,
      agentId: MARBLO_AGENT_ID || "system",
      message,
      createdAt: Timestamp.now(),
      source,
    });
  } catch (err) {
    console.error(`[${source}] activity write failed for ${taskId}:`, err);
  }
}

/**
 * Send a notification to the orchestrator via the bridge server.
 *
 * `contextId` scopes the notification to the right orchestrator (Quick Lanes
 * 눈/브레인 분리). The board orchestrator only owns context="board" tasks;
 * mission tasks carry contextId=missionId. Without this, every mission task's
 * status/activity/review notification was routed to the board orchestrator
 * (the only one the bridge's projectId lookup knew), flooding the main orch
 * PTY with mission progress. The bridge uses contextId to route mission-context
 * notifications to the mission orchestrator instead (and drop them from board).
 * Empty/"board" stays on the board orchestrator (unchanged behavior).
 *
 * ★더 이상 fire-and-forget 이 아니다(티켓 tHQzXPvFaR29fy0I82rM). 호출부를
 * 막지는 않지만(void) 응답을 읽어 전달 실패를 반드시 기록한다:
 *   - 콘솔에 항상(사후 진단의 최소 근거),
 *   - `delivery.recordFailure` 가 켜진 중요 알림(REVIEW 제출·DONE/FAILED/
 *     BLOCKED 전이·질문)은 티켓 activities 에도 남긴다 — 보드에서 보이는
 *     durable 기록이고, ★재전달이 실제로 있는지(보드 재동기화 스위프가 이
 *     상태를 다시 읽는지)는 `describeResyncFollowup` 이 계산해 사실대로 적는다
 *     — 예전엔 무조건 "다시 밀어줍니다" 라고 적어 거짓 위로가 됐다
 *     (티켓 B0G7agMgarQPqIYEc3Jq).
 * 예전 `.catch(()=>{})` 는 브리지가 injected:false 로 실패를 알려줘도 그
 * 사실째 버렸다 — 2026-09-01 REVIEW 알림 3건 유실이 조용했던 은폐 지점.
 */
function notifyOrchestrator(
  message: string,
  contextId?: string,
  delivery?: { taskId?: string; recordFailure?: boolean },
): void {
  // Forward MARBLO_PROJECT so the bridge routes to the right per-project
  // orchestrator in multi-window mode. Each MCP server is launched with
  // MARBLO_PROJECT set by the agent / orchestrator config generator, so
  // this scopes notifications correctly without renderer involvement.
  const projectId = process.env.MARBLO_PROJECT || "";
  void postOrchestratorNotification({
    bridgePort: process.env.MARBLO_BRIDGE_PORT,
    headers: bridgeHeaders({ "Content-Type": "application/json" }),
    projectId,
    contextId: contextId ?? "",
    message,
    // 주입 성공 시 브리지가 재동기화 스위프의 seen 기록으로 흘린다 —
    // 직접 알림이 닿은 항목을 다이제스트가 또 밀지 않게(이중 검증 방지).
    taskId: delivery?.taskId,
  })
    .then(async (result) => {
      // ★폴백을 탔으면 그 사실을 기록한다 — 배달은 성공이지만 "누가 받았는지"가
      //   달라졌다는 것은 조용히 넘길 사실이 아니다(티켓 B0G7agMgarQPqIYEc3Jq).
      if (result.outcome === "delivered" && result.viaFallback) {
        console.warn(
          `[MCP] orchestrator notification delivered via mission→board fallback: ${message.slice(
            0,
            120,
          )}`,
        );
        // ★recordFailure 와 같은 게이트 — 오케 행동이 필요한 알림만 durable
        //   기록한다. 안 그러면 미션 티켓의 모든 알림마다 activity 가 붙어
        //   그 자체가 새로운 소음이 된다.
        if (delivery?.recordFailure && delivery.taskId) {
          await recordNotifyActivity(
            delivery.taskId,
            `⤵ [알림 폴백 배달] 미션 오케가 없어 보드 오케로 전달했습니다` +
              `${result.fallbackReason ? ` (${result.fallbackReason})` : ""}. ` +
              `원문: ${message.slice(0, 200)}`,
            "notify-fallback",
          );
        }
      }
      if (result.outcome !== "failed") return;
      const reason = result.reason ?? "unknown";
      console.error(
        `[MCP] orchestrator notification NOT delivered (reason: ${reason}): ${message.slice(
          0,
          120,
        )}`,
      );
      if (!delivery?.recordFailure || !delivery.taskId) return;
      // ★후속 문장은 계산해서 적는다(티켓 B0G7agMgarQPqIYEc3Jq). 예전엔 여기에
      //   "보드 재동기화 스위프가 이 상태를 다시 밀어줍니다" 가 **무조건** 붙었는데
      //   그 문장은 대부분 거짓이었다 — 스위프는 미션 티켓을 통째로 제외하고
      //   (classifyResyncAttention 첫 줄), DONE·TODO 는 조회 대상도 아니다.
      //   그 거짓 위로가 폐루프 미작동을 몇 주간 숨겼다.
      await recordNotifyActivity(
        delivery.taskId,
        `⚠️ [알림 미전달] 오케스트레이터 알림이 전달되지 않았습니다 ` +
          `(사유: ${reason}). ${describeResyncFollowup({
            message,
            isMissionContext: isMissionContextId(contextId),
          })} ` +
          `원문: ${message.slice(0, 200)}`,
        "notify-failure",
      );
    })
    .catch((err) => {
      // postOrchestratorNotification 은 throw 하지 않는 계약이지만, 기록 경로가
      // 새 실패를 만들어도 조용히 두지 않는다.
      console.error("[MCP] notify delivery pipeline threw:", err);
    });
}

// ── 능동 프로브 (b) 풀형 관측 하트비트 (티켓 DQYoyas3ESx33zXJOCOa) ────────
//
// 워치독의 프로브 축은 "에이전트가 **스스로** 하는 다음 MCP 호출을 응답으로
// 인정" 한다. 그 도착 사실을 메인 프로세스에 알리는 게 이 함수다.
//
// ★왜 기존 auditLog 를 재사용하지 않나: 감사 원장은 ledgerSpool 로 비동기
//   배치되고 실패 시 최대 30분 뒤 재적재된다(§7). 그건 감사에는 맞지만 **생존
//   시계로는 못 쓴다** — 30분 늦게 도착한 타임스탬프로는 12분 유예를 못 잰다.
// ★왜 fire-and-forget 인가: 이 호출이 실패해도 툴 호출은 정상이어야 한다.
//   하트비트가 못 가면 프로브는 그 에이전트를 no-baseline / mcp-silent 로 보고,
//   신호를 올리더라도 그건 신호일 뿐 아무도 죽이지 않는다.
//
// 스로틀: 하트비트는 분 단위 해상도만 있으면 된다(유예 12분). 툴 호출마다
// POST 를 쏘면 브리지에 의미 없는 잡음이 쌓이므로 15초로 묶는다 — 유예 대비
// 1/48 이라 판정에 영향이 없다.
const MCP_HEARTBEAT_THROTTLE_MS = 15_000;
let lastHeartbeatSentAtMs = 0;

function noteMcpCallToBridge(toolName: string): void {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return;
  const agentId = process.env.MARBLO_AGENT_ID || "";
  if (!agentId || agentId === "unknown") return;
  // ★오케스트레이터는 워커가 아니다 — AgentManager 에 그런 인스턴스가 없어
  //   하트비트가 반드시 recorded:false 로 버려진다. 워치독의 프로브 축도 오케를
  //   보지 않는다(활성 티켓의 바운드 에이전트만 훑는다). 그러니 아예 쏘지 않아
  //   불필요한 브리지 왕복을 만들지 않는다.
  if (isOrchestratorAgentId(agentId)) return;
  const now = Date.now();
  if (now - lastHeartbeatSentAtMs < MCP_HEARTBEAT_THROTTLE_MS) return;
  lastHeartbeatSentAtMs = now;
  fetch(`http://127.0.0.1:${bridgePort}/agent-mcp-heartbeat`, {
    method: "POST",
    headers: bridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ agentId, agentName: agentId, tool: toolName }),
  }).catch(() => {
    /* best-effort — 실패는 '프로브 불가'로 떨어질 뿐 툴 호출을 막지 않는다 */
  });
}

/**
 * `notifyOrchestrator` 의 결과 확인형 변종 — 주입 성공 여부를 실제로 기다린다.
 *
 * 대부분의 알림은 fire-and-forget 이어도 된다(놓쳐도 티켓 타임라인에 남는다).
 * 질문은 다르다: 오케 PTY 에 안 들어갔다면 "물어봤다"가 거짓이 되고, 에이전트는
 * 오지 않을 답을 기다린다. 그래서 이 경로만 응답을 읽어 호출자에게 사실대로
 * 돌려준다(주입 실패 시 질문은 티켓에 open 으로 남아 get_open_questions 로 복구).
 */
async function notifyOrchestratorAwaited(
  message: string,
  contextId?: string,
): Promise<{ injected: boolean; error?: string }> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return { injected: false, error: "no bridge port" };
  const projectId = process.env.MARBLO_PROJECT || "";
  try {
    const res = await fetch(
      `http://127.0.0.1:${bridgePort}/notify-orchestrator`,
      {
        method: "POST",
        headers: bridgeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          message,
          projectId,
          contextId: contextId ?? "",
        }),
      },
    );
    const body = (await res.json()) as {
      success?: boolean;
      injected?: boolean;
      error?: string;
    };
    if (body.injected) return { injected: true };
    return {
      injected: false,
      error: body.error || "orchestrator PTY did not accept the message",
    };
  } catch (err) {
    return {
      injected: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

interface BridgeAgentSummary {
  id: string;
  name?: string;
  status?: string;
}

async function findLocalBridgeAgent(
  projectId: string,
  agentId: string,
): Promise<
  | { state: "found"; agent: BridgeAgentSummary }
  | { state: "not_found" }
  | { state: "unknown"; error: string }
> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return { state: "unknown", error: "no bridge port" };
  try {
    const url = new URL(`http://127.0.0.1:${bridgePort}/agents`);
    if (projectId) url.searchParams.set("projectId", projectId);
    const res = await fetch(url, { headers: bridgeHeaders() });
    if (!res.ok)
      return { state: "unknown", error: `bridge HTTP ${res.status}` };
    const body = (await res.json()) as { agents?: unknown };
    const agents = Array.isArray(body.agents) ? body.agents : [];
    for (const raw of agents) {
      if (typeof raw !== "object" || raw === null) continue;
      const a = raw as Record<string, unknown>;
      if (a.id !== agentId) continue;
      return {
        state: "found",
        agent: {
          id: String(a.id),
          name: typeof a.name === "string" ? a.name : undefined,
          status: typeof a.status === "string" ? a.status : undefined,
        },
      };
    }
    return { state: "not_found" };
  } catch (err) {
    return {
      state: "unknown",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

async function requireReadableProjectMember(projectId: string): Promise<
  | { ok: true }
  | {
      ok: false;
      message: string;
    }
> {
  try {
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) {
      return { ok: false, message: `Error: Project ${projectId} not found.` };
    }
    return { ok: true };
  } catch (err) {
    const uid = getCurrentAuthUid() || "unknown";
    const code = (err as { code?: unknown } | null)?.code;
    const suffix = typeof code === "string" ? ` (code=${code})` : "";
    return {
      ok: false,
      message:
        `Error: Firebase uid ${uid} is not authorized for project ${projectId}${suffix}. ` +
        "MCP task/activity/pendingInstructions tools use the client Firebase SDK and must pass firestore.rules isProjectMember(projectId); this is a project membership/auth path failure, not a rules-shape issue.",
    };
  }
}

/**
 * B안 Phase 2 보고 채널 — 오케스트레이터의 `mission_step_done` 을 미션 지휘자
 * (Conductor) 로 전달한다.
 *
 * MCP 서버는 별도 프로세스라 메인 프로세스의 in-process `MissionEventBus` 에 직접
 * emit 할 수 없다(spawn/dispatch 와 동일 제약). 그래서 bridge 로 POST 하면, 메인
 * 프로세스가 이 요청을 받아
 *   eventBus.emit({ type: "mission.step_reported", missionId, payload: { stepIndex, result } })
 * 로 변환한다. 계약: P2-A 지휘자가 이 이벤트를 구독해 `onStepReport` 로 처리.
 *
 * ── 통합 seam (P2-C 스코프 밖 — 메인 프로세스 1줄 배선) ──
 *   bridge-server: `POST /mission-step-report` 핸들러가 body `{missionId, stepIndex,
 *   result}` 를 파싱해 주입된 콜백 호출 → main.ts 가 그 콜백을 위 `eventBus.emit` 로
 *   연결. 이 엔드포인트가 아직 없으면 아래 fetch 는 조용히 무시된다(best-effort).
 *
 * Fire-and-forget — 보고 유실이 미션 진행을 막지 않도록 에러를 삼킨다.
 */
function emitMissionStepReport(event: MissionStepReportedEvent): void {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return;
  fetch(`http://127.0.0.1:${bridgePort}/mission-step-report`, {
    method: "POST",
    headers: bridgeHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      missionId: event.missionId,
      stepIndex: event.payload.stepIndex,
      result: event.payload.result,
    }),
  }).catch(() => {
    /* best-effort */
  });
}

// Firestore document IDs are 20-char alphanumeric strings
const FIRESTORE_ID_RE = /^[A-Za-z0-9]{15,}$/;

/**
 * Non-throwing project resolution for paths that must never fail — currently
 * only the audit-log tagging in `auditedTool`'s `finally` block, which runs
 * after the tool has already produced its result and just needs a best-effort
 * label. Every caller-facing path goes through `enforceProjectLock` instead.
 *
 * NOTE: this deliberately keeps the old "default wins" behavior. It is NOT a
 * query resolver — do not reintroduce it into a tool handler, or `project_id`
 * becomes silently ignored again (ticket IuucvLemDFvbh4UYmL1o).
 */
function resolveProjectForAudit(projectId?: string): string {
  if (DEFAULT_PROJECT) return DEFAULT_PROJECT;
  if (projectId && FIRESTORE_ID_RE.test(projectId)) return projectId;
  return "";
}

/**
 * Thrown when a `project_id` argument names a project other than the one this
 * orchestrator session is bound to. Thrown rather than returned as `text()` on
 * purpose: a refusal must not be mistakable for a (possibly empty) result set.
 */
class ProjectLockError extends Error {
  readonly reason: ProjectLockFailure;
  constructor(message: string, reason: ProjectLockFailure) {
    super(message);
    this.name = "ProjectLockError";
    this.reason = reason;
  }
}

/**
 * Resolve `project_id` for a read/query tool under governance decision B:
 * honor the argument, but refuse loudly when it points somewhere other than the
 * bound session project. Returns the project id to filter by ("" only when no
 * project context exists at all, which preserves the previous unfiltered read).
 *
 * @throws ProjectLockError on a cross-project or unidentifiable project_id.
 */
async function enforceProjectLock(
  toolName: string,
  projectId?: string,
): Promise<string> {
  const arg = (projectId ?? "").trim();

  // Only pay for a Firestore name lookup when the argument is actually a name.
  const nameResolvedTo =
    arg && !FIRESTORE_ID_RE.test(arg)
      ? await resolveProjectNameToId(arg)
      : undefined;

  const outcome = checkProjectLock({
    explicit: arg,
    bound: DEFAULT_PROJECT,
    nameResolvedTo,
    toolName,
  });

  if (!outcome.ok) throw new ProjectLockError(outcome.message, outcome.reason);
  return outcome.projectId;
}

/** True if a project document with this id exists (best-effort; on read error
 * we assume it exists so a transient Firestore blip can't block a create). */
async function projectExists(projectId: string): Promise<boolean> {
  if (!projectId) return false;
  try {
    const snap = await getDoc(doc(db, "projects", projectId));
    return snap.exists();
  } catch (err) {
    console.warn(`[MCP] projectExists(${projectId}) read failed:`, err);
    return true;
  }
}

async function readProjectOwnerId(projectId: string): Promise<string | null> {
  if (!projectId) return null;
  try {
    const snap = await getDoc(doc(db, "projects", projectId));
    if (!snap.exists()) return null;
    const data = snap.data() as { ownerId?: unknown };
    return typeof data.ownerId === "string" && data.ownerId.trim()
      ? data.ownerId
      : null;
  } catch (err) {
    console.warn(
      `[MCP] readProjectOwnerId(${projectId}) failed:`,
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

async function resolveAgentDocumentOwnerId(
  projectId: string,
): Promise<string | null> {
  const actorUid = getCurrentAuthUid();
  if (actorUid) return actorUid;
  return readProjectOwnerId(projectId);
}

/** Resolve a friendly project name (e.g. "마블로") to a real Firestore project
 * id by matching the projects collection `name` field. Returns null when no
 * unambiguous match exists. Best-effort — any read error yields null. */
async function resolveProjectNameToId(name: string): Promise<string | null> {
  try {
    const snap = await getDocs(
      query(collection(db, "projects"), where("name", "==", name)),
    );
    if (snap.size === 1) return snap.docs[0].id;
    return null;
  } catch (err) {
    console.warn(`[MCP] resolveProjectNameToId("${name}") failed:`, err);
    return null;
  }
}

interface ResolvedCreateProject {
  projectId: string;
  warning?: string;
}

/**
 * W7 — project resolution for create_task / create_tasks_bulk that actually
 * RESPECTS an explicit project_id instead of silently dropping it (the old
 * resolveProject always returned the bound DEFAULT_PROJECT). Rules:
 *   • explicit valid Firestore id → use it IF the project exists (else warn +
 *     fall back to the bound project so the task isn't filed into a phantom);
 *   • explicit friendly name → resolve via the projects collection, else warn +
 *     fall back to the bound project;
 *   • no explicit id → the bound project.
 * The fallback is deliberate: a task on the bound project is at least visible,
 * whereas a ghost project id makes it vanish from every board.
 */
async function resolveProjectForCreate(
  projectId?: string,
): Promise<ResolvedCreateProject> {
  const sel = selectProjectId(projectId, DEFAULT_PROJECT);

  if (sel.source === "explicit") {
    // Explicit valid id — honor it only if the project actually exists.
    if (await projectExists(sel.projectId)) {
      return { projectId: sel.projectId };
    }
    return {
      projectId: DEFAULT_PROJECT,
      warning:
        `project_id="${sel.projectId}" does not match any known project — ` +
        `filed under the bound project (${DEFAULT_PROJECT}) instead.`,
    };
  }

  if (sel.friendlyName) {
    const resolved = await resolveProjectNameToId(sel.friendlyName);
    if (resolved) return { projectId: resolved };
    return { projectId: sel.projectId, warning: sel.warning };
  }

  return { projectId: sel.projectId, warning: sel.warning };
}

/** Seed the projection field on a freshly-created task so the board's
 * projection-driven view shows it immediately (W7 — no lag between create and
 * board visibility). Pure computation; caller writes it with the doc. */
function seedProjectionForCreate(
  taskId: string,
  now: Timestamp,
): Record<string, unknown> {
  return computeTaskProjection(undefined, "TODO", taskId, now, {
    lastAgentId: "",
    lastActivitySummary: "created",
  }) as unknown as Record<string, unknown>;
}

interface TaskDoc {
  id: string;
  projectId: string;
  contextId: string;
  missionId?: string;
  title: string;
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  status: TaskStatus;
  role: string;
  priority: number;
  dependsOn: string[];
  dependsOnCompleted: boolean;
  claimedBy: string | null;
  scope: string[];
  comment: string;
  prUrl: string;
  hasPmFeedback: boolean;
  wikiDecision?: {
    status?: string;
    sourceTool?: string;
    promptedAt?: Timestamp;
    prNumber?: number;
    prUrl?: string;
  };
  /** soft-delete 표식 — true 면 목록/조회에서 숨긴다. */
  deleted?: boolean;
  /**
   * Layer A projection (projection.ts). fetchTask 가 문서를 통째로 spread 하므로
   * 런타임에는 늘 있었는데 타입에만 없었다. claim 보유자의 `silent` 판정이
   * lastActivityAt 를 읽으므로 여기 명시한다.
   */
  projection?: { lastActivityAt?: Timestamp };
}

interface AgentIdHint {
  id: string;
  name: string | null;
  role: string | null;
  status: string | null;
  currentTaskId: string | null;
  source: "Firestore" | "Bridge";
}

async function fetchTask(taskId: string): Promise<TaskDoc | null> {
  const ref = doc(db, "tasks", taskId);
  const snap = await getDoc(ref);
  if (!snap.exists()) return null;
  return { id: snap.id, ...snap.data() } as TaskDoc;
}

/**
 * Bind a board task to the agent a dispatch/reuse just routed work to, and
 * advance it out of TODO so the board + watchdog treat it as live.
 *
 * Two effects:
 *   1. claimedBy/claimedAt → the REAL worker. Overwrites a stale assignee left
 *      by a previous (now-dead) owner. ALWAYS applied (existing behavior).
 *   2. status TODO → CLAIMED. Before this, dispatch bound an agent but left the
 *      task in TODO, so the board showed it unstarted (a human had to flip it to
 *      IN_PROGRESS) and the watchdog's active scan (CLAIMED/IN_PROGRESS only)
 *      skipped it. The agent's first `add_activity` then promotes CLAIMED →
 *      IN_PROGRESS. Mirrors `claim_task` semantics (claim → CLAIMED).
 *
 * Reassign guard: status is advanced ONLY from TODO. A task already CLAIMED /
 * IN_PROGRESS / REVIEW / etc (re-dispatch or re-bind of an in-flight task) keeps
 * its status untouched — we never regress or stomp a more-advanced state. The
 * status move rides applyProjection so tasks/{id}.projection.currentStatus and
 * the mission's statusCounts stay in lockstep with the real status (a bare
 * updateDoc would leave both projections stale).
 *
 * Best-effort: a write failure is non-fatal (the agent is already dispatched),
 * surfaced via console.error for diagnosis.
 */
async function bindTaskToDispatchedAgent(
  taskId: string,
  agentId: string,
): Promise<void> {
  const extraTaskFields = {
    claimedBy: agentId,
    claimedAt: Timestamp.now(),
  };
  let task: TaskDoc | null = null;
  try {
    task = await fetchTask(taskId);
  } catch (err) {
    console.error("[dispatch bind] fetchTask failed:", err);
  }
  if (task?.status === "TODO") {
    try {
      await applyProjection(db, taskId, {
        newStatus: "CLAIMED",
        lastAgentId: agentId,
        lastActivitySummary: `dispatched to ${agentId}`,
        extraTaskFields,
        // Only advance from TODO. Re-checked inside the txn to close the TOCTOU
        // where a concurrent claim/update already moved the task; on abort we
        // fall through below to keep at least the claimedBy binding fresh.
        validateFrom: (s) => s === "TODO",
      });
      return;
    } catch (err) {
      console.error(
        "[dispatch bind] TODO→CLAIMED projection failed, keeping claimedBy only:",
        err,
      );
    }
  }
  // Already progressed (or the projection write aborted) — rebind the real
  // worker without touching status (respect the reassign guard; never regress).
  //
  // P3-9: this bare updateDoc is intentionally last-writer-wins on claimedBy —
  // and, unlike claim_task, has NO `claimedBy == null` precondition. That is by
  // design, not an oversight: a dispatch/reuse bind's whole purpose is to
  // OVERWRITE a stale assignee left by a previous (now-dead) owner, so a
  // null-precondition would defeat it (a re-dispatched in-flight task would
  // never rebind to its new real worker). Safe because binds run only from the
  // single orchestrator writer — no two agents bind the same task concurrently —
  // and dispatch is serialized per-taskId by withTaskLock, while the
  // get_available_tasks `!claimedBy` guard keeps a bound-but-still-TODO task out
  // of the claim feed. If binding ever becomes multi-writer, promote this to a
  // runTransaction that re-reads and refuses to stomp a claimedBy still owned by
  // a *live* agent.
  await updateDoc(doc(db, "tasks", taskId), extraTaskFields);
}

function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

async function fetchAgentIdHint(agentId: string): Promise<AgentIdHint | null> {
  if (!agentId) return null;

  try {
    const snap = await getDoc(doc(db, "agents", agentId));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      return {
        id: snap.id,
        name: nonEmptyString(data.name),
        role: nonEmptyString(data.role),
        status: nonEmptyString(data.status),
        currentTaskId: nonEmptyString(data.currentTaskId),
        source: "Firestore",
      };
    }
  } catch (err) {
    console.warn("[MCP] Failed to check agent id in Firestore:", err);
  }

  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return null;

  try {
    const projectId = process.env.MARBLO_PROJECT || "";
    const url = projectId
      ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
          projectId,
        )}`
      : `http://127.0.0.1:${bridgePort}/agents`;
    const response = await fetch(url, { headers: bridgeHeaders() });
    const data = (await response.json()) as {
      agents?: Array<Record<string, unknown>>;
    };
    const agents = Array.isArray(data.agents) ? data.agents : [];
    const match = agents.find((a) => nonEmptyString(a.id) === agentId);
    if (!match) return null;
    return {
      id: agentId,
      name: nonEmptyString(match.name),
      role: nonEmptyString(match.role),
      status: nonEmptyString(match.status),
      currentTaskId: nonEmptyString(match.currentTaskId),
      source: "Bridge",
    };
  } catch (err) {
    console.warn("[MCP] Failed to check agent id via bridge:", err);
    return null;
  }
}

function formatAgentIdAsTaskIdError(id: string, agent: AgentIdHint): string {
  const details = [
    agent.name ? `name=${agent.name}` : null,
    agent.role ? `role=${agent.role}` : null,
    agent.status ? `status=${agent.status}` : null,
    `source=${agent.source}`,
  ].filter((part): part is string => part !== null);
  const agentDetails = details.length ? ` (${details.join(", ")})` : "";
  const taskHint = agent.currentTaskId
    ? ` Use get_task with currentTaskId=${agent.currentTaskId}.`
    : " This agent has no currentTaskId, so there is no connected task to fetch.";
  return `Error: '${id}' is an agent id, not a task id.${agentDetails}${taskHint}`;
}

function text(t: string) {
  return { content: [{ type: "text" as const, text: t }] };
}

/**
 * Resolve every task that depends on a just-completed task (atomic, idempotent
 * — N4). Extracted from update_task_status so `merge_and_close` reaches DONE
 * through the exact same dependency-gate path: a DONE that skips this leaves
 * dependents pinned at dependsOnCompleted=false forever (the edge-trigger
 * sticking bug, PR#507), which is precisely the "ticket looks handled but the
 * board is wrong" failure this tool exists to stop.
 *
 * The per-dependent flip runs inside a transaction (resolveDependentIfReady)
 * that re-checks the flag and all upstream statuses atomically, so two
 * dependencies completing concurrently cannot both observe a stale false and
 * double-notify the orchestrator (-> duplicate dispatch of the same task). Each
 * dependent is isolated in its own try/catch so one transient failure does not
 * strand the rest. notify fires only for the transaction that actually
 * performed the flip -> exactly once per unblocked task.
 *
 * @returns how many dependents this call unblocked.
 */
async function resolveDependentsAfterDone(
  taskId: string,
  contextId: string,
  projectId: string,
): Promise<number> {
  let depDocs: Array<{ id: string }> = [];
  try {
    // ★projectId 필수 — 무스코프였을 때 이 쿼리는 룰에 100% 거부됐고, catch 가
    // 그걸 삼켜 "DONE 인데 후행이 영영 안 열린다"가 조용히 성립했다(#4ov5wbQZ).
    const depQ = query(
      collection(db, "tasks"),
      where(
        "projectId",
        "==",
        requireProjectScope("tasks", projectId, "resolveDependentsAfterDone"),
      ),
      where("dependsOn", "array-contains", taskId),
    );
    depDocs = (await getDocs(depQ)).docs;
  } catch (err) {
    console.error("[MCP] Dependency query error:", err);
  }

  let unblocked = 0;
  for (const depDoc of depDocs) {
    try {
      const res = await resolveDependentIfReady(db, depDoc.id, taskId);
      if (res.unblocked) {
        unblocked++;
        // Notify orchestrator about newly unblocked task. Scope to the
        // completed task's context — a mission's dependents share its
        // contextId, so this routes to the same (mission/board) orch.
        // Lane dependents stay silent (P4): a Quick Lane's readiness is
        // not an orch wake event — board orch picks lane work up via the
        // board card, not a PTY inject.
        if (!isLaneContextId(contextId)) {
          notifyOrchestrator(
            `[Dependency Resolved] "${res.title}" is now ready (all dependencies met, id=${depDoc.id}, role=${res.role})`,
            contextId,
            { taskId: depDoc.id, recordFailure: true },
          );
        }
      }
    } catch (err) {
      console.error(`[MCP] Dependency resolution error for ${depDoc.id}:`, err);
    }
  }
  return unblocked;
}

// ── merge_and_close: gh merge-state resolution ───────────────
//
// The merge fact is read from `gh`, NOT from git ancestry. Both merge paths in
// this product squash (GitHub's squash-merge and the app's own
// squashMergeToBase), and a squash creates a NEW commit on base — the branch's
// commits never become ancestors of base. So `git rev-list base..HEAD == 0`
// (WorktreeManager.isMergedIntoBase / reap's `requireMerged`) reports "not
// merged" for every squash-merged PR, forever. gh is the only source that
// actually knows.

interface GhRun {
  code: number;
  stdout: string;
  stderr: string;
}

/** Run `gh` with a hard timeout. Never throws — a missing/failing gh resolves
 *  to a non-zero code so the caller degrades to an explicit UNKNOWN. */
function runGh(
  args: string[],
  cwd: string,
  timeoutMs = 20_000,
): Promise<GhRun> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("gh", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (e) {
      resolve({
        code: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: GhRun) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      done({ code: -1, stdout, stderr: `gh timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (e) =>
      done({ code: -1, stdout, stderr: e.message || String(e) }),
    );
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}

/** A directory inside the repo for gh to resolve the remote from. The MCP
 *  process's own cwd is the agent's worktree, which may already be gone (the
 *  app tears it down on merge) — fall back through the known candidates. */
function ghWorkingDir(): string {
  const candidates = [
    process.env.MARBLO_PROJECT_ROOT,
    process.cwd(),
    os.homedir(),
  ];
  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }
  return os.homedir();
}

interface GhPrRow {
  number?: number;
  state?: string;
  url?: string;
  mergedAt?: string | null;
  mergeStateStatus?: string;
  headRefName?: string;
}

const PR_JSON_FIELDS = "number,state,url,mergedAt,mergeStateStatus,headRefName";

function toMergeVerdict(row: GhPrRow): MergeVerdict {
  const raw = (row.state ?? "").toUpperCase();
  // gh reports MERGED/OPEN/CLOSED. `mergedAt` is the belt-and-braces check: a
  // PR is only MERGED if GitHub stamped a merge time.
  const state: MergeState =
    raw === "MERGED" && row.mergedAt
      ? "MERGED"
      : raw === "OPEN"
        ? "OPEN"
        : raw === "CLOSED"
          ? "CLOSED"
          : "UNKNOWN";
  const verdict: MergeVerdict = { state };
  if (typeof row.number === "number") verdict.prNumber = row.number;
  if (row.url) verdict.url = row.url;
  if (row.mergeStateStatus) verdict.mergeStateStatus = row.mergeStateStatus;
  if (raw === "MERGED" && !row.mergedAt) {
    verdict.detail = "gh 가 MERGED 라고 했지만 mergedAt 이 비어 있다";
  }
  return verdict;
}

/**
 * Find the PR backing a task and read its merge state. Resolution order:
 *   1. an explicit pr_number argument
 *   2. the PR number recorded on the ticket (`prUrl`, set by submit_for_review)
 *   3. an explicit branch argument
 *   4. the task's worktree branch, matched by the `-<taskId8>` suffix convention
 *
 * Any failure (no gh, not authenticated, no PR found) returns UNKNOWN with a
 * reason — never a guess. UNKNOWN changes nothing downstream.
 */
async function resolveMergeVerdict(args: {
  taskId: string;
  prNumber?: number;
  branch?: string;
  prUrl?: string;
}): Promise<MergeVerdict> {
  const cwd = ghWorkingDir();
  const parse = <T>(raw: string): T | null => {
    try {
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  };

  const number = args.prNumber ?? parsePrNumber(args.prUrl) ?? undefined;
  if (number) {
    const res = await runGh(
      ["pr", "view", String(number), "--json", PR_JSON_FIELDS],
      cwd,
    );
    if (res.code !== 0) {
      return {
        state: "UNKNOWN",
        prNumber: number,
        detail: `gh pr view 실패: ${
          res.stderr.trim().split("\n")[0] || `exit ${res.code}`
        }`,
      };
    }
    const row = parse<GhPrRow>(res.stdout);
    if (!row)
      return {
        state: "UNKNOWN",
        prNumber: number,
        detail: "gh 응답 파싱 실패",
      };
    return toMergeVerdict(row);
  }

  if (args.branch) {
    const res = await runGh(
      // --state all so an already-merged PR is still found.
      [
        "pr",
        "list",
        "--head",
        args.branch,
        "--state",
        "all",
        "--limit",
        "5",
        "--json",
        PR_JSON_FIELDS,
      ],
      cwd,
    );
    const rows = res.code === 0 ? parse<GhPrRow[]>(res.stdout) : null;
    if (!rows || rows.length === 0) {
      return {
        state: "UNKNOWN",
        detail: `브랜치 ${args.branch} 에 연결된 PR 을 찾지 못했다`,
      };
    }
    // Prefer a merged PR if the branch was reused across several.
    const merged = rows.find((r) => (r.state ?? "").toUpperCase() === "MERGED");
    return toMergeVerdict(merged ?? rows[0]);
  }

  // Last resort: scan recent PRs for the task's branch-name suffix.
  const res = await runGh(
    [
      "pr",
      "list",
      "--state",
      "all",
      "--limit",
      "150",
      "--json",
      PR_JSON_FIELDS,
    ],
    cwd,
  );
  if (res.code !== 0) {
    return {
      state: "UNKNOWN",
      detail: `gh pr list 실패: ${
        res.stderr.trim().split("\n")[0] || `exit ${res.code}`
      }`,
    };
  }
  const rows = parse<GhPrRow[]>(res.stdout) ?? [];
  const hits = rows.filter((r) =>
    branchMatchesTask(r.headRefName ?? "", args.taskId),
  );
  if (hits.length === 0) {
    return {
      state: "UNKNOWN",
      detail:
        "이 태스크에 연결된 PR 을 찾지 못했다 (prUrl 미기록 + 최근 150건에 브랜치 없음). " +
        "pr_number 나 branch 를 직접 넘겨라.",
    };
  }
  const merged = hits.find((r) => (r.state ?? "").toUpperCase() === "MERGED");
  return toMergeVerdict(merged ?? hits[0]);
}

/** Ask the app (bridge) to reap this task's worktree. The bridge owns repoRoot
 *  resolution, the live-agent guard, and WorktreeManager's work-loss guard —
 *  a dirty or unpushed tree is preserved there, never here. */
async function reapTaskWorktree(
  taskId: string,
): Promise<{ removed: boolean; reason: string; path?: string }> {
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  const projectId = process.env.MARBLO_PROJECT;
  if (!bridgePort || !projectId) {
    return {
      removed: false,
      reason:
        "브리지 미연결 (MARBLO_BRIDGE_PORT/MARBLO_PROJECT 부재) — 워크트리 정리 생략",
    };
  }
  try {
    const res = await fetch(`http://127.0.0.1:${bridgePort}/reap-worktree`, {
      method: "POST",
      headers: bridgeHeaders({ "Content-Type": "application/json" }),
      // NOTE: deliberately no `requireMerged`. That flag is a git-ancestry check
      // which is always false for a squash merge; we have already proven the
      // merge via gh. The reap's own work-loss guard (dirty / unpushed) still
      // applies, so nothing can be destroyed by skipping it.
      body: JSON.stringify({ projectId, taskId }),
    });
    const body = (await res.json()) as {
      removed?: boolean;
      reason?: string;
      path?: string;
      error?: string;
    };
    if (body.error) return { removed: false, reason: body.error };
    return {
      removed: !!body.removed,
      reason: body.reason ?? (body.removed ? "removed" : "no reason given"),
      ...(body.path ? { path: body.path } : {}),
    };
  } catch (e) {
    return {
      removed: false,
      reason: `브리지 호출 실패: ${e instanceof Error ? e.message : String(e)}`,
    };
  }
}

async function fetchAgentRole(agentId: string): Promise<string | null> {
  if (!agentId || agentId === "unknown" || isOrchestratorAgentId(agentId)) {
    return null;
  }
  try {
    const snap = await getDoc(doc(db, "agents", agentId));
    if (!snap.exists()) return null;
    const role = snap.data().role;
    return typeof role === "string" && role.trim() ? role : null;
  } catch (err) {
    console.warn("[MCP] Failed to fetch agent role:", err);
    return null;
  }
}

async function markAgentStoppedInFirestore(agentId: string): Promise<void> {
  if (!agentId) return;
  try {
    await updateDoc(doc(db, "agents", agentId), {
      status: "stopped",
      currentTaskId: null,
      updatedAt: Timestamp.now(),
    });
  } catch (err) {
    console.warn("[MCP] Failed to mark killed agent stopped:", err);
  }
}

/** agents/{id}.projectId (단건 get 이라 룰상 안전). 없거나 실패하면 "". */
async function readAgentProjectId(agentId: string): Promise<string> {
  try {
    const snap = await getDoc(doc(db, "agents", agentId));
    if (!snap.exists()) return "";
    const pid = (snap.data() as { projectId?: unknown }).projectId;
    return typeof pid === "string" ? pid.trim() : "";
  } catch {
    return "";
  }
}

/**
 * 죽인 에이전트가 잡고 있던 클레임을 푼다.
 *
 * ★projectId 스코프 필수 (티켓 4ov5wbQZ25XUXHZVhxdh). 예전엔 `claimedBy` 단독
 * 쿼리라 룰이 이 list 를 항상 거부했고, 바깥 catch 가 그걸 warn 으로 삼켜서
 * **"죽은 클레임 자동 해제"가 한 번도 동작한 적이 없었다** — 그 결과 죽은
 * 에이전트가 잡고 있던 티켓은 다른 에이전트가 손대지 못하는 상태로 남았다.
 * agents/{id}.projectId 를 우선 쓰고, 없으면 세션 바인딩(MARBLO_PROJECT)로 폴백.
 */
async function releaseTaskClaimsForStoppedAgent(
  agentId: string,
  projectIdHint?: string,
): Promise<number> {
  if (!agentId) return 0;
  let released = 0;
  try {
    const projectId =
      (projectIdHint ?? "").trim() ||
      (await readAgentProjectId(agentId)) ||
      DEFAULT_PROJECT;
    const claimedTasks = await getDocs(
      query(
        collection(db, "tasks"),
        where(
          "projectId",
          "==",
          requireProjectScope(
            "tasks",
            projectId,
            "releaseTaskClaimsForStoppedAgent",
          ),
        ),
        where("claimedBy", "==", agentId),
      ),
    );
    const now = Timestamp.now();
    let revived = 0;
    for (const taskDoc of claimedTasks.docs) {
      const data = taskDoc.data() as {
        claimedBy?: string | null;
        status?: unknown;
      };
      if (
        !shouldReleaseClaimForStoppedAgent({
          claimedBy: data.claimedBy ?? null,
          stoppedAgentId: agentId,
        })
      ) {
        continue;
      }
      try {
        // ★진단 §5.3-b. claim 만 풀고 status 를 IN_PROGRESS 로 두면 아무도 못 집는다
        // (get_available_tasks 도 claim_task 도 TODO 만 받는다). 제출 전 상태만
        // TODO 로 되돌려 실제로 되살린다.
        const revivedStatus = taskStatusAfterClaimRelease(data.status);
        await updateDoc(doc(db, "tasks", taskDoc.id), {
          claimedBy: null,
          claimedAt: null,
          ...(revivedStatus ? { status: revivedStatus } : {}),
          updatedAt: now,
        });
        released++;
        if (revivedStatus) {
          revived++;
          console.log(
            `[MCP] Revived task ${taskDoc.id} ${String(
              data.status,
            )} → ${revivedStatus} after releasing dead agent ${agentId}'s claim`,
          );
        }
      } catch (err) {
        console.warn(
          `[MCP] Failed to release claim for stopped agent ${agentId} on task ${taskDoc.id}:`,
          err,
        );
      }
    }
    if (released > 0) {
      console.log(
        `[MCP] Released ${released} claim(s) from stopped agent ${agentId}; ${revived} task(s) revived to TODO`,
      );
    }
  } catch (err) {
    console.warn(
      `[MCP] Failed to query claimed tasks for stopped agent ${agentId}:`,
      err,
    );
  }
  return released;
}

async function markAgentStoppedAndReleaseClaims(
  agentId: string,
): Promise<void> {
  await markAgentStoppedInFirestore(agentId);
  await releaseTaskClaimsForStoppedAgent(agentId);
}

function applyMissionContextTags(
  data: Record<string, unknown>,
  missionId: string | null = resolveMissionContextForWrite(),
): string | null {
  if (!missionId) return null;

  const existingMissionId = data.missionId;
  if (
    typeof existingMissionId === "string" &&
    existingMissionId.length > 0 &&
    existingMissionId !== missionId
  ) {
    return `missionId mismatch: existing '${existingMissionId}' does not match MARBLO_CONTEXT '${missionId}'.`;
  }

  const existingContextId = data.contextId;
  if (
    typeof existingContextId === "string" &&
    existingContextId.length > 0 &&
    existingContextId !== missionId
  ) {
    return `contextId mismatch: existing '${existingContextId}' does not match mission context '${missionId}'.`;
  }

  data.missionId = missionId;
  data.contextId = missionId;
  return null;
}

async function ensureTaskMissionContext(
  taskId: string,
  task: TaskDoc,
  missionId: string | null = resolveMissionContextForWrite(),
): Promise<string | null> {
  if (!missionId) return null;

  if (task.missionId && task.missionId !== missionId) {
    return `Task ${taskId} belongs to missionId '${task.missionId}', not current mission context '${missionId}'.`;
  }
  if (task.contextId && task.contextId !== missionId) {
    return `Task ${taskId} has contextId '${task.contextId}', not current mission context '${missionId}'.`;
  }

  const patch: Record<string, unknown> = {};
  if (!task.missionId) patch.missionId = missionId;
  if (!task.contextId) patch.contextId = missionId;
  if (Object.keys(patch).length > 0) {
    patch.updatedAt = Timestamp.now();
    await updateDoc(doc(db, "tasks", taskId), patch);
  }

  return null;
}

// ── 암묵적 미션 (ad-hoc 배치 → Replay 단위) ────────────────────
//
// 설계: `docs/MISSION-REPLAY-DESIGN.md` §2.1. 규칙은 전부 순수 모듈
// (`implicit-mission.ts`)에 있고 여기는 Firestore I/O 만 한다.
//
// 핵심: 새 그룹핑 경로를 만들지 않는다. 오케가 라벨을 주면 가벼운 미션 문서를
// 만들고 그 배치의 티켓 contextId 를 그 missionId 로 돌려놓는다 — 그러면
// 기존 Replay 파이프라인(tasks where contextId == missionId)이 그대로 잡는다.

const MISSIONS_COLLECTION = "missions";

/** 라벨 → missionId. 같은 라벨의 열린 미션이 있으면 합류, 없으면 생성. */
async function resolveImplicitMissionId(
  projectId: string,
  rawLabel: string,
  rawGoal: string | undefined,
): Promise<{ missionId: string; created: boolean }> {
  const label = normalizeMissionLabel(rawLabel);
  if (!label) throw new Error("mission_label is empty after normalization.");

  // 동등비교만 쓴다(projectId + implicitLabel). Firestore 는 equality-only
  // 쿼리를 단일필드 인덱스 병합으로 처리하므로 복합 인덱스를 새로 만들 필요가
  // 없다. 정렬(최근 활동순)은 메모리에서 — orderBy 를 붙이는 순간 복합
  // 인덱스가 필요해지고, 그건 배포 절차를 하나 더 만드는 값이다.
  const snap = await getDocs(
    query(
      collection(db, MISSIONS_COLLECTION),
      where("projectId", "==", projectId),
      where("implicitLabel", "==", label),
    ),
  );
  const candidates: ImplicitMissionCandidate[] = snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const lastActivity = data.lastActivityAt;
    return {
      id: d.id,
      status: typeof data.status === "string" ? data.status : undefined,
      missionKind:
        typeof data.missionKind === "string" ? data.missionKind : undefined,
      implicitLabel:
        typeof data.implicitLabel === "string" ? data.implicitLabel : undefined,
      projectId:
        typeof data.projectId === "string" ? data.projectId : undefined,
      lastActivityMs:
        lastActivity instanceof Timestamp ? lastActivity.toMillis() : 0,
    };
  });

  const joinable = selectJoinableImplicitMission(candidates, label, projectId);
  if (joinable) return { missionId: joinable.id, created: false };

  const ref = await addDoc(
    collection(db, MISSIONS_COLLECTION),
    buildImplicitMissionDoc({
      projectId,
      label,
      goal: rawGoal,
      ownerOrchestratorSessionId:
        MARBLO_ORCHESTRATOR_PTY_SESSION_ID || MARBLO_AGENT_ID || "",
      now: new Date(),
    }),
  );
  return { missionId: ref.id, created: true };
}

/** 미션의 보조 인덱스(taskIds) 갱신. 1급 조인키는 task.contextId 라 실패해도 치명적이지 않다. */
async function appendImplicitMissionTaskIds(
  missionId: string,
  taskIds: readonly string[],
): Promise<void> {
  if (taskIds.length === 0) return;
  try {
    await updateDoc(doc(db, MISSIONS_COLLECTION, missionId), {
      taskIds: arrayUnion(...taskIds),
      lastActivityAt: Timestamp.now(),
    });
  } catch (err) {
    // taskIds 는 설계상 **보조 인덱스**다(§2.1: 배열이라 드리프트 가능).
    // 집계는 contextId 로 하므로 여기서 실패해도 Replay 는 성립한다.
    console.warn("[implicit-mission] taskIds append failed:", err);
  }
}

/**
 * 이미 있는 티켓을 암묵적 미션에 입양. 성공하면 `null`, 거부하면 사유 문자열.
 * 보드 티켓만 입양한다 — 레인/명시적 미션 소속은 절대 덮지 않는다.
 */
async function adoptTaskIntoImplicitMission(
  taskId: string,
  task: { contextId?: string; missionId?: string },
  missionId: string,
): Promise<string | null> {
  const refusal = implicitAdoptionError(taskId, task, missionId);
  if (refusal) return refusal;

  const patch = implicitAdoptionPatch(task, missionId);
  if (Object.keys(patch).length > 0) {
    await updateDoc(doc(db, "tasks", taskId), {
      ...patch,
      updatedAt: Timestamp.now(),
    });
  }
  await appendImplicitMissionTaskIds(missionId, [taskId]);
  return null;
}

/**
 * 배치가 다 끝났으면 암묵적 미션을 completed 로 닫는다 → 그 순간 Replay 에 뜬다.
 *
 * DONE 전이 직후에만 부른다. 실패해도 호출부의 상태 전이는 이미 커밋됐으므로
 * 절대 throw 하지 않는다(Replay 라벨 갱신이 티켓 진행을 막으면 안 된다).
 *
 * @returns 이 호출이 실제로 미션을 닫았으면 missionId, 아니면 null.
 */
async function closeImplicitMissionIfComplete(
  contextId: string | undefined,
): Promise<string | null> {
  if (!contextId || contextId === "board" || isLaneContextId(contextId)) {
    return null;
  }
  try {
    const missionRef = doc(db, MISSIONS_COLLECTION, contextId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return null;
    const mission = missionSnap.data() as Record<string, unknown>;
    if (!isImplicitMissionDoc(mission as { missionKind?: string })) return null;

    // ★projectId 필수 — 미션 문서의 projectId 를 쓴다(없으면 세션 바인딩).
    // 무스코프였을 때 이 쿼리는 룰에 거부돼 암묵적 미션이 영영 안 닫혔다.
    const missionProjectId =
      typeof mission.projectId === "string" ? mission.projectId.trim() : "";
    const tasksSnap = await getDocs(
      query(
        collection(db, "tasks"),
        where(
          "projectId",
          "==",
          requireProjectScope(
            "tasks",
            missionProjectId || DEFAULT_PROJECT,
            "closeImplicitMissionIfComplete",
          ),
        ),
        where("contextId", "==", contextId),
      ),
    );
    const tasks = tasksSnap.docs.map((d) => ({
      status: String((d.data() as Record<string, unknown>).status ?? ""),
    }));

    if (
      !shouldCloseImplicitMission(
        mission as { status?: string; missionKind?: string },
        tasks,
      )
    ) {
      return null;
    }

    const now = Timestamp.now();
    await updateDoc(missionRef, {
      status: "completed",
      completedAt: now,
      lastActivityAt: now,
    });
    return contextId;
  } catch (err) {
    console.warn("[implicit-mission] close check failed:", err);
    return null;
  }
}

// ── 미션 전진 신호 — 완료가 다음을 부르게 (티켓 Sf8Id64jLeyDvWIS4cub) ──────
//
// 설계 단일소스: v3/docs/mission-advance-signal-design-2026-09-04.md.
// 판정은 전부 `mission-advance.ts` / `advance-guards.ts` 의 순수 함수가 하고,
// 여기는 Firestore I/O 와 배달만 한다(merge-closeout 과 같은 분리).
//
// ★후크 지점이 DONE 전이인 이유(§2): merge_and_close 는 evaluateMergeCloseout
//   을 거쳐 DONE 으로 흘러들어오므로 DONE 후크가 머지 경로를 **포함**한다.
//   반대로 머지 시점에 걸면 "머지됐지만 후속 남음"(HOLD_REVIEW) 케이스에서
//   전부 오발한다 — 코드 머지 ≠ 작업 완료.

/** `missions/{id}.advanceState` 읽기 — 필드가 없으면 초기 상태. */
function readAdvanceState(
  mission: Record<string, unknown>,
): AdvanceStateSnapshot {
  const raw = mission.advanceState;
  if (!raw || typeof raw !== "object") return emptyAdvanceState();
  const s = raw as Record<string, unknown>;
  const ids = Array.isArray(s.signaledTaskIds)
    ? s.signaledTaskIds.filter((v): v is string => typeof v === "string")
    : [];
  return {
    consecutiveSignals:
      typeof s.consecutiveSignals === "number" ? s.consecutiveSignals : 0,
    stagnantSignals:
      typeof s.stagnantSignals === "number" ? s.stagnantSignals : 0,
    lastOpenCount:
      typeof s.lastOpenCount === "number" ? s.lastOpenCount : undefined,
    signaledTaskIds: ids,
    haltReason: typeof s.haltReason === "string" ? s.haltReason : null,
  };
}

/**
 * 사장님 입력이 대기 중인가 — 자율 진행보다 **항상 우선**한다(§7-5).
 *
 * 두 축을 본다. 둘 다 "지금 사람이 루프 안에 있다"는 관측이다:
 *   (a) 미션 티켓 중 **미해결 질문**이 있는 것 — 누군가 물었고 답이 안 왔다.
 *   (b) **미소비 오너 인바운드** — 사장님이 방금 말씀하셨는데 아직 일이 안 됐다.
 *       인바운드 저널은 수명이 짧아(몇 분) 오래된 줄로 오탐하지 않는다.
 * (a) 는 이미 읽은 형제 문서에서 공짜로 나오고, (b) 는 로컬 파일이라 Firestore
 * 읽기가 늘지 않는다.
 */
async function isOwnerInputPending(
  siblingDocs: readonly Record<string, unknown>[],
  projectId: string,
): Promise<boolean> {
  for (const d of siblingDocs) {
    if (openQuestions(readQuestions(d.questions)).length > 0) return true;
  }
  try {
    const inbound = await readOwnerInbound(projectId);
    return inbound.some(
      (e) => !e.consumed || Object.keys(e.consumed).length === 0,
    );
  } catch {
    // 저널을 못 읽는 것은 "입력이 없다"는 근거가 아니지만, 그것 때문에 전진을
    // 영구히 막으면 그게 또 하나의 조용한 정지다. (a) 축은 이미 봤다.
    return false;
  }
}

/**
 * DONE 전이 직후 호출 — 이 티켓이 미션의 마지막인지 중간인지 판정하고, 중간이면
 * 오케에게 "다음은 이것들" 신호를 넣는다.
 *
 * ★절대 throw 하지 않는다. 상태 전이는 이미 커밋됐고, 전진 신호가 티켓 진행을
 *   깨면 안 된다(closeImplicitMissionIfComplete 와 같은 규율).
 *
 * @returns 호출자가 응답 문장에 덧붙일 짧은 노트. 없으면 "".
 */
async function signalMissionAdvanceAfterDone(
  taskId: string,
  task: { contextId?: string; projectId?: string; title?: string },
): Promise<string> {
  // 기본값 OFF — 꺼져 있으면 아무것도 읽지 않는다(회귀 0).
  if (!isAdvanceSignalEnabled()) return "";
  const contextId = task.contextId;
  if (!isMissionContextId(contextId)) return "";

  try {
    const missionRef = doc(db, MISSIONS_COLLECTION, contextId as string);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return "";
    const missionData = missionSnap.data() as Record<string, unknown>;

    const missionProjectId =
      typeof missionData.projectId === "string"
        ? missionData.projectId.trim()
        : "";
    const projectId = missionProjectId || task.projectId || DEFAULT_PROJECT;

    const tasksSnap = await getDocs(
      query(
        collection(db, "tasks"),
        where(
          "projectId",
          "==",
          requireProjectScope(
            "tasks",
            projectId,
            "signalMissionAdvanceAfterDone",
          ),
        ),
        where("contextId", "==", contextId),
      ),
    );
    // ★타입 주석은 장식이 아니다. `{ id, ...(rec as Record<string, unknown>) }`
    // 는 TS 가 인덱스 시그니처를 **버리고** `{ id: string }` 으로 좁힌다
    // (스프레드만 있으면 유지되는데, 명시 프로퍼티가 하나라도 붙으면 사라진다).
    // 그래서 아래 `d.title` 부터 전부 TS2339 였다.
    const siblingDocs: (Record<string, unknown> & { id: string })[] =
      tasksSnap.docs.map((d) => ({
        id: d.id,
        ...(d.data() as Record<string, unknown>),
      }));
    const siblings: AdvanceSiblingTask[] = siblingDocs.map((d) => ({
      id: String(d.id),
      title: typeof d.title === "string" ? d.title : null,
      status: typeof d.status === "string" ? d.status : null,
      role: typeof d.role === "string" ? d.role : null,
      priority: typeof d.priority === "number" ? d.priority : null,
      claimedBy: typeof d.claimedBy === "string" ? d.claimedBy : null,
      dependsOn: Array.isArray(d.dependsOn)
        ? d.dependsOn.filter((v): v is string => typeof v === "string")
        : null,
      dependsOnCompleted:
        typeof d.dependsOnCompleted === "boolean" ? d.dependsOnCompleted : null,
      description: typeof d.description === "string" ? d.description : null,
      comment: typeof d.comment === "string" ? d.comment : null,
      deleted: d.deleted === true,
    }));

    const state = readAdvanceState(missionData);
    const verdict = evaluateMissionAdvance({
      finishedTaskId: taskId,
      finishedTaskTitle: task.title ?? null,
      contextId,
      mission: {
        id: contextId as string,
        status:
          typeof missionData.status === "string" ? missionData.status : null,
        missionKind:
          typeof missionData.missionKind === "string"
            ? missionData.missionKind
            : null,
        implicitLabel:
          typeof missionData.implicitLabel === "string"
            ? missionData.implicitLabel
            : null,
        goal: typeof missionData.goal === "string" ? missionData.goal : null,
        steps: Array.isArray(missionData.steps) ? missionData.steps : null,
      },
      siblings,
      state,
      ownerInputPending: await isOwnerInputPending(siblingDocs, projectId),
      enabled: true,
    });

    if (verdict.action === "NO_SIGNAL" || verdict.action === "CLOSE_MISSION") {
      // ★사장님 입력 대기로 보류했으면 연속 카운터를 0으로 되돌린다 — 사람이
      // 루프에 들어온 것이 관측된 시점이 곧 "사람 개입"이다(§7-1).
      if (
        verdict.code === "owner-input-pending" &&
        state.consecutiveSignals > 0
      ) {
        await updateDoc(missionRef, {
          "advanceState.consecutiveSignals": 0,
          lastActivityAt: Timestamp.now(),
        });
      }
      return "";
    }

    // ★HALT 는 배달 여부와 무관한 사실이므로 상태부터 박는다. 알림이 실패해도
    //   사유가 미션 문서와 티켓 activity 에 남는다(3중 기록 — 조용한 정지 금지).
    if (verdict.action === "HALT") {
      await updateDoc(missionRef, {
        "advanceState.haltReason": verdict.haltReason ?? verdict.reason,
        "advanceState.haltedAt": Timestamp.now(),
        lastActivityAt: Timestamp.now(),
      });
      await recordAdvanceActivity(
        taskId,
        `⏸ [미션 전진 정지] ${verdict.reason}`,
      );
    }

    // 배달 — 결과를 읽는다. 조용한 실패 금지(#1412 규약).
    const delivery = await postOrchestratorNotification({
      bridgePort: process.env.MARBLO_BRIDGE_PORT,
      headers: bridgeHeaders({ "Content-Type": "application/json" }),
      projectId,
      contextId: contextId as string,
      message: verdict.message,
      taskId,
    });

    if (delivery.outcome === "failed") {
      // ★연속 카운터를 올리지 않는다 — 닿지도 않은 신호를 한도에 세면 미션이
      //   진행 없이 한도만 태우고 멈춘다. 재시도가 다시 신호를 낼 수 있도록
      //   signaledTaskIds 에도 기록하지 않는다.
      // ★재전달 여부는 계산해서 적는다 — 전진 신호는 DONE 전이에서 나오므로
      //   보드 재동기화 스위프의 조회 집합에 **아예 없다**. 위로 대신 사실을.
      await recordAdvanceActivity(
        taskId,
        `⚠️ [미션 전진 신호 미전달] 오케에 전진 신호가 닿지 않았습니다 ` +
          `(사유: ${
            delivery.reason ?? "unknown"
          }). 자율 진행 카운터는 올리지 않았습니다. ` +
          describeResyncFollowup({
            message: verdict.message,
            isMissionContext: true,
          }),
      );
      return " ⚠️ 전진 신호가 오케에 전달되지 않았습니다(사유가 activity 로 기록됨).";
    }

    // ★폴백 배달 — 미션 오케가 없어 보드 오케가 받았다. 배달은 성공이므로
    //   한도/dedup 은 정상 진행하되, 수신자가 바뀐 사실은 반드시 남긴다.
    if (delivery.outcome === "delivered" && delivery.viaFallback) {
      await recordAdvanceActivity(
        taskId,
        `⤵ [미션 전진 신호 폴백 배달] 미션 오케가 실행 중이 아니라 보드 오케에 ` +
          `전진 신호를 전달했습니다` +
          `${delivery.fallbackReason ? ` (${delivery.fallbackReason})` : ""}.`,
      );
    }

    if (verdict.action === "HALT") {
      return ` ⏸ 자율 전진이 정지되었습니다 — ${verdict.reason}`;
    }

    // delivered / suppressed 둘 다 dedup 은 확정한다(같은 완료로 두 번 쏘지
    // 않는다). 다만 suppressed 는 오케를 깨우지 않았으므로 **자율 한도에는
    // 세지 않는다** — 스폰을 유발하지 않은 신호다.
    const next = verdict.nextState;
    if (next) {
      await updateDoc(missionRef, {
        "advanceState.consecutiveSignals":
          delivery.outcome === "delivered"
            ? next.consecutiveSignals
            : state.consecutiveSignals,
        "advanceState.stagnantSignals": next.stagnantSignals,
        "advanceState.lastOpenCount": next.lastOpenCount,
        "advanceState.signaledTaskIds": arrayUnion(next.signaledTaskId),
        lastActivityAt: Timestamp.now(),
      });
    }
    const fallbackNote =
      delivery.outcome === "delivered" && delivery.viaFallback
        ? " (미션 오케 부재 → 보드 오케로 폴백 배달)"
        : "";
    return ` ▶ 미션 전진 신호 전송${fallbackNote} — 남음 ${verdict.openCount}건, 지금 가능 ${verdict.buckets.readyNow.length}건.`;
  } catch (err) {
    // 판정/배달이 깨져도 티켓 전이는 이미 커밋됐다. 다만 조용히 두지 않는다.
    console.warn("[mission-advance] signal failed:", err);
    return "";
  }
}

/**
 * 전진 경로의 사유 기록. `projection.lastActivityAt` 을 건드리지 않는 직접
 * 기록이라 워치독의 침묵 감지를 가리지 않는다(notifyOrchestrator 와 같은 규율).
 */
async function recordAdvanceActivity(
  taskId: string,
  message: string,
): Promise<void> {
  await recordNotifyActivity(taskId, message, "mission-advance");
}

// ── 미션 계층 전진 — 쪼개기 + 미션 → 다음 미션 (티켓 F2TAJlSgSP8Ag1qJNkp1) ──
//
// 설계 단일소스: v3/docs/mission-layer-advance-design-2026-09-04.md.
// 판정은 전부 `mission-handoff.ts` 의 순수 함수가 하고 여기는 I/O 와 배달만
// 한다(#1414 와 같은 분리).
//
// ★후크 지점: `closeImplicitMissionIfComplete` 가 missionId 를 돌려주는 순간
//   = "이 티켓이 마지막이었고 미션이 방금 닫혔다" 는 단일 사실. 종결 판정을 두
//   벌로 만들지 않는다. 그 시점 이후 도는 `signalMissionAdvanceAfterDone` 은
//   미션이 이미 completed 라 `mission-terminal` 로 빠지므로 경합하지 않는다.
// ★DONE 에 이르는 경로가 둘이라(update_task_status / merge_and_close) 양쪽에
//   다 건다 — #1414 설계 §2 가 세운 근거를 그대로 지킨다.
// ★플래그는 #1414 와 **같은 하나**(MISSION_ADVANCE_SIGNAL). 이 경로는 자기
//   환경변수를 가지지 않는다 — 사장님 지시 "한번에 켜줘".

/**
 * ★토큰 잔여를 **사용량 탭과 같은 소스**에서 읽는다(설계 §4 게이트 1).
 *
 * 새 프로브도 새 엔드포인트도 만들지 않았다. 브리지 `GET /model-guidance` 가
 * 내려주는 `quota` 는 `harness-quota.ts` 의 `harnessQuotaRows()` 결과이고,
 * 그 입력이 `account-usage.getAccountRateLimits()` — **사용량 탭의 "한도(Rate
 * limit) 상태" 패널이 IPC `usage:accountRateLimits` 로 읽는 그 함수**다.
 * 즉 화면과 이 루프가 같은 함수·같은 TTL 캐시를 본다.
 *
 * `reservePct` 도 브리지가 함께 내려주는 값이다 — 자동선택이 near-limit 하네스를
 * 후보에서 뺄 때 쓰는 그 예비선이라, 라우터가 "안 쓴다"고 판단하는 선과 우리가
 * "스폰 안 한다"고 판단하는 선이 갈라지지 않는다.
 *
 * 실패는 성공처럼 만들지 않는다 — 못 읽으면 빈 배열 + 사유를 돌려주고, 게이트가
 * `no-data` 로 판정해 그 사실이 사장님께 나가는 문장에 실린다.
 */
async function readQuotaForSpawnGate(): Promise<{
  rows: HarnessQuotaReading[];
  reservePct: number;
  error: string | null;
}> {
  const guidance = await fetchModelGuidanceStatic();
  const quota = guidance.payload?.quota ?? null;
  if (!quota || !Array.isArray(quota.harnesses)) {
    return {
      rows: [],
      reservePct: 10,
      error:
        guidance.error ??
        "브리지가 quota 를 내려주지 않았다(구버전 브리지이거나 프로브 실패)",
    };
  }
  return {
    rows: quota.harnesses.map((h) => ({
      harness: String(h.harness),
      remainingPercent:
        typeof h.remainingPercent === "number" ? h.remainingPercent : null,
      source: typeof h.source === "string" ? h.source : null,
    })),
    reservePct: typeof quota.reservePct === "number" ? quota.reservePct : 10,
    error: null,
  };
}

/** `missions/{id}.advanceState.handoffAskedAt` 이 이미 박혀 있는가. */
function handoffAlreadyAsked(mission: Record<string, unknown>): boolean {
  const raw = mission.advanceState;
  if (!raw || typeof raw !== "object") return false;
  return Boolean((raw as Record<string, unknown>).handoffAskedAt);
}

/**
 * 미션이 닫힌 직후 호출 — 다음 미션 후보를 **선택 순서대로** 고르고, 사장님이
 * 명시하신 게이트 둘(토큰 → 텔레그램 승인)을 지나 **질문을 보내고 멈춘다**.
 *
 * ★이 함수의 어느 경로도 에이전트를 스폰하지 않는다. 스폰은 사장님 승인 이후
 *   오케가 한다.
 * ★절대 throw 하지 않는다 — 상태 전이는 이미 커밋됐고, 전진 경로가 티켓 진행을
 *   깨면 안 된다(#1414 와 같은 규율).
 *
 * @returns 호출자가 응답 문장에 덧붙일 짧은 노트. 없으면 "".
 */
async function handleMissionHandoffAfterClose(
  closedMissionId: string,
  task: { projectId?: string; title?: string },
  finishedTaskId: string,
): Promise<string> {
  // 기본값 OFF — #1414 와 **같은 플래그**. 꺼져 있으면 아무것도 읽지 않는다.
  if (!isAdvanceSignalEnabled()) return "";

  try {
    const missionRef = doc(db, MISSIONS_COLLECTION, closedMissionId);
    const missionSnap = await getDoc(missionRef);
    if (!missionSnap.exists()) return "";
    const missionData = missionSnap.data() as Record<string, unknown>;

    const missionProjectId =
      typeof missionData.projectId === "string"
        ? missionData.projectId.trim()
        : "";
    const projectId = missionProjectId || task.projectId || DEFAULT_PROJECT;

    // ★중복 질문을 막는 판정을 **읽기 전에** 한다 — 체인/쿼터를 읽는 비용도
    //   같은 완료가 두 번 들어올 때는 낼 이유가 없다.
    if (handoffAlreadyAsked(missionData)) return "";

    const chain = await loadWorkChain(db, projectId);
    const quota = await readQuotaForSpawnGate();

    const verdict = evaluateMissionHandoff({
      closedMissionId,
      closedMissionLabel:
        typeof missionData.implicitLabel === "string"
          ? missionData.implicitLabel
          : typeof missionData.goal === "string"
            ? missionData.goal
            : null,
      finishedTaskId,
      chain: chain.derived.items.map(toHandoffChainItem),
      alreadyAsked: false,
      state: readAdvanceState(missionData),
      // ★형제 문서를 넘기지 않는 것은 누락이 아니다. `isOwnerInputPending` 의
      //   두 축 중 (a)"미션 티켓의 미해결 질문"은 여기서 의미가 없다 — 미션이
      //   닫혔다는 것은 그 티켓들이 전부 종료됐다는 뜻이고, 종료된 티켓에 남은
      //   질문은 다음 미션을 여쭐지와 무관한 과거 기록이다. 실제로 필요한 축은
      //   (b)"미소비 오너 인바운드" — 사장님이 방금 말씀 중이면 질문을 **또**
      //   보내지 않는다는 그것이고, 그건 projectId 만으로 읽힌다.
      ownerInputPending: await isOwnerInputPending([], projectId),
      quota: quota.rows,
      reservePct: quota.reservePct,
      quotaError: quota.error,
      enabled: true,
    });

    if (verdict.action === "NO_HANDOFF" || verdict.action === "HOLD") {
      // 후보 소진은 사실이므로 오케에는 알린다(조용히 끝내지 않는다). 상태는
      // 바꾸지 않는다 — 다음 완료에 다시 평가된다.
      if (verdict.orchestratorMessage) {
        await postOrchestratorNotification({
          bridgePort: process.env.MARBLO_BRIDGE_PORT,
          headers: bridgeHeaders({ "Content-Type": "application/json" }),
          projectId,
          contextId: closedMissionId,
          message: verdict.orchestratorMessage,
          taskId: finishedTaskId,
        });
      }
      return "";
    }

    if (verdict.action === "HALT") {
      // 사유는 세 곳에 남는다(#1414 규약) — 미션 문서 · 티켓 activity · 오케 PTY.
      await updateDoc(missionRef, {
        "advanceState.haltReason": verdict.haltReason ?? verdict.reason,
        "advanceState.haltedAt": Timestamp.now(),
        lastActivityAt: Timestamp.now(),
      });
      await recordAdvanceActivity(
        finishedTaskId,
        `⏸ [미션 계층 전진 정지] ${verdict.reason}`,
      );
      await postOrchestratorNotification({
        bridgePort: process.env.MARBLO_BRIDGE_PORT,
        headers: bridgeHeaders({ "Content-Type": "application/json" }),
        projectId,
        contextId: closedMissionId,
        message: verdict.orchestratorMessage,
        taskId: finishedTaskId,
      });
      return ` ⏸ 다음 미션 전진이 정지되었습니다 — ${verdict.reason}`;
    }

    // ── ASK_OWNER / NOTIFY_OWNER — 텔레그램으로 나간다 ────────────────────
    //
    // ★본문은 여기서 브리지로 넘기기만 한다. activity·저널·툴 응답 어디에도
    //   본문·chatId 를 적지 않는다(이 티켓의 금지 사항, 테스트로 고정).
    const sent = await sendTelegramViaBridge(
      projectId,
      verdict.telegramMessage,
    );

    // 오케에는 "무엇이 후보이고 왜 멈췄는지" 를 넣는다(본문은 안 넣는다).
    await postOrchestratorNotification({
      bridgePort: process.env.MARBLO_BRIDGE_PORT,
      headers: bridgeHeaders({ "Content-Type": "application/json" }),
      projectId,
      contextId: closedMissionId,
      message: verdict.orchestratorMessage,
      taskId: finishedTaskId,
    });

    if (!sent.ok) {
      // ★전달 실패면 askedAt 을 박지 **않는다**. 닿지도 않은 질문을 "여쭸다" 로
      //   세면 사장님은 영영 못 보시고 루프는 영영 멈춘다(#1414 의 배달 실패
      //   규율과 같은 판단). 다음 완료에 다시 시도된다.
      await recordAdvanceActivity(
        finishedTaskId,
        `⚠️ [다음 미션 확인 미전달] 사장님께 전달되지 않았습니다(사유: ${
          sent.error ?? "unknown"
        }). 승인 대기 상태를 기록하지 않았습니다 — 다음 완료에 재시도됩니다.`,
      );
      return " ⚠️ 다음 미션 확인이 사장님께 전달되지 않았습니다(사유가 activity 로 기록됨).";
    }

    await updateDoc(missionRef, {
      "advanceState.handoffAskedAt": Timestamp.now(),
      "advanceState.handoffOutcome": verdict.code,
      lastActivityAt: Timestamp.now(),
    });

    if (verdict.action === "NOTIFY_OWNER") {
      // ★NOTIFY_OWNER 는 이제 사유가 둘이다 — 토큰 부족, 그리고 오케브레인이
      //   빈 경우. 사유 문구를 하나로 뭉뚱그리면 activity 가 거짓말을 한다.
      if (verdict.code === "chain-exhausted") {
        await recordAdvanceActivity(
          finishedTaskId,
          `📭 [다음 미션 없음] 오케브레인이 비었습니다(남은 미션 0건) — 사장님께 알렸습니다. 스폰 없음.`,
        );
        return ` 📭 오케브레인이 비었습니다(남은 미션 0건) — 사장님께 알렸습니다.`;
      }
      await recordAdvanceActivity(
        finishedTaskId,
        `⛔ [다음 미션 미시작] 토큰 잔여 부족으로 스폰하지 않았습니다 — ${verdict.reason}`,
      );
      return ` ⛔ 토큰 잔여 부족으로 다음 미션을 시작하지 않았습니다 — 후보는 사장님께 함께 알렸습니다.`;
    }

    await recordAdvanceActivity(
      finishedTaskId,
      `❓ [다음 미션 확인] 후보 ${verdict.candidates.length}건 중 상위 후보들을 ` +
        `근거와 함께 사장님께 여쭀습니다(1순위 "${verdict.next?.item.what ?? ""}"). ` +
        `★하나를 지명하지 않았고, 승인 전까지 자율 스폰 없음.` +
        (verdict.splitTargets.length > 0
          ? ` 근거 티켓 없는 사장님 지시 ${verdict.splitTargets.length}건은 분해 대상으로 오케에 전달.`
          : ""),
    );
    return ` ❓ 다음 미션 시작 여부를 사장님께 여쭀습니다 — 승인 전까지 자율 스폰은 없습니다(후보 ${verdict.candidates.length}건).`;
  } catch (err) {
    // 판정/배달이 깨져도 티켓 전이와 미션 마감은 이미 커밋됐다. 조용히 두지 않는다.
    console.warn("[mission-handoff] handoff failed:", err);
    return "";
  }
}

/**
 * `mission_label` 파라미터 처리 — 라벨이 없으면 아무 일도 안 한다(기존 동작 불변).
 *
 * 명시적 미션 컨텍스트(MARBLO_CONTEXT=missionId) 안에서는 라벨을 **무시하고
 * 그 사실을 문장으로 돌려준다**. 이미 진짜 미션에 속한 티켓을 라벨로 다시
 * 묶으면 소속이 둘이 되고, 그건 조용히 넘길 일이 아니다.
 */
async function resolveImplicitMissionForWrite(
  projectId: string,
  rawLabel: string | undefined,
  rawGoal: string | undefined,
): Promise<{ missionId: string | null; note: string }> {
  const label = normalizeMissionLabel(rawLabel);
  if (!label) return { missionId: null, note: "" };

  if (!projectId) {
    return {
      missionId: null,
      note: `mission_label '${label}' ignored — no project context (MARBLO_PROJECT unset).`,
    };
  }
  if (resolveMissionContextForWrite()) {
    return {
      missionId: null,
      note: `mission_label '${label}' ignored — this session already runs inside an explicit mission context.`,
    };
  }
  const contextId = resolveContextForWrite();
  if (isLaneContextId(contextId)) {
    return {
      missionId: null,
      note: `mission_label '${label}' ignored — Quick Lane tasks keep their lane context.`,
    };
  }
  try {
    const { missionId, created } = await resolveImplicitMissionId(
      projectId,
      label,
      rawGoal,
    );
    return {
      missionId,
      note: created
        ? `Mission Replay: 새 묶음 '${label}' 생성 (missionId=${missionId}).`
        : `Mission Replay: 기존 묶음 '${label}' 에 합류 (missionId=${missionId}).`,
    };
  } catch (err) {
    return {
      missionId: null,
      note: `mission_label '${label}' 적용 실패 — ${
        err instanceof Error ? err.message : String(err)
      } (티켓은 보드에 그대로 생성됩니다).`,
    };
  }
}

/** create_task / create_tasks_bulk / dispatch_task 공용 라벨 파라미터. */
const missionLabelParamShape = {
  mission_label: z
    .string()
    .optional()
    .describe(
      "★Mission Replay 묶음 라벨. 서로 연관된 ad-hoc 배치에 같은 라벨을 주면 그 묶음이 하나의 '암묵적 미션'이 되고, 배치가 전부 끝나는 순간 완료이력 탭의 Mission Replay 로 잡힌다. 라벨을 안 주면 티켓은 그냥 보드에 남는다(기존 동작).",
    ),
  mission_goal: z
    .string()
    .optional()
    .describe(
      "그 묶음의 goal — 사장님 의도/지시 요약 1~2문장. 묶음을 처음 만들 때만 쓰이고(이후 호출에서는 무시), Replay 헤드라인에 그대로 뜬다. 생략하면 라벨을 goal 로 쓴다.",
    ),
};

// ── Audit Logging ─────────────────────────────────────────────

const MARBLO_AGENT_ID = process.env.MARBLO_AGENT_ID || "unknown";
const MARBLO_ORCHESTRATOR_PTY_SESSION_ID =
  process.env.MARBLO_ORCHESTRATOR_PTY_SESSION_ID || "";

/**
 * 작업자 귀속(claimedBy / projection.lastAgentId)에 쓸 agent id.
 *
 * 오케스트레이터가 task 를 대신 갱신(상태 전이/auto-claim)할 때 자기 공유
 * id(`orchestrator-<projectId>`)를 담당자로 찍으면 get_all_tasks/보드가 다수
 * task 의 담당자를 그 단일 id 로 표시해 부하분산이 과부하로 오인한다. 오케·
 * unknown 은 "" 로 떨어뜨려 — applyProjection 의 `lastAgentId || prev` 규칙이
 * 직전 실제 작업자 값을 보존하고, claimedBy auto-claim 은 `&& WORKER_AGENT_ID`
 * 가드로 건너뛴다. (작업자가 자기 id 로 직접 호출하면 그대로 귀속된다.)
 */
function workerAgentId(rawId: string): string {
  if (!rawId || rawId === "unknown" || isOrchestratorAgentId(rawId)) return "";
  return rawId;
}
const WORKER_AGENT_ID = workerAgentId(MARBLO_AGENT_ID);

interface OrchestratorSessionValidationResponse {
  success?: boolean;
  valid?: boolean;
  reason?: string;
}

const ORCHESTRATOR_LIVE_GUARDED_TOOLS = new Set([
  "create_task",
  "create_tasks_bulk",
  "claim_task",
  "update_task_status",
  "add_activity",
  "submit_for_review",
  "acknowledge_feedback",
  "spawn_agent",
  "delete_task",
  "reuse_agent",
  "dispatch_task",
  "kill_agent",
  "cleanup_agents",
  "create_flow",
  "update_flow",
  "add_pending_instruction",
  "mark_instruction_delivered",
  "answer_question",
  // 사장님 승격(외부 발송)과 승인 결정 기록은 오케만 하는 행위다 — 죽은 오케
  // 세션이 사장님께 텔레그램을 쏘거나 승인을 적어 넣지 못하게 같이 게이트한다.
  "escalate_to_owner",
  "resolve_model_escalation",
  "run_skill",
  "mission_step_done",
  "send_telegram_message",
  // 같은 이유로 Slack 아웃바운드도 게이트한다 — 죽은 오케 세션이 팀 채널에
  // 메시지를 쏘지 못하게(외부 발신은 되돌릴 수 없다).
  "send_slack_message",
]);

async function validateLiveOrchestratorToolCall(
  toolName: string,
): Promise<string | null> {
  if (!ORCHESTRATOR_LIVE_GUARDED_TOOLS.has(toolName)) return null;
  if (!isOrchestratorAgentId(MARBLO_AGENT_ID)) return null;

  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) {
    return (
      `Error: Refusing ${toolName}: orchestrator session liveness cannot be ` +
      "validated because MARBLO_BRIDGE_PORT is missing."
    );
  }
  if (!MARBLO_ORCHESTRATOR_PTY_SESSION_ID) {
    return (
      `Error: Refusing ${toolName}: orchestrator session liveness cannot be ` +
      "validated because MARBLO_ORCHESTRATOR_PTY_SESSION_ID is missing."
    );
  }

  try {
    const response = await fetch(
      `http://127.0.0.1:${bridgePort}/validate-orchestrator-session`,
      {
        method: "POST",
        headers: bridgeHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({
          projectId: process.env.MARBLO_PROJECT || "",
          contextId: process.env.MARBLO_CONTEXT || "",
          ptySessionId: MARBLO_ORCHESTRATOR_PTY_SESSION_ID,
          agentId: MARBLO_AGENT_ID,
          toolName,
        }),
      },
    );
    if (!response.ok) {
      return `Error: Refusing ${toolName}: orchestrator session validation failed with HTTP ${response.status}.`;
    }
    const data =
      (await response.json()) as OrchestratorSessionValidationResponse;
    if (!data.valid) {
      return `Error: Refusing ${toolName}: ${
        data.reason || "stale orchestrator session"
      }.`;
    }
    return null;
  } catch (err) {
    return `Error: Refusing ${toolName}: orchestrator session validation failed (${
      err instanceof Error ? err.message : String(err)
    }).`;
  }
}

/**
 * 보드 귀속(claimedBy / projection.lastAgentId)용 id — env 의 실 워커 id 우선.
 *
 * 모델이 도구 인자에 자칭 id 를 지어내는 경우가 실제로 있다(2026-07-18: codex
 * 워커가 agent_id="codex-frontend" 로 add_activity 를 호출 → lastAgentId 가
 * AgentManager 에 존재하지 않는 id 로 오염 → 워치독 getAgentHealth 가 null 을
 * 받아 살아있는 워커를 missing/dead 로 오판). 스폰 시 주입되는
 * MARBLO_AGENT_ID(WORKER_AGENT_ID)가 이 프로세스의 단일 진실이므로, 그것이
 * 있으면 param 을 무시하고 항상 env id 로 귀속한다. env 가 오케/unknown 인
 * 프로세스(오케가 대리 기록하는 경우)에서만 param 기반 귀속으로 폴백한다.
 * activity 로그의 표시용 author 는 기존대로 param 우선을 유지한다.
 */
function attributionAgentId(paramId?: string): string {
  return WORKER_AGENT_ID || workerAgentId(paramId || MARBLO_AGENT_ID);
}

function claimOwnershipErrorFromTask(task: Record<string, unknown>): string {
  const claimedBy =
    typeof task.claimedBy === "string" && task.claimedBy
      ? task.claimedBy
      : "unknown";
  return getClaimOwnershipError({ claimedBy, actorAgentId: "" }) ?? "";
}

// ── Claim override 권한 (티켓 r2rrPsblZPlUOTCWzc3Z) ──────────────
//
// 설계 근거·오판 비용 분석은 claim-authority.ts 헤더에 있다. 여기는 그 순수 판정에
// 필요한 **증거를 실제로 조회하는** I/O 껍데기다.

/**
 * claim 보유자가 살아 있는지 플릿에 물어본다.
 *
 * ★"못 찾았다" 와 "조회에 실패했다" 를 반드시 구분한다. fetchAgentIdHint 는 둘 다
 * null 로 뭉개므로 여기서 따로 조회한다 — 그 구분이 무너지면 브리지가 잠깐 흔들릴
 * 때마다 살아있는 에이전트의 티켓이 강탈된다(false-dead, 되돌릴 수 없는 오판).
 */
async function probeClaimHolder(
  claimedBy: string,
  taskLastActivityMs: number | null,
): Promise<ClaimHolderAssessment> {
  let firestoreFailed = false;
  try {
    const snap = await getDoc(doc(db, "agents", claimedBy));
    if (snap.exists()) {
      const data = snap.data() as Record<string, unknown>;
      return assessClaimHolder({
        found: true,
        lookupFailed: false,
        status: nonEmptyString(data.status),
        lastActivityAtMs: taskLastActivityMs,
        nowMs: Date.now(),
      });
    }
  } catch (err) {
    firestoreFailed = true;
    console.warn("[MCP] claim holder lookup (Firestore) failed:", err);
  }

  // Firestore 에 문서가 없어도 아직 "부재" 로 단정하지 않는다 — 브리지의 인메모리
  // 플릿에만 있는 갓 스폰된 에이전트가 실재한다. 두 곳 모두에서 없어야 absent 다.
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) {
    // 브리지 주소를 모르면 플릿의 절반을 못 본 것이다. Firestore 조회가 성공했고
    // 거기에 없었더라도 fail-closed 로 간다.
    return assessClaimHolder({ found: false, lookupFailed: true });
  }
  try {
    const projectId = process.env.MARBLO_PROJECT || "";
    const url = projectId
      ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
          projectId,
        )}`
      : `http://127.0.0.1:${bridgePort}/agents`;
    const response = await fetch(url, { headers: bridgeHeaders() });
    if (!response.ok) {
      return assessClaimHolder({ found: false, lookupFailed: true });
    }
    const data = (await response.json()) as {
      agents?: Array<Record<string, unknown>>;
    };
    const agents = Array.isArray(data.agents) ? data.agents : [];
    const match = agents.find((a) => nonEmptyString(a.id) === claimedBy);
    if (match) {
      return assessClaimHolder({
        found: true,
        lookupFailed: false,
        status: nonEmptyString(match.status),
        lastActivityAtMs: taskLastActivityMs,
        nowMs: Date.now(),
      });
    }
    // 브리지는 확실히 답했고 거기 없다. Firestore 도 (성공했다면) 없었다.
    return assessClaimHolder({ found: false, lookupFailed: firestoreFailed });
  } catch (err) {
    console.warn("[MCP] claim holder lookup (bridge) failed:", err);
    return assessClaimHolder({ found: false, lookupFailed: true });
  }
}

interface ResolvedClaimAuthority {
  /** null 이 아니면 그대로 도구 응답으로 내보내고 중단한다. */
  error: string | null;
  decision: ClaimAuthorityDecision;
  /** override 였다면 감사 기록에 실을 문장. */
  auditMessage: string | null;
}

/**
 * projection.lastActivityAt(epoch ms). silent 판정 전용 — 못 읽으면 null 이고,
 * 그러면 assessClaimHolder 가 무활동 판정을 통째로 건너뛴다(권한에는 영향 없음).
 */
function taskLastActivityAtMs(task: TaskDoc): number | null {
  const at = task.projection?.lastActivityAt;
  if (!at || typeof at.toMillis !== "function") return null;
  try {
    return at.toMillis();
  } catch {
    return null;
  }
}

/**
 * 두 단계 판정 실행기 — 순수 로직이 증거를 요구하면 플릿을 조회해 한 번 더 부른다.
 *
 * `action` 은 감사 기록의 "대상" 줄에 그대로 들어간다("status CLAIMED → DONE" 등).
 * `reason` 은 override 일 때 필수 — 도구의 comment/message 를 그대로 넘긴다.
 */
async function resolveClaimAuthority(opts: {
  task: TaskDoc;
  actorAgentId: string;
  action: string;
  reason: string;
}): Promise<ResolvedClaimAuthority> {
  const base = {
    claimedBy: opts.task.claimedBy,
    actorAgentId: opts.actorAgentId,
    actorIsOrchestrator: isOrchestratorAgentId(MARBLO_AGENT_ID),
    actorProjectId: process.env.MARBLO_PROJECT || "",
    taskProjectId: opts.task.projectId,
    reason: opts.reason,
  };

  let decision = decideClaimAuthority(base);
  if (decision.needsHolderEvidence) {
    const holder = await probeClaimHolder(
      (opts.task.claimedBy ?? "").trim(),
      taskLastActivityAtMs(opts.task),
    );
    decision = decideClaimAuthority({ ...base, holder });
  }

  if (!decision.allowed) {
    return { error: decision.error, decision, auditMessage: null };
  }
  if (!decision.override || !decision.grant) {
    return { error: null, decision, auditMessage: null };
  }
  return {
    error: null,
    decision,
    auditMessage: formatClaimOverrideAudit({
      grant: decision.grant,
      // 감사 기록에는 오케의 실제 id 를 그대로 남긴다 — 귀속용 "" 로 지우면
      // "누가" 가 사라져 기록의 절반이 날아간다.
      actorAgentId: opts.actorAgentId || MARBLO_AGENT_ID,
      claimedBy: (opts.task.claimedBy ?? "").trim(),
      action: opts.action,
      reason: opts.reason,
      overrideWhy: decision.overrideWhy,
    }),
  };
}

/**
 * override 를 허용하더라도 TOCTOU 는 그대로 닫는다. 우리가 근거를 확인한 **그**
 * 보유자일 때만 넘는다 — 판정과 커밋 사이에 다른 에이전트가 새로 claim 했다면
 * 트랜잭션을 중단한다. (claim 보호를 없애는 게 아니라 탈출구를 여는 것이므로,
 * "동시 수정 금지" 는 override 경로에서도 유지되어야 한다.)
 */
function canActorMutateClaimedTask(
  actorAgentId: string,
  overriddenClaimBy: string | null,
): (task: Record<string, unknown>) => boolean {
  return (task) => {
    const claimedBy =
      typeof task.claimedBy === "string" && task.claimedBy
        ? task.claimedBy
        : null;
    if (!claimedBy) return true;
    if (claimedBy === actorAgentId) return true;
    return !!overriddenClaimBy && claimedBy === overriddenClaimBy;
  };
}

/**
 * 감사 원장 한 건을 적재한다(`audit_logs`).
 *
 * 신규 귀속 필드(actorUid/model/tier/instructionHash/taskId/worktreeId/kind)는
 * ledger.ts 의 순수 함수가 조립한다 — 여기서는 프로세스 맥락(인증 uid, cwd, home,
 * env)만 넘긴다. 스키마는 스펙 §5, 분류는 §15.
 *
 * ★모르는 값은 null 로 남는다. 추측해서 채우지 않는다 — 판별 불가한 것을 확실한
 * 것처럼 보이게 만드는 게 감사에서는 가장 나쁘다.
 *
 * L1(§7): 실패는 더 이상 console.error 한 줄로 삼켜지지 않는다. 모든 이벤트가
 * 로컬 스풀 큐를 지나며(ledger-spool.ts), 쓰기가 실패하면 디스크에 보관됐다가
 * 복구 시 **순서를 보존해** 재적재된다. `enqueue()` 는 동기라 이 함수는 여전히
 * fire-and-forget 이고 MCP 툴 호출을 막지 않는다.
 */
function auditLog(entry: {
  projectId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
  kind?: LedgerEventKind;
  instruction?: string;
}): void {
  const event = buildLedgerEvent({
    ...entry,
    actorUid: getCurrentAuthUid(),
    runtime: readAgentRuntimeContext(),
    // 에이전트 CLI 는 워크트리를 cwd 로 스폰되고(bridge-server: cwd=worktreePath)
    // MCP 서버는 그 cwd 를 상속한다. 그래서 cwd 가 워크트리 귀속의 근거가 된다.
    // MARBLO_PROJECT_ROOT 를 폴백으로 두지 않는 이유는 worktreeAttributionCwd 참조.
    cwd: worktreeAttributionCwd(process.env, process.cwd()),
    homeDir: os.homedir(),
  });
  // 동기 반환 — 스풀이 툴 호출을 막지 않는다.
  ledgerSpool().enqueue(event);
}

// ── 감사 원장 스풀 (L1, §7) ──────────────────────────────────────

let spoolSingleton: LedgerSpool | null = null;

/**
 * 이 프로세스의 스풀. **프로세스당 하나**이고, 그래서 프로세스 내 전역 순서를
 * 보장한다.
 *
 * ★L3(체인)와의 정합: L3 의 해시 체인 단위는 `(projectId, agentId)`(§6)인데 한
 * 프로세스가 여러 projectId 의 이벤트를 낼 수 있으므로(cross-project-create 계열
 * 툴) 둘은 동치가 아니라 **포함** 관계다 — 프로세스 전역 순서가 보존되면 그
 * 부분열인 각 체인의 순서도 자동으로 보존된다. 즉 스풀 순서는 체인 seq 의 상위
 * 보장이고, L3 는 `seq` 를 **enqueue 시점**에 매기기만 하면 된다(write 시점에
 * 매기면 안 된다 — 스풀은 30분 뒤에 재적재될 수 있어 write 순서 ≠ 발생 순서다).
 */
/**
 * Firestore 에러 코드를 꺼낸다. FirebaseError 는 `code: "permission-denied"`
 * 형태를 갖는다. 코드가 없으면 메시지로 폴백하지 않는다 — 문자열 매칭은 로케일·
 * SDK 버전에 따라 조용히 깨지고, 그 결과가 "재시도 가능"으로 오분류되면 정확히
 * L1.6 고착이 재발한다.
 */
function firestoreErrorCode(err: unknown): string | null {
  const code = (err as { code?: unknown } | null)?.code;
  return typeof code === "string" ? code : null;
}

/**
 * 이 실패가 재시도로 풀리지 않는 종류인가.
 *
 * 권한·인자 오류는 백오프로 회복되지 않는다. 반면 unavailable/deadline-exceeded
 * 및 ack 타임아웃(코드 없는 우리 Error)은 시간이 지나면 풀리므로 재시도가 맞다.
 * ★분류를 틀리면 방향에 따라 결과가 다르다: 터미널을 재시도 가능으로 보면 큐가
 * 영구 고착하고(L1.6), 반대로 보면 회복 가능한 것을 미해결로 내린다. 그래서
 * 화이트리스트가 아니라 **명시된 터미널 코드만** 터미널로 본다.
 */
const TERMINAL_FIRESTORE_CODES = new Set([
  // 기존 문서에 setDoc → update 판정 → 룰 거부. 이 티켓의 원인 그 자체다.
  "permission-denied",
  "unauthenticated",
  "invalid-argument",
  "failed-precondition",
  "not-found",
]);

function isTerminalLedgerError(err: unknown): boolean {
  const code = firestoreErrorCode(err);
  return code !== null && TERMINAL_FIRESTORE_CODES.has(code);
}

/**
 * 레코드가 이미 원장에 있는지 확인한다. **최선 노력이고, 실패는 "미상"이다.**
 *
 * ★L2 가 audit_logs read 를 isProjectMember() 로 조이면 이 읽기는 정상적으로
 * 거부된다. 특히 오버플로/미해결 마커는 projectId 가 "" 라 영원히 확인 불가다.
 * 그래서 읽기 실패를 "없음"으로 반올림하지 않고 null(미상)을 돌려준다 —
 * 확인 불가를 유실로 단정하면 멀쩡한 기록을 유실로 보고하게 된다.
 *
 * 존재만으로 판정하지 않고 **동일성**까지 본다: 같은 id 에 다른 내용이 있다면
 * 그건 우리 쓰기가 아니므로 성공으로 처리하면 안 된다.
 */
async function verifyLedgerRecord(rec: SpoolRecord): Promise<boolean | null> {
  try {
    const snap = await getDoc(doc(collection(db, "audit_logs"), rec.id));
    if (!snap.exists()) return false;
    const data = snap.data() as Record<string, unknown>;
    const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
    const sameInstant =
      typeof createdAt?.toMillis === "function"
        ? createdAt.toMillis() === rec.occurredAtMs
        : false;
    return (
      sameInstant &&
      data.toolName === rec.event.toolName &&
      data.agentId === rec.event.agentId &&
      data.projectId === rec.event.projectId
    );
  } catch {
    // 읽기 권한 없음·오프라인 등. "모른다"를 "없다"로 답하지 않는다.
    return null;
  }
}

// ── 감사 원장 체인 (L3, §6) ──────────────────────────────────────

/**
 * 이 프로세스의 체인 봉인기. **프로세스당 하나**이고, 그래서 `(projectId, agentId)`
 * 체인의 writer 가 하나뿐이라는 §6 의 전제가 성립한다 — 잠금도 트랜잭션도 없이
 * 체인이 성립하는 근거가 이것이다.
 *
 * 스풀과 같은 디렉터리에 머리를 남긴다. 재기동 시 이어받지 않으면 매번 seq 0 부터
 * 다시 시작해 원장에 같은 자리가 여러 벌 생긴다.
 */
let chainSealerSingleton: LedgerChainSealer | null = null;
let chainHeadStoreSingleton: ChainHeadStore | null = null;

function chainSealer(): LedgerChainSealer {
  if (!chainSealerSingleton) {
    chainSealerSingleton = new LedgerChainSealer(MARBLO_AGENT_ID);
  }
  return chainSealerSingleton;
}

function chainHeadStore(): ChainHeadStore {
  if (!chainHeadStoreSingleton) {
    chainHeadStoreSingleton = new ChainHeadStore(
      defaultSpoolDir(),
      MARBLO_AGENT_ID,
    );
  }
  return chainHeadStoreSingleton;
}

/**
 * 이 모듈이 **뒤에서 예약해 둔** 디스크 쓰기가 전부 끝날 때까지 기다린다.
 *
 * 체인 머리 저장은 write-behind 다 — `sealLedgerEvent` 가 `save()` 를 부르고
 * 즉시 돌아온다(§6 비차단 성질). 그래서 툴 호출이 반환한 뒤에도 쓰기가 아직
 * 날아가는 중일 수 있고, **그 쓰기의 목적지가 사라지면** `ChainHeadStore.write`
 * 의 catch 가 `console.error` 를 친다.
 *
 * ★그 늦은 로그가 CI 를 빨갛게 만들었다(티켓 FLf4cwy3I0Ty3S3ifqGw). 테스트가
 * afterEach 에서 스풀 tmp 디렉터리를 지우면 예약된 쓰기가 ENOENT 로 깨지고,
 * 그 console.error 가 테스트 경계를 넘어 vitest 워커의 `onUserConsoleLog` RPC
 * 를 탄다. 워커가 rpc 를 닫는 중에 도착하면
 * `EnvironmentTeardownError: Closing rpc while "onUserConsoleLog" was pending`
 * 이 되고, 테스트가 8795개 전부 통과했는데도 job 은 exit 1 이다(PR #1406).
 *
 * 그래서 **스풀 디렉터리를 치우기 전에** 이걸 부른다. 싱글턴을 새로 만들지
 * 않는다 — 아직 안 만들어졌으면 기다릴 쓰기도 없다.
 */
export async function settleLedgerWrites(): Promise<void> {
  await chainHeadStoreSingleton?.settled();
  await spoolSingleton?.settled();
}

/**
 * 스풀에 꽂는 봉인 훅. **동기**이고 디스크를 기다리지 않는다 — 머리 저장은
 * write-behind 로 예약만 한다(§6 비차단 성질).
 */
const sealLedgerEvent: NonNullable<
  ConstructorParameters<typeof LedgerSpool>[0]["seal"]
> = (event, meta) => {
  const sealer = chainSealer();
  const sealed =
    typeof meta.seq === "number"
      ? // 자리를 옮기지 않는 재봉인(스풀 메타 마커의 내용 갱신).
        sealer.reseal(event, {
          id: meta.id,
          occurredAtMs: meta.occurredAtMs,
          seq: meta.seq,
          prevHash: meta.prevHash ?? GENESIS_PREV_HASH,
        })
      : sealer.seal(event, {
          id: meta.id,
          occurredAtMs: meta.occurredAtMs,
        });
  if (sealer.takeDirty()) chainHeadStore().save(sealer.snapshot());
  return sealed;
};

/**
 * 기동 시 이전 프로세스의 체인 머리를 이어받는다.
 *
 * ★멱등이다. index.ts 가 connect 전에 부르고 restoreLedgerSpool 도 안전망으로
 * 부르는데, 두 번째 복원이 그 사이 봉인된 이벤트의 머리를 이전 기동 값으로
 * 덮어쓰면 원장에 같은 자리가 두 벌 생긴다. 한 번만 이어받는다.
 */
let chainRestored = false;
export async function restoreLedgerChain(): Promise<number> {
  if (chainRestored) return 0;
  chainRestored = true;
  try {
    const snapshot = await chainHeadStore().load();
    const n = chainSealer().restoreFrom(snapshot);
    if (n > 0) {
      console.error(
        `[Audit] 체인 머리 ${n}개를 이어받았습니다 — seq 가 이전 기동에 이어집니다.`,
      );
    } else if (snapshot) {
      console.error(
        `[Audit] 체인 머리 파일은 있었으나 이어받을 체인이 없습니다 — ` +
          `이 프로세스의 체인은 seq 0 에서 시작합니다.`,
      );
    }
    return n;
  } catch (err) {
    // 이어받기 실패를 삼키면 seq 가 조용히 0 으로 되돌아가 원장에 같은 자리가
    // 두 벌 생긴다. 최소한 로그로는 드러낸다 — 검증은 duplicate-seq 로 잡는다.
    console.error(
      `[Audit] ★체인 머리 복원 실패 — 이 프로세스의 체인은 새로 시작되고, ` +
        `그 불연속은 검증에서 중복/구멍으로 드러납니다: ${
          err instanceof Error ? err.message : String(err)
        }`,
    );
    return 0;
  }
}

function ledgerSpool(): LedgerSpool {
  if (spoolSingleton) return spoolSingleton;
  spoolSingleton = new LedgerSpool({
    dir: defaultSpoolDir(),
    seal: sealLedgerEvent,
    // ★스풀 정체는 **프로세스 정체**이지 보드 담당자 귀속이 아니다.
    // attributionAgentId() 는 오케 id 를 의도적으로 "" 로 떨어뜨리는 함수라
    // (보드에서 오케가 다수 task 의 담당자로 표시되는 것을 막기 위해),
    // 그걸 여기 쓰면 오케 프로세스의 스풀이 전부 unknown.spool.json 이 되고
    // tombstone 의 agentId 도 "" 가 된다 — 원장에서 귀속은 핵심 필드다.
    agentId: MARBLO_AGENT_ID,
    sink: async (rec) => {
      // addDoc(자동 id)이 아니라 로컬 생성 id 로 setDoc 한다 — ack 만 유실되고
      // 실제로는 성공했던 쓰기를 재시도해도 중복 문서가 생기지 않는다. 원장에서
      // 같은 사건이 두 건으로 보이면 그 자체가 감사 증거의 오염이다.
      // 룰상 create 는 isAuthenticated 라 클라이언트 지정 id 도 통과한다
      // (firestore.rules `match /audit_logs/{logId}`).
      //
      // ★쓰기 전체를 시간 상한으로 감싼다. 오프라인일 때 Firestore 의 쓰기
      // 프로미스는 resolve 도 reject 도 하지 않아 영원히 매달린다 — 실제 dist-mcp
      // 번들로 권한 거부를 재현해 확인했다(ledger-spool.ts 상단 "라이브 실측").
      // 상한이 없으면 배수 루프가 첫 레코드에서 멈춘 채 실패를 영원히 관측하지
      // 못하고, 그게 이 티켓이 없애려는 조용한 유실 그 자체다.
      await requireServerAck(async () => {
        await setDoc(doc(collection(db, "audit_logs"), rec.id), {
          ...rec.event,
          // ★발생 시각이지 적재 시각이 아니다. 재적재분에 지금 시각을 찍으면 원장이
          // "그때 일어난 일"을 "지금 일어난 일"로 기록하게 된다.
          createdAt: Timestamp.fromMillis(rec.occurredAtMs),
        });
        // 이중 안전장치: 쓰기가 로컬에서 먼저 resolve 되는 경로가 생기더라도
        // 백엔드 ack 까지 확인한다. 이미 ack 됐으면 즉시 resolve 라 비용이 없다.
        await waitForPendingWrites(db);
      });
    },
    isTerminal: isTerminalLedgerError,
    verify: verifyLedgerRecord,
    onNotice: (n) => {
      lastSpoolNotice = n;
    },
  });
  return spoolSingleton;
}

let lastSpoolNotice: SpoolNotice | null = null;

/** 기동 시 이전 프로세스가 남긴 스풀을 복원한다(순서 보존 재적재). */
export async function restoreLedgerSpool(): Promise<number> {
  try {
    // ★체인 머리를 **먼저** 이어받는다. 스풀에서 복원되는 레코드는 이전 기동에서
    // 이미 봉인돼 있으므로 다시 봉인하지 않지만, 복원 직후 들어오는 새 이벤트는
    // 이어받은 머리에서 seq 를 받아야 한다. 순서가 뒤바뀌면 새 이벤트가 seq 0 을
    // 다시 발급받아 원장에 같은 자리가 두 벌 생긴다.
    await restoreLedgerChain();
    return await ledgerSpool().restore();
  } catch (err) {
    console.error(
      `[Audit] 스풀 복원 실패: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return 0;
  }
}

function sanitizeParams(
  params: Record<string, unknown>,
): Record<string, unknown> {
  const sanitized: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === "string" && value.length > 200) {
      sanitized[key] = value.slice(0, 200) + "...";
    } else {
      sanitized[key] = value;
    }
  }
  return sanitized;
}

function instructionFromParams(
  params: Record<string, unknown>,
): string | undefined {
  const candidates = [
    params.instruction,
    params.instructions,
    params.initial_prompt,
    params.initialPrompt,
    params.prompt,
  ];
  for (const value of candidates) {
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function truncateResult(result: unknown): string {
  const t = typeof result === "string" ? result : JSON.stringify(result);
  return t.length > 500 ? t.slice(0, 500) + "..." : t;
}

// ── Tool Registration ────────────────────────────────────────

// ── 토큰 절감: list 도구 결과 cap + 안내 footer ──
// MCP 도구 결과는 호출 세션의 컨텍스트에 끝까지 잔존한다(오케/에이전트 비용의 큰
// 축). list 도구가 무제한 덤프하면 컨텍스트가 불어나므로 기본 cap 을 둔다.
const LIST_LIMIT_DEFAULT = 50;
// search_tasks matches keywords with an in-memory substring scan, so the read
// window must be larger than the display `limit` or search would only ever look
// at the newest `limit` tasks. This caps the worst-case read (previously the
// whole `tasks` collection, per P2-5) while keeping search usefully broad: the
// newest SEARCH_SCAN_CAP tasks are scanned, up to `limit` matches returned.
const SEARCH_SCAN_CAP = 500;
const TITLE_MAX = 80;
function truncTitle(title: unknown, max = TITLE_MAX): string {
  const s = typeof title === "string" ? title : String(title ?? "");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}
function capLines(lines: string[], limit: number, hint: string): string {
  if (lines.length <= limit) return lines.join("\n");
  const hidden = lines.length - limit;
  return `${lines
    .slice(0, limit)
    .join("\n")}\n… (+${hidden} more hidden — ${hint})`;
}
function isTerminalTaskStatus(s: unknown): boolean {
  return s === "DONE" || s === "FAILED";
}

/**
 * Prepend a stale-build warning to a tool result when this process is serving
 * code older than the bundle on disk.
 *
 * Ticket SsHpTM43EqqPTM1ZWQVA: PR#486 shipped and the bug kept reproducing for
 * a week because a long-lived MCP process keeps running the bundle it loaded at
 * spawn, and nothing anywhere said so. The check rides on tool results because
 * that is the one channel the orchestrator always reads; `staleBuildNotice`
 * self-throttles to ~30min and fails closed to null, so a healthy server pays
 * one cached stat and adds nothing to its output.
 */
async function withStaleBuildNotice<T>(result: T): Promise<T> {
  // 프로세스 수준 경고 두 종을 같은 채널로 붙인다: stale build(이 프로세스가 낡은
  // 번들을 돌리고 있다) + 감사 원장 스풀(감사 기록이 원장에 못 들어가고 있다).
  // 툴 결과는 오케/에이전트가 항상 읽는 유일한 채널이라, 관측돼야 할 프로세스
  // 상태를 여기 태운다.
  //
  // ★스풀 경고는 스로틀하지 않는다 — 상한에 닿는 순간이 가장 시끄러워야 한다.
  // 조용해지면 이 티켓이 없애려던 조용한 유실이 자리만 옮겨 되살아난다.
  // ★두 stale 축은 서로를 못 본다. staleBuildNotice = "이 프로세스가 디스크
  // 번들보다 낡았다"(조치: 재시작). staleSourceNotice = "디스크 번들이 소스보다
  // 낡았다"(조치: 재빌드). 아무도 build:mcp 를 안 돌린 경우 번들 mtime 이 안
  // 움직이므로 앞의 것은 구조적으로 침묵한다 — 티켓 leS1OxfWKcemVfujMoBg 의
  // 2026-09-04 실측이 정확히 그 경우였다. 조치가 다르니 둘 다 붙인다.
  const notice = [
    await staleBuildNotice(),
    await staleSourceNotice(),
    spoolNotice(ledgerSpool().status()),
  ]
    .filter(Boolean)
    .join("\n");
  if (!notice) return result;
  const r = result as { content?: Array<{ type?: string; text?: string }> };
  const first = r?.content?.[0];
  if (!first || typeof first.text !== "string") return result;
  return {
    ...(r as object),
    content: [
      { ...first, text: `${notice}\n\n${first.text}` },
      ...r.content!.slice(1),
    ],
  } as T;
}

/**
 * Run a read-bounding query (base equality filters + an orderBy/limit tail) and
 * fall back to the unbounded query (base filters only) if Firestore rejects it
 * for a missing composite index. Once the indexes in firestore.indexes.json are
 * deployed this bounds Firestore reads to O(limit); until then it degrades to
 * the previous full-collection read instead of hard-failing.
 *
 * P2-5 (ENG-REVIEW-2026-07-12): the list/search/activity tools used to read the
 * entire collection every call and only truncate the rendered text. This pushes
 * the `limit` into the query. The graceful fallback also neutralizes the P3-12
 * "requires an index" hard-fail risk. Callers keep their in-memory filter/sort,
 * so the ORDER of returned rows is unchanged — only the volume read shrinks.
 */
/**
 * ★projectId 스코프는 여기 한 곳에서 강제한다 (티켓 4ov5wbQZ25XUXHZVhxdh).
 *
 * 예전엔 호출부마다 `if (projectId) constraints.push(where("projectId","==",…))`
 * 를 손으로 붙였다. 그래서 MARBLO_PROJECT 가 비면 조건이 통째로 빠진 **무스코프
 * 쿼리**가 나갔고, Firestore 룰은 list 를 쿼리 제약식으로 평가하므로 그건 항상
 * PERMISSION_DENIED 였다 — "권한 문제"처럼 보이지만 실제로는 쿼리가 잘못된 것이다.
 * 이제 스코프 컬렉션이면 projectId 를 무조건 요구하고(없으면 즉시 명확한 에러),
 * 조건 주입도 여기서 한다. 호출부는 projectId 를 넘기기만 하면 된다.
 */
async function boundedGetDocs(
  collectionName: string,
  projectId: string | undefined,
  baseConstraints: QueryConstraint[],
  boundConstraints: QueryConstraint[],
  label: string,
): Promise<QuerySnapshot> {
  const scopeId = requireProjectScope(collectionName, projectId, label);
  const scoped = scopeId
    ? [where("projectId", "==", scopeId), ...baseConstraints]
    : baseConstraints;
  try {
    return await getDocs(
      query(collection(db, collectionName), ...scoped, ...boundConstraints),
    );
  } catch (err) {
    // 권한 거부는 색인 문제가 아니다. 폴백으로 한 번 더 쏘면 똑같이 거부되면서
    // 원인만 흐려지므로(그리고 무스코프 재시도는 더 나쁘다) 즉시 올린다.
    if (isPermissionDeniedError(err)) throw err;
    console.warn(
      `[MCP] ${label}: bounded query failed (likely a missing composite ` +
        `index) — falling back to an unbounded read. Deploy ` +
        `firestore.indexes.json to bound this. ${
          (err as Error)?.message ?? String(err)
        }`,
    );
    return getDocs(query(collection(db, collectionName), ...scoped));
  }
}

// ── 워크트리 감사 뷰 + 오케용 조회 (L4, 설계 §9 4단계 · §15) ──────
//
// 순수 판정 로직은 worktree-audit.ts. 여기는 그 판정에 넣을 근거를 모으는
// 불순물(fs/git/Firestore/bridge HTTP)만 담당한다.

/** `<root>/<projectId>/<taskId>` 규약에서 이 프로젝트의 워크트리 디렉터리를 스캔한다. */
function scanDiskWorktreeIds(projectId: string): string[] {
  const home = os.homedir();
  const projectDir = path.join(worktreesRoot(home), projectId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectDir, { withFileTypes: true });
  } catch {
    return []; // 프로젝트 버킷이 아직 없음 — 정상(워크트리를 한 번도 안 만든 프로젝트)
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const classified = classifyWorktreeDir(path.join(projectDir, entry.name), {
      homeDir: home,
    });
    if (classified.worktreeId) ids.push(classified.worktreeId);
  }
  return ids;
}

function worktreeDiskPath(worktreeId: string): string {
  const [projectId, taskId] = worktreeId.split("/");
  return path.join(worktreesRoot(os.homedir()), projectId, taskId);
}

function worktreeExistsOnDisk(worktreeId: string): boolean {
  return fs.existsSync(worktreeDiskPath(worktreeId));
}

function auditLogDocToEvent(
  data: Record<string, unknown>,
): WorktreeAuditEvent & {
  taskId: string | null;
  success: boolean;
  kind: string;
} {
  const createdAt = data.createdAt as { toMillis?: () => number } | undefined;
  return {
    agentId: typeof data.agentId === "string" ? data.agentId : "",
    occurredAtMs:
      typeof createdAt?.toMillis === "function" ? createdAt.toMillis() : 0,
    toolName: typeof data.toolName === "string" ? data.toolName : "",
    taskId: typeof data.taskId === "string" ? data.taskId : null,
    success: data.success !== false,
    kind: typeof data.kind === "string" ? data.kind : "action",
    seq: typeof data.seq === "number" ? data.seq : undefined,
    prevHash: typeof data.prevHash === "string" ? data.prevHash : undefined,
    hash: typeof data.hash === "string" ? data.hash : undefined,
  };
}

/** 프로젝트 스코프 원장에서 최근 창(cap) 안의 이벤트를 읽는다.
 *  ★스캔 상한 밖의(더 오래된) 워크트리 활동은 이 창에 안 잡힐 수 있다 —
 *  호출부가 결과에 그 한계를 명시해야 한다(설계 §15 — 모른다를 괜찮다로 답 금지). */
const WORKTREE_LEDGER_SCAN_CAP = 500;
async function scanLedgerAuditWindow(projectId: string): Promise<{
  events: Array<
    WorktreeAuditEvent & { worktreeId: string; taskId: string | null }
  >;
  scanned: number;
  capped: boolean;
}> {
  const snap = await boundedGetDocs(
    "audit_logs",
    projectId,
    [],
    [orderBy("createdAt", "desc"), fsLimit(WORKTREE_LEDGER_SCAN_CAP)],
    "worktree_audit:scan",
  );
  const events: Array<
    WorktreeAuditEvent & { worktreeId: string; taskId: string | null }
  > = [];
  for (const d of snap.docs) {
    const data = d.data() as Record<string, unknown>;
    const worktreeId = data.worktreeId;
    if (typeof worktreeId !== "string" || !worktreeId) continue;
    events.push({ ...auditLogDocToEvent(data), worktreeId });
  }
  return {
    events,
    scanned: snap.size,
    capped: snap.size >= WORKTREE_LEDGER_SCAN_CAP,
  };
}

const WORKTREE_EVENT_CAP = 200;
/** 워크트리 하나의 원장 이벤트를 전용 쿼리로 읽는다(project 스코프 스캔 창보다
 *  넓게 — 한 워크트리 딥다이브는 project 전체 최근창에 안 잡혀도 봐야 한다). */
async function fetchWorktreeLedgerEvents(
  projectId: string,
  worktreeId: string,
): Promise<
  Array<
    WorktreeAuditEvent & {
      taskId: string | null;
      success: boolean;
      kind: string;
    }
  >
> {
  const snap = await boundedGetDocs(
    "audit_logs",
    projectId,
    [where("worktreeId", "==", worktreeId)],
    [orderBy("createdAt", "desc"), fsLimit(WORKTREE_EVENT_CAP)],
    "get_worktree_audit:events",
  );
  return snap.docs.map((d) =>
    auditLogDocToEvent(d.data() as Record<string, unknown>),
  );
}

/** 한 티켓의 머지 기록(최근 것 우선). orderBy 를 쓰므로 복합 색인이 없으면
 *  boundedGetDocs 가 project+taskId 만으로 무순 폴백한다 — 여전히 정확하다. */
async function fetchMergeHistoryForTask(
  projectId: string,
  taskId: string,
): Promise<MergeHistoryRow[]> {
  const snap = await boundedGetDocs(
    "merge_history",
    projectId,
    [where("taskId", "==", taskId)],
    [orderBy("mergedAt", "desc"), fsLimit(10)],
    "worktree_audit:merge_history",
  );
  return snap.docs.map((d) => {
    const data = d.data() as Record<string, unknown>;
    const mergedAt = data.mergedAt as { toMillis?: () => number } | undefined;
    return {
      taskId: typeof data.taskId === "string" ? data.taskId : null,
      branch: typeof data.branch === "string" ? data.branch : null,
      headSha: typeof data.headSha === "string" ? data.headSha : null,
      mergedAtMs:
        typeof mergedAt?.toMillis === "function" ? mergedAt.toMillis() : null,
    };
  });
}

/** 여러 티켓의 머지 기록을 태스크당 개별 쿼리로 읽는다(순수 동등비교만 써서
 *  `in` + 복합색인 요구를 피한다 — 목록 뷰는 row 수가 이미 limit 로 상한돼 있다). */
async function fetchMergeInfoByTaskId(
  projectId: string,
  taskIds: readonly string[],
): Promise<Map<string, MergeInfo | null>> {
  const unique = [...new Set(taskIds)];
  const rows = await Promise.all(
    unique.map(async (taskId) => {
      try {
        const snap = await boundedGetDocs(
          "merge_history",
          projectId,
          [where("taskId", "==", taskId)],
          [fsLimit(5)],
          "list_worktree_audit:merge_history",
        );
        return snap.docs.map((d) => {
          const data = d.data() as Record<string, unknown>;
          const mergedAt = data.mergedAt as
            | { toMillis?: () => number }
            | undefined;
          return {
            taskId,
            branch: typeof data.branch === "string" ? data.branch : null,
            headSha: typeof data.headSha === "string" ? data.headSha : null,
            mergedAtMs:
              typeof mergedAt?.toMillis === "function"
                ? mergedAt.toMillis()
                : null,
          } as MergeHistoryRow;
        });
      } catch {
        return [] as MergeHistoryRow[];
      }
    }),
  );
  const byTaskId = new Map<string, MergeInfo | null>();
  unique.forEach((taskId, i) => byTaskId.set(taskId, pickLatestMerge(rows[i])));
  return byTaskId;
}

interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** `runGh` 와 같은 모양의 git 실행기. 인자를 배열로 넘겨 셸 인젝션 경로가 없다. */
function runGit(
  args: string[],
  cwd: string,
  timeoutMs = 8_000,
): Promise<GitRunResult> {
  return new Promise((resolve) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn("git", args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: process.env,
      });
    } catch (e) {
      resolve({
        code: -1,
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
      });
      return;
    }
    let stdout = "";
    let stderr = "";
    let settled = false;
    const done = (r: GitRunResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    const timer = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {
        /* already gone */
      }
      done({ code: -1, stdout, stderr: `git timed out after ${timeoutMs}ms` });
    }, timeoutMs);
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (e) =>
      done({ code: -1, stdout, stderr: e.message || String(e) }),
    );
    child.on("close", (code) => done({ code: code ?? -1, stdout, stderr }));
  });
}

interface SubmitForReviewGitEvidence {
  worktreeExists: boolean;
  commitsSinceBase: number | null;
  uncommittedFileCount: number | null;
  pushedToOrigin: boolean | null;
  branch: string | null;
}

interface SubmitForReviewGhPr {
  url?: string;
}

async function countCommitsSinceOriginHead(
  worktreePath: string,
): Promise<number | null> {
  const base = await runGit(
    ["merge-base", "HEAD", "origin/HEAD"],
    worktreePath,
  );
  const baseSha = base.stdout.trim();
  if (base.code !== 0 || !baseSha) return null;

  const count = await runGit(
    ["rev-list", "--count", `${baseSha}..HEAD`],
    worktreePath,
  );
  const raw = count.stdout.trim();
  if (count.code !== 0 || !/^\d+$/.test(raw)) return null;
  return parseInt(raw, 10);
}

async function collectSubmitForReviewGitEvidence(
  worktreePath: string,
): Promise<SubmitForReviewGitEvidence> {
  if (!fs.existsSync(worktreePath)) {
    return {
      worktreeExists: false,
      commitsSinceBase: null,
      uncommittedFileCount: null,
      pushedToOrigin: null,
      branch: null,
    };
  }

  const status = await runGit(["status", "--porcelain"], worktreePath);
  const uncommittedFileCount =
    status.code === 0
      ? status.stdout.split(/\r?\n/).filter((line) => line.length > 0).length
      : null;

  const commitsSinceBase = await countCommitsSinceOriginHead(worktreePath);

  const branchRes = await runGit(["branch", "--show-current"], worktreePath);
  const branch =
    branchRes.code === 0 && branchRes.stdout.trim()
      ? branchRes.stdout.trim()
      : null;

  const originUrl = await runGit(["remote", "get-url", "origin"], worktreePath);
  let pushedToOrigin: boolean | null = null;
  if (originUrl.code === 0) {
    const contains = await runGit(
      ["branch", "-r", "--contains", "HEAD"],
      worktreePath,
    );
    if (contains.code === 0) {
      pushedToOrigin = contains.stdout
        .split("\n")
        .map((line) => line.trim())
        .some((line) => line.startsWith("origin/"));
    }
  }

  return {
    worktreeExists: true,
    commitsSinceBase,
    uncommittedFileCount,
    pushedToOrigin,
    branch,
  };
}

function parseGhPrUrl(raw: string): string | null {
  try {
    const row = JSON.parse(raw) as SubmitForReviewGhPr;
    return typeof row.url === "string" && row.url ? row.url : null;
  } catch {
    return null;
  }
}

async function findSubmitForReviewPrUrl(
  worktreePath: string,
  branch: string | null,
): Promise<string | null> {
  const direct = await runGh(
    ["pr", "view", "--json", "url"],
    worktreePath,
    10_000,
  );
  if (direct.code === 0) {
    const url = parseGhPrUrl(direct.stdout);
    if (url) return url;
  }

  if (!branch) return null;
  const listed = await runGh(
    [
      "pr",
      "list",
      "--head",
      branch,
      "--state",
      "all",
      "--limit",
      "1",
      "--json",
      "url",
    ],
    worktreePath,
    10_000,
  );
  if (listed.code !== 0) return null;
  try {
    const rows = JSON.parse(listed.stdout) as SubmitForReviewGhPr[];
    const url = rows[0]?.url;
    return typeof url === "string" && url ? url : null;
  } catch {
    return null;
  }
}

/** dirty/unpushed 를 읽기 전용으로 관측한다. 삭제 정책 자체는 여기서 판단하지
 *  않는다(worktree-manager.ts `reapSafety()` 담당, 설계 §2 재구현 금지). */
async function gitWorktreeSafetyEvidence(
  worktreePath: string,
): Promise<{ dirty: boolean | null; unpushedCount: number | null }> {
  const status = await runGit(["status", "--porcelain"], worktreePath);
  const dirty = status.code === 0 ? status.stdout.trim().length > 0 : null;

  const upstream = await runGit(
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    worktreePath,
  );
  if (upstream.code !== 0) {
    return { dirty, unpushedCount: null };
  }
  const count = await runGit(
    ["rev-list", "--count", "@{u}..HEAD"],
    worktreePath,
  );
  const unpushedCount =
    count.code === 0 && /^\d+$/.test(count.stdout.trim())
      ? parseInt(count.stdout.trim(), 10)
      : null;
  return { dirty, unpushedCount };
}

/** headSha 가 이 프로세스가 실행 중인 빌드 커밋의 조상인지 확인한다.
 *  `mergedSha`(=squash 뒤 base HEAD)를 쓰므로 squash 로 인해 브랜치 자체 커밋이
 *  base 의 조상이 되지 않는 함정(merge_and_close 주석 참조)에 걸리지 않는다. */
async function checkAncestor(
  repoCwd: string,
  ancestorSha: string,
  descendantSha: string,
): Promise<"ancestor" | "not-ancestor" | "unknown"> {
  const res = await runGit(
    ["merge-base", "--is-ancestor", ancestorSha, descendantSha],
    repoCwd,
  );
  if (res.code === 0) return "ancestor";
  if (res.code === 1) return "not-ancestor";
  return "unknown"; // 128 등 — shallow clone 등으로 커밋을 아예 못 찾음
}

/** 담당 에이전트가 지금 활동 중인지. ★Firestore `agents.status` 는 신뢰하지
 *  않는다 — `normalizeFirestoreFallbackAgentStatus` 가 이미 그 필드를 stale 로
 *  취급한다(agent-status-labels.ts). 브리지(실시간)가 없으면 unknown 을 낸다. */
async function checkAgentBusy(
  agentId: string | null,
  projectId: string,
): Promise<boolean | null> {
  if (!agentId) return null;
  const bridgePort = process.env.MARBLO_BRIDGE_PORT;
  if (!bridgePort) return null;
  try {
    const url = `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
      projectId,
    )}`;
    const response = await fetch(url, { headers: bridgeHeaders() });
    const data = (await response.json()) as {
      agents: Array<{ id: string; status: string }>;
    };
    const found = data.agents?.find((a) => a.id === agentId);
    if (!found) return null; // 못 찾음 = 미상(다른 창/재시작 등일 수 있음) — false 아님
    if (found.status === "working") return true;
    if (
      found.status === "idle" ||
      found.status === "error" ||
      found.status === "stopped"
    ) {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

/** worktree_id/task_id 입력을 (projectId, taskId, worktreeId) 로 정규화한다. */
/**
 * worktree_id/task_id 입력을 (taskId, worktreeId) 로 정규화한다.
 *
 * ★projectId 는 호출부가 `enforceProjectLock()` 으로 이미 잠근 값을 받는다 —
 * 여기서 다시 잠그지 않는다. project-lock-surface.test.ts 는 `project_id` 를
 * 선언한 "locked" 툴의 **등록 블록 본문에** `enforceProjectLock(` 리터럴이
 * 있는지 정적으로 스캔한다(조용한 무시 회귀 방지 가드). 그 호출을 이 헬퍼
 * 안으로 숨기면 스캔이 못 보므로, 각 툴 핸들러가 자기 블록에서 직접 부른다.
 */
function resolveWorktreeTarget(
  lockedProjectId: string,
  input: { worktree_id?: string; task_id?: string },
):
  | { projectId: string; taskId: string; worktreeId: string }
  | { error: string } {
  if (!input.worktree_id && !input.task_id) {
    return { error: "worktree_id 또는 task_id 중 하나는 있어야 합니다." };
  }
  if (input.worktree_id) {
    const parts = input.worktree_id.split("/");
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      return {
        error: `worktree_id 형식이 올바르지 않습니다(<projectId>/<taskId> 기대): ${input.worktree_id}`,
      };
    }
    const [wProjectId, wTaskId] = parts;
    if (wProjectId !== lockedProjectId) {
      return {
        error: `worktree_id 의 projectId(${wProjectId})가 세션 프로젝트(${lockedProjectId})와 다릅니다.`,
      };
    }
    if (input.task_id && input.task_id !== wTaskId) {
      return {
        error: `worktree_id 의 taskId(${wTaskId})가 task_id(${input.task_id})와 다릅니다.`,
      };
    }
    return {
      projectId: lockedProjectId,
      taskId: wTaskId,
      worktreeId: input.worktree_id,
    };
  }
  const taskId = input.task_id as string;
  return {
    projectId: lockedProjectId,
    taskId,
    worktreeId: `${lockedProjectId}/${taskId}`,
  };
}

// ── 완료 보고(completion report) 규약 ──
// 에이전트가 REVIEW/DONE 으로 닫을 때 "무엇이 문제였고 어떻게 풀었는지" 구조화
// 요약을 티켓에 "✅ 완료 보고" activity 로 남기게 한다. 진행 add_activity 가
// 흩어지고 최종 요약이 PR 본문에만 있어 보드/티켓에서 완료 내역을 한눈에 못 보던
// 문제를 막는다. 순수 로직(포맷/판정/nudge)은 ./completion-report.ts.

/** submit_for_review / update_task_status 가 받는 optional 구조화 완료 요약. */
const completionSummaryShape = z
  .object({
    problem: z
      .string()
      .optional()
      .describe("무엇이 문제였나 / 무엇을 하려 했나"),
    approach: z.string().optional().describe("어떻게 접근/해결했나"),
    changes: z.string().optional().describe("무엇을 바꿨나 (파일/모듈 요약)"),
    verification: z
      .string()
      .optional()
      .describe("어떻게 검증했나 (테스트/타입체크/수동확인)"),
    pr: z.string().optional().describe("관련 PR URL"),
  })
  .optional()
  .describe(
    '완료 요약(선택). 주면 티켓에 "✅ 완료 보고" activity 로 기록된다. ' +
      "안 주면 직전 완료 보고 activity 를 인식하고, 그것도 없으면 보완 nudge 를 돌려준다.",
  );

/**
 * 같은 트랜잭션 밖에서 완료 보고 activity 한 건을 기록(상태 변경 없음).
 * add_activity 핸들러와 같은 projection 경로를 쓰되, 별도 orch PTY notify 는
 * 하지 않는다 — submit_for_review/update_status 가 이미 완료 이벤트를 알린다.
 */
async function recordCompletionReport(
  taskId: string,
  reportMessage: string,
): Promise<void> {
  await applyProjection(db, taskId, {
    lastAgentId: workerAgentId(MARBLO_AGENT_ID),
    lastActivitySummary: reportMessage,
    activityPayload: { agentId: MARBLO_AGENT_ID, message: reportMessage },
  });
}

/** task 의 최근 activity 메시지들(createdAt 내림차순, 최대 window 개). */
async function fetchRecentActivityMessages(
  taskId: string,
  window = 20,
): Promise<string[]> {
  // P2-5: push the "newest `window`" slice into the query (orderBy desc + limit)
  // so a long-lived task's full activity history is never read into memory. The
  // in-memory sort+slice below is kept so the index-missing fallback path still
  // returns the newest `window` entries.
  const snap = await boundedGetDocs(
    "activities",
    // activities 는 프로젝트 스코프 컬렉션이 아니다 — 룰이
    // isTaskProjectMember(resource.data.taskId) 라 taskId 고정으로 증명된다.
    undefined,
    [where("taskId", "==", taskId)],
    [orderBy("createdAt", "desc"), fsLimit(window)],
    "fetchRecentActivityMessages",
  );
  return snap.docs
    .map(
      (d) =>
        d.data() as {
          message?: string;
          createdAt?: { toMillis?: () => number };
        },
    )
    .sort(
      (a, b) =>
        (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0),
    )
    .slice(0, window)
    .map((d) => d.message ?? "");
}

interface ActivityMessageRow {
  message: string;
  createdAtMs: number;
}

interface PendingWikiDecisionTask {
  taskId: string;
  title: string;
  promptedAtMs: number;
}

interface PendingWikiDecisionSummary {
  count: number;
  examples: string[];
}

function timestampMillis(value: unknown): number {
  if (
    value &&
    typeof value === "object" &&
    "toMillis" in value &&
    typeof value.toMillis === "function"
  ) {
    const millis = value.toMillis();
    return Number.isFinite(millis) ? millis : 0;
  }
  return 0;
}

function pendingWikiDecisionFromTask(
  id: string,
  data: Record<string, unknown>,
): PendingWikiDecisionTask | null {
  const decision =
    data.wikiDecision &&
    typeof data.wikiDecision === "object" &&
    !Array.isArray(data.wikiDecision)
      ? (data.wikiDecision as Record<string, unknown>)
      : null;
  if (!decision) return null;
  if (decision.status !== "PENDING") return null;
  if (decision.sourceTool !== "merge_and_close") return null;
  const promptedAtMs = timestampMillis(decision.promptedAt);
  const title = typeof data.title === "string" ? data.title : "(untitled)";
  return { taskId: id, title, promptedAtMs };
}

async function fetchRecentActivityRows(
  taskId: string,
  window = 80,
): Promise<ActivityMessageRow[]> {
  const snap = await boundedGetDocs(
    "activities",
    undefined,
    [where("taskId", "==", taskId)],
    [orderBy("createdAt", "desc"), fsLimit(window)],
    "fetchRecentActivityRows",
  );
  return snap.docs
    .map((d) => {
      const data = d.data() as { message?: unknown; createdAt?: unknown };
      return {
        message: typeof data.message === "string" ? data.message : "",
        createdAtMs: timestampMillis(data.createdAt),
      };
    })
    .sort((a, b) => b.createdAtMs - a.createdAtMs);
}

async function hasResolvedWikiDecision(
  task: PendingWikiDecisionTask,
): Promise<boolean> {
  const rows = await fetchRecentActivityRows(task.taskId);
  return rows.some(
    (row) =>
      row.createdAtMs >= task.promptedAtMs &&
      isWikiDecisionResolvedMessage(row.message),
  );
}

async function fetchPendingWikiDecisionSummary(
  projectId: string,
  currentTaskId: string,
): Promise<PendingWikiDecisionSummary> {
  // Keep this to the existing projectId scope query; adding
  // where("wikiDecision.status", "==", "PENDING") would need a new deployed index
  // on the merge path, and wiki reminders must never make closeout brittle.
  const snap = await boundedGetDocs(
    "tasks",
    projectId,
    [],
    [],
    "fetchPendingWikiDecisionSummary",
  );
  const candidates = snap.docs
    .map((d) => pendingWikiDecisionFromTask(d.id, d.data()))
    .filter((row): row is PendingWikiDecisionTask => row !== null);

  const unresolved: PendingWikiDecisionTask[] = [];
  for (const task of candidates) {
    if (!(await hasResolvedWikiDecision(task))) unresolved.push(task);
  }

  unresolved.sort((a, b) => {
    if (a.taskId === currentTaskId) return -1;
    if (b.taskId === currentTaskId) return 1;
    return b.promptedAtMs - a.promptedAtMs;
  });
  return {
    count: unresolved.length,
    examples: unresolved
      .slice(0, 3)
      .map((task) => `${task.taskId} ${task.title}`),
  };
}

async function recordMergeWikiDecisionPrompt(
  task: TaskDoc,
  merge: MergeVerdict,
  prLabel: string,
): Promise<string | null> {
  const existing = task.wikiDecision;
  if (
    existing?.status === "PENDING" &&
    existing.sourceTool === "merge_and_close"
  ) {
    return null;
  }

  const prUrl = merge.url || task.prUrl || undefined;
  const wikiDecision: Record<string, unknown> = {
    status: "PENDING",
    sourceTool: "merge_and_close",
    promptedAt: Timestamp.now(),
  };
  if (merge.prNumber) wikiDecision.prNumber = merge.prNumber;
  if (prUrl) wikiDecision.prUrl = prUrl;

  try {
    await applyProjection(db, task.id, {
      lastAgentId: WORKER_AGENT_ID,
      lastActivitySummary: `merge_and_close: wiki decision pending ${prLabel}`,
      extraTaskFields: { wikiDecision },
      activityPayload: {
        agentId: MARBLO_AGENT_ID,
        message:
          `${WIKI_DECISION_PENDING_MARKER} merge_and_close asked whether ` +
          `${prLabel} should update docs/wiki or WIKI-SKIP.`,
      },
    });
    return null;
  } catch (err) {
    console.error("[merge_and_close] wiki decision prompt record failed:", err);
    return err instanceof Error ? err.message : String(err);
  }
}

async function mergeWikiDecisionPromptForResponse(
  task: TaskDoc,
  merge: MergeVerdict,
  prLabel: string,
): Promise<string | null> {
  const existing = task.wikiDecision;
  const alreadyResolved =
    existing?.status === "PENDING" &&
    existing.sourceTool === "merge_and_close" &&
    existing.promptedAt instanceof Timestamp
      ? await hasResolvedWikiDecision({
          taskId: task.id,
          title: task.title,
          promptedAtMs: timestampMillis(existing.promptedAt),
        })
      : false;
  if (
    !shouldPromptForMergeWikiDecision({
      mergeState: merge.state,
      alreadyResolved,
    })
  ) {
    return null;
  }

  const recordError = await recordMergeWikiDecisionPrompt(task, merge, prLabel);
  try {
    const summary = await fetchPendingWikiDecisionSummary(
      task.projectId || DEFAULT_PROJECT,
      task.id,
    );
    return formatMergeWikiDecisionPrompt({
      taskId: task.id,
      pendingUnresolvedCount: summary.count,
      pendingExamples: summary.examples,
      ...(recordError ? { recordError } : {}),
    });
  } catch (err) {
    console.error("[merge_and_close] wiki decision pending count failed:", err);
    return formatMergeWikiDecisionPrompt({
      taskId: task.id,
      ...(recordError ? { recordError } : {}),
    });
  }
}

/**
 * REVIEW/DONE 전이 시 완료 보고 규약을 적용하고, 보완이 필요하면 nudge 문자열을
 * 반환한다(호출부가 응답 text 끝에 덧붙임). 순수 결정은 resolveCompletionReport.
 *
 * ⚠️ 절대 throw/block 하지 않는다 — 보고 누락은 상태 전이를 막지 않는다(에이전트
 * stranding 방지). best-effort: Firestore 조회/기록 실패는 삼키고 nudge 없이 통과.
 */
async function applyCompletionReport(
  taskId: string,
  status: string,
  summary: CompletionSummary | undefined,
): Promise<string> {
  try {
    // 행복 경로(summary 동봉)에선 Firestore 조회를 아낀다 — summary 가 있으면
    // 무조건 기록이고 최근 activity 는 볼 필요 없다. summary 가 없을 때만 최근
    // activity 를 읽어 이미 보고가 있는지 본 뒤 nudge 여부를 가린다.
    if (formatCompletionReport(summary)) {
      const { report } = resolveCompletionReport(taskId, status, summary, []);
      if (report) await recordCompletionReport(taskId, report);
      return "";
    }
    const recent = await fetchRecentActivityMessages(taskId);
    const { report, nudge } = resolveCompletionReport(
      taskId,
      status,
      summary,
      recent,
    );
    if (report) await recordCompletionReport(taskId, report);
    return nudge;
  } catch (err) {
    console.error("[MCP] completion-report handling failed:", err);
    return "";
  }
}

interface PendingInstructionDoc {
  id: string;
  createdAt?: { toMillis?: () => number };
  isDelivered?: boolean;
  fromUserName?: string;
  fromUserId?: string;
  sourceType?: string;
  message?: string;
  [key: string]: unknown;
}

/**
 * ★워크체인 자동 포착 훅 (티켓 lW9iiLGWlO0lVoy4khSM).
 *
 * 오케가 도구 인자로 이미 쓴 문장에서 "다음에 할 일" 을 집어 체인에 적고, 적었다는
 * 사실을 한 줄로 돌려준다. 왜 이 층인가 — 체인의 **읽는 쪽**은 이미 자동인데
 * (도구 결과 푸터 4곳) **쓰는 쪽**만 오케의 자발적 `add_work_chain_item` 호출이라
 * "잊는 걸 고치는 장치가 안 잊어야 작동한다" 는 순환에 걸려 있었다. 2026-08-22 에
 * 실제로 터졌다(§work-chain-capture.ts 머리말). 그래서 오케에게 한 번 더 부르라고
 * 조르는 대신, **말하는 행위 자체를 적는 행위로** 만든다.
 *
 * 규율 셋:
 *   · 오케 세션에서만 돈다. 워커가 쓴 문장은 오케의 다음 할 일이 아니다.
 *   · 감지 0건이면 Firestore 를 읽지도 않는다 — 약속 없는 호출의 비용·소음은 0.
 *   · ★절대 원래 도구를 실패시키지 않는다(fail-open). 다만 쓰기 실패는 삼키지
 *     않고 문장으로 돌려준다 — "적혔다" 고 믿게 두는 게 안 적은 것보다 나쁘다.
 */
async function captureChainPromiseNote(
  surface: CaptureSurface,
  tool: string,
  body: string | null | undefined,
  opts: { projectId?: string | null; contextTaskId?: string | null } = {},
): Promise<string> {
  if (!isOrchestratorAgentId(MARBLO_AGENT_ID)) return "";
  if (!body || !body.trim()) return "";
  const projectId = (opts.projectId || DEFAULT_PROJECT || "").trim();
  if (!projectId) return "";
  try {
    const res = await captureWorkChainPromises(db, {
      projectId,
      by: MARBLO_AGENT_ID,
      tool,
      surface,
      text: body,
      ...(opts.contextTaskId ? { contextTaskId: opts.contextTaskId } : {}),
    });
    return res.note;
  } catch (err) {
    // 여기까지 새는 예외는 없어야 하지만(captureWorkChainPromises 가 이미
    // fail-open), 훅이 도구를 죽이는 경로는 구조적으로 없어야 한다.
    console.error(`[work-chain] capture hook (${tool}) skipped:`, err);
    return "";
  }
}

/**
 * ★사장님 미션 포착 훅 (티켓 wx9c4NeVtZ1SGcbEISpg).
 *
 * 위 훅은 **오케가 쓴 문장**을 읽는다. 이건 정반대로 **오케가 한 행동**을 읽는다:
 * 사장님 인바운드(텔레그램/Slack) 직후에 티켓이 생기면 그 티켓이 사장님 미션이다.
 * 사장님 한국어를 분류하지 않는 게 요점이다 — 근거·기각 사유 전문은
 * `work-chain-capture.ts` 의 "사장님 미션 포착" 절.
 *
 * 규율은 위 훅과 같다: 오케 세션에서만, 인바운드가 없으면 Firestore 를 읽지도
 * 않고, ★절대 create_task 를 실패시키지 않는다.
 */
async function captureOwnerMissionNote(
  projectId: string,
  tool: string,
  tasks: readonly CreatedTaskFact[],
): Promise<string> {
  if (!isOrchestratorAgentId(MARBLO_AGENT_ID)) return "";
  if (!projectId || tasks.length === 0) return "";
  try {
    const res = await captureOwnerMission(db, {
      projectId,
      by: MARBLO_AGENT_ID,
      tool,
      tasks,
    });
    return res.note;
  } catch (err) {
    console.error(`[work-chain] owner mission hook (${tool}) skipped:`, err);
    return "";
  }
}

/** 결과 문장 뒤에 포착 알림을 붙인다. 빈 문자열이면 원문 그대로. */
function withCaptureNote(body: string, note: string): string {
  return note ? `${body}\n\n${note}` : body;
}

export function registerTools(server: McpServer): void {
  // Wrap server.tool to add automatic audit logging
  const originalTool = server.tool.bind(server);

  // ── 부트 프리픽스 다이어트 A1: 역할별 tools/list 스코핑 ──────────────────
  // 전체 44개 툴의 스키마 직렬화는 40.8KB(~11.7K 토큰)이고 워커 프리픽스에
  // **매 요청** 재전송된다(#900 §3.4). 워커 역할이면 그 역할이 실제 쓰는 툴만
  // 등록해 표면 자체를 줄인다. 표면 결정은 fail-open이고 `MARBLO_TOOL_SURFACE=full`
  // 로 즉시 되돌릴 수 있다 — 정책 전문은 tool-surface.ts 참조.
  const surface = resolveToolSurface();
  const hiddenTools: string[] = [];
  const registeredToolNames: string[] = [];

  function toolIsExposed(name: string): boolean {
    if (surface.mode === "full" || !surface.allowed) return true;
    return surface.allowed.has(name);
  }
  /** MissingProjectScopeError 를 도구 결과 텍스트로. 아니면 null(그대로 throw). */
  function projectScopeErrorText(
    toolName: string,
    err: unknown,
  ): string | null {
    if (!(err instanceof MissingProjectScopeError)) return null;
    return `Error: ${toolName} — ${err.message}`;
  }

  function auditedTool<Args extends ZodRawShapeCompat>(
    name: string,
    description: string,
    schema: Args,
    handler: ToolCallback<Args>,
    opts: { userFacing?: boolean } = {},
  ): void {
    // 역할 스코핑에서 빠진 툴은 **등록 자체를 하지 않는다.** 핸들러만 막으면
    // 스키마가 그대로 tools/list 에 실려 프리픽스가 안 줄어든다 — 이 다이어트의
    // 절감은 오직 "등록하지 않음"에서 나온다.
    if (!toolIsExposed(name)) {
      hiddenTools.push(name);
      return;
    }
    registeredToolNames.push(name);
    const userFacing = opts.userFacing ?? true;
    // 모든 도구 핸들러는 실행 전 ensureAuthenticated() 인증 게이트를 거친다.
    // MCP 핸드셰이크는 인증에 막히지 않도록 index.ts 에서 connect 를 먼저 하므로
    // (도구 discovery 는 인증 무관), 실제 인증 보장은 여기 각 호출부가 담당한다.
    // 정상 로그인 시 즉시 통과. 미인증이면 bridge 재인증을 시도하고, 실패 시
    // '인증 실패'를 명시한 McpAuthError 를 던진다 — 익명으로 조용히 진행해
    // PERMISSION_DENIED 로 둔갑하던 무증상 마비를 제거(티켓 etTRzsjqSr3S60xS5Wva).
    if (!userFacing) {
      // 사용자 액티비티 스트림에 노출하지 않는 read-only 조회 툴.
      // 감사 로그 자체를 쓰지 않는다 — 시스템 페이로드(스킬 본문 등) 노이즈 방지.
      const gatedHandler = (async (...args: unknown[]) => {
        // ★프로브 (b): 인증·실행보다 **먼저** 찍는다. 이 시점에 이미 "에이전트의
        // 툴콜 루프가 서버까지 왕복했다" 는 사실이 성립하고, 그게 프로브가 재는
        // 전부다 — 툴이 그 뒤에 실패하든 행(hang)이 걸리든 생존 증거는 유효하다.
        // ★읽기전용(비-userFacing) 툴에서 특히 중요하다: 이쪽은 감사 로그도
        // 안 남기고 projection.lastActivityAt 도 안 올린다. board-quiet 이 볼 수
        // 없는 바로 그 구간을 프로브가 보는 근거가 여기서 만들어진다.
        noteMcpCallToBridge(name);
        await ensureAuthenticated();
        try {
          const result = await (
            handler as unknown as (...a: unknown[]) => unknown
          )(...args);
          return withStaleBuildNotice(result);
        } catch (err) {
          const scoped = projectScopeErrorText(name, err);
          if (scoped) return text(scoped);
          throw err;
        }
      }) as unknown as ToolCallback<Args>;
      originalTool(name, description, schema, gatedHandler);
      return;
    }
    // ToolCallback<Args> is a deferred conditional type while Args is generic,
    // so it isn't directly callable — invoke it through a structural shim that
    // exposes only the CallToolResult shape we read for audit logging.
    const invoke = handler as unknown as (
      ...args: unknown[]
    ) => Promise<{ content?: Array<{ text?: string }> }>;
    const wrapped = (async (...args: unknown[]) => {
      // ★프로브 (b) 하트비트 — 위 gatedHandler 와 같은 이유로 인증보다 먼저.
      noteMcpCallToBridge(name);
      // Firestore 접근 전 인증 게이트 (discovery 는 인증 무관, 실행은 인증 보장).
      await ensureAuthenticated();
      const start = Date.now();
      let success = true;
      let resultText = "";

      try {
        const orchestratorGuardError =
          await validateLiveOrchestratorToolCall(name);
        if (orchestratorGuardError) {
          resultText = orchestratorGuardError;
          return text(orchestratorGuardError);
        }
        const result = (await withStaleBuildNotice(
          await invoke(...args),
        )) as Awaited<ReturnType<typeof invoke>>;
        resultText = result?.content?.[0]?.text || "";
        return result;
      } catch (err) {
        success = false;
        resultText = err instanceof Error ? err.message : String(err);
        // projectId 누락은 프로토콜 에러가 아니라 호출자가 고칠 수 있는 입력
        // 문제다. 원문 그대로 텍스트로 돌려줘야 에이전트가 다음 수를 안다
        // (예전엔 이게 PERMISSION_DENIED 로 둔갑해 룰/멤버십을 의심하게 했다).
        const scoped = projectScopeErrorText(name, err);
        if (scoped) {
          resultText = scoped;
          return text(scoped);
        }
        throw err;
      } finally {
        const duration = Date.now() - start;
        const params = (args[0] || {}) as Record<string, unknown>;
        const projectId = resolveProjectForAudit(
          params.project_id as string | undefined,
        );

        auditLog({
          projectId,
          agentId: MARBLO_AGENT_ID,
          toolName: name,
          params: sanitizeParams(params),
          instruction: instructionFromParams(params),
          result: truncateResult(resultText),
          duration,
          success,
        });
      }
    }) as unknown as ToolCallback<Args>;
    originalTool(name, description, schema, wrapped);
  }

  // 1. get_all_tasks
  auditedTool(
    "get_all_tasks",
    "List tasks. EVERY open (non-terminal) task is listed before any completed one — open tasks are never crowded out by completed ones, whatever the limit. Completed tasks fill the leftover row budget as a tail. Filter by project/role; all_projects=true to span projects. Capped to `limit` (default 50) to keep results lean — raise limit or filter to see more.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      role: z
        .string()
        .optional()
        .describe("Filter by role (backend/frontend/test/devops)"),
      all_projects: z
        .boolean()
        .optional()
        .describe(
          "Ignore default project filter, show all projects (default: false)",
        ),
      all_contexts: z
        .boolean()
        .optional()
        .describe(
          "Ignore default context filter, show all contexts in the project (default: false)",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(500)
        .optional()
        .describe("Max rows to return (default 50; open tasks shown first)"),
    },
    async ({ project_id, role, all_projects, all_contexts, limit }) => {
      // all_projects deliberately drops the project filter (its Firestore-rules
      // behavior is a designed refusal, not a bug — see PR#508). But combining
      // it with an explicit project_id is a contradiction, and honoring
      // all_projects while quietly dropping project_id would be exactly the
      // silent ignore this tool is being fixed for. Refuse instead.
      if (all_projects && (project_id ?? "").trim()) {
        throw new ProjectLockError(
          `all_projects=true 와 project_id="${project_id}" 를 함께 줄 수 없습니다.\n` +
            `해야 할 일 — 한 프로젝트만 볼 거면 all_projects 를 빼고, ` +
            `전체를 볼 거면 project_id 를 빼세요.`,
          "mismatch",
        );
      }
      const projectId = all_projects
        ? ""
        : await enforceProjectLock("get_all_tasks", project_id);
      // ★all_projects 는 Firestore 룰상 불가능한 요청이다(티켓 4ov5wbQZ25XUXHZVhxdh):
      // tasks read 룰이 isProjectMember(resource.data.projectId) 라, projectId 를
      // 고정하지 않은 list 는 언제나 거부된다. 예전엔 그 거부가
      // "Missing or insufficient permissions" 로만 보여서 권한/멤버십 문제로
      // 오인됐다. 조용히 빈 결과를 주지 않고 왜 불가능한지 말한다.
      if (all_projects) {
        return text(
          "Error: all_projects=true 는 지원되지 않습니다 — Firestore 보안 룰이 " +
            "projectId 를 고정하지 않은 tasks 쿼리를 거부합니다(교차 테넌트 차단).\n" +
            "해야 할 일: 프로젝트별로 project_id 를 지정해 각각 조회하세요.",
        );
      }
      const contextId = contextReadFilter(!!all_contexts);
      const filterContextInMemory = contextId === "board";
      const constraints: QueryConstraint[] = [];
      if (contextId && !filterContextInMemory)
        constraints.push(where("contextId", "==", contextId));
      if (role) constraints.push(where("role", "==", role));

      // P2-5 bounded the read with `orderBy(priority) + limit`, but bounding by
      // priority while the display rule is "open first" drops open tasks out of
      // the *window*, not just out of the ordering: with 613 DONE vs 68 open on
      // this board the priority window was all DONE and freshly created tickets
      // never appeared at any limit (the collection is bigger than the 500 cap).
      //
      // So make openness a query predicate: page the (small, bounded) set of open
      // tasks first, then spend whatever row budget is left on a completed tail.
      // Both reads stay bounded, and boundedGetDocs still degrades to an
      // unbounded read if a composite index is missing rather than hard-failing.
      const rowLimit = limit ?? LIST_LIMIT_DEFAULT;
      const readDocs = async (
        extra: QueryConstraint[],
        bound: QueryConstraint[],
        label: string,
      ): Promise<TaskDoc[]> => {
        const snap = await boundedGetDocs(
          "tasks",
          projectId,
          [...constraints, ...extra],
          bound,
          label,
        );
        return snap.docs
          .map((d) => ({ id: d.id, ...d.data() }) as TaskDoc)
          .filter((t) => !t.deleted)
          .filter(
            (t) => !filterContextInMemory || isTaskInReadContext(t, contextId),
          );
      };

      // Bound the open page by the size of the open SET, not by the caller's
      // rowLimit. Firestore applies `limit` before the in-memory soft-delete /
      // context filters below, so bounding by rowLimit spent the row budget on
      // rows that were then discarded — open tickets vanished and the gap was
      // backfilled with DONE (ticket SsHpTM43EqqPTM1ZWQVA: 57 open, limit 50,
      // 37 rendered). Reading the whole open set also makes the priority sort
      // meaningful; an arbitrary page of 50 was never "the top 50".
      const openDocs = await readDocs(
        [where("status", "in", [...OPEN_TASK_STATUSES])],
        [fsLimit(OPEN_FETCH_CAP)],
        "get_all_tasks:open",
      );
      // Only pay for the completed tail when there is room to render it. This
      // query is intentionally NOT status-filtered so it reuses the existing
      // (projectId, …, priority DESC) indexes; summarizeListing drops the open
      // rows it re-reads.
      const tailRoom = Math.max(0, rowLimit - openDocs.length);
      const terminalDocs = tailRoom
        ? await readDocs(
            [],
            [orderBy("priority", "desc"), fsLimit(rowLimit)],
            "get_all_tasks:done",
          )
        : [];

      const listing = summarizeListing(openDocs, terminalDocs, rowLimit);
      const docs = listing.rows;
      if (docs.length === 0) return text("No tasks found.");
      const lines = docs.map((t) => {
        const claimed = t.claimedBy ? ` → ${t.claimedBy}` : "";
        const proj = all_projects ? ` project=${t.projectId || "(none)"}` : "";
        const ctx = all_contexts ? ` ctx=${t.contextId || "(none)"}` : "";
        return `- [${t.status}] ${truncTitle(t.title)} (role=${t.role}, id=${
          t.id
        }${proj}${ctx})${claimed}`;
      });
      // 워크체인 푸터 — 오케가 보드를 읽는 바로 이 자리가 "다음 할 일" 을 다시
      // 보는 가장 자연스러운 지점이다. 이미 읽은 티켓은 재조회하지 않고, 부기가
      // 실패해도 목록은 그대로 돌려준다(fail-open).
      let chainFooter = "";
      try {
        const known = new Map<string, { status: string; title?: string }>();
        for (const t of [...openDocs, ...terminalDocs]) {
          known.set(t.id, { status: t.status, title: t.title });
        }
        const chain = await loadWorkChain(db, projectId, known);
        chainFooter = workChainFooter(chain.derived);
      } catch (err) {
        console.error("[get_all_tasks] work chain footer skipped:", err);
      }
      // State the open-row count explicitly. A truncated board and a short
      // board used to render identically, so the orchestrator read a partial
      // list as the whole board — that silence is what hid this bug.
      return text(
        capLines(
          lines,
          rowLimit,
          listing.openHidden > 0
            ? `${listing.openHidden} of ${listing.openTotal} OPEN tasks are hidden by limit=${rowLimit} — raise limit or filter by role to see them all`
            : `${listing.openTotal} open tasks shown in full; the rest are completed`,
        ) + (chainFooter ? `\n${chainFooter}` : ""),
      );
    },
    { userFacing: false },
  );

  // 2. get_available_tasks
  auditedTool(
    "get_available_tasks",
    "Get TODO tasks available for the given role. Returns tasks whose dependencies are satisfied.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max rows (default 50)"),
    },
    async ({ role, project_id, limit }) => {
      const projectId = await enforceProjectLock(
        "get_available_tasks",
        project_id,
      );
      // Context scope — mirror get_all_tasks so the board orchestrator's
      // dispatch feed only surfaces its own context. Only the board orch sets
      // MARBLO_CONTEXT="board" (orchestrator-manager → contextForKind), so it
      // alone becomes scoped to board tasks; plain worker agents and the
      // mission orchestrator leave it unset → unscoped (zero behavior change).
      // Without this, mission(contextId=missionId)/lane(contextId=lane:*) TODOs
      // leaked into the board orchestrator's awareness and got dispatched/
      // discussed there — the surviving PTY-contamination path after P3.
      const contextId = resolveContext();
      // The board context must also surface legacy/externally-created TODOs that
      // were stored without a contextId. Firestore can't OR "contextId=='board'"
      // with "contextId unset" in a single `==`, so for board we drop the
      // Firestore context filter and match on the effective (backfilled)
      // contextId in memory below. Non-board contexts (lane:* / mission) always
      // carry an explicit contextId on write, so they keep the strict Firestore
      // `==` and never leak into the board feed.
      const filterContextInMemory = contextId === "board";
      const constraints: QueryConstraint[] = [
        where("status", "==", "TODO"),
        where("role", "==", role),
        // P2-5: push the dependency-readiness filter into the query so bounding
        // by priority can't crowd ready tasks out of the window with
        // higher-priority-but-blocked tasks. This mirrors the in-memory
        // `.filter(t => t.dependsOnCompleted)` below exactly (missing field →
        // falsy → excluded on both sides).
        where("dependsOnCompleted", "==", true),
      ];
      if (contextId && !filterContextInMemory)
        constraints.push(where("contextId", "==", contextId));

      // P2-5: bound the read to the display limit, ordered by priority desc (the
      // exact in-memory sort key). In-memory filters (deleted/claimedBy/context)
      // and the sort below still run over the fetched window unchanged.
      const rowLimit = limit ?? LIST_LIMIT_DEFAULT;
      const snap = await boundedGetDocs(
        "tasks",
        projectId,
        constraints,
        [orderBy("priority", "desc"), fsLimit(rowLimit)],
        "get_available_tasks",
      );

      const tasks = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }) as TaskDoc)
        .filter((t) => !t.deleted)
        .filter(
          (t) => !filterContextInMemory || isTaskInReadContext(t, contextId),
        )
        // Double-dispatch guard: drop tasks already bound to an agent. The
        // `status == "TODO"` Firestore filter alone is racy — bindTaskToDispatchedAgent
        // sets claimedBy and advances TODO→CLAIMED via applyProjection, but if that
        // projection write aborts (TOCTOU) it falls back to a raw updateDoc that sets
        // claimedBy while leaving status TODO. Such a task is bound yet still matches
        // status==TODO, so without this guard it would leak back into the dispatch feed
        // and get double-dispatched. Filter in memory (not a Firestore where) to also
        // catch legacy tasks whose claimedBy field is missing — `== null` would skip
        // those, but a falsy check covers both null and undefined.
        .filter((t) => !t.claimedBy)
        .filter((t) => t.dependsOnCompleted)
        // normalizePriority, not `b.priority - a.priority`: a few legacy docs
        // store priority as a label string ("high"), and a comparator that
        // returns NaN leaves the surrounding run in an unspecified order.
        .sort(compareTasksForListing);

      if (tasks.length === 0)
        return text(`No available tasks for role '${role}'.`);

      const lines = tasks.map((t) => {
        const deps = t.dependsOn?.length
          ? ` (depends_on: ${t.dependsOn.join(", ")})`
          : "";
        return `- [${t.id}] ${truncTitle(t.title)} (priority=${
          t.priority
        })${deps}`;
      });
      return text(capLines(lines, rowLimit, "raise limit to see more"));
    },
    { userFacing: false },
  );

  // 3. create_task
  auditedTool(
    "create_task",
    "Create a task. Use STRUCTURED fields: goal (1-2 sentences), changes[] (bullets), acceptance[] (verifiable done-criteria), notes[] (optional). Put file paths in scope, not prose. role: backend/frontend/test/devops.",
    {
      title: z.string().describe("Task title (한 줄)"),
      goal: z
        .string()
        .optional()
        .describe("목표: 무엇을/왜 1-2문장. 핵심. 파일 경로 금지(→scope)."),
      changes: z
        .array(z.string())
        .optional()
        .describe(
          "변경·접근: 추가/수정할 함수·동작을 짧은 불릿으로. 줄글/중복 금지.",
        ),
      acceptance: z
        .array(z.string())
        .optional()
        .describe(
          "완료 기준: 검증 가능한 체크 항목(예: 'tests/unit/foo.test.ts 통과').",
        ),
      notes: z
        .array(z.string())
        .optional()
        .describe("제약·주의(선택): 롤백/재사용 규칙 등."),
      description: z
        .string()
        .optional()
        .describe("[legacy] 자유서술. 구조화 필드(goal 등)를 쓰면 생략."),
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      priority: z
        .number()
        .optional()
        .describe("Priority 1-5 (higher = more urgent)"),
      depends_on: z
        .array(z.string())
        .optional()
        .describe("Task IDs this depends on"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      context: z.string().optional().describe("Environment constraints"),
      scope: z.array(z.string()).optional().describe("File paths to modify"),
      ...missionLabelParamShape,
    },
    async ({
      title,
      goal,
      changes,
      acceptance,
      notes,
      description,
      role,
      priority,
      depends_on,
      project_id,
      context,
      scope,
      mission_label,
      mission_goal,
    }) => {
      // W7: honor an explicit project_id (valid id or resolvable name) instead
      // of silently filing under the bound project → no more ghost tasks.
      const resolvedProject = await resolveProjectForCreate(project_id);
      const projectId = resolvedProject.projectId;
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.\n" +
            "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.",
        );
      }

      // P3-13: reject an out-of-domain role/priority before the write. A typo'd
      // role produces a task no agent ever claims (stranded in TODO forever);
      // an out-of-range priority skews the dispatch sort.
      if (!isTaskRole(role)) {
        return text(
          `Error: Invalid role "${role}". Valid roles: ${TASK_ROLE_VALUES.join(
            ", ",
          )}. A task with an unrecognized role is never dispatched (no agent claims it).`,
        );
      }
      if (priority !== undefined && !isValidPriority(priority)) {
        return text(
          `Error: Invalid priority ${priority}. Use an integer ${TASK_PRIORITY_MIN}-${TASK_PRIORITY_MAX} (higher = more urgent), or omit for unprioritized.`,
        );
      }

      const bodyInput = { goal, changes, acceptance, notes, description };
      const { error, warning } = validateTaskBodyInput(bodyInput);
      if (error) return text(`Error: ${error}`);

      const now = Timestamp.now();
      const deps = depends_on ?? [];

      // Pre-generate the doc id so we can seed projection.currentStatus in the
      // SAME write — the board's projection view then shows the task instantly
      // (W7: no create→visible lag).
      const ref = doc(collection(db, "tasks"));
      const data: Record<string, unknown> = {
        title,
        ...taskBodyStorageFields(bodyInput),
        role,
        priority: priority ?? 0,
        status: "TODO",
        dependsOn: deps,
        // 선행의 **현재** status 로 시드한다. `deps.length === 0` 로만 시드하면
        // 이미 DONE 인 task 를 의존으로 걸었을 때 flip 을 촉발할 DONE 전이가
        // 영영 없어 플래그가 false 로 고착 → dispatch/claim 영구 차단(P0).
        dependsOnCompleted: await areDependenciesComplete(db, deps),
        claimedBy: null,
        claimedAt: null,
        scope: scope ?? [],
        comment: context ?? "",
        prUrl: "",
        hasPmFeedback: false,
        createdAt: now,
        updatedAt: now,
        projectId,
        contextId: resolveContextForWrite(),
        projection: seedProjectionForCreate(ref.id, now),
      };
      const missionContextError = applyMissionContextTags(data);
      if (missionContextError) return text(`Error: ${missionContextError}`);

      // ★Mission Replay 라벨 — 라벨이 있으면 이 티켓의 contextId 를 암묵적
      // 미션으로 돌려놓는다. 라벨이 없으면 위에서 정한 contextId 그대로(무변경).
      const implicit = await resolveImplicitMissionForWrite(
        projectId,
        mission_label,
        mission_goal,
      );
      if (implicit.missionId) {
        data.contextId = implicit.missionId;
        data.missionId = implicit.missionId;
      }

      await setDoc(ref, data);
      if (implicit.missionId) {
        await appendImplicitMissionTaskIds(implicit.missionId, [ref.id]);
      }
      const notes2 = [
        warning,
        resolvedProject.warning,
        implicit.note || undefined,
      ].filter(Boolean);
      // ★사장님이 방금 준 지시가 이 티켓이면 체인에 남긴다(행동=증거).
      const ownerNote = await captureOwnerMissionNote(
        projectId,
        "create_task",
        [
          {
            id: ref.id,
            title,
            ...(mission_label ? { missionLabel: mission_label } : {}),
          },
        ],
      );
      return text(
        withCaptureNote(
          `Task created successfully!\nID: ${
            ref.id
          }\nTitle: ${title}\nRole: ${role}\nPriority: ${
            priority ?? 0
          }\nProject: ${projectId}` +
            (notes2.length ? `\n⚠️ ${notes2.join("\n⚠️ ")}` : ""),
          ownerNote,
        ),
      );
    },
  );

  // 4. create_tasks_bulk
  auditedTool(
    "create_tasks_bulk",
    "Create multiple tasks at once. Pass tasks_json (JSON string) or tasks (array). Each item: title, goal, changes[], acceptance[], notes?, role, priority?, depends_on?, context?, scope?, alias?. Use structured fields (goal/changes/acceptance), not a single description blob. " +
      'TYPES — changes/acceptance/notes/depends_on/scope MUST be arrays of strings, never a bare string: use ["한 줄"], not "한 줄". ' +
      `priority is an INTEGER ${TASK_PRIORITY_MIN}-${TASK_PRIORITY_MAX} (higher = more urgent), not a label — "P0"/"high" are rejected; P0-style urgency maps to ${TASK_PRIORITY_MAX}. Omit for unprioritized. ` +
      "role is one of backend/frontend/test/devops. depends_on supports TASK-NNN (1-based index), alias, or UUID. " +
      "A malformed item fails on its own and the rest of the batch still gets created.",
    {
      tasks_json: z
        .string()
        .optional()
        .describe("JSON array of task objects (string)"),
      tasks: z
        .union([z.array(z.record(z.unknown())), z.string()])
        .optional()
        .describe(
          "Array of task objects, or a JSON array string when clients serialize array params",
        ),
      ...missionLabelParamShape,
    },
    async ({ tasks_json, tasks, mission_label, mission_goal }) => {
      const normalized = normalizeBulkTasksPayload({ tasks_json, tasks });
      if (normalized.error) return text(normalized.error);
      const taskList = normalized.tasks ?? [];

      const project = DEFAULT_PROJECT;
      if (!project) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or include project_id in each task.\n" +
            "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.",
        );
      }

      // W7: pre-resolve any distinct per-task project_id overrides once (validity
      // + existence checked). A valid, existing project id is honored so a bulk
      // create can target another project; an invalid/unknown one falls back to
      // the bound project (never a ghost). Cache keyed by raw arg to avoid
      // re-reading Firestore per task.
      const projectCache = new Map<string, string>();
      const resolveTaskProject = async (raw: unknown): Promise<string> => {
        const key = typeof raw === "string" ? raw.trim() : "";
        if (!key || !looksLikeFirestoreId(key)) return project;
        if (key === project) return project;
        const cached = projectCache.get(key);
        if (cached) return cached;
        const resolved = (await resolveProjectForCreate(key)).projectId;
        projectCache.set(key, resolved);
        return resolved;
      };

      // Phase 1: Build alias map (symbolic name → array index)
      const aliasMap: Record<string, number> = {};
      for (let i = 0; i < taskList.length; i++) {
        aliasMap[`TASK-${String(i + 1).padStart(3, "0")}`.toUpperCase()] = i;
        const alias = taskList[i].alias as string | undefined;
        if (alias) aliasMap[alias] = i;
      }

      // Phase 2: Sequential creation with dependency resolution
      const indexToId: Record<number, string> = {};
      const results: string[] = [];
      let successCount = 0;
      // ★Mission Replay 라벨 — projectId → 해석된 암묵적 missionId(캐시),
      // missionId → 이 배치에서 실제로 만들어진 taskId 들(보조 인덱스 갱신용).
      const implicitByProject = new Map<string, string | null>();
      const implicitTaskIds = new Map<string, string[]>();
      const implicitNotes: string[] = [];
      // ★사장님 미션 포착용 — projectId → 이 호출에서 실제로 생긴 티켓들.
      const createdByProject = new Map<string, CreatedTaskFact[]>();

      const indexedTasks = taskList.map((task, index) => ({ task, index }));
      for (const chunk of chunkBulkTasks(indexedTasks)) {
        for (const { task: t, index: i } of chunk) {
          let resolvedDeps: string[] | null = null;
          let depError: string | null = null;
          // 티켓 20GMXojE9iHf5giBckOR: depends_on 은 무검증 캐스팅이라 문자열이
          // 오면 아래 for..of 가 글자 단위로 순회해 쓰레기 dep id 를 만든다.
          // 조용히 잘못된 의존성을 심느니 그 항목만 명시적으로 실패시킨다.
          if (
            t.depends_on !== undefined &&
            t.depends_on !== null &&
            !Array.isArray(t.depends_on)
          ) {
            results.push(
              `  [FAILED] ${
                (t.title as string) || `task #${i}`
              } — depends_on 은 문자열 배열이어야 합니다 (받은 값: ${typeof t.depends_on}). 예: "depends_on": ["TASK-001"]`,
            );
            continue;
          }
          const rawDeps = t.depends_on as string[] | undefined;

          if (rawDeps && rawDeps.length > 0) {
            resolvedDeps = [];
            for (const depRef of rawDeps) {
              if (UUID_RE.test(depRef)) {
                resolvedDeps.push(depRef);
                continue;
              }

              const taskMatch = TASK_NNN_RE.exec(depRef);
              if (taskMatch) {
                const idx = parseInt(taskMatch[1], 10) - 1;
                if (idx in indexToId) {
                  resolvedDeps.push(indexToId[idx]);
                  continue;
                }
                depError =
                  idx >= i
                    ? `depends_on '${depRef}' references a task not yet created (forward reference)`
                    : `depends_on '${depRef}' — task at index ${idx} failed or out of range`;
                break;
              }

              if (depRef in aliasMap) {
                const idx = aliasMap[depRef];
                if (idx in indexToId) {
                  resolvedDeps.push(indexToId[idx]);
                  continue;
                }
                depError =
                  idx >= i
                    ? `depends_on alias '${depRef}' references a task not yet created`
                    : `depends_on alias '${depRef}' — referenced task failed`;
                break;
              }

              depError = `depends_on '${depRef}' is not a valid UUID, TASK-NNN, or known alias`;
              break;
            }
          }

          if (depError) {
            results.push(
              `  [FAILED] ${(t.title as string) || `task #${i}`} — ${depError}`,
            );
            continue;
          }

          // P3-13: validate an EXPLICIT role/priority per item (a missing role
          // still defaults to "backend" below — unchanged). Reject typo'd roles
          // (would strand the task in TODO) and out-of-range priorities, failing
          // just that item like a depError rather than the whole batch.
          const roleRaw = t.role;
          if (
            roleRaw !== undefined &&
            roleRaw !== null &&
            roleRaw !== "" &&
            !isTaskRole(String(roleRaw))
          ) {
            results.push(
              `  [FAILED] ${
                (t.title as string) || `task #${i}`
              } — invalid role '${String(
                roleRaw,
              )}' (valid: ${TASK_ROLE_VALUES.join(", ")})`,
            );
            continue;
          }
          const prioRaw = t.priority;
          if (
            prioRaw !== undefined &&
            prioRaw !== null &&
            !isValidPriority(Number(prioRaw))
          ) {
            results.push(
              `  [FAILED] ${
                (t.title as string) || `task #${i}`
              } — invalid priority '${String(
                prioRaw,
              )}' (use integer ${TASK_PRIORITY_MIN}-${TASK_PRIORITY_MAX})`,
            );
            continue;
          }

          // 티켓 20GMXojE9iHf5giBckOR: changes/acceptance/notes 는 아래에서
          // `as string[]` 로 무검증 캐스팅돼 taskBodyStorageFields 로 넘어간다.
          // 호출자가 문자열을 주면 예전엔 nonEmpty() 안에서 TypeError 가 나
          // 배치 전체가 죽었다 — role/priority 와 같은 자리에서 걸러, 잘못된
          // 항목만 실패시키고 나머지는 계속 생성한다.
          const sectionError = validateTaskBodySections({
            changes: t.changes as string[] | undefined,
            acceptance: t.acceptance as string[] | undefined,
            notes: t.notes as string[] | undefined,
          });
          if (sectionError) {
            results.push(
              `  [FAILED] ${
                (t.title as string) || `task #${i}`
              } — ${sectionError}`,
            );
            continue;
          }

          const now = Timestamp.now();
          const deps = resolvedDeps ?? [];
          const data: Record<string, unknown> = {
            title: (t.title as string) || "",
            ...taskBodyStorageFields({
              goal: t.goal as string | undefined,
              changes: t.changes as string[] | undefined,
              acceptance: t.acceptance as string[] | undefined,
              notes: t.notes as string[] | undefined,
              description: t.description as string | undefined,
            }),
            role: (t.role as string) || "backend",
            priority: (t.priority as number) ?? 0,
            status: "TODO",
            dependsOn: deps,
            // create_task 와 동일 이유 — 이미 DONE 인 선행을 건 경우의 플래그
            // 고착 방지. 같은 배치 안의 forward reference 는 아직 TODO 이므로
            // 자연히 false 로 시드되고, 그 선행이 DONE 될 때 정상 flip 된다.
            dependsOnCompleted: await areDependenciesComplete(db, deps),
            claimedBy: null,
            claimedAt: null,
            scope: (t.scope as string[]) || [],
            comment: (t.context as string) || "",
            prUrl: "",
            hasPmFeedback: false,
            createdAt: now,
            updatedAt: now,
          };
          // W7: honor a valid per-task project_id override (existing project),
          // else fall back to the bound project — never a ghost id.
          data.projectId = await resolveTaskProject(t.project_id);
          data.contextId = resolveContextForWrite();
          const missionContextError = applyMissionContextTags(data);
          if (missionContextError) {
            results.push(
              `  [FAILED] ${
                (t.title as string) || `task #${i}`
              } — ${missionContextError}`,
            );
            continue;
          }

          // ★Mission Replay 라벨 — 배치 전체를 하나의 암묵적 미션으로 묶는다.
          // 항목별 project_id 오버라이드가 가능하므로 프로젝트 단위로 해석하고
          // 같은 호출 안에서는 캐시한다(같은 라벨로 미션이 여럿 생기지 않게).
          const itemProjectId = String(data.projectId ?? "");
          if (mission_label && itemProjectId) {
            if (!implicitByProject.has(itemProjectId)) {
              const resolved = await resolveImplicitMissionForWrite(
                itemProjectId,
                mission_label,
                mission_goal,
              );
              implicitByProject.set(itemProjectId, resolved.missionId);
              if (resolved.note) implicitNotes.push(resolved.note);
            }
            const missionId = implicitByProject.get(itemProjectId) ?? null;
            if (missionId) {
              data.contextId = missionId;
              data.missionId = missionId;
            }
          }

          try {
            // Pre-generate id + seed projection so the board shows it instantly.
            const ref = doc(collection(db, "tasks"));
            data.projection = seedProjectionForCreate(ref.id, now);
            await setDoc(ref, data);
            indexToId[i] = ref.id;
            // ★사장님 미션 포착의 행동 증거 — 어느 프로젝트에 무엇이 생겼나.
            // 항목별 project_id 오버라이드가 가능하므로 프로젝트별로 모은다.
            const createdBucket = createdByProject.get(itemProjectId) ?? [];
            createdBucket.push({
              id: ref.id,
              title: String(data.title ?? ""),
              ...(mission_label ? { missionLabel: mission_label } : {}),
            });
            createdByProject.set(itemProjectId, createdBucket);
            const joinedMissionId = data.missionId;
            if (typeof joinedMissionId === "string" && joinedMissionId) {
              const bucket = implicitTaskIds.get(joinedMissionId) ?? [];
              bucket.push(ref.id);
              implicitTaskIds.set(joinedMissionId, bucket);
            }
            results.push(
              `  [${ref.id}] ${data.title} (role=${data.role}, priority=${data.priority})`,
            );
            successCount++;
          } catch (e: unknown) {
            results.push(
              `  [FAILED] ${(t.title as string) || `task #${i}`} — ${
                (e as Error).message
              }`,
            );
          }
        }
      }

      for (const [missionId, ids] of implicitTaskIds.entries()) {
        await appendImplicitMissionTaskIds(missionId, ids);
      }

      const depMappings: string[] = [];
      for (const [label, idx] of Object.entries(aliasMap)) {
        if (idx in indexToId)
          depMappings.push(`    ${label} -> ${indexToId[idx]}`);
      }

      let output = `Created ${successCount}/${
        taskList.length
      } tasks:\n${results.join("\n")}`;
      if (depMappings.length > 0)
        output += `\n\nDependency ID mappings:\n${depMappings.join("\n")}`;
      if (implicitNotes.length > 0) output += `\n\n${implicitNotes.join("\n")}`;
      // ★사장님이 방금 준 지시를 이 배치가 옮긴 것이면 체인에 남긴다.
      for (const [ownerProjectId, created] of createdByProject.entries()) {
        output = withCaptureNote(
          output,
          await captureOwnerMissionNote(
            ownerProjectId,
            "create_tasks_bulk",
            created,
          ),
        );
      }
      return text(output);
    },
  );

  // 5. claim_task
  auditedTool(
    "claim_task",
    "Claim a specific task by ID. The task must be in TODO status with dependencies met.",
    {
      task_id: z.string().describe("Task ID to claim"),
      agent_id: z.string().describe("ID of the agent claiming the task"),
    },
    async ({ task_id, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      if (task.status !== "TODO") {
        return text(
          "Error: Task is not available for claiming (not in TODO status).",
        );
      }

      if (task.claimedBy) {
        return text(
          `Error: Task is not available for claiming (already claimed by ${task.claimedBy}).`,
        );
      }

      // 플래그는 fast-path 캐시일 뿐 — false 면 라이브 재검사 후 판정한다
      // (edge-trigger 고착으로 영구 차단되던 P0). 라이브로 충족이면 플래그도
      // 자가치유해 get_available_tasks 쿼리 필터에도 다시 잡히게 한다.
      if (!(await isDependencyGateOpen(db, task, { heal: true }))) {
        return text("Error: Task dependencies are not yet met.");
      }

      // Status update + Firestore projection in one transaction (Layer A).
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      // 귀속은 env-first(attributionAgentId) — 모델이 지어낸 agent_id 가
      // claimedBy/lastAgentId 를 오염시키면 워치독이 워커를 못 찾는다.
      const claimAttribution = attributionAgentId(agent_id) || agent_id;
      await applyProjection(db, task_id, {
        newStatus: "CLAIMED",
        lastAgentId: claimAttribution,
        lastActivitySummary: `claimed by ${claimAttribution}`,
        extraTaskFields: {
          claimedBy: claimAttribution,
          claimedAt: Timestamp.now(),
        },
        // Re-check inside the transaction — closes the claim race the
        // outside-the-txn `task.status !== "TODO"` check above can't.
        validateFrom: (s) => s === "TODO",
        validateTask: (t) => t.claimedBy == null,
      });

      const lines = [
        `Successfully claimed task: ${task.title}`,
        `ID: ${task_id}`,
        `Status: CLAIMED`,
        `Role: ${task.role}`,
      ];
      if (task.comment) lines.push(`Context: ${task.comment}`);
      if (task.scope?.length)
        lines.push(`Scope (files): ${task.scope.join(", ")}`);
      return text(lines.join("\n"));
    },
  );

  // 6. update_task_status
  auditedTool(
    "update_task_status",
    "Update a task status. Valid: TODO, CLAIMED, IN_PROGRESS, REVIEW, BLOCKED, FAILED, DONE. State machine rules enforced. Use force=true to skip state-machine validation (e.g., marking already-completed tasks as DONE). force does NOT bypass another agent's claim — the orchestrator (or a provably-dead claim holder) is what authorizes that, and `comment` becomes the recorded reason.",
    {
      task_id: z.string().describe("Task ID"),
      status: z.string().describe("New status"),
      comment: z
        .string()
        .optional()
        .describe(
          "Comment for the status change. ★Required when overriding another agent's claim — it becomes the recorded reason.",
        ),
      force: z
        .boolean()
        .optional()
        .describe(
          "Skip state machine validation (default: false). Does NOT bypass claim ownership.",
        ),
      summary: completionSummaryShape,
    },
    async ({ task_id, status, comment, force, summary }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      // ★claim 소유권 판정은 상태값 검증 **뒤**로 옮겼다 — 감사 기록의 "대상" 줄에
      // `status CLAIMED → DONE` 을 적으려면 목표 상태가 먼저 확정돼야 한다.

      // P2-2: Validate the status VALUE against the 7-member TaskStatus domain
      // BEFORE the force branch. force=true is an escape hatch for *transition
      // rules* only — it must never let an out-of-domain string ("Done",
      // "banana", wrong case) reach applyProjection, which would write it
      // verbatim to tasks/{id} + projection.currentStatus + mission
      // statusCounts, silently corrupting the board and hiding the task from
      // every exact-match feed (get_available_tasks, watchdog scans).
      if (!isTaskStatus(status)) {
        return text(
          `Error: Invalid status "${status}". Valid values: ${TASK_STATUS_VALUES.join(
            ", ",
          )}`,
        );
      }
      const newStatus: TaskStatus = status;
      if (!force && !canTransition(task.status, newStatus)) {
        const validTargets = VALID_TRANSITIONS[task.status] ?? [];
        return text(
          `Error: Cannot transition from ${
            task.status
          } to ${newStatus}. Valid targets: ${validTargets.join(
            ", ",
          )}\nTip: Use force=true to skip validation.`,
        );
      }

      // ★claim 권한 판정 (티켓 r2rrPsblZPlUOTCWzc3Z). 예전엔 여기서
      // `getClaimOwnershipError({actorAgentId: WORKER_AGENT_ID, force})` 하나로
      // 끝났는데, 그 한 줄은 두 방향으로 다 틀려 있었다:
      //   - 오케는 WORKER_AGENT_ID 가 늘 "" 라 **자기가 만들고 배정한 티켓조차**
      //     닫지 못했다(오늘 하루 다섯 번 멈춘 원인).
      //   - 반대로 아무 워커나 force=true 한 줄로 남의 claim 을 조용히 뺏을 수
      //     있었고, 그 사실이 아무 데도 남지 않았다.
      // 이제 권한은 신원(오케)과 증거(죽은 claim)로만 나오고, 넘은 것은 아래에서
      // 같은 트랜잭션의 감사 activity 로 반드시 기록된다.
      const authority = await resolveClaimAuthority({
        task,
        actorAgentId: WORKER_AGENT_ID,
        action: `status ${task.status} → ${newStatus}`,
        reason: comment ?? "",
      });
      if (authority.error) return text(`Error: ${authority.error}`);
      const overriddenClaimBy = authority.decision.override
        ? (task.claimedBy ?? "").trim()
        : null;

      // Status update + Firestore projection in one transaction (Layer A).
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      const projMut: ApplyProjectionInput = {
        newStatus,
        // 오케가 대신 상태를 바꿔도 작업자 귀속은 직전 실제 작업자를 보존
        // ("" → applyProjection 의 `|| prev`). 부하분산 오인 방지.
        lastAgentId: WORKER_AGENT_ID,
        lastActivitySummary: comment || `status → ${newStatus}`,
        // Re-validate the transition inside the txn against the real status —
        // but force=true is the documented escape hatch, so it must skip the
        // in-txn re-check too. Leaving validateFrom undefined turns
        // applyProjection's TOCTOU guard into a no-op, mirroring the outer
        // `!force` gate above. Previously this predicate was set unconditionally,
        // so force=true cleared the outer check yet still threw inside the
        // transaction (projection.ts) — the escape hatch was effectively dead.
        validateFrom: force ? undefined : (s) => canTransition(s, newStatus),
      };
      // ★TOCTOU 가드는 override 경로에서도 유지한다 — 우리가 근거를 확인한 **그**
      // 보유자일 때만 넘는다. 판정과 커밋 사이에 다른 에이전트가 새로 claim 했다면
      // 트랜잭션이 중단된다. (예전엔 `if (!force)` 로 이 가드까지 통째로 꺼져서
      // force 한 줄이 claim 보호를 무력화했다. force 는 이제 상태머신 전이 규칙만
      // 건너뛴다 — 그건 validateFrom 쪽 얘기다.)
      projMut.validateTask = canActorMutateClaimedTask(
        WORKER_AGENT_ID,
        overriddenClaimBy,
      );
      projMut.validateTaskError = claimOwnershipErrorFromTask;
      // 상태만 바꾸는 이 경로에는 남길 activity 가 아예 없다 — 그래서 override 근거를
      // 담은 감사 activity 를 같은 트랜잭션에서 하나 만든다.
      if (authority.auditMessage && overriddenClaimBy) {
        projMut.overrideAuditPayload = {
          agentId: MARBLO_AGENT_ID,
          message: authority.auditMessage,
          overrideGrant: authority.decision.grant ?? "",
          overriddenClaimBy,
        };
      }
      if (comment) projMut.extraTaskFields = { comment };
      if (newStatus === "BLOCKED")
        projMut.blockerSummary = comment || "blocked";
      await applyProjection(db, task_id, projMut);

      // Signal agent is now free when task leaves active work state
      const doneStatuses = ["DONE", "REVIEW", "BLOCKED", "FAILED"];
      if (doneStatuses.includes(newStatus) && MARBLO_AGENT_ID) {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (bridgePort) {
          fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
          }).catch(() => {});
        }
      }

      // Auto-reap the task's isolated worktree once it's terminal (DONE) so the
      // 100+ orphaned-worktree pileup (disk waste + shared-branch lock) can't
      // recur. Best-effort + fully guarded on the bridge side: a dirty or
      // unmerged-unpushed worktree is preserved (work-loss guard), and a tree
      // still owned by a working agent is deferred. Fire just after the idle
      // signal so the reporting agent is no longer "working" when it lands.
      if (newStatus === "DONE") {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        const projectId = process.env.MARBLO_PROJECT;
        if (bridgePort && projectId) {
          fetch(`http://127.0.0.1:${bridgePort}/reap-worktree`, {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ projectId, taskId: task_id }),
          }).catch(() => {});
        }
      }

      // Notify orchestrator about status change. Lane tasks are silent on
      // progress (P4): their update_status is a board-card + Firestore-activity
      // event only — never an orch PTY wake — so the board orch isn't flooded
      // with Quick Lane churn. Only submit_for_review routes a lane to the orch
      // (the final review gate). board/mission progress is unaffected.
      // 워크체인 재열람 지점 — 이 티켓을 참조하는 체인 항목의 파생 상태가 이
      // 전이로 바뀌었으면(완료/준비) 결과와 오케 알림 양쪽에 붙인다. 부기라
      // 실패해도 "" 이고 전이는 이미 커밋됐다.
      const chainNudge = await workChainNudgeAfterTransition(
        db,
        task.projectId || DEFAULT_PROJECT,
        task_id,
        task.status,
        newStatus,
      );
      const chainNudgeSuffix = chainNudge ? `\n${chainNudge}` : "";
      if (!isLaneContextId(task.contextId)) {
        const commentNote = comment ? ` — ${comment}` : "";
        const roleLabel = formatAgentTaskRoleLabel(
          task.role,
          await fetchAgentRole(MARBLO_AGENT_ID),
        );
        notifyOrchestrator(
          `[Task Update] "${task.title}" ${task.status} → ${newStatus} (${roleLabel}, id=${task_id})${commentNote}${chainNudgeSuffix}`,
          task.contextId,
          {
            taskId: task_id,
            // 오케 행동이 필요한 전이만 durable 기록 — 진행성 전이는 브리지가
            // 어차피 억제하므로(suppressed) 기록 대상이 아니다.
            recordFailure:
              newStatus === "DONE" ||
              newStatus === "FAILED" ||
              newStatus === "BLOCKED",
          },
        );
      }

      const unblocked =
        newStatus === "DONE"
          ? await resolveDependentsAfterDone(
              task_id,
              task.contextId,
              task.projectId || DEFAULT_PROJECT,
            )
          : 0;

      const unblockedNote =
        unblocked > 0 ? ` Unblocked ${unblocked} dependent task(s).` : "";

      // ★암묵적 미션(Replay 묶음)은 소속 티켓이 전부 끝나는 순간 닫힌다.
      // 그 전이가 있어야 완료이력 탭의 Mission Replay 에 뜬다(대상 판정이
      // status === "completed" 이므로). 실패해도 위 상태 전이는 이미 커밋됨.
      const closedMission =
        newStatus === "DONE"
          ? await closeImplicitMissionIfComplete(task.contextId)
          : null;
      const replayNote = closedMission
        ? ` 이 묶음의 마지막 티켓입니다 — Mission Replay 생성됨 (missionId=${closedMission}).`
        : "";

      // ★완료가 다음을 부르게 (티켓 Sf8Id64jLeyDvWIS4cub). 미션을 닫은 완료면
      // 위 closeImplicitMissionIfComplete 가 이미 닫았고 여기선 신호가 안 나간다
      // — 종결 판정을 두 벌로 만들지 않으려고 닫는 쪽은 기존 경로에 맡긴다.
      // 중간 완료면 "지금 집을 수 있는 것 / 막힌 것 / 승인 필요한 것"을 갈라
      // 오케에 넣는다. 기본값 OFF(MISSION_ADVANCE_SIGNAL).
      const advanceNote =
        newStatus === "DONE"
          ? await signalMissionAdvanceAfterDone(task_id, task)
          : "";

      // ★그 위 계층 — 미션이 **닫혔으면** 다음 미션으로 넘어간다
      // (티켓 F2TAJlSgSP8Ag1qJNkp1). 후크는 closeImplicitMissionIfComplete 가
      // missionId 를 돌려준 사실 하나에 건다 — 종결 판정을 두 벌로 만들지 않는다.
      // 위 advanceNote 와 배타다(미션이 닫혔으면 거기선 mission-terminal 로 빠진다).
      // ★사장님 승인 없이 시작하지 않는다: 여기서 하는 일은 "여쭙기" 까지다.
      const handoffNote = closedMission
        ? await handleMissionHandoffAfterClose(closedMission, task, task_id)
        : "";

      // 완료 보고 규약 — REVIEW/DONE 으로 닫을 때만. 보고 누락은 soft nudge 로만
      // 보완 요청하고, 상태 전이는 위에서 이미 커밋됐다(절대 블록 안 함).
      // 넘었다는 사실을 호출자에게도 되돌려준다 — 조용히 통과시키면 "내 권한으로
      // 정상 처리된 것" 으로 오인하고, 근거가 기록됐다는 것도 모른다.
      const overrideNote = overriddenClaimBy
        ? ` ⚠️ ${overriddenClaimBy} 의 claim 을 넘었습니다(${authority.decision.grant}) — 사유가 감사 기록으로 남았습니다.`
        : "";

      const completionNudge =
        newStatus === "REVIEW" || newStatus === "DONE"
          ? await applyCompletionReport(task_id, newStatus, summary)
          : "";

      return text(
        `Task '${task.title}' status updated to ${newStatus}.${unblockedNote}${replayNote}${advanceNote}${handoffNote}${overrideNote}${completionNudge}${chainNudgeSuffix}`,
      );
    },
  );

  // 7. add_activity
  auditedTool(
    "add_activity",
    "Add an activity log entry to a task. Use to record work progress, decisions, or events. Also notifies the orchestrator PTY.",
    {
      task_id: z.string().describe("Task ID"),
      message: z.string().describe("Activity message"),
      agent_id: z.string().optional().describe("Agent ID"),
    },
    async ({ task_id, message, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      // Fall back to the MARBLO_AGENT_ID env var (injected by Marblo when
      // the MCP server is spawned for an agent) before "unknown". The
      // Agents tab Activity feed filters by `agentId in [our agents]`, so
      // logging "unknown" makes the activity invisible.
      const resolvedAgentId = agent_id || MARBLO_AGENT_ID;

      // ★이 게이트가 이 티켓의 나쁜 절반이었다(r2rrPsblZPlUOTCWzc3Z).
      // `update_task_status` 에는 force 탈출구가 있었는데 여기는 **없었다** —
      // 그래서 오케·정리 에이전트가 티켓을 닫을 수는 있는데 **왜 닫았는지는 못
      // 적었다**. 근거 없는 상태 변경만 남고, 다음 사람이 "이거 왜 닫혔지" 를
      // 처음부터 다시 판다. 실제로 정리 에이전트가 자기 보고의 오류를 정정하려다
      // 여기서 막혀 comment 로 우회했다.
      //
      // 이제 두 도구가 **같은** 권한 판정을 쓴다. force 파라미터는 여기에도 만들지
      // 않는다 — 자칭 플래그가 아니라 신원(오케)과 증거(죽은 claim)로만 넘고,
      // message 자체가 사유이므로 override 라도 추가 인자 없이 통과한다.
      const activityAuthority = await resolveClaimAuthority({
        task,
        actorAgentId: attributionAgentId(agent_id),
        action: "activity 기록",
        reason: message,
      });
      if (activityAuthority.error)
        return text(`Error: ${activityAuthority.error}`);
      const activityOverriddenClaimBy = activityAuthority.decision.override
        ? (task.claimedBy ?? "").trim()
        : null;

      // First real activity promotes a freshly-dispatched task CLAIMED →
      // IN_PROGRESS — dispatch only advances TODO → CLAIMED, so this is the
      // signal that the bound agent has actually started working. Only from
      // CLAIMED (validateFrom re-checks inside the txn against a concurrent
      // promotion race); IN_PROGRESS/REVIEW/etc are left untouched. Done in its
      // OWN best-effort transaction, BEFORE the activity write below, so a
      // promotion race can never drop the activity log itself.
      //
      // ★override 로 적은 기록은 승격시키지 않는다. 이 승격의 뜻은 "물고 있는
      // 에이전트가 실제로 착수했다" 인데, 오케가 죽은 claim 티켓에 코멘트를 달았을
      // 뿐인 걸 IN_PROGRESS 로 올리면 28일 멈춰 있던 티켓이 방금 살아난 것처럼
      // 보이고, 보드와 워치독이 그 거짓 신호를 그대로 믿는다.
      if (task.status === "CLAIMED" && !activityOverriddenClaimBy) {
        try {
          await applyProjection(db, task_id, {
            newStatus: "IN_PROGRESS",
            lastAgentId: attributionAgentId(agent_id),
            lastActivitySummary: message,
            validateFrom: (s) => s === "CLAIMED",
            validateTask: canActorMutateClaimedTask(
              attributionAgentId(agent_id),
              activityOverriddenClaimBy,
            ),
            validateTaskError: claimOwnershipErrorFromTask,
          });
        } catch (err) {
          // Concurrent transition already moved it out of CLAIMED — fine, the
          // activity log below still records the progress. Best-effort only.
          console.error(
            "[add_activity] CLAIMED→IN_PROGRESS promotion skipped:",
            err,
          );
        }
      }

      // Activity doc + Firestore projection (lastActivity*) in one transaction.
      // Status is advanced by the promotion block above, not here. Spec:
      // docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      // 작업자 귀속(lastAgentId)은 env-first(attributionAgentId) — 모델이
      // 지어낸 agent_id 로 귀속이 오염되면 워치독이 실 워커를 못 찾아 dead 로
      // 오판한다. 오케/unknown 은 "" 로 떨어져 직전 실제 작업자를 보존.
      // activity 로그 자체의 agentId 는 누가 남겼는지 보여주려
      // resolvedAgentId 그대로 유지한다.
      const activityMut: ApplyProjectionInput = {
        lastAgentId: attributionAgentId(agent_id),
        lastActivitySummary: message,
        activityPayload: { agentId: resolvedAgentId, message },
        validateTask: canActorMutateClaimedTask(
          attributionAgentId(agent_id),
          activityOverriddenClaimBy,
        ),
        validateTaskError: claimOwnershipErrorFromTask,
      };
      // 남의 claim 을 넘어 적었다면 그 사실을 **이 기록 자체에** 새긴다. 별도
      // 감사 문서를 또 만들면 같은 얘기가 피드에 두 번 뜬다 — 누가(agentId)·
      // 언제(createdAt)·왜(message)는 이미 이 문서에 있으므로, 기계 판독용
      // 두 필드만 얹으면 "누구의 claim 을 어떤 권한으로 넘었는지" 가 복원된다.
      if (activityOverriddenClaimBy && activityAuthority.decision.grant) {
        activityMut.activityPayload = {
          agentId: resolvedAgentId,
          message,
          overrideGrant: activityAuthority.decision.grant,
          overriddenClaimBy: activityOverriddenClaimBy,
        };
      }
      await applyProjection(db, task_id, activityMut);

      // Lane activity is silent on the orch PTY (P4) — the comment lives on the
      // board card + Firestore activity stream only. board/mission unchanged.
      if (!isLaneContextId(task.contextId)) {
        const preview =
          message.length > 300 ? `${message.slice(0, 300)}...` : message;
        const roleLabel = formatAgentTaskRoleLabel(
          task.role,
          await fetchAgentRole(resolvedAgentId),
        );
        notifyOrchestrator(
          `[Task Activity] "${task.title}" progress update (${roleLabel}, id=${task_id}, agent=${resolvedAgentId}): ${preview}`,
          task.contextId,
          {
            taskId: task_id,
            // 평범한 진행 보고는 브리지가 의도적으로 억제한다(suppressed) —
            // 기록하면 오탐 소음. [질문] 표기는 실제 전달 스위치이므로(브리지
            // 게이트 계약, notify-routing.test) 그 유실만 durable 기록한다.
            recordFailure: /\[질문\]/.test(message),
          },
        );
      }
      const activityOverrideNote = activityOverriddenClaimBy
        ? ` (⚠️ ${activityOverriddenClaimBy} 의 claim 을 넘어 기록했습니다 — ${activityAuthority.decision.grant})`
        : "";
      // ★자동 포착 — 오케가 자기 진행 메모에 적은 "다음에 ~하겠다" 를 집는다.
      const activityCapture = await captureChainPromiseNote(
        "activity",
        "add_activity",
        message,
        { projectId: task.projectId, contextTaskId: task_id },
      );
      return text(
        withCaptureNote(
          `Activity logged: ${message}${activityOverrideNote}`,
          activityCapture,
        ),
      );
    },
  );

  // 8. submit_for_review
  auditedTool(
    "submit_for_review",
    "Submit a task for review. Moves the task to REVIEW status.",
    {
      task_id: z.string().describe("Task ID"),
      pr_url: z.string().optional().describe("Pull request URL"),
      summary: completionSummaryShape,
    },
    async ({ task_id, pr_url, summary }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      // Allow submit from any pre-DONE status (auto-skip intermediate states)
      if (task.status === "DONE") {
        return text(`Task '${task.title}' is already DONE.`);
      }

      const worktreeId = `${task.projectId || DEFAULT_PROJECT}/${task_id}`;
      const reviewWorktreePath = worktreeDiskPath(worktreeId);
      const gitEvidence =
        await collectSubmitForReviewGitEvidence(reviewWorktreePath);
      const recordedPrUrl =
        typeof task.prUrl === "string" && task.prUrl ? task.prUrl : null;
      const discoveredPrUrl =
        !pr_url && !recordedPrUrl && gitEvidence.worktreeExists
          ? await findSubmitForReviewPrUrl(
              reviewWorktreePath,
              gitEvidence.branch,
            )
          : null;
      const effectivePrUrl = pr_url ?? recordedPrUrl ?? discoveredPrUrl;
      const submissionRisk = evaluateSubmitForReviewRisk({
        worktreeExists: gitEvidence.worktreeExists,
        commitsSinceBase: gitEvidence.commitsSinceBase,
        uncommittedFileCount: gitEvidence.uncommittedFileCount,
        pushedToOrigin: gitEvidence.pushedToOrigin,
        prUrl: effectivePrUrl,
      });

      // Status → REVIEW + milestone + Firestore projection in one transaction.
      // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3
      const projMut: ApplyProjectionInput = {
        newStatus: "REVIEW",
        lastAgentId: WORKER_AGENT_ID,
        lastActivitySummary: effectivePrUrl
          ? `submitted for review — ${effectivePrUrl}`
          : "submitted for review",
        appendMilestone: true,
        // submit auto-claims from any non-terminal state (incl. TODO), so the
        // guard only blocks an already-DONE task — mirrors the check above,
        // re-checked inside the txn to close the race.
        validateFrom: (s) => s !== "DONE",
      };
      const extra: Record<string, unknown> = {};
      if (effectivePrUrl && effectivePrUrl !== task.prUrl) {
        extra.prUrl = effectivePrUrl;
      }
      // Auto-claim if the task was never claimed — but never to the
      // orchestrator's shared id (WORKER_AGENT_ID is "" for orchestrator),
      // else the board shows the orch as assignee for every task it submits
      // on a worker's behalf and load-balancing reads it as overload.
      if (!task.claimedBy && WORKER_AGENT_ID) {
        extra.claimedBy = WORKER_AGENT_ID;
        extra.claimedAt = Timestamp.now();
      }
      if (Object.keys(extra).length) projMut.extraTaskFields = extra;
      await applyProjection(db, task_id, projMut);

      // Signal agent is now free
      if (MARBLO_AGENT_ID) {
        const bridgePort = process.env.MARBLO_BRIDGE_PORT;
        if (bridgePort) {
          fetch(`http://127.0.0.1:${bridgePort}/set-agent-status`, {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ agentId: MARBLO_AGENT_ID, status: "idle" }),
          }).catch(() => {});
        }
      }

      // Notify orchestrator about review submission. UNCONDITIONAL across all
      // contexts — this is the single orch wake a lane task gets (its final
      // verification gate), and board/mission always notify on review too. The
      // bridge routes lane(contextId=lane:*) and board here to the BOARD orch
      // (resolveNotifyTarget); missions go to the mission orch. Do NOT add a
      // lane gate here — that would silence the lane review gate entirely.
      const prNote = effectivePrUrl ? ` PR: ${effectivePrUrl}` : "";
      const riskNote = submissionRisk.notification
        ? `\n${submissionRisk.notification}`
        : "";
      const roleLabel = formatAgentTaskRoleLabel(
        task.role,
        await fetchAgentRole(MARBLO_AGENT_ID),
      );
      // 워크체인 재열람 지점 — doneWhen=review 항목이 이 제출로 완료됐으면 오케
      // 알림에 같이 싣는다(워커 프로세스에서 읽지만 체인 문서는 멤버 읽기라 된다).
      const chainNudge = await workChainNudgeAfterTransition(
        db,
        task.projectId || DEFAULT_PROJECT,
        task_id,
        task.status,
        "REVIEW",
      );
      const chainNudgeSuffix = chainNudge ? `\n${chainNudge}` : "";
      notifyOrchestrator(
        `[Review Submitted] "${task.title}" is ready for review (${roleLabel}, id=${task_id})${prNote}${riskNote}${chainNudgeSuffix}`,
        task.contextId,
        // 2026-09-01 유실 3건이 전부 이 알림이었다 — 전달 실패는 반드시
        // 티켓에 남긴다(재동기화 스위프의 REVIEW 축이 이를 다시 민다).
        { taskId: task_id, recordFailure: true },
      );

      // 완료 보고 규약 — summary 가 있을 때만 pr_url 을 summary.pr 로 폴백한다.
      // pr_url 만 단독으로 온 기존 호출은 보고로 치지 않는다(빈약한 PR-only 보고로
      // nudge 를 잠재우면 규약의 취지가 무너지므로). 보고 누락 시 soft nudge 만
      // 돌려주고 REVIEW 전이는 그대로 유지(절대 블록 안 함).
      const reportSummary: CompletionSummary | undefined = summary
        ? { ...summary, pr: summary.pr ?? effectivePrUrl ?? undefined }
        : undefined;
      const completionNudge = await applyCompletionReport(
        task_id,
        "REVIEW",
        reportSummary,
      );

      return text(
        `Task '${task.title}' submitted for review. Status: REVIEW${
          submissionRisk.notification ? `\n${submissionRisk.notification}` : ""
        }${completionNudge}${chainNudgeSuffix}`,
      );
    },
  );

  // 9. get_task_dependencies
  auditedTool(
    "get_task_dependencies",
    "Check dependency status for a task. Shows which dependent tasks are completed and which are pending.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      if (!task.dependsOn || task.dependsOn.length === 0) {
        return text("This task has no dependencies.");
      }

      const details: string[] = [];
      let allCompleted = true;

      for (const depId of task.dependsOn) {
        const dep = await fetchTask(depId);
        if (!dep) {
          details.push(`- [unknown] (ID: ${depId} — not found)`);
          allCompleted = false;
        } else {
          const completed = dep.status === "DONE";
          if (!completed) allCompleted = false;
          details.push(
            `- [${completed ? "done" : "pending"}] ${dep.title} (${dep.status})`,
          );
        }
      }

      return text(`All completed: ${allCompleted}\n${details.join("\n")}`);
    },
    { userFacing: false },
  );

  // 10. get_agent_skill
  auditedTool(
    "get_agent_skill",
    "Get skill/instruction file for a given agent role. Available: backend, frontend, test, devops, merge, team_leader, flutter.",
    {
      role: z.string().describe("Agent role name"),
    },
    async ({ role }) => {
      const safeRole = role.replace(/[^a-zA-Z0-9_]/g, "");
      if (!safeRole || safeRole !== role) {
        return text(
          `Error: Invalid role name '${role}'. Use alphanumeric and underscore only.`,
        );
      }

      const skillsDir = path.resolve(SKILLS_DIR);
      for (const filename of [`${safeRole}_agent.md`, `${safeRole}.md`]) {
        const filePath = path.resolve(skillsDir, filename);
        if (!filePath.startsWith(skillsDir)) continue; // path traversal guard
        if (fs.existsSync(filePath)) {
          return text(fs.readFileSync(filePath, "utf-8"));
        }
      }

      return text(`Error: No skill file found for role '${role}'.`);
    },
    { userFacing: false },
  );

  // 11. get_task_activities
  auditedTool(
    "get_task_activities",
    "Get activity log entries for a task. Set pm_only=true to see only PM feedback.",
    {
      task_id: z.string().describe("Task ID"),
      pm_only: z
        .boolean()
        .optional()
        .default(false)
        .describe("Show only PM feedback"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max entries (default 30)"),
    },
    async ({ task_id, pm_only, limit }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const constraints: QueryConstraint[] = [where("taskId", "==", task_id)];
      if (pm_only) constraints.push(where("type", "==", "pm"));

      // P2-5: push the newest-`limit` slice into the query (orderBy desc +
      // limit) so a long-lived task's entire activity log is never read into
      // memory. The in-memory sort below keeps both paths (bounded + fallback)
      // newest-first, which also makes the "older entries hidden" cap hint
      // accurate.
      const rowLimit = limit ?? 30;
      const snap = await boundedGetDocs(
        "activities",
        undefined, // taskId 로 증명되는 컬렉션 (위 fetchRecentActivityMessages 참조)
        constraints,
        [orderBy("createdAt", "desc"), fsLimit(rowLimit)],
        "get_task_activities",
      );

      if (snap.empty)
        return text(pm_only ? "No PM feedback found." : "No activities found.");

      const lines = snap.docs
        .map((d) => d.data())
        .sort(
          (a, b) =>
            (b.createdAt?.toMillis?.() ?? 0) - (a.createdAt?.toMillis?.() ?? 0),
        )
        .map((a) => {
          const ts = a.createdAt?.toDate?.()?.toISOString?.() || "unknown";
          const agent = a.agentId || "system";
          return `[${ts}] ${agent}: ${a.message}`;
        });
      return text(capLines(lines, rowLimit, "raise limit for older entries"));
    },
    { userFacing: false },
  );

  // 12. check_feedback
  auditedTool(
    "check_feedback",
    "Check for tasks that have unread PM feedback. Filter by role and optionally by project.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({ role, project_id }) => {
      const projectId = await enforceProjectLock("check_feedback", project_id);
      const q = query(
        collection(db, "tasks"),
        where(
          "projectId",
          "==",
          requireProjectScope("tasks", projectId, "check_feedback"),
        ),
        where("role", "==", role),
        where("hasPmFeedback", "==", true),
      );
      const snap = await getDocs(q);

      if (snap.empty)
        return text(`No tasks with pending PM feedback for role '${role}'.`);

      const lines = [`Tasks with PM feedback (${snap.size}):`];
      snap.docs.forEach((d) => {
        const t = d.data();
        lines.push(
          `- [${d.id}] ${t.title} (status=${t.status}, priority=${t.priority})`,
        );
      });
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 13. acknowledge_feedback
  auditedTool(
    "acknowledge_feedback",
    "Mark PM feedback as read/acknowledged for a task. Clears the feedback badge.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      await updateDoc(doc(db, "tasks", task_id), {
        hasPmFeedback: false,
        updatedAt: Timestamp.now(),
      });
      return text(
        `Feedback acknowledged for task '${task.title}'. Badge cleared.`,
      );
    },
  );

  // 15. spawn_agent — HTTP bridge to Electron AgentManager
  auditedTool(
    "spawn_agent",
    "Spawn a new agent via the Electron bridge. The agent gets its own PTY session and terminal tab. Requires MARBLO_BRIDGE_PORT env var.",
    {
      name: z.string().describe('Agent display name (e.g., "backend-auth")'),
      model: z
        .enum([
          "claude",
          "codex",
          "gpt",
          "grok",
          "antigravity",
          "local",
          "custom",
        ])
        .describe(
          "AI model to use. 'codex' and 'gpt' are the same OpenAI Codex CLI " +
            "(there is no separate 'gpt' CLI) — both spawn the `codex` binary. " +
            "Fleet: claude (Claude Code) / codex (OpenAI Codex) / grok (xAI Grok Build) / antigravity (agy).",
        ),
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      command: z
        .string()
        .optional()
        .describe("CLI command override (default: auto-detected from model)"),
      cwd: z
        .string()
        .optional()
        .describe("Working directory (default: project root)"),
      initial_prompt: z
        .string()
        .optional()
        .describe("Initial prompt to send to the agent after boot"),
      task_id: z
        .string()
        .optional()
        .describe(
          "Marblo task ID for completion reporting. When provided, the bridge appends the same completion protocol used by dispatch_task.",
        ),
    },
    async ({
      name,
      model: rawModel,
      role,
      command,
      cwd,
      initial_prompt,
      task_id,
    }) => {
      // "codex" is the user-facing name for the Codex CLI; the internal
      // ModelType is "gpt". Fold it here so the Firestore agent doc and the
      // renderer's Record<ModelType> icon maps stay consistent. (The bridge
      // also normalizes, but the doc is written from this var.)
      const model = rawModel === "codex" ? "gpt" : rawModel;
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const body = JSON.stringify({
          name,
          model,
          role,
          command,
          cwd,
          initialPrompt: initial_prompt,
          taskId: task_id,
          // Forward MARBLO_PROJECT so bridge scopes the new agent to the
          // correct window in multi-window mode.
          projectId: process.env.MARBLO_PROJECT || "",
          // Forward MARBLO_AGENT_ID so bridge can fall back to the parent
          // agent's project / owner when projectId is empty (e.g., when
          // an external Claude Code session calls Marblo MCP without a
          // project context).
          parentAgentId: process.env.MARBLO_AGENT_ID || "",
          contextId: process.env.MARBLO_CONTEXT || "",
        });

        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/spawn-agent`,
          {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body,
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          ptySessionId?: string;
          /** 실제로 스폰된 구체 모델·effort. `model`(벤더)과 별개 축. */
          spawnedModel?: string;
          error?: string;
          // Board task the bridge bound the agent to — the supplied task_id, or
          // an ad-hoc task the WorktreeCoordinator created when none was given.
          taskId?: string | null;
        };

        if (!result.success) {
          return text(
            `Error spawning agent: ${result.error || "Unknown error"}`,
          );
        }

        // Write agent document to Firestore so it appears in Agents tab.
        // Use setDoc(...,{merge:true}) with the bridge's agentId as the
        // doc id so this write is idempotent — the renderer's
        // onAgentSpawned listener also writes the same doc, both writers
        // converge on the same id without creating duplicates.
        const projectId = DEFAULT_PROJECT;
        if (projectId && result.agentId) {
          const ownerId = await resolveAgentDocumentOwnerId(projectId);
          await setDoc(
            doc(db, "agents", result.agentId),
            {
              projectId,
              ...(ownerId ? { ownerId } : {}),
              name,
              model,
              // 벤더(model)만으로는 fable5 인지 5.6-sol 인지 보드에서 구분이 안
              // 된다. 브릿지가 argv 에서 되읽은 구체 모델을 그대로 스탬프.
              // 값이 없으면(모델 핀 없는 스폰) 키 자체를 빼서 merge 가 기존
              // 스탬프를 지우지 않게 한다.
              ...(result.spawnedModel
                ? { spawnedModel: result.spawnedModel }
                : {}),
              role,
              status: "idle",
              // Link the agent to its board task — the supplied task_id, or the
              // ad-hoc worktree task the bridge auto-created (result.taskId).
              currentTaskId: result.taskId ?? task_id ?? null,
              command: agentDocumentCommand(model, command),
              skillFile: "",
              createdAt: Timestamp.now(),
            },
            { merge: true },
          );
        }

        // Bind the board task to the spawned agent so it enters the watchdog's
        // active scan (CLAIMED/IN_PROGRESS + a real agentId) IMMEDIATELY —
        // before the worker has run a single MCP call. Without this, spawn_agent
        // (unlike dispatch_task/reuse_agent, which both bind) left the task in
        // TODO with no claimedBy/lastAgentId until the worker itself called
        // claim_task/add_activity. A worker that dies on spawn (broken node/
        // claude binary → fast-fail → agent-manager status "error") never makes
        // that call, so the task stayed invisible to the watchdog (TODO is
        // filtered out; a null agentId short-circuits inspect()) and its death
        // was never detected or respawned. Binding here closes that gap: the
        // ticket is now CLAIMED with the agent id, so the watchdog sees the
        // dead/errored agent and recovers it. Mirrors dispatch_task's binding —
        // bindTaskToDispatchedAgent only advances status FROM TODO (reassign
        // guard) and is best-effort (non-fatal on write failure).
        const boundTaskId = result.taskId ?? task_id;
        if (result.agentId && boundTaskId) {
          try {
            await bindTaskToDispatchedAgent(boundTaskId, result.agentId);
          } catch (err) {
            console.error("[spawn_agent] Failed to bind task claimedBy:", err);
          }
        }

        return text(
          `Agent spawned successfully!\n` +
            `  Name: ${name}\n` +
            `  Model: ${model}\n` +
            `  Role: ${role}\n` +
            `  Agent ID: ${result.agentId}\n` +
            `  PTY Session: ${result.ptySessionId}`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // 14. search_tasks (bonus)
  auditedTool(
    "search_tasks",
    "Search tasks by keyword in title or description. Optionally filter by project.",
    {
      keyword: z.string().describe("Search keyword"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max rows (default 50)"),
    },
    async ({ keyword, project_id, limit }) => {
      const projectId = await enforceProjectLock("search_tasks", project_id);
      const constraints: QueryConstraint[] = [];

      // P2-5: bound the scan to the newest SEARCH_SCAN_CAP tasks (orderBy
      // createdAt desc + limit) instead of the entire collection. Substring
      // matching stays in memory over this window; matches in tasks older than
      // the window are not returned (documented scaling tradeoff). Falls back to
      // an unbounded read if the composite index is missing.
      const scanLimit = Math.max(limit ?? LIST_LIMIT_DEFAULT, SEARCH_SCAN_CAP);
      const snap = await boundedGetDocs(
        "tasks",
        projectId,
        constraints,
        [orderBy("createdAt", "desc"), fsLimit(scanLimit)],
        "search_tasks",
      );

      const lowerKeyword = keyword.toLowerCase();
      const matches = snap.docs.filter((d) => {
        const t = d.data() as TaskDoc;
        if (t.deleted) return false;
        // 구조화 본문도 검색 대상에 포함 — description 이 "" 인 태스크가 키워드
        // 검색에서 누락되던 문제를 막는다.
        const body = composeTaskBody(t).toLowerCase();
        return (
          t.title?.toLowerCase().includes(lowerKeyword) ||
          body.includes(lowerKeyword)
        );
      });

      if (matches.length === 0)
        return text(`No tasks found matching '${keyword}'.`);

      const taskLines = matches.map((d) => {
        const t = d.data();
        return `- [${t.status}] ${truncTitle(t.title)} (role=${t.role}, id=${
          d.id
        })`;
      });
      const body = capLines(
        taskLines,
        limit ?? LIST_LIMIT_DEFAULT,
        "narrow the keyword or raise limit",
      );
      return text(
        `Found ${matches.length} task(s) matching '${keyword}':\n${body}`,
      );
    },
    { userFacing: false },
  );

  // 16. get_task — Get single task detail (including description)
  auditedTool(
    "get_task",
    "Get full details of a single task by ID, including description, scope, dependencies, and comments.",
    {
      task_id: z.string().describe("Task ID"),
    },
    async ({ task_id }) => {
      const task = await fetchTask(task_id);
      if (!task) {
        const agentHint = await fetchAgentIdHint(task_id);
        if (agentHint) {
          return text(formatAgentIdAsTaskIdError(task_id, agentHint));
        }
        return text(`Error: Task ${task_id} not found.`);
      }

      // 구조화 필드(goal/changes/acceptance/notes)로 만든 태스크는 description 이
      // "" 로 저장된다 — 그대로 노출하면 에이전트가 "설명 비어있음"으로 읽으므로,
      // 구조화 본문을 렌더해 채운다. legacy description-only 태스크는 그대로 통과.
      const body = composeTaskBody(task);
      const lines = [
        `ID: ${task.id}`,
        `Title: ${task.title}`,
        `Status: ${task.status}${task.deleted ? " (deleted)" : ""}`,
        `Role: ${task.role}`,
        `Priority: ${task.priority}`,
        `Description: ${body || "(empty)"}`,
        `Claimed by: ${task.claimedBy || "(none)"}`,
        `Depends on: ${
          task.dependsOn?.length ? task.dependsOn.join(", ") : "(none)"
        }`,
        // 게이트와 **같은 판정기**로 표시한다. 저장 플래그를 그대로 찍으면
        // get_task_dependencies(라이브 판정) 와 답이 갈려 진단이 꼬인다.
        `Dependencies met: ${await isDependencyGateOpen(db, task)}`,
        `Scope: ${task.scope?.length ? task.scope.join(", ") : "(none)"}`,
        `Comment: ${task.comment || "(none)"}`,
        `PR URL: ${task.prUrl || "(none)"}`,
        `Has PM feedback: ${task.hasPmFeedback}`,
      ];
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 16a. delete_task — soft (default) / hard delete with ownership + confirm
  // safety guards. soft sets a `deleted` flag (recoverable, hidden from lists);
  // hard removes the Firestore doc. Guards (see task-delete.ts): confirm=true
  // required, another agent's in-flight claim is protected, and unfinished
  // dependents block the delete — each overridable with force=true.
  auditedTool(
    "delete_task",
    "Delete a task. mode='soft' (default) hides it recoverably; mode='hard' permanently removes it. Requires confirm=true. Refuses to delete a task actively claimed by another agent or one with unfinished dependents unless force=true.",
    {
      task_id: z.string().describe("Task ID"),
      mode: z
        .enum(["soft", "hard"])
        .optional()
        .describe("soft (hide, recoverable; default) or hard (permanent)"),
      confirm: z
        .boolean()
        .optional()
        .describe("Must be true to actually delete (mis-deletion guard)"),
      force: z
        .boolean()
        .optional()
        .describe("Override ownership/dependent guards (default: false)"),
      reason: z.string().optional().describe("Why the task is being deleted"),
    },
    async ({ task_id, mode, confirm, force, reason }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const delMode: DeleteMode = mode ?? "soft";

      // Count unfinished tasks that depend on this one (would be stranded).
      let dependentCount = 0;
      try {
        const depQ = query(
          collection(db, "tasks"),
          where(
            "projectId",
            "==",
            requireProjectScope(
              "tasks",
              task.projectId || DEFAULT_PROJECT,
              "delete_task:dependents",
            ),
          ),
          where("dependsOn", "array-contains", task_id),
        );
        const depSnap = await getDocs(depQ);
        dependentCount = depSnap.docs.filter((d) => {
          const dep = d.data() as TaskDoc;
          return !dep.deleted && !isTerminalTaskStatus(dep.status);
        }).length;
      } catch (err) {
        console.error("[MCP] delete_task dependent query error:", err);
      }

      const { error } = evaluateDeleteGuards({
        task: {
          id: task.id,
          title: task.title,
          status: task.status,
          claimedBy: task.claimedBy,
          deleted: task.deleted,
        },
        mode: delMode,
        confirm: confirm ?? false,
        requesterAgentId: MARBLO_AGENT_ID,
        dependentCount,
        force,
      });
      if (error) return text(`Error: ${error}`);

      if (delMode === "hard") {
        await deleteDoc(doc(db, "tasks", task_id));
      } else {
        await updateDoc(doc(db, "tasks", task_id), {
          deleted: true,
          deletedAt: Timestamp.now(),
          deletedBy: MARBLO_AGENT_ID || "unknown",
          deleteReason: reason ?? "",
          updatedAt: Timestamp.now(),
        });
      }

      if (!isLaneContextId(task.contextId)) {
        const reasonNote = reason ? ` — ${reason}` : "";
        notifyOrchestrator(
          `[Task Deleted] "${task.title}" ${delMode}-deleted (id=${task_id})${reasonNote}`,
          task.contextId,
          // hard 삭제면 activities 기록 대상 문서가 사라질 수 있어 콘솔만 남는다
          // — soft 삭제는 durable 기록이 유효하다.
          { taskId: task_id, recordFailure: delMode !== "hard" },
        );
      }

      return text(
        `Task '${task.title}' ${
          delMode === "hard"
            ? "permanently deleted"
            : "soft-deleted (recoverable)"
        }.`,
      );
    },
    { userFacing: false },
  );

  // 16b. get_projection — Layer A read path. Lets the orchestrator answer
  // "what's happening now?" with a single read instead of waking an LLM.
  // Spec: docs/specs/2026-05-28-orch-live-awareness-design.md §13.3, §7
  auditedTool(
    "get_projection",
    "Get the live projection snapshot for a task (current status, last agent/activity, milestones passed, blocker) and/or a mission (per-status task counts). Read-only; reflects the latest MCP tool call without waking an LLM.",
    {
      task_id: z
        .string()
        .optional()
        .describe(
          "Task ID — returns the task projection (and its mission rollup)",
        ),
      mission_id: z
        .string()
        .optional()
        .describe("Mission ID — returns the mission's per-status task counts"),
    },
    async ({ task_id, mission_id }) => {
      if (!task_id && !mission_id) {
        return text("Error: provide task_id and/or mission_id.");
      }
      const lines: string[] = [];
      let missionId = mission_id;

      if (task_id) {
        const snap = await getDoc(doc(db, "tasks", task_id));
        if (!snap.exists()) return text(`Error: Task ${task_id} not found.`);
        const data = snap.data() as {
          title?: string;
          status?: string;
          missionId?: string;
          projection?: {
            currentStatus?: string;
            lastAgentId?: string;
            lastActivityAt?: Timestamp;
            lastActivitySummary?: string;
            milestonesPassed?: string[];
            blockerSummary?: string;
          };
        };
        missionId = missionId || data.missionId;
        const p = data.projection;
        if (!p) {
          lines.push(
            `Task ${task_id} ("${
              data.title ?? ""
            }") has no projection yet (status=${
              data.status ?? "?"
            }); it updates on the next MCP tool call.`,
          );
        } else {
          const when =
            p.lastActivityAt?.toDate?.().toISOString?.() ?? "(unknown)";
          lines.push(
            `Task: ${data.title ?? task_id} (id=${task_id})`,
            `Current status: ${p.currentStatus ?? data.status ?? "?"}`,
            `Last agent: ${p.lastAgentId || "(none)"}`,
            `Last activity: ${p.lastActivitySummary || "(none)"} @ ${when}`,
            `Milestones passed: ${
              p.milestonesPassed?.length
                ? p.milestonesPassed.join(", ")
                : "(none)"
            }`,
          );
          if (p.blockerSummary) lines.push(`Blocker: ${p.blockerSummary}`);
        }
      }

      if (missionId) {
        const mSnap = await getDoc(doc(db, "missions", missionId));
        if (mSnap.exists()) {
          const mp = (
            mSnap.data() as {
              projection?: { statusCounts?: Record<string, number> };
            }
          ).projection;
          const counts = mp?.statusCounts
            ? Object.entries(mp.statusCounts)
                .filter(([, n]) => n > 0)
                .map(([s, n]) => `${s}=${n}`)
                .join(", ")
            : "";
          lines.push(`Mission ${missionId} task counts: ${counts || "(none)"}`);
        } else {
          lines.push(`Mission ${missionId} not found.`);
        }
      }

      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 17. get_agents — Real-time agent list (Bridge first, Firestore fallback)
  auditedTool(
    "get_agents",
    "Get all agents with real-time status from AgentManager. Falls back to Firestore if bridge is unavailable.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored on both the bridge and Firestore-fallback paths, and locked to this orchestrator session's project: a different project is refused with an error.",
        ),
    },
    async ({ project_id }) => {
      // Enforce the lock BEFORE the bridge branch: the bridge path reads
      // MARBLO_PROJECT directly and never looked at project_id at all, so a
      // cross-project argument was dropped even harder here than in the
      // Firestore fallback below.
      const lockedProjectId = await enforceProjectLock(
        "get_agents",
        project_id,
      );
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;

      // Try Bridge first — real-time data from AgentManager. Pass our
      // project so multi-window mode returns only this project's agents.
      if (bridgePort) {
        try {
          const projectId = lockedProjectId;
          const url = projectId
            ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
                projectId,
              )}`
            : `http://127.0.0.1:${bridgePort}/agents`;
          const response = await fetch(url, { headers: bridgeHeaders() });
          const data = (await response.json()) as {
            agents: Array<{
              id: string;
              name: string;
              model: string;
              role: string;
              status: string;
              ptySessionId: string;
              currentTaskId?: string | null;
              restartCount: number;
              stallSignal?: {
                taskId: string;
                quietMs: number;
                pty: string;
                model: string | null;
                repeat: number;
              } | null;
            }>;
          };

          if (data.agents.length === 0) return text("No agents found.");

          const lines = data.agents.map((a) => {
            const restart =
              a.restartCount > 0 ? `, restarts=${a.restartCount}` : "";
            const task = a.currentTaskId
              ? `, currentTaskId=${a.currentTaskId}`
              : "";
            // W8: 워치독의 "조용하다" 신호. status 가 working 이어도 보드에
            // 아무 보고가 없다는 뜻 — 생존 ≠ 진행. 판단은 오케 몫.
            const quiet = a.stallSignal
              ? ` ⚠ quiet ${Math.round(
                  a.stallSignal.quietMs / 60_000,
                )}m on task ${a.stallSignal.taskId} (pty=${
                  a.stallSignal.pty
                }, model=${a.stallSignal.model ?? "?"}) — 진행 여부 확인 필요`
              : "";
            return `- [${a.status}] ${a.name} (model=${a.model}, role=${a.role}, agentId=${a.id}${task}${restart})${quiet}`;
          });
          return text(
            `Agents (${data.agents.length}, real-time):\n${capLines(
              lines,
              LIST_LIMIT_DEFAULT,
              "many agents — cleanup idle ones",
            )}`,
          );
        } catch {
          // Bridge unavailable — fall through to Firestore
        }
      }

      // Firestore fallback
      const projectId = lockedProjectId;
      const q = query(
        collection(db, "agents"),
        where(
          "projectId",
          "==",
          requireProjectScope("agents", projectId, "get_agents"),
        ),
      );
      const snap = await getDocs(q);

      if (snap.empty) return text("No agents found.");

      const lines = snap.docs.map((d) => {
        const a = d.data();
        const statusInfo = normalizeFirestoreFallbackAgentStatus(a.status);
        const task =
          !statusInfo.staleActive && a.currentTaskId
            ? `, currentTaskId=${a.currentTaskId}`
            : "";
        const stale = statusInfo.staleActive
          ? `, staleStatus=${String(a.status)}`
          : "";
        return `- [${statusInfo.status}] ${a.name} (model=${a.model}, role=${a.role}, agentId=${d.id}${task}${stale})`;
      });
      return text(
        `Agents (${snap.size}, Firestore fallback):\n${capLines(
          lines,
          LIST_LIMIT_DEFAULT,
          "many agents — cleanup idle ones",
        )}`,
      );
    },
    { userFacing: false },
  );

  // ── reuse_agent — Send a new instruction to an existing idle agent
  auditedTool(
    "reuse_agent",
    "Send a new task instruction to an existing idle agent via its PTY session. Use this BEFORE spawn_agent to check if an idle agent with the matching role already exists. The agent will receive the message in its terminal stdin.",
    {
      agent_name: z.string().describe("Name of the existing agent to reuse"),
      instruction: z
        .string()
        .describe("New instruction/task to send to the agent"),
      task_id: z
        .string()
        .optional()
        .describe(
          "Marblo task ID to bind to the reused agent. When set, the task's " +
            "claimedBy is rebound to this agent (mirrors dispatch_task) so the " +
            "board shows the REAL worker immediately instead of a stale assignee.",
        ),
    },
    async ({ agent_name, instruction, task_id }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/reuse-agent`,
          {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              agentName: agent_name,
              instruction,
              taskId: task_id || "",
              projectId: process.env.MARBLO_PROJECT || "",
              contextId: process.env.MARBLO_CONTEXT || "",
            }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          error?: string;
        };

        if (!result.success) {
          return text(
            `Cannot reuse agent '${agent_name}': ${
              result.error || "Unknown error"
            }. Consider using spawn_agent instead.`,
          );
        }

        // Bind the board task to the reused agent so the kanban shows the REAL
        // worker immediately — and overwrite any stale claimedBy left by a
        // previous owner. Without this, reuse_agent only nudged the PTY and the
        // task's claimedBy stayed pinned to whoever last auto-claimed it, so the
        // board showed the wrong/uniform assignee until the agent happened to
        // call update_task_status. Same pattern as dispatch_task's task binding.
        if (result.agentId && task_id) {
          try {
            // Rebind claimedBy AND advance TODO → CLAIMED (mirrors dispatch_task)
            // so a reused agent's task leaves the board's TODO column. See
            // bindTaskToDispatchedAgent.
            await bindTaskToDispatchedAgent(task_id, result.agentId);
          } catch (err) {
            // Non-fatal — the instruction is already delivered; the board just
            // keeps showing the stale assignee. Surface for diagnosis.
            console.error("[reuse_agent] Failed to bind task claimedBy:", err);
          }
        }

        return text(
          `Instruction sent to existing agent '${agent_name}'.\n` +
            `  Agent ID: ${result.agentId}\n` +
            (task_id ? `  Bound task: ${task_id}\n` : "") +
            `  Instruction: ${instruction.slice(0, 100)}${
              instruction.length > 100 ? "..." : ""
            }`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── dispatch_task — Smart agent dispatch (reuse/restart/spawn/logical)
  auditedTool(
    "dispatch_task",
    "Smart agent dispatch: by default creates/uses a physical agent and board-tracked task, including complexity='simple'. Logical/internal sub-agents are explicit opt-in only via use_logical=true. Preferred over manual spawn_agent/reuse_agent calls.",
    {
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      instruction: z.string().describe("Instruction to send to the agent"),
      task_id: z.string().optional().describe("Marblo task ID for tracking"),
      complexity: z
        .enum(["simple", "standard", "complex"])
        .optional()
        .describe(
          "Task difficulty — also picks the agent model tier (cost/quality). " +
            "'simple' = physical agent + board task using cheap tier (claude sonnet / codex low); 'standard' (default) = " +
            "top model (claude opus / gpt-5.6-terra medium); 'complex' = physical agent + " +
            "top reasoning (claude fable / gpt-5.6-sol high). Set per task difficulty.",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "모델 지정. 두 층위를 다 받는다. (1) 프로바이더만: 'claude' | 'codex' " +
            "| 'gpt' | 'grok' | 'antigravity' — 'codex'와 'gpt'는 같은 Codex CLI. 이때는 " +
            "구체 모델을 그 벤더의 난도별 티어 정책이 고른다. (2) 구체 모델: " +
            "'opus'/'opus5'/'fable'/'sonnet'/'haiku' 같은 별칭이나 " +
            "'claude-opus-4-8'/'gpt-5.6-terra'/'grok-4.5' 같은 구체 id. 표기는 느슨해도 " +
            "된다('opus 4.8'='opus4.8'='claude-opus-4-8'). 'gpt-5.6-terra@xhigh' " +
            "처럼 @로 effort를 함께 줄 수도 있다. 어느 쪽이든 지정하면 태그 " +
            "스코어링을 우회한다. ★유효한 모델은 서버의 모델 레지스트리가 단일 " +
            "소스이며 CLI 실측으로 검증된 것만 등록돼 있다 — 목록에 없는 id는 " +
            "무시되고 기존 스코어링으로 폴백한다(추측 스폰 없음). 설치된 CLI가 " +
            "그 모델을 검증한 범위 밖이면 안전 모델로 폴백하고 스폰은 성공한다.",
        ),
      effort: z
        .string()
        .optional()
        .describe(
          "reasoning effort (low/medium/high/xhigh/max/ultra). Codex 계열만 " +
            "effort 축이 있고 Claude에는 없다(지정해도 무시). 모델별 지원 " +
            "목록에 없는 값도 무시된다 — 모델 지정 자체는 그대로 살아 있다. " +
            "model에 '@effort'가 이미 있으면 그쪽이 우선한다.",
        ),
      name: z.string().optional().describe("Agent name hint"),
      cwd: z.string().optional().describe("Working directory"),
      skills: z
        .array(z.string())
        .max(MAX_SKILLS_PER_DISPATCH)
        .optional()
        .describe(
          "이 작업에 쓸 CLI 네이티브 스킬 이름들(예: ['seo-geo-full']). " +
            "스폰 전에 실제 설치 여부를 디스크로 검증한다 — 미설치/오타명은 " +
            "조용히 무시되지 않고 즉시 에러(제안명 포함). 지정하면 그 스킬이 " +
            "설치된 벤더(claude/codex)로만 라우팅되고, 지시문에 사용 규약이 " +
            "주입된다. 스킬을 쓸 필요가 없으면 비워 둔다.",
        ),
      tags: z
        .array(z.string())
        .optional()
        .describe(
          "Task tags for model scoring (e.g., architecture, research, simple-fix)",
        ),
      mix: z
        .enum(["cross-check", "split-role"])
        .optional()
        .describe(
          "★complex 전용 opt-in 모델 믹스(기본 off). 발동 시 Claude 최상위 + Codex " +
            "high 2-spawn. 'cross-check'(기본)=교차검증, 'split-role'=역할분담. " +
            "complexity!=='complex' 면 무시됨. 비용 2배(슬롯 2)이므로 정확성이 " +
            "중요한 설계/보안/마이그레이션에만.",
        ),
      stages: z
        .array(
          z.object({
            instruction: z.string(),
            complexity: z.enum(["simple", "standard", "complex"]).optional(),
            model: z.string().optional(),
            tags: z.array(z.string()).optional(),
            dependsOnPrevious: z.boolean().optional(),
          }),
        )
        .optional()
        .describe(
          "★complex 전용 opt-in 단계분할(기본 단일). 스텝 배열을 각각 작은 " +
            "dispatch 로 풀어 난도별 모델 매칭(설계→최상위, 기계적→cheap). " +
            "dependsOnPrevious 스텝은 순차, 아니면 병렬. complexity!=='complex' 면 무시됨.",
        ),
      isolate: z
        .boolean()
        .optional()
        .describe(
          "Deprecated compatibility flag. simple도 기본으로 cheap 모델(claude=sonnet, gpt=low) 물리 에이전트+보드 티켓 경로를 탄다. 논리 서브에이전트가 필요하면 use_logical=true를 사용한다.",
        ),
      use_logical: z
        .boolean()
        .optional()
        .describe(
          "명시적 opt-in 논리 서브에이전트 모드. true이고 complexity='simple'일 때만 오케 내부 logical 처리로 단락한다. 기본 false: simple도 물리 에이전트+보드 티켓.",
        ),
      ...missionLabelParamShape,
    },
    async ({
      role,
      instruction,
      task_id,
      complexity,
      model,
      effort,
      name,
      cwd,
      skills,
      tags,
      mix,
      stages,
      isolate,
      use_logical,
      mission_label,
      mission_goal,
    }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      // P4-1 — 스킬명 선검증. 벤더별 하드 게이트는 bridge 가 실제 선택 모델에
      // 대해 다시 걸지만(단일 진실), 오타는 여기서 먼저 끊는다: 미션 태스크
      // 생성·의존성 게이트 같은 부수효과가 일어나기 전에 실패해야 `/seo-geo-
      // optimization` 한 글자 때문에 보드에 쓰레기 티켓이 남지 않는다.
      if (skills && skills.length > 0) {
        const preflight = resolveSkillRouting({
          skills,
          cwd: cwd || process.env.MARBLO_PROJECT_ROOT,
        });
        if (!preflight.ok) return text(preflight.error);
      }

      // ★P3-1 승인 게이트 — 고비용 칸(max/ultra)은 여기서 걸러진다.
      //
      // 왜 이 층인가: 승인 레코드는 티켓 문서(`tasks/{id}.modelEscalations`)에
      // 있고 그걸 읽을 수 있는 것은 Firestore 를 쥔 이 MCP 층이다. bridge 는
      // Firestore 클라이언트가 없어 승인 여부를 확인할 방법이 없다 — 그래서
      // 게이트를 bridge 에 두면 "확인 못 하니 통과" 나 "확인 못 하니 전면 차단"
      // 둘 중 하나가 되고, 둘 다 사장님 지시("승인받고 쓸 것")를 못 지킨다.
      //
      // 결과는 차단이 아니라 **effort 강등**이다: 모델 지정은 살리고 effort 만
      // 떨어뜨려 티켓이 계속 굴러가게 하되, 무시했다는 사실을 호출자에게 문장으로
      // 돌려준다(조용한 무시 금지). 승인이 있으면 통과시키고 스폰 성공 후 소진한다.
      const requestedEffort = effortFromDispatchArgs(model, effort);
      let effortForDispatch = effort;
      let gateNote = "";
      let approvalToConsume: string | null = null;
      if (isApprovalGatedEffort(requestedEffort)) {
        // 승인은 티켓 단위이므로 호출자가 준 task_id 로 조회한다(미션 경로에서
        // 뒤늦게 만들어지는 ad-hoc 티켓에는 승인 레코드가 있을 수 없다).
        const gate = await gateDispatchEffort(task_id, requestedEffort!, model);
        if (gate.approvedQuestionId) {
          approvalToConsume = gate.approvedQuestionId;
          gateNote = `★고비용 칸 ${requestedEffort} 사용(승인 question_id=${gate.approvedQuestionId}) — 이 승인은 이번 스폰으로 소진됩니다.\n`;
        } else {
          // model 문자열에 '@max' 형태로 들어온 경우까지 확실히 떼어낸다 —
          // 여기서 놓치면 bridge 의 parseModelSpec 이 그대로 살려 스폰한다.
          model = stripEffortSuffix(model);
          effortForDispatch = undefined;
          gateNote = `⚠️ ${gate.reason}\neffort 지정을 무시하고 승인 없이 쓸 수 있는 기본 effort 로 스폰합니다. 정말 필요하면 request_model_escalation(task_id, model, effort, reason) 으로 사용자 승인을 받으세요.\n`;
        }
      }

      const missionContextId = resolveMissionContextForWrite();
      let dispatchTaskId = task_id;
      let scopePreflightNote = "";

      if (missionContextId && !dispatchTaskId) {
        const projectId = DEFAULT_PROJECT;
        if (!projectId) {
          return text(
            "Error: No project context. Set MARBLO_PROJECT env var before dispatching a mission task.",
          );
        }

        const now = Timestamp.now();
        const data: Record<string, unknown> = {
          title: name || instruction.split(/\r?\n/, 1)[0].slice(0, 80),
          description: instruction,
          role,
          priority: 3,
          status: "TODO",
          dependsOn: [],
          dependsOnCompleted: true,
          claimedBy: null,
          claimedAt: null,
          scope: tags ?? [],
          comment: `Mission ${missionContextId} (dispatch_task)`,
          prUrl: "",
          hasPmFeedback: false,
          projectId,
          contextId: missionContextId,
          missionId: missionContextId,
          createdAt: now,
          updatedAt: now,
        };

        const missionContextError = applyMissionContextTags(
          data,
          missionContextId,
        );
        if (missionContextError) return text(`Error: ${missionContextError}`);

        const ref = await addDoc(collection(db, "tasks"), data);
        dispatchTaskId = ref.id;
      }

      // Patent claim 4: 매칭점수 산출 단계는 선행 태스크의 존재 여부 및
      // 완료 여부를 먼저 판단하고, 선행이 없거나 완료된 태스크에 대해서만
      // 매칭점수를 산출한다. dispatch_task 가 매칭/스폰 진입점이므로 여기서
      // 명시적으로 dependency gate 를 둔다 — get_available_tasks 의 필터와
      // 별개로, task_id 가 직접 지정된 dispatch 경로(오케스트레이터가 특정
      // 태스크를 콕 집어 배정하는 케이스)에서도 같은 가드가 적용되도록 함.
      // ★P2-1 — 지식그래프의 taskType 축. 티켓 문서를 여기서 이미 읽으므로
      // (아래 dependency precheck) 그 자리에서 분류해 bridge 로 넘긴다. 종전엔
      // electron 쪽에 분류기가 없어서 그래프가 complexity 단일축으로만 학습했다.
      let dispatchTaskType: string | undefined;
      if (dispatchTaskId) {
        try {
          const task = await fetchTask(dispatchTaskId);
          if (!task) {
            return text(
              `Error: Task ${dispatchTaskId} not found — refusing to dispatch.`,
            );
          }
          dispatchTaskType = classifyTaskType(task) ?? undefined;
          const scopePreflight = await preflightDispatchScopeInHead({
            cwd: cwd || process.env.MARBLO_PROJECT_ROOT,
            scope: task.scope,
          });
          scopePreflightNote = scopePreflight.warning;
          const missionContextError = await ensureTaskMissionContext(
            dispatchTaskId,
            task,
            missionContextId,
          );
          if (missionContextError) return text(`Error: ${missionContextError}`);
          // claim_task 와 동일 판정기 — 저장 플래그가 stale false 여도 선행이
          // 실제로 전부 DONE 이면 통과시키고 플래그를 자가치유한다. 이 게이트가
          // 플래그를 그대로 믿던 탓에, 이미 DONE 인 선행을 건 후행 태스크가
          // 조회 API 는 "충족"인데 dispatch 만 BLOCKED 로 되돌렸다.
          if (!(await isDependencyGateOpen(db, task, { heal: true }))) {
            // Mark BLOCKED so it surfaces in the kanban board, then refuse
            // to dispatch. Best-effort — failing to mark is not fatal.
            // Route through applyProjection (not a raw updateDoc) so
            // tasks/{id}.projection.currentStatus AND the mission's
            // statusCounts move together with the real status — a bare
            // updateDoc left both projections stale, so get_projection
            // contradicted the actual BLOCKED status. No validateFrom: this is
            // a forced mark regardless of current status (same intent as the
            // prior raw write), so the in-txn TOCTOU guard stays off.
            try {
              await applyProjection(db, dispatchTaskId, {
                newStatus: "BLOCKED",
                lastAgentId: WORKER_AGENT_ID,
                lastActivitySummary:
                  "dispatch aborted: 선행 태스크 미완료 — BLOCKED",
                blockerSummary: "선행 태스크 미완료 (dependsOn 미충족)",
              });
            } catch (markErr) {
              console.error(
                "[dispatch_task] Failed to mark task BLOCKED:",
                markErr,
              );
            }
            const pending = (task.dependsOn || []).join(", ") || "(unknown)";
            return text(
              `Dispatch aborted (patent claim 4: 선행태스크 미완료): task ${dispatchTaskId} depends on [${pending}], not all complete. Task moved to BLOCKED. Resolve dependencies first, then re-dispatch.`,
            );
          }
        } catch (err) {
          console.error("[dispatch_task] Dependency precheck failed:", err);
          if (missionContextId) {
            return text(
              `Error: Failed to verify mission task tags before dispatch — ${
                err instanceof Error ? err.message : String(err)
              }`,
            );
          }
          // Don't block dispatch on a precheck failure — the bridge / agent
          // path also has its own claim_task gate as defense-in-depth.
        }
      }

      // SPAWN-MODEL-ALLOCATION-V2 §4/§5: mix(모델 믹스)·stages(단계분할)는 complex
      // 전용 opt-in. complexity!=="complex" 면 조용히 삼키지 않고 무시 + 경고 후
      // 단일 디스패치로 진행(기본 동작 무변동). bridge 도 같은 가드를 둔다(방어).
      let effectiveMix = mix;
      let effectiveStages = stages;
      if (complexity !== "complex" && (mix || (stages && stages.length > 0))) {
        console.warn(
          `[dispatch_task] mix/stages ignored — complexity='${
            complexity || "standard"
          }' (complex 전용). 단일 디스패치로 진행.`,
        );
        effectiveMix = undefined;
        effectiveStages = undefined;
      }

      // §B(v2): simple 은 기본 물리 스폰이다. 논리 서브에이전트는 use_logical
      // 명시 opt-in만 허용한다. isolate 는 호환용으로만 남아 있으며 라우팅을
      // 바꾸지 않는다.
      let effectiveIsolate = isolate;
      if (isolate && complexity !== "simple") {
        console.warn(
          `[dispatch_task] isolate ignored — complexity='${
            complexity || "standard"
          }' (simple 전용).`,
        );
        effectiveIsolate = undefined;
      }
      const effectiveUseLogical =
        complexity === "simple" && use_logical === true;
      if (use_logical && complexity !== "simple") {
        console.warn(
          `[dispatch_task] use_logical ignored — complexity='${
            complexity || "standard"
          }' (simple 전용).`,
        );
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/dispatch-task`,
          {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({
              role,
              instruction,
              taskId: dispatchTaskId,
              complexity: complexity || "standard",
              model,
              // ★승인 게이트를 통과한 effort 만 나간다(강등 시 undefined).
              effort: effortForDispatch,
              nameHint: name,
              cwd,
              skills,
              tags,
              // ★P2-1 — 그래프 taskType 축(없으면 종전대로 우아한 저하).
              taskType: dispatchTaskType,
              mix: effectiveMix,
              stages: effectiveStages,
              isolate: effectiveIsolate,
              useLogical: effectiveUseLogical,
              projectId: process.env.MARBLO_PROJECT || "",
              // Forward parent agent id for owner fallback when projectId
              // is empty (external Claude Code → Marblo MCP path).
              parentAgentId: process.env.MARBLO_AGENT_ID || "",
              contextId: process.env.MARBLO_CONTEXT || "",
            }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          action?: string;
          agentId?: string;
          agentName?: string;
          agentRole?: string;
          model?: string;
          /** 실제로 스폰된 구체 모델·effort. `model`(프로바이더)과 별개 축. */
          spawnedModel?: string;
          score?: number;
          reason?: string;
          error?: string;
          // Board task bound to the agent — the supplied task_id, or an ad-hoc
          // task the WorktreeCoordinator created for a spawn without one.
          taskId?: string | null;
          // 모델 믹스(§4) 동반 에이전트 / 단계분할(§5) 스텝 에이전트들.
          companionAgentId?: string;
          stageAgentIds?: string[];
          // 정지 의심(보드 무활동 임계 초과)으로 우회된 이전 담당 — 바인딩만
          // 해제, 킬 안 함. bridge-server.ts BypassedStaleAgent.
          bypassedStaleAgents?: Array<{
            agentId: string;
            agentName: string;
            quietMinutes: number | null;
            reason: string;
          }>;
        };

        if (!result.success) {
          return text(
            `${gateNote}Dispatch failed: ${result.error || "Unknown error"}`,
          );
        }

        // ★스폰이 성공한 뒤에야 승인을 소진한다(1회용 계약). 실패한 스폰이 승인을
        // 태우면 사장님을 다시 깨워야 하므로 순서가 중요하다.
        if (approvalToConsume) {
          const consumedAt = Date.now();
          const ok = await mutateEscalations(task_id!, (cur) =>
            consumeApproval(cur, approvalToConsume!, consumedAt),
          );
          gateNote += ok
            ? `승인 ${approvalToConsume} 소진 처리됨.\n`
            : `⚠️ 승인 ${approvalToConsume} 소진 기록에 실패했습니다 — 같은 승인이 재사용될 수 있으니 오케가 확인하세요.\n`;
        }

        // Persist newly-spawned / restarted agents to Firestore so they
        // appear in the Agents tab and survive across sessions. Reuse-only
        // dispatches don't need a new doc — the existing one is reused.
        // Idempotent setDoc(..., {merge:true}) with the bridge's agentId
        // as doc id — the renderer's onAgentSpawned listener also writes
        // the same doc, both converge on a single record.
        if (
          (result.action === "spawned" ||
            result.action === "restarted" ||
            result.action === "mixed") &&
          result.agentId
        ) {
          const projectId = DEFAULT_PROJECT;
          if (projectId) {
            try {
              const ownerId = await resolveAgentDocumentOwnerId(projectId);
              await setDoc(
                doc(db, "agents", result.agentId),
                {
                  projectId,
                  ...(ownerId ? { ownerId } : {}),
                  name: result.agentName || `${role}-agent`,
                  model: result.model || model || "claude",
                  // 구체 모델 축. spawned/restarted 모두 브릿지가 그 프로세스의
                  // 실제 argv 를 되읽은 값이라, 버전가드 폴백이 걸렸으면 요청값이
                  // 아니라 서빙된 값이 보드에 남는다. 없으면 키를 빼서 merge 가
                  // 기존 스탬프를 지우지 않게 한다.
                  ...(result.spawnedModel
                    ? { spawnedModel: result.spawnedModel }
                    : {}),
                  role: result.agentRole || role,
                  status: "working",
                  // Link to the board task — the supplied task_id, or the ad-hoc
                  // worktree task the bridge auto-created (result.taskId).
                  currentTaskId: result.taskId ?? dispatchTaskId ?? null,
                  command: agentDocumentCommand(result.model || model),
                  skillFile: "",
                  createdAt: Timestamp.now(),
                },
                { merge: true },
              );
            } catch (err) {
              // Non-fatal — agent is already running, Firestore just won't
              // show it. Surface in the response so the user can see why.
              console.error("[dispatch_task] Firestore write failed:", err);
            }
          }
        }

        // Bind the board task to the dispatched agent so the kanban shows the
        // REAL worker immediately — and overwrite any stale claimedBy left by a
        // previous (now-dead) agent. Before this, dispatch updated only the
        // agent doc's currentTaskId; the task's claimedBy stayed pinned to the
        // stale agent, so the board showed the wrong assignee and the task
        // looked unstarted until a human reassigned it by hand. The orchestrator
        // no longer auto-claims (see isOrchestratorAgentId / WORKER_AGENT_ID), so
        // the dispatched worker is the correct owner to record here. Applies to
        // every binding action (spawned/restarted/reused/mixed) — not 'logical'
        // (internal sub-agent, no real agent to bind).
        const boundTaskId = result.taskId ?? dispatchTaskId;

        // ★Mission Replay 라벨 — dispatch 시점이 오케가 "이 티켓들은 한 묶음"
        // 이라고 아는 유일한 순간이다. 여기서 붙여야 보드에 이미 있던 티켓도,
        // bridge 가 방금 만든 ad-hoc 티켓(result.taskId)도 같은 묶음이 된다.
        // 실패해도 dispatch 는 이미 성공했으므로 문장으로만 알린다.
        let implicitNote = "";
        if (mission_label && boundTaskId) {
          const implicit = await resolveImplicitMissionForWrite(
            DEFAULT_PROJECT,
            mission_label,
            mission_goal,
          );
          implicitNote = implicit.note;
          if (implicit.missionId) {
            try {
              const target = await fetchTask(boundTaskId);
              const refusal = target
                ? await adoptTaskIntoImplicitMission(
                    boundTaskId,
                    target,
                    implicit.missionId,
                  )
                : `Task ${boundTaskId} not found — implicit label skipped.`;
              if (refusal) implicitNote = refusal;
            } catch (err) {
              implicitNote = `mission_label 적용 실패 — ${
                err instanceof Error ? err.message : String(err)
              }`;
            }
          }
        }

        if (result.agentId && boundTaskId && result.action !== "logical") {
          try {
            // Rebind claimedBy AND advance TODO → CLAIMED so the dispatched task
            // never lingers in the board's TODO column (and the watchdog's
            // active scan picks it up). See bindTaskToDispatchedAgent.
            await bindTaskToDispatchedAgent(boundTaskId, result.agentId);
          } catch (err) {
            // Non-fatal — the agent is already dispatched; the board just keeps
            // showing the stale assignee. Surface for diagnosis.
            console.error(
              "[dispatch_task] Failed to bind task claimedBy:",
              err,
            );
          }
        }

        const lines = [
          // ★게이트 결과를 맨 앞에 붙인다 — effort 를 무시했다는 사실을 호출자가
          // 못 보고 지나가면 그게 곧 "조용한 무시" 다.
          ...(gateNote ? [gateNote.trimEnd()] : []),
          ...(implicitNote ? [implicitNote] : []),
          ...(scopePreflightNote ? [scopePreflightNote] : []),
          `Dispatch: ${result.action}`,
          `  Reason: ${result.reason}`,
        ];
        if (result.agentId) lines.push(`  Agent ID: ${result.agentId}`);
        if (result.agentName) lines.push(`  Agent Name: ${result.agentName}`);
        if (result.agentRole) lines.push(`  Agent Role: ${result.agentRole}`);
        if (result.model) lines.push(`  Model: ${result.model}`);
        // 실제 스폰된 구체 모델. 지정과 다르면(버전가드 폴백, reuse) 여기서 드러난다.
        if (result.spawnedModel)
          lines.push(`  Spawned model: ${result.spawnedModel}`);
        if (result.score !== undefined) lines.push(`  Score: ${result.score}`);
        if (dispatchTaskId) lines.push(`  Task ID: ${dispatchTaskId}`);
        if (result.companionAgentId)
          lines.push(`  Mix companion (Codex): ${result.companionAgentId}`);
        if (result.stageAgentIds && result.stageAgentIds.length > 0)
          lines.push(`  Stage agents: ${result.stageAgentIds.join(", ")}`);
        // ★정지 의심 담당을 우회했다 — 죽이지는 않았다. 같은 워크트리에 두 워커가
        // 앉게 되므로 오케가 여기서 결정해야 한다(2026-08-22 배포 정지 건: 오케가
        // kill_agent 후 재스폰해서 해결했다 — 그 결정을 워치독/dispatch 가 대신
        // 내리지 않는다).
        if (
          result.bypassedStaleAgents &&
          result.bypassedStaleAgents.length > 0
        ) {
          for (const b of result.bypassedStaleAgents) {
            const quiet =
              b.quietMinutes === null
                ? "보드 활동 없음"
                : `마지막 보드 활동 ${b.quietMinutes}분 전`;
            lines.push(
              `  ⚠ 이전 담당 '${b.agentName}'(${b.agentId}) 은 정지 의심으로 우회됨(${quiet}) — ` +
                `바인딩만 해제했고 **아직 살아 있다**. 같은 워크트리에서 계속 돌게 둘 게 아니면 ` +
                `kill_agent('${b.agentName}') 로 정리하라.`,
            );
          }
        }
        if (result.action === "logical") {
          lines.push(
            `\nAction required: Use internal sub-agent (Task/Agent tool) to handle this simple task directly.`,
          );
        }

        // ★자동 포착 — 재현 시나리오("티켓 A 를 dispatch 하고, A 가 끝나면 B 를
        // 해야 한다")가 걸리는 자리. 다만 지시문은 **수신자에게 주는 명령문**이라
        // 가장 오탐이 쉬운 표면이다. 그래서 이 표면만 정책이 더 좁다
        // (SURFACE_POLICY.dispatch_instruction): 명령형 어미는 1인칭 주어가 없으면
        // 탈락하고, 약속 어미는 선행 힌트("~끝나면","머지되면")를 동반해야 한다.
        // contextTaskId 로 방금 디스패치한 티켓을 넘겨, 문장에 id 가 없어도
        // "이거 끝나면" 의 '이거' 가 선행으로 걸린다.
        const dispatchCapture = await captureChainPromiseNote(
          "dispatch_instruction",
          "dispatch_task",
          instruction,
          { contextTaskId: boundTaskId },
        );
        return text(withCaptureNote(lines.join("\n"), dispatchCapture));
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── kill_agent — Stop and remove a specific agent
  auditedTool(
    "kill_agent",
    "Stop a specific agent by name. Use to free resources or remove unnecessary agents.",
    {
      agent_name: z.string().describe("Name of the agent to kill"),
      reason: z.string().optional().describe("Reason for killing the agent"),
    },
    async ({ agent_name, reason }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        const response = await fetch(
          `http://127.0.0.1:${bridgePort}/kill-agent`,
          {
            method: "POST",
            headers: bridgeHeaders({ "Content-Type": "application/json" }),
            body: JSON.stringify({ agentName: agent_name, reason }),
          },
        );

        const result = (await response.json()) as {
          success: boolean;
          agentId?: string;
          reason?: string;
          error?: string;
        };

        if (!result.success) {
          return text(
            `Failed to kill agent '${agent_name}': ${
              result.error || "Unknown error"
            }`,
          );
        }

        if (result.agentId) {
          await markAgentStoppedAndReleaseClaims(result.agentId);
        }

        return text(`${result.reason}`);
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // ── cleanup_agents — Batch reap of dead-PTY + terminal-task agents
  auditedTool(
    "cleanup_agents",
    "Clean up stale agents: those whose PTY died (stopped/error), those still alive but bound to a terminal (DONE/FAILED) task and PTY-idle past the grace window, AND ghost Firestore docs left at working/idle by dead Electron instances (ownership-gated; marked stopped, never deleted). Optionally filter by role. Returns list of cleaned agents with reasons.",
    {
      role: z.string().optional().describe("Only clean agents with this role"),
    },
    async ({ role }) => {
      const bridgePort = process.env.MARBLO_BRIDGE_PORT;
      if (!bridgePort) {
        return text(
          "Error: MARBLO_BRIDGE_PORT not set. Bridge server not available.",
        );
      }

      try {
        // Get real-time agent list scoped to our project (multi-window).
        const projectId = process.env.MARBLO_PROJECT || "";
        const listUrl = projectId
          ? `http://127.0.0.1:${bridgePort}/agents?projectId=${encodeURIComponent(
              projectId,
            )}`
          : `http://127.0.0.1:${bridgePort}/agents`;
        const listResponse = await fetch(listUrl, { headers: bridgeHeaders() });
        const data = (await listResponse.json()) as {
          agents: Array<{
            id: string;
            name: string;
            model: string;
            role: string;
            status: string;
            contextId?: string;
            currentTaskId?: string | null;
            lastTaskId?: string | null;
            turnCompletedAt?: number | null;
            lastPtyActivity?: number;
            lastWorkOutput?: number | null;
            stallSignal?: {
              taskId: string;
              quietMs: number;
              pty: string;
            } | null;
          }>;
        };

        // Multi-window lane scoping: a lane orchestrator only reaps agents in
        // its own lane; a board orchestrator never reaps lane-owned agents.
        // Shared by both the dead-PTY and terminal-task reap passes below.
        const currentContext = process.env.MARBLO_CONTEXT || "";
        const currentIsLane = isLaneContextId(currentContext);
        const inScope = (a: { contextId?: string }): boolean => {
          if (currentIsLane) return a.contextId === currentContext;
          if (isLaneContextId(a.contextId)) return false;
          return true;
        };

        // Pass 1 — agents whose PTY already died (status stopped/error).
        // Reason recorded as the raw status for the report.
        const candidates: Array<{
          agent: (typeof data.agents)[number];
          reason: string;
        }> = [];
        for (const a of data.agents) {
          if (a.status !== "stopped" && a.status !== "error") continue;
          if (role && a.role !== role) continue;
          if (!inScope(a)) continue;
          candidates.push({ agent: a, reason: a.status });
        }

        // Pass 2 — agents still alive (working/idle) but bound to a task that
        // is already terminal (DONE/FAILED) and PTY-silent past the grace
        // window. The old status-only filter skipped these "zombies" (57 had to
        // be hand-killed in one session). Gated strictly on the connected
        // task's terminal status + idle window so a genuinely-working agent is
        // never misjudged — see agent-reap.ts.
        const now = Date.now();
        const seen = new Set(candidates.map((c) => c.agent.id));
        // Agents we deliberately do NOT kill but do surface: alive, unbound,
        // and with no completed turn behind them. Absence of evidence is not
        // evidence of being finished, so these are reported for a human to
        // judge rather than reaped (see agent-reap.ts header).
        const suspects: string[] = [];
        for (const a of data.agents) {
          if (seen.has(a.id)) continue;
          if (a.status === "stopped" || a.status === "error") continue;
          if (role && a.role !== role) continue;
          if (!inScope(a)) continue;

          // Live binding first, else the binding retained across the agent's
          // completion report. markTurnComplete clears currentTaskId, so
          // requiring it here made every cleanly-finished agent unreapable.
          // turnCompletedAt alone also proves a finished turn (submit/DONE).
          const taskId = a.currentTaskId || a.lastTaskId || null;
          const turnCompletedAt = a.turnCompletedAt ?? null;
          // W8: a live agent the watchdog flagged as board-quiet on its bound
          // task. Deliberately NOT reaped here — "quiet" is a suspicion, and
          // the '#509 invariant' (never reap live work without completion
          // evidence) stands. It is SURFACED so the orchestrator judging the
          // report sees it in the same place; kill_agent is its call.
          if (a.stallSignal && a.currentTaskId) {
            suspects.push(
              `${a.name} (${a.status}, ⚠ quiet ${Math.round(
                a.stallSignal.quietMs / 60_000,
              )}m on task ${a.stallSignal.taskId}, pty=${
                a.stallSignal.pty
              } — stall suspect, orchestrator decides)`,
            );
            continue;
          }
          if (!taskId && turnCompletedAt == null) {
            if (a.role !== "orchestrator") {
              suspects.push(`${a.name} (${a.status}, never bound to a task)`);
            }
            continue;
          }

          let taskStatus: string | null = null;
          if (taskId) {
            try {
              const task = await fetchTask(taskId);
              taskStatus = task?.status ?? null;
            } catch {
              // Lookup failure → treat as non-terminal (preserve). evaluate()
              // below short-circuits on a null/unknown status unless
              // turnCompletedAt alone qualifies.
            }
          }

          const decision = evaluateTerminalTaskReap({
            role: a.role,
            currentTaskId: a.currentTaskId ?? null,
            lastTaskId: a.lastTaskId ?? null,
            taskStatus,
            turnCompletedAt,
            lastPtyActivity: a.lastPtyActivity ?? now,
            lastWorkOutput: a.lastWorkOutput ?? null,
            now,
            staleMs: STALE_TERMINAL_REAP_MS,
          });
          if (decision.reap) {
            candidates.push({ agent: a, reason: `stale: ${decision.reason}` });
          }
        }
        const suspectNote =
          suspects.length > 0
            ? `\nNot reaped (no completed turn to prove they're done, or only a stall SUSPICION — check manually; kill_agent if you judge them dead): ${suspects.join(
                ", ",
              )}`
            : "";

        // Pass 3 — Firestore ghost docs from dead Electron instances. The two
        // passes above only see the bridge's in-memory agents; docs a previous
        // instance left at status=working are invisible to them (the 28-ghost
        // incident). The bridge delegates to main's ownership-gated sweep
        // (machineId + pid liveness — other machines / live instances are
        // never touched; docs are marked stopped, never deleted).
        let ghostNote = "";
        try {
          const ghostResp = await fetch(
            `http://127.0.0.1:${bridgePort}/reclaim-ghosts`,
            {
              method: "POST",
              headers: bridgeHeaders({ "Content-Type": "application/json" }),
              body: "{}",
            },
          );
          const ghost = (await ghostResp.json()) as {
            success: boolean;
            reclaimed?: Array<{ name: string; reason: string }>;
          };
          if (ghost.success && ghost.reclaimed && ghost.reclaimed.length > 0) {
            ghostNote = `\nAlso reclaimed ${
              ghost.reclaimed.length
            } ghost doc(s) left by dead instances (marked stopped): ${ghost.reclaimed
              .map((g) => g.name)
              .join(", ")}`;
          }
        } catch {
          // Older bridge without the endpoint / transient failure — the
          // in-memory cleanup result below still stands on its own.
        }

        if (candidates.length === 0) {
          const roleNote = role ? ` for role '${role}'` : "";
          return text(
            `No reapable agents found${roleNote} (no stopped/error agents and no live agents on terminal tasks). Nothing to clean up.${suspectNote}${ghostNote}`,
          );
        }

        // Kill each candidate, logging its reap reason.
        const results: string[] = [];
        for (const { agent, reason } of candidates) {
          console.log(
            `[cleanup_agents] reaping ${agent.name} (${agent.status}) — ${reason}`,
          );
          try {
            const response = await fetch(
              `http://127.0.0.1:${bridgePort}/kill-agent`,
              {
                method: "POST",
                headers: bridgeHeaders({ "Content-Type": "application/json" }),
                body: JSON.stringify({
                  agentName: agent.name,
                  reason: `cleanup: ${reason}`,
                }),
              },
            );
            const result = (await response.json()) as {
              success: boolean;
              agentId?: string;
            };
            if (result.success && result.agentId) {
              await markAgentStoppedAndReleaseClaims(result.agentId);
            }
            results.push(`${agent.name} (${reason})`);
          } catch {
            results.push(`${agent.name} (failed to kill)`);
          }
        }

        return text(
          `Cleaned up ${results.length} agent(s): ${results.join(
            ", ",
          )}${suspectNote}${ghostNote}`,
        );
      } catch (err: unknown) {
        return text(
          `Error: Failed to reach bridge server — ${(err as Error).message}`,
        );
      }
    },
  );

  // 17. create_flow — Create a new flow
  auditedTool(
    "create_flow",
    "Create a new flow (pipeline). Nodes and edges are JSON strings matching FlowNode[] and FlowEdge[] types.",
    {
      name: z.string().describe("Flow name"),
      description: z.string().optional().describe("Flow description"),
      nodes: z
        .string()
        .optional()
        .describe("FlowNode[] as JSON string (default: [])"),
      edges: z
        .string()
        .optional()
        .describe("FlowEdge[] as JSON string (default: [])"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({ name, description, nodes, edges, project_id }) => {
      const projectId = await enforceProjectLock("create_flow", project_id);

      let parsedNodes: unknown[];
      let parsedEdges: unknown[];
      try {
        parsedNodes = JSON.parse(nodes || "[]");
        parsedEdges = JSON.parse(edges || "[]");
      } catch (e: unknown) {
        return text(`Error: Invalid JSON — ${(e as Error).message}`);
      }

      const now = Timestamp.now();
      const data: Record<string, unknown> = {
        name,
        description: description || "",
        nodes: parsedNodes,
        edges: parsedEdges,
        status: "draft",
        createdBy: "orchestrator",
        createdAt: now,
        updatedAt: now,
      };
      if (projectId) data.projectId = projectId; // flows can be project-less (draft)

      const ref = await addDoc(collection(db, "flows"), data);
      return text(
        `Flow created successfully!\n` +
          `  ID: ${ref.id}\n` +
          `  Name: ${name}\n` +
          `  Nodes: ${parsedNodes.length}\n` +
          `  Edges: ${parsedEdges.length}`,
      );
    },
  );

  // 18. get_flows — List project flows
  auditedTool(
    "get_flows",
    "Get all flows for a project. Returns id, name, status, and node count.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({ project_id }) => {
      const projectId = await enforceProjectLock("get_flows", project_id);
      const q = query(
        collection(db, "flows"),
        where(
          "projectId",
          "==",
          requireProjectScope("flows", projectId, "get_flows"),
        ),
      );
      const snap = await getDocs(q);

      if (snap.empty) return text("No flows found.");

      const lines = snap.docs.map((d) => {
        const f = d.data();
        const nodeCount = Array.isArray(f.nodes) ? f.nodes.length : 0;
        return `- [${f.status}] ${f.name} (nodes=${nodeCount}, id=${d.id})`;
      });
      return text(`Flows (${snap.size}):\n${lines.join("\n")}`);
    },
    { userFacing: false },
  );

  // 19. update_flow — Update an existing flow
  auditedTool(
    "update_flow",
    "Update a flow. Can change name, nodes, edges, and status (draft/running/paused/completed/failed).",
    {
      flow_id: z.string().describe("Flow ID"),
      name: z.string().optional().describe("New flow name"),
      nodes: z.string().optional().describe("FlowNode[] as JSON string"),
      edges: z.string().optional().describe("FlowEdge[] as JSON string"),
      status: z
        .enum(["draft", "running", "paused", "completed", "failed"])
        .optional()
        .describe("New flow status"),
    },
    async ({ flow_id, name, nodes, edges, status }) => {
      const ref = doc(db, "flows", flow_id);
      const snap = await getDoc(ref);
      if (!snap.exists()) return text(`Error: Flow ${flow_id} not found.`);

      const updates: Record<string, unknown> = {
        updatedAt: Timestamp.now(),
      };

      if (name !== undefined) updates.name = name;
      if (status !== undefined) updates.status = status;

      if (nodes !== undefined) {
        try {
          updates.nodes = JSON.parse(nodes);
        } catch (e: unknown) {
          return text(`Error: Invalid nodes JSON — ${(e as Error).message}`);
        }
      }
      if (edges !== undefined) {
        try {
          updates.edges = JSON.parse(edges);
        } catch (e: unknown) {
          return text(`Error: Invalid edges JSON — ${(e as Error).message}`);
        }
      }

      await updateDoc(ref, updates);
      const flowName = name || snap.data()?.name || flow_id;
      return text(`Flow '${flowName}' updated successfully.`);
    },
  );

  // ── 오케스트레이터 워크체인 (티켓 fQtXQ2NzyYs0MRpqByTS) ─────────────────
  // 오케가 "A 끝나면 B, 그다음 C" 를 적어 두고 A 를 마친 뒤 **다시 읽는** 목록.
  // 대화 맥락이 요약되거나 세션이 바뀌어도 `workChains/{projectId}` 에 남는다.
  // ★완료 판정은 오케 자기보고가 아니라 연결 티켓의 보드 상태다 — 모델·규칙은
  // work-chain-core.ts, I/O 는 work-chain.ts. 워커 역할 표면에는 등록되지 않는다
  // (tool-surface.ts 의 워커 화이트리스트에 없으므로 오케/전체 표면에만 보인다).
  auditedTool(
    "get_work_chain",
    "Read the orchestrator's work chain — the persistent 'what I do next' list for this project (what / why / prerequisites / live state). Renders ONE LINE PER ITEM by default (what · state · evidence count · what blocks it · id), grouped so the items that need a human first come first: ▶ 다음, then items whose evidence tickets are gone from the board, then the owner's missions. Long why/note text is COLLAPSED, not dropped — pass detail=\"full\" for every item or item_ids=[...] to expand just those. Item state is DERIVED from the linked tickets' real board status, never from self-report: an item linked to tickets is done only when they reach done_when. A mission_label item collects that implicit-mission's board tickets (same missionLabelKey matching as dispatch) and unions them with task_ids; 0 tickets is unsplit, not done. Call this right after finishing any unit of work (merge, close-out, dispatch) and at session start, then do the item marked ▶ 다음.",
    {
      include_closed: z
        .boolean()
        .optional()
        .describe(
          "Also list done/dropped items (default: false — open items only)",
        ),
      detail: z
        .enum(["compact", "full"])
        .optional()
        .describe(
          "compact (default) = one line per item, scannable. full = expand every item's why/source/evidence/notes. Prefer item_ids over full when you only need a few.",
        ),
      item_ids: z
        .array(z.string())
        .optional()
        .describe(
          'Expand only these chain item ids (from the id column) while the rest stay one-line. Ignored when detail="full".',
        ),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({ include_closed, detail, item_ids, project_id }) => {
      const projectId = await enforceProjectLock("get_work_chain", project_id);
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);
      const chain = await loadWorkChain(db, projectId);
      return text(
        formatWorkChain(chain.derived, {
          taskTitles: chain.facts.titles,
          taskStatuses: chain.facts.statuses,
          includeClosed: !!include_closed,
          detail,
          expandItemIds: item_ids,
        }) + `\n(rev=${chain.rev})`,
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "add_work_chain_item",
    "Append an item to the orchestrator's work chain: WHAT you will do next and WHY (both required — 'why' is what lets a future you judge whether the item is still valid, e.g. '배포가 급해서 보류'). Link real tickets: task_ids = the tickets whose board status PROVES this item done (done_when: exists|review|done); mission_label = hang an implicit-mission bundle (same label as dispatch mission_label; matching uses missionLabelKey). Both may be set — evidence is the union. A label with 0 tickets is unsplit, not done. after_task_ids = prerequisite tickets that must be DONE before this item is ready. Promised-to-do-later things ('I'll open a web ticket for X', 'resume design 3/8 after deploy', 'close out NTQY after merge') belong here the moment you say them.",
    {
      what: z.string().describe("What to do — one line (≤200 chars)"),
      why: z
        .string()
        .describe(
          "Why it matters / why it is deferred — the validity condition (≤500 chars)",
        ),
      task_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Tickets whose board status proves completion. Attach later with update_work_chain_item(add_task_ids) if they do not exist yet.",
        ),
      after_task_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Prerequisite tickets — item stays WAITING until all are DONE",
        ),
      after_item_ids: z
        .array(z.string())
        .optional()
        .describe("Prerequisite chain items (ids from get_work_chain)"),
      mission_label: z
        .string()
        .optional()
        .describe(
          "Implicit-mission label to hang this item on. Matching uses missionLabelKey (same as dispatch mission_label). Board tickets in that bundle prove completion together with task_ids. 0 tickets = unsplit, not done. Does not start the mission engine.",
        ),
      done_when: z
        .enum(["exists", "review", "done"])
        .optional()
        .describe(
          "When linked tickets count as reached: exists (ticket was created), review (REVIEW or DONE), done (DONE, default)",
        ),
      note: z.string().optional().describe("Free-form context"),
      position: z
        .number()
        .int()
        .optional()
        .describe("Insert index (0 = do this first). Default: append"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({
      what,
      why,
      task_ids,
      after_task_ids,
      after_item_ids,
      mission_label,
      done_when,
      note,
      position,
      project_id,
    }) => {
      const projectId = await enforceProjectLock(
        "add_work_chain_item",
        project_id,
      );
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);
      const doneWhen: WorkChainDoneWhen | undefined =
        done_when && WORK_CHAIN_DONE_WHEN_VALUES.includes(done_when)
          ? done_when
          : undefined;
      const res = await addWorkChainItem(
        db,
        projectId,
        MARBLO_AGENT_ID,
        {
          what,
          why,
          ...(task_ids ? { taskIds: task_ids } : {}),
          ...(after_task_ids ? { afterTaskIds: after_task_ids } : {}),
          ...(after_item_ids ? { afterItemIds: after_item_ids } : {}),
          ...(mission_label ? { missionLabel: mission_label } : {}),
          ...(doneWhen ? { doneWhen } : {}),
          ...(note ? { note } : {}),
        },
        position,
      );
      if (res.error || !res.item)
        return text(`Error: ${res.error ?? "unknown"}`);
      const chain = await loadWorkChain(db, projectId);
      const evidenceNote =
        res.item.missionLabel && res.item.taskIds.length === 0
          ? `\n미션 '${res.item.missionLabel}' — 보드에 이 라벨 티켓이 아직 없다(unsplit). 같은 mission_label 로 dispatch 하면 진행률이 움직인다. 티켓 0개는 done 이 아니다.`
          : res.item.taskIds.length === 0
            ? "\n⚠️ 연결 티켓이 없다 — 이 항목은 보드가 완료를 판정할 수 없다. 티켓이 생기면 update_work_chain_item(item_id, add_task_ids=[...]) 로 붙여라. 티켓 없이 닫을 땐 close=self_reported + reason(근거) 이 필요하고 그 사실은 SELF-REPORTED 로 표시된다."
            : "";
      return text(
        `워크체인에 추가됨: '${res.item.what}' (id=${res.item.id}, rev=${res.rev})${evidenceNote}\n` +
          workChainFooter(chain.derived),
      );
    },
  );

  auditedTool(
    "update_work_chain_item",
    "Edit a work chain item: reword what/why, attach tickets (add_task_ids) so the board can judge completion, hang or clear a mission_label (same matching as dispatch), change prerequisites or done_when, move it (position), or close it. close=dropped needs reason (why it is no longer valid). close=self_reported is REFUSED for items linked to tickets or a mission_label — the board decides those; it is allowed only for ticket-less unlabeled items and needs reason (what you verified), and stays visibly marked SELF-REPORTED.",
    {
      item_id: z.string().describe("Chain item id (from get_work_chain)"),
      what: z.string().optional(),
      why: z.string().optional(),
      note: z.string().optional().describe("Replace note ('' clears)"),
      task_ids: z
        .array(z.string())
        .optional()
        .describe("Replace linked tickets"),
      add_task_ids: z
        .array(z.string())
        .optional()
        .describe(
          "Add linked tickets (e.g. the ticket you just created for this item)",
        ),
      after_task_ids: z.array(z.string()).optional(),
      after_item_ids: z.array(z.string()).optional(),
      mission_label: z
        .string()
        .optional()
        .describe(
          "Set or replace the implicit-mission label. Empty string clears it. Matching uses missionLabelKey.",
        ),
      done_when: z.enum(["exists", "review", "done"]).optional(),
      close: z
        .enum(["dropped", "self_reported"])
        .optional()
        .describe(
          "Close the item. dropped = no longer valid; self_reported = ticket-less item you verified yourself",
        ),
      reason: z
        .string()
        .optional()
        .describe(
          "Required with close: why dropped / what evidence for self_reported",
        ),
      reopen: z.boolean().optional().describe("Reopen a closed item"),
      position: z
        .number()
        .int()
        .optional()
        .describe("Move to index (0 = first)"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({
      item_id,
      what,
      why,
      note,
      task_ids,
      add_task_ids,
      after_task_ids,
      after_item_ids,
      mission_label,
      done_when,
      close,
      reason,
      reopen,
      position,
      project_id,
    }) => {
      const projectId = await enforceProjectLock(
        "update_work_chain_item",
        project_id,
      );
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);
      const res = await updateWorkChainItem(
        db,
        projectId,
        MARBLO_AGENT_ID,
        item_id,
        {
          ...(what !== undefined ? { what } : {}),
          ...(why !== undefined ? { why } : {}),
          ...(note !== undefined ? { note } : {}),
          ...(task_ids !== undefined ? { taskIds: task_ids } : {}),
          ...(add_task_ids !== undefined ? { addTaskIds: add_task_ids } : {}),
          ...(after_task_ids !== undefined
            ? { afterTaskIds: after_task_ids }
            : {}),
          ...(after_item_ids !== undefined
            ? { afterItemIds: after_item_ids }
            : {}),
          ...(mission_label !== undefined
            ? { missionLabel: mission_label }
            : {}),
          ...(done_when !== undefined ? { doneWhen: done_when } : {}),
          ...(close !== undefined ? { close } : {}),
          ...(reason !== undefined ? { reason } : {}),
          ...(reopen !== undefined ? { reopen } : {}),
          ...(position !== undefined ? { position } : {}),
        },
      );
      if (res.error || !res.item)
        return text(`Error: ${res.error ?? "unknown"}`);
      const chain = await loadWorkChain(db, projectId);
      const mine = chain.derived.items.find((d) => d.item.id === item_id);
      const stateLine = mine
        ? `상태: ${mine.state}${
            mine.evidence ? ` (evidence=${mine.evidence})` : ""
          }`
        : "";
      return text(
        `워크체인 항목 갱신됨: '${res.item.what}' (id=${res.item.id}, rev=${res.rev}). ${stateLine}\n` +
          workChainFooter(chain.derived),
      );
    },
  );

  // ── ★워크체인 노이즈 일괄 정리 (티켓 GvgBoZ5ajEKTT7G5rWME) ──────────────
  // 2026-09-04: 열린 82 / 닫힌 118 로 한도(당시엔 전체 길이 200)가 차서
  // create_task · send_telegram_message 가 실패했다 = **사장님 지시가 기록되지
  // 못했다.** 한도는 열린 항목 기준으로 고쳤고(§planWorkChainCapacity), 포착기는
  // 좁혔다(§hasCaptureSubstance). 이 도구는 **이미 쌓인** 노이즈를 치운다.
  // 판정은 "오늘의 감지기에 원문을 다시 넣어 본다" 하나뿐이고, 사장님 지시와
  // 근거 티켓이 붙은 항목은 구조적으로 대상이 될 수 없다.
  auditedTool(
    "prune_work_chain_noise",
    "One-time cleanup of auto-captured work chain noise. Re-runs today's (narrowed) capture rules over each OPEN auto-captured item: anything that would no longer be captured, plus duplicate-sentence items, is closed as dropped. NEVER touches owner missions (source=owner), manually added items (source=manual), or any item with linked tickets / mission_label / prerequisites — those are structurally excluded. Always returns the exact list of what it closed. Run with dry_run=true first to see the list.",
    {
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "Only list what would be closed, change nothing (default: true — you must pass false to actually close)",
        ),
      limit: z
        .number()
        .int()
        .optional()
        .describe("Cap how many items to close in one call (default: no cap)"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
    },
    async ({ dry_run, limit, project_id }) => {
      const projectId = await enforceProjectLock(
        "prune_work_chain_noise",
        project_id,
      );
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);
      const snap = await readWorkChain(db, projectId);
      const plan = planAutoNoisePrune(snap.items);
      if (typeof limit === "number" && limit > 0) {
        plan.prune = plan.prune.slice(0, limit);
        plan.kept = plan.scannedOpen - plan.prune.length;
      }
      // ★기본은 dry-run 이다. 일괄 삭제는 되돌리기 어려우므로 명시적으로
      //   dry_run=false 를 받아야 실제로 닫는다.
      const apply = dry_run === false;
      if (!apply || plan.prune.length === 0) {
        return text(
          formatNoisePrunePlan(plan, false) +
            (plan.prune.length
              ? "\n\n실제로 닫으려면 prune_work_chain_noise(dry_run=false) 로 다시 불러라."
              : ""),
        );
      }
      const closed: string[] = [];
      const failed: string[] = [];
      for (const entry of plan.prune) {
        const res = await updateWorkChainItem(
          db,
          projectId,
          MARBLO_AGENT_ID,
          entry.id,
          { close: "dropped", reason: entry.reason },
        );
        if (res.error) failed.push(`${entry.id}: ${res.error}`);
        else closed.push(entry.id);
      }
      const after = await loadWorkChain(db, projectId);
      return text(
        formatNoisePrunePlan(plan, true) +
          `\n\n닫은 항목 ${closed.length}개${
            failed.length
              ? `, 실패 ${failed.length}개:\n  ${failed.join("\n  ")}`
              : ""
          }\n` +
          `정리 후 열린 항목: ${after.derived.open.length}개\n` +
          workChainFooter(after.derived),
      );
    },
    { userFacing: false },
  );

  // 20. add_pending_instruction — Queue a new-instruction for delivery to an
  //     agent's PTY on whatever machine currently hosts it. Used when the
  //     caller is not on the same machine as the target agent (team chat
  //     @mention, remote kanban operation, etc.), or as a robust fallback
  //     when same-machine direct PTY write is unavailable.
  auditedTool(
    "add_pending_instruction",
    "Queue a new-instruction for delivery to an agent's PTY across machines. The marblo app hosting the agent picks it up via a Firestore listener and injects it into the PTY's stdin. Use for cross-machine team scenarios where direct PTY write is not possible.",
    {
      task_id: z
        .string()
        .optional()
        .describe(
          "Task ID this instruction relates to. Omit for task-less directives (e.g. orchestrator-level commands).",
        ),
      target_agent_id: z
        .string()
        .describe("Agent ID whose PTY should receive the instruction"),
      message: z.string().describe("Instruction text to inject into PTY stdin"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Required when task_id is omitted; otherwise inferred from the task document.",
        ),
      source_type: z
        .enum(["kanban", "chat", "orchestrator", "other"])
        .optional()
        .describe("Where the instruction originated (default: 'other')"),
      from_user_id: z
        .string()
        .optional()
        .describe(
          "Deprecated/ignored. The server records the authenticated Firebase uid.",
        ),
      from_user_name: z
        .string()
        .optional()
        .describe("Display name of the initiating user"),
    },
    async ({
      task_id,
      target_agent_id,
      message,
      project_id,
      source_type,
      from_user_name,
    }) => {
      // Resolve project: the task's own projectId is authoritative, but an
      // explicit project_id that disagrees with it used to be dropped without a
      // word — the caller believed they had pinned the project when they had
      // not. Validate the argument against the task instead of ignoring it.
      let projectId = "";
      if (task_id) {
        const task = await fetchTask(task_id);
        if (!task) return text(`Error: Task ${task_id} not found.`);
        projectId = task.projectId;
        const arg = (project_id ?? "").trim();
        if (arg && arg !== projectId) {
          throw new ProjectLockError(
            `project_id="${arg}" 가 task ${task_id} 의 실제 프로젝트` +
              `(${projectId})와 다릅니다.\n` +
              `해야 할 일 — project_id 를 생략해 태스크의 프로젝트를 따르거나, ` +
              `의도한 프로젝트의 태스크 ID 를 넘기세요.`,
            "mismatch",
          );
        }
      }
      if (!projectId) {
        projectId = await enforceProjectLock(
          "add_pending_instruction",
          project_id,
        );
      }
      if (!projectId) {
        return text(
          "Error: projectId could not be resolved. Pass project_id or set MARBLO_PROJECT.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);

      const callerUid = getCurrentAuthUid();
      if (!callerUid) {
        return text("Error: Firebase auth is not ready for send_instruction.");
      }
      const localAgent = await findLocalBridgeAgent(projectId, target_agent_id);
      const ref = await addDoc(collection(db, "pendingInstructions"), {
        projectId,
        taskId: task_id ?? null,
        targetAgentId: target_agent_id,
        message,
        fromUserId: callerUid,
        fromUserName: from_user_name || "",
        sourceType: source_type || "other",
        isDelivered: false,
        createdAt: Timestamp.now(),
        deliveredAt: null,
      });
      const listenerLine =
        localAgent.state === "found"
          ? `listener=local agent_status=${
              localAgent.agent.status ?? "unknown"
            }`
          : localAgent.state === "not_found"
            ? "listener=no_listener (not hosted by this Marblo app; a teammate's app may still deliver it if signed in as a project member)"
            : `listener=unknown (${localAgent.error})`;
      const status =
        localAgent.state === "not_found" ? "queued/no_listener" : "queued";
      return text(
        `Pending instruction ${status}: ${ref.id}\n` +
          `status=${status}\n` +
          `instruction_id=${ref.id}\n` +
          `project=${projectId}\n` +
          `target_agent=${target_agent_id}\n` +
          `${listenerLine}\n` +
          `verify_with=get_pending_instructions(target_agent_id="${target_agent_id}", project_id="${projectId}", include_delivered=true)`,
      );
    },
  );

  // 21. get_pending_instructions — Fetch pending instructions for a given
  //     agent. The marblo app on each machine drains its local agents'
  //     queues via an onSnapshot listener (preferred) or this tool.
  auditedTool(
    "get_pending_instructions",
    "Fetch pending instructions for an agent. By default returns only undelivered entries, ordered oldest-first.",
    {
      target_agent_id: z
        .string()
        .describe("Agent ID whose pending queue to drain"),
      include_delivered: z
        .boolean()
        .optional()
        .describe("Include already-delivered entries (default: false)"),
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      limit: z
        .number()
        .optional()
        .describe("Max entries to return (default: 50)"),
    },
    async ({ target_agent_id, include_delivered, project_id, limit }) => {
      const projectId = await enforceProjectLock(
        "get_pending_instructions",
        project_id,
      );
      if (!projectId) {
        return text(
          "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.",
        );
      }
      const membership = await requireReadableProjectMember(projectId);
      if (!membership.ok) return text(membership.message);
      const extra: QueryConstraint[] = include_delivered
        ? []
        : [where("isDelivered", "==", false)];
      const q = query(
        collection(db, "pendingInstructions"),
        where(
          "projectId",
          "==",
          requireProjectScope(
            "pendingInstructions",
            projectId,
            "get_pending_instructions",
          ),
        ),
        where("targetAgentId", "==", target_agent_id),
        ...extra,
      );
      const snap = await getDocs(q);

      if (snap.empty)
        return text(
          `No pending instructions for target_agent=${target_agent_id} in project=${projectId}.`,
        );

      const max = typeof limit === "number" && limit > 0 ? limit : 50;
      const docs = snap.docs
        .map((d) => ({ ...(d.data() as PendingInstructionDoc), id: d.id }))
        .sort((a, b) => {
          const at = a.createdAt?.toMillis?.() ?? 0;
          const bt = b.createdAt?.toMillis?.() ?? 0;
          return at - bt;
        })
        .slice(0, max);

      const lines = docs.map((d) => {
        const delivered = d.isDelivered ? " [delivered]" : "";
        const who = d.fromUserName || d.fromUserId || "system";
        const src = d.sourceType || "other";
        return `- ${d.id} (project=${projectId}, from=${who}, src=${src})${delivered}: ${d.message}`;
      });
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // 22. mark_instruction_delivered — Flip `isDelivered` to true after the
  //     marblo app has successfully injected the instruction into the PTY.
  //     This is the only mutation security rules permit on existing
  //     pendingInstructions documents (besides creation).
  auditedTool(
    "mark_instruction_delivered",
    "Mark a pending instruction as delivered. Called by the marblo app after successful PTY stdin injection.",
    {
      instruction_id: z.string().describe("Pending instruction document ID"),
    },
    async ({ instruction_id }) => {
      const ref = doc(db, "pendingInstructions", instruction_id);
      const snap = await getDoc(ref);
      if (!snap.exists())
        return text(`Error: Pending instruction ${instruction_id} not found.`);
      const data = snap.data();
      if (data.isDelivered) {
        return text(`Instruction ${instruction_id} already delivered.`);
      }
      await updateDoc(ref, {
        isDelivered: true,
        deliveredAt: Timestamp.now(),
      });
      return text(`Instruction ${instruction_id} marked as delivered.`);
    },
  );

  // ── 22.5 타입드 질문 채널 (P5-1) ─────────────────────────────────
  //
  // 왜 add_activity 로 충분하지 않은가: 질문·진행보고·완료보고가 한 평문
  // 스트림에 섞이고, 질문 id 도 "답변 대기" 상태도 없어 답을 질문에 이을 수
  // 없으며, 오케 PTY 로 나갈 때 300자에서 잘려 긴 질의는 몸통이 사라졌다.
  // 여기서는 질문에 id 를 주고(ask_orchestrator), 답을 그 id 로 잇고
  // (answer_question), 상태를 티켓(tasks/{id}.questions)에 남긴다.
  // 순수 로직(상관키/용량/포맷)은 ./question-channel.ts.

  /** 질문 배열을 트랜잭션으로 갱신한다(동시 질문/답변이 서로를 덮지 않게). */
  async function mutateQuestions(
    taskId: string,
    mutate: (current: QuestionEntry[]) => QuestionEntry[] | null,
  ): Promise<boolean> {
    return runTransaction(db, async (tx) => {
      const ref = doc(db, "tasks", taskId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const current = readQuestions(
        (snap.data() as Record<string, unknown>).questions,
      );
      const next = mutate(current);
      if (!next) return false;
      tx.update(ref, {
        questions: next,
        // 스칼라 미러 — 보드/오케가 배열을 열지 않고도 "미답 질문 있음"을 본다.
        openQuestionCount: openQuestions(next).length,
      });
      return true;
    });
  }

  /**
   * 답변을 질문자 PTY 로 보내는 하드닝된 전달 경로(P5-2). answer_question 과
   * 승인 결과 회신(resolve_model_escalation)이 **같은 함수**를 쓴다 — 두 벌로
   * 두면 한쪽만 하드닝되는 일이 반드시 생긴다.
   */
  async function queueAnswerDelivery(input: {
    task: TaskDoc;
    taskId: string;
    questionId: string;
    question: string;
    answer: string;
    answeredBy: string;
    target: string;
  }): Promise<{ delivery: "queued" | "failed"; note: string }> {
    const callerUid = getCurrentAuthUid();
    if (!callerUid) {
      return {
        delivery: "failed",
        note: "Firebase auth 미준비로 전달 큐에 넣지 못했습니다.",
      };
    }
    try {
      const ref = await addDoc(collection(db, "pendingInstructions"), {
        projectId: input.task.projectId,
        taskId: input.taskId,
        targetAgentId: input.target,
        message: formatAnswerDelivery({
          questionId: input.questionId,
          taskId: input.taskId,
          question: input.question,
          answer: input.answer,
          answeredBy: input.answeredBy,
        }),
        fromUserId: callerUid,
        fromUserName: "",
        sourceType: "orchestrator",
        isDelivered: false,
        createdAt: Timestamp.now(),
        deliveredAt: null,
      });
      return {
        delivery: "queued",
        note: `전달 큐 등록됨(instruction=${ref.id}, target=${input.target}).`,
      };
    } catch (err) {
      return {
        delivery: "failed",
        note: `전달 큐 등록 실패: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  /**
   * Slack 아웃바운드(브리지 경유). `sendTelegramViaBridge` 의 미러 —
   * 봇 토큰은 이 경계를 넘지 않고, 에러 문자열은 poller 가 이미 토큰 스크럽한
   * 것이다. threadTs 를 넘기면 물어본 스레드에 답장이 달린다.
   */
  async function sendSlackViaBridge(
    projectId: string,
    messageText: string,
    channelId?: string,
    threadTs?: string,
  ): Promise<{
    ok: boolean;
    channel?: string;
    threadTs?: string;
    error?: string;
  }> {
    const bridgePort = process.env.MARBLO_BRIDGE_PORT;
    if (!bridgePort) {
      return {
        ok: false,
        error: "MARBLO_BRIDGE_PORT not set. Bridge server not available.",
      };
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${bridgePort}/send-slack-message`,
        {
          method: "POST",
          headers: bridgeHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({
            projectId,
            text: messageText,
            channelId,
            threadTs,
          }),
        },
      );
      return (await response.json()) as {
        ok: boolean;
        channel?: string;
        threadTs?: string;
        error?: string;
      };
    } catch (err) {
      return {
        ok: false,
        error: err instanceof Error ? err.message : "network error",
      };
    }
  }

  /**
   * ★고비용 칸(max/ultra) 게이트 — `dispatch_task` 가 스폰 전에 부른다.
   *
   * "승인이 있으면 통과, 없으면 강등" 을 판정만 하고 소진은 하지 않는다(스폰이
   * 실패했는데 1회용 승인이 타버리면 사장님을 또 깨워야 한다). 소진은 bridge 가
   * 성공을 돌려준 뒤에 한다.
   */
  async function gateDispatchEffort(
    taskId: string | undefined,
    effort: string,
    requestedModel: string | undefined,
  ): Promise<{ approvedQuestionId?: string; reason: string }> {
    if (!taskId) {
      return {
        reason: `effort "${effort}" 는 사용자 승인이 필요한 고비용 칸인데, 이 dispatch 엔 task_id 가 없어 승인 레코드를 확인할 수 없습니다(승인은 티켓 단위).`,
      };
    }
    const task = await fetchTask(taskId);
    if (!task) {
      return {
        reason: `effort "${effort}" 승인을 확인하려 했지만 티켓 ${taskId} 를 찾지 못했습니다.`,
      };
    }
    const records = readEscalationApprovals(
      (task as unknown as Record<string, unknown>).modelEscalations,
    );
    const approval = usableApprovalLoose(records, requestedModel, effort);
    if (approval) {
      return { approvedQuestionId: approval.questionId, reason: "" };
    }
    return {
      reason: `effort "${effort}" 는 사용자 승인이 필요한 고비용 칸이고, 티켓 ${taskId} 에 ${
        requestedModel ? `${stripEffortSuffix(requestedModel)} 용 ` : ""
      }미소진 승인이 없습니다(승인 예산 사용 ${approvalBudgetSpent(
        records,
      )}/${MAX_GATED_APPROVALS_PER_TASK}).`,
    };
  }

  /** 승인 레코드 배열을 트랜잭션으로 갱신한다(동시 요청/결정이 서로를 덮지 않게). */
  async function mutateEscalations(
    taskId: string,
    mutate: (
      current: EscalationApprovalRecord[],
    ) => EscalationApprovalRecord[] | null,
  ): Promise<boolean> {
    return runTransaction(db, async (tx) => {
      const ref = doc(db, "tasks", taskId);
      const snap = await tx.get(ref);
      if (!snap.exists()) return false;
      const current = readEscalationApprovals(
        (snap.data() as Record<string, unknown>).modelEscalations,
      );
      const next = mutate(current);
      if (!next) return false;
      tx.update(ref, { modelEscalations: next });
      return true;
    });
  }

  // 23. ask_orchestrator — 에이전트가 오케에 타입드 질문을 던진다.
  auditedTool(
    "ask_orchestrator",
    "Ask the orchestrator a question through the typed Q&A channel. Returns a question_id; the orchestrator replies with answer_question(question_id, answer) and the answer is delivered back to this agent's PTY. The full question text is forwarded (no 300-char truncation) and the open/answered state is kept on the ticket.",
    {
      task_id: z.string().describe("Task ID this question belongs to"),
      question: z
        .string()
        .describe(
          "Question body — full text. Say what you need, why, and what is blocked without it.",
        ),
      blocking: z
        .boolean()
        .optional()
        .describe(
          "true only when work genuinely cannot proceed without the answer (default false — keep working on the rest).",
        ),
      agent_id: z
        .string()
        .optional()
        .describe("Asking agent id (defaults to this MCP session's agent)"),
    },
    async ({ task_id, question, blocking, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);
      const body = question.trim();
      if (!body) return text("Error: question 이 비어 있습니다.");

      const clamped = clampQuestionText(body);
      const askedBy = agent_id || MARBLO_AGENT_ID;
      const seed = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      // P5-3 판정 — 이 질문을 오케가 답할 수 있나, 사장님께 올려야 하나.
      // ★힌트일 뿐이고 최종 판단은 오케가 한다(escalation-policy.ts 참조).
      const verdict = classifyQuestionAudience(clamped.value);
      const entry: QuestionEntry = {
        id: newQuestionId(task_id, seed),
        question: clamped.value,
        status: "open",
        askedBy: askedBy === "unknown" ? "" : askedBy,
        askedAt: Date.now(),
        blocking: blocking === true,
        audience: verdict.audience,
      };

      const stored = await mutateQuestions(task_id, (cur) =>
        appendQuestion(cur, entry),
      );
      if (!stored) {
        return text(
          `Error: 질문을 티켓 ${task_id} 에 기록하지 못했습니다(태스크 없음).`,
        );
      }

      // 타임라인에도 남긴다 — 보드에서 "이 티켓은 답을 기다리는 중"이 보이도록.
      try {
        await applyProjection(db, task_id, {
          lastAgentId: attributionAgentId(agent_id),
          lastActivitySummary: `[질문] ${entry.question.slice(0, 200)}`,
          activityPayload: {
            agentId: entry.askedBy || "unknown",
            message: `[질문 ${entry.id}] ${entry.question}`,
          },
        });
      } catch (err) {
        // 타임라인 기록 실패가 질문 자체를 무효화하지는 않는다(질문은 이미 저장됨).
        console.error("[ask_orchestrator] activity write failed:", err);
      }

      // 오케 PTY 로 전문 전달. lane 도 게이트하지 않는다 — 질문은 진행 잡음이
      // 아니라 응답이 필요한 이벤트고, 막힌 에이전트가 조용히 노는 것이 정확히
      // 이 채널이 막으려는 실패다.
      const roleLabel = formatAgentTaskRoleLabel(
        task.role,
        await fetchAgentRole(entry.askedBy),
      );
      const notify = await notifyOrchestratorAwaited(
        formatQuestionNotification({
          questionId: entry.id,
          taskId: task_id,
          taskTitle: task.title,
          askedBy: entry.askedBy || "unknown",
          roleLabel,
          question: entry.question,
          blocking: entry.blocking,
          audienceHint: formatAudienceHint(verdict, entry.id),
        }),
        task.contextId,
      );

      const truncNote = clamped.truncated
        ? `\n⚠️ 질문이 ${clamped.originalLength}자라 ${MAX_QUESTION_CHARS}자에서 잘렸습니다 — 나머지는 나눠서 다시 물어보세요.`
        : "";
      const deliveryNote = notify.injected
        ? "오케스트레이터 PTY 로 전달됨."
        : `⚠️ 오케 PTY 주입 실패(${notify.error}). 질문은 티켓에 open 으로 남아 있으니 오케가 get_open_questions 로 회수할 수 있습니다.`;
      return text(
        `질문 등록: question_id=${entry.id} (status=open${
          entry.blocking ? ", blocking" : ""
        }, 판정=${verdict.audience}/${
          verdict.rule
        })\n${deliveryNote}${truncNote}\n답이 오면 이 에이전트 PTY 로 자동 주입됩니다. 그 사이 무관한 잔여 작업은 계속하세요.`,
      );
    },
  );

  // 24. answer_question — 오케가 질문에 답하고, 그 답을 질문자에게 되돌린다.
  auditedTool(
    "answer_question",
    "Answer a question raised via ask_orchestrator. Correlates by question_id, flips the ticket entry to answered, and queues the full answer for delivery into the asking agent's PTY (hardened delivery: retried, and explicitly reported if it cannot be delivered).",
    {
      question_id: z
        .string()
        .describe("question_id returned by ask_orchestrator"),
      answer: z.string().describe("Answer body — full text."),
      task_id: z
        .string()
        .optional()
        .describe(
          "Task ID (optional — inferred from question_id, which embeds it)",
        ),
    },
    async ({ question_id, answer, task_id }) => {
      const body = answer.trim();
      if (!body) return text("Error: answer 가 비어 있습니다.");
      const parsed = parseQuestionId(question_id);
      const taskId = task_id || parsed.taskId;
      if (!taskId) {
        return text(
          `Error: question_id "${question_id}" 에서 task 를 알 수 없습니다. task_id 를 함께 주세요.`,
        );
      }
      const task = await fetchTask(taskId);
      if (!task) return text(`Error: Task ${taskId} not found.`);

      const clamped = clampQuestionText(body);
      const answeredBy = MARBLO_AGENT_ID || "orchestrator";
      // 콜백에서 채우는 결과 홀더 — 트랜잭션의 성공/실패와 별개로 "왜 실패했나"를
      // 밖으로 들고 나와야 호출자에게 사실대로 답할 수 있다.
      const outcome: {
        entry: QuestionEntry | null;
        failure: "not-found" | "already-answered" | null;
      } = { entry: null, failure: null };

      const applied = await mutateQuestions(taskId, (cur) => {
        const res = answerQuestion(
          cur,
          question_id,
          clamped.value,
          answeredBy,
          Date.now(),
        );
        if (!res.ok) {
          outcome.failure = res.reason;
          outcome.entry = res.entry ?? null;
          return null;
        }
        outcome.entry = res.entry;
        return res.entries;
      });

      if (!applied) {
        if (outcome.failure === "already-answered") {
          const prev = outcome.entry;
          return text(
            `Question ${question_id} 은 이미 답변됨(${
              prev?.answeredBy ?? "unknown"
            }). ` +
              `덮어쓰지 않았습니다 — 정정이 필요하면 새 지시를 add_pending_instruction 으로 보내세요.\n` +
              `기존 답: ${prev?.answer ?? ""}`,
          );
        }
        return text(
          `Error: question_id ${question_id} 를 티켓 ${taskId} 에서 찾지 못했습니다. get_open_questions(task_id="${taskId}") 로 확인하세요.`,
        );
      }

      const entry = outcome.entry;
      const target = entry?.askedBy ?? "";
      if (!target) {
        await mutateQuestions(taskId, (cur) =>
          markAnswerDelivery(cur, question_id, "failed"),
        );
        return text(
          `답변 기록 완료(question_id=${question_id}) — 다만 질문자 agent id 가 비어 있어 PTY 로 전달하지 못했습니다. ` +
            `대상 에이전트를 확인해 add_pending_instruction 으로 직접 보내세요.`,
        );
      }

      // 전달은 하드닝된 pendingInstructions 경로를 탄다: 호스트 앱의 리스너가
      // 현재 PTY 로 재시도하고, 끝내 실패하면 오케에 명시 보고한다(P5-2).
      const { delivery, note: deliveryNote } = await queueAnswerDelivery({
        task,
        taskId,
        questionId: question_id,
        question: entry?.question ?? "",
        answer: clamped.value,
        answeredBy,
        target,
      });

      await mutateQuestions(taskId, (cur) =>
        markAnswerDelivery(cur, question_id, delivery),
      );

      try {
        await applyProjection(db, taskId, {
          // 답변자는 오케다 — attributionAgentId 규칙대로 담당자 귀속은 건드리지
          // 않고(""), 직전 실제 작업자를 보존한다.
          lastAgentId: "",
          lastActivitySummary: `[답변] ${clamped.value.slice(0, 200)}`,
          activityPayload: {
            agentId: answeredBy,
            message: `[답변 ${question_id}] ${clamped.value}`,
          },
        });
      } catch (err) {
        console.error("[answer_question] activity write failed:", err);
      }

      const truncNote = clamped.truncated
        ? `\n⚠️ 답변이 ${clamped.originalLength}자라 ${MAX_QUESTION_CHARS}자에서 잘렸습니다.`
        : "";
      // ★자동 포착 — 답변 안의 "A 끝나면 B 는 내가 한다" 는 오케 자신의 다음 할
      // 일이다. 답을 보내면 그 약속은 워커의 PTY 로 사라진다.
      const answerCapture = await captureChainPromiseNote(
        "answer",
        "answer_question",
        body,
        { projectId: task.projectId, contextTaskId: taskId },
      );
      return text(
        withCaptureNote(
          `Question ${question_id} answered. ${deliveryNote}${truncNote}`,
          answerCapture,
        ),
      );
    },
  );

  // 25. get_open_questions — 오케가 놓친 질문을 되찾는 복구 경로.
  //     PTY 알림은 유실될 수 있지만 티켓의 질문 상태는 남는다.
  auditedTool(
    "get_open_questions",
    "List questions raised via ask_orchestrator. Without task_id it scans the project's open tasks — use it to recover questions whose PTY notification was missed.",
    {
      task_id: z
        .string()
        .optional()
        .describe("Limit to one task (otherwise scans the project)"),
      include_answered: z
        .boolean()
        .optional()
        .describe("Include answered questions (default: false)"),
      project_id: z.string().optional().describe("Project ID"),
    },
    async ({ task_id, include_answered, project_id }) => {
      const wantAll = include_answered === true;
      const render = (t: TaskDoc, entries: QuestionEntry[]): string[] =>
        entries
          .filter((q) => wantAll || q.status === "open")
          .map((q) => formatQuestionLine(q, t.title));

      if (task_id) {
        const task = await fetchTask(task_id);
        if (!task) return text(`Error: Task ${task_id} not found.`);
        const entries = readQuestions(
          (task as unknown as Record<string, unknown>).questions,
        );
        const lines = render(task, entries);
        return text(
          lines.length ? lines.join("\n") : "질문이 없습니다(open 기준).",
        );
      }

      const projectId = await enforceProjectLock(
        "get_open_questions",
        project_id,
      );
      const constraints: QueryConstraint[] = [];
      // openQuestionCount 는 질문이 처음 달릴 때 생기는 필드라, 이 조건은
      // 질문이 하나라도 있었던 티켓만 읽는다(질문 없는 보드는 0 doc read).
      const snap = await boundedGetDocs(
        "tasks",
        projectId,
        constraints,
        [where("openQuestionCount", ">", 0)],
        "get_open_questions",
      );
      const lines: string[] = [];
      for (const d of snap.docs) {
        const t = { id: d.id, ...d.data() } as TaskDoc;
        if (t.deleted) continue;
        lines.push(
          ...render(
            t,
            readQuestions((d.data() as Record<string, unknown>).questions),
          ),
        );
      }
      return text(lines.length ? lines.join("\n") : "미답 질문이 없습니다.");
    },
    { userFacing: false },
  );

  // ── 22.6 사장님 왕복 + 고비용 모델 승인 게이트 (P5-3 / P3-1) ──────────
  //
  // 설계문서 §6 갭 ④: 질문 채널은 있는데 "누가 답할 질문인가" 를 정하는 규칙이
  // 없었다. 판정 자체는 `escalation-policy.ts`(순수) 가 하고, 여기서는 그 판정에
  // 따른 두 경로를 배관한다 — 사장님께 올리기(escalate_to_owner)와, 고비용 칸을
  // 쓰기 위한 승인 왕복(request_model_escalation / resolve_model_escalation).
  //
  // ★새 배관은 만들지 않았다: 질문 저장은 P5-1 질문채널, 회신은 P5-2 하드닝된
  //   pendingInstructions 큐, 사장님 전달은 기존 텔레그램 아웃바운드다.

  // 26. escalate_to_owner — 오케가 답할 수 없는 질문을 사장님께 올린다.
  auditedTool(
    "escalate_to_owner",
    "Escalate an open question to the owner (사장님) over Telegram, for the cases the orchestrator cannot answer: product judgment, cost/billing decisions, approval of irreversible or outward-facing actions, anything the orchestrator cannot observe (screenshots/live screens), and arbitration of contradictory instructions. The full question text is sent (no 300-char truncation). The owner's reply comes back to the orchestrator, which then calls answer_question so the asking agent receives it. Use ask_orchestrator's routing hint as a guide, not an authority — if you can answer from the codebase or ticket, answer instead.",
    {
      question_id: z
        .string()
        .describe(
          "question_id from ask_orchestrator / request_model_escalation",
        ),
      note: z
        .string()
        .optional()
        .describe(
          "Orchestrator's note for the owner — what you already checked and what exactly you need decided.",
        ),
      chat_id: z
        .string()
        .optional()
        .describe(
          "Telegram chat id (defaults to the project's last inbound chat)",
        ),
    },
    async ({ question_id, note, chat_id }) => {
      const parsed = parseQuestionId(question_id);
      if (!parsed.taskId) {
        return text(
          `Error: question_id "${question_id}" 에서 task 를 알 수 없습니다.`,
        );
      }
      const taskId = parsed.taskId;
      const task = await fetchTask(taskId);
      if (!task) return text(`Error: Task ${taskId} not found.`);
      const entries = readQuestions(
        (task as unknown as Record<string, unknown>).questions,
      );
      const entry = entries.find((q) => q.id === question_id);
      if (!entry) {
        return text(
          `Error: question_id ${question_id} 를 티켓 ${taskId} 에서 찾지 못했습니다. get_open_questions 로 확인하세요.`,
        );
      }
      if (entry.status === "answered") {
        return text(
          `Question ${question_id} 은 이미 답변됐습니다(${
            entry.answeredBy ?? "unknown"
          }). 사장님을 깨우지 않았습니다.`,
        );
      }

      const body = clampForTelegram(
        formatOwnerEscalation({
          questionId: question_id,
          taskId,
          taskTitle: task.title,
          askedBy: entry.askedBy,
          question: entry.question,
          verdict: classifyQuestionAudience(entry.question),
          note,
        }),
      );
      const sent = await sendTelegramViaBridge(
        task.projectId,
        body.value,
        chat_id,
      );

      // 전달 성공/실패를 **둘 다** 티켓에 남긴다. 실패를 숨기면 "사장님께
      // 올렸다" 는 기록만 남고 답은 영원히 오지 않는다(§6 갭 ③ 과 같은 부류).
      await mutateQuestions(taskId, (cur) =>
        markOwnerEscalation(cur, question_id, {
          at: Date.now(),
          by: MARBLO_AGENT_ID || "orchestrator",
          delivery: sent.ok ? "sent" : "failed",
          ...(sent.ok ? (note ? { note } : {}) : { note: sent.error ?? "" }),
        }),
      );

      try {
        await applyProjection(db, taskId, {
          lastAgentId: "",
          lastActivitySummary: `[사장님 승격] ${question_id} ${
            sent.ok ? "전달됨" : "전달실패"
          }`,
          activityPayload: {
            agentId: MARBLO_AGENT_ID || "orchestrator",
            message:
              `[사장님 승격 ${question_id}] ${
                sent.ok
                  ? "텔레그램 전달됨"
                  : `전달 실패: ${sent.error ?? "unknown"}`
              }` + (note ? `\n메모: ${note}` : ""),
          },
        });
      } catch (err) {
        console.error("[escalate_to_owner] activity write failed:", err);
      }

      if (!sent.ok) {
        return text(
          `사장님 전달 실패: ${sent.error ?? "unknown error"}\n` +
            `질문은 티켓에 open 으로 남아 있습니다. 텔레그램 채널이 없으면 사장님께 직접 여쭙고, 받은 답을 answer_question 으로 넣어 주세요(그래야 에이전트 PTY 로 전달됩니다).`,
        );
      }
      // ★자동 포착 — **2026-08-22 실패가 정확히 이 자리다.** 오케가 사장님께
      // "규칙을 한 번 더 배포해야 합니다 … 지금 그건 제 머릿속에만 있는 다음 할
      // 일입니다" 라고 보고해 놓고 add_work_chain_item 을 부르지 않았다. 그 문장은
      // 이미 이 도구의 note 인자로 들어왔었다 — 우리가 안 읽었을 뿐이다.
      // question 본문(=워커가 쓴 것)은 스캔하지 않는다. 오케 자신의 note 만이다.
      const escalationCapture = await captureChainPromiseNote(
        "owner_report",
        "escalate_to_owner",
        note,
        { projectId: task.projectId, contextTaskId: taskId },
      );
      return text(
        withCaptureNote(
          `사장님께 전달됨(chat ${
            sent.chatId ?? "default"
          }, question_id=${question_id})${
            body.truncated
              ? " ⚠️ 텔레그램 4096자 한도로 뒷부분이 잘렸습니다"
              : ""
          }.\n` +
            `사장님 답장은 '[Telegram inbound ...]' 로 도착합니다. 그 답을 answer_question(question_id="${question_id}", answer="...") 로 넣으면 질문한 에이전트 PTY 로 자동 전달됩니다.`,
          escalationCapture,
        ),
      );
    },
  );

  // 27. request_model_escalation — 고비용 칸(max/ultra)을 쓰기 위한 승인 요청.
  auditedTool(
    "request_model_escalation",
    `Request user approval to use a high-cost model rung. Only the gated rungs need this (currently ${GATED_LADDER_RUNGS.join(
      ", ",
    )}) — every other rung on the ladder is usable without asking. Returns a question_id; the orchestrator must get the USER's decision (escalate_to_owner, or ask in-app) and record it with resolve_model_escalation. Approval is single-use and the per-ticket budget is ${MAX_GATED_APPROVALS_PER_TASK}. Without an approval record the spawn path silently downgrades to the highest ungated rung, so these rungs never fire automatically.`,
    {
      task_id: z.string().describe("Task ID this escalation belongs to"),
      model: z
        .string()
        .describe(`Model id, e.g. ${GATED_LADDER_RUNGS[0].split("@")[0]}`),
      effort: z.string().describe("Gated reasoning effort: max or ultra"),
      reason: z
        .string()
        .describe(
          "Why the cheaper rungs are not enough — what was already tried and what failed. The user decides on this text.",
        ),
      agent_id: z
        .string()
        .optional()
        .describe("Requesting agent id (defaults to this MCP session's agent)"),
    },
    async ({ task_id, model, effort, reason, agent_id }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);
      const why = reason.trim();
      if (!why) {
        return text(
          "Error: reason 이 비어 있습니다 — 사용자가 판단할 근거 없이 고비용 칸을 승인할 수는 없습니다.",
        );
      }
      const spec = parseGatedRungSpec(model, effort);
      if (!spec.ok) {
        return text(
          spec.needsNoApproval
            ? `승인 불필요: ${spec.error}`
            : `Error: ${spec.error}`,
        );
      }

      const existing = readEscalationApprovals(
        (task as unknown as Record<string, unknown>).modelEscalations,
      );
      const already = usableApproval(existing, spec.model, spec.effort);
      if (already) {
        return text(
          `이미 승인된 미소진 건이 있습니다(question_id=${already.questionId}, ${spec.label}). 새 요청을 만들지 않았습니다 — 그 승인을 쓰세요.`,
        );
      }
      const pending = pendingRequestFor(existing, spec.model, spec.effort);
      if (pending) {
        return text(
          `이미 답을 기다리는 승인 요청이 있습니다(question_id=${pending.questionId}, ${spec.label}). 중복 요청으로 사장님을 두 번 깨우지 않습니다.`,
        );
      }
      const spent = approvalBudgetSpent(existing);
      if (spent >= MAX_GATED_APPROVALS_PER_TASK) {
        return text(
          `Error: 이 티켓의 고비용 승인 예산(${MAX_GATED_APPROVALS_PER_TASK}건)을 이미 소진했습니다(사용 ${spent}건). ` +
            `설계문서 §4 의 "상향은 티켓당 1회" 규칙과 같은 계정입니다 — 더 필요하면 티켓을 쪼개거나 사장님께 별도로 요청하세요.`,
        );
      }

      const requestedBy = agent_id || MARBLO_AGENT_ID;
      const seed = `${Date.now().toString(36)}${Math.random()
        .toString(36)
        .slice(2, 6)}`;
      const questionId = newQuestionId(task_id, seed);
      const questionBody = [
        `[고비용 모델 승인 요청] ${spec.label}`,
        "",
        `사유: ${why}`,
        "",
        `이 칸은 사용자 승인 없이는 쓰이지 않습니다(승인 없으면 사다리 하위 칸으로 강등). 승인은 1회용이며 티켓당 ${MAX_GATED_APPROVALS_PER_TASK}건입니다.`,
      ].join("\n");
      const clamped = clampQuestionText(questionBody);
      const entry: QuestionEntry = {
        id: questionId,
        question: clamped.value,
        status: "open",
        askedBy: requestedBy === "unknown" ? "" : requestedBy,
        askedAt: Date.now(),
        blocking: false,
        // 비용 결정은 §6-2 에 따라 언제나 사용자 몫이다 — 분류기를 돌리지 않고
        // owner 로 못박는다(오케가 자기 판단으로 승인해 버리는 길을 막는다).
        audience: "owner",
        approvalFor: spec.label,
      };
      const stored = await mutateQuestions(task_id, (cur) =>
        appendQuestion(cur, entry),
      );
      if (!stored) {
        return text(
          `Error: 승인 요청을 티켓 ${task_id} 에 기록하지 못했습니다(태스크 없음).`,
        );
      }
      const record: EscalationApprovalRecord = {
        questionId,
        model: spec.model,
        effort: spec.effort,
        decision: "pending",
        requestedBy: entry.askedBy,
        requestedAt: entry.askedAt,
        note: why,
      };
      const recorded = await mutateEscalations(task_id, (cur) => [
        ...cur,
        record,
      ]);
      if (!recorded) {
        return text(
          `Error: 승인 레코드를 티켓 ${task_id} 에 기록하지 못했습니다. 질문(${questionId})은 남아 있으니 다시 시도하세요.`,
        );
      }

      const notify = await notifyOrchestratorAwaited(
        formatApprovalRequest({
          questionId,
          taskId: task_id,
          taskTitle: task.title,
          requestedBy: entry.askedBy || "unknown",
          label: spec.label,
          reason: why,
          budgetSpent: spent,
        }),
        task.contextId,
      );

      try {
        await applyProjection(db, task_id, {
          lastAgentId: attributionAgentId(agent_id),
          lastActivitySummary: `[승인요청] ${spec.label}`,
          activityPayload: {
            agentId: entry.askedBy || "unknown",
            message: `[승인요청 ${questionId}] ${spec.label}\n${why}`,
          },
        });
      } catch (err) {
        console.error("[request_model_escalation] activity write failed:", err);
      }

      return text(
        `승인 요청 등록: question_id=${questionId} (${spec.label}, status=pending)\n` +
          (notify.injected
            ? "오케스트레이터 PTY 로 전달됨."
            : `⚠️ 오케 PTY 주입 실패(${notify.error}). 요청은 티켓에 open 으로 남아 있어 get_open_questions 로 회수됩니다.`) +
          `\n★승인이 오기 전까지 이 칸은 쓰이지 않습니다 — 승인 없이 갈 수 있는 칸으로 계속 진행하세요.`,
      );
    },
  );

  // 28. resolve_model_escalation — 오케가 **사용자의** 결정을 기록한다.
  auditedTool(
    "resolve_model_escalation",
    "Record the USER's decision on a request_model_escalation and send it back to the requesting agent. This tool does not make the decision — it writes down the one the user made, so ask first (escalate_to_owner or in-app) and pass decided_for so the audit trail says who decided. Approving writes a single-use approval record; denying leaves the per-ticket budget intact.",
    {
      question_id: z
        .string()
        .describe("question_id returned by request_model_escalation"),
      decision: z
        .enum(["approve", "deny"])
        .describe("The user's decision — not yours"),
      decided_for: z
        .string()
        .optional()
        .describe(
          "Who actually decided (e.g. '사장님'). Recorded separately from the orchestrator that writes it down.",
        ),
      note: z
        .string()
        .optional()
        .describe("The user's reasoning / conditions, verbatim if possible."),
    },
    async ({ question_id, decision, decided_for, note }) => {
      const parsed = parseQuestionId(question_id);
      if (!parsed.taskId) {
        return text(
          `Error: question_id "${question_id}" 에서 task 를 알 수 없습니다.`,
        );
      }
      const taskId = parsed.taskId;
      const task = await fetchTask(taskId);
      if (!task) return text(`Error: Task ${taskId} not found.`);

      const decidedBy = MARBLO_AGENT_ID || "orchestrator";
      const outcome: {
        record: EscalationApprovalRecord | null;
        failure: "not-found" | "already-decided" | "budget-exhausted" | null;
      } = { record: null, failure: null };
      const applied = await mutateEscalations(taskId, (cur) => {
        const res = decideApproval(
          cur,
          question_id,
          decision === "approve" ? "approved" : "denied",
          decidedBy,
          decided_for?.trim() || "",
          Date.now(),
          note?.trim() || undefined,
        );
        if (!res.ok) {
          outcome.failure = res.reason;
          outcome.record = res.record ?? null;
          return null;
        }
        outcome.record = res.record;
        return res.records;
      });

      if (!applied) {
        if (outcome.failure === "already-decided") {
          const prev = outcome.record;
          return text(
            `이 요청은 이미 ${
              prev?.decision === "approved" ? "승인" : "거부"
            }됐습니다(${prev?.decidedBy ?? "unknown"}${
              prev?.decidedFor ? `, 판단=${prev.decidedFor}` : ""
            }). 덮어쓰지 않았습니다 — 새 결정이 필요하면 새 요청을 받으세요.`,
          );
        }
        if (outcome.failure === "budget-exhausted") {
          return text(
            `Error: 승인 예산(티켓당 ${MAX_GATED_APPROVALS_PER_TASK}건)이 이미 소진돼 승인할 수 없습니다. 거부(deny)만 가능합니다.`,
          );
        }
        return text(
          `Error: question_id ${question_id} 에 해당하는 승인 요청이 티켓 ${taskId} 에 없습니다.`,
        );
      }

      const record = outcome.record!;
      const label = `${record.model}@${record.effort}`;
      const answerBody = formatApprovalDecision({
        label,
        decision: record.decision === "approved" ? "approved" : "denied",
        decidedFor: record.decidedFor,
        note: record.note,
      });

      // 질문도 함께 닫는다 — 승인 요청은 질문 채널의 질문이므로, 결정만 적고
      // 질문을 open 으로 남기면 오케가 같은 건을 또 사장님께 올린다.
      const entries = readQuestions(
        (task as unknown as Record<string, unknown>).questions,
      );
      const question = entries.find((q) => q.id === question_id);
      let answerNote = "";
      const closed = await mutateQuestions(taskId, (cur) => {
        const res = answerQuestion(
          cur,
          question_id,
          answerBody,
          decidedBy,
          Date.now(),
        );
        return res.ok ? res.entries : null;
      });
      if (!closed) {
        answerNote = " (질문은 이미 닫혀 있었습니다)";
      }

      const target = question?.askedBy ?? "";
      let deliveryNote =
        "요청자 agent id 가 비어 있어 PTY 전달은 생략했습니다.";
      if (target) {
        const res = await queueAnswerDelivery({
          task,
          taskId,
          questionId: question_id,
          question: question?.question ?? label,
          answer: answerBody,
          answeredBy: decidedBy,
          target,
        });
        deliveryNote = res.note;
        await mutateQuestions(taskId, (cur) =>
          markAnswerDelivery(cur, question_id, res.delivery),
        );
      }

      try {
        await applyProjection(db, taskId, {
          lastAgentId: "",
          lastActivitySummary: `[승인결정] ${label} ${record.decision}`,
          activityPayload: {
            agentId: decidedBy,
            message:
              `[승인결정 ${question_id}] ${label} → ${record.decision}` +
              (record.decidedFor ? ` (판단=${record.decidedFor})` : "") +
              (record.note ? `\n메모: ${record.note}` : ""),
          },
        });
      } catch (err) {
        console.error("[resolve_model_escalation] activity write failed:", err);
      }

      const budgetLine =
        record.decision === "approved"
          ? `승인 예산: 1/${MAX_GATED_APPROVALS_PER_TASK} 사용(1회용 — 스폰에 쓰이면 소진).`
          : "거부는 예산을 쓰지 않습니다.";
      return text(
        `${label} → ${record.decision}${
          record.decidedFor ? ` (판단=${record.decidedFor})` : ""
        }.${answerNote}\n${budgetLine}\n${deliveryNote}`,
      );
    },
  );

  // 23. run_skill — Mission engine 용 (명세 §8).
  //     allowlist 잠금된 gstack 슬래시 명령을 격리된 cc --print subprocess 로
  //     실행하고 결과를 반환한다.
  //     보안 락다운:
  //       - skill: zod enum (allowlist 외 거부)
  //       - args: shell 메타문자 차단 + 길이 제한
  //       - cwd: 절대 경로 + 디렉토리 존재 확인
  //       - timeout: default 10분, max 30분 — 초과 시 SIGTERM/SIGKILL
  //       - env: 최소 화이트리스트만 전달
  //     동기화 필요: v3/electron/mission-engine/types.ts 의 ALLOWED_SKILLS,
  //                v3/src/components/missions/templates.ts 의 skill 들과 동일.
  const ALLOWED_MISSION_SKILLS = [
    "/review",
    "/qa",
    "/ship",
    "/investigate",
    "/plan-ceo-review",
    "/plan-eng-review",
    "/plan-design-review",
    "/design-review",
    "/office-hours",
    "/autoplan",
  ] as const;
  const SHELL_METACHARS = /[;&|`$<>\\\n\r]/;

  auditedTool(
    "run_skill",
    "Run an allowlisted gstack slash command in an isolated `cc --print` subprocess and return the result. Used by MissionEngine. Arbitrary text and non-allowlisted commands are rejected.",
    {
      skill: z
        .enum(ALLOWED_MISSION_SKILLS)
        .describe("gstack slash command (allowlist)"),
      args: z
        .string()
        .max(2000)
        .optional()
        .describe("slash command args (shell metacharacters blocked)"),
      mission_id: z
        .string()
        .optional()
        .describe("mission ID — surfaced to subprocess as MARBLO_MISSION_ID"),
      cwd: z
        .string()
        .optional()
        .describe(
          "absolute cwd for the subprocess (default: MARBLO_PROJECT_ROOT or process.cwd())",
        ),
      timeout_ms: z
        .number()
        .int()
        .min(10_000)
        .max(1_800_000)
        .optional()
        .describe("timeout ms (default 600000 = 10min, max 1800000 = 30min)"),
    },
    async ({ skill, args, mission_id, cwd, timeout_ms }) => {
      // 1) args sanitization — shell injection 방지
      if (args && SHELL_METACHARS.test(args)) {
        return text(
          "Error: run_skill args contains forbidden shell metacharacters (;&|`$<>\\n).",
        );
      }

      // 2) cwd 검증 — 절대 경로 + 디렉토리 존재
      const resolvedCwd =
        cwd || process.env.MARBLO_PROJECT_ROOT || process.cwd();
      if (!path.isAbsolute(resolvedCwd)) {
        return text(`Error: run_skill cwd must be absolute, got "${cwd}".`);
      }
      try {
        const stat = fs.statSync(resolvedCwd);
        if (!stat.isDirectory()) {
          return text(
            `Error: run_skill cwd "${resolvedCwd}" is not a directory.`,
          );
        }
      } catch {
        return text(
          `Error: run_skill cwd "${resolvedCwd}" does not exist or is not accessible.`,
        );
      }

      // 3) subprocess spawn — cc --print, env 최소화
      const timeoutMs = timeout_ms ?? 600_000;
      const ccBinary = process.env.MARBLO_CC_BIN || "claude";
      const prompt = args ? `${skill} ${args}` : skill;
      const startedAt = Date.now();

      return await new Promise<ReturnType<typeof text>>((resolve) => {
        let resolved = false;
        let stdout = "";
        let stderr = "";

        const child = spawn(ccBinary, ["--print", prompt], {
          cwd: resolvedCwd,
          env: {
            PATH: process.env.PATH ?? "",
            HOME: process.env.HOME ?? "",
            USER: process.env.USER ?? "",
            LANG: process.env.LANG ?? "en_US.UTF-8",
            MARBLO_PROJECT: process.env.MARBLO_PROJECT ?? "",
            MARBLO_AGENT_ID: process.env.MARBLO_AGENT_ID ?? "",
            MARBLO_MISSION_ID: mission_id ?? "",
          },
          stdio: ["ignore", "pipe", "pipe"],
        });

        const timer = setTimeout(() => {
          try {
            child.kill("SIGTERM");
          } catch {
            /* best-effort */
          }
          setTimeout(() => {
            try {
              child.kill("SIGKILL");
            } catch {
              /* best-effort */
            }
          }, 5000);
          finish(false, `timeout after ${timeoutMs}ms`);
        }, timeoutMs);

        const finish = (ok: boolean, errLine?: string) => {
          if (resolved) return;
          resolved = true;
          clearTimeout(timer);
          const durationMs = Date.now() - startedAt;
          const status = ok ? "✅" : "❌";
          const outTail = stdout.slice(-8000);
          const errTail = stderr.slice(-2000);
          const summary =
            `${status} run_skill ${skill} (${durationMs}ms)\n` +
            (outTail ? `---stdout (last 8KB)---\n${outTail}\n` : "") +
            (errTail || errLine
              ? `---stderr---\n${[errLine, errTail]
                  .filter(Boolean)
                  .join("\n")}\n`
              : "");
          resolve(text(summary.trim()));
        };

        child.stdout.on("data", (b) => {
          stdout += b.toString();
        });
        child.stderr.on("data", (b) => {
          stderr += b.toString();
        });
        child.on("exit", (code, signal) => {
          finish(
            code === 0,
            code !== 0
              ? `exit code=${code} signal=${signal ?? "none"}`
              : undefined,
          );
        });
        child.on("error", (err) => {
          finish(false, `spawn error: ${err.message}`);
        });
      });
    },
  );

  // mission_step_done — B안 Phase 2 (보고 채널): 미션 오케스트레이터 → 지휘자
  // 스텝완료/실패 보고. 설계: v3/docs/MISSIONS-B-ORCHESTRATOR-DRIVEN.md §4 / §8.4.
  auditedTool(
    "mission_step_done",
    "Report completion (or failure) of the CURRENT mission step to the mission " +
      "conductor. Valid only inside a mission orchestrator context " +
      "(MARBLO_CONTEXT=<missionId>); board / Quick Lane / unscoped callers are " +
      "rejected. Emits the 'mission.step_reported' event the conductor subscribes " +
      "to. Call this when a granted step is finished — do NOT advance to the next " +
      "step yourself; the conductor verifies the step gate and grants the next.",
    {
      stepIndex: z
        .number()
        .int()
        .optional()
        .describe(
          "Index of the completed step. Omit to let the conductor use the " +
            "mission's current step.",
        ),
      result: z
        .object({
          success: z.boolean().describe("Whether the step succeeded."),
          output: z
            .unknown()
            .optional()
            .describe(
              "Artifact summary for gate verification (e.g. PR URL, review verdict).",
            ),
          error: z
            .string()
            .optional()
            .describe("Failure reason when success=false."),
        })
        .optional()
        .describe("Step result. Omit to report a successful completion."),
    },
    async ({ stepIndex, result }) => {
      const event = buildMissionStepReportedEvent(stepIndex, result);
      if (!event) {
        return text(
          "Error: mission_step_done requires a mission context. This caller is on " +
            "the board / a Quick Lane / unscoped (MARBLO_CONTEXT is not a missionId), " +
            "so there is no mission step to report.",
        );
      }
      emitMissionStepReport(event);
      const { missionId, payload } = event;
      const status = payload.result.success ? "success" : "failed";
      const stepLabel =
        payload.stepIndex < 0 ? "current step" : `step ${payload.stepIndex}`;
      return text(
        `Reported ${stepLabel} as ${status} to the conductor for mission ${missionId}.` +
          (payload.result.error ? ` (error: ${payload.result.error})` : ""),
      );
    },
  );

  // send_telegram_message — outbound reply to the project's Telegram channel.
  // The electron-owned TelegramPoller holds the bot token + last-inbound chat;
  // this tool POSTs to the bridge which routes to poller.sendMessage. The token
  // NEVER crosses this boundary — we send only projectId/text/chatId, and any
  // error returned is already token-scrubbed by the poller.
  auditedTool(
    "send_telegram_message",
    "Reply to the project's Telegram channel. Call this to answer a '[Telegram " +
      "inbound ...]' message — a plain text response is NOT delivered to Telegram, " +
      "only this tool is. chatId defaults to the last inbound chat for the project " +
      "(pass it explicitly to target a specific chat). Requires an active Telegram " +
      "channel and MARBLO_BRIDGE_PORT.",
    {
      text: z.string().describe("Message text to send to Telegram."),
      projectId: z
        .string()
        .optional()
        .describe(
          "Marblo project id. Defaults to MARBLO_PROJECT (the current context).",
        ),
      chatId: z
        .string()
        .optional()
        .describe(
          "Target chat id. Omit to reply to the last inbound chat for the project.",
        ),
    },
    async ({ text: messageText, projectId, chatId }) => {
      const targetProject = projectId || process.env.MARBLO_PROJECT || "";
      if (!targetProject) {
        return text(
          "Error: no projectId (set MARBLO_PROJECT or pass projectId).",
        );
      }
      // 전송 자체는 escalate_to_owner 와 같은 헬퍼를 쓴다(경로 이중화 금지).
      const result = await sendTelegramViaBridge(
        targetProject,
        messageText,
        chatId,
      );
      if (!result.ok) {
        return text(
          `Failed to send Telegram message: ${result.error || "unknown error"}`,
        );
      }
      // ★자동 포착 — escalate_to_owner 와 같은 표면(사장님 보고). 실패 사례의
      // 문장은 이 두 경로 중 하나로 나갔다.
      const telegramCapture = await captureChainPromiseNote(
        "owner_report",
        "send_telegram_message",
        messageText,
        { projectId: targetProject },
      );
      return text(
        withCaptureNote(
          `Sent Telegram message to chat ${result.chatId ?? "(default)"}.`,
          telegramCapture,
        ),
      );
    },
  );

  // ── 로컬 markdown 지식 위키 유지보수 (카파시 3계층 초기 증명) ────────────
  //
  // 프로젝트 폴더의 md 위키를 로컬 파일로 읽고 index.md / log.md 를 자동 유지한다.
  // 외부 커넥터와 달리 브리지/OAuth 가 필요 없는 최초 증명 경로다. root_path 를
  // 생략하면 MARBLO_PROJECT_ROOT(없으면 cwd)를 쓴다. 프로젝트 밖 추론은 하지 않는다.

  async function readBoundProjectWikiDefaults(): Promise<{
    folderPath: string | null;
    assistant: boolean;
  }> {
    if (!DEFAULT_PROJECT) return { folderPath: null, assistant: false };
    try {
      const snap = await getDoc(doc(db, "projects", DEFAULT_PROJECT));
      if (!snap.exists()) return { folderPath: null, assistant: false };
      const data = snap.data() as { folderPath?: unknown; kind?: unknown };
      return {
        folderPath:
          typeof data.folderPath === "string" && data.folderPath.trim()
            ? data.folderPath
            : null,
        assistant: data.kind === "assistant",
      };
    } catch {
      return { folderPath: null, assistant: false };
    }
  }

  async function resolveLocalWikiRoot(rootPath?: string): Promise<{
    root: string;
    assistant: boolean;
  }> {
    const defaults = await readBoundProjectWikiDefaults();
    const root = await resolveWikiRoot(
      rootPath || defaults.folderPath || undefined,
    );
    return { root, assistant: defaults.assistant };
  }

  auditedTool(
    "wiki_ingest",
    "Ingest a local markdown wiki, maintain index.md and log.md, and optionally append durable assistant memory to MEMORY.md. Reads only markdown files under root_path, the bound project folderPath, or MARBLO_PROJECT_ROOT/cwd.",
    {
      root_path: z
        .string()
        .optional()
        .describe(
          "Local project/wiki folder. Defaults to MARBLO_PROJECT_ROOT, then the MCP process cwd.",
        ),
      maintain_memory: z
        .boolean()
        .optional()
        .describe(
          "Ensure MEMORY.md exists for assistant-kind projects (default false unless memory_append is provided).",
        ),
      memory_append: z
        .string()
        .optional()
        .describe(
          "Durable assistant memory/progress/preference note to append to MEMORY.md.",
        ),
    },
    async ({ root_path, maintain_memory, memory_append }) => {
      const { root, assistant } = await resolveLocalWikiRoot(root_path);
      const result = await ingestWiki({
        rootPath: root,
        maintainMemory: maintain_memory ?? assistant,
        assistantMemoryAppend: memory_append,
      });
      const lines = [
        `Wiki ingest complete.`,
        `root: ${result.rootPath}`,
        `docs: ${result.graph.nodes.length}`,
        `links: ${result.graph.edges.length}`,
        `orphans: ${result.graph.orphanIds.size}`,
        `written: ${result.written.join(", ")}`,
      ];
      if (result.truncated) {
        lines.push("warning: file scan hit the markdown file cap.");
      }
      if (result.skipped.length > 0) {
        lines.push(`skipped: ${result.skipped.slice(0, 10).join("; ")}`);
      }
      return text(lines.join("\n"));
    },
  );

  auditedTool(
    "wiki_query",
    "Query the local markdown wiki under root_path or the bound project folderPath. Returns ranked markdown matches with short snippets; also includes MEMORY.md when present.",
    {
      query: z.string().describe("Search terms."),
      root_path: z
        .string()
        .optional()
        .describe(
          "Local project/wiki folder. Defaults to MARBLO_PROJECT_ROOT, then the MCP process cwd.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(25)
        .optional()
        .describe("Max matches to return (default 10, max 25)."),
    },
    async ({ query, root_path, limit }) => {
      const { root } = await resolveLocalWikiRoot(root_path);
      const wiki = await readWiki(root);
      const matches = queryWiki(wiki.docs, query, limit ?? 10);
      if (matches.length === 0) {
        return text(`No wiki matches for "${query}".`);
      }
      const lines = matches.map(
        (match) => `- ${match.path} (score=${match.score})\n  ${match.snippet}`,
      );
      const suffix = wiki.truncated
        ? "\nwarning: file scan hit the markdown file cap."
        : "";
      return text(
        `Wiki query results for "${query}" (${matches.length}):\n${lines.join(
          "\n",
        )}${suffix}`,
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "wiki_lint",
    "Lint the local markdown wiki under root_path or the bound project folderPath. Checks index.md/log.md presence, resolved document graph, and orphan documents.",
    {
      root_path: z
        .string()
        .optional()
        .describe(
          "Local project/wiki folder. Defaults to MARBLO_PROJECT_ROOT, then the MCP process cwd.",
        ),
    },
    async ({ root_path }) => {
      const { root } = await resolveLocalWikiRoot(root_path);
      const wiki = await readWiki(root);
      const result = lintWiki(wiki.docs);
      const lines = [
        `Wiki lint: ${result.issues.length === 0 ? "OK" : "issues found"}`,
        `root: ${root}`,
        `docs: ${result.graph.nodes.length}`,
        `links: ${result.graph.edges.length}`,
        `orphans: ${result.graph.orphanIds.size}`,
      ];
      if (result.issues.length > 0) {
        lines.push(
          ...result.issues
            .slice(0, 50)
            .map(
              (issue) =>
                `- [${issue.level}] ${issue.code} ${issue.path}: ${issue.message}`,
            ),
        );
      }
      if (wiki.truncated) {
        lines.push("warning: file scan hit the markdown file cap.");
      }
      if (wiki.skipped.length > 0) {
        lines.push(`skipped: ${wiki.skipped.slice(0, 10).join("; ")}`);
      }
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // ── Google Drive 읽기 전용 (티켓 zqNxS9904aeeBEug1uAD) ──────────────────────
  //
  // 지식위키·헤르메스형 비서 에픽의 선행 커넥터. 이 프로세스는 OAuth 토큰을
  // **보지 않는다** — 브리지가 main 의 safeStorage 저장소를 대신 두드리고 결과만
  // 돌려준다. 그래서 MCP 프로세스가 탈취돼도 Drive 자격증명은 새지 않는다.
  //
  // userFacing:false — 읽기 조회라 활동 스트림에 노이즈를 만들지 않는다.

  async function knowledgeViaBridge(
    endpoint:
      | "/drive-search"
      | "/drive-fetch"
      | "/drive-write"
      | "/notion-search"
      | "/notion-fetch"
      | "/notion-write"
      | "/gmail-search"
      | "/gmail-fetch"
      | "/gmail-draft"
      | "/gmail-send"
      | "/calendar-list"
      | "/calendar-create"
      | "/calendar-patch"
      | "/contacts-search"
      | "/web-tab-agent-read"
      | "/web-tab-agent-list",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const bridgePort = process.env.MARBLO_BRIDGE_PORT;
    if (!bridgePort) {
      return {
        ok: false,
        error:
          "MARBLO_BRIDGE_PORT not set — Marblo 앱 밖에서 뜬 MCP 프로세스는 Drive 를 쓸 수 없습니다.",
      };
    }
    try {
      const response = await fetch(
        `http://127.0.0.1:${bridgePort}${endpoint}`,
        {
          method: "POST",
          headers: bridgeHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify(payload),
        },
      );
      return (await response.json()) as Record<string, unknown>;
    } catch (err) {
      return {
        ok: false,
        error: `브리지 연결 실패: ${
          err instanceof Error ? err.message : String(err)
        }`,
      };
    }
  }

  /** 브리지의 읽기 전용 Drive/Google Workspace 엔드포인트 호출. 실패는 문장으로 돌려준다. */
  async function driveViaBridge(
    endpoint:
      | "/drive-search"
      | "/drive-fetch"
      | "/drive-write"
      | "/gmail-search"
      | "/gmail-fetch"
      | "/gmail-draft"
      | "/gmail-send"
      | "/calendar-list"
      | "/calendar-create"
      | "/calendar-patch"
      | "/contacts-search",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return knowledgeViaBridge(endpoint, payload);
  }

  async function notionViaBridge(
    endpoint: "/notion-search" | "/notion-fetch" | "/notion-write",
    payload: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    return knowledgeViaBridge(endpoint, payload);
  }

  // ── Stage 1 web-tab agent read (ticket FQ7nshXHjDWOvD0WWUVV) ───────────
  // Read-only observation of a pane the owner has explicitly opted in to
  // agent reads. No click/type/submit/navigate tool exists here on purpose —
  // that is stage 2/3, gated on the approval work this ticket's design doc
  // describes (docs/wiki/20-constraints/browser-session-approval-boundary.md).

  auditedTool(
    "web_tab_list",
    "List the Web tabs the owner has switched 'allow agent to read' on for this session. " +
      "Returns only granted panes — a tab the owner hasn't opted in is invisible here, not just " +
      "unreadable. Use this to find a pane_id for web_tab_read. Read-only; lists no page content.",
    {},
    async () => {
      const result = await knowledgeViaBridge("/web-tab-agent-list", {});
      if (result.ok !== true) {
        return text(
          `웹탭 목록 조회 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const panes = Array.isArray(result.panes)
        ? (result.panes as Array<{
            paneId: string;
            url: string;
            title: string;
          }>)
        : [];
      if (panes.length === 0) {
        return text(
          "에이전트 읽기가 허용된 웹탭이 없습니다. 사장님이 웹탭에서 '에이전트 읽기 허용'을 켜야 합니다." +
            (result.globalStopActive ? " (전역 중지가 켜져 있습니다.)" : ""),
        );
      }
      const lines = panes.map(
        (p) =>
          `- pane_id: ${p.paneId}\n  url: ${p.url}\n  title: ${p.title || "(제목 없음)"}`,
      );
      return text(`읽기 허용된 웹탭 ${panes.length}개:\n${lines.join("\n")}`);
    },
    { userFacing: false },
  );

  auditedTool(
    "web_tab_read",
    "Read the current page of one Web tab the owner has granted agent-read access to " +
      "(see web_tab_list for pane_id). Returns visible text only — READ-ONLY, no click/type/" +
      "submit exists. Denied on sign-in/payment pages even if the pane is granted, while the " +
      "owner's global browser-access stop is on, or if the pane isn't granted/open. Rate-limited " +
      "per pane to avoid looking like a scraping burst to the site being read.",
    {
      pane_id: z.string().describe("Pane id from web_tab_list."),
      ticket_id: z
        .string()
        .optional()
        .describe(
          "This task's id, recorded on the read for the owner's activity feed.",
        ),
    },
    async ({ pane_id, ticket_id }) => {
      const result = await knowledgeViaBridge("/web-tab-agent-read", {
        paneId: pane_id,
        agentId: MARBLO_AGENT_ID,
        ticketId: ticket_id,
      });
      if (result.ok !== true) {
        return text(
          `웹탭 읽기 거부: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const truncatedNote = result.truncated
        ? "\n\n(본문이 길어 일부만 표시했습니다.)"
        : "";
      const redactedNote =
        typeof result.redactedCount === "number" && result.redactedCount > 0
          ? `\n\n(비밀로 보이는 값 ${result.redactedCount}건을 가렸습니다.)`
          : "";
      return text(
        `"${result.title}" (${result.url})\n\n${result.text}${truncatedNote}${redactedNote}`,
      );
    },
    { userFacing: true },
  );

  auditedTool(
    "drive_search",
    "UNAVAILABLE IN THIS RELEASE — do not call. Reading the user's Google Drive " +
      "needs the drive.readonly scope, which Google classes as restricted and which " +
      "Marblo does not request in this release (it would require a paid CASA security " +
      "assessment). Use the project's LOCAL wiki instead: call wiki_query with " +
      "root_path set to the project's docs/wiki directory — the same knowledge lives " +
      "there. Kept registered, not deleted, so it can be restored once CASA is passed.",
    {
      text: z
        .string()
        .optional()
        .describe("Full-text search inside document contents."),
      name_contains: z
        .string()
        .optional()
        .describe("Substring match on the file name."),
      folder_id: z
        .string()
        .optional()
        .describe(
          "Limit to direct children of this Drive folder id. Must be inside " +
            "this project's bound wiki folder — anything else is refused.",
        ),
      mime_types: z
        .array(z.string())
        .optional()
        .describe(
          "Limit to these MIME types, e.g. ['application/vnd.google-apps.document'].",
        ),
      include_folders: z
        .boolean()
        .optional()
        .describe("Include folders in the results (default false)."),
      page_size: z
        .number()
        .optional()
        .describe("Results per page, 1–100 (default 25)."),
      page_token: z
        .string()
        .optional()
        .describe("nextPageToken from a previous drive_search call."),
    },
    async ({
      text: query,
      name_contains,
      folder_id,
      mime_types,
      include_folders,
      page_size,
      page_token,
    }) => {
      const result = await driveViaBridge("/drive-search", {
        // ★어느 프로젝트의 위키를 읽는지. 이 값이 없으면 브리지가 조회 자체를
        // 거절한다 — 스코프 없는 Drive 조회는 이 경로에 존재하지 않는다.
        projectId: process.env.MARBLO_PROJECT || "",
        text: query,
        nameContains: name_contains,
        folderId: folder_id,
        mimeTypes: mime_types,
        includeFolders: include_folders,
        pageSize: page_size,
        pageToken: page_token,
      });
      if (result.ok !== true) {
        return text(
          `Drive 검색 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        files?: Array<{
          id: string;
          title: string;
          mimeType: string;
          modifiedTime?: string;
          isFolder?: boolean;
        }>;
        nextPageToken?: string;
        query?: string;
      };
      const scope = result.scope as
        | {
            folderId: string;
            folderName?: string | null;
            folderCount?: number;
            truncated?: boolean;
          }
        | undefined;
      const scopeLabel = scope
        ? `위키 폴더 "${scope.folderName ?? scope.folderId}"`
        : "연결된 Drive";
      // 하위 폴더를 다 펼치지 못했다면 그 사실을 숨기지 않는다 — "검색해서 없었다"
      // 와 "범위 밖이라 안 봤다" 는 완전히 다른 결론이고, 후자를 전자로 읽으면
      // 에이전트가 없는 사실을 단정한다.
      const scopeNote =
        scope?.truncated === true
          ? `\n(주의: 하위 폴더가 많아 일부만 검색했습니다 — 폴더 ${
              scope.folderCount ?? 0
            }개까지.)`
          : "";

      const files = payload?.files ?? [];
      if (files.length === 0) {
        return text(
          `${scopeLabel} 안에 조건에 맞는 파일이 없습니다. (q: ${
            payload?.query ?? ""
          })${scopeNote}`,
        );
      }
      const lines = files.map(
        (f) =>
          `- ${f.title}${f.isFolder ? " [폴더]" : ""}\n  id: ${
            f.id
          }\n  mimeType: ${f.mimeType}` +
          (f.modifiedTime ? `\n  modified: ${f.modifiedTime}` : ""),
      );
      // 다음 페이지가 있다는 사실을 숨기지 않는다 — 조용한 절단은 "전부 봤다"는
      // 오해를 만들고, 지식 취득에서 그 오해가 가장 비싸다.
      if (payload?.nextPageToken) {
        lines.push(
          `\n(더 있음 — page_token="${payload.nextPageToken}" 으로 이어서 조회하세요.)`,
        );
      }
      return text(
        `${scopeLabel} 에서 ${files.length}개 파일:\n${lines.join(
          "\n",
        )}${scopeNote}`,
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "drive_fetch",
    "UNAVAILABLE IN THIS RELEASE — do not call. Reading a Google Drive file's body " +
      "needs the drive.readonly scope, which Google classes as restricted and which " +
      "Marblo does not request in this release (it would require a paid CASA security " +
      "assessment). Read the project's LOCAL wiki files instead (wiki_query with " +
      "root_path, or the ordinary file-reading tools on docs/wiki). Kept registered, " +
      "not deleted, so it can be restored once CASA is passed.",
    {
      file_id: z.string().describe("Drive file id (from drive_search)."),
    },
    async ({ file_id }) => {
      const result = await driveViaBridge("/drive-fetch", {
        projectId: process.env.MARBLO_PROJECT || "",
        fileId: file_id,
      });
      if (result.ok !== true) {
        return text(
          `Drive 본문 취득 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const doc = result.document as {
        id: string;
        title: string;
        mimeType: string;
        text: string;
        extraction: string;
        extractionDetail?: string;
        truncated: boolean;
        webViewLink?: string;
      };
      // 본문이 비는 두 경우(미지원 형식 / 텍스트 레이어 없는 PDF)를 "빈 문서" 로
      // 뭉개지 않고 이유를 말한다.
      if (doc.extraction === "unsupported") {
        return text(
          `"${doc.title}" (${doc.mimeType}) 은 텍스트로 변환할 수 없는 형식입니다.`,
        );
      }
      if (doc.extraction === "pdf-no-text") {
        return text(
          `"${doc.title}" 은 텍스트 레이어가 없는 PDF(스캔본)입니다 — OCR 없이는 본문을 읽을 수 없습니다.`,
        );
      }
      // Office/한글 문서: "열었는데 텍스트가 없다" 와 "열지 못했다" 는 다른 사실이다.
      if (
        doc.extraction === "office-no-text" ||
        doc.extraction === "office-unreadable"
      ) {
        const why =
          doc.extractionDetail ||
          (doc.extraction === "office-no-text"
            ? "문서 안에 추출할 텍스트가 없습니다."
            : "파일을 열지 못했습니다.");
        const truncatedNote = doc.truncated
          ? " (파일이 크기 상한에 걸려 일부만 내려받은 탓일 수 있습니다.)"
          : "";
        return text(`"${doc.title}" (${doc.mimeType}): ${why}${truncatedNote}`);
      }
      const header = [
        `# ${doc.title}`,
        `id: ${doc.id} · mimeType: ${doc.mimeType} · 취득: ${doc.extraction}`,
        doc.webViewLink ? `link: ${doc.webViewLink}` : "",
        doc.truncated ? "⚠️ 길이 상한에 걸려 뒷부분이 잘렸습니다." : "",
      ]
        .filter(Boolean)
        .join("\n");
      return text(`${header}\n\n${doc.text}`);
    },
    { userFacing: false },
  );

  auditedTool(
    "drive_write",
    "UNAVAILABLE IN THIS RELEASE — do not call. The target is the project's bound " +
      "Drive wiki folder, and reaching a user-owned folder needs the drive.readonly " +
      "scope, which Google classes as restricted and which Marblo does not request in " +
      "this release (drive.file alone cannot see a folder the app did not create). " +
      "Write to the project's LOCAL wiki (docs/wiki) instead. Kept registered, not " +
      "deleted, so it can be restored once CASA is passed.",
    {
      title: z.string().describe("New document title."),
      content: z
        .string()
        .optional()
        .describe("Plain text to insert into the new Google Docs document."),
      folder_id: z
        .string()
        .optional()
        .describe(
          "Optional Drive folder id inside this project's bound wiki folder.",
        ),
    },
    async ({ title, content, folder_id }) => {
      const result = await driveViaBridge("/drive-write", {
        projectId: process.env.MARBLO_PROJECT || "",
        title,
        content,
        folderId: folder_id,
      });
      if (result.ok !== true) {
        return text(
          `Drive 문서 생성 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        id: string;
        title: string;
        mimeType: string;
        webViewLink?: string;
        insertedTextLength?: number;
      };
      return text(
        [
          `Drive 문서를 생성했습니다: ${payload.title}`,
          `id: ${payload.id}`,
          `mimeType: ${payload.mimeType}`,
          `insertedTextLength: ${payload.insertedTextLength ?? 0}`,
          payload.webViewLink ? `link: ${payload.webViewLink}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "notion_search",
    "Search THIS PROJECT'S Notion wiki binding (READ-ONLY). The search is " +
      "always scoped to the Notion database or page bound to this project. " +
      "For database bindings it uses databases.query; for page bindings it " +
      "lists the bound page and direct child pages. Requires the user to have " +
      "connected Notion and picked this project's wiki source in Marblo's Harness tab.",
    {
      query: z
        .string()
        .optional()
        .describe(
          "Title/text query. Database bindings filter returned page titles.",
        ),
      page_size: z
        .number()
        .optional()
        .describe("Results per page, 1–100 (default 25)."),
      start_cursor: z
        .string()
        .optional()
        .describe("next_cursor from a previous notion_search call."),
    },
    async ({ query, page_size, start_cursor }) => {
      const result = await notionViaBridge("/notion-search", {
        projectId: process.env.MARBLO_PROJECT || "",
        query,
        pageSize: page_size,
        startCursor: start_cursor,
      });
      if (result.ok !== true) {
        return text(
          `Notion 검색 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        results?: Array<{
          id: string;
          object: "page" | "database";
          title: string;
          lastEditedTime?: string;
          url?: string;
        }>;
        nextCursor?: string;
      };
      const scope = result.scope as
        | {
            objectId: string;
            objectKind: "database" | "page";
            title?: string | null;
            truncated?: boolean;
          }
        | undefined;
      const scopeLabel = scope
        ? `Notion ${scope.objectKind} "${scope.title ?? scope.objectId}"`
        : "연결된 Notion";
      const items = payload.results ?? [];
      if (items.length === 0) {
        return text(`${scopeLabel} 안에 조건에 맞는 페이지가 없습니다.`);
      }
      const lines = items.map(
        (item) =>
          `- ${item.title} [${item.object}]\n  id: ${item.id}` +
          (item.lastEditedTime ? `\n  edited: ${item.lastEditedTime}` : "") +
          (item.url ? `\n  url: ${item.url}` : ""),
      );
      if (payload.nextCursor) {
        lines.push(
          `\n(더 있음 — start_cursor="${payload.nextCursor}" 로 이어서 조회하세요.)`,
        );
      }
      return text(
        `${scopeLabel} 에서 ${items.length}개 항목:\n${lines.join("\n")}`,
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "notion_fetch",
    "Fetch one Notion page's block body as markdown-ish text (READ-ONLY). " +
      "Get page ids from notion_search. The page must be the bound page, a " +
      "child of the bound page, or inside the bound database for this project.",
    {
      page_id: z.string().describe("Notion page id (from notion_search)."),
    },
    async ({ page_id }) => {
      const result = await notionViaBridge("/notion-fetch", {
        projectId: process.env.MARBLO_PROJECT || "",
        pageId: page_id,
      });
      if (result.ok !== true) {
        return text(
          `Notion 본문 취득 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const doc = result.document as {
        id: string;
        title: string;
        text: string;
        extraction: string;
        truncated: boolean;
        url?: string;
        lastEditedTime?: string;
      };
      if (doc.extraction === "empty") {
        return text(`"${doc.title}" 은 읽을 수 있는 본문 블록이 없습니다.`);
      }
      const header = [
        `# ${doc.title}`,
        `id: ${doc.id} · 취득: ${doc.extraction}`,
        doc.lastEditedTime ? `lastEdited: ${doc.lastEditedTime}` : "",
        doc.url ? `url: ${doc.url}` : "",
        doc.truncated ? "(본문이 길어 일부만 반환했습니다.)" : "",
      ].filter(Boolean);
      return text(`${header.join("\n")}\n\n${doc.text}`);
    },
    { userFacing: false },
  );

  auditedTool(
    "notion_write",
    "Create a page or append blocks inside THIS PROJECT'S bound Notion wiki. " +
      "If page_id is provided, markdown-ish content is appended to that page after " +
      "scope validation. Without page_id, a new page is created under the bound " +
      "database/page. This is a non-destructive write and runs immediately.",
    {
      page_id: z
        .string()
        .optional()
        .describe(
          "Existing Notion page id to append to. Omit to create a page.",
        ),
      title: z
        .string()
        .optional()
        .describe("Required when creating a new page."),
      content: z
        .string()
        .optional()
        .describe(
          "Markdown-ish text. Supports headings (#), bullets, numbers, paragraphs.",
        ),
    },
    async ({ page_id, title, content }) => {
      const result = await notionViaBridge("/notion-write", {
        projectId: process.env.MARBLO_PROJECT || "",
        pageId: page_id,
        title,
        content,
      });
      if (result.ok !== true) {
        return text(
          `Notion 쓰기 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        action: string;
        pageId: string;
        title?: string;
        url?: string;
        appendedBlocks?: number;
      };
      return text(
        [
          `Notion ${
            payload.action === "append_blocks"
              ? "블록을 추가했습니다"
              : "페이지를 생성했습니다"
          }.`,
          `pageId: ${payload.pageId}`,
          payload.title ? `title: ${payload.title}` : "",
          `blocks: ${payload.appendedBlocks ?? 0}`,
          payload.url ? `url: ${payload.url}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "gmail_search",
    "UNAVAILABLE IN THIS RELEASE — do not call. Reading the user's mail needs the " +
      "gmail.readonly scope, which Google classes as restricted and which Marblo does " +
      "not request in this release (it would require a paid CASA security assessment). " +
      "Sending mail now uses mail_send, and Calendar/Contacts lookups are not available " +
      "until their non-Google replacements land. Ask the user to paste any mail content you need. Kept registered, not deleted, so it can be " +
      "restored once CASA is passed.",
    {
      query: z
        .string()
        .optional()
        .describe("Gmail search query, e.g. 'from:alice newer_than:30d'."),
      label_ids: z
        .array(z.string())
        .optional()
        .describe("Gmail label ids to include, e.g. ['INBOX'] or ['SENT']."),
      page_size: z
        .number()
        .optional()
        .describe("Results per page, 1-50 (default 10)."),
      page_token: z
        .string()
        .optional()
        .describe("nextPageToken from a previous gmail_search call."),
    },
    async ({ query, label_ids, page_size, page_token }) => {
      const result = await driveViaBridge("/gmail-search", {
        projectId: process.env.MARBLO_PROJECT || "",
        query,
        labelIds: label_ids,
        pageSize: page_size,
        pageToken: page_token,
      });
      if (result.ok !== true) {
        return text(
          `Gmail 검색 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        messages?: Array<{ id: string; threadId: string }>;
        nextPageToken?: string;
        resultSizeEstimate?: number;
      };
      const messages = payload.messages ?? [];
      if (messages.length === 0) {
        return text("조건에 맞는 Gmail 메시지가 없습니다.");
      }
      const lines = messages.map(
        (message) => `- id: ${message.id}\n  threadId: ${message.threadId}`,
      );
      if (payload.nextPageToken) {
        lines.push(
          `\n(더 있음 — page_token="${payload.nextPageToken}" 으로 이어서 조회하세요.)`,
        );
      }
      const estimate =
        typeof payload.resultSizeEstimate === "number"
          ? ` (estimate: ${payload.resultSizeEstimate})`
          : "";
      return text(
        `Gmail 메시지 ${messages.length}개${estimate}:\n${lines.join("\n")}`,
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "gmail_fetch",
    "UNAVAILABLE IN THIS RELEASE — do not call. Reading a mail body needs the " +
      "gmail.readonly scope, which Google classes as restricted and which Marblo does " +
      "not request in this release (it would require a paid CASA security assessment). " +
      "Ask the user to paste the message instead. Kept registered, not deleted, so it " +
      "can be restored once CASA is passed.",
    {
      message_id: z.string().describe("Gmail message id from gmail_search."),
    },
    async ({ message_id }) => {
      const result = await driveViaBridge("/gmail-fetch", {
        projectId: process.env.MARBLO_PROJECT || "",
        messageId: message_id,
      });
      if (result.ok !== true) {
        return text(
          `Gmail 메시지 조회 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const message = result.message as {
        id: string;
        threadId: string;
        subject: string;
        from: string;
        date: string;
        snippet: string;
        body: string;
        labelIds: string[];
        truncated: boolean;
      };
      return text(
        [
          `subject: ${message.subject}`,
          `from: ${message.from}`,
          `date: ${message.date}`,
          `id: ${message.id}`,
          `threadId: ${message.threadId}`,
          `labels: ${message.labelIds.join(", ") || "(none)"}`,
          message.truncated ? "(본문이 길어 일부만 표시합니다.)" : "",
          "",
          message.body || message.snippet || "(본문 없음)",
        ]
          .filter((line, index) => line || index === 8)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  const gmailComposeSchema = {
    to: z.array(z.string()).describe("Recipient email addresses."),
    subject: z.string().describe("Email subject."),
    body: z.string().describe("Plain text email body."),
    cc: z
      .array(z.string())
      .optional()
      .describe("CC recipient email addresses."),
    bcc: z
      .array(z.string())
      .optional()
      .describe("BCC recipient email addresses."),
    thread_id: z
      .string()
      .optional()
      .describe("Optional Gmail thread id for replies."),
  };

  auditedTool(
    "gmail_draft",
    "UNAVAILABLE IN THIS RELEASE — do not call. Writing to the user's Gmail drafts " +
      "folder needs the gmail.compose scope, which Google classes as restricted (it is " +
      "NOT sensitive) and which Marblo does not request in this release. The review " +
      "step moved into the app: show the draft to the user in your reply, and once they " +
      "confirm, send it with mail_send(confirm=true). See docs/GMAIL_DRAFT_REPLACEMENT.md. " +
      "Kept registered, not deleted, so it can be restored once CASA is passed.",
    gmailComposeSchema,
    async ({ to, subject, body, cc, bcc, thread_id }) => {
      const result = await driveViaBridge("/gmail-draft", {
        projectId: process.env.MARBLO_PROJECT || "",
        to,
        subject,
        body,
        cc,
        bcc,
        threadId: thread_id,
      });
      if (result.ok !== true) {
        return text(
          `Gmail 초안 생성 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const draft = result.draft as {
        id: string;
        messageId?: string;
        threadId?: string;
      };
      return text(
        [
          "Gmail 초안을 생성했습니다.",
          `draftId: ${draft.id}`,
          draft.messageId ? `messageId: ${draft.messageId}` : "",
          draft.threadId ? `threadId: ${draft.threadId}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "gmail_send",
    "UNAVAILABLE IN THIS RELEASE — do not call. Gmail API sending needs the " +
      "gmail.send scope, which Google classes as sensitive and which Marblo no longer " +
      "requests because any sensitive scope triggers publishing verification. Send mail " +
      "with mail_send instead; that Resend sendAssistantEmail path is the current " +
      "cross-platform replacement. Kept registered, not deleted, so it can be restored later.",
    {
      ...gmailComposeSchema,
      confirm: z
        .boolean()
        .describe("Must be true only after explicit user confirmation."),
    },
    async ({ to, subject, body, cc, bcc, thread_id, confirm }) => {
      const result = await driveViaBridge("/gmail-send", {
        projectId: process.env.MARBLO_PROJECT || "",
        to,
        subject,
        body,
        cc,
        bcc,
        threadId: thread_id,
        confirm,
      });
      if (result.ok !== true) {
        return text(
          `Gmail 발송 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const message = result.message as {
        id: string;
        threadId?: string;
        labelIds?: string[];
      };
      return text(
        [
          "Gmail 메시지를 발송했습니다.",
          `messageId: ${message.id}`,
          message.threadId ? `threadId: ${message.threadId}` : "",
          `labels: ${(message.labelIds ?? []).join(", ") || "(none)"}`,
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  // ── mail_send — Resend 경유 크로스플랫폼 발송 ────────────────────────────
  //
  // 티켓 QiqTTRP9hzsV7v1M8XUS (설계문서 §3.3 · §9 T5a). `gmail.send` 스코프를
  // 회수하면 `gmail_send` 는 죽는다. 이 도구가 그 자리를 메우고, macOS·Windows
  // 양쪽에서 되는 유일한 발송 경로다.
  //
  // ★판정은 전부 서버(콜러블 sendAssistantEmail)에 있다. 인증·레이트리밋·수신자
  // 정책을 여기(클라이언트)에 두면 LLM 이 그냥 건너뛴다. 여기서는 부르고,
  // 서버가 돌려준 문장을 그대로 옮긴다.
  //
  // 설계문서 §3.3 은 macOS 에서 Apple Mail(사용자 본인 주소)로 분기하는 것을
  // 후속 티켓(T5b)에 배정했다. 지금은 Resend 한 갈래뿐이고, 그 사실을 도구
  // 설명이 숨기지 않는다.
  auditedTool(
    "mail_send",
    "Send an email for the signed-in user. CROSS-PLATFORM (macOS + Windows) — " +
      "this is the mail path that works without Google Gmail scopes. " +
      "★FROM ADDRESS: the message goes out from team@marblo.app (Marblo), NOT from " +
      "the user's own email address. Tell the user this before they confirm — they " +
      "will assume it leaves as them, and it does not; replies come back to Marblo, " +
      "not to them. " +
      "★RECIPIENT POLICY: it can only send to the user's own verified sign-in email " +
      "address. Any other recipient, and any cc/bcc, is refused by the server. Use " +
      "it for briefings and reports the user sends to themselves — not for mail to " +
      "third parties. " +
      "DESTRUCTIVE/IRREVERSIBLE, two-step contract identical to gmail_send: first " +
      "show the user the full recipient, subject and body in your reply and ask " +
      "whether to send it; only after they explicitly approve, call again with " +
      "confirm=true. The server refuses unless confirm=true.",
    {
      to: z
        .array(z.string())
        .describe(
          "Recipient. Exactly one address, and it must be the user's own verified " +
            "sign-in email — anything else is refused.",
        ),
      subject: z.string().describe("Email subject."),
      body: z.string().describe("Plain text email body."),
      confirm: z
        .boolean()
        .describe("Must be true only after explicit user confirmation."),
      locale: z
        .enum(["ko", "en"])
        .optional()
        .describe("Language for the footer and error messages (default ko)."),
    },
    async ({ to, subject, body, confirm, locale }) => {
      try {
        const result = await callFunction<
          Record<string, unknown>,
          {
            ok: true;
            to: string;
            from: string;
            subject: string;
            route: string;
            summary: string;
            fromNotice: string;
          }
        >("sendAssistantEmail", {
          projectId: process.env.MARBLO_PROJECT || "",
          to,
          subject,
          body,
          confirm,
          locale,
        });
        // ★발신 주소가 결과 문장에 들어 있다(서버가 만든다). 그대로 옮긴다.
        return text(result.summary);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return text(`메일 발송 실패: ${message}`);
      }
    },
    { userFacing: false },
  );

  auditedTool(
    "calendar_list",
    "UNAVAILABLE IN THIS RELEASE — do not call. Google Calendar reading needs the " +
      "calendar.readonly scope, which Google classes as sensitive and which Marblo no " +
      "longer requests because any sensitive scope triggers publishing verification. " +
      "There is no replacement available yet; Apple Calendar support is a follow-up. " +
      "Kept registered, not deleted, so it can be restored later.",
    {
      time_min: z
        .string()
        .optional()
        .describe("Inclusive lower bound as an ISO timestamp."),
      time_max: z
        .string()
        .optional()
        .describe("Exclusive upper bound as an ISO timestamp."),
      query: z.string().optional().describe("Free-text query for events."),
      max_results: z
        .number()
        .optional()
        .describe("Results per page, 1-50 (default 10)."),
      page_token: z
        .string()
        .optional()
        .describe("nextPageToken from a previous calendar_list call."),
    },
    async ({ time_min, time_max, query, max_results, page_token }) => {
      const result = await driveViaBridge("/calendar-list", {
        projectId: process.env.MARBLO_PROJECT || "",
        timeMin: time_min,
        timeMax: time_max,
        query,
        maxResults: max_results,
        pageToken: page_token,
      });
      if (result.ok !== true) {
        return text(
          `Calendar 조회 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        events?: Array<{
          id: string;
          title: string;
          start: string;
          end: string;
          attendees?: Array<{
            email?: string;
            displayName?: string;
            responseStatus?: string;
          }>;
          location?: string;
          htmlLink?: string;
        }>;
        nextPageToken?: string;
      };
      const events = payload.events ?? [];
      if (events.length === 0)
        return text("조건에 맞는 Calendar 일정이 없습니다.");
      const lines = events.map((event) => {
        const attendees = (event.attendees ?? [])
          .map((attendee) => attendee.displayName ?? attendee.email)
          .filter((name): name is string => Boolean(name))
          .join(", ");
        return (
          `- ${event.title}\n  id: ${event.id}\n  time: ${event.start} - ${event.end}` +
          (attendees ? `\n  attendees: ${attendees}` : "") +
          (event.location ? `\n  location: ${event.location}` : "") +
          (event.htmlLink ? `\n  link: ${event.htmlLink}` : "")
        );
      });
      if (payload.nextPageToken) {
        lines.push(
          `\n(더 있음 — page_token="${payload.nextPageToken}" 으로 이어서 조회하세요.)`,
        );
      }
      return text(`Calendar 일정 ${events.length}개:\n${lines.join("\n")}`);
    },
    { userFacing: false },
  );

  const calendarEventSchema = {
    title: z.string().describe("Event title."),
    start: z
      .string()
      .describe("Start date or dateTime, e.g. 2026-08-13T09:00:00+09:00."),
    end: z
      .string()
      .describe("End date or dateTime, e.g. 2026-08-13T10:00:00+09:00."),
    description: z.string().optional().describe("Event description."),
    location: z.string().optional().describe("Event location."),
    attendees: z
      .array(
        z.object({
          email: z.string().optional(),
          displayName: z.string().optional(),
        }),
      )
      .optional()
      .describe("Attendees by email/displayName."),
    time_zone: z
      .string()
      .optional()
      .describe("IANA timezone for dateTime values."),
    send_updates: z
      .enum(["all", "externalOnly", "none"])
      .optional()
      .describe("Google Calendar sendUpdates option. Defaults to none."),
  };

  auditedTool(
    "calendar_create",
    "UNAVAILABLE IN THIS RELEASE — do not call. Google Calendar writes need the " +
      "calendar.events scope, which Google classes as sensitive and which Marblo no " +
      "longer requests because any sensitive scope triggers publishing verification. " +
      "There is no replacement available yet; Apple Calendar support is a follow-up. " +
      "Kept registered, not deleted, so it can be restored later.",
    calendarEventSchema,
    async ({
      title,
      start,
      end,
      description,
      location,
      attendees,
      time_zone,
      send_updates,
    }) => {
      const result = await driveViaBridge("/calendar-create", {
        projectId: process.env.MARBLO_PROJECT || "",
        title,
        start,
        end,
        description,
        location,
        attendees,
        timeZone: time_zone,
        sendUpdates: send_updates,
      });
      if (result.ok !== true) {
        return text(
          `Calendar 일정 생성 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const event = result.event as {
        id: string;
        title: string;
        start: string;
        end: string;
        htmlLink?: string;
      };
      return text(
        [
          `Calendar 일정을 생성했습니다: ${event.title}`,
          `id: ${event.id}`,
          `time: ${event.start} - ${event.end}`,
          event.htmlLink ? `link: ${event.htmlLink}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "calendar_patch",
    "UNAVAILABLE IN THIS RELEASE — do not call. Google Calendar writes need the " +
      "calendar.events scope, which Google classes as sensitive and which Marblo no " +
      "longer requests because any sensitive scope triggers publishing verification. " +
      "There is no replacement available yet; Apple Calendar support is a follow-up. " +
      "Kept registered, not deleted, so it can be restored later.",
    {
      event_id: z.string().describe("Calendar event id."),
      title: z.string().optional().describe("Event title."),
      start: z.string().optional().describe("Start date or dateTime."),
      end: z.string().optional().describe("End date or dateTime."),
      description: z.string().optional().describe("Event description."),
      location: z.string().optional().describe("Event location."),
      attendees: calendarEventSchema.attendees,
      time_zone: calendarEventSchema.time_zone,
      send_updates: calendarEventSchema.send_updates,
    },
    async ({
      event_id,
      title,
      start,
      end,
      description,
      location,
      attendees,
      time_zone,
      send_updates,
    }) => {
      const result = await driveViaBridge("/calendar-patch", {
        projectId: process.env.MARBLO_PROJECT || "",
        eventId: event_id,
        title,
        start,
        end,
        description,
        location,
        attendees,
        timeZone: time_zone,
        sendUpdates: send_updates,
      });
      if (result.ok !== true) {
        return text(
          `Calendar 일정 수정 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const event = result.event as {
        id: string;
        title: string;
        start: string;
        end: string;
        htmlLink?: string;
      };
      return text(
        [
          `Calendar 일정을 수정했습니다: ${event.title}`,
          `id: ${event.id}`,
          `time: ${event.start} - ${event.end}`,
          event.htmlLink ? `link: ${event.htmlLink}` : "",
        ]
          .filter(Boolean)
          .join("\n"),
      );
    },
    { userFacing: false },
  );

  auditedTool(
    "contacts_search",
    "UNAVAILABLE IN THIS RELEASE — do not call. Google Contacts search needs the " +
      "contacts.readonly scope, which Google classes as sensitive and which Marblo no " +
      "longer requests because any sensitive scope triggers publishing verification. " +
      "There is no replacement available yet; ask the user for the email address directly. " +
      "Kept registered, not deleted, so it can be restored later.",
    {
      query: z
        .string()
        .describe("Name or email substring to search in Google Contacts."),
      max_results: z
        .number()
        .optional()
        .describe("Maximum matching contacts to return, 1-100 (default 20)."),
    },
    async ({ query, max_results }) => {
      const result = await driveViaBridge("/contacts-search", {
        projectId: process.env.MARBLO_PROJECT || "",
        query,
        maxResults: max_results,
      });
      if (result.ok !== true) {
        return text(
          `Contacts 검색 실패: ${
            typeof result.error === "string" ? result.error : "알 수 없는 오류"
          }`,
        );
      }
      const payload = result.result as {
        contacts?: Array<{
          resourceName: string;
          names: string[];
          emails: Array<{ value: string; type?: string }>;
          phones: Array<{ value: string; type?: string }>;
          organizations: Array<{
            name?: string;
            title?: string;
            department?: string;
          }>;
        }>;
        totalScanned?: number;
        truncated?: boolean;
      };
      const contacts = payload.contacts ?? [];
      if (contacts.length === 0) {
        return text("조건에 맞는 Google Contacts 연락처가 없습니다.");
      }
      const lines = contacts.map((contact) => {
        const emails = contact.emails
          .map(
            (email) => `${email.value}${email.type ? ` (${email.type})` : ""}`,
          )
          .join(", ");
        const phones = contact.phones
          .map(
            (phone) => `${phone.value}${phone.type ? ` (${phone.type})` : ""}`,
          )
          .join(", ");
        const organizations = contact.organizations
          .map((org) =>
            [org.name, org.department, org.title].filter(Boolean).join(" / "),
          )
          .filter(Boolean)
          .join(", ");
        return [
          `- ${contact.names.join(", ") || "(이름 없음)"}`,
          `  resourceName: ${contact.resourceName}`,
          emails ? `  emails: ${emails}` : "",
          phones ? `  phones: ${phones}` : "",
          organizations ? `  organizations: ${organizations}` : "",
        ]
          .filter(Boolean)
          .join("\n");
      });
      const scanned =
        typeof payload.totalScanned === "number"
          ? ` (scanned: ${payload.totalScanned})`
          : "";
      const truncated = payload.truncated
        ? "\n(주의: 연락처 페이지 상한에 걸려 일부만 검색했습니다.)"
        : "";
      return text(
        `Google Contacts 연락처 ${contacts.length}개${scanned}:\n${lines.join(
          "\n",
        )}${truncated}`,
      );
    },
    { userFacing: false },
  );

  // send_slack_message — outbound reply to the project's Slack channel.
  // The mirror of send_telegram_message: the electron-owned SlackPoller holds
  // the bot token, the last-inbound channel and the thread to answer in; this
  // tool POSTs to the bridge which routes to poller.sendMessage. The token
  // NEVER crosses this boundary — we send only projectId/text/channelId/
  // threadTs, and any error returned is already token-scrubbed by the poller.
  auditedTool(
    "send_slack_message",
    "Reply to the project's Slack channel. Call this to answer a '[Slack " +
      "inbound ...]' message — a plain text response is NOT delivered to Slack, " +
      "only this tool is. Pass the threadTs from the inbound message so the reply " +
      "lands in the thread that asked (several people share one channel; an " +
      "un-threaded reply is hard to attribute). channelId defaults to the last " +
      "inbound channel for the project. Requires an active Slack channel and " +
      "MARBLO_BRIDGE_PORT.",
    {
      text: z.string().describe("Message text to send to Slack."),
      projectId: z
        .string()
        .optional()
        .describe(
          "Marblo project id. Defaults to MARBLO_PROJECT (the current context).",
        ),
      channelId: z
        .string()
        .optional()
        .describe(
          "Target channel id (e.g. C0123ABCDEF). Omit to reply to the last inbound channel for the project.",
        ),
      threadTs: z
        .string()
        .optional()
        .describe(
          "Thread to reply into — pass the threadTs from the '[Slack inbound ...]' message. " +
            'Omit to use the last inbound thread; pass "" to post to the channel instead of a thread.',
        ),
    },
    async ({ text: messageText, projectId, channelId, threadTs }) => {
      const targetProject = projectId || process.env.MARBLO_PROJECT || "";
      if (!targetProject) {
        return text(
          "Error: no projectId (set MARBLO_PROJECT or pass projectId).",
        );
      }
      const result = await sendSlackViaBridge(
        targetProject,
        messageText,
        channelId,
        threadTs,
      );
      if (!result.ok) {
        return text(
          `Failed to send Slack message: ${result.error || "unknown error"}`,
        );
      }
      return text(
        `Sent Slack message to channel ${result.channel ?? "(default)"}` +
          (result.threadTs ? ` in thread ${result.threadTs}.` : "."),
      );
    },
  );

  // ── 감사 원장 스풀 상태 (L1, §7) ──
  //
  // 후속 L2(룰 조이기)의 라이브 검증이 이 툴을 직접 쓴다. `audit_logs` 를
  // isProjectMember() 로 조이면 쓰는 쪽이 MCP 서버(에이전트 프로세스)인데, 이들이
  // project.members 소속 uid 로 인증하는지 확인 없이 조이면 전원의 감사 기록이
  // permission-denied 로 죽는다. 이 툴이 그 실패를 **보이게** 만드는 계기판이다
  // (§9 — 이 순서 자체가 안전장치).
  //
  // userFacing:false: read-only 진단이라 활동 스트림에 노이즈를 만들지 않는다.
  // 스풀 상태를 묻는 행위가 다시 감사 이벤트를 낳는 되먹임도 피한다.
  auditedTool(
    "get_ledger_spool_status",
    "Audit-ledger spool health for THIS MCP process: how many audit events are stuck, why the last write failed, and whether any were dropped past the cap. Use it to tell 'no record' apart from 'did not happen' — a non-zero dropped count means the ledger has a real gap.",
    {},
    async () => {
      const status = ledgerSpool().status();
      const lines = [formatSpoolStatus(status, Date.now())];
      if (lastSpoolNotice) {
        lines.push(
          `\n마지막 알림(${lastSpoolNotice.kind}): ${lastSpoolNotice.message}`,
        );
      }
      // ★"모른다"를 "괜찮다"로 답하지 않는다(§15). 이 툴이 답하는 범위를 명시한다.
      lines.push(
        // 프로세스 정체를 그대로 보여준다 — attributionAgentId() 는 오케 id 를 ""
        // 로 떨어뜨리므로 여기 쓰면 "agent=" 라는 빈 값이 나온다.
        `\n범위: 이 MCP 프로세스(agent=${MARBLO_AGENT_ID})가 기동한 이후만 관측합니다. ` +
          `이전 기동분은 디스크 스풀로 복원된 것에 한해 포함됩니다. ` +
          `다른 에이전트 프로세스의 스풀은 여기서 보이지 않습니다.`,
      );
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // ── 감사 뷰: 워크트리 목록 (L4, 설계 §9 4단계) ──
  //
  // 진입점은 워크트리 목록이다(설계 문서 지시). 디스크에 실재하는 워크트리와
  // 원장에서만 관측되는(물리 삭제된) 워크트리를 합쳐 보여준다 — ★삭제됐다고
  // 감사 대상에서 빠지면 안 된다는 것이 이 뷰의 핵심 요구다.
  auditedTool(
    "list_worktree_audit",
    "Audit view entry point: lists worktrees for this project — both ones that still exist on disk AND ones only known from the ledger (physically deleted, but their audit trail survives). Each row shows last agent/activity, chain-seal coverage (preLedger = unguaranteed), and merge status. Use this before drilling into get_worktree_audit for a specific one.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Locked to this orchestrator session's project like other list tools.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(200)
        .optional()
        .describe("Max rows to return (default 50)."),
    },
    async ({ project_id, limit }) => {
      const projectId = await enforceProjectLock(
        "list_worktree_audit",
        project_id,
      );
      const rowLimit = limit ?? LIST_LIMIT_DEFAULT;

      const diskIds = scanDiskWorktreeIds(projectId);
      const {
        events: scanned,
        scanned: scannedCount,
        capped,
      } = await scanLedgerAuditWindow(projectId);
      const ledgerIds = [...new Set(scanned.map((e) => e.worktreeId))];

      const known = unionKnownWorktrees(diskIds, ledgerIds);
      const eventsByWorktreeId = new Map<string, WorktreeAuditEvent[]>();
      for (const e of scanned) {
        const list = eventsByWorktreeId.get(e.worktreeId) ?? [];
        list.push(e);
        eventsByWorktreeId.set(e.worktreeId, list);
      }
      const taskIds = known.map((k) => k.worktreeId.split("/")[1] ?? "");
      const mergeByTaskId = await fetchMergeInfoByTaskId(projectId, taskIds);

      const rows = buildWorktreeAuditRows({
        known,
        eventsByWorktreeId,
        mergeByTaskId,
      });
      const shown = rows.slice(0, rowLimit);

      if (rows.length === 0) {
        return text(
          `이 프로젝트(${projectId})에서 워크트리를 찾지 못했습니다 — 디스크에도, ` +
            `최근 ${WORKTREE_LEDGER_SCAN_CAP}건 원장 스캔에도 없습니다.`,
        );
      }

      const lines = shown.map((r) => {
        const originTag =
          r.origin === "ledger"
            ? " [물리삭제됨]"
            : r.origin === "disk"
              ? " [원장활동없음]"
              : "";
        const merge = r.merged
          ? ` merged@${
              r.mergedAtMs ? new Date(r.mergedAtMs).toISOString() : "?"
            }`
          : "";
        const seal =
          r.preLedger > 0 ? ` seal=${r.sealed}/preLedger=${r.preLedger}` : "";
        const last =
          r.lastAgentId && r.lastEventAtMs
            ? `last=${r.lastAgentId}@${new Date(r.lastEventAtMs).toISOString()}`
            : "last=(스캔 창 안에 활동 없음)";
        return `- ${r.worktreeId}${originTag} ${last}${seal}${merge}`;
      });

      const footer: string[] = [];
      footer.push(
        `\n원장 스캔: 최근 ${scannedCount}건${
          capped
            ? `(상한 ${WORKTREE_LEDGER_SCAN_CAP}건 도달 — 그 이전에만 활동한 워크트리는 [원장활동없음]/누락일 수 있음)`
            : ""
        }.`,
      );
      if (rows.length > shown.length) {
        footer.push(
          `${rows.length - shown.length}개 행이 limit=${rowLimit} 에 가려짐.`,
        );
      }
      footer.push(
        "각 워크트리 딥다이브(지금 프로세스에 들어있는지/지워도 안전한지/그 " +
          "시점에 뭐가 돌았는지)는 get_worktree_audit(worktree_id=...) 를 쓰세요.",
      );

      return text([lines.join("\n"), ...footer].join("\n"));
    },
    { userFacing: false },
  );

  // ── 오케용 조회: 워크트리 딥다이브 (L4, 설계 §15 3질문) ──
  //
  // 설계 §15 가 명시한 3질문에 답한다:
  //   Q1 이 수정이 지금 도는 프로세스에 실제 들어있나
  //   Q2 이 워크트리는 어느 티켓·에이전트·PR 이고 지워도 안전한가
  //   Q3 이 결정이 내려진 시점에 무엇이 돌고 있었나
  // ★근거가 없으면 "unknown" 이라고 답한다 — 절대 괜찮다고 반올림하지 않는다.
  auditedTool(
    "get_worktree_audit",
    "Answers the orchestrator's 3 questions about ONE worktree/task, backed by the audit ledger + live checks. Q1 liveness: is this task's merged fix an ancestor of the commit THIS MCP process is running (git merge-base check against merge_history + the build's baked commit) — 'not-merged'/'unknown' when evidence is missing, never guessed. Q2 identity+safety: which task/agent(s)/PR touched this worktree (ledger join) and whether it looks safe to delete (dirty/unpushed/agent-busy evidence — 'unknown' wins over 'safe' when any axis is unconfirmed; final delete policy still belongs to the main process's reapSafety()). Q3 activity window: ledger action-events near a given timestamp (default: latest event), with an explicit caveat that lifecycle 'process started' events are not produced yet so an empty window is NOT proof nothing was running.",
    {
      worktree_id: z
        .string()
        .optional()
        .describe("<projectId>/<taskId>. Either this or task_id is required."),
      task_id: z
        .string()
        .optional()
        .describe("Task ID. Either this or worktree_id is required."),
      project_id: z
        .string()
        .optional()
        .describe("Project ID. Locked to this orchestrator session's project."),
      at_ms: z
        .number()
        .optional()
        .describe(
          "Epoch ms for Q3's decision-time window. Defaults to the worktree's latest ledger event time.",
        ),
    },
    async ({ worktree_id, task_id, project_id, at_ms }) => {
      const projectId = await enforceProjectLock(
        "get_worktree_audit",
        project_id,
      );
      const target = resolveWorktreeTarget(projectId, { worktree_id, task_id });
      if ("error" in target) return text(`Error: ${target.error}`);
      const { taskId, worktreeId } = target;

      const [events, mergeRows, task] = await Promise.all([
        fetchWorktreeLedgerEvents(projectId, worktreeId),
        fetchMergeHistoryForTask(projectId, taskId),
        fetchTask(taskId),
      ]);
      const mergeInfo = pickLatestMerge(mergeRows);
      const existsOnDisk = worktreeExistsOnDisk(worktreeId);
      const agentIds = [
        ...new Set(events.map((e) => e.agentId).filter(Boolean)),
      ];
      const sortedDesc = [...events].sort(
        (a, b) => b.occurredAtMs - a.occurredAtMs,
      );
      const lastAgentId = sortedDesc[0]?.agentId ?? task?.claimedBy ?? null;

      // Q1
      const bakedCommit = bakedBuildStamp()?.commit ?? null;
      const ancestorResult =
        mergeInfo?.headSha && bakedCommit
          ? await checkAncestor(ghWorkingDir(), mergeInfo.headSha, bakedCommit)
          : "unknown";
      const liveness = describeProcessLiveness({
        mergeInfo,
        bakedCommit,
        ancestorResult,
      });

      // Q2
      const gitEvidence = existsOnDisk
        ? await gitWorktreeSafetyEvidence(worktreeDiskPath(worktreeId))
        : { dirty: null, unpushedCount: null };
      const agentBusy = await checkAgentBusy(lastAgentId, projectId);
      const safety = describeSafeToDelete({
        existsOnDisk,
        dirty: gitEvidence.dirty,
        unpushedCount: gitEvidence.unpushedCount,
        agentBusy,
      });

      // Q3
      const windowEvents: ActivityWindowEvent[] = events.map((e) => ({
        toolName: e.toolName,
        occurredAtMs: e.occurredAtMs,
        agentId: e.agentId,
        success: e.success,
        kind: e.kind,
      }));
      const atMs = at_ms ?? sortedDesc[0]?.occurredAtMs ?? Date.now();
      const activity = describeActivityAtDecisionTime(
        windowEvents,
        atMs,
        10 * 60_000,
      );

      const { sealed, preLedger } = summarizeSealStatus(events);

      const lines = [
        `워크트리: ${worktreeId} (exists on disk: ${existsOnDisk})`,
        `티켓: ${taskId}${
          task ? ` — ${task.title} [${task.status}]` : " (태스크 문서 없음)"
        }`,
        `원장에서 관측된 에이전트: ${
          agentIds.length ? agentIds.join(", ") : "(없음)"
        }`,
        `PR: ${task?.prUrl || "(none)"}${
          mergeInfo
            ? ` / merge_history: branch=${mergeInfo.branch ?? "?"} headSha=${
                mergeInfo.headSha ?? "?"
              } mergedAt=${new Date(mergeInfo.mergedAtMs).toISOString()}`
            : " / merge_history: (기록 없음)"
        }`,
        `체인 커버리지: sealed=${sealed} preLedger(무결성 미보증)=${preLedger}`,
        "",
        `Q1. 지금 도는 프로세스에 들어있나 → [${liveness.status}] ${liveness.detail}`,
        `Q2. 지워도 안전한가 → [${safety.verdict}] ${safety.reasons.join(" ")}`,
        `Q3. ${new Date(atMs).toISOString()} 시점 활동(±10분) → ${
          activity.events.length
            ? activity.events
                .map(
                  (e) =>
                    `${new Date(e.occurredAtMs).toISOString()} ${e.agentId} ${
                      e.toolName
                    }${e.success ? "" : "(fail)"}`,
                )
                .join("; ")
            : "(창 안에 기록된 활동 없음)"
        }\n    ${activity.caveat}`,
      ];
      return text(lines.join("\n"));
    },
    { userFacing: false },
  );

  // ── 효과집계 입력 로딩 (get_routing_effectiveness · get_model_guidance 공용) ──
  //
  // 두 툴이 같은 모집단을 봐야 한다. 로딩을 각자 쓰면 한쪽만 `deleted` 를 거르거나
  // 한쪽만 dispatchMeta 필드를 새로 읽는 식으로 조용히 갈라지고, 그러면 같은 질문에
  // 두 답이 나온다. 쿼리 규율은 원래 get_routing_effectiveness 의 것 그대로:
  // status 로 필터하지 않는다 — (projectId, status) 복합 인덱스를 새로 요구하지
  // 않으려는 것도 있지만, 더 중요하게는 "진행중 몇 건이 제외됐나" 를 리포트가
  // 말해야 하기 때문이다(쿼리에서 지우면 그 수를 셀 수 없다).
  async function loadEffectivenessRows(
    projectId: string | undefined,
    cap: number,
    caller: string,
  ): Promise<EffectivenessInputRow[]> {
    const snap = await boundedGetDocs(
      "tasks",
      projectId,
      [],
      [fsLimit(cap)],
      caller,
    );
    const rows: EffectivenessInputRow[] = [];
    for (const d of snap.docs) {
      const data = d.data() as Record<string, unknown>;
      if (data.deleted === true) continue;
      const meta = (data.dispatchMeta ?? {}) as Record<string, unknown>;
      const str = (v: unknown): string | null =>
        typeof v === "string" && v.trim() ? v : null;
      rows.push({
        taskId: d.id,
        status: str(data.status),
        spawnedModelKey: str(meta.spawnedModelKey),
        provider: str(meta.model),
        complexity: str(meta.complexity),
        taskType: str(meta.taskType),
        role: str(meta.role) ?? str(data.role),
        costTotal: typeof data.costTotal === "number" ? data.costTotal : null,
      });
    }
    return rows;
  }

  // 33-b. get_routing_effectiveness (P2-4)
  //
  // 라우팅 에픽이 측정하려던 지표를 실제로 계산해 돌려준다:
  // (model@effort × 난도 × taskType) → 성공률 · 평균비용 · 비용당성공.
  //
  // 조인은 `tasks/{id}` 안에서 이미 끝나 있다 — costTotal 롤업(cost_logs 와 같은
  // taskId 스탬프)과 dispatchMeta(실스폰 model@effort·난도·taskType)와 상태가 한
  // 문서에 있다. 정의·규율은 ./routing-effectiveness.ts 헤더.
  auditedTool(
    "get_routing_effectiveness",
    "라우팅 효과집계: (model@effort × 난도 × taskType) 별 성공률·평균비용·비용당성공. 터미널 티켓(DONE/FAILED/BLOCKED)만 세고, 비용 롤업이 없는 티켓은 비용 분모에서 빼고 커버리지로 보고한다(누락을 0 으로 만들지 않는다). 어느 모델 칸을 쓸지 판단하기 전에 근거를 확인할 때 쓴다 — 임계값·판정은 주지 않는다.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          "스캔할 티켓 수 상한(기본 500). 상한에 걸리면 리포트가 그 사실을 명시한다.",
        ),
    },
    async ({ project_id, limit }) => {
      const projectId = await enforceProjectLock(
        "get_routing_effectiveness",
        project_id,
      );
      const cap = limit ?? 500;
      const rows = await loadEffectivenessRows(
        projectId,
        cap,
        "get_routing_effectiveness",
      );
      return text(
        formatEffectivenessReport(aggregateEffectiveness(rows), {
          scanned: rows.length,
          cap,
        }),
      );
    },
    { userFacing: false },
  );

  // 33-c. get_model_guidance
  //
  // get_routing_effectiveness 와 겹치지 않는다. 그쪽은 **동적만** 답한다("우리
  // 보드에서 무엇이 성공했나"). 이 툴은 그 동적 절반에 **정적 절반**(레지스트리
  // 단가·능력등급·컨텍스트 · 공개 SWE-bench 원문 · 파생 티어)을 합쳐 "이 티켓을
  // 어느 칸에 줄까" 라는 질문 하나에 답하도록 만든 선택지원 뷰다. 콜드일 때
  // get_routing_effectiveness 는 할 말이 없지만 이 툴은 정적 근거를 준다.
  //
  // ★새 수치를 만들지 않는다. 정적은 브리지가 넘긴 참조표 원문 그대로, 동적은
  // 위 loadEffectivenessRows + aggregateEffectiveness 그대로다. 합류·서술만
  // model-guidance-report.ts 가 한다. 종합점수/추천 한 줄도 만들지 않는다 —
  // 서로 다른 벤치와 얇은 표본을 한 숫자로 뭉개면 그게 근거처럼 읽힌다.
  auditedTool(
    "get_model_guidance",
    "모델 선택 지식 통합: 하네스별 **잔여 쿼터 실측**(자동선택이 읽는 그 수치 — 예비선 이하면 경고) + 모델별 정적 사실(레지스트리 단가·능력등급·지원 effort·컨텍스트 창 + 공개 SWE-bench 점수 원문(벤치·스캐폴드·출처·일자 동반) + 파생 티어(프리미어/일반작업/가성비)) + 동적 실적(우리 보드의 성공률·평균비용·비용당성공)을 한 번에 돌려준다. dispatch_task/spawn_agent 로 모델을 고르기 전에, 특히 **모델을 명시 핀하기 전에** 확인할 것 — 명시 핀은 자동선택의 쿼터 게이트를 우회한다. 임계값·추천·종합점수는 주지 않는다 — 판정은 호출자가 한다. 칸별 (난도 × taskType) 세부는 get_routing_effectiveness 쪽이다.",
    {
      project_id: z
        .string()
        .optional()
        .describe(
          "Project ID. Honored, and locked to this orchestrator session's project: a different project is refused with an error rather than silently answered for the bound project.",
        ),
      model: z
        .string()
        .optional()
        .describe(
          "모델 id 또는 alias 로 한 행만 보기(부분일치). 생략하면 활성 레지스트리 전체.",
        ),
      limit: z
        .number()
        .int()
        .min(1)
        .max(2000)
        .optional()
        .describe(
          "동적 절반이 스캔할 티켓 수 상한(기본 500). 상한에 걸리면 리포트가 그 사실을 명시한다.",
        ),
    },
    async ({ project_id, model, limit }) => {
      const projectId = await enforceProjectLock(
        "get_model_guidance",
        project_id,
      );
      const cap = limit ?? 500;

      // 동적 절반은 이 프로세스가 직접 만든다(Firestore 접근이 여기 있다).
      const rows = await loadEffectivenessRows(
        projectId,
        cap,
        "get_model_guidance",
      );
      const report = aggregateEffectiveness(rows);
      const rollups = rollupEffectivenessByModel(report);

      // 정적 절반은 메인 프로세스만 가진다(rootDir 경계). 못 받으면 **조용히
      // 반쪽을 정상인 척하지 않는다** — 사유를 먼저 말하고, 그래도 손에 있는
      // 동적 절반은 get_routing_effectiveness 와 같은 표로 붙여 준다(빈손으로
      // 돌려보내면 오케가 그냥 기억으로 고른다).
      const staticPayload = await fetchModelGuidanceStatic();
      if (!staticPayload.payload) {
        return text(
          formatModelGuidance([], {
            scanned: rows.length,
            cap,
            staticError: staticPayload.error,
            filter: model ?? null,
            // 정적 절반을 못 받았으면 쿼터도 같이 없다(같은 응답에 실려 온다).
          }) +
            "\n\n" +
            formatEffectivenessReport(report, { scanned: rows.length, cap }),
        );
      }

      // 티어는 **전체 행**으로 파생한 뒤 필터한다(중앙값 기준이라 부분집합으로
      // 계산하면 model= 을 줄 때마다 티어가 달라진다).
      const merged = mergeModelGuidance(staticPayload.payload, rollups);
      const needle = (model ?? "").trim().toLowerCase();
      const shown = needle
        ? merged.filter(
            (r) =>
              r.static.modelId.toLowerCase().includes(needle) ||
              r.static.aliases.some((a) => a.toLowerCase().includes(needle)),
          )
        : merged;

      return text(
        formatModelGuidance(shown, {
          scanned: rows.length,
          cap,
          filter: model ?? null,
          quota: staticPayload.payload.quota ?? null,
        }),
      );
    },
    { userFacing: false },
  );

  // 34. merge_and_close
  //
  // Closes the loop that submit_for_review deliberately leaves open. Today the
  // ticket flip and the actual merge are two unrelated paths — `gh pr merge`
  // (orchestrator, via shell) and the app's Merge button both land code without
  // touching the ticket, so tickets stick at REVIEW and their worktrees stay
  // registered. Measured on 2026-07-25: 9 merges, 13 REVIEW tickets left behind,
  // all of them re-read later as "needs merging".
  //
  // Covers BOTH merge paths, because it is triggered explicitly rather than
  // hooked into either one:
  //   • gh merge  — worktree still on disk → status flip + reap.
  //   • app merge — worktree:merge already tore the worktree down and wrote
  //     merge_history, so the reap reports "no worktree for task" and only the
  //     status flip is left. Idempotent either way.
  auditedTool(
    "merge_and_close",
    "Close out a merged ticket atomically: verify the PR really is merged, flip the ticket to DONE through the normal state machine, and reap its now-stale worktree. Refuses to change anything if the PR is still open or conflicting, and holds the ticket at REVIEW (with a reason) when the ticket says follow-up work is still outstanding — code merged is not the same as work done. Call it right after merging a PR. Pass dry_run=true to see the verdict without writing.",
    {
      task_id: z.string().describe("Task ID to close out"),
      pr_number: z
        .number()
        .int()
        .positive()
        .optional()
        .describe(
          "PR number. Defaults to the PR recorded on the ticket, then to the task's worktree branch.",
        ),
      branch: z
        .string()
        .optional()
        .describe("Branch name, if the ticket has no PR URL recorded"),
      dry_run: z
        .boolean()
        .optional()
        .describe(
          "Report the verdict without changing anything (default: false)",
        ),
    },
    async ({ task_id, pr_number, branch, dry_run }) => {
      const task = await fetchTask(task_id);
      if (!task) return text(`Error: Task ${task_id} not found.`);

      const merge = await resolveMergeVerdict({
        taskId: task_id,
        ...(pr_number !== undefined ? { prNumber: pr_number } : {}),
        ...(branch !== undefined ? { branch } : {}),
        prUrl: task.prUrl,
      });

      const verdict = evaluateMergeCloseout({
        status: task.status,
        merge,
        comment: task.comment,
        description: task.description,
        notes: task.notes ?? null,
      });

      const prLabel = merge.prNumber ? `#${merge.prNumber}` : "(미확인)";
      const lines: string[] = [
        `태스크: "${task.title}" (${task.status}, id=${task_id})`,
        `PR ${prLabel}: ${merge.state}${
          merge.detail ? ` — ${merge.detail}` : ""
        }`,
        `판정: ${verdict.action} — ${verdict.reason}`,
      ];

      if (dry_run) {
        lines.push(
          `\n(dry_run — 아무것도 바꾸지 않았다. 실제 마감은 dry_run 없이 다시 호출.)`,
        );
        return text(lines.join("\n"));
      }

      // ── Status transitions ──────────────────────────────────
      // Every hop is a legal edge and is re-validated inside the transaction.
      // force=true is NEVER used here: the whole point is that an automated
      // closeout must not be able to do something a human couldn't.
      let current: TaskStatus = task.status;
      const applied: TaskStatus[] = [];
      for (const next of verdict.path) {
        const from = current;
        const mut: ApplyProjectionInput = {
          newStatus: next,
          lastAgentId: WORKER_AGENT_ID,
          lastActivitySummary:
            next === "DONE"
              ? `merge_and_close: PR ${prLabel} 머지 확인 → DONE`
              : `merge_and_close: ${verdict.reason}`,
          validateFrom: (s) => canTransition(s, next),
        };
        try {
          await applyProjection(db, task_id, mut);
          applied.push(next);
          current = next;
        } catch (err) {
          lines.push(
            `\n⚠️ ${from} → ${next} 전이 실패 (동시에 다른 곳에서 상태가 바뀌었을 수 있다): ` +
              `${err instanceof Error ? err.message : String(err)}`,
          );
          break;
        }
      }

      // The hold reason is the whole value of a HOLD_REVIEW — without it the
      // ticket just looks ignored. Written even when there was no status hop
      // (the common case: the ticket is already at REVIEW).
      // ★이 티켓에서 유일하게 **무조건** 걸리는 자리다(빠져나갈 인자가 없다).
      // 근거: ①`evaluateMergeCloseout` 이 이미 "PR 은 머지됐는데 후속이 남았다"
      // 를 판정했으므로 새 감지도, 새 오탐도 만들지 않는다. ②머지 마감은 "코드는
      // 끝났는데 일은 안 끝났다" 가 확정되는 유일한 순간이고, 여기서 안 적으면 그
      // 사실은 티켓 comment 에만 남고 오케 머릿속에서 사라진다(2026-08-22 세 번째
      // 실측 사례가 정확히 이것 — 머지한 티켓 둘을 REVIEW 로 방치했다).
      // 항목에는 그 티켓을 taskIds 로 붙이므로 완료 판정은 여전히 **보드**가 한다.
      let holdCaptureNote = "";
      if (verdict.action === "HOLD_REVIEW") {
        const holdCapture = await captureMergeHoldFollowUp(db, {
          projectId: task.projectId || DEFAULT_PROJECT,
          by: MARBLO_AGENT_ID,
          taskId: task_id,
          taskTitle: task.title,
          signals: verdict.followupSignals,
          reason: verdict.reason,
        });
        holdCaptureNote = holdCapture.note;
        try {
          await applyProjection(db, task_id, {
            lastAgentId: WORKER_AGENT_ID,
            lastActivitySummary: `merge_and_close: DONE 보류 — ${verdict.followupSignals.join(
              ", ",
            )}`,
            extraTaskFields: { comment: verdict.reason },
            activityPayload: {
              agentId: MARBLO_AGENT_ID,
              message: `[merge_and_close] PR ${prLabel} 머지 확인. ${verdict.reason}`,
            },
          });
        } catch (err) {
          lines.push(
            `\n⚠️ 보류 사유 기록 실패: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }

      if (applied.length > 0) {
        lines.push(`상태: ${task.status} → ${applied.join(" → ")}`);
        // 워크체인 재열람 지점 — 머지 마감은 오케가 "다음" 을 잊기 가장 쉬운 자리다.
        const chainNudge = await workChainNudgeAfterTransition(
          db,
          task.projectId || DEFAULT_PROJECT,
          task_id,
          task.status,
          current,
        );
        if (chainNudge) lines.push(chainNudge);
      }

      // Dependents must be resolved on DONE or the gate sticks (PR#507).
      if (applied.includes("DONE")) {
        const unblocked = await resolveDependentsAfterDone(
          task_id,
          task.contextId,
          task.projectId || DEFAULT_PROJECT,
        );
        if (unblocked > 0) {
          lines.push(`의존 태스크 ${unblocked}건 해제됨.`);
        }
        // update_task_status 와 같은 자리 — DONE 에 이르는 두 경로가 암묵적
        // 미션 마감에서 갈리면 merge_and_close 로 닫은 묶음만 Replay 가 안 뜬다.
        const closedMission = await closeImplicitMissionIfComplete(
          task.contextId,
        );
        if (closedMission) {
          lines.push(
            `Mission Replay: 묶음 완료 — missionId=${closedMission} 가 완료이력 탭에 뜹니다.`,
          );
        }
        // ★전진 신호도 같은 자리 (티켓 Sf8Id64jLeyDvWIS4cub). 후크를 DONE 에 건
        // 근거가 "머지는 이미 DONE 으로 흘러들어온다" 인데, DONE 에 이르는 경로가
        // 둘이라 여기에도 걸어야 그 근거가 실제로 성립한다.
        // ★HOLD_REVIEW(머지됐지만 후속 남음)는 applied 에 DONE 이 없어 여기 못
        // 온다 — 그게 의도다. 코드 머지 ≠ 작업 완료.
        const advanceNote = await signalMissionAdvanceAfterDone(task_id, task);
        if (advanceNote) lines.push(advanceNote.trim());

        // ★그 위 계층 — 미션이 닫혔으면 다음 미션으로 (티켓 F2TAJlSgSP8Ag1qJNkp1).
        // update_task_status 와 **같은 자리**다. DONE 에 이르는 경로가 둘인데
        // 한쪽에만 걸면 머지로 닫힌 미션은 영영 다음으로 안 넘어간다.
        if (closedMission) {
          const handoffNote = await handleMissionHandoffAfterClose(
            closedMission,
            task,
            task_id,
          );
          if (handoffNote) lines.push(handoffNote.trim());
        }
      }

      // ── Worktree hygiene ────────────────────────────────────
      if (verdict.reapWorktree) {
        const reap = await reapTaskWorktree(task_id);
        lines.push(
          reap.removed
            ? `워크트리 정리: 제거됨 (${reap.reason})${
                reap.path ? ` — ${reap.path}` : ""
              }`
            : `워크트리 정리: 건너뜀 — ${reap.reason}`,
        );
        if (!reap.removed && /uncommitted|preserved/i.test(reap.reason)) {
          // Never destroy uncommitted work to tidy a listing. A stray worktree
          // is cheap; a clobbered untracked doc is not.
          lines.push(
            `  ⚠️ 커밋되지 않은 변경이 남아 있어 보존했다. 내용을 확인하고 직접 정리해라.`,
          );
        }
      }

      const wikiPrompt = await mergeWikiDecisionPromptForResponse(
        task,
        merge,
        prLabel,
      );
      if (wikiPrompt) {
        lines.push(wikiPrompt);
      }

      return text(withCaptureNote(lines.join("\n"), holdCaptureNote));
    },
  );

  // ── 스코핑 결과를 stderr 에 남긴다 ────────────────────────────────────────
  // "그 툴이 왜 안 보이지?" 를 라이브에서 즉시 판별할 수 있어야 한다. stdout 은
  // JSONRPC 프레임이므로 절대 쓰지 않는다(index.ts 와 같은 규율).
  if (surface.mode === "scoped") {
    console.error(
      `[MCP] tools/list scoped: role=${surface.role || "?"} reason=${
        surface.reason
      } ` +
        `exposed=${surface.allowed ? surface.allowed.size : "all"} hidden=${
          hiddenTools.length
        }` +
        ` (rollback: MARBLO_TOOL_SURFACE=full)`,
    );
    // 화이트리스트에 있는데 실제로는 존재하지 않는 이름(오타·툴 개명)은 조용한
    // 능력 손실이 아니라 조용한 무효 항목이다. 눈에 보이게 경고한다.
    const registered = new Set([...hiddenTools, ...registeredToolNames]);
    const unknown = [...(surface.allowed ?? [])].filter(
      (t) => !registered.has(t),
    );
    if (unknown.length > 0) {
      console.error(
        `[MCP] ⚠️ tool surface allowlist references unknown tools: ${unknown.join(
          ", ",
        )}`,
      );
    }
  }
}
