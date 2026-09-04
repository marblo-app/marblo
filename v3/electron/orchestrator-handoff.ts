import {
  buildMissionMembership,
  buildWorkChainHandoff,
  deriveWorkChain,
  type MissionMembershipSource,
  type MissionMemberTask,
  type TaskStatusLookup,
  type WorkChainHandoffCarry,
  type WorkChainItem,
  type WorkChainTaskStatus,
} from "./mcp-server/work-chain-core";
import { isImplicitMissionDoc } from "./mcp-server/implicit-mission";

export type OrchestratorSwitchMode = "wait" | "takeover";
export type OrchestratorSwitchResumeMode = "fresh" | "previous";

export interface HandoffSourceSession {
  ptySessionId: string | null;
  claudeSessionId?: string;
  model?: string;
}

export interface RawHandoffDoc {
  id: string;
  data: Record<string, unknown>;
}

export interface HandoffTimelineEntry {
  ts: string;
  type: string;
  summary: string;
}

export interface OrchestratorHandoffSnapshot {
  projectId: string;
  rootPath: string;
  from: HandoffSourceSession & {
    stoppedAt: number;
  };
  to: {
    model: string;
    resumeSessionId: "new" | string;
  };
  activeMissions: Array<{
    id: string;
    goal: string;
    status: string;
    currentStepIndex: number;
    currentStep?: {
      index: number;
      type: string;
      status: string;
      skill?: string;
      args?: string;
      liveOutputTail?: string;
    };
    taskIds: string[];
    recentTimeline: HandoffTimelineEntry[];
    unresolvedDecisions: string[];
  }>;
  board: {
    inFlightTasks: Array<{
      id: string;
      title: string;
      status: string;
      role: string;
      claimedBy: string | null;
      missionId?: string;
      updatedAt?: string;
    }>;
    blockedTasks: Array<{
      id: string;
      title: string;
      comment?: string;
    }>;
    reviewTasks: Array<{
      id: string;
      title: string;
      prUrl?: string;
    }>;
  };
  /**
   * 오케의 "다음에 할 일" 목록(`workChains/{projectId}`) — 세션이 갈려도 따라가야
   * 하는 유일한 비-보드 상태(티켓 itSrsErpvtwUEcI4Deif).
   *
   * ★**항목만** 담는다. ready/waiting/done 은 담지 않는다 — 새 세션이
   * `get_work_chain` 으로 보드에서 다시 파생한다(`deriveWorkChain` 단일 소스).
   * 체인 문서를 못 읽었으면 필드 자체가 없다(fail-open — 체인 때문에 스위치가
   * 죽지 않는다). "없음" 과 "빈 체인"(items=[], openCount=0)은 다른 사실이다.
   */
  workChain?: WorkChainHandoffCarry;
}

export interface HandoffSummary {
  activeMissionCount: number;
  inFlightTaskCount: number;
  unresolvedDecisionCount: number;
  /** 스냅샷 시점의 열린 체인 항목 수. 체인을 못 읽었으면 0. */
  openWorkChainCount: number;
}

export interface BuildHandoffInput {
  projectId: string;
  rootPath: string;
  from: HandoffSourceSession;
  targetModel: string;
  resumeSessionId: "new" | string;
  missions: RawHandoffDoc[];
  tasks: RawHandoffDoc[];
  /**
   * 체인 문서 원본(`readWorkChain` 결과). 못 읽었으면 넘기지 않는다 —
   * 스냅샷의 `workChain` 이 통째로 빠져 "체인을 확인 못 했다" 가 드러난다.
   */
  workChain?: { items: WorkChainItem[]; rev: number };
  now?: number;
}

/**
 * Harnesses whose sessions live in a per-orchestrator ISOLATED HOME rather
 * than in `~/.claude/projects`, and which are resumed by a native
 * "most recent" sentinel instead of a concrete uuid:
 *
 *   gpt  → `codex resume --last`
 *   grok → `grok --continue`
 *
 * For these the Claude resolver must never run: it scans ~/.claude and would
 * return a CLAUDE uuid, which the foreign CLI cannot find. Both die on it —
 * `codex resume <unknown-id>` exits 1, and `grok --resume <unknown-id>` misses
 * locally, falls through to the remote session registry and 404s (verified
 * live against grok 0.2.112). Because each home is scoped to one orchestrator,
 * the "latest" sentinel is unambiguously *this* orchestrator's own session.
 */
