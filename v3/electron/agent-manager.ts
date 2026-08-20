import { BrowserWindow } from "electron";
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { PtyManager } from "./pty-manager";
import {
  AgentConfigGenerator,
  LaunchConfig,
  FALLBACK_TOP_CLAUDE_MODEL,
  grokSessionsDir,
  isLocalToolProfile,
  type AgentPromptProfile,
  type TaskComplexity,
} from "./agent-config";
import { mainTelemetry } from "./telemetry";
import { encodeClaudeProjectDir } from "./claude-paths";
import {
  shouldPromoteOnPtyOutput,
  shouldDemoteCompletedTurn,
  shouldDemoteAbandonedTurn,
  classifyPtyFrame,
  applyPtyFrame,
  resetPromptIdleOnTurnStart,
  type PtyFrameKind,
} from "./agent-status-reconcile";
import {
  foldInputWait,
  shouldAutoAcceptBypass,
  BYPASS_CONSENT_SELECT,
  BYPASS_CONSENT_CONFIRM,
  BYPASS_CONSENT_CONFIRM_DELAY_MS,
  type AgentInputWaitEvent,
  type InputWaitReason,
} from "./agent-input-wait";
import {
  createLoginScreenBackstop,
  modelToCliAuth,
  probeCliAuth,
} from "./harness-manager";
import { isCliHomeTracked } from "./session-parsers";
import { isHarnessFamilyId } from "./model-registry";

export type ModelType =
  | "claude"
  | "gemini"
  | "gpt"
  | "grok"
  | "antigravity"
  | "local"
  | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

/** 실제 spawn 된 argv 에서 되읽은 모델 축(§P2-3). 값이 없으면 핀하지 않은 것. */
export interface SpawnedModelInfo {
  /** claude `--model` / codex `-c model=` 값. */
  modelId?: string;
  /** codex `-c model_reasoning_effort=` 값. claude 는 effort 축이 없다. */
  effort?: string;
}

/**
 * 우리가 만든 CLI argv 에서 모델·effort 를 되읽는다.
 *
 * ★"무엇을 요청했나"가 아니라 **"무엇으로 떴나"** 를 얻는 것이 요점이다. 요청과
 * 실제는 갈릴 수 있다(버전가드 폴백, 런타임 강등). 라우팅 지식그래프가 비용대비
 * 효과를 학습할 때 요청값을 사실로 착각하면 잘못 수렴하므로, 관측 지점을 argv 로
 * 잡는다 — 여기가 CLI 에 실제로 넘어간 문자열이다.
 */
export function spawnedModelFromArgs(
  model: ModelType,
  args: string[],
): SpawnedModelInfo {
  // `local` 은 Ollama 의 Anthropic 호환 엔드포인트를 claude 하네스로 태우는
  // env-swap 축이라 argv 모양이 claude 와 같다(`--model <id>`). 같은 리더를 쓴다.
  if (model === "claude" || model === "local") {
    const i = args.indexOf("--model");
    return i >= 0 && i + 1 < args.length ? { modelId: args[i + 1] } : {};
  }
  if (model === "gpt") {
    // codex 는 `-c key="value"` 쌍으로 온다.
    const out: SpawnedModelInfo = {};
    for (let i = 0; i < args.length - 1; i++) {
      if (args[i] !== "-c") continue;
      const m = /^model="(.*)"$/.exec(args[i + 1]);
      if (m) out.modelId = m[1];
      const e = /^model_reasoning_effort="(.*)"$/.exec(args[i + 1]);
      if (e) out.effort = e[1];
    }
    return out;
  }
  if (model === "grok") {
    const i = args.indexOf("-m");
    return i >= 0 && i + 1 < args.length ? { modelId: args[i + 1] } : {};
  }
  return {};
}

/**
 * ★무산출 임계(#890 F-7 · 감사 G11).
 *
 * CLI 는 붙기만 해도 배너·프롬프트·스피너로 수백~수천 바이트를 그린다. 그래서
 * "0 바이트" 를 기준으로 삼으면 실제 무산출 실행이 하나도 안 잡힌다. 반대로
 * 임계를 높이면 짧지만 진짜 답변한 실행을 무산출로 오분류한다.
 *
 * 2,000자는 **보수적인 하한**이다 — 이 아래면 어떤 하네스에서도 실질 답변이
 * 아니라는 쪽에 건다. 이 값 하나로 라벨을 확정하지 않는다는 점이 중요하다:
 * 여기서 나오는 것은 `noOutput` **후보 신호**이고, 최종 귀책은 태스크 축의
 * 산출물(출력토큰·PR)과 함께 taskOutcome 에서 정해진다.
 */
export const NO_OUTPUT_CHARS = 2_000;

/** PTY 산출량이 무산출 후보 임계 이하인가. 미집계(undefined)면 판정하지 않는다. */
export function isNoOutputRun(outputChars: number | undefined): boolean {
  return typeof outputChars === "number" && outputChars <= NO_OUTPUT_CHARS;
}

/** `model@effort` 표기. 모델을 모르면 undefined — 빈 문자열을 만들지 않는다. */
export function formatModelAtEffort(
  info: SpawnedModelInfo | null | undefined,
): string | undefined {
  if (!info?.modelId) return undefined;
  return info.effort ? `${info.modelId}@${info.effort}` : info.modelId;
}

/**
 * ★멀티에이전트 동시실행의 판정 하한(티켓 pWSnJeQN).
 *
 * 제품의 핵심 약속("여러 에이전트를 동시에 굴린다")이 실제로 일어난 순간이
 * BigQuery 에 **한 건도 없었다**(grep 0). 세는 기준은 "동시에 살아 있는 PTY 수"
 * 다 — `agent:spawned` 와 `agent:stopped` 의 겹침에서 파생되는 그 값이고,
 * 여기서는 그 겹침을 사후 SQL 로 재구성하는 대신 발생 시점에 직접 관측한다
 * (SQL 재구성은 crash/stale 로 stop 이 안 찍힌 세션에서 영원히 열린 구간을
 * 만든다).
 */
export const MULTI_AGENT_MIN_CONCURRENCY = 2;

/**
 * "지금 살아 있는가" 의 판정. `stopped`/`error` 는 PTY 가 죽은 종단 상태이고,
 * `idle` 은 **살아 있다** — 붙어 있는 CLI 가 다음 지시를 기다리는 상태를 죽은
 * 것으로 세면 동시실행이 거의 관측되지 않는다(오케가 한 에이전트에 지시를 넣는
 * 동안 나머지는 대부분 idle 이다).
 */
export function isLiveAgentStatus(status: AgentStatus): boolean {
  return status !== "stopped" && status !== "error";
}

/**
 * 동시실행 이벤트를 지금 발신해야 하는가 — **상승 엣지에서만** true.
 *
 * 매 변화마다 보내면 스폰이 잦은 세션에서 이벤트가 폭주하고, 반대로 설치당
 * 1회로 접으면 "상시" 축(이 유저가 지금도 동시에 굴리는가)이 사라진다. 그래서
 * 규칙은 "≥2 이면서 직전 관측보다 늘었을 때만" 이다: 2→3→2→3 은 두 번 잡히고,
 * 3→2 나 2→2 는 잡히지 않는다.
 */
export function shouldEmitMultiAgentActive(
  previousLive: number,
  currentLive: number,
): boolean {
  return (
    currentLive >= MULTI_AGENT_MIN_CONCURRENCY && currentLive > previousLive
  );
}

// --- Auto-restart constants ---
const MAX_RESTARTS = 5;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_MAX_MS = 30000;
const HEARTBEAT_INTERVAL_MS = 30_000;
// "Fast fail" threshold — if the agent process exits within this window
// after spawning, treat it as a config / binary-not-found problem rather
// than a transient crash. Restart up to FAST_FAIL_MAX times then give up,
// so a misconfigured Codex / Gemini binary doesn't burn 5 restart slots
// trying the same broken setup.
const FAST_FAIL_WINDOW_MS = 2_000;
const FAST_FAIL_MAX = 1;
// "Graceful completion" threshold — an agent that lived past this window
// before exiting (even with a nonzero code) almost certainly ran its
// course rather than crashed on bootstrap. Codex / Claude can exit
// nonzero after a normal task completion (signal, ctrl-c, plugin shutdown,
// SIGPIPE on stdin close). Without this distinction those exits get
// classified as crashes → auto-restart 5x → error, which surfaces in the
// UI as "rest-and-error" for a worker that actually did its job.
const GRACEFUL_LIFETIME_MS = 60_000;

export interface AgentLaunchParams {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  command: string;
  cwd: string;
  initialPrompt?: string;
  resumeSessionId?: string; // 'new' | 'latest' | UUID
  /** Firestore project document ID — injected as MARBLO_PROJECT env var into MCP */
  projectId?: string;
  /** 작업 난이도 — claude(--model)·codex(reasoning) 모델/레벨 선택용. 미지정=기본. */
  complexity?: TaskComplexity;
  /** Board task currently bound to this agent, when launched by dispatch/spawn. */
  currentTaskId?: string | null;
  /** Short dispatch decision reason retained for lifecycle telemetry joins. */
  dispatchReason?: string | null;
  /** MARBLO_CONTEXT injected into this agent's MCP process, e.g. lane:<id>. */
  contextId?: string;
  /** claude 모델 핀. 설정되면 complexity resolver 대신 이 모델 id 로 --model.
   * 두 출처가 공유한다 — 런타임 강등 재시작(§3.4-3, fable5 실패 → "opus")과
   * 사용자/오케의 명시 지정(dispatch model='opus5'). 양쪽 다 이미
   * resolveClaudeModelPinned 의 버전가드를 통과한 값이 들어온다. */
  claudeModelOverride?: string;
  /** codex 모델 핀(`-c model=…`). 사용자 지정 시에만. 미지정이면 사용자
   * config.toml 의 모델을 그대로 쓴다(현행 동작). */
  codexModelOverride?: string;
  /** codex reasoning effort 핀(`-c model_reasoning_effort=…`). complexity
   * 파생값을 덮는다. */
  codexEffortOverride?: string;
  /** Grok 등 native CLI 모델 핀. */
  nativeModelOverride?: string;
  /**
   * Called immediately after PTY is created, before any output can be missed.
   *
   * `spawnedModel` 은 이 launch 가 CLI 에 실제로 넘긴 `model@effort` 표기다
   * (formatModelAtEffort). ★이 콜백은 `agents.set` 보다 **먼저** 불리므로
   * 수신 측에서 `getSpawnedModel(agentId)` 를 조회하면 null 이 나온다 —
   * 스폰 알림 페이로드에 구체 모델을 실으려면 반드시 이 인자를 써야 한다.
   * 모델을 핀하지 않은 launch 면 undefined.
   */
  onPtyReady?: (ptySessionId: string, spawnedModel?: string) => void;
}

export interface AgentRestartOptions {
  initialPrompt?: string;
  claudeModelOverride?: string;
  codexModelOverride?: string;
  codexEffortOverride?: string;
  nativeModelOverride?: string;
  /** 재시작 시 난도를 바꿔야 할 때만. 미지정이면 최초 launch 의 난도를 그대로 잇는다. */
  complexity?: TaskComplexity;
}