export function usesIsolatedHomeSentinelResume(targetModel: string): boolean {
  return targetModel === "gpt" || targetModel === "grok";
}

export interface ResolveSwitchHandoffResumeInput {
  resume: OrchestratorSwitchResumeMode;
  targetModel: string;
  /** Does this orchestrator's isolated CLI home hold a resumable session? */
  hasSavedIsolatedHomeSession: () => boolean;
  resolvePreviousNonGptSession: () => string | null | undefined;
}

export function resolveSwitchHandoffResumeSessionId({
  resume,
  targetModel,
  hasSavedIsolatedHomeSession,
  resolvePreviousNonGptSession,
}: ResolveSwitchHandoffResumeInput): "new" | string {
  if (resume !== "previous") return "new";
  if (usesIsolatedHomeSentinelResume(targetModel)) {
    return hasSavedIsolatedHomeSession() ? "latest" : "new";
  }
  return resolvePreviousNonGptSession() ?? "new";
}

export interface ResolveRestartResumeInput {
  targetModel: string;
  /** Does this orchestrator's isolated CLI home hold a resumable session? */
  hasSavedIsolatedHomeSession: () => boolean;
  resolvePreviousNonGptSession: () => string | null | undefined;
}

/**
 * Prior-session id for a RESTART (stop→start, cold boot, wake-reconnect), or
 * null when there is nothing to resume.
 *
 * Session identity is per-CLI, so resolution must be model-aware:
 *
 *  - Claude keys sessions by uuid under `~/.claude/projects/<encoded>` and is
 *    resumed by `--resume <uuid>`, so it needs a concrete id.
 *  - Codex / Grok keep their sessions in the per-orchestrator isolated home
 *    (`codex-home-orchestrator-<projectId>` / `grok-home-orchestrator-<projectId>`)
 *    and are resumed by a native "most recent" sentinel — `codex resume --last`
 *    / `grok --continue` — for which "latest" is our sentinel. Because that
 *    home is scoped to this one orchestrator, it unambiguously names *this*
 *    orchestrator's own last session. See usesIsolatedHomeSentinelResume.
 *
 * Passing a Claude uuid to Codex is not a no-op — `codex resume <unknown-id>`
 * exits 1 with "No saved session found with ID ...", so the orchestrator died
 * on every restart. Keep the Claude resolver strictly off those paths.
 *
 * Mirrors resolveSwitchHandoffResumeSessionId (the switch path, which was
 * already model-aware — which is why switching worked while restarting did
 * not), but returns null rather than "new" so callers can tell "no prior
 * session" apart from "resume this" and pick their own fallback.
 */
export function resolveRestartResumeSessionId({
  targetModel,
  hasSavedIsolatedHomeSession,
  resolvePreviousNonGptSession,
}: ResolveRestartResumeInput): string | null {
  if (usesIsolatedHomeSentinelResume(targetModel)) {
    return hasSavedIsolatedHomeSession() ? "latest" : null;
  }
  return resolvePreviousNonGptSession() ?? null;
}

/**
 * How a project's saved orchestrator model was chosen.
 *
 * - `user`: settings panel / model switch / explicit launch request persisted
 *   the value — always respected on later resolves.
 * - `auto`: product priority pick (Claude > Codex > Grok among authenticated
 *   natives) wrote the value — re-probed on every resolve so a later Claude
 *   install can promote off a previously auto-pinned Grok.
 *
 * Missing/unknown source is treated as `auto` (legacy app-state wrote only
 * the model string before this flag existed; those rows are almost always
 * launch-success echoes of the auto path).
 */
export type OrchestratorModelSelectionSource = "user" | "auto";

export interface EffectiveOrchestratorModelInput {
  /** MARBLO_ORCHESTRATOR_MODEL passed at app boot — dev override, wins all. */
  envOverride?: string | null;
  /** Model the renderer explicitly requested for THIS launch (panel Start). */
  explicit?: string | null;
  /** Model this project's orchestrator last ran with (restart continuity). */
  perProject?: string | null;
  /**
   * Provenance of `perProject`. Only `"user"` freezes the stored harness;
   * `"auto"` / missing re-evaluates against `autoFallback`.
   */
  perProjectSource?: OrchestratorModelSelectionSource | null;
  /**
   * Global app-state setting (settings / onboarding wrote a value).
   * Empty/null means **unset** — auto-select may run. Do not pass the hard
   * default `"claude"` here when the user never chose a model; that would
   * block autoFallback.
   */
  globalSetting?: string | null;
  /**
   * Auto-picked harness among connected+authenticated natives
   * (Claude > Codex > Grok). Used when env/explicit/user-per-project/global
   * leave room for auto — including re-eval of a previously auto-saved
   * per-project value when a higher-priority harness is now ready.
   */
  autoFallback?: string | null;
}

/** True when the stored per-project model must not be auto-overridden. */
export function isUserSelectedOrchestratorSource(
  source: OrchestratorModelSelectionSource | null | undefined,
): boolean {
  return source === "user";
}

/**
 * Whether resolve should auth-probe natives for auto pick / re-eval.
 *
 * User-explicit per-project (or env / this-launch explicit) never probes.
 * Auto (or legacy missing-source) per-project always probes so Claude can
 * promote over a previously auto-saved Grok. With no per-project value,
 * probe only when global is also unset (same as pre-flag behaviour).
 */
export function needsOrchestratorAutoProbe(input: {
  envOverride?: string | null;
  explicit?: string | null;
  perProject?: string | null;
  perProjectSource?: OrchestratorModelSelectionSource | null;
  globalSetting?: string | null;
}): boolean {
  if (input.envOverride) return false;
  if (input.explicit) return false;
  if (
    input.perProject &&
    isUserSelectedOrchestratorSource(input.perProjectSource)
  ) {
    return false;
  }
  // Auto / legacy per-project: re-evaluate every resolve.
  if (input.perProject) return true;
  if (input.globalSetting) return false;
  return true;
}

/**
 * Provenance tag to persist after a successful resolve.
 * Explicit / user-memory / global → `user`; auto re-eval / first auto → `auto`.
 */
export function classifyOrchestratorSelectionSource(
  input: EffectiveOrchestratorModelInput,
): OrchestratorModelSelectionSource {
  if (input.envOverride) return "user";
  if (input.explicit) return "user";
  if (
    input.perProject &&
    isUserSelectedOrchestratorSource(input.perProjectSource)
  ) {
    return "user";
  }
  // Auto per-project path (including re-promotion via autoFallback).
  if (input.perProject) return "auto";
  if (input.globalSetting) return "user";
  return "auto";
}

/** Harness key for comparing auto-stored compounds vs preferred harness. */
function orchestratorHarnessKey(value: string): string {
  const raw = (value ?? "").trim().toLowerCase();
  if (!raw) return "";
  const at = raw.lastIndexOf("@");
  const body = at > 0 ? raw.slice(0, at) : raw;
  const sep = body.indexOf(":");
  const harness = sep < 0 ? body : body.slice(0, sep);
  return harness === "gpt" ? "codex" : harness;
}

/**
 * Which model an orchestrator (re)launch should use.
 *
 * The restart-continuity contract: resuming a session only makes sense on the
 * model that owns it. The global `orchestratorModel` app-state is a single
 * value shared by every project, so "start project B on codex" used to flip
 * project A's next restart to codex too — A's claude conversation exists but
 * codex can't see it, so A boots a FRESH codex session and the user reads it
 * as "껐다 켜면 오케 세션 연결이 안 된다" (live incident 2026-07-18, ticket
 * 0zV1apB3CvIiabHlYHxQ). Per-project memory must therefore outrank the global
 * setting, and an explicit user choice for this launch outranks both.
 *
 * Auto-selected per-project values are different: they are product-priority
 * echoes, not a user lock. On resolve they re-run against `autoFallback`
 * (auth-probed Claude > Codex > Grok) so reinstalling Claude promotes off a
 * Grok-only auto pin. User-tagged per-project values stay frozen.
 *
 * When nothing is set, `autoFallback` wins over the hard-coded `"claude"`
 * safety default — so a machine with only Grok signed in does not launch
 * into a Claude needs_auth wall.
 *
 * Inputs are raw setting strings ("claude" | "codex" | "antigravity" | ...);
 * normalization/validation stays with the caller.
 */