export interface AgentInstance {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  ptySessionId: string;
  status: AgentStatus;
  command: string;
  cwd: string;
  currentTaskId: string | null;
  dispatchReason: string | null;
  /**
   * The last task this agent was bound to, RETAINED after the binding is
   * released. Audit-only — never used to decide whether the agent is free.
   *
   * Why it has to exist: `markTurnComplete` clears `currentTaskId` the instant
   * a worker reports its task terminal, but the reaper's gate required a
   * `currentTaskId` to prove the agent's work was finished. So the completion
   * report destroyed the only evidence that made the agent reapable, and every
   * agent that reported cleanly became permanently unreapable — 11 of 13
   * stranded, `cleanup_agents` answering "no reapable agents found" while the
   * box sat at load average 44. Keeping the id here lets the reaper re-check
   * that task's board status without resurrecting the binding.
   */
  lastTaskId: string | null;
  launchConfig?: LaunchConfig;
  // --- Auto-restart fields ---
  restartCount: number;
  /** Counter for *immediate* exits (within FAST_FAIL_WINDOW_MS of spawn).
   * Capped by FAST_FAIL_MAX so misconfiguration can't burn the full
   * restart budget. */
  fastFailCount: number;
  /** epoch-ms timestamp of the most recent spawn (initial or restart).
   * Used to classify exit-on-startup vs runtime crash. */
  spawnedAt: number;
  lastExitCode: number | null;
  stopRequested: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  heartbeatTimer: ReturnType<typeof setInterval> | null;
  /** Stored so auto-restart can re-register PTY forwarding. 재시작도 같은
   * 콜백을 재사용하므로 relaunch 의 새 `spawnedModel` 이 그대로 다시 통보된다
   * (강등 재시작으로 모델이 바뀌면 수신 측이 재스탬프할 수 있다). */
  onPtyReady?: (ptySessionId: string, spawnedModel?: string) => void;
  /** epoch-ms of the most recent PTY output activity. Bumped on every onData
   * chunk. A HINT ONLY — silence does not mean idle (a reasoning agent emits
   * nothing), so this now feeds only the wedged-turn backstop
   * (ABANDONED_TURN_MS) and the reaper's post-completion grace window, never a
   * routine working→idle demotion. */
  lastPtyActivity: number;
  /**
   * epoch-ms of the last PTY frame that counted as **work** — every frame
   * except the ones positively identified as the harness's idle input prompt
   * (or as contentless cursor repaint). See agent-status-reconcile.ts
   * classifyPtyFrame.
   *
   * Why it exists separately from `lastPtyActivity`: a CLI parked at its prompt
   * repaints forever, so raw PTY bytes report a stopped agent as alive. The
   * watchdog reads THIS clock instead, which stops advancing the moment the
   * agent falls back to its prompt — without ever treating mere silence (a
   * reasoning agent) as death.
   */
  lastWorkOutput: number;
  /**
   * epoch-ms since which every classified PTY frame has been an idle-prompt
   * repaint, or null when the agent is not provably parked. This is the
   * POSITIVE proof of "stopped" the watchdog acts on; a silent (reasoning)
   * agent emits no frames at all and so can never reach this state.
   *
   * Cleared by any busy/work frame and by every turn start (noteTurnStart).
   */
  promptIdleSince: number | null;
  /**
   * Is a HUMAN currently being waited on, and why — folded from the very same
   * classified frames as `promptIdleSince` above (see agent-input-wait.ts).
   * null = nobody is being waited on.
   *
   * This is the renderer's half of the #935 signal. The watchdog answers a
   * parked agent with a nudge; a nudge cannot answer a question that was meant
   * for the user, and in simple mode there is no terminal on screen for them to
   * find it in. Every transition of this field is pushed to the renderer, which
   * turns it into the top-right notification.
   */
  inputWaitReason: InputWaitReason | null;
  /** epoch-ms the current input-wait began; null when not waiting. */
  inputWaitSince: number | null;
  /**
   * Latch: the first-run bypass-permissions consent screen was already
   * auto-accepted for THIS instance. Per-instance rather than per-agent id so a
   * restart (a genuinely new CLI process, which shows the screen again if it
   * shows it at all) gets its own single answer.
   */
  bypassConsentAnswered: boolean;
  /**
   * ★무산출 판정용 누적 출력량(#890 F-7 · 감사 G11).
   *
   * 이 프로세스가 살아 있는 동안 PTY 로 뱉은 **문자 수**다. 내용은 세지 않고
   * 보관도 하지 않는다 — 길이 하나만 남긴다(promptLength 와 같은 계약).
   *
   * 왜 필요한가: "실패" 를 모델 귀책과 가르려면 먼저 **아무것도 안 낸 실행**을
   * 떼어내야 한다. grok 의 empty-run 처럼 붙었다가 배너만 그리고 죽은 실행이
   * 지금은 "모델이 못했다" 와 같은 라벨로 들어간다.
   *
   * ★한계: 배너·스피너 repaint 도 바이트다. 그래서 이 값 하나로 무산출을
   * 단정하지 않고, 임계(NO_OUTPUT_CHARS) 이하일 때 **후보 신호**로만 쓴다.
   * 최종 판정은 태스크 축의 산출물(출력토큰·PR)과 함께 본다(taskOutcome).
   */
  outputChars: number;
  /**
   * epoch-ms the agent reported its turn finished (submit_for_review /
   * update_task_status → REVIEW·DONE·FAILED·BLOCKED), set by markTurnComplete.
   * null while a turn is open.
   *
   * This is the AUTHORITATIVE turn boundary — the agent's own statement that it
   * is done, which no amount of terminal repaint can contradict. While it is
   * set, output cannot promote the agent to `working`. It is cleared only by a
   * real turn start (noteTurnStart, fired on submitted input) or an explicit
   * promotion, so genuine follow-up work is never suppressed.
   */
  turnCompletedAt: number | null;
  /** Claude only: the --model id this launch actually used (resolver result or
   * runtime-downgrade override). Lets the fast-fail handler detect a Fable5
   * launch and downgrade it to opus on restart (§3.4-3). undefined for
   * non-claude / non-complex launches. */
  topClaudeModel?: string;
  /** claude 모델 핀 — 두 출처가 공유한다. (a) Fable5 launch 가 런타임
   * fast-fail 후 opus 로 강등될 때 세팅되며, 자동 재시작에 실려 relaunch 가
   * opus 를 핀하게 하고 동시에 강등이 루프하지 않게 하는 once-only 가드다.
   * (b) 사용자/오케가 dispatch·셀렉터로 명시 지정한 모델. 재시작이 지정 모델을
   * 잃지 않으려면 여기 보존돼야 한다. */
  claudeModelOverride?: string;
  /** codex 모델·effort 핀. 재시작이 사용자 지정을 잃지 않도록 보존한다. */
  codexModelOverride?: string;
  codexEffortOverride?: string;
  /** native CLI 모델 핀. 재시작이 사용자 지정을 잃지 않도록 보존한다. */
  nativeModelOverride?: string;
  /**
   * 이 launch 가 쓴 난도. ★재시작이 이 값을 잃으면 모델 핀이 통째로 사라진다:
   * dispatch 스폰은 명시 핀 없이 `complexity="standard"` → `--model claude-opus-5`
   * 로 뜨는데, 종전 restart 는 `claudeModelOverride`(명시 핀)만 옮겼으므로
   * relaunch argv 에서 `--model` 이 사라져 (a) 실제 서빙 모델이 CLI 기본값으로
   * 조용히 강등되고 (b) getSpawnedModel 이 빈 값이 돼 배지·KG·cost_logs 가 전부
   * "모델미상" 으로 떨어졌다. 난도를 보존해 relaunch 가 같은 티어 결정을 다시
   * 내리게 한다(결정 자체는 재실행 — CLI 버전가드/폴백이 그대로 다시 걸린다).
   */
  complexity?: TaskComplexity;
  /**
   * cost-tracker 가 **과금된 세션 메타데이터**에서 읽은 실제 모델 id
   * (`claude-opus-5`). argv 관측보다 늦게 오지만 더 강한 근거다 — argv 에 모델을
   * 핀하지 않은 launch(오케 기본 경로·Agents 탭 ▶Start·콜드부트 reconnect)에서
   * 유일한 관측이기도 하다. main 의 cost 콜백이 되먹인다(setDetectedModel).
   */
  detectedModelId?: string;
  /** §3.4-3 런타임 강등이 이미 한 번 일어났음. 강등 루프 방지 래치.
   *
   * ★종전엔 이 래치가 `claudeModelOverride` 가 비어있는지로 대체돼 있었다.
   * 그때는 그 필드에 값이 있다는 것이 곧 "이미 강등됨"과 동의어였기 때문이다.
   * 이제는 사용자가 `dispatch(model='fable')` 로 처음부터 값을 넣을 수 있어
   * 그 등식이 깨졌다 — 래치를 분리하지 않으면 명시 지정된 fable5 는 런타임
   * fast-fail 해도 영영 강등되지 못한다(안전 폴백 불변식 구멍). */
  claudeRuntimeDowngraded?: boolean;
  /** P3-4: epoch-ms the agent entered a TERMINAL state (stopped/error) with no
   * pending auto-restart. null while live or mid-restart. The periodic pruner
   * uses it as a backstop to evict long-dead map entries that cleanup_agents
   * never reaped (e.g. the orchestrator never calling it). Reset to null on any
   * revival. */
  terminalSince: number | null;
}

/**
 * Structured-clone-safe projection of an AgentInstance for the Electron IPC
 * boundary. AgentInstance carries fields that the structured-clone algorithm
 * cannot serialize — the `onPtyReady` callback (a function), the
 * `restartTimer` / `heartbeatTimer` Timer handles, and the nested
 * `launchConfig`. Returning a raw AgentInstance from an `ipcMain.handle`
 * channel therefore throws "An object could not be cloned" (see the
 * `agent:list` handler). This shape mirrors exactly the fields the renderer
 * consumes, all serializable scalars.
 */
export interface SerializableAgent {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  ptySessionId: string;
  status: AgentStatus;
  currentTaskId: string | null;
  dispatchReason: string | null;
}

/** Map an AgentInstance to a plain, IPC-cloneable object. */
export function serializeAgent(agent: AgentInstance): SerializableAgent {
  return {
    id: agent.id,
    name: agent.name,
    model: agent.model,
    role: agent.role,
    ptySessionId: agent.ptySessionId,
    status: agent.status,
    currentTaskId: agent.currentTaskId,
    dispatchReason: agent.dispatchReason,
  };
}

// NOTE: the old IDLE_INACTIVITY_MS (5 min of PTY silence ⇒ idle) is gone. It
// assumed a busy agent keeps talking, but an agent that is reasoning is silent,
// so the rule reported live work as free. Demotion is now driven by the agent's
// own completion report, with ABANDONED_TURN_MS (agent-status-reconcile.ts) as
// the only silence-based backstop. See that file's header for the full model.

const SECRET_OUTPUT_GUARDRAIL = [
  "[Security Guardrails]",
  "- Do not cat, print, or log raw contents from `.env`, `.mcp.json`, firebase-config files, service account JSON, or OAuth/Toss/Paddle/API key files.",
  "- When configuration checks are needed, report only whether keys exist, file paths, and masked values. If a config or env value must be logged, apply maskConfigForLogging or maskEnvForLogging-style masking.",
].join("\n");

const LOCAL_LIGHT_SECURITY_GUARDRAIL =
  "[Security] Do not print secrets or raw config/env files. If config status is needed, report only paths, key presence, and masked values.";

function compactLocalCompletionFooter(instruction: string): string {
  return instruction.replace(
    /\n\n\[완료 규약 — task_id="([^"]+)"\][\s\S]*$/u,
    (_match: string, taskId: string) =>
      [
        "",
        "",
        `[완료 규약 — task_id="${taskId}"]`,
        `Log progress with add_activity(task_id="${taskId}", message="...").`,
        `When ready for review, call submit_for_review(task_id="${taskId}", summary?).`,
        `On failure or blockage, call update_task_status(task_id="${taskId}", status="FAILED"|"BLOCKED", comment="reason").`,
        `If blocked, do not ask the user directly. Call ask_orchestrator(task_id="${taskId}", question="need/reason/blocked scope") and keep working on anything else that can proceed.`,
      ].join("\n"),
  );
}

// P3-4: backstop pruning of dead (stopped/error) entries the primary reaper
// (cleanup_agents → remove) never reclaimed — e.g. the orchestrator never
// calling cleanup_agents, or a naturally-completed agent whose Firestore doc was
// never deleted. The map otherwise grows for the app's whole (multi-day)
// lifetime. TTL is generous so a user can still revive a stopped agent via
// "+ New Session" long after it died; only truly-abandoned entries are evicted.
const DEAD_ENTRY_TTL_MS = 30 * 60 * 1000; // 30 min terminal → prunable
const DEAD_ENTRY_SWEEP_MS = 5 * 60 * 1000; // sweep cadence

/**
 * Build the prompt that gets typed into the freshly-spawned CLI.
 *
 * - Codex / Gemini / custom CLIs have no skill auto-discovery, so we
 *   prepend the role's skill file (claim/activity/review workflow,
 *   coding rules, etc.) ahead of the orchestrator's instruction. Claude
 *   Code does auto-load `~/.claude/skills/*`, but marblo's role skills
 *   live in `v3/skills/{role}_agent.md` — they aren't symlinked into
 *   `~/.claude/skills/`, so Claude workers wouldn't see the
 *   claim→IN_PROGRESS→submit_for_review workflow either. Prepend for
 *   Claude too. Skipping this is what caused workers to finish reviews
 *   in their PTY but never call submit_for_review / update_task_status,
 *   leaving the orchestrator blind to completion.
 * - Strip the `mcp__marblo__` prefix that Claude Code uses for MCP tool
 *   names — Codex / Gemini expose the same tools as `claim_task`,
 *   `submit_for_review`, etc. (no `mcp__server__` prefix). The
 *   orchestrator (Claude) writes instructions in Claude-style naming;
 *   without this rewrite, Codex/Gemini agents look for the prefixed
 *   tool, fail to find it, and stop without ever calling Marblo MCP.
 */
/**
 * Interactive dialogs that some CLIs show at startup before reaching the
 * input prompt. None of them match the readiness patterns in launch(), so
 * without intervention Marblo's 10s blind fallback dumps the initial
 * prompt into the dialog as keystrokes — typically navigating a menu and
 * exiting the CLI cleanly (exit 0), which Marblo classifies as "stopped"
 * with no auto-restart.
 *
 * Each entry says: when `pattern` first appears in PTY output for an
 * agent whose model is in `applies` (or any model when omitted), send
 * `keys` to dismiss it, reset the readiness buffer, and keep waiting for
 * the real input prompt. Each entry fires at most once per agent launch.
 */