export function resolveEffectiveOrchestratorModelSetting({
  envOverride,
  explicit,
  perProject,
  perProjectSource,
  globalSetting,
  autoFallback,
}: EffectiveOrchestratorModelInput): string {
  if (envOverride) return envOverride;
  if (explicit) return explicit;
  if (perProject && isUserSelectedOrchestratorSource(perProjectSource)) {
    return perProject;
  }
  // Auto / legacy per-project: prefer a fresh priority pick when available.
  if (perProject) {
    if (autoFallback) {
      // Same harness → keep stored (preserves compound model pin if any).
      if (
        orchestratorHarnessKey(perProject) ===
        orchestratorHarnessKey(autoFallback)
      ) {
        return perProject;
      }
      return autoFallback;
    }
    return perProject;
  }
  if (globalSetting) return globalSetting;
  if (autoFallback) return autoFallback;
  return "claude";
}

const ACTIVE_MISSION_STATUSES = new Set([
  "planning",
  "active",
  "waiting_for_human",
  "sleeping",
]);
const IN_FLIGHT_TASK_STATUSES = new Set(["CLAIMED", "IN_PROGRESS"]);
const BLOCKED_TASK_STATUS = "BLOCKED";
const REVIEW_TASK_STATUS = "REVIEW";
const TIMELINE_LIMIT = 12;
const SUMMARY_LIMIT = 220;
const OUTPUT_TAIL_LIMIT = 1000;
const SECRET_KEY_RE = /api[_-]?key|token|secret|password|authorization|bearer/i;
const SECRET_VALUE_RE =
  /(sk-[A-Za-z0-9_-]{12,}|Bearer\s+[A-Za-z0-9._-]{12,}|[A-Za-z0-9_-]{20,}\.[A-Za-z0-9._-]{20,})/g;

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((x): x is string => typeof x === "string")
    : [];
}

function toMillis(value: unknown): number {
  if (!value) return 0;
  if (value instanceof Date) return value.getTime();
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : 0;
  }
  if (
    typeof value === "object" &&
    "toMillis" in value &&
    typeof (value as { toMillis?: unknown }).toMillis === "function"
  ) {
    return (value as { toMillis: () => number }).toMillis();
  }
  if (
    typeof value === "object" &&
    "seconds" in value &&
    typeof (value as { seconds?: unknown }).seconds === "number"
  ) {
    return (value as { seconds: number }).seconds * 1000;
  }
  return 0;
}

function toIso(value: unknown): string {
  const ms = toMillis(value);
  return ms > 0 ? new Date(ms).toISOString() : "";
}

function redactString(value: string): string {
  return value.replace(SECRET_VALUE_RE, "[redacted]");
}

export function sanitizeHandoffValue(value: unknown, key = ""): unknown {
  if (SECRET_KEY_RE.test(key)) return "[redacted]";
  if (typeof value === "string") return redactString(value);
  if (Array.isArray(value)) {
    return value.slice(0, 20).map((item) => sanitizeHandoffValue(item));
  }
  if (value && typeof value === "object") {
    if (value instanceof Date) return value.toISOString();
    if (
      "toDate" in value &&
      typeof (value as { toDate?: unknown }).toDate === "function"
    ) {
      return (value as { toDate: () => Date }).toDate().toISOString();
    }
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    ).slice(0, 30)) {
      out[childKey] = sanitizeHandoffValue(childValue, childKey);
    }
    return out;
  }
  return value;
}

function compactSummary(value: unknown): string {
  const sanitized = sanitizeHandoffValue(value);
  const text =
    typeof sanitized === "string" ? sanitized : JSON.stringify(sanitized);
  return text.length > SUMMARY_LIMIT
    ? `${text.slice(0, SUMMARY_LIMIT)}...`
    : text;
}

function timelineEvents(
  mission: Record<string, unknown>,
): HandoffTimelineEntry[] {
  const raw = Array.isArray(mission.contextLog) ? mission.contextLog : [];
  return raw
    .map((entry) => {
      const e = entry as Record<string, unknown>;
      return {
        tsMs: toMillis(e.ts),
        event: {
          ts: toIso(e.ts),
          type: asString(e.type, "unknown"),
          summary: compactSummary(e.payload ?? {}),
        },
      };
    })
    .sort((a, b) => a.tsMs - b.tsMs)
    .slice(-TIMELINE_LIMIT)
    .map((x) => x.event);
}

function currentStep(mission: Record<string, unknown>) {
  const steps = Array.isArray(mission.steps) ? mission.steps : [];
  const idx = asNumber(mission.currentStepIndex, 0);
  const raw = steps[idx] as Record<string, unknown> | undefined;
  if (!raw) return undefined;
  const liveOutput = asString(raw.liveOutput);
  return {
    index: asNumber(raw.index, idx),
    type: asString(raw.type, "unknown"),
    status: asString(raw.status, "unknown"),
    ...(typeof raw.skill === "string" ? { skill: raw.skill } : {}),
    ...(typeof raw.args === "string" ? { args: redactString(raw.args) } : {}),
    ...(liveOutput
      ? {
          liveOutputTail: redactString(liveOutput).slice(-OUTPUT_TAIL_LIMIT),
        }
      : {}),
  };
}

function unresolvedDecisions(
  mission: Record<string, unknown>,
  recentTimeline: HandoffTimelineEntry[],
): string[] {
  const out: string[] = [];
  if (mission.status === "waiting_for_human") {
    out.push("Mission is waiting for human input.");
  }
  for (const event of recentTimeline) {
    if (
      event.type === "user.input" ||
      event.type === "user.decision" ||
      event.type === "agent.stuck"
    ) {
      out.push(`${event.type}: ${event.summary}`);
    }
  }
  return out.slice(-6);
}

function sortedTasks(tasks: RawHandoffDoc[]): RawHandoffDoc[] {
  return [...tasks].sort(
    (a, b) => toMillis(b.data.updatedAt) - toMillis(a.data.updatedAt),
  );
}

export function summarizeHandoff(
  snapshot: OrchestratorHandoffSnapshot,
): HandoffSummary {
  return {
    activeMissionCount: snapshot.activeMissions.length,
    inFlightTaskCount: snapshot.board.inFlightTasks.length,
    unresolvedDecisionCount: snapshot.activeMissions.reduce(
      (sum, mission) => sum + mission.unresolvedDecisions.length,
      0,
    ),
    openWorkChainCount: snapshot.workChain?.openCount ?? 0,
  };
}

const WORK_CHAIN_TASK_STATUSES = new Set<string>([
  "TODO",
  "CLAIMED",
  "IN_PROGRESS",
  "REVIEW",
  "BLOCKED",
  "FAILED",
  "DONE",
]);

/**
 * 스냅샷이 이미 손에 든 보드 문서로 체인을 파생한다 — 티켓을 다시 읽지 않는다.
 * 판정 로직은 `deriveWorkChain` 하나뿐이다(MCP `get_work_chain` 과 패널이 쓰는 그것).
 * 여기서 파생하는 이유는 **무엇을 실을지 고르기 위해서**이고, 파생 결과 자체는
 * 스냅샷에 안 실린다(`buildWorkChainHandoff` 머리말).
 */