interface StartupDialogMatcher {
  pattern: RegExp;
  keys: string;
  label: string;
  applies?: ModelType[];
}

export const STARTUP_DIALOG_MATCHERS: StartupDialogMatcher[] = [
  {
    // Codex CLI (e.g. 0.128 → 0.132): "✨ Update available!" prompt.
    // "3" = "Skip until next version" — least invasive choice.
    pattern: /Skip until next version/i,
    keys: "3\r",
    label: "codex update-available",
    applies: ["gpt"],
  },
  {
    // Antigravity (agy) v1.0.2 trust dialog: blocks input on first visit
    // to any new cwd. Default highlight is "> Yes, I trust this folder"
    // (verified via live PTY capture 2026-05-26), so a bare `\r` accepts.
    // Anchored to the question text — distinctive enough not to false-fire
    // on arbitrary chat content. Applied to antigravity only so claude /
    // codex / gemini chats discussing trust don't trigger it.
    pattern: /Do you trust the contents of this project/i,
    keys: "\r",
    label: "antigravity trust-folder",
    applies: ["antigravity"],
  },
];

/**
 * CLI 가 **입력을 받을 준비가 됐다**는 확증 신호. 이 중 하나라도 부팅 버퍼에 뜨면
 * (a) 초기 프롬프트를 주입하고 (b) 로그인 백스톱의 grace 를 닫는다
 * (`noteReadiness()` — 스쳐 지나간 인증 문구를 transient 로 확정하고, 이미 발화한
 * needsAuth 는 철회한다).
 *
 * ★`╭─+` 같은 박스 테두리는 금지 — "Do you trust this folder?" 다이얼로그 테두리와
 * 같아서, 1500ms 뒤 보내는 `\r` 이 기본값("No")을 확정해 에이전트를 즉사시킨다.
 * 준비된 **입력 프롬프트**에만 나타나는 문구만 담는다.
 */
export const CLI_READINESS_PATTERNS: RegExp[] = [
  // Antigravity (agy) verified via live PTY capture: its post-trust input
  // prompt uses the same `? for shortcuts` footer as Claude Code, so this one
  // pattern covers both. agy's blocking gate is the trust dialog itself,
  // handled by STARTUP_DIALOG_MATCHERS.
  /\? for shortcuts/, // Claude Code: footer help text
  /Type your message/i, // Claude/Gemini: input prompt placeholder
  /Loaded \d+ MCP tool/i, // MCP tools loaded — only after trust granted
  /Ready to assist/i, // Generic CLI ready message
  /What can I help/i, // Gemini/GPT greeting
  // Codex TUI: the empty input area shows the example prompt
  // "Explain this codebase" once init finishes (post plugin-sync,
  // post trust check, post MCP startup). Verified by capturing
  // the live PTY output of `codex` 0.128. Without a codex-specific
  // pattern, Marblo would fall through to the 10s blind fallback
  // and dump the prompt into whatever dialog/state codex is in,
  // which historically caused the agent to exit cleanly without
  // ever processing the instruction.
  /Explain this codebase/i,
  /esc to interrupt/i,
  // ── Grok Build 1.0.0 ────────────────────────────────────────────
  // grok 은 다섯 하네스 중 **유일하게 readiness 지표가 없었다**. 그래서
  // noteReadiness() 가 한 번도 불리지 않았고, 로그인 백스톱의 grace 창은 늘
  // "readiness 미도달" 로 만료됐다 — 부팅 중 스쳐 지나간 인증 문구 하나가 그대로
  // needsAuth 로 굳는 구조였다(인증 팝업 재발의 두 번째 축).
  //
  // Marblo 는 grok 을 항상 `--minimal` 로 띄운다(agent-config.ts). minimal 렌더러의
  // 상태 푸터가 준비 상태에서 "Grok Build  v<ver>   Model <id>   /help for commands"
  // 를 그린다 — grok 1.0.0 바이너리 문자열표(xai-grok-pager-minimal/src/full_view.rs)
  // 로 확인했다. 로그인/승인 화면의 푸터는 "ctrl+q quit" 뿐이고 이 문구가 없다
  // (라이브 device-code 로그인 캡처 130KB 에 "/help for commands" 0회).
  /\/help for commands/i,
];

export function composeInitialPrompt(
  model: ModelType,
  instruction: string,
  skillContent?: string,
  promptProfile: AgentPromptProfile = "full",
): string {
  // `local` 은 claude CLI env-swap 이라 MCP 툴 이름도 `mcp__marblo__*` 규약.
  const isClaudeFamily = model === "claude" || model === "local";
  const rewritten = isClaudeFamily
    ? instruction
    : instruction.replace(/mcp__marblo__/g, "");
  // 로컬 프로파일(대형 tool-use / 경량 lite 공통)은 완료규약 전문을 compact 로
  // 줄인다 — lite 에서는 이게 "긴 컨텍스트 제거"의 한 축이다.
  const sanitized = isLocalToolProfile(promptProfile)
    ? compactLocalCompletionFooter(rewritten)
    : rewritten;
  // agy 도 v1.20+ 부터 MCP 지원 — generateAntigravityConfig 가 글로벌
  // ~/.gemini/antigravity-cli/mcp_config.json 에 marblo 항목을 머지하므로
  // role-skill 의 add_activity / claim_task / submit_for_review 호출이
  // 정상 작동한다. 따라서 다른 비-claude 워커와 동일한 prepend 경로 사용.
  // chat-only 로컬은 getLaunchConfig 가 skillContent 를 비워 여기로 안 온다.
  // lite 로컬은 역할 스킬 전문 대신 짧은 브리프가 skillContent 로 들어온다.
  if (!skillContent) return sanitized;
  return [
    "[Role Skill — Follow the workflow and tool-use rules below]",
    skillContent.trim(),
    "",
    isLocalToolProfile(promptProfile)
      ? LOCAL_LIGHT_SECURITY_GUARDRAIL
      : SECRET_OUTPUT_GUARDRAIL,
    "",
    "[Task Instructions]",
    sanitized,
  ].join("\n");
}

export class AgentManager {
  private agents: Map<string, AgentInstance> = new Map();
  // P3-4: periodic backstop that evicts long-dead map entries. Started in the
  // constructor, cleared in stopAll() (called on before-quit). .unref()'d so it
  // never keeps the process alive on its own.
  private pruneTimer: ReturnType<typeof setInterval> | null = null;
  private ptyManager: PtyManager;
  private configGenerator: AgentConfigGenerator;
  private onStatusChange?: (agentId: string, status: AgentStatus) => void;
  /**
   * `spawnedModel` = 이 launch 의 argv 에서 되읽은 구체 모델 id(effort 접미사 없이).
   * ★claude 분기는 `agents.set` **이전**에 동기 발화하므로 수신 측이
   * `getSpawnedModel(agentId)` 로 조회하면 null 이다 — 비용 트래커를 구체 모델로
   * 씨딩하려면 반드시 이 인자를 써야 한다(안 그러면 트래커가 하네스족 'claude' 로
   * 씨딩돼 cost_logs.model 이 족으로 나가고, 단가표도 미매칭이라 $0 로 청구된다).
   */
  private onSessionDetected?: (
    rootPath: string,
    sessionId: string,
    label: string,
    agentId: string,
    spawnedModel?: string,
  ) => void;
  private onRestartAttempt?: (
    agentId: string,
    attempt: number,
    maxAttempts: number,
  ) => void;
  private onRestartFailed?: (agentId: string, exitCode: number) => void;
  private getMainWindow?: () => BrowserWindow | null;
  /**
   * Emitted on every input-wait TRANSITION (both directions — `waiting:false`
   * is the retraction that removes the notification). Edge-triggered, not
   * level: a standing wait is announced once, which is what makes "one
   * notification per agent" hold without the renderer having to de-dupe a
   * repeating stream.
   */
  private onInputWait?: (event: AgentInputWaitEvent) => void;
  /**
   * 직전에 관측한 동시 live 에이전트 수(멀티에이전트 계측의 상승 엣지 판정용).
   * 프로세스 수명 동안만 유지한다 — 재시작 후 다시 2대를 띄우면 그건 새 관측이
   * 맞다(설치당 1회로 접는 건 렌더러의 localStorage 마커가 한다).
   */
  private lastLiveAgentCount = 0;
  private resolveSessionId?: (
    rootPath: string,
    requested: string,
    filterLabel?: string,
    filterAgentId?: string,
  ) => string | null;

  constructor(
    ptyManager: PtyManager,
    onStatusChange?: (agentId: string, status: AgentStatus) => void,
    onSessionDetected?: (
      rootPath: string,
      sessionId: string,
      label: string,
      agentId: string,
      spawnedModel?: string,
    ) => void,
    onRestartAttempt?: (
      agentId: string,
      attempt: number,
      maxAttempts: number,
    ) => void,
    onRestartFailed?: (agentId: string, exitCode: number) => void,
    getMainWindow?: () => BrowserWindow | null,
    onInputWait?: (event: AgentInputWaitEvent) => void,
  ) {
    this.ptyManager = ptyManager;
    this.configGenerator = new AgentConfigGenerator();
    this.onStatusChange = onStatusChange;
    this.onSessionDetected = onSessionDetected;
    this.onRestartAttempt = onRestartAttempt;
    this.onRestartFailed = onRestartFailed;
    this.getMainWindow = getMainWindow;
    this.onInputWait = onInputWait;

    // P3-4: start the dead-entry pruner. Idempotent guard so re-entry can't
    // stack intervals.
    if (!this.pruneTimer) {
      this.pruneTimer = setInterval(
        () => this.pruneDeadEntries(),
        DEAD_ENTRY_SWEEP_MS,
      );
      this.pruneTimer.unref?.();
    }
  }

  /**
   * P3-4 backstop: evict map entries that have been TERMINAL (stopped/error)
   * longer than DEAD_ENTRY_TTL_MS. cleanup_agents (→ remove) is still the
   * primary reaper and Firestore docs are left untouched; this only bounds the
   * in-memory `agents` map so it can't grow unbounded across the app's lifetime
   * when cleanup_agents is never called. Live / restarting agents (terminalSince
   * === null) are never touched.
   */
  private pruneDeadEntries(): void {
    const now = Date.now();
    for (const [id, agent] of this.agents) {
      if (agent.status !== "stopped" && agent.status !== "error") continue;
      if (agent.terminalSince === null) continue;
      if (now - agent.terminalSince < DEAD_ENTRY_TTL_MS) continue;
      this.clearAgentTimers(agent);
      this.agents.delete(id);
      console.log(
        `[AgentManager] Pruned dead entry ${agent.name} (${id}, ${
          agent.status
        } for ${Math.round(
          (now - agent.terminalSince) / 60000,
        )}min) — backstop reaper (P3-4).`,
      );
    }
  }

  /** Inject session resolver (from OrchestratorManager) after construction */
  setSessionResolver(
    resolver: (
      rootPath: string,
      requested: string,
      filterLabel?: string,
      filterAgentId?: string,
    ) => string | null,
  ) {
    this.resolveSessionId = resolver;
  }