function carryWorkChain(
  chain: { items: WorkChainItem[]; rev: number },
  missions: RawHandoffDoc[],
  tasks: RawHandoffDoc[],
): WorkChainHandoffCarry {
  const statuses: TaskStatusLookup = {};
  const memberTasks: MissionMemberTask[] = [];
  for (const doc of tasks) {
    const deleted = doc.data.deleted === true;
    // 지워진 티켓은 "없는 것" 으로 둔다 — 근거가 사라진 항목이 조용히 done 으로
    // 넘어가지 않게, `deriveWorkChain` 이 MISSING 으로 보게 한다.
    if (!deleted) {
      const status = asString(doc.data.status);
      statuses[doc.id] = WORK_CHAIN_TASK_STATUSES.has(status)
        ? (status as WorkChainTaskStatus)
        : null;
    }
    memberTasks.push({
      id: doc.id,
      contextId: asString(doc.data.contextId) || null,
      missionId: asString(doc.data.missionId) || null,
      deleted,
    });
  }
  const missionSources: MissionMembershipSource[] = missions.map((doc) => ({
    id: doc.id,
    missionKind: asString(doc.data.missionKind) || null,
    implicitLabel: asString(doc.data.implicitLabel) || null,
    status: asString(doc.data.status) || null,
  }));
  const membership = buildMissionMembership(missionSources, memberTasks);
  return buildWorkChainHandoff(
    deriveWorkChain(chain.items, statuses, membership),
    { rev: chain.rev },
  );
}

export function buildOrchestratorHandoffSnapshot({
  projectId,
  rootPath,
  from,
  targetModel,
  resumeSessionId,
  missions,
  tasks,
  workChain,
  now = Date.now(),
}: BuildHandoffInput): OrchestratorHandoffSnapshot {
  const activeMissions = missions
    // ★암묵적 미션(지난 작업에 붙인 Replay 라벨)은 "active mission" 이 아니다.
    // `implicit-mission.ts` 가 status: "active" · steps: [] 로 만들지만 엔진
    // 픽업에서는 `wire.ts` 가드로 통째로 빠진다. 그런데 이 스냅샷만 그 가드를
    // 안 거쳐서, 운전할 스텝이 0건인데 인수인계 프롬프트가 새 오케에게
    // "3 active mission(s)" 라고 알려 주고 UI 도 같은 숫자를 그렸다(진단 #1402).
    // 세지 않는 것에 그치지 않고 스냅샷 본문에서도 뺀다 — 실행 계획이 없는
    // 미션을 이어받으라고 넘기면 오케가 헛돌 대상을 찾는다.
    .filter(
      (doc) =>
        !isImplicitMissionDoc({ missionKind: asString(doc.data.missionKind) }),
    )
    .filter((doc) => ACTIVE_MISSION_STATUSES.has(asString(doc.data.status)))
    .sort(
      (a, b) =>
        toMillis(b.data.lastActivityAt) - toMillis(a.data.lastActivityAt),
    )
    .map((doc) => {
      const recentTimeline = timelineEvents(doc.data);
      return {
        id: doc.id,
        goal: asString(doc.data.goal, "(no goal)"),
        status: asString(doc.data.status, "unknown"),
        currentStepIndex: asNumber(doc.data.currentStepIndex, 0),
        ...(currentStep(doc.data)
          ? { currentStep: currentStep(doc.data) }
          : {}),
        taskIds: asStringArray(doc.data.taskIds),
        recentTimeline,
        unresolvedDecisions: unresolvedDecisions(doc.data, recentTimeline),
      };
    });

  const orderedTasks = sortedTasks(tasks);
  const inFlightTasks = orderedTasks
    .filter((doc) => IN_FLIGHT_TASK_STATUSES.has(asString(doc.data.status)))
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      status: asString(doc.data.status, "unknown"),
      role: asString(doc.data.role, "unknown"),
      claimedBy:
        typeof doc.data.claimedBy === "string" ? doc.data.claimedBy : null,
      ...(typeof doc.data.missionId === "string"
        ? { missionId: doc.data.missionId }
        : {}),
      ...(toIso(doc.data.updatedAt)
        ? { updatedAt: toIso(doc.data.updatedAt) }
        : {}),
    }));
  const blockedTasks = orderedTasks
    .filter((doc) => asString(doc.data.status) === BLOCKED_TASK_STATUS)
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      ...(typeof doc.data.comment === "string"
        ? { comment: redactString(doc.data.comment) }
        : {}),
    }));
  const reviewTasks = orderedTasks
    .filter((doc) => asString(doc.data.status) === REVIEW_TASK_STATUS)
    .map((doc) => ({
      id: doc.id,
      title: asString(doc.data.title, "(untitled task)"),
      ...(typeof doc.data.prUrl === "string" ? { prUrl: doc.data.prUrl } : {}),
    }));

  return {
    projectId,
    rootPath,
    from: {
      ptySessionId: from.ptySessionId,
      ...(from.claudeSessionId
        ? { claudeSessionId: from.claudeSessionId }
        : {}),
      ...(from.model ? { model: from.model } : {}),
      stoppedAt: now,
    },
    to: {
      model: targetModel,
      resumeSessionId,
    },
    activeMissions,
    board: {
      inFlightTasks,
      blockedTasks,
      reviewTasks,
    },
    ...(workChain
      ? { workChain: carryWorkChain(workChain, missions, tasks) }
      : {}),
  };
}

export function formatHandoffPrompt(
  snapshot: OrchestratorHandoffSnapshot,
  mode: OrchestratorSwitchMode,
): string {
  const summary = summarizeHandoff(snapshot);
  const compact = JSON.stringify(snapshot, null, 2);
  return [
    "System handoff update: the UI switched the board orchestrator model/session.",
    "Firestore missions/* and tasks/* are the source of truth.",
    "Do not redispatch CLAIMED or IN_PROGRESS tasks.",
    "Do not advance a waiting_for_human mission without user input.",
    `Mode: ${mode}.`,
    mode === "wait"
      ? "Summarize what you inherited and wait for the user."
      : "Inspect current state first, then continue only the next safe action.",
    ...workChainPromptLines(snapshot.workChain),
    `Summary: ${summary.activeMissionCount} active mission(s), ${summary.inFlightTaskCount} in-flight task(s), ${summary.unresolvedDecisionCount} unresolved decision(s), ${summary.openWorkChainCount} open work chain item(s).`,
    "Handoff snapshot:",
    compact,
  ].join("\n");
}

/**
 * 프롬프트의 체인 문단.
 *
 * ★영어로 쓴다 — 프롬프트의 나머지와 같은 언어라는 이유가 첫째지만, 두 번째
 * 이유가 더 중요하다: 자동 포착(`work-chain-capture.ts`)이 보는 건 한국어 약속
 * 어미("~하겠습니다")와 큐 명사("다음 할 일", "후속:")다. 인수인계 텍스트가 새
 * 오케의 보고를 거쳐 그 필터를 다시 지나가면서 **자기 자신을 항목으로 포착**하는
 * 일이 없어야 한다(2026-08-24 오포착 12건, #1176). 그래서 이 문단은 그 마커를
 * 하나도 쓰지 않는다. 항목 본문은 오케가 원래 쓴 문장이라 마커가 들어 있을 수
 * 있는데, 그건 `dedupeAgainstChain` 이 원문 그대로 잡는다 — 그래서
 * `toHandoffItem` 이 `what` 을 절대 자르지 않는 것이다.
 *
 * ★티켓 wx9c4NeVtZ1SGcbEISpg 이후로 겹이 하나 더 생겼다: 스냅샷은
 * `JSON.stringify` 로 실려 항목 본문이 전부 큰따옴표 안이고, 감지기의 인용부
 * 제외(`redactQuotedSpans`)가 그걸 통째로 지운다. 직렬화된 데이터는 오케가 지금
 * 하는 말이 아니기 때문이다. dedupe 는 그 뒤의 안전망으로 그대로 남는다.
 */
function workChainPromptLines(
  carry: WorkChainHandoffCarry | undefined,
): string[] {
  if (!carry) {
    return [
      "The work chain could not be read while building this snapshot. Call get_work_chain before acting.",
    ];
  }
  const lines = [
    "workChains/<projectId> holds the orchestrator's own queue of pending work, which does not live on the board. It is carried here so it survives this session change.",
    "It carries the stored items ONLY, with no ready/waiting/done verdict. Call get_work_chain to re-derive live state from the board before acting on any item.",
    "Do not record chain completion yourself: an item linked to tickets closes only when those tickets reach its done_when.",
  ];
  if (carry.omittedCount > 0) {
    lines.push(
      `${carry.omittedCount} of ${carry.openCount} open item(s) were left out for length; get_work_chain returns all of them.`,
    );
  }
  return lines;
}