  launch(params: AgentLaunchParams): AgentInstance {
    const ptySessionId = `agent-${params.id}`;

    // Resume resolution. Claude Code needs a concrete session UUID
    // (resolveSessionId converts "latest" by scanning ~/.claude/projects/).
    // Codex / Gemini / Grok take "latest" natively (codex resume --last,
    // gemini --resume latest, grok --continue), so we keep the sentinel and
    // let agent-config emit the right CLI flags. Resolving it to a concrete id
    // for them would be actively harmful: the only resolver we have scans
    // ~/.claude, so it hands back a CLAUDE uuid that their own CLI cannot find.
    let resolvedResumeId = params.resumeSessionId;
    if (
      params.model === "claude" &&
      resolvedResumeId === "latest" &&
      this.resolveSessionId &&
      params.cwd
    ) {
      resolvedResumeId =
        this.resolveSessionId(params.cwd, "latest", params.name, params.id) ??
        undefined;
      console.log(
        `[Agent:${params.id}] Resolved 'latest' → ${
          resolvedResumeId ?? "none (new session)"
        }`,
      );
    }
    // Grok's 'latest' maps to `grok --continue`, which is FATAL on a directory
    // with no session ("No session found for current directory" → exit) — the
    // same shape as `codex resume <unknown-id>`. The per-agent GROK_HOME starts
    // empty, so a never-run agent asked to resume 'latest' would die on launch.
    // Downgrade to a fresh session instead (agent-config then pins a new
    // --session-id, so the NEXT resume has a concrete id to use).
    if (params.model === "grok" && resolvedResumeId === "latest") {
      const grokHasSession = this.configGenerator.hasSavedSession(
        params.id,
        "grok",
        params.cwd,
      );
      if (!grokHasSession) {
        console.log(
          `[Agent:${
            params.id
          }] grok 'latest' requested but no saved session under this agent's GROK_HOME for cwd=${
            params.cwd ?? "(none)"
          } → starting fresh (--continue would exit).`,
        );
        resolvedResumeId = undefined;
      }
    }

    const isResume =
      !!resolvedResumeId &&
      resolvedResumeId !== "new" &&
      // For Claude we treat unresolved 'latest' as no-resume (the resolve
      // step above set it to undefined when no session was found). For
      // codex/gemini 'latest' is a valid CLI sentinel and should resume.
      !(params.model === "claude" && resolvedResumeId === "latest");

    // Generate MCP config + skill file for this agent. The resume id
    // (if any) gets injected into the model-specific CLI args by
    // buildCLICommand — Claude uses --resume <UUID>, Codex uses
    // `resume --last|<UUID>` subcommand, Gemini uses --resume latest.
    const launchConfig = this.configGenerator.getLaunchConfig(
      {
        id: params.id,
        model: params.model,
        role: params.role,
        command: params.command,
      },
      params.cwd,
      params.initialPrompt,
      params.projectId,
      isResume ? resolvedResumeId : undefined,
      // Pin a fresh Claude launch to a generated --session-id so this agent's
      // tokens attribute to it deterministically (no racy post-launch scan).
      true,
      // 작업 난이도 → claude(--model sonnet/opus)·codex(reasoning) 모델/레벨 선택.
      params.complexity,
      // 명시 모델 핀 — 런타임 강등 재시작(§3.4-3)과 사용자 지정 모델이 공유하는
      // 레일. 비어 있으면 complexity 티어 정책이 그대로 돈다.
      {
        claudeModel: params.claudeModelOverride,
        codexModel: params.codexModelOverride,
        codexEffort: params.codexEffortOverride,
        nativeModel: params.nativeModelOverride,
      },
      params.contextId,
    );

    // Grok resume 는 라이브 관측이 유일한 검증 수단이라(세션 디렉터리가 cwd 로
    // 키잉된다) 이 스폰이 어느 세션을 물었는지 남긴다. --continue 로 붙은
    // 경우엔 grok 이 스스로 고르므로 id 가 없다.
    if (params.model === "grok") {
      console.log(
        `[Agent:${params.id}] grok session ${
          isResume ? "resume" : "pinned"
        } → ${
          launchConfig.grokSessionId ?? "(--continue: CLI picks latest for cwd)"
        } under ${grokSessionsDir(params.id)}`,
      );
    }

    // 모델 할당 v2 텔레메트리 + 폴백 표식(§8.1/§8.4). modelResolution 은 complex
    // claude 가 §3 resolver 를 탔을 때만 채워진다(override 경로는 비움).
    // topClaudeModel 은 fast-fail 강등 판단에 쓰려고 인스턴스에 보존한다.
    const resolution = launchConfig.modelResolution;
    const topClaudeModel = params.claudeModelOverride ?? resolution?.model;
    if (resolution) {
      const win = this.getMainWindow?.() ?? null;
      mainTelemetry.modelTierResolved(
        win,
        params.model,
        params.complexity ?? "",
        resolution.model,
        params.id,
      );
      if (resolution.fallback) {
        mainTelemetry.topModelFallback(
          win,
          resolution.fallback.reason,
          resolution.fallback.requested,
          resolution.fallback.installed,
          resolution.fallback.fallbackTo,
          params.id,
        );
      }
    }

    if (isResume) {
      console.log(
        `[Agent:${params.id}] Resuming session: ${resolvedResumeId} (model=${params.model})`,
      );
    }

    // Merge env: process.env + generated MCP env
    const mergedEnv: Record<string, string> = {
      ...(process.env as Record<string, string>),
      ...launchConfig.env,
    };
    // Claude Code 중첩 세션 방지 — 부모의 CLAUDECODE 변수 제거
    delete mergedEnv.CLAUDECODE;

    // Create PTY session with the CLI command + MCP args
    this.ptyManager.create(
      ptySessionId,
      `Agent: ${params.name}`,
      launchConfig.command,
      launchConfig.args,
      params.cwd,
      mergedEnv,
    );

    // Notify caller IMMEDIATELY so they can register data listeners
    // before the PTY produces any output.
    //
    // 방금 만든 argv 를 되읽어 구체 모델을 함께 넘긴다. 여기서 계산해야 하는
    // 이유: 이 콜백은 `this.agents.set` 보다 앞서 불리므로 수신 측이
    // getSpawnedModel(id) 로 조회하면 아직 null 이다.
    const spawnedModelInfo = spawnedModelFromArgs(
      params.model,
      launchConfig.args,
    );
    params.onPtyReady?.(ptySessionId, formatModelAtEffort(spawnedModelInfo));

    // Send initial prompt via stdin after CLI finishes booting (only for NEW sessions).
    // Uses PTY output detection instead of fixed timer to reliably detect readiness.
    if (!isResume && launchConfig.initialPrompt) {
      const prompt = composeInitialPrompt(
        params.model,
        launchConfig.initialPrompt,
        launchConfig.skillContent,
        launchConfig.promptProfile,
      );
      let sent = false;
      // Set once the login-screen backstop CONFIRMS the CLI is sitting at a
      // login prompt — blocks BOTH the readiness path and the blind fallback
      // from typing the instruction into the login menu (which historically
      // navigated the menu and exited the CLI cleanly, leaving a dead PTY).
      // Watched for claude/codex/grok (gated pre-spawn) AND antigravity
      // (ungated pre-spawn, but its OAuth flow still needs the backstop).
      //
      // ★ 확정은 이제 패턴 1회 매칭이 아니라 `createLoginScreenBackstop` 의 조정
      // 결과다: 사전 probe 가 인증됨이었으면 grace 창 동안 readiness 를 기다려
      // 오탐(정상 grok 이 부팅 중 뱉는 인증 안내 문구)을 걸러내고, 발화한 뒤라도
      // readiness 에 도달하면 철회한다.
      let authBlocked = false;
      const watchLoginScreen =
        params.model === "claude" ||
        params.model === "gpt" ||
        params.model === "grok" ||
        params.model === "antigravity";
      const sendPrompt = () => {
        if (sent || authBlocked) return;
        sent = true;
        loginBackstop.dispose();
        // Split text and \r so Claude Code registers Enter as a discrete
        // keystroke (single-chunk write gets paste-buffered, leaving the
        // CR inside the message body without submitting).
        this.ptyManager.writeAndSubmit(ptySessionId, prompt);
        console.log(
          `[Agent:${params.id}] Initial prompt sent (${prompt.length} chars)`,
        );
      };
      // 사전 probe — 백스톱의 첫 번째 축. grok 은 파일 존재 검사라 사실상 즉시
      // 끝나지만, 늦게 도착하는 경우(claude 키체인)도 있으므로 백스톱은 "미도착"을
      // 인증됨과 같게(=grace) 취급한다.
      const cliAuthModel = watchLoginScreen
        ? modelToCliAuth(params.model)
        : null;
      const loginBackstop = createLoginScreenBackstop({
        hasProbe: cliAuthModel !== null,
        onGrace: (graceMs) => {
          console.warn(
            `[Agent:${params.id}] Login-screen pattern matched for ${params.model} ` +
              `but pre-spawn probe said authenticated — holding ${graceMs}ms for readiness.`,
          );
        },
        onNeedsAuth: (reason) => {
          if (sent) return;
          authBlocked = true;
          console.error(
            `[Agent:${params.id}] Login prompt confirmed for ${params.model} ` +
              `(${reason}) — suppressing prompt injection (CLI needs auth / login).`,
          );
          this.setStatus(params.id, "error");
          // Surface to the renderer so it can open the CLI setup gate instead
          // of the agent silently dying at a login screen.
          this.getMainWindow?.()?.webContents.send("agent:needsAuth", {
            agentId: params.id,
            model: params.model,
            reason,
          });
          // ★온보딩 스톨 계측(티켓 9dXgBdkGn1LyJokShh1g): 사전 게이트를 통과했는데도
          // CLI 가 로그인 화면에서 멈춘 순간. 종전엔 이 순간이 콘솔과 렌더러 팝업에만
          // 남아 BigQuery 에 0건이었고, 그래서 "몇 명이 여기서 멈추나" 를 셀 수 없었다.
          // 짝 이벤트(agent_auth_resolved)로 오탐 철회분을 빼고 세야 한다.
          mainTelemetry.agentNeedsAuth(
            this.getMainWindow?.() ?? null,
            params.id,
            params.model,
            reason,
          );
        },
        onResolved: () => {
          authBlocked = false;
          console.warn(
            `[Agent:${params.id}] ${params.model} reached readiness after a login-screen ` +
              `match — retracting needsAuth (transient auth notice, not a login screen).`,
          );
          // "error" 로 떨어뜨렸던 판정을 되돌린다. 실제 working 승격은 평소대로
          // PTY 출력이 한다(shouldPromoteOnPtyOutput).
          this.setStatus(params.id, "idle");
          this.getMainWindow?.()?.webContents.send("agent:authResolved", {
            agentId: params.id,
            model: params.model,
          });
          // 위 판정의 철회 = 오탐이었다. 이 행이 없으면 needsAuth 오탐 saga 가
          // 그대로 스톨 수치로 잡혀 문제 크기를 부풀린다.
          mainTelemetry.agentAuthResolved(
            this.getMainWindow?.() ?? null,
            params.id,
            params.model,
          );
        },
      });
      if (cliAuthModel) {
        probeCliAuth(cliAuthModel)
          .then((r) => loginBackstop.setPreProbeAuthenticated(r.authenticated))
          .catch(() => loginBackstop.setPreProbeAuthenticated(false));
      }

      // Watch PTY output for CLI readiness indicators
      // Only match patterns that confirm the CLI is actually ready for input.
      // Do NOT match `╭─+` — it also matches the "Do you trust this folder?"
      // dialog box border, and our 1500ms-delayed `\r` would confirm the
      // default ("No") and immediately kill the agent. Match only patterns
      // that appear in the post-trust input prompt.
      let outputBuffer = "";
      const readinessPatterns = CLI_READINESS_PATTERNS;

      // Per-launch state for STARTUP_DIALOG_MATCHERS — fire each matcher
      // at most once. Filter by model so e.g. codex's update prompt
      // doesn't get applied to claude agents (false positive on a chat
      // message containing the same words).
      const activeMatchers = STARTUP_DIALOG_MATCHERS.filter(
        (m) => !m.applies || m.applies.includes(params.model),
      );
      const dismissed = new Set<RegExp>();

      this.ptyManager.onData(ptySessionId, (data) => {
        if (sent) return;
        outputBuffer += data;
        // Only keep last 4KB to avoid memory growth
        if (outputBuffer.length > 4096)
          outputBuffer = outputBuffer.slice(-4096);

        // Login-screen backstop: while the CLI looks like it may be sitting at
        // an interactive login prompt ("hold"/"blocked"), never type into it —
        // dialog dismissal keystrokes and the blind fallback both navigate the
        // menu and kill the CLI. readiness 는 두 상태에서도 **계속 본다**: 그게
        // 오탐을 스스로 걷어내는(철회) 유일한 신호이기 때문이다.
        const loginState = watchLoginScreen
          ? loginBackstop.observe(outputBuffer)
          : "clear";

        if (loginState === "clear") {
          for (const dlg of activeMatchers) {
            if (dismissed.has(dlg.pattern)) continue;
            if (dlg.pattern.test(outputBuffer)) {
              dismissed.add(dlg.pattern);
              console.log(
                `[Agent:${params.id}] Dismissing blocking dialog: ${dlg.label}`,
              );
              // Small delay so the TUI is in steady state when we type.
              setTimeout(() => {
                this.ptyManager.write(ptySessionId, dlg.keys);
              }, 300);
              // Reset buffer so the dismissed dialog's text doesn't keep
              // being re-matched against readiness patterns.
              outputBuffer = "";
              return;
            }
          }
        }

        for (const pattern of readinessPatterns) {
          if (pattern.test(outputBuffer)) {
            // readiness 도달 = 로그인 화면이 아니었다는 최종 증거. 보류 중이던
            // grace 를 닫고, 이미 발화했었다면 철회한다(agent:authResolved).
            loginBackstop.noteReadiness();
            if (authBlocked) return;
            // Delay to let CLI fully render its prompt
            setTimeout(sendPrompt, 1500);
            return;
          }
        }
      });

      // Fallback: send after the model-specific timeout regardless of
      // readiness patterns. Antigravity gets a longer window because its
      // first-spawn OAuth browser flow (harness-catalog.ts antigravity)
      // can easily blow past 10s, and the 10s default would dump the
      // prompt into the auth dialog.
      const fallbackMs = params.model === "antigravity" ? 25000 : 10000;
      setTimeout(sendPrompt, fallbackMs);
    }

    // Wire Claude cost tracking to this agent's session.
    //
    // A fresh launch is PINNED to a brand-new session id up front
    // (--session-id <uuid> — see claudeSessionArgs), so we attribute
    // deterministically and SKIP the legacy "which new JSONL appeared?" scan.
    // That scan collides when several Claude agents share one cwd: it grabs an
    // arbitrary new file (or none, if Claude hasn't written it by the 5s mark),
    // which silently funnels every agent's tokens onto the orchestrator and
    // leaves the agents reading 0. The pinned JSONL may not exist yet at this
    // point; the cost tracker's poller tolerates that and picks it up once
    // Claude writes it. Gated to claude — codex/gemini/agy have their own
    // dedicated tracking kickoff below.
    //
    // Resume launches are excluded: their session already exists and is wired
    // for cost tracking via the reconnect path, so re-tracking here would
    // re-read the whole file and double-count. They fall through to the legacy
    // detector (a no-op on resume, since the resumed file isn't "new") — i.e.
    // identical to pre-fix behavior.
    if (this.onSessionDetected && params.cwd && params.model === "claude") {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      // 이 launch 가 실제로 넘긴 모델 id. 비용 트래커 씨딩용이라 effort 없이
      // 모델 id 만 넘긴다(단가표는 모델 id 로 조회한다).
      const launchedModelId = spawnedModelInfo.modelId;

      if (launchConfig.claudeSessionId && !isResume) {
        this.onSessionDetected(
          rootPath,
          launchConfig.claudeSessionId,
          agentName,
          agentId,
          launchedModelId,
        );
      } else {
        // Fallback for the rare unresolved `--resume latest` (no concrete id to
        // pin): snapshot existing sessions, then 5s later claim the newly
        // created one. Best-effort and race-prone, but only this edge needs it.
        let existingIds: Set<string>;
        try {
          const encodedPath = encodeClaudeProjectDir(rootPath);
          const sessionsDir = path.join(
            os.homedir(),
            ".claude",
            "projects",
            encodedPath,
          );
          const files = fs.existsSync(sessionsDir)
            ? fs
                .readdirSync(sessionsDir)
                .filter((f: string) => f.endsWith(".jsonl"))
                .map((f: string) => f.replace(".jsonl", ""))
            : [];
          existingIds = new Set(files);
        } catch (err) {
          console.error(
            `[AgentManager] Failed to read existing session files for rootPath="${rootPath}":`,
            err,
          );
          existingIds = new Set();
        }

        setTimeout(() => {
          try {
            const encodedPath = encodeClaudeProjectDir(rootPath);
            const sessionsDir = path.join(
              os.homedir(),
              ".claude",
              "projects",
              encodedPath,
            );
            if (!fs.existsSync(sessionsDir)) return;
            const currentFiles = fs
              .readdirSync(sessionsDir)
              .filter((f: string) => f.endsWith(".jsonl"))
              .map((f: string) => f.replace(".jsonl", ""));
            const newId = currentFiles.find(
              (id: string) => !existingIds.has(id),
            );
            if (newId) {
              this.onSessionDetected!(
                rootPath,
                newId,
                agentName,
                agentId,
                launchedModelId,
              );
            }
          } catch (err) {
            console.error(
              `[AgentManager] Failed to detect new session file for agent="${agentId}" rootPath="${rootPath}":`,
              err,
            );
          }
        }, 5000);
      }
    }

    // Codex / Gemini / Grok cost-tracking kickoff.
    //
    // The Claude session detector above only scans ~/.claude/projects, so it
    // never fires onSessionDetected for these. Their cost tracking is
    // file-based and self-resolving (CostTracker polls the per-agent CLI home
    // and re-resolves the newest session file each tick), so we just nudge it
    // to start a few seconds after launch — the CLI needs a moment to write
    // its first session file. sessionId is passed empty; the tracker ignores
    // it for these models.
    //
    // ★The membership test is `isCliHomeTracked`, not an inline list. grok was
    // missing from the inline version, and since no other branch claims it,
    // a freshly spawned grok agent got no tracker at all → 0 cost_logs rows
    // (the cold-boot reconnect path passed `agentData.model` straight through,
    // so the loss was new-spawn-only). See session-parsers.
    if (
      this.onSessionDetected &&
      params.cwd &&
      isCliHomeTracked(params.model)
    ) {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      // codex 는 모델을 핀하지 않는 경로가 기본이라 modelId 가 비어 있을 수 있다.
      // 그때는 넘기지 않고 트래커의 사다리 기본값(inheritedModel)이 그대로 산다.
      const launchedModelId = spawnedModelInfo.modelId;
      setTimeout(() => {
        this.onSessionDetected!(
          rootPath,
          "",
          agentName,
          agentId,
          launchedModelId,
        );
      }, 8000);
    }

    // Antigravity (agy) conversation watcher.
    //
    // agy 는 ~/.gemini/antigravity-cli/conversations/<UUID>.pb 에 cwd 무관
    // 하게 모든 conversation 을 저장하므로 cwd 별 분리 불가. spawn 직전
    // 스냅샷을 떠두고 일정 시간 후 새로 생긴 .pb basename 을 잡아
    // onSessionDetected 로 영속화한다.
    //
    // 타이밍: agy 는 첫 user message 가 들어가야 .pb 생성 — Marblo 의
    // initial prompt 가 25s fallback 후 주입되므로 35s 후 스캔.
    if (
      params.model === "antigravity" &&
      this.onSessionDetected &&
      params.cwd
    ) {
      const rootPath = params.cwd;
      const agentName = params.name;
      const agentId = params.id;
      const conversationsDir = path.join(
        os.homedir(),
        ".gemini",
        "antigravity-cli",
        "conversations",
      );
      // agy migrated from a flat .pb store to per-conversation SQLite (.db);
      // both formats still appear, so snapshot/scan UUID basenames from either
      // (ignoring .db-wal/.db-shm sidecars, which don't end in ".db").
      const listConvIds = (): Set<string> => {
        try {
          if (!fs.existsSync(conversationsDir)) return new Set();
          return new Set<string>(
            fs
              .readdirSync(conversationsDir)
              .filter((f: string) => f.endsWith(".pb") || f.endsWith(".db"))
              .map((f: string) => f.replace(/\.(pb|db)$/, "")),
          );
        } catch (err) {
          console.error(
            `[AgentManager] Failed to snapshot agy conversations for agent="${agentId}":`,
            err,
          );
          return new Set();
        }
      };
      const convMtime = (id: string): number => {
        for (const ext of [".db", ".pb"]) {
          try {
            return fs.statSync(path.join(conversationsDir, `${id}${ext}`))
              .mtimeMs;
          } catch {
            /* try next ext */
          }
        }
        return 0;
      };
      const existingIds = listConvIds();

      setTimeout(() => {
        try {
          const newIds = Array.from(listConvIds()).filter(
            (id: string) => !existingIds.has(id),
          );
          // Race ambiguity: if >1 conversation appeared in the window (parallel
          // spawn, user's own terminal session), we can't tell which is ours.
          // Pick the most-recently-modified one as best-effort.
          if (newIds.length === 0) return;
          let chosenId = newIds[0];
          if (newIds.length > 1) {
            chosenId = newIds
              .map((id: string) => ({ id, mtime: convMtime(id) }))
              .sort(
                (a: { mtime: number }, b: { mtime: number }) =>
                  b.mtime - a.mtime,
              )[0].id;
            console.warn(
              `[AgentManager] agy: ${newIds.length} new conversations detected during agent="${agentId}" window, picking newest=${chosenId}`,
            );
          }
          this.onSessionDetected!(rootPath, chosenId, agentName, agentId);
        } catch (err) {
          console.error(
            `[AgentManager] Failed to detect agy conversation for agent="${agentId}":`,
            err,
          );
        }
      }, 35000);
    }

    const instance: AgentInstance = {
      id: params.id,
      name: params.name,
      model: params.model,
      role: params.role,
      ptySessionId,
      status: "idle",
      command: params.command,
      cwd: params.cwd,
      currentTaskId: params.currentTaskId ?? null,
      lastTaskId: params.currentTaskId ?? null,
      dispatchReason: params.dispatchReason ?? null,
      launchConfig,
      restartCount: 0,
      fastFailCount: 0,
      spawnedAt: Date.now(),
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
      onPtyReady: params.onPtyReady,
      lastPtyActivity: Date.now(),
      lastWorkOutput: Date.now(),
      promptIdleSince: null,
      inputWaitReason: null,
      inputWaitSince: null,
      bypassConsentAnswered: false,
      outputChars: 0,
      turnCompletedAt: null,
      terminalSince: null,
      topClaudeModel,
      claudeModelOverride: params.claudeModelOverride,
      codexModelOverride: params.codexModelOverride,
      codexEffortOverride: params.codexEffortOverride,
      nativeModelOverride: params.nativeModelOverride,
      complexity: params.complexity,
      // 같은 id 로 다시 뜨는 경우(Agents 탭 ▶Start·콜드부트 reconnect)는 같은
      // 에이전트·같은 CLI 세션의 재개다 — 직전 과금 관측은 여전히 그 에이전트의
      // 사실이므로 이어받는다. 없으면 undefined(첫 스폰). argv 관측이 생기면
      // 어차피 그쪽이 이긴다(resolveConcreteModel).
      detectedModelId: this.agents.get(params.id)?.detectedModelId,
    };

    this.agents.set(params.id, instance);

    // PTY activity → working/idle auto-derivation.
    //
    // Status was historically set only via two paths:
    //   (a) bridge-server dispatch → setStatus("working")
    //   (b) MCP self-report (submit_for_review / update_task_status DONE etc)
    //       → setStatus("idle")
    // Vendors without MCP self-report (notably agy 1.0.2 / direct PTY chat)
    // never moved off the initial "idle" — orchestrator then treated them as
    // "free" while they were actually mid-conversation waiting for the next
    // instruction, so no follow-up was ever sent.
    //
    // Hook every PTY output chunk: bump lastPtyActivity, and promote idle→
    // working on the first byte of an OPEN turn. Demotion is not handled here
    // (nor by silence) — it follows the agent's completion report; see the
    // heartbeat below and agent-status-reconcile.ts.
    this.ptyManager.onData(ptySessionId, (chunk) => {
      const agent = this.agents.get(params.id);
      if (!agent || agent !== instance) return;
      agent.lastPtyActivity = Date.now();
      // ★F-7 — 산출량은 **길이만** 센다. chunk 는 여기서 버려지고 어디에도
      // 저장되지 않는다(원문 금지 계약, #887 §2).
      agent.outputChars += chunk.length;
      // Idle-at-prompt tracking: classify the frame and keep ONLY the two
      // derived timestamps (the chunk itself is still dropped here — the F-7
      // contract above is unchanged). `lastPtyActivity` above deliberately
      // still counts every byte; it feeds the wedged-turn backstop. The
      // watchdog reads `lastWorkOutput`/`promptIdleSince` instead, because a
      // CLI parked at its prompt repaints forever and would otherwise look
      // alive to it. This NEVER changes the agent's status — status still
      // follows input/completion boundaries only.
      const kind = classifyPtyFrame(chunk, agent.model);
      const framed = applyPtyFrame(
        {
          lastWorkOutputAt: agent.lastWorkOutput,
          promptIdleSince: agent.promptIdleSince,
        },
        kind,
        Date.now(),
      );
      agent.lastWorkOutput = framed.lastWorkOutputAt;
      agent.promptIdleSince = framed.promptIdleSince;
      // ★The first-run bypass-permissions consent screen. We are the ones who
      // passed --dangerously-skip-permissions, so the answer is already decided
      // and the screen is pure friction — one a simple-mode user cannot even
      // see, since that shell renders no terminal. Answer it here and the stall
      // never exists; only prompts we did NOT provoke reach the notification
      // path below. Gates live in shouldAutoAcceptBypass.
      this.maybeAcceptBypassConsent(params.id, chunk);
      // ★The renderer's half of the #935 signal: same classified frame, asked
      // the question the watchdog never asks — is a PERSON being waited on?
      this.refreshInputWait(params.id, kind);
      // Output NEVER starts a turn — it only continues one. While a completion
      // report stands, these bytes are the finished turn's repaint (trailing
      // flush, then the idle prompt's spinner/cursor forever), and promoting on
      // them is what stranded agents at [working] with nothing able to reap
      // them. A real new turn arrives as INPUT and clears the marker via
      // noteTurnStart, which re-opens promotion.
      if (
        shouldPromoteOnPtyOutput({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          now: Date.now(),
        })
      ) {
        this.setStatus(params.id, "working");
      }
    });

    // Input side of the turn boundary: any submitted instruction — from
    // dispatch, reuse, a nudge, or a human typing in the terminal tab — opens a
    // new turn, so the completed-turn marker is cleared and the next output
    // byte can legitimately promote the agent back to `working`.
    this.ptyManager.onSubmit(ptySessionId, () => {
      const agent = this.agents.get(params.id);
      if (!agent || agent !== instance) return;
      this.noteTurnStart(params.id);
    });

    // Telemetry: agent spawned — prefer MARBLO_PROJECT from launchConfig (always set by agent-config)
    const spawnProjectId =
      instance.launchConfig?.env?.MARBLO_PROJECT || params.projectId || "";
    // Capture prompt context for moat-data: hash + length only, never the
    // raw prompt. Hash lets us cluster identical prompts across agents
    // (cache-hit shape) without leaking content into BigQuery.
    const initial = params.initialPrompt;
    const promptHash = initial
      ? crypto.createHash("sha256").update(initial).digest("hex")
      : undefined;
    const promptLength = initial?.length;
    mainTelemetry.agentSpawned(
      this.getMainWindow?.() ?? null,
      params.id,
      params.name,
      params.model || "claude",
      params.role || "backend",
      spawnProjectId,
      promptHash,
      promptLength,
      {
        // ★F-9(감사 G1) — 스폰 행의 taskId 는 지금까지 **0%** 였다. 그래서
        // "이 스폰이 어느 결정의 결과인가" 를 스폰 단위로는 조인할 수 없었고,
        // dispatch:decision 을 거치지 않는 스폰(오케·UI·MCP)은 통째로 미라벨이었다.
        taskId: params.currentTaskId ?? null,
        // ★F-1 — 액션 해상도. onPtyReady 에 넘긴 그 값(방금 만든 argv 되읽기)을
        // 재사용한다 — 같은 사실을 두 번 계산하면 갈릴 여지만 생긴다.
        spawnedModel: formatModelAtEffort(spawnedModelInfo),
      },
    );

    // ★멀티에이전트 동시실행(티켓 pWSnJeQN) — 이 스폰으로 동시 live 가 2 이상
    // 으로 올라갔다면 그 순간을 계측한다. agents.set 이 이미 끝난 뒤라야 방금
    // 뜬 이 에이전트가 카운트에 포함된다.
    this.noteLiveAgentCount();

    // Start heartbeat for anomaly detection (ML-4)
    instance.heartbeatTimer = setInterval(() => {
      const win = this.getMainWindow?.() ?? null;
      const agent = this.agents.get(params.id);
      if (!agent || agent.stopRequested) return;
      // Demotion is driven by the agent's own completion report, NOT by PTY
      // silence. An agent that is reasoning emits nothing for minutes at a
      // time; the old "silent for 5 min ⇒ idle" rule therefore reported live
      // work as free, which both misled the orchestrator and exposed a
      // thinking agent to any idleness-gated reaper. Silence is not evidence
      // of idleness — see agent-status-reconcile.ts.
      if (
        // A completed turn whose slot didn't free (a trailing chunk promoted it
        // to `working` in the race just before /set-agent-status landed) —
        // demote on the SHORT settle window so the slot frees promptly and the
        // orchestrator stops seeing a phantom [working].
        shouldDemoteCompletedTurn({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          lastPtyActivity: agent.lastPtyActivity,
          lastWorkOutput: agent.lastWorkOutput,
          now: Date.now(),
        })
      ) {
        this.setStatus(params.id, "idle");
      } else if (
        // Backstop only: no completion report and mute for far longer than any
        // plausible inference pause ⇒ presumed wedged. Deliberately generous
        // (45 min vs the old 5) because demoting live work is the expensive
        // mistake and demoting a wedged agent late is the cheap one.
        shouldDemoteAbandonedTurn({
          status: agent.status,
          stopRequested: agent.stopRequested,
          turnCompletedAt: agent.turnCompletedAt,
          lastPtyActivity: agent.lastPtyActivity,
          now: Date.now(),
        })
      ) {
        console.warn(
          `[Agent:${
            params.id
          }] no completion report and PTY mute for ${Math.round(
            (Date.now() - agent.lastPtyActivity) / 60000,
          )}min — presuming wedged turn, demoting to idle.`,
        );
        this.setStatus(params.id, "idle");
      }
      // Timer-driven input-wait check. The frame path (onData) normally gets
      // there first because a parked TUI repaints — this is the backstop for a
      // CLI that parks and then goes completely silent, where no further frame
      // would ever arrive to notice the grace elapsing.
      this.refreshInputWait(params.id, null);
      const hbProjectId =
        agent.launchConfig?.env?.MARBLO_PROJECT || params.projectId || "";
      mainTelemetry.heartbeat(win, params.id, hbProjectId, agent.status, 0, 0);
    }, HEARTBEAT_INTERVAL_MS);

    // Monitor PTY exit — auto-restart on crash
    this.ptyManager.onExit(ptySessionId, (exitCode) => {
      const agent = this.agents.get(params.id);
      if (!agent) return;
      // Stale exit: the agent under this id has already been replaced by
      // a restart/relaunch. Acting on the old PTY's exit here would clean
      // up the NEW agent's MCP config file (same path: claude-mcp-<id>.json,
      // same ptySessionId string `agent-<id>`) and crash the freshly-launched
      // claude process with "Invalid MCP configuration: file not found".
      // Use object identity — comparing `agent.ptySessionId !== ptySessionId`
      // would always be false on restart since the sid is reused verbatim.
      if (agent !== instance) return;

      // The PTY process is gone — release the heartbeat interval before taking
      // any branch below. Every branch is terminal for THIS instance: the
      // stopped/error branches leave a dead entry in the map (never deleted
      // here), and the auto-restart branch spawns a FRESH instance with its
      // own heartbeat via launch(). Without this clear the 30s interval (and
      // its telemetry.heartbeat emissions) leaked on every crash/completion.
      if (agent.heartbeatTimer) {
        clearInterval(agent.heartbeatTimer);
        agent.heartbeatTimer = null;
      }

      agent.lastExitCode = exitCode;
      const runtimeMs = Date.now() - agent.spawnedAt;

      // Intentional stop, clean exit, or graceful completion → mark stopped.
      // Graceful completion = nonzero exit after the worker has lived past
      // GRACEFUL_LIFETIME_MS; restarting at this point would just respawn
      // the CLI without context and waste a slot, and worse, repeated
      // nonzero exits eventually trigger the error state for a worker that
      // genuinely finished its task. The user can revive it explicitly via
      // "+ New Session".
      const isGracefulCompletion =
        exitCode !== 0 && runtimeMs >= GRACEFUL_LIFETIME_MS;
      if (agent.stopRequested || exitCode === 0 || isGracefulCompletion) {
        agent.status = "stopped";
        agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "stopped");
        mainTelemetry.agentStopped(
          this.getMainWindow?.() ?? null,
          params.id,
          exitCode,
          {
            // ★F-7(감사 G11) — 종료 시점의 실패 귀책 신호. 종전엔 exitCode 만
            // 남아서 "붙었다가 아무것도 안 내고 죽은 실행"(grok empty-run)을
            // 모델 실패와 구분할 방법이 데이터에 없었다.
            taskId: agent.currentTaskId,
            model: agent.model,
            outputChars: agent.outputChars,
            noOutput: isNoOutputRun(agent.outputChars),
            errorCategory: isNoOutputRun(agent.outputChars)
              ? "no_output"
              : agent.stopRequested
                ? "stopped_by_user"
                : isGracefulCompletion
                  ? "graceful_completion"
                  : "clean_exit",
          },
        );
        this.noteLiveAgentCount();
        if (isGracefulCompletion) {
          console.log(
            `[Agent:${agent.id}] Graceful completion (exit ${exitCode} after ${runtimeMs}ms) — marking stopped, not restarting.`,
          );
        }
        return;
      }

      // Classify the exit: fast-fail (likely config / binary issue) vs.
      // runtime crash (transient, worth retrying).
      const wasFastFail = runtimeMs < FAST_FAIL_WINDOW_MS;
      if (wasFastFail) {
        agent.fastFailCount++;
        console.warn(
          `[Agent:${agent.id}] Fast-fail (exit ${exitCode} after ${runtimeMs}ms). fastFail=${agent.fastFailCount}/${FAST_FAIL_MAX}`,
        );

        // §3.4-3 2차 안전망: Fable5 가 런타임에서 빠르게 실패(미지원 모델 오류
        // 등)하면 opus 로 강등해 재시작한다. claudeRuntimeDowngraded 가 한 번만
        // 세팅되는 전이 가드 — 강등 후 opus 가 또 fast-fail 하면 일반 예산을
        // 따른다. fastFail 예산은 강등 시점에 리셋해 opus 에 공정한 재시도를 준다.
        // ★래치는 claudeModelOverride 의 유무가 아니라 전용 플래그다. 사용자가
        // 처음부터 fable5 를 명시 지정하면 override 가 이미 차 있어서, 옛 조건은
        // 그 에이전트를 강등 대상에서 통째로 빼버렸다(불변식 구멍).
        if (
          agent.model === "claude" &&
          agent.topClaudeModel === "claude-fable-5" &&
          !agent.claudeRuntimeDowngraded
        ) {
          agent.claudeModelOverride = FALLBACK_TOP_CLAUDE_MODEL;
          agent.claudeRuntimeDowngraded = true;
          agent.fastFailCount = 0;
          mainTelemetry.topModelFallback(
            this.getMainWindow?.() ?? null,
            "runtime_downgrade",
            "claude-fable-5",
            "runtime",
            FALLBACK_TOP_CLAUDE_MODEL,
            agent.id,
          );
          console.warn(
            `[Agent:${agent.id}] Fable5 runtime fast-fail — downgrading to ${FALLBACK_TOP_CLAUDE_MODEL} on restart (§3.4-3).`,
          );
        }
      }

      // Stop restarting once we've burned the fast-fail budget — it's
      // almost certainly a missing binary / bad config and another retry
      // won't help.
      const fastFailExceeded = agent.fastFailCount > FAST_FAIL_MAX;

      // Crash detected — attempt auto-restart with exponential backoff
      if (agent.restartCount < MAX_RESTARTS && !fastFailExceeded) {
        const delay = Math.min(
          BACKOFF_BASE_MS * Math.pow(2, agent.restartCount),
          BACKOFF_MAX_MS,
        );
        agent.restartCount++;
        this.onRestartAttempt?.(agent.id, agent.restartCount, MAX_RESTARTS);
        mainTelemetry.agentRestarted(
          this.getMainWindow?.() ?? null,
          agent.id,
          agent.restartCount,
          agent.currentTaskId,
          agent.model,
          agent.dispatchReason,
          // ★재시도 사유 — 크래시 이벤트와 **같은 어휘**로 남긴다. 설정 문제로
          // 즉사해 도는 재시도와 런타임 크래시 재시도는 귀책이 다르다.
          wasFastFail ? "fast_fail_config" : "runtime_crash",
          exitCode,
        );
        console.log(
          `[Agent:${agent.id}] Crash detected (exit ${exitCode}). Restart ${agent.restartCount}/${MAX_RESTARTS} in ${delay}ms`,
        );

        agent.restartTimer = setTimeout(() => {
          this.performAutoRestart(agent.id);
        }, delay);
      } else {
        // Max restarts exceeded OR fast-fail budget burned → error state
        agent.status = "error";
        agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
        this.configGenerator.cleanup(params.id);
        this.onStatusChange?.(params.id, "error");
        this.onRestartFailed?.(agent.id, exitCode);
        // §5-4 갭 메우기: 지금 계산된 분류를 크래시 이벤트에 실어 보낸다.
        //   fast_fail_config = FAST_FAIL_WINDOW 내 반복 즉사 → 바이너리 부재/
        //     잘못된 command/설정 오류(= CLI 미설치·모델 설정 오류 계열).
        //   runtime_crash = 정상 기동 후 재시작 예산(MAX_RESTARTS) 소진.
        // errorMessage 는 짧게(사유 + exit + command 이름)만 — 원문 stderr 없음.
        const errorCategory = fastFailExceeded
          ? "fast_fail_config"
          : "runtime_crash";
        const errorMessage = fastFailExceeded
          ? `fast-fail x${agent.fastFailCount} (exit ${exitCode}, command=${agent.command})`
          : `max restarts (${MAX_RESTARTS}) exceeded (exit ${exitCode})`;
        mainTelemetry.agentCrashed(
          this.getMainWindow?.() ?? null,
          agent.id,
          exitCode,
          agent.currentTaskId,
          agent.model,
          agent.dispatchReason,
          errorCategory,
          errorMessage,
        );
        this.noteLiveAgentCount();
        if (fastFailExceeded) {
          console.error(
            `[Agent:${agent.id}] Aborting auto-restart — agent exited within ${FAST_FAIL_WINDOW_MS}ms ${agent.fastFailCount}x. Likely a missing binary or bad config (command="${agent.command}"). Verify the CLI is on PATH and check the agent's launch args.`,
          );
        } else {
          console.error(
            `[Agent:${agent.id}] Max restarts (${MAX_RESTARTS}) exceeded. Exit code: ${exitCode}`,
          );
        }
      }
    });

    return instance;
  }

  private performAutoRestart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.stopRequested) return;

    const restartCount = agent.restartCount;
    const fastFailCount = agent.fastFailCount;
    const onPtyReady = agent.onPtyReady;
    // 모델 핀을 relaunch 로 옮긴다. 두 가지가 여기 실린다 — Fable5→opus 런타임
    // 강등(§3.4-3, 재시작이 다시 Fable5 를 고르지 않게)과 사용자가 지정한 모델
    // (재시작이 지정을 잃고 기본 티어로 흘러내리지 않게).
    const claudeModelOverride = agent.claudeModelOverride;
    const codexModelOverride = agent.codexModelOverride;
    const codexEffortOverride = agent.codexEffortOverride;
    const nativeModelOverride = agent.nativeModelOverride;
    // ★난도도 함께 옮긴다. 명시 핀이 없는 대부분의 dispatch 스폰은 모델이 난도에서
    // 파생되므로, 이걸 빠뜨리면 relaunch argv 에 `--model` 이 사라져 모델이 CLI
    // 기본값으로 조용히 강등되고 관측(배지/KG/cost_logs)이 미상으로 떨어진다.
    const complexity = agent.complexity;
    const claudeRuntimeDowngraded = agent.claudeRuntimeDowngraded;
    // 과금 관측도 함께 옮긴다 — auto-restart 는 같은 세션을 resume 하므로 직전에
    // 관측된 모델은 여전히 이 에이전트의 사실이다. 안 옮기면 재시작마다 관측이
    // 리셋돼 dispatchMeta 가 다시 "모델미상" 으로 떨어진다(argv 핀이 없는 경로).
    const detectedModelId = agent.detectedModelId;

    // Cleanup old PTY, config, and timers (heartbeat + the backoff timer that
    // just fired). onExit already released the heartbeat, but stay consistent.
    this.clearAgentTimers(agent);
    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    this.agents.delete(agentId);

    console.log(
      `[Agent:${agentId}] Performing auto-restart (attempt ${restartCount})`,
    );

    // Re-launch with resume
    // Resolve 'latest' to the actual session ID for this agent
    let resolvedSessionId: string = "latest";
    if (this.resolveSessionId && agent.cwd) {
      const resolved = this.resolveSessionId(
        agent.cwd,
        "latest",
        agent.name,
        agent.id,
      );
      resolvedSessionId = resolved ?? "new";
      console.log(
        `[Agent:${agent.id}] Auto-restart resolved 'latest' → ${resolvedSessionId}`,
      );
    }

    const newInstance = this.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd: agent.cwd,
      currentTaskId: agent.currentTaskId,
      contextId: agent.launchConfig?.env?.MARBLO_CONTEXT,
      resumeSessionId: resolvedSessionId,
      onPtyReady,
      claudeModelOverride,
      codexModelOverride,
      codexEffortOverride,
      nativeModelOverride,
      complexity,
    });

    // Carry over restart counters; spawnedAt is freshly set by launch().
    newInstance.restartCount = restartCount;
    newInstance.fastFailCount = fastFailCount;
    // 강등 래치도 함께 옮긴다 — 안 옮기면 재시작마다 래치가 리셋돼 강등이 루프한다.
    newInstance.claudeRuntimeDowngraded = claudeRuntimeDowngraded;
    newInstance.detectedModelId = detectedModelId;
  }

  /**
   * Release an agent's lifecycle timers — the restart-backoff setTimeout and
   * the heartbeat setInterval — so neither (nor the telemetry the heartbeat
   * emits) outlives the agent's PTY. Idempotent and null-safe: every teardown
   * path (stop / restart / auto-restart / PTY exit) calls it so timer cleanup
   * stays consistent across them.
   */
  private clearAgentTimers(agent: AgentInstance): void {
    if (agent.restartTimer) {
      clearTimeout(agent.restartTimer);
      agent.restartTimer = null;
    }
    if (agent.heartbeatTimer) {
      clearInterval(agent.heartbeatTimer);
      agent.heartbeatTimer = null;
    }
  }

  stop(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;

    // Mark as intentional stop before killing
    agent.stopRequested = true;
    this.clearAgentTimers(agent);

    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    agent.status = "stopped";
    agent.terminalSince = Date.now(); // P3-4: pruner backstop clock
    agent.restartCount = 0;
    this.onStatusChange?.(agentId, "stopped");
    mainTelemetry.agentStopped(this.getMainWindow?.() ?? null, agentId, 0, {
      taskId: agent.currentTaskId,
      model: agent.model,
      outputChars: agent.outputChars,
      noOutput: isNoOutputRun(agent.outputChars),
      errorCategory: "stopped_by_user",
    });
    // 하강 관측 — 이걸 빼면 2→1→2 의 두 번째 상승이 "안 늘었다"로 접혀 사라진다.
    this.noteLiveAgentCount();
  }

  restart(
    agentId: string,
    initialPromptOrOptions?: string | AgentRestartOptions,
  ): AgentInstance | null {
    const agent = this.agents.get(agentId);
    if (!agent) return null;
    const options =
      typeof initialPromptOrOptions === "string"
        ? { initialPrompt: initialPromptOrOptions }
        : (initialPromptOrOptions ?? {});
    const claudeRuntimeDowngraded = agent.claudeRuntimeDowngraded;
    // 과금 관측 보존(performAutoRestart 와 같은 이유).
    const detectedModelId = agent.detectedModelId;

    // Kill existing PTY + cleanup configs + heartbeat
    agent.stopRequested = true;
    this.clearAgentTimers(agent);
    this.ptyManager.kill(agent.ptySessionId);
    this.configGenerator.cleanup(agentId);
    this.agents.delete(agentId);

    // Re-launch with same params (+ optional initial prompt for dispatch restart)
    const restarted = this.launch({
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      command: agent.command,
      cwd: agent.cwd,
      currentTaskId: agent.currentTaskId,
      dispatchReason: agent.dispatchReason,
      contextId: agent.launchConfig?.env?.MARBLO_CONTEXT,
      initialPrompt: options.initialPrompt,
      onPtyReady: agent.onPtyReady,
      claudeModelOverride:
        options.claudeModelOverride ?? agent.claudeModelOverride,
      codexModelOverride:
        options.codexModelOverride ?? agent.codexModelOverride,
      codexEffortOverride:
        options.codexEffortOverride ?? agent.codexEffortOverride,
      nativeModelOverride:
        options.nativeModelOverride ?? agent.nativeModelOverride,
      // 난도 보존(performAutoRestart 와 같은 이유) — 명시 핀 없는 스폰의 모델은
      // 난도 파생이라, 이게 빠지면 재시작이 모델을 잃는다.
      complexity: options.complexity ?? agent.complexity,
    });
    restarted.claudeRuntimeDowngraded = claudeRuntimeDowngraded;
    restarted.detectedModelId = detectedModelId;
    return restarted;
  }

  getStatus(agentId: string): AgentStatus {
    const agent = this.agents.get(agentId);
    return agent?.status ?? "stopped";
  }

  getAgent(agentId: string): AgentInstance | null {
    return this.agents.get(agentId) ?? null;
  }

  getMCPConfig(agentId: string): LaunchConfig | null {
    const agent = this.agents.get(agentId);
    return agent?.launchConfig ?? null;
  }

  /**
   * 이 에이전트가 **실제로 어떤 모델·effort 로 떴는지**. 요청이 아니라 사실이다
   * — 우리가 만든 argv 를 되읽는다(§P2-3). 라우팅 지식그래프가 이 값을 소비하므로
   * "지정했으나 폴백됐다" 같은 경우에도 실제로 서빙된 쪽이 기록돼야 한다.
   *
   * 모델을 핀하지 않은 launch(오케 기본 경로 등)는 argv 에 모델 인자가 없으므로
   * undefined 를 돌려준다 — "CLI 기본값" 을 우리가 지어내지 않는다.
   */
  getSpawnedModel(agentId: string): SpawnedModelInfo | null {
    const agent = this.agents.get(agentId);
    if (!agent?.launchConfig) return null;
    return spawnedModelFromArgs(agent.model, agent.launchConfig.args);
  }

  /**
   * cost-tracker 가 과금 세션 메타데이터에서 읽어낸 **실제 모델 id** 를 되먹인다.
   * 관측만 받는다 — 하네스족 문자열(`claude`/`gpt`)은 모델 id 가 아니므로 버린다.
   * 그걸 통과시키면 "모델미상" 을 다른 이름으로 저장하는 셈이 된다.
   */
  setDetectedModel(agentId: string, modelId: string | null | undefined): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const id = (modelId ?? "").trim();
    if (!id || isHarnessFamilyId(id)) return;
    agent.detectedModelId = id;
  }

  /**
   * 이 에이전트의 **구체 실행 모델**, 근거가 강한 순서로.
   *
   *   1. argv 되읽기(`getSpawnedModel`) — 우리가 CLI 에 실제로 넘긴 값.
   *   2. `detectedModelId` — 과금된 세션이 기록한 모델. argv 에 모델을 핀하지
   *      않은 launch(오케 기본 경로·Agents 탭 ▶Start·콜드부트 reconnect)에서는
   *      이쪽만 존재하고, 그 경로들이 곧 dispatchMeta/KG 의 "모델미상" 출처였다.
   *
   * 둘 다 없으면 null — CLI 기본값을 지어내지 않는다(관측만 기록한다는 규율).
   * effort 축은 argv 에만 있다: 과금 메타데이터는 effort 를 남기지 않으므로
   * detected 로 떨어질 때는 model 만 채운다(없는 축을 만들지 않는다).
   */
  resolveConcreteModel(agentId: string): SpawnedModelInfo | null {
    const fromArgs = this.getSpawnedModel(agentId);
    if (fromArgs?.modelId) return fromArgs;
    const detected = this.agents.get(agentId)?.detectedModelId?.trim();
    if (!detected) return fromArgs;
    // argv 가 effort 만 준 경우(codex 기본 경로)는 그 effort 를 유지한 채 모델만 채운다.
    return fromArgs?.effort
      ? { modelId: detected, effort: fromArgs.effort }
      : { modelId: detected };
  }

  getConfigGenerator(): AgentConfigGenerator {
    return this.configGenerator;
  }

  /**
   * Whether the given agent has any saved CLI session in its isolated
   * home dir. Used by the reconnect path to decide if `resume --last`
   * (codex) / `--resume latest` (gemini) / `--continue` (grok) is safe to
   * pass — running those against an empty sessions dir errors out on some
   * CLIs and would just leave a dead PTY.
   *
   * `cwd` only narrows the grok answer (its sessions are keyed by working
   * directory); other harnesses ignore it.
   */
  hasSavedSession(agentId: string, model: ModelType, cwd?: string): boolean {
    return this.configGenerator.hasSavedSession(agentId, model, cwd);
  }

  setStatus(agentId: string, status: AgentStatus): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // No-op when status is unchanged. The new PTY-activity hook calls
    // setStatus("working") on every output chunk; without this guard each
    // chunk would fire onStatusChange → IPC broadcast → renderer rerender,
    // which is wasteful and could storm the renderer during heavy streams.
    if (agent.status === status) return;
    // W1: a genuine promotion to `working` (dispatch / route / nudge / a real
    // new turn) clears the completed-turn marker so follow-up work is never
    // suppressed by the settle window. The trailing-flush promotion is already
    // filtered out upstream by shouldPromoteOnPtyOutput, so anything that
    // reaches here as `working` is real work.
    if (status === "working") agent.turnCompletedAt = null;
    // P3-4: any transition back to a live state clears the terminal clock so a
    // revived agent isn't pruned by the backstop reaper.
    if (status !== "stopped" && status !== "error") agent.terminalSince = null;
    agent.status = status;
    // A terminal PTY cannot be waiting on anyone — retract the notification so
    // a crashed/stopped agent doesn't leave a permanent "answer me" badge.
    if (status === "stopped" || status === "error") {
      this.clearInputWait(agentId);
    }
    this.onStatusChange?.(agentId, status);
    // 종단 전이(→stopped/error)와 부활(error→idle)이 둘 다 여기를 지난다.
    // idle↔working 은 live 수를 바꾸지 않으므로 아무 것도 발신되지 않는다.
    this.noteLiveAgentCount();
  }

  /**
   * W1: mark the agent's current turn complete and free its slot immediately.
   * Called from the bridge /set-agent-status idle path (which fires when a
   * worker reports its bound task terminal via submit_for_review /
   * update_task_status). Stamps `turnCompletedAt` BEFORE demoting so the
   * trailing render flush that follows can't re-promote the agent to `working`
   * (shouldPromoteOnPtyOutput suppresses output-driven promotion for as long as
   * the completion report stands). Idempotent — safe to call repeatedly.
   */
  markTurnComplete(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === "stopped" || agent.status === "error") return;
    agent.turnCompletedAt = Date.now();
    // Retain the binding for the reaper BEFORE releasing it. Clearing
    // currentTaskId without this is what made every cleanly-completed agent
    // unreapable (see AgentInstance.lastTaskId).
    if (agent.currentTaskId) agent.lastTaskId = agent.currentTaskId;
    agent.currentTaskId = null;
    // Demote directly (bypass setStatus's working-clear path) so the marker
    // set above survives the transition to idle.
    if (agent.status !== "idle") {
      agent.status = "idle";
      this.onStatusChange?.(agentId, "idle");
    }
    // Retract any standing "waiting for you" badge immediately. foldInputWait
    // would also drop it on the next frame/heartbeat once turnCompletedAt is
    // set, but waiting a full heartbeat left completed agents sticky on screen.
    this.clearInputWait(agentId);
  }

  setCurrentTask(agentId: string, taskId: string | null): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.currentTaskId = taskId;
    if (taskId) agent.lastTaskId = taskId;
  }

  setDispatchReason(agentId: string, dispatchReason: string | null): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    agent.dispatchReason = dispatchReason;
  }

  /**
   * A new turn was submitted to this agent — clear the completed-turn marker so
   * the agent can be promoted to `working` again.
   *
   * Wired to PtyManager.onSubmit, so it fires for EVERY way work arrives:
   * dispatch, reuse_agent, a nudge, a Telegram forward, or a human pressing
   * Enter in the terminal tab. That last one matters — without an input-side
   * signal, manual terminal use after a completion report would leave the agent
   * pinned at `idle` while it was genuinely working.
   *
   * Does not itself set `working`; the first output byte does that (promotion is
   * now unblocked). Ignored for terminal agents.
   */
  noteTurnStart(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (agent.status === "stopped" || agent.status === "error") return;
    agent.turnCompletedAt = null;
    // The agent is no longer parked at its prompt, and the submission itself is
    // fresh evidence of life. A nudged agent therefore gets a FULL new
    // idle-at-prompt window before the watchdog may judge it parked again —
    // without this, one nudge would be immediately followed by the next rung.
    const fresh = resetPromptIdleOnTurnStart(Date.now());
    agent.lastWorkOutput = fresh.lastWorkOutputAt;
    agent.promptIdleSince = fresh.promptIdleSince;
    // Someone typed. Whatever the agent was waiting for, it has been answered —
    // retract the notification without waiting for the next frame to prove it.
    this.clearInputWait(agentId);
  }

  /**
   * Re-evaluate whether a human is being waited on, and push the result to the
   * renderer IF IT CHANGED.
   *
   * Edge-triggered by design. A parked TUI repaints several times a second, so
   * a level-triggered emit would be a stream, and the renderer would have to
   * re-derive "one notification per agent" from it. Emitting only transitions
   * makes that invariant structural: one rise, one fall, per agent.
   *
   * @param kind the frame just classified, or null for a timer-driven check.
   */
  private refreshInputWait(agentId: string, kind: PtyFrameKind | null): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    const now = Date.now();
    const next = foldInputWait(agent.inputWaitReason, {
      kind,
      promptIdleSince: agent.promptIdleSince,
      turnCompletedAt: agent.turnCompletedAt,
      terminal:
        agent.stopRequested ||
        agent.status === "stopped" ||
        agent.status === "error",
      now,
    });
    if (next === agent.inputWaitReason) return;
    agent.inputWaitReason = next;
    agent.inputWaitSince = next === null ? null : now;
    this.onInputWait?.({
      agentId,
      agentName: agent.name,
      projectId: agent.launchConfig?.env?.MARBLO_PROJECT || "",
      taskId: agent.currentTaskId,
      waiting: next !== null,
      reason: next,
      since: agent.inputWaitSince,
    });
  }

  /**
   * Force-retract a standing input-wait (turn submitted, agent gone terminal,
   * agent removed). Silent when nothing was standing, so it is safe to call
   * from every teardown path.
   */
  private clearInputWait(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent || agent.inputWaitReason === null) return;
    agent.inputWaitReason = null;
    agent.inputWaitSince = null;
    this.onInputWait?.({
      agentId,
      agentName: agent.name,
      projectId: agent.launchConfig?.env?.MARBLO_PROJECT || "",
      taskId: agent.currentTaskId,
      waiting: false,
      reason: null,
      since: null,
    });
  }

  /**
   * Answer the first-run bypass-permissions consent screen, once per instance.
   *
   * This is not a general "click OK for the agent" facility and must never grow
   * into one: it answers exactly the screen that OUR OWN
   * `--dangerously-skip-permissions` flag provokes, where the user's intent is
   * already expressed by the flag. Every other prompt is surfaced to the human
   * instead (refreshInputWait above).
   *
   * The latch is set BEFORE the write, so a screen that repaints while the
   * keystrokes are in flight can't queue a second answer.
   */
  private maybeAcceptBypassConsent(agentId: string, chunk: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    if (
      !shouldAutoAcceptBypass({
        chunk,
        model: agent.model,
        spawnedAt: agent.spawnedAt,
        now: Date.now(),
        alreadyAnswered: agent.bypassConsentAnswered,
      })
    ) {
      return;
    }
    agent.bypassConsentAnswered = true;
    const sid = agent.ptySessionId;
    console.log(
      `[AgentManager] Auto-accepting bypass-permissions consent for ` +
        `${agent.name} (${agentId}) — we launched it with the flag.`,
    );
    try {
      this.ptyManager.write(sid, BYPASS_CONSENT_SELECT);
      // Two writes, one tick apart, so the TUI reads them as separate keys.
      // Unref'd: a pending 150 ms timer must not hold up app quit.
      const timer = setTimeout(() => {
        try {
          this.ptyManager.write(sid, BYPASS_CONSENT_CONFIRM);
        } catch {
          // PTY died between the two writes — the exit path owns it from here.
        }
      }, BYPASS_CONSENT_CONFIRM_DELAY_MS);
      timer.unref?.();
    } catch (err) {
      console.warn(
        `[AgentManager] bypass consent auto-accept failed for ${agentId}:`,
        err,
      );
    }
  }

  getAgentByName(name: string): AgentInstance | null {
    for (const agent of this.agents.values()) {
      if (agent.name === name) return agent;
    }
    return null;
  }

  /**
   * Remove an agent from the in-memory map (after stop).
   * Call this when deleting an agent from Firestore.
   */
  remove(agentId: string): void {
    const agent = this.agents.get(agentId);
    if (!agent) return;
    // Stop first if still running
    if (agent.status !== "stopped" && agent.status !== "error") {
      this.stop(agentId);
    }
    // Retract before the entry disappears — clearInputWait reads the instance
    // to build the event, so after the delete there is nothing left to retract
    // and the renderer would keep a notification for an agent that is gone.
    this.clearInputWait(agentId);
    this.agents.delete(agentId);
    this.noteLiveAgentCount();
    console.log(`[AgentManager] Removed agent ${agent.name} (${agentId})`);
  }

  /**
   * Register a reconnected agent into the in-memory map so dispatch can find it.
   */
  registerReconnected(agent: {
    id: string;
    name: string;
    model: ModelType;
    role: string;
    command: string;
    cwd: string;
    ptySessionId: string;
  }): void {
    if (this.agents.has(agent.id)) return; // Already registered
    const instance: AgentInstance = {
      id: agent.id,
      name: agent.name,
      model: agent.model,
      role: agent.role,
      ptySessionId: agent.ptySessionId,
      status: "idle",
      command: agent.command,
      cwd: agent.cwd,
      currentTaskId: null,
      lastTaskId: null,
      dispatchReason: null,
      restartCount: 0,
      fastFailCount: 0,
      spawnedAt: Date.now(),
      lastExitCode: null,
      stopRequested: false,
      restartTimer: null,
      heartbeatTimer: null,
      lastPtyActivity: Date.now(),
      lastWorkOutput: Date.now(),
      promptIdleSince: null,
      inputWaitReason: null,
      inputWaitSince: null,
      // Reconnect attaches to a CLI that already booted, so its consent screen
      // (if any) is long past — the latch starts spent rather than armed.
      bypassConsentAnswered: true,
      outputChars: 0,
      turnCompletedAt: null,
      terminalSince: null,
    };
    this.agents.set(agent.id, instance);
    // Same PTY-activity hook as launch() — reconnected agents need
    // working/idle auto-derivation too (incl. the W1 completed-turn suppression).
    this.ptyManager.onData(agent.ptySessionId, (chunk) => {
      const a = this.agents.get(agent.id);
      if (!a || a !== instance) return;
      a.lastPtyActivity = Date.now();
      a.outputChars += chunk.length;
      // Same idle-at-prompt distillation as launch() — a reconnected agent can
      // fall back to its prompt mid-task just as easily.
      const kind = classifyPtyFrame(chunk, a.model);
      const framed = applyPtyFrame(
        {
          lastWorkOutputAt: a.lastWorkOutput,
          promptIdleSince: a.promptIdleSince,
        },
        kind,
        Date.now(),
      );
      a.lastWorkOutput = framed.lastWorkOutputAt;
      a.promptIdleSince = framed.promptIdleSince;
      // A reconnected agent attaches to an ALREADY-BOOTED CLI, so it is past
      // its first-run consent screen — no auto-accept here, deliberately. The
      // input-wait signal still applies: it can park at a prompt like any other.
      this.refreshInputWait(agent.id, kind);
      if (
        shouldPromoteOnPtyOutput({
          status: a.status,
          stopRequested: a.stopRequested,
          turnCompletedAt: a.turnCompletedAt,
          now: Date.now(),
        })
      ) {
        this.setStatus(agent.id, "working");
      }
    });
    // Input side of the turn boundary — same as launch().
    this.ptyManager.onSubmit(agent.ptySessionId, () => {
      const a = this.agents.get(agent.id);
      if (!a || a !== instance) return;
      this.noteTurnStart(agent.id);
    });
    console.log(
      `[AgentManager] Registered reconnected agent: ${agent.name} (${agent.id})`,
    );
    // 콜드부트 재접속도 진짜 동시실행이다 — 앱을 껐다 켜도 2대가 붙어 있으면
    // 그 사람은 지금 멀티에이전트를 쓰고 있는 것이다.
    this.noteLiveAgentCount();
  }

  listAgents(): AgentInstance[] {
    return Array.from(this.agents.values());
  }

  /**
   * ★지금 동시에 살아 있는 에이전트 수(티켓 pWSnJeQN).
   *
   * 프로젝트로 나누지 않는다 — 사장님이 보려는 KPI 는 "이 사람이 에이전트 2대를
   * 동시에 굴렸나" 이지 "한 보드 안에서 굴렸나" 가 아니다. `working` 은 그중
   * 실제로 턴이 열려 있는 수로, 참고치로 함께 낸다(PTY 바이트 파생이라 양방향
   * 오판이 있는 축이므로 판정에는 쓰지 않는다).
   */
  getConcurrency(): { live: number; working: number } {
    let live = 0;
    let working = 0;
    for (const agent of this.agents.values()) {
      if (!isLiveAgentStatus(agent.status)) continue;
      live++;
      if (agent.status === "working") working++;
    }
    return { live, working };
  }

  /**
   * live 수의 변화를 관측해 **상승 엣지에서만** `onboarding:multi_agent_active`
   * 를 발신한다. 스폰 직후와 모든 종단 전이(정상종료/사용자중지/에러) 뒤에
   * 불린다 — 하강을 관측하지 않으면 2→1→2 의 두 번째 상승을 놓친다.
   *
   * 비식별: 이벤트에 실리는 것은 **개수**뿐이다(에이전트 id·이름·모델 없음).
   */
  private noteLiveAgentCount(): void {
    const { live, working } = this.getConcurrency();
    const previous = this.lastLiveAgentCount;
    this.lastLiveAgentCount = live;
    if (!shouldEmitMultiAgentActive(previous, live)) return;
    mainTelemetry.multiAgentActive(
      this.getMainWindow?.() ?? null,
      live,
      working,
    );
  }

  /**
   * List agents whose injected MARBLO_PROJECT env var matches `projectId`.
   * Used by multi-window mode to scope each window's view to its own project.
   * If `projectId` is falsy or empty, returns all agents (legacy behavior).
   */
  listAgentsByProject(projectId: string | undefined): AgentInstance[] {
    if (!projectId) return this.listAgents();
    return Array.from(this.agents.values()).filter(
      (a) => a.launchConfig?.env?.MARBLO_PROJECT === projectId,
    );
  }

  stopAll(): void {
    if (this.pruneTimer) {
      clearInterval(this.pruneTimer);
      this.pruneTimer = null;
    }
    for (const [id] of this.agents) {
      this.stop(id);
    }
    this.configGenerator.cleanupAll();
  }
}
