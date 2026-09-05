/**
 * telegram-poller — the electron-main-owned Telegram getUpdates poller.
 *
 * ★WHY THIS EXISTS (ticket vw38IB2VcmOIOlFV51Wa — "폴러를 오케에서 완전 분리")
 *
 * Telegram's getUpdates is SINGLE-CONSUMER per bot: only one long-poll may be
 * outstanding, and a second one evicts the first with HTTP 409. Previously the
 * poller ran INSIDE the orchestrator's claude session (`--channels
 * plugin:telegram` → `bun server.ts`), so every orchestrator churn (restart,
 * resume, handover, board+mission double-launch) spawned/killed a poller and
 * produced 409 flapping even in steady state. A per-project single-owner lock
 * (#298) narrowed but never closed the race, because the poller's lifecycle was
 * owned by claude's MCP host, not by Marblo.
 *
 * This module moves ownership to electron main: exactly ONE getUpdates loop per
 * project, whose lifecycle is Marblo's alone. No orchestrator carries
 * `--channels`. The loop:
 *   - self-heals a stray webhook on start (getWebhookInfo → deleteWebhook,
 *     drop_pending_updates=false) — webhook + getUpdates are mutually exclusive
 *     (a webhook 409-wedges getUpdates permanently);
 *   - long-polls getUpdates and routes each inbound message to the project's
 *     CURRENT live orchestrator (board wins over mission) via injectMessage;
 *   - is AT-LEAST-ONCE: when no orchestrator is live it does NOT advance the
 *     offset, so the message is redelivered once one boots;
 *   - persists the offset to disk so a restart resumes without reprocessing.
 *
 * Outbound (send_telegram_message MCP tool) routes back here via the bridge.
 *
 * Invariants: exactly one loop per project, enforced for the loop's WHOLE life
 * — including the window where it has been asked to stop but its getUpdates is
 * still outstanding (ticket 3asM22VKCCXgAlfnNXTJ: retiring a loop by removing
 * its registry entry first did not retire a CONSUMER, and a loop started in
 * that window collided with it for a permanent 409). The bot token NEVER
 * appears in a log, error, or return value (scrubToken).
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  telegramApi,
  scrubToken,
  probeAndHealTelegramWebhook,
  TelegramHttpError,
  type TelegramApiOptions,
} from "./telegram-health";
import {
  listTelegramChannelConfigs,
  getTelegramChannelConfig,
  isTelegramChannelActive,
  getTelegramChannelAccess,
  neutralizeTelegramPluginConfig,
  getTelegramPluginStateDir,
  getTelegramPluginStateDirs,
  listTelegramChatIdSharers,
} from "./telegram-channels";
import { getTelegramProjectLabel } from "./telegram-channel-sync";
import {
  TELEGRAM_LEASE_RENEW_MS,
  TELEGRAM_LEASE_RETRY_MS,
  telegramLeaseTokenHash,
  type TelegramLeaseDecision,
  type TelegramLeaseGate,
  type TelegramPollerLease,
} from "./telegram-poller-lease";
import { recordOwnerInbound } from "./mcp-server/owner-inbound";

// ─── Telegram update shapes (only the fields we read) ─────────────────────

interface TgChat {
  id: number | string;
}
interface TgFrom {
  id?: number;
  username?: string;
  first_name?: string;
  last_name?: string;
}
interface TgMessage {
  chat?: TgChat;
  from?: TgFrom;
  text?: string;
}
interface TgUpdate {
  update_id: number;
  message?: TgMessage;
}

// ─── Deps (all injectable for tests; defaults hit the live channel store) ──

/** Minimal shape of a live orchestrator the poller injects inbound text into. */
export interface InboundTarget {
  injectMessage(text: string): Promise<boolean>;
  /**
   * Whether the orchestrator is still live. Diagnostics only; offset
   * advancement is based on injectMessage's actual write result.
   */
  isRunning?(): boolean;
  /** Token-free target metadata for handoff diagnostics and health. */
  describe?(): InboundTargetDescriptor;
  /**
   * Why the LAST injectMessage returned false, when the target can say.
   * Diagnostics only — never consulted for delivery decisions (the boolean is
   * still the whole truth about whether the write happened).
   *
   * ★This is the difference between "the orchestrator is gone" and "the
   * orchestrator is alive but its composer is blocked", which look identical
   * to the user (nothing arrives) and have opposite fixes.
   */
  describeInjectFailure?(): InjectFailureDescriptor | null;
}

export interface InboundTargetDescriptor {
  kind: string;
  ptySessionId: string | null;
  status: string;
}

/** Token-free, body-free reason a target refused the last injection. */
export interface InjectFailureDescriptor {
  /** Machine-readable refusal name (orchestrator-manager's InjectRefusal). */
  refusal: string;
  /** Composer verdict when the refusal came from the PTY write; else null. */
  composer: string | null;
  /** One human-readable line. */
  detail: string;
}

export interface TelegramPollerDeps {
  /**
   * Resolve the CURRENT live orchestrator for a project, or null when none is
   * running. Main wires this to "board if running, else mission if running".
   * When null the poller does NOT advance the offset — at-least-once delivery
   * so the message arrives after the next orchestrator boot.
   */
  resolveOrchestrator: (projectId: string) => InboundTarget | null;
  /** Active projects with a live Telegram channel. Default: channel store. */
  listActiveProjectIds?: () => string[];
  /** Bot token for a project (null ⇒ inactive, skip). Default: channel store. */
  getToken?: (projectId: string) => string | null;
  /** Default reply chatId (config chatId). Default: channel store. */
  getDefaultChatId?: (projectId: string) => string | null;
  /**
   * Inbound allowlist. Empty/undefined ⇒ allow all. Default: access store.
   * A message from a chatId not on a non-empty allowlist is dropped (offset
   * advanced) — inbound can trigger but must be from an authorized chat.
   */
  getAllowedChatIds?: (projectId: string) => string[];
  fetchImpl?: typeof fetch;
  /** Offset persistence file. Default ~/.marblo/telegram-poller-offsets.json */
  offsetFilePath?: string;
  /** getUpdates long-poll seconds (query `timeout`). Default 25. */
  longPollSeconds?: number;
  /** Sleep when no live orchestrator (offset held for redelivery), ms. Default 3000. */
  idleBackoffMs?: number;
  /** Sleep after a transient network/API error, ms. Default 5000. */
  errorBackoffMs?: number;
  /**
   * Un-replied nudge: after an inbound is injected, the poller waits for the
   * orchestrator to go idle (busy→quiet transition fed via
   * markOrchestratorActivity). This is the quiet window (ms) after the last
   * busy signal that counts as "turn ended". Default 6000.
   */
  nudgeIdleDebounceMs?: number;
  /**
   * Fallback for the nudge when NO activity signal ever arrives (orchestrator
   * already idle/stuck, or main didn't wire activity): the max time (ms) after
   * injection before the nudge check runs anyway. Default 120000.
   */
  nudgeMaxGraceMs?: number;
  /** Outbound sendMessage retries on network/5xx/429 (total = 1 + this). Default 2. */
  sendMaxRetries?: number;
  /** Base backoff (ms) for outbound retries; doubles each attempt. Default 500. */
  sendBackoffMs?: number;
  /**
   * ★How long an offset-hold may last before the OWNER is told, in ms.
   * Default 60000; <= 0 disables the notice.
   *
   * A held offset is correct (the message is not lost, it is waiting), but from
   * the phone it is indistinguishable from a dead app — which is the whole P1.
   * Outbound sendMessage does NOT go through the orchestrator PTY, so it still
   * works while inbound is blocked; that is the one channel left to say why it
   * is quiet. Exactly ONE notice per hold episode.
   */
  holdNotifyAfterMs?: number;
  /** Injectable sleep (tests capture wait durations / skip real delays). */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Injectable logger (tests). Defaults to console. */
  logger?: Pick<Console, "log" | "warn" | "error">;
  /** Called when the registered poll-loop set changes. */
  onLoopActivityChange?: () => void;
  /**
   * Directory the official claude telegram plugin reads its state from
   * (`.env` with the bot token, `bot.pid` of a booted plugin poller). Used by
   * the 409 diagnosis to name the external holder. Default: channel store's
   * plugin dir (~/.claude/channels/telegram).
   */
  pluginStateDir?: string;
  /**
   * ★토큰이 남아 있을 수 있는 **모든** 플러그인 상태 디렉토리
   * (티켓 hAzP05kOTxggd8LhZGwT). 409 진단이 전부를 훑어 어느 자리가 우리 봇의
   * 토큰을 쥐고 있는지 이름을 댄다. 기본: 채널 저장소의 후보 집합.
   */
  pluginStateDirs?: string[];
  /**
   * Startup cleanup of a bot token a past build materialized into the plugin
   * state dir (see telegram-channels neutralizePluginConfig). Default: the
   * channel store's neutralizer; injectable for tests.
   */
  neutralizePluginConfig?: () => {
    tokenRemoved: boolean;
    /** 실제로 토큰을 지운 디렉토리들(있으면 로그가 이름을 댄다). */
    cleanedDirs?: string[];
  };
  /** Min interval (ms) between full 409 diagnosis logs per project. Default 300000. */
  diag409ThrottleMs?: number;
  /**
   * Other ENABLED projects configured to send into the same chatId (channel
   * store's listChatIdSharers by default). Non-empty ⇒ replies from several
   * projects land in ONE chat, so outbound gets a `[project] ` prefix to tell
   * the orchestrators apart. Injectable for tests.
   */
  listChatIdSharers?: (projectId: string, chatId: string) => string[];
  /**
   * Human label for the outbound prefix (project name). Default: the
   * channel-sync label cache; null falls back to a short projectId.
   */
  getProjectLabel?: (projectId: string) => string | null;
  /**
   * A completed getUpdates round trip longer than the abort budget times this
   * factor is treated as "the process was suspended mid-request", and the loop
   * skips its backoff to re-poll at once. Default 2 (i.e. >2x the budget).
   */
  suspendGraceFactor?: number;
  /**
   * ★기기 간 폴러 리스 (티켓 hAzP05kOTxggd8LhZGwT). 주입되면 루프는 getUpdates
   * 를 한 번도 열기 전에 리스를 잡고, 폴링 중에는 주기적으로 갱신한다. 다른
   * 기기가 같은 봇(=같은 tokenHash)의 유효한 리스를 들고 있으면 이 기기는
   * 폴링을 시작하지 않는다 — 그것이 두 맥이 서로를 409 로 강탈하던 경로다.
   *
   * ★미주입이면 게이트 자체가 없다(항상 폴링). 리스는 순수 추가 방어선이며,
   * 없다고 해서 기존 동작이 달라져서는 안 된다.
   */
  leaseGate?: TelegramLeaseGate;
  /** 남의 리스에 막혔을 때 재시도 간격(ms). Default 15000. */
  leaseRetryMs?: number;
  /** 리스 갱신 주기(ms). Default 30000. */
  leaseRenewMs?: number;
  /**
   * 409 가 몇 번 연속되면 "마블로 밖의 무언가가 이 봇을 폴링 중"으로 보고
   * 사용자에게 노출하는가. Default 3.
   */
  contention409Threshold?: number;
  /**
   * Minimum gap (ms) between honored {@link TelegramPoller.notePowerResume}
   * nudges. powerMonitor's `user-did-become-active` can fire in bursts; without
   * this a burst would cancel every backoff in a row and hammer the API on a
   * persistent error. Default 5000.
   */
  resumeNudgeThrottleMs?: number;
}

/** Result of an outbound sendMessage — never carries the bot token. */
export interface SendResult {
  ok: boolean;
  /** chatId the message was sent to (echoed for confirmation). */
  chatId?: string;
  /** Token-scrubbed failure reason when ok=false. */
  error?: string;
}

/**
 * Per-project outbound/inbound reliability counters (spec C). Surfaced in the
 * 4-min health sweep so silent loss is visible in logs + the health channel.
 */
export interface ReliabilityStats {
  /** Inbound messages the orchestrator never replied to (after a nudge). */
  unanswered: number;
  /** Outbound sends that failed after all retries. */
  sendFailures: number;
}

/**
 * Why the poller is currently holding the offset instead of advancing it.
 *
 *   no-orchestrator — resolveOrchestrator returned null. Nothing is live to
 *                     receive the message. (Was the ONE completely silent
 *                     branch in this file before ticket c1R9C8v5MrBycZYSdTeB.)
 *   inject-refused  — an orchestrator IS live and injectMessage returned false.
 *                     The reason lives in `detail` (composer occupied, dialog
 *                     awaiting a choice, boot gate, mission change).
 *   inject-threw    — injectMessage threw.
 */
export type TelegramHoldReason =
  | "no-orchestrator"
  | "inject-refused"
  | "inject-threw";

/**
 * ★Why a getUpdates poll failed (ticket 6umMHxuDmggv3R8Q1Mw6). Token-free and
 * body-free by construction — a fixed vocabulary, never the raw error message
 * (which could echo request internals). Before this, `consecutivePollErrors`
 * only carried a count; nothing said what kind of failure was accumulating,
 * which was the biggest observation gap when the route journal was read back.
 *
 *   http-409   — another consumer holds this bot's getUpdates (see maybeDiagnose409).
 *   http-429   — rate limited.
 *   http-5xx   — Telegram-side server error.
 *   http-4xx   — any other non-2xx (bad request, revoked token, etc).
 *   timeout    — the abort fired (AbortError) before a response arrived.
 *   network    — fetch itself threw (DNS/reset/offline), not an HTTP error.
 *   api-not-ok — HTTP 200 but the Bot API envelope said `ok:false`.
 *   unknown    — a non-Error throw, or a shape we don't recognize.
 */
export type TelegramPollErrorKind =
  | "http-409"
  | "http-429"
  | "http-5xx"
  | "http-4xx"
  | "timeout"
  | "network"
  | "api-not-ok"
  | "unknown";

/**
 * ★기기 간 리스 게이트가 지금 어느 단계에 있는가 (티켓 hAzP05kOTxggd8LhZGwT).
 *
 *   unknown   — 게이트가 아직 안 돌았거나 리스를 쓰지 않는다.
 *   owner     — 이 기기가 리스를 들고 폴링 중이다(정상).
 *   fail-open — 리스를 읽거나 쓰지 못했지만 **폴링은 그대로 진행 중**이다.
 *               ★이 값이 보인다는 것은 기기 간 가드가 꺼진 채 돌고 있다는
 *               뜻이지, 텔레그램이 멈췄다는 뜻이 아니다.
 *   blocked   — 다른 기기가 같은 봇의 유효한 리스를 들고 있어 폴링하지 않는다.
 */
export type TelegramLeasePhase = "unknown" | "owner" | "fail-open" | "blocked";

/** 리스 게이트의 사용자·저널용 스냅샷. 토큰은 어떤 필드에도 없다. */
export interface TelegramLeaseSnapshot {
  phase: TelegramLeasePhase;
  /** 리스 보유 기기의 machineId(blocked 일 때 상대, owner 일 때 우리). */
  holderId: string | null;
  /** 사람이 읽는 보유 기기 이름 — UI 문구에 그대로 들어간다. */
  hostLabel: string | null;
  /** 보유 리스의 마지막 갱신 시각(epoch ms). */
  renewedAt: number | null;
  /** fail-open 일 때의 토큰 없는 사유 한 줄. 아니면 null. */
  failOpenReason: string | null;
  /** 이 단계에 들어온 시각. */
  since: number;
}

/**
 * ★사용자에게 보여줄 경합 상태 (티켓 hAzP05kOTxggd8LhZGwT).
 *
 * 이 티켓의 절반은 "사용자가 이 상황을 전혀 볼 수 없었다"이다. 지금까지 409 는
 * maybeDiagnose409 의 log.warn 으로만 나가서 아무도 못 봤다. 이 타입이 그 사실을
 * 렌더러까지 실어 나른다.
 *
 *   none             — 경합 없음.
 *   other-device     — 다른 **마블로 기기**가 리스를 들고 있다. 누가/언제까지
 *                      갱신했는지 말할 수 있다(hostLabel·renewedAt).
 *   foreign-consumer — 우리가 리스 보유자(또는 리스가 fail-open)인데도 409 가
 *                      연속된다. 즉 리스 밖의 제3자 — 마블로가 아닌 무언가가
 *                      이 봇을 폴링하고 있다. 대응이 완전히 다르므로 문구도
 *                      다르게 나가야 한다.
 */
export type TelegramContentionKind =
  | "none"
  | "other-device"
  | "foreign-consumer";

export interface TelegramContention {
  projectId: string;
  kind: TelegramContentionKind;
  /** other-device 일 때 상대 기기 이름. 아니면 null. */
  hostLabel: string | null;
  /** other-device 일 때 상대 리스의 마지막 갱신 시각(epoch ms). */
  renewedAt: number | null;
  /** 지금 연속된 409 횟수(성공 폴 한 번이면 0으로 리셋). */
  consecutive409: number;
  /** 409 연속이 시작된 시각. 연속이 없으면 null. */
  since409: number | null;
  /** 리스 게이트가 fail-open 으로 돌고 있는가(기기 간 가드가 꺼진 상태). */
  leaseFailOpen: boolean;
  /** 리스 게이트의 현재 단계(진단·저널용). */
  leasePhase: TelegramLeasePhase;
}

/** A live offset-hold episode (one per project; cleared on first delivery). */
export interface TelegramHoldSnapshot {
  reason: TelegramHoldReason;
  /** The update the offset is pinned to. */
  updateId: number;
  since: number;
  /** How long the hold has lasted (ms), as of the snapshot. */
  heldMs: number;
  /** Redelivery attempts made during this episode. */
  attempts: number;
  /** Target-supplied refusal detail (inject-refused only); else null. */
  detail: InjectFailureDescriptor | null;
}

export interface TelegramRouteHealth {
  projectId: string;
  loopRunning: boolean;
  /**
   * ★Loop IDENTITY (ticket 3asM22VKCCXgAlfnNXTJ).
   *
   * Every counter below is keyed by projectId, so a second loop for the same
   * project writes into the SAME slots as the first — which makes "one loop
   * losing every poll" and "two of our own loops evicting each other" produce
   * an identical time series. That ambiguity is what made the last three
   * investigations argue from inference instead of measurement.
   *
   * These fields end it. `loopId` names the registered loop; `lastPollLoopId`
   * names the loop that actually completed the last round trip; and
   * `concurrentLoops` counts the loops alive for this project RIGHT NOW.
   * `lastPollLoopId` flipping between two values — or `concurrentLoops > 1` —
   * is duplicate consumers, stated as data rather than deduced.
   *
   * Loop ids are pid + project + a monotonic generation. No token, no chatId.
   */
  loopId: string | null;
  /** Loops alive for this project right now. >1 is always a bug. */
  concurrentLoops: number;
  /** How many loops have ever been started for this project this process. */
  loopStarts: number;
  /** Which loop recorded the last getUpdates round trip. */
  lastPollLoopId: string | null;
  /** Which loop recorded the last successful inbound delivery. */
  lastDeliveredLoopId: string | null;
  lastChatIdKnown: boolean;
  pendingReply: boolean;
  lastInboundAt: number | null;
  lastDeliveredUpdateId: number | null;
  lastDeliveredTarget: InboundTargetDescriptor | null;
  reliability: ReliabilityStats;
  /**
   * ★Loop liveness (ticket c1R9C8v5MrBycZYSdTeB). `loopRunning` only says the
   * handle is registered — it stays true for a loop wedged inside a stalled
   * fetch. These say whether the loop is actually TURNING: a getUpdates that
   * started and never completed, or a completion timestamp older than the
   * long-poll budget, is a stopped loop no matter what `loopRunning` claims.
   */
  lastPollStartedAt: number | null;
  lastPollCompletedAt: number | null;
  /** Consecutive getUpdates failures (network/API). Reset on any success. */
  consecutivePollErrors: number;
  lastPollErrorAt: number | null;
  /**
   * ★What kind the CURRENT error streak is (ticket 6umMHxuDmggv3R8Q1Mw6). Reset
   * to null in lockstep with consecutivePollErrors on the next success — this
   * answers "what is accumulating right now", not "what has ever happened".
   */
  lastPollErrorKind: TelegramPollErrorKind | null;
  /** HTTP status for the current error streak, when the error carried one. */
  lastPollErrorStatus: number | null;
  /**
   * ★Wall-clock duration of the last completed getUpdates round trip (ms).
   *
   * The whole point of this field is that it CANNOT legitimately exceed the
   * abort budget ((longPoll + 10)s). If it does, the deadline timer itself was
   * not scheduled — i.e. the process was suspended mid-request, not the request
   * hung. That is the one measurement that tells "Telegram was slow" apart from
   * "macOS stopped running us" without needing a second sampler.
   */
  lastPollDurationMs: number | null;
  /**
   * How many times the loop skipped its error/idle backoff because the round
   * trip above blew past the suspend threshold. A rising counter across a
   * silence means the recovery path was exercised — and that the process is
   * being repeatedly put back to sleep.
   */
  suspendedPollRecoveries: number;
  /**
   * ★The other half of the same question: the loop turns fine but every
   * delivery is refused. Non-null ⇒ the offset is pinned right now.
   */
  hold: TelegramHoldSnapshot | null;
  /**
   * ★연속 409 횟수 (티켓 hAzP05kOTxggd8LhZGwT). consecutivePollErrors 는
   * 409·타임아웃·네트워크를 한 칸에 섞어 세므로 "다른 소비자가 우리를 계속
   * 밀어내고 있다"를 그것만으로는 말할 수 없다. 성공 폴 한 번이면 0으로 리셋.
   */
  consecutive409: number;
  /** 409 연속이 시작된 시각. 연속이 없으면 null. */
  since409: number | null;
  /** 기기 간 리스 게이트의 현재 스냅샷. 리스를 안 쓰면 phase="unknown". */
  lease: TelegramLeaseSnapshot;
  /** ★사용자에게 그대로 보여줄 경합 판정. */
  contention: TelegramContention;
}

const DEFAULT_OFFSET_FILE = path.join(
  os.homedir(),
  ".marblo",
  "telegram-poller-offsets.json",
);
const DEFAULT_LONG_POLL_SECONDS = 25;
const DEFAULT_IDLE_BACKOFF_MS = 3000;
const DEFAULT_ERROR_BACKOFF_MS = 5000;
const DEFAULT_NUDGE_IDLE_DEBOUNCE_MS = 6000;
const DEFAULT_NUDGE_MAX_GRACE_MS = 120000;
const DEFAULT_SEND_MAX_RETRIES = 2;
const DEFAULT_SEND_BACKOFF_MS = 500;
const DEFAULT_DIAG_409_THROTTLE_MS = 300_000;
const DEFAULT_HOLD_NOTIFY_AFTER_MS = 60_000;
/**
 * ★How far past the abort budget a completed round trip has to land before we
 * call it a suspension rather than a slow request (ticket VCGuLWmNTlhoRvwGAKJA).
 *
 * The budget is `(longPoll + 10)s` and it is enforced by an abort timer inside
 * the fetch. A round trip that exceeds it AT ALL means that timer did not fire
 * on schedule, so anything above 1 is already conservative; 2 leaves room for
 * timer coalescing and GC pauses while staying two orders of magnitude below
 * the 15-17 minute gaps actually measured.
 */
const DEFAULT_SUSPEND_GRACE_FACTOR = 2;
/** Min gap (ms) between honored resume nudges — see resumeNudgeThrottleMs. */
const DEFAULT_RESUME_NUDGE_THROTTLE_MS = 5_000;
/** Repeat the "still holding" WARN at most this often per episode. */
const HOLD_LOG_THROTTLE_MS = 60_000;
/** ★409 가 이만큼 연속되면 "리스 밖의 제3자"로 보고 사용자에게 노출한다. */
const DEFAULT_CONTENTION_409_THRESHOLD = 3;

/** Mutable half of {@link TelegramHoldSnapshot}. */
interface HoldState {
  reason: TelegramHoldReason;
  updateId: number;
  since: number;
  attempts: number;
  detail: InjectFailureDescriptor | null;
  /** Owner already told about THIS episode (max one notice per episode). */
  notified: boolean;
  /** Last time the "still holding" warning was logged. */
  lastLoggedAt: number;
}

/** Mutable half of the loop-liveness fields on {@link TelegramRouteHealth}. */
interface LoopStats {
  startedAt: number | null;
  completedAt: number | null;
  consecutiveErrors: number;
  lastErrorAt: number | null;
  lastErrorKind: TelegramPollErrorKind | null;
  lastErrorStatus: number | null;
  /** Wall-clock ms of the last completed round trip. See lastPollDurationMs. */
  lastDurationMs: number | null;
  /** Times a backoff was skipped because the round trip looked suspended. */
  suspendRecoveries: number;
  /** ★연속 409 횟수 — 다른 소비자가 우리를 계속 밀어내고 있는지의 직접 관측치. */
  consecutive409: number;
  /** 409 연속이 시작된 시각. 연속이 끊기면 null. */
  since409: number | null;
  /**
   * ★Which loop recorded the last round trip. Two loops sharing this
   * projectId slot show up here as a value that keeps flipping.
   */
  loopId: string | null;
}

/**
 * 리스 게이트의 가변 상태(프로젝트당 1개). {@link TelegramLeaseSnapshot} 의
 * 가변 짝이며, lastRenewAt 만 스냅샷에 나가지 않는다(내부 스케줄용).
 */
interface LeaseRuntimeState {
  phase: TelegramLeasePhase;
  holderId: string | null;
  hostLabel: string | null;
  renewedAt: number | null;
  failOpenReason: string | null;
  since: number;
  /** 마지막으로 갱신을 **시도**한 시각. 0 이면 아직 없음. */
  lastRenewAt: number;
}

interface LoopHandle {
  /**
   * ★This loop's identity (ticket 3asM22VKCCXgAlfnNXTJ). Token-free:
   * `p<pid>:<projectId>#<generation>`. Stamped onto every poll and every
   * delivery this loop records, so the journal can say WHICH loop wrote a
   * sample instead of leaving two loops indistinguishable behind one key.
   */
  id: string;
  /** Set true to ask the loop to exit at its next checkpoint. */
  stop: boolean;
  /** True once stopLoop has begun retiring this handle (stop is idempotent). */
  stopping: boolean;
  /**
   * ★Aborts the getUpdates that is in flight RIGHT NOW (ticket
   * 3asM22VKCCXgAlfnNXTJ). `stop` alone is cooperative — it is only read
   * between awaits — so a loop parked in a 25s long poll went on holding
   * Telegram's single consumer slot long after it had been retired. Aborting
   * hands that slot back immediately, which is what makes "at most one
   * consumer per bot" true of the NETWORK and not merely of the registry map.
   *
   * It only cancels a request. It never advances an offset and never
   * reinterprets a delivery: an abort during stop is not counted as a poll
   * error, and an update that was not injected is still redelivered.
   */
  abort: AbortController;
  /** Resolves when the loop has fully exited. */
  done: Promise<void>;
  /**
   * ★Set while the loop is parked in a backoff sleep; calling it ends that
   * sleep early (ticket VCGuLWmNTlhoRvwGAKJA). This is how a powerMonitor
   * resume/unlock turns into an immediate re-poll instead of waiting out a
   * backoff that was scheduled before the machine stopped running us.
   *
   * It ONLY shortens a wait. It never advances an offset, never re-orders a
   * delivery, and never runs while a getUpdates is in flight.
   */
  wake: (() => void) | null;
}

/**
 * An inbound message injected into the orchestrator that is still awaiting a
 * send_telegram_message reply. Drives the one-shot un-replied nudge (spec A).
 */
interface PendingReply {
  updateId: number;
  /** Whether the one-shot reminder has already been injected (max 1/updateId). */
  nudged: boolean;
  /** Debounce timer: fires the idle check after the orchestrator goes quiet. */
  idleTimer: ReturnType<typeof setTimeout> | null;
  /** Fallback timer: fires the idle check even if no activity is ever seen. */
  maxTimer: ReturnType<typeof setTimeout> | null;
}

/**
 * Per-project getUpdates poller. One instance for the whole app (main owns it);
 * `syncActiveChannels()` reconciles running loops against the active channel
 * set, and `sendMessage()` is the outbound path the bridge routes into.
 */
export class TelegramPoller {
  private readonly deps: TelegramPollerDeps;
  private readonly loops = new Map<string, LoopHandle>();
  /** Last inbound chatId per project — default reply target for outbound. */
  private readonly lastChatId = new Map<string, string>();
  /** In-memory mirror of the persisted offset map (projectId → next offset). */
  private offsets: Record<string, number> = {};
  /** Inbound awaiting a reply, per project (un-replied nudge, spec A). */
  private readonly pendingReplies = new Map<string, PendingReply>();
  /** Per-project reliability counters (spec C). */
  private readonly stats = new Map<string, ReliabilityStats>();
  /** Last successful inbound delivery route, token-free for logs/health. */
  private readonly lastDelivered = new Map<
    string,
    {
      at: number;
      updateId: number;
      target: InboundTargetDescriptor;
      /** The loop that made this delivery (see TelegramRouteHealth.loopId). */
      loopId: string;
    }
  >();
  /** Live offset-hold episode per project (see TelegramHoldSnapshot). */
  private readonly holds = new Map<string, HoldState>();
  /** Loop liveness per project (see TelegramRouteHealth's loop fields). */
  private readonly loopStats = new Map<string, LoopStats>();
  /** 기기 간 리스 게이트 상태(프로젝트당 1개). 리스 미사용이면 비어 있다. */
  private readonly leaseStates = new Map<string, LeaseRuntimeState>();
  /**
   * ★Loops actually ALIVE per project, by loop id (ticket 3asM22VKCCXgAlfnNXTJ).
   *
   * Deliberately not the same thing as `loops`. `loops` is the reservation —
   * at most one entry per project. This is the truth: a loop is in here from
   * the moment it can issue a getUpdates until the moment its body has
   * returned. The two used to diverge, and that gap was the duplicate-consumer
   * window; keeping the set makes the divergence a number the journal reports
   * rather than something only a packet capture could see.
   */
  private readonly liveLoops = new Map<string, Set<string>>();
  /** Monotonic loop generation per project — the `#n` in a loop id. */
  private readonly loopStarts = new Map<string, number>();
  private readonly log: Pick<Console, "log" | "warn" | "error">;
  /** Last full-409-diagnosis time per project (throttles the loud log). */
  private readonly lastDiag409At = new Map<string, number>();
  /** Token-conflict groups already warned about (log once per set change). */
  private readonly warnedTokenConflicts = new Set<string>();
  /** Last honored notePowerResume (throttle anchor). 0 ⇒ none yet. */
  private lastResumeNudgeAt = 0;

  constructor(deps: TelegramPollerDeps) {
    this.deps = deps;
    this.log = deps.logger ?? console;
  }

  // ── lifecycle ────────────────────────────────────────────────────────

  /** Load persisted offsets and start loops for all active channels. */
  start(): void {
    // A past build materialized the bot token into the claude plugin state dir
    // (~/.claude/channels/telegram/.env), which let ANY claude plugin host on
    // this machine (Cursor MCP, non-strict interactive sessions) boot its own
    // getUpdates poller with our token and 409-evict this one. Clean it up
    // before we start polling.
    try {
      const neutralize =
        this.deps.neutralizePluginConfig ?? neutralizeTelegramPluginConfig;
      const cleanup = neutralize();
      if (cleanup.tokenRemoved) {
        const where = cleanup.cleanedDirs?.length
          ? ` (${cleanup.cleanedDirs.join(", ")})`
          : "";
        this.log.warn(
          `[TelegramPoller] removed a stale bot token materialized in a claude ` +
            `telegram plugin state dir${where} — external plugin pollers ` +
            `(Cursor/claude sessions) can no longer boot with our token and steal ` +
            `getUpdates. An already-running external poller keeps its token until ` +
            `it restarts.`,
        );
      }
    } catch {
      /* cleanup is best-effort; polling must start regardless */
    }
    this.loadOffsets();
    this.syncActiveChannels();
  }

  /**
   * Reconcile running loops against the current active-channel set: start a
   * loop for every newly-active project, stop loops whose channel went
   * inactive. Idempotent — safe to call on channel config changes, on
   * powerMonitor resume, and after each health sweep.
   *
   * ★Loops are deduped BY TOKEN, not just by project: Telegram getUpdates is
   * single-consumer per bot, so two projects (mis)configured with the same bot
   * token would 409-evict each other forever. The settings path blocks that at
   * save time (telegram-channels findTokenConflicts); this is the runtime
   * defense for legacy/hand-edited data — one deterministic winner polls, the
   * rest are held off with a loud diagnostic.
   */
  syncActiveChannels(): void {
    const byToken = new Map<string, string[]>();
    for (const projectId of this.listActiveProjectIds()) {
      const token = this.getToken(projectId);
      if (!token) continue; // no token → loop would exit immediately anyway
      const group = byToken.get(token);
      if (group) group.push(projectId);
      else byToken.set(token, [projectId]);
    }

    const active = new Set<string>();
    for (const [token, group] of byToken) {
      if (group.length === 1) {
        active.add(group[0]);
        continue;
      }
      // Same bot token on 2+ projects: exactly one may poll. Prefer a project
      // whose loop is already running (no churn), else the lexicographic first
      // (deterministic across restarts).
      const sorted = [...group].sort();
      const winner = sorted.find((p) => this.loops.has(p)) ?? sorted[0];
      active.add(winner);
      const signature = `${tokenHash(token)}:${sorted.join(",")}`;
      if (!this.warnedTokenConflicts.has(signature)) {
        this.warnedTokenConflicts.add(signature);
        this.log.warn(
          `[TelegramPoller] projects [${sorted.join(", ")}] share ONE bot token ` +
            `(hash=${tokenHash(token)}). Telegram getUpdates is single-consumer per ` +
            `bot, so only project=${winner} polls; the others get no inbound until ` +
            `each project is given its own bot in the Telegram channel settings.`,
        );
      }
    }

    for (const projectId of active) {
      if (!this.loops.has(projectId)) this.startLoop(projectId);
    }
    for (const projectId of [...this.loops.keys()]) {
      if (!active.has(projectId)) void this.stopLoop(projectId);
    }
  }

  /** Stop every loop (app quit / channel teardown). */
  async stopAll(): Promise<void> {
    await Promise.all([...this.loops.keys()].map((p) => this.stopLoop(p)));
  }

  private startLoop(projectId: string): void {
    // ★Duplicate-start guard: exactly one getUpdates loop per project (a second
    // long poll evicts the first with 409 — the bug this whole module exists to
    // prevent). The registration now covers the loop's WHOLE life, including
    // the retiring window, because stopLoop no longer un-registers up front.
    if (this.loops.has(projectId)) return;
    // Belt-and-suspenders against any future path that reaches here with a
    // body still running: the registry can only be trusted if it agrees with
    // what is actually alive. Refuse, loudly, rather than open a second
    // consumer — a missed inbound is recoverable, a 409 war is not.
    const live = this.liveLoops.get(projectId);
    if (live && live.size > 0) {
      this.log.warn(
        `[TelegramPoller] project=${projectId} REFUSED to start a second poll ` +
          `loop — ${live.size} loop(s) still alive (${[...live].join(", ")}). ` +
          `Telegram allows ONE getUpdates consumer per bot; a second one would ` +
          `409-evict the first. Waiting for the running loop to exit.`,
      );
      return;
    }
    const generation = (this.loopStarts.get(projectId) ?? 0) + 1;
    this.loopStarts.set(projectId, generation);
    const handle: LoopHandle = {
      id: `p${process.pid}:${projectId}#${generation}`,
      stop: false,
      stopping: false,
      abort: new AbortController(),
      done: Promise.resolve(),
      wake: null,
    };
    this.loops.set(projectId, handle);
    this.markLoopAlive(projectId, handle.id);
    this.deps.onLoopActivityChange?.();
    handle.done = this.runLoop(projectId, handle).finally(() => {
      this.markLoopDead(projectId, handle.id);
      // Only delete if this exact handle is still the registered one (a
      // stop→restart could have replaced it).
      if (this.loops.get(projectId) === handle) {
        this.loops.delete(projectId);
        this.deps.onLoopActivityChange?.();
      }
    });
    this.log.log(
      `[TelegramPoller] started poll loop ${handle.id} for project ${projectId}`,
    );
  }

  private markLoopAlive(projectId: string, loopId: string): void {
    const live = this.liveLoops.get(projectId);
    if (live) live.add(loopId);
    else this.liveLoops.set(projectId, new Set([loopId]));
  }

  private markLoopDead(projectId: string, loopId: string): void {
    const live = this.liveLoops.get(projectId);
    if (!live) return;
    live.delete(loopId);
    if (live.size === 0) this.liveLoops.delete(projectId);
  }

  /**
   * Retire the project's loop and WAIT for it to stop consuming the bot.
   *
   * ★The registry entry is deliberately kept until the loop body has actually
   * returned (ticket 3asM22VKCCXgAlfnNXTJ). It used to be deleted first, on
   * the theory that the handle was bookkeeping — but a loop parked inside a
   * 25s getUpdates goes on holding Telegram's single consumer slot for as long
   * as that request lives. Deleting the entry early therefore did not retire a
   * consumer; it only hid one, and the duplicate-start guard
   * (`loops.has(projectId)`) then read false and let `syncActiveChannels`
   * (health sweep / power resume / channel IPC) start a SECOND loop straight
   * into the first one's long poll. Two getUpdates on one bot is exactly an
   * HTTP 409, and each new sweep could renew the overlap.
   *
   * So: mark it stopping, abort the in-flight request so the slot comes back
   * in milliseconds instead of up to 25 seconds, and let the loop's own
   * `finally` remove the entry once it is genuinely gone. Nothing here touches
   * the offset — an update that was fetched but not injected is simply
   * refetched by the next loop, which is the at-least-once contract unchanged.
   */
  private async stopLoop(projectId: string): Promise<void> {
    const handle = this.loops.get(projectId);
    if (!handle) return;
    if (handle.stopping) {
      // Already retiring — a repeat sweep must not log or re-tear-down twice.
      try {
        await handle.done;
      } catch {
        /* loop already logged its own errors */
      }
      return;
    }
    handle.stopping = true;
    handle.stop = true;
    // End the outstanding getUpdates NOW so the bot's consumer slot is free
    // before anything can be started in its place.
    handle.abort.abort();
    // A loop parked in a backoff sleep should not sit out the rest of it.
    handle.wake?.();
    // Drop any pending-reply nudge timers for this project so they don't fire
    // (or keep the process alive) after the loop is gone.
    this.clearPendingReply(projectId);
    // The hold belongs to a running loop; a stopped loop is not "holding".
    this.holds.delete(projectId);
    try {
      await handle.done;
    } catch {
      /* loop already logged its own errors */
    }
    // ★리스를 놓는다 — 이 기기가 더는 이 봇을 폴링하지 않으므로 다른 기기가
    // TTL 을 기다리지 않고 즉시 이어받을 수 있다. 실패는 무시한다(만료가
    // 회수하므로 사람이 손댈 상태가 되지 않는다).
    this.releaseLease(projectId);
    this.deps.onLoopActivityChange?.();
    this.log.log(
      `[TelegramPoller] stopped poll loop ${handle.id} for project ${projectId}`,
    );
  }

  // ── the long-poll loop ───────────────────────────────────────────────

  private async runLoop(projectId: string, ctrl: LoopHandle): Promise<void> {
    const longPoll = this.deps.longPollSeconds ?? DEFAULT_LONG_POLL_SECONDS;
    const idleBackoff = this.deps.idleBackoffMs ?? DEFAULT_IDLE_BACKOFF_MS;
    const errorBackoff = this.deps.errorBackoffMs ?? DEFAULT_ERROR_BACKOFF_MS;
    // Abort must outlive the server-side long poll, or it fires mid-poll.
    const pollBudgetMs = (longPoll + 10) * 1000;
    const apiOpts: TelegramApiOptions = {
      fetchImpl: this.deps.fetchImpl,
      timeoutMs: pollBudgetMs,
      // ★Retiring this loop ends its in-flight getUpdates at once, so the bot's
      // single consumer slot is handed back before any replacement loop starts.
      signal: ctrl.abort.signal,
    };
    // ★Suspension recovery threshold (ticket VCGuLWmNTlhoRvwGAKJA). A round
    // trip cannot legitimately outlast its own abort timer, so anything past
    // this means the process was not being scheduled — and the backoff that
    // would normally follow is exactly the window macOS puts us back to sleep
    // in. Above this we re-poll at once instead.
    const suspendThresholdMs =
      pollBudgetMs *
      (this.deps.suspendGraceFactor ?? DEFAULT_SUSPEND_GRACE_FACTOR);

    // ★★기기 간 리스 게이트 (티켓 hAzP05kOTxggd8LhZGwT).
    //
    // 여기가 게이트의 자리인 이유: startLoop 은 동기라 비동기 리스 획득을 넣을
    // 수 없고, 넣더라도 등록을 미루면 #1415 의 중복 시작 가드(loops.has +
    // liveLoops)가 무력해진다. 그래서 루프는 평소대로 등록되고, **네트워크로
    // 나가기 전에** 여기서 막는다 — 웹훅 self-heal(deleteWebhook)조차 남의
    // 폴러에 영향을 주므로 그것보다도 앞이다. 리스를 못 잡으면 getUpdates 를
    // 한 번도 열지 않고 재시도만 돈다.
    if (!(await this.awaitLease(projectId, ctrl))) return;

    // Self-heal a stray webhook before polling: a registered webhook makes
    // getUpdates 409 permanently. drop_pending_updates=false keeps the backlog.
    const startToken = this.getToken(projectId);
    if (startToken) {
      try {
        const h = await probeAndHealTelegramWebhook(startToken, {
          fetchImpl: this.deps.fetchImpl,
          signal: ctrl.abort.signal,
        });
        if (h.webhookCleared) {
          this.log.warn(
            `[TelegramPoller] project=${projectId} cleared a stray webhook that was 409-wedging getUpdates.`,
          );
        }
      } catch {
        /* probe never throws; belt-and-suspenders */
      }
    }

    while (!ctrl.stop) {
      const token = this.getToken(projectId);
      if (!token) break; // channel deactivated → exit loop

      // ★리스 갱신. granted:false 는 **뺏겼다**는 뜻 — 다른 기기가 같은 봇의
      // 리스를 가져갔다. 그러면 즉시 폴링을 멈추고 게이트로 돌아간다(상대가
      // 만료될 때까지 기다렸다가 자연스럽게 인수한다). 갱신 실패(예외/오프라인)
      // 는 여기서 폴링을 멈추지 않는다 — fail-open.
      if (!(await this.maybeRenewLease(projectId, token))) {
        if (!(await this.awaitLease(projectId, ctrl))) return;
        continue;
      }

      const offset = this.offsets[projectId];
      const params: Record<string, unknown> = {
        timeout: longPoll,
        allowed_updates: ["message"],
      };
      if (typeof offset === "number") params.offset = offset;

      let updates: TgUpdate[];
      this.notePollStarted(projectId, ctrl.id);
      try {
        const resp = await telegramApi<TgUpdate[]>(
          token,
          "getUpdates",
          params,
          apiOpts,
        );
        this.notePollCompleted(
          projectId,
          ctrl.id,
          resp.ok,
          resp.ok ? undefined : { kind: "api-not-ok", status: null },
        );
        if (!resp.ok) {
          this.log.warn(
            `[TelegramPoller] project=${projectId} getUpdates not ok: ${scrubToken(
              resp.description ?? "unknown",
              token,
            )}`,
          );
          await this.backoffUnlessSuspended(
            projectId,
            errorBackoff,
            ctrl,
            suspendThresholdMs,
          );
          continue;
        }
        updates = Array.isArray(resp.result) ? resp.result : [];
      } catch (err) {
        // ★A request we cancelled ourselves while retiring the loop is not a
        // failure of the route — recording it would inflate the very error
        // streak the verdict now trusts, and would smear one loop's shutdown
        // across the next loop's counters. Leave the books untouched and go.
        if (ctrl.stop) break;
        this.notePollCompleted(
          projectId,
          ctrl.id,
          false,
          classifyPollError(err),
        );
        const raw = err instanceof Error ? err.message : String(err);
        this.log.warn(
          `[TelegramPoller] project=${projectId} getUpdates error: ${scrubToken(
            raw,
            token,
          )}`,
        );
        // 409 means ANOTHER consumer holds this bot's getUpdates. Don't just
        // flap silently — say who is plausibly holding it (throttled).
        if (err instanceof TelegramHttpError && err.status === 409) {
          this.maybeDiagnose409(projectId, token);
        }
        await this.backoffUnlessSuspended(
          projectId,
          errorBackoff,
          ctrl,
          suspendThresholdMs,
        );
        continue;
      }

      if (updates.length === 0) continue; // long poll timed out empty

      for (const update of updates) {
        if (ctrl.stop) break;
        const delivered = await this.handleUpdate(projectId, update, ctrl);
        if (!delivered) {
          // No live orchestrator (or inject failed): DO NOT advance past this
          // update. Sleep, then the outer loop re-fetches the same batch —
          // at-least-once delivery once an orchestrator comes online.
          // ★handleUpdate has already named the hold (noteHold) — that naming
          // is what makes "loop stopped" and "loop turning, injection refused"
          // tellable apart after the fact. The hold ITSELF is unchanged.
          await this.sleep(idleBackoff, ctrl);
          break;
        }
        // The update is consumed (delivered, or dropped as non-actionable /
        // unauthorized) — any hold pinned to it is over.
        this.clearHold(projectId, update.update_id);
        this.setOffset(projectId, update.update_id + 1);
      }
    }
  }

  // ── 기기 간 리스 (티켓 hAzP05kOTxggd8LhZGwT) ──────────────────────────
  //
  // ★이 절 전체의 최상위 규칙: **리스는 폴링을 영영 막을 수 없다.**
  // 아래 모든 경로에서 오류는 granted 로 흡수되고(fail-open), 폴링을 실제로
  // 미루는 경로는 "다른 기기가 같은 봇의 유효한 리스를 들고 있다" 하나뿐이며
  // 그것마저 TTL(기본 90초) 이 지나면 자동으로 인수된다. 사람이 손으로 푸는
  // 상태는 존재하지 않는다.

  private leaseStateFor(projectId: string): LeaseRuntimeState {
    let st = this.leaseStates.get(projectId);
    if (!st) {
      st = {
        phase: "unknown",
        holderId: null,
        hostLabel: null,
        renewedAt: null,
        failOpenReason: null,
        since: Date.now(),
        lastRenewAt: 0,
      };
      this.leaseStates.set(projectId, st);
    }
    return st;
  }

  private setLeasePhase(
    projectId: string,
    phase: TelegramLeasePhase,
    patch: Partial<Omit<LeaseRuntimeState, "phase" | "since" | "lastRenewAt">>,
  ): LeaseRuntimeState {
    const st = this.leaseStateFor(projectId);
    if (st.phase !== phase) {
      st.phase = phase;
      st.since = Date.now();
    }
    st.holderId = patch.holderId ?? null;
    st.hostLabel = patch.hostLabel ?? null;
    st.renewedAt = patch.renewedAt ?? null;
    st.failOpenReason = patch.failOpenReason ?? null;
    return st;
  }

  /**
   * 폴링 전 리스를 잡을 때까지 기다린다. true = 폴링해도 좋다(획득했거나
   * fail-open), false = 루프를 끝내라(정지 요청 또는 채널 비활성).
   */
  private async awaitLease(
    projectId: string,
    ctrl: LoopHandle,
  ): Promise<boolean> {
    const gate = this.deps.leaseGate;
    // 리스를 쓰지 않는 구성 — 기존 동작 그대로. 게이트가 없다고 폴링이
    // 달라져서는 안 된다(리스는 순수 추가 방어선이다).
    if (!gate) return true;

    const retryMs = this.deps.leaseRetryMs ?? TELEGRAM_LEASE_RETRY_MS;
    while (!ctrl.stop) {
      const token = this.getToken(projectId);
      if (!token) return false; // 채널 비활성 → 루프 종료

      let decision: TelegramLeaseDecision;
      try {
        decision = await gate.acquire(projectId, token);
      } catch (err) {
        // ★★fail-open. 리스 매니저는 이미 모든 오류를 흡수하도록 쓰여 있지만,
        // 그 계약이 깨지더라도(주입된 게이트가 던지더라도) 텔레그램이 죽어서는
        // 안 된다. 여기서 잡고 그대로 폴링한다.
        this.noteLeaseFailOpen(projectId, err);
        return true;
      }

      if (decision.granted) {
        this.noteLeaseGranted(projectId, decision, token);
        return true;
      }
      this.noteLeaseBlocked(projectId, decision);
      await this.sleep(retryMs, ctrl);
    }
    return false;
  }

  /**
   * 갱신 주기가 됐으면 리스를 갱신한다. false = **뺏겼다**(다른 기기가 같은
   * 봇의 리스를 가져갔다) → 호출자는 폴링을 멈추고 게이트로 돌아간다.
   * 오류는 true(계속 폴링) — fail-open.
   */
  private async maybeRenewLease(
    projectId: string,
    token: string,
  ): Promise<boolean> {
    const gate = this.deps.leaseGate;
    if (!gate) return true;

    const st = this.leaseStateFor(projectId);
    const renewMs = this.deps.leaseRenewMs ?? TELEGRAM_LEASE_RENEW_MS;
    if (st.lastRenewAt !== 0 && Date.now() - st.lastRenewAt < renewMs) {
      return true;
    }
    st.lastRenewAt = Date.now();

    let decision: TelegramLeaseDecision;
    try {
      decision = await gate.renew(projectId, token);
    } catch (err) {
      this.noteLeaseFailOpen(projectId, err); // ★fail-open
      return true;
    }
    if (!decision.granted) {
      this.noteLeaseBlocked(projectId, decision);
      this.log.warn(
        `[TelegramPoller] project=${projectId} lease taken over by another ` +
          `device (${decision.observed?.hostLabel ?? "unknown host"}) — ` +
          `stopping getUpdates here so the two machines stop 409-evicting each ` +
          `other. This machine resumes automatically if that lease expires.`,
      );
      return false;
    }
    this.noteLeaseGranted(projectId, decision, token);
    return true;
  }

  private noteLeaseGranted(
    projectId: string,
    decision: TelegramLeaseDecision,
    token: string,
  ): void {
    const st = this.leaseStateFor(projectId);
    st.lastRenewAt = Date.now();
    if (decision.outcome === "fail-open") {
      const prev = st.phase;
      this.setLeasePhase(projectId, "fail-open", {
        failOpenReason: decision.failOpenReason,
      });
      if (prev !== "fail-open") {
        this.log.warn(
          `[TelegramPoller] project=${projectId} cross-device poller lease is ` +
            `UNAVAILABLE (${decision.failOpenReason ?? "unknown"}) — polling ` +
            `anyway (fail-open). Another machine polling the same bot would ` +
            `not be detected while this lasts.`,
        );
      }
      return;
    }
    const prev = st.phase;
    this.setLeasePhase(projectId, "owner", {
      holderId: null,
      hostLabel: null,
      renewedAt: Date.now(),
    });
    if (prev !== "owner") {
      this.log.log(
        `[TelegramPoller] project=${projectId} holds the cross-device poller ` +
          `lease (${decision.outcome}, bot hash=${telegramLeaseTokenHash(token)}).`,
      );
    }
  }

  private noteLeaseBlocked(
    projectId: string,
    decision: TelegramLeaseDecision,
  ): void {
    const held: TelegramPollerLease | null = decision.observed;
    const prev = this.leaseStateFor(projectId).phase;
    this.setLeasePhase(projectId, "blocked", {
      holderId: held?.holderId ?? null,
      hostLabel: held?.hostLabel ?? null,
      renewedAt: held?.renewedAt ?? null,
    });
    if (prev !== "blocked") {
      this.log.warn(
        `[TelegramPoller] project=${projectId} is NOT polling: another device ` +
          `(${held?.hostLabel ?? "unknown host"}) holds this bot's poller lease ` +
          `(renewed ${held ? new Date(held.renewedAt).toISOString() : "unknown"}). ` +
          `This is deliberate — two devices polling one bot 409-evict each other. ` +
          `Takeover is automatic once that lease expires.`,
      );
    }
  }

  private noteLeaseFailOpen(projectId: string, err: unknown): void {
    const detail = err instanceof Error ? err.message : String(err);
    const prev = this.leaseStateFor(projectId).phase;
    this.setLeasePhase(projectId, "fail-open", {
      failOpenReason: `gate: ${detail.slice(0, 160)}`,
    });
    if (prev !== "fail-open") {
      this.log.warn(
        `[TelegramPoller] project=${projectId} poller lease gate threw — polling ` +
          `anyway (fail-open): ${detail.slice(0, 160)}`,
      );
    }
  }

  /** 우리 리스를 놓는다(루프 은퇴). 실패해도 TTL 이 회수하므로 무시한다. */
  private releaseLease(projectId: string): void {
    const gate = this.deps.leaseGate;
    this.leaseStates.delete(projectId);
    if (!gate) return;
    void gate.release(projectId).catch(() => undefined);
  }

  /** 리스 게이트의 스냅샷(health/저널/IPC 공용). 토큰은 어디에도 없다. */
  getLeaseSnapshot(projectId: string): TelegramLeaseSnapshot {
    const st = this.leaseStates.get(projectId);
    if (!st) {
      return {
        phase: "unknown",
        holderId: null,
        hostLabel: null,
        renewedAt: null,
        failOpenReason: null,
        since: 0,
      };
    }
    return {
      phase: st.phase,
      holderId: st.holderId,
      hostLabel: st.hostLabel,
      renewedAt: st.renewedAt,
      failOpenReason: st.failOpenReason,
      since: st.since,
    };
  }

  /**
   * ★사용자에게 그대로 보여줄 경합 판정 (티켓 hAzP05kOTxggd8LhZGwT).
   *
   * 두 상황을 반드시 구분한다. 대응이 정반대이기 때문이다:
   *   - other-device: 다른 **마블로 기기**가 리스를 들고 있다. 할 일은 없다 —
   *     그 기기가 받고 있고, 꺼지면 90초 안에 이 기기가 이어받는다.
   *   - foreign-consumer: 우리가 리스 보유자(또는 리스 fail-open)인데도 409 가
   *     연속된다. 리스 밖의 제3자다 — 다른 claude/Cursor 플러그인 폴러, 예전
   *     빌드, 또는 사람이 돌린 스크립트. 사용자가 직접 찾아 꺼야 한다.
   */
  getContention(projectId: string): TelegramContention {
    const lease = this.getLeaseSnapshot(projectId);
    const loop = this.loopStats.get(projectId);
    const consecutive409 = loop?.consecutive409 ?? 0;
    const since409 = loop?.since409 ?? null;
    const threshold =
      this.deps.contention409Threshold ?? DEFAULT_CONTENTION_409_THRESHOLD;

    let kind: TelegramContentionKind = "none";
    if (lease.phase === "blocked") {
      kind = "other-device";
    } else if (consecutive409 >= threshold) {
      // 리스를 우리가 들고 있는데도(또는 리스를 못 읽는데도) 밀려나고 있다.
      kind = "foreign-consumer";
    }

    return {
      projectId,
      kind,
      hostLabel: kind === "other-device" ? lease.hostLabel : null,
      renewedAt: kind === "other-device" ? lease.renewedAt : null,
      consecutive409,
      since409,
      leaseFailOpen: lease.phase === "fail-open",
      leasePhase: lease.phase,
    };
  }

  // ── 409 diagnosis ────────────────────────────────────────────────────

  /**
   * A getUpdates 409 means some OTHER consumer is long-polling this bot. Log
   * one actionable, token-free diagnosis naming the plausible holders instead
   * of an endless bare "HTTP 409" flap. Throttled per project because the 409
   * recurs every errorBackoff while the conflict persists. Holders checked:
   *   1. another Marblo project configured with the same bot token (runtime
   *      dedup in syncActiveChannels should prevent this; named if seen);
   *   2. an external claude/Cursor telegram plugin poller booted from the
   *      plugin state dir's .env (token match + bot.pid liveness);
   *   3. a registered webhook (self-healed by the start probe; mentioned so
   *      the reader knows it's already covered).
   */
  private maybeDiagnose409(projectId: string, token: string): void {
    const throttle =
      this.deps.diag409ThrottleMs ?? DEFAULT_DIAG_409_THROTTLE_MS;
    const last = this.lastDiag409At.get(projectId) ?? 0;
    const nowMs = Date.now();
    if (nowMs - last < throttle) return;
    this.lastDiag409At.set(projectId, nowMs);

    const parts: string[] = [];

    // (0) ★기기 간 리스가 무엇을 보고 있는가 (티켓 hAzP05kOTxggd8LhZGwT).
    // 리스를 우리가 들고 있는데도 409 가 난다면 상대는 마블로가 아니다 —
    // 그 구분이 사용자가 할 행동을 완전히 바꾼다.
    const lease = this.getLeaseSnapshot(projectId);
    parts.push(
      lease.phase === "blocked"
        ? `another Marblo device (${lease.hostLabel ?? "unknown host"}) holds this ` +
          `bot's cross-device poller lease — this machine should not be polling at all`
        : lease.phase === "owner"
          ? `this machine HOLDS the cross-device poller lease, so the other consumer ` +
            `is NOT another Marblo device — look for a non-Marblo poller on this bot`
          : lease.phase === "fail-open"
            ? `the cross-device poller lease is unavailable (${lease.failOpenReason ?? "unknown"}), ` +
              `so another Marblo device on the same bot cannot be ruled out`
            : `the cross-device poller lease has not been evaluated for this loop`,
    );

    // (1) another Marblo project sharing this token.
    let sameTokenProjects: string[] = [];
    try {
      sameTokenProjects = this.listActiveProjectIds().filter(
        (p) => p !== projectId && this.getToken(p) === token,
      );
    } catch {
      /* diagnosis is best-effort */
    }
    parts.push(
      sameTokenProjects.length > 0
        ? `another Marblo project shares this bot token: [${sameTokenProjects
            .sort()
            .join(
              ", ",
            )}] — give each project its own bot in the Telegram channel settings`
        : `no other Marblo project uses this token`,
    );

    // (2) external plugin poller booted from ANY plugin state dir we know of.
    // ★한 자리만 보던 시절에는 TELEGRAM_STATE_DIR 오버라이드나 격리 HOME 밑에
    // 부팅한 폴러가 진단에 아예 나타나지 않았다(티켓 hAzP05kOTxggd8LhZGwT).
    const pluginDirs = this.pluginStateDirs();
    const matches: string[] = [];
    const liveOthers: string[] = [];
    for (const dir of pluginDirs) {
      const holder = probePluginHolder(dir, token);
      const pid =
        holder.pid !== null
          ? `pid=${holder.pid} (${holder.pidAlive ? "ALIVE" : "dead"})`
          : "pid unknown";
      if (holder.tokenMatch) matches.push(`${dir} [${pid}]`);
      else if (holder.pid !== null && holder.pidAlive) {
        liveOthers.push(`${dir} [pid=${holder.pid}]`);
      }
    }
    if (matches.length > 0) {
      parts.push(
        `a claude telegram plugin state dir holds THIS bot's token: ${matches.join(
          "; ",
        )} — an external plugin poller (Cursor MCP / a non-strict claude session) ` +
          `is likely polling with our token; remove the telegram plugin/MCP entry from ` +
          `that host or stop that process. Marblo no longer writes this token and cleans ` +
          `it on startup, but a poller that already booted keeps it until restarted`,
      );
    } else {
      parts.push(
        `none of the ${pluginDirs.length} known plugin state dir(s) holds this token` +
          (liveOthers.length > 0
            ? ` (but a plugin poller is alive with a different/older token: ${liveOthers.join(
                "; ",
              )})`
            : ``),
      );
    }

    this.log.warn(
      `[TelegramPoller] project=${projectId} getUpdates 409 diagnosis — Telegram ` +
        `allows exactly ONE getUpdates consumer per bot (token hash=${tokenHash(token)}), ` +
        `and someone else holds it. ${parts.join(". ")}. ` +
        `(A registered webhook also 409s getUpdates; the start-time probe auto-heals that case.)`,
    );
  }

  private pluginStateDir(): string {
    if (this.deps.pluginStateDir) return this.deps.pluginStateDir;
    try {
      return getTelegramPluginStateDir();
    } catch {
      return path.join(os.homedir(), ".claude", "channels", "telegram");
    }
  }

  /** ★409 진단이 훑을 모든 플러그인 상태 디렉토리. 중복 제거된 절대경로. */
  private pluginStateDirs(): string[] {
    if (this.deps.pluginStateDirs?.length) return this.deps.pluginStateDirs;
    if (this.deps.pluginStateDir) return [this.deps.pluginStateDir];
    try {
      const dirs = getTelegramPluginStateDirs();
      if (dirs.length > 0) return dirs;
    } catch {
      /* 저장소를 못 읽으면 아래 폴백. */
    }
    return [this.pluginStateDir()];
  }

  /**
   * Route a single update to the live orchestrator. Returns true when the
   * update is CONSUMED (advance the offset) — including drops (no text /
   * unauthorized chat / non-message), which are intentionally skipped, not
   * redelivered. Returns false ONLY when there is no live orchestrator to
   * receive an actionable message (hold the offset for redelivery).
   */
  private async handleUpdate(
    projectId: string,
    update: TgUpdate,
    ctrl: LoopHandle,
  ): Promise<boolean> {
    const msg = update.message;
    const chatId = msg?.chat?.id != null ? String(msg.chat.id) : null;
    const text = typeof msg?.text === "string" ? msg.text : null;
    // Nothing actionable (service message, non-text, or malformed) → consume.
    if (!chatId || !text) return true;

    // Authorization: a non-empty allowlist gates which chats may drive the
    // orchestrator. Unauthorized inbound is dropped (consumed), never injected.
    const allowed = this.getAllowedChatIds(projectId);
    if (allowed.length > 0 && !allowed.includes(chatId)) {
      this.log.warn(
        `[TelegramPoller] project=${projectId} dropping inbound from unauthorized chat ${chatId}.`,
      );
      return true;
    }

    const orch = this.deps.resolveOrchestrator(projectId);
    if (!orch) {
      // ★This branch used to return false with NO log at all — the single
      // most invisible way for the boss's remote channel to go quiet.
      this.noteHold(projectId, update.update_id, "no-orchestrator", null);
      return false; // hold offset — redeliver after next boot
    }

    const from = this.formatFrom(msg?.from);
    const injected =
      `[Telegram inbound from ${from}]: ${text}\n\n` +
      `이 프로젝트의 텔레그램 채널로 사용자가 보낸 메시지입니다. 텔레그램으로 답장하려면 ` +
      `marblo MCP 의 send_telegram_message 도구를 호출하세요(projectId="${projectId}"). ` +
      `도구를 호출하지 않고 일반 텍스트로만 답하면 사용자에게 전달되지 않습니다.`;

    try {
      const wrote = await orch.injectMessage(injected);
      if (!wrote) {
        this.noteHold(
          projectId,
          update.update_id,
          "inject-refused",
          describeInjectFailure(orch),
        );
        return false;
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.noteHold(projectId, update.update_id, "inject-threw", {
        refusal: "threw",
        composer: null,
        detail: raw,
      });
      return false; // hold offset — retry delivery
    }
    // ★Owner-inbound journal (ticket wx9c4NeVtZ1SGcbEISpg). The MCP server has
    // NO other way to see what the owner said — the four work-chain capture
    // surfaces are all orchestrator-authored text, which is exactly why owner
    // missions never landed in the chain. Recorded ONLY after a confirmed
    // delivery, and never in a way that can affect delivery: the write is
    // awaited but its failure is logged and dropped, and the offset advance
    // below does not depend on it.
    try {
      await recordOwnerInbound({
        key: `telegram:${projectId}:${update.update_id}`,
        projectId,
        channel: "telegram",
        from,
        text,
        at: Date.now(),
      });
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err);
      this.log.warn(
        // fs 오류라 토큰이 낄 자리가 없다(같은 함수의 injectMessage catch 와 동일).
        `[TelegramPoller] project=${projectId} owner-inbound journal write failed: ${raw}`,
      );
    }
    // Only remember the chat once we actually delivered — this becomes the
    // default outbound reply target.
    this.lastChatId.set(projectId, chatId);
    const target = describeTarget(orch);
    this.lastDelivered.set(projectId, {
      at: Date.now(),
      updateId: update.update_id,
      target,
      // ★Stamp the loop that actually delivered (ticket 3asM22VKCCXgAlfnNXTJ).
      // The delivery record and the poll counters are read back from the same
      // per-project slots, so without this a sample cannot say whether the
      // loop that delivered is the loop whose errors it is reporting. With it,
      // `lastDeliveredLoopId === lastPollLoopId` is a fact on the line.
      loopId: ctrl.id,
    });
    this.log.log(
      `[TelegramPoller] project=${projectId} delivered inbound update ${update.update_id} to ${target.kind} pty=${target.ptySessionId ?? "unknown"} status=${target.status}; lastChatIdKnown=true.`,
    );
    // Track this inbound as awaiting a send_telegram_message reply so we can
    // nudge the orchestrator once if it finishes its turn without answering.
    this.armReplyTracking(projectId, update.update_id);
    return true;
  }

  // ── un-replied nudge (spec A) ─────────────────────────────────────────
  //
  // After an inbound is delivered we wait for the orchestrator to finish its
  // turn (busy→idle transition, fed by markOrchestratorActivity). If it went
  // idle without calling send_telegram_message (which clears the pending entry),
  // we inject ONE reminder. If the next idle still shows no reply, we count it
  // as unanswered (spec C) and stop — max one nudge per updateId, no loop.

  /** Begin tracking an injected inbound as awaiting a reply. */
  private armReplyTracking(projectId: string, updateId: number): void {
    // A newer inbound supersedes an older un-answered one — the latest message
    // is what needs a reply. Clear any prior pending (and its timers) first.
    this.clearPendingReply(projectId);
    const pending: PendingReply = {
      updateId,
      nudged: false,
      idleTimer: null,
      maxTimer: this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      ),
    };
    this.pendingReplies.set(projectId, pending);
  }

  /**
   * Feed an orchestrator "busy" signal for a project (main calls this from the
   * orchestrator PTY output filtered by isBusySignal). While an inbound is
   * awaiting a reply, each busy signal (re)arms a quiet-window debounce; when
   * the window elapses with no further activity, the turn is treated as ended.
   */
  markOrchestratorActivity(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return; // nothing awaiting a reply → cheap no-op
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    pending.idleTimer = this.armTimer(this.nudgeIdleDebounceMs(), () =>
      this.onOrchestratorIdle(projectId),
    );
  }

  /** The orchestrator's turn ended — nudge once, or count as unanswered. */
  private onOrchestratorIdle(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return; // already resolved (a reply cleared it) or stopped
    // Stop both timers; we either nudge (re-arm below) or finish here.
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    pending.idleTimer = null;
    pending.maxTimer = null;

    if (!pending.nudged) {
      const orch = this.deps.resolveOrchestrator(projectId);
      if (!orch) {
        // No live orchestrator to remind — count as unanswered and stop.
        this.bumpUnanswered(projectId);
        this.pendingReplies.delete(projectId);
        return;
      }
      pending.nudged = true;
      const reminder =
        `위 텔레그램 메시지에 아직 답하지 않았습니다. 답할 내용이 있으면 ` +
        `marblo MCP 의 send_telegram_message 도구를 호출해 답장하세요(projectId="${projectId}"). ` +
        `답이 필요 없으면 무시해도 됩니다.`;
      void Promise.resolve(orch.injectMessage(reminder))
        .then((wrote) => {
          if (!wrote) {
            this.log.warn(
              `[TelegramPoller] project=${projectId} nudge injectMessage did not write to a live PTY`,
            );
          }
        })
        .catch((err) => {
          const raw = err instanceof Error ? err.message : String(err);
          this.log.warn(
            `[TelegramPoller] project=${projectId} nudge injectMessage failed: ${raw}`,
          );
        });
      this.log.log(
        `[TelegramPoller] project=${projectId} nudged orchestrator to reply to inbound update ${pending.updateId}.`,
      );
      // Re-arm the fallback so a second idle-with-no-reply is counted.
      pending.maxTimer = this.armTimer(this.nudgeMaxGraceMs(), () =>
        this.onOrchestratorIdle(projectId),
      );
      return;
    }

    // Already nudged and still no reply → unanswered. No silent loss (spec C).
    this.bumpUnanswered(projectId);
    this.log.warn(
      `[TelegramPoller] project=${projectId} inbound update ${pending.updateId} went unanswered after a nudge.`,
    );
    this.pendingReplies.delete(projectId);
  }

  /** Clear any pending-reply tracking + timers for a project. */
  private clearPendingReply(projectId: string): void {
    const pending = this.pendingReplies.get(projectId);
    if (!pending) return;
    if (pending.idleTimer) clearTimeout(pending.idleTimer);
    if (pending.maxTimer) clearTimeout(pending.maxTimer);
    this.pendingReplies.delete(projectId);
  }

  private armTimer(ms: number, fn: () => void): ReturnType<typeof setTimeout> {
    const t = setTimeout(fn, ms);
    // Never let a nudge timer keep the process alive on quit.
    t.unref?.();
    return t;
  }

  // ── outbound (send_telegram_message MCP tool → bridge → here) ─────────

  /**
   * Send an outbound Telegram message. chatId defaults to the last inbound
   * chat for the project, then the configured chatId. NEVER returns or logs
   * the bot token (errors are scrubbed).
   */
  async sendMessage(
    projectId: string,
    text: string,
    chatId?: string,
  ): Promise<SendResult> {
    // The orchestrator is replying → cancel the un-replied nudge for this
    // project. Do this even if the send below fails: the orch DID answer; a
    // delivery failure is a separate concern (counted as a send failure).
    this.clearPendingReply(projectId);
    return this.deliverMessage(projectId, text, chatId, true);
  }

  /**
   * The wire half of {@link sendMessage}, without the "an orchestrator just
   * replied" side effects.
   *
   * ★Split out for the hold notice (maybeNotifyHold): that message is OUR
   * diagnostic, not the orchestrator answering, so it must not cancel a
   * pending-reply nudge and its failures must not land in the reliability
   * counters the owner reads as "the orchestrator's replies got lost".
   */
  private async deliverMessage(
    projectId: string,
    text: string,
    chatId: string | undefined,
    countFailures: boolean,
  ): Promise<SendResult> {
    const token = this.getToken(projectId);
    if (!token) {
      return {
        ok: false,
        error: `no active Telegram channel for project "${projectId}"`,
      };
    }
    const target =
      (chatId && chatId.trim()) ||
      this.lastChatId.get(projectId) ||
      this.getDefaultChatId(projectId);
    if (!target) {
      return {
        ok: false,
        error:
          "no chatId available — pass chatId explicitly or wait for an inbound message first",
      };
    }
    if (!text || !text.trim()) {
      return { ok: false, error: "message text is empty" };
    }

    // chatId 공유 구분 접두: 같은 대화방으로 발신하는 다른 활성 프로젝트가
    // 있으면 어느 프로젝트(오케)의 응답인지 구분할 수 없다 — `[프로젝트명] `
    // 접두를 자동 부착한다. 공유가 없으면 원문 그대로(단일 프로젝트 무회귀).
    const outboundText = this.chatIdSharers(projectId, target).length
      ? `[${this.projectLabel(projectId)}] ${text}`
      : text;

    const maxRetries = this.deps.sendMaxRetries ?? DEFAULT_SEND_MAX_RETRIES;
    const baseBackoff = this.deps.sendBackoffMs ?? DEFAULT_SEND_BACKOFF_MS;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        const resp = await telegramApi(
          token,
          "sendMessage",
          { chat_id: target, text: outboundText },
          { fetchImpl: this.deps.fetchImpl },
        );
        if (!resp.ok) {
          // ok:false on a 2xx is a non-retryable application error.
          if (countFailures) this.bumpSendFailure(projectId);
          return {
            ok: false,
            error: scrubToken(resp.description ?? "sendMessage failed", token),
          };
        }
        return { ok: true, chatId: target };
      } catch (err) {
        const retriable = isRetriableSendError(err);
        if (attempt < maxRetries && retriable) {
          const waitMs = retryWaitMs(err, baseBackoff, attempt);
          this.log.warn(
            `[TelegramPoller] project=${projectId} sendMessage attempt ${
              attempt + 1
            }/${maxRetries + 1} failed (${scrubToken(
              err instanceof Error ? err.message : String(err),
              token,
            )}); retrying in ${waitMs}ms`,
          );
          await this.delay(waitMs);
          continue;
        }
        // Final failure — surface an explicit, token-scrubbed error and count it.
        if (countFailures) this.bumpSendFailure(projectId);
        const raw = err instanceof Error ? err.message : String(err);
        return { ok: false, error: scrubToken(raw, token) };
      }
    }
    // Unreachable (loop always returns), but satisfies the type checker.
    if (countFailures) this.bumpSendFailure(projectId);
    return { ok: false, error: "sendMessage exhausted retries" };
  }

  /** Per-project reliability counters (spec C). Defaults to zeros. */
  getReliabilityStats(projectId: string): ReliabilityStats {
    return { ...(this.stats.get(projectId) ?? emptyStats()) };
  }

  /**
   * Token-free health snapshot for switch/takeover diagnostics. This lets the
   * switch path prove which PTY will receive Telegram inbound without exposing
   * bot credentials or chat contents.
   */
  getRouteHealth(projectId: string): TelegramRouteHealth {
    const delivered = this.lastDelivered.get(projectId);
    const loop = this.loopStats.get(projectId);
    return {
      projectId,
      loopRunning: this.loops.has(projectId),
      loopId: this.loops.get(projectId)?.id ?? null,
      concurrentLoops: this.liveLoops.get(projectId)?.size ?? 0,
      loopStarts: this.loopStarts.get(projectId) ?? 0,
      lastPollLoopId: loop?.loopId ?? null,
      lastDeliveredLoopId: delivered?.loopId ?? null,
      lastChatIdKnown: this.lastChatId.has(projectId),
      pendingReply: this.pendingReplies.has(projectId),
      lastInboundAt: delivered?.at ?? null,
      lastDeliveredUpdateId: delivered?.updateId ?? null,
      lastDeliveredTarget: delivered?.target ?? null,
      reliability: this.getReliabilityStats(projectId),
      lastPollStartedAt: loop?.startedAt ?? null,
      lastPollCompletedAt: loop?.completedAt ?? null,
      consecutivePollErrors: loop?.consecutiveErrors ?? 0,
      lastPollErrorAt: loop?.lastErrorAt ?? null,
      lastPollErrorKind: loop?.lastErrorKind ?? null,
      lastPollErrorStatus: loop?.lastErrorStatus ?? null,
      lastPollDurationMs: loop?.lastDurationMs ?? null,
      suspendedPollRecoveries: loop?.suspendRecoveries ?? 0,
      hold: this.holdSnapshot(projectId),
      consecutive409: loop?.consecutive409 ?? 0,
      since409: loop?.since409 ?? null,
      lease: this.getLeaseSnapshot(projectId),
      contention: this.getContention(projectId),
    };
  }


  /**
   * The sampler's iteration set: every project that SHOULD have a loop, plus
   * every project that currently has one.
   *
   * ★It is deliberately not just `this.loops.keys()`. A project whose loop died
   * or never started is exactly the case we most need a sample for — iterating
   * only over live loops would make "loop-stopped" invisible in the time series,
   * which is the same blind spot this ticket exists to close.
   */
  activeProjectIds(): string[] {
    const ids = new Set<string>(this.loops.keys());
    for (const projectId of this.listActiveProjectIds()) ids.add(projectId);
    return [...ids];
  }

  // ── loop liveness + offset-hold bookkeeping ──────────────────────────
  //
  // ★Why both, and why they are separate (ticket c1R9C8v5MrBycZYSdTeB).
  // "텔레그램이 안 들어온다" has two opposite causes that look identical from
  // the phone: the loop is not turning (network/throttle/wedge), or the loop
  // turns fine and every delivery is refused (composer blocked, no orch).
  // `loopRunning` alone cannot tell them apart — it is true for a wedged loop.
  // So the loop records that it turned, and the hold records that it could not
  // hand off. A sample carrying both settles the question after the fact.

  private loopStatsFor(projectId: string): LoopStats {
    let st = this.loopStats.get(projectId);
    if (!st) {
      st = {
        startedAt: null,
        completedAt: null,
        consecutiveErrors: 0,
        lastErrorAt: null,
        lastErrorKind: null,
        lastErrorStatus: null,
        lastDurationMs: null,
        suspendRecoveries: 0,
        consecutive409: 0,
        since409: null,
        loopId: null,
      };
      this.loopStats.set(projectId, st);
    }
    return st;
  }

  private notePollStarted(projectId: string, loopId: string): void {
    const st = this.loopStatsFor(projectId);
    st.startedAt = Date.now();
    st.loopId = loopId;
  }

  private notePollCompleted(
    projectId: string,
    loopId: string,
    ok: boolean,
    error?: { kind: TelegramPollErrorKind; status: number | null },
  ): void {
    const st = this.loopStatsFor(projectId);
    st.completedAt = Date.now();
    st.loopId = loopId;
    // ★Round-trip wall clock (ticket VCGuLWmNTlhoRvwGAKJA). Measured here, not
    // around the fetch, so it covers the whole attempt including the abort
    // timer that should have bounded it — the point is precisely to catch the
    // case where that timer did NOT fire on time.
    st.lastDurationMs =
      st.startedAt === null ? null : Math.max(0, st.completedAt - st.startedAt);
    if (ok) {
      st.consecutiveErrors = 0;
      // ★Cleared in lockstep with the streak count — these two fields answer
      // "what is failing right now", not "what has ever failed" (that's what
      // lastErrorAt/lastPollErrorAt are for, and they deliberately persist).
      st.lastErrorKind = null;
      st.lastErrorStatus = null;
      // 폴이 한 번이라도 성공했다면 지금 이 순간 우리를 밀어내는 소비자는 없다.
      st.consecutive409 = 0;
      st.since409 = null;
    } else {
      st.consecutiveErrors += 1;
      st.lastErrorAt = st.completedAt;
      st.lastErrorKind = error?.kind ?? "unknown";
      st.lastErrorStatus = error?.status ?? null;
      // ★409 만 따로 센다 — 타임아웃/네트워크와 한 칸에 섞이면 "누가 우리를
      // 밀어내고 있다"를 사용자에게 말할 근거가 사라진다.
      if (error?.kind === "http-409") {
        if (st.consecutive409 === 0) st.since409 = st.completedAt;
        st.consecutive409 += 1;
      } else {
        st.consecutive409 = 0;
        st.since409 = null;
      }
    }
  }

  /**
   * Record that the offset is being held on `updateId`, and why.
   *
   * ★The hold semantics are NOT touched here — the caller still returns false
   * and the offset still does not advance, so nothing is ever lost. This only
   * gives the hold a name, a start time, and an attempt count.
   */
  private noteHold(
    projectId: string,
    updateId: number,
    reason: TelegramHoldReason,
    detail: InjectFailureDescriptor | null,
  ): void {
    const now = Date.now();
    const existing = this.holds.get(projectId);
    if (existing && existing.updateId === updateId) {
      existing.attempts += 1;
      existing.reason = reason;
      existing.detail = detail;
      // The redelivery attempt repeats every idleBackoff (3s by default), so
      // logging each one buries the log. Say it on entry, then once a minute
      // WITH the elapsed time — a hold's duration is the diagnostic.
      if (now - existing.lastLoggedAt >= HOLD_LOG_THROTTLE_MS) {
        existing.lastLoggedAt = now;
        this.log.warn(
          `[TelegramPoller] project=${projectId} STILL holding offset at update ` +
            `${updateId} after ${Math.round((now - existing.since) / 1000)}s ` +
            `(${existing.attempts} attempts) — ${holdLine(reason, detail)}`,
        );
      }
    } else {
      this.holds.set(projectId, {
        reason,
        updateId,
        since: now,
        attempts: 1,
        detail,
        notified: false,
        lastLoggedAt: now,
      });
      this.log.warn(
        `[TelegramPoller] project=${projectId} holding offset at update ${updateId} ` +
          `for redelivery — ${holdLine(reason, detail)}`,
      );
    }
    this.maybeNotifyHold(projectId);
  }

  /** The hold on `updateId` is over (it was consumed). */
  private clearHold(projectId: string, updateId: number): void {
    const hold = this.holds.get(projectId);
    if (!hold || hold.updateId !== updateId) return;
    this.holds.delete(projectId);
    this.log.log(
      `[TelegramPoller] project=${projectId} hold released at update ${updateId} ` +
        `after ${Math.round((Date.now() - hold.since) / 1000)}s ` +
        `(${hold.attempts} attempts, reason=${hold.reason}).`,
    );
  }

  private holdSnapshot(projectId: string): TelegramHoldSnapshot | null {
    const hold = this.holds.get(projectId);
    if (!hold) return null;
    return {
      reason: hold.reason,
      updateId: hold.updateId,
      since: hold.since,
      heldMs: Date.now() - hold.since,
      attempts: hold.attempts,
      detail: hold.detail ? { ...hold.detail } : null,
    };
  }

  /**
   * Tell the owner, ONCE per hold episode, that the message arrived but is
   * parked — and why. Outbound does not go through the orchestrator PTY, so it
   * still works while inbound is blocked; without this, a blocked composer is
   * indistinguishable from a dead app to someone holding a phone.
   */
  private maybeNotifyHold(projectId: string): void {
    const after = this.deps.holdNotifyAfterMs ?? DEFAULT_HOLD_NOTIFY_AFTER_MS;
    if (after <= 0) return;
    const hold = this.holds.get(projectId);
    if (!hold || hold.notified) return;
    if (Date.now() - hold.since < after) return;
    hold.notified = true;
    const text =
      `⚠️ 방금 보내신 메시지는 도착했지만 아직 오케스트레이터에 전달하지 못했습니다 ` +
      `(${Math.round((Date.now() - hold.since) / 1000)}초째 보류 중).\n` +
      `사유: ${holdOwnerReason(hold.reason, hold.detail)}\n` +
      `메시지는 유실되지 않았습니다 — 막힘이 풀리면 자동으로 전달됩니다.`;
    // Diagnostic notice: never counted as a reply-carrying send, and its own
    // failure must not touch the reliability counters the owner reads.
    void this.deliverMessage(projectId, text, undefined, false).then((res) => {
      if (!res.ok) {
        this.log.warn(
          `[TelegramPoller] project=${projectId} hold notice could not be sent: ${res.error}`,
        );
      }
    });
  }

  private bumpUnanswered(projectId: string): void {
    const s = this.stats.get(projectId) ?? emptyStats();
    s.unanswered += 1;
    this.stats.set(projectId, s);
  }

  private bumpSendFailure(projectId: string): void {
    const s = this.stats.get(projectId) ?? emptyStats();
    s.sendFailures += 1;
    this.stats.set(projectId, s);
  }

  private delay(ms: number): Promise<void> {
    if (this.deps.sleepImpl) return this.deps.sleepImpl(ms);
    return new Promise((r) => setTimeout(r, ms));
  }

  // ── helpers ──────────────────────────────────────────────────────────

  private formatFrom(from: TgFrom | undefined): string {
    if (!from) return "unknown";
    if (from.username) return `@${from.username}`;
    const name = [from.first_name, from.last_name].filter(Boolean).join(" ");
    return name || "unknown";
  }

  private listActiveProjectIds(): string[] {
    if (this.deps.listActiveProjectIds) return this.deps.listActiveProjectIds();
    try {
      return listTelegramChannelConfigs()
        .filter((c) => c.botToken && isTelegramChannelActive(c.projectId))
        .map((c) => c.projectId);
    } catch {
      return [];
    }
  }

  private getToken(projectId: string): string | null {
    if (this.deps.getToken) return this.deps.getToken(projectId);
    if (!isTelegramChannelActive(projectId)) return null;
    return getTelegramChannelConfig(projectId)?.botToken ?? null;
  }

  private getDefaultChatId(projectId: string): string | null {
    if (this.deps.getDefaultChatId)
      return this.deps.getDefaultChatId(projectId);
    return getTelegramChannelConfig(projectId)?.chatId ?? null;
  }

  private getAllowedChatIds(projectId: string): string[] {
    if (this.deps.getAllowedChatIds)
      return this.deps.getAllowedChatIds(projectId);
    try {
      return getTelegramChannelAccess(projectId)?.allowedChatIds ?? [];
    } catch {
      return [];
    }
  }

  /** Other enabled projects sending into the same chat (prefix trigger). */
  private chatIdSharers(projectId: string, chatId: string): string[] {
    if (this.deps.listChatIdSharers)
      return this.deps.listChatIdSharers(projectId, chatId);
    try {
      return listTelegramChatIdSharers(projectId, chatId);
    } catch {
      return [];
    }
  }

  /** Outbound prefix label — project name, else a short projectId stub. */
  private projectLabel(projectId: string): string {
    try {
      const label =
        this.deps.getProjectLabel?.(projectId) ??
        getTelegramProjectLabel(projectId);
      if (label && label.trim()) return label.trim();
    } catch {
      /* label lookup is cosmetic — fall through to the stub */
    }
    return projectId.slice(0, 8);
  }

  private nudgeIdleDebounceMs(): number {
    return this.deps.nudgeIdleDebounceMs ?? DEFAULT_NUDGE_IDLE_DEBOUNCE_MS;
  }

  private nudgeMaxGraceMs(): number {
    return this.deps.nudgeMaxGraceMs ?? DEFAULT_NUDGE_MAX_GRACE_MS;
  }

  private async sleep(ms: number, ctrl: LoopHandle): Promise<void> {
    if (ctrl.stop) return;
    // ★Interruptible (ticket VCGuLWmNTlhoRvwGAKJA): notePowerResume can end the
    // wait early. `delay` still runs to completion — we just stop awaiting it —
    // so an injected sleepImpl in tests behaves exactly as before.
    let wake: () => void = () => undefined;
    const woken = new Promise<void>((resolve) => {
      wake = resolve;
    });
    ctrl.wake = wake;
    try {
      await Promise.race([this.delay(ms), woken]);
    } finally {
      if (ctrl.wake === wake) ctrl.wake = null;
    }
  }

  /**
   * Backoff that yields to a suspected suspension.
   *
   * ★Ticket VCGuLWmNTlhoRvwGAKJA. The measured failure shape was "wake up →
   * one getUpdates → it fails on the socket that died while we were suspended →
   * sleep the backoff → get suspended again", repeating every 15-17 minutes for
   * 12-15 hours. The backoff is the window the process gets re-napped in, so
   * when the round trip we just finished proves we were suspended, we spend no
   * time in it at all and go straight back for the backlog.
   *
   * Self-limiting by construction: the skip only happens when the LAST round
   * trip took longer than `thresholdMs` (>=70s by default), so it cannot spin.
   * Delivery, retry semantics and the offset rule are untouched.
   */
  private async backoffUnlessSuspended(
    projectId: string,
    ms: number,
    ctrl: LoopHandle,
    thresholdMs: number,
  ): Promise<void> {
    const st = this.loopStatsFor(projectId);
    const duration = st.lastDurationMs;
    if (duration !== null && duration > thresholdMs) {
      st.suspendRecoveries += 1;
      this.log.warn(
        `[TelegramPoller] project=${projectId} getUpdates round trip took ${duration}ms ` +
          `(budget threshold ${thresholdMs}ms) — treating as a process suspension; ` +
          `skipping the ${ms}ms backoff and re-polling now ` +
          `(recoveries=${st.suspendRecoveries})`,
      );
      return;
    }
    await this.sleep(ms, ctrl);
  }

  /**
   * ★The machine started running us again — go get the backlog now.
   *
   * Main wires this to powerMonitor `resume` / `unlock-screen` /
   * `user-did-become-active`. Those are the moments a suspended main process is
   * demonstrably scheduled again, and waiting out a backoff that was armed
   * before the suspension only adds latency to the boss's message.
   *
   * Throttled, because `user-did-become-active` fires in bursts: without the
   * throttle a burst would cancel every backoff in a row and turn a persistent
   * error into an API hammer. Cancelling a wait is the ONLY thing this does.
   */
  notePowerResume(reason: string): void {
    const throttle =
      this.deps.resumeNudgeThrottleMs ?? DEFAULT_RESUME_NUDGE_THROTTLE_MS;
    const nowMs = Date.now();
    if (nowMs - this.lastResumeNudgeAt < throttle) return;
    this.lastResumeNudgeAt = nowMs;
    let woken = 0;
    for (const handle of this.loops.values()) {
      if (handle.wake) {
        handle.wake();
        woken += 1;
      }
    }
    if (woken > 0) {
      this.log.log(
        `[TelegramPoller] power resume (${reason}) — cut short ${woken} backoff sleep(s) to re-poll immediately`,
      );
    }
  }

  // ── offset persistence ───────────────────────────────────────────────

  private offsetFile(): string {
    return this.deps.offsetFilePath ?? DEFAULT_OFFSET_FILE;
  }

  private loadOffsets(): void {
    try {
      const raw = fs.readFileSync(this.offsetFile(), "utf-8");
      const parsed = JSON.parse(raw) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        const out: Record<string, number> = {};
        for (const [k, v] of Object.entries(
          parsed as Record<string, unknown>,
        )) {
          if (typeof v === "number") out[k] = v;
        }
        this.offsets = out;
      }
    } catch {
      // Missing/corrupt → start fresh (Telegram redelivers unacked updates).
      this.offsets = {};
    }
  }

  private setOffset(projectId: string, offset: number): void {
    this.offsets[projectId] = offset;
    try {
      const file = this.offsetFile();
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.offsets, null, 2), "utf-8");
      fs.renameSync(tmp, file);
    } catch (err) {
      // Non-fatal: a failed persist only risks reprocessing on restart.
      this.log.warn(
        `[TelegramPoller] failed to persist offset for ${projectId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  // ── test/introspection hooks ─────────────────────────────────────────

  /** True if a poll loop is currently registered for the project (tests). */
  hasLoop(projectId: string): boolean {
    return this.loops.has(projectId);
  }

  /** True if any project currently has a registered poll loop. */
  hasActiveLoops(): boolean {
    return this.loops.size > 0;
  }

  /** Last inbound chatId recorded for the project, or undefined (tests). */
  getLastChatId(projectId: string): string | undefined {
    return this.lastChatId.get(projectId);
  }

  /** True if an inbound is awaiting a reply for the project (tests). */
  hasPendingReply(projectId: string): boolean {
    return this.pendingReplies.has(projectId);
  }
}

// ─── module helpers (pure — unit-testable, no state) ──────────────────────

function emptyStats(): ReliabilityStats {
  return { unanswered: 0, sendFailures: 0 };
}

/** Short, log-safe fingerprint of a bot token (never the token itself). */
function tokenHash(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 8);
}

/** What the claude telegram plugin state dir says about who holds the bot. */
interface PluginHolderInfo {
  /** The plugin .env holds exactly this bot's token. */
  tokenMatch: boolean;
  /** bot.pid contents (a booted plugin poller records its pid there). */
  pid: number | null;
  /** Whether that pid is a live process right now. */
  pidAlive: boolean;
}

/**
 * Best-effort, read-only probe of the claude telegram plugin state dir for the
 * 409 diagnosis: does its .env hold THIS bot's token, and is the plugin poller
 * whose pid is recorded in bot.pid still alive? Never throws; never returns
 * secret material.
 */
function probePluginHolder(dir: string, token: string): PluginHolderInfo {
  const info: PluginHolderInfo = {
    tokenMatch: false,
    pid: null,
    pidAlive: false,
  };
  try {
    const raw = fs.readFileSync(path.join(dir, ".env"), "utf-8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^TELEGRAM_BOT_TOKEN=(.*)$/);
      if (m && m[1].trim() === token) info.tokenMatch = true;
    }
  } catch {
    /* no .env → no plugin holder */
  }
  try {
    const pid = parseInt(
      fs.readFileSync(path.join(dir, "bot.pid"), "utf-8").trim(),
      10,
    );
    if (Number.isFinite(pid) && pid > 0) {
      info.pid = pid;
      try {
        process.kill(pid, 0);
        info.pidAlive = true;
      } catch (err) {
        // EPERM = alive but not ours; ESRCH = dead.
        info.pidAlive = (err as NodeJS.ErrnoException | null)?.code === "EPERM";
      }
    }
  } catch {
    /* no bot.pid */
  }
  return info;
}

/**
 * Ask the target why its last injection was refused. Optional and best-effort:
 * a target that cannot say returns null, and a throwing one must never break
 * delivery bookkeeping — this is diagnostics, not control flow.
 */
function describeInjectFailure(
  target: InboundTarget,
): InjectFailureDescriptor | null {
  try {
    return target.describeInjectFailure?.() ?? null;
  } catch {
    return null;
  }
}

/** One log line naming a hold. Carries no message body and no credentials. */
function holdLine(
  reason: TelegramHoldReason,
  detail: InjectFailureDescriptor | null,
): string {
  if (reason === "no-orchestrator") {
    return "no live orchestrator for this project (loop is turning; nothing to hand off to)";
  }
  const suffix = detail
    ? `refusal=${detail.refusal}${
        detail.composer ? ` composer=${detail.composer}` : ""
      } — ${detail.detail}`
    : "the target could not say why";
  return reason === "inject-threw"
    ? `injectMessage threw: ${suffix}`
    : `orchestrator IS live but injectMessage refused: ${suffix}`;
}

/** The same reason, phrased for the owner's phone (Korean, no internals). */
function holdOwnerReason(
  reason: TelegramHoldReason,
  detail: InjectFailureDescriptor | null,
): string {
  if (reason === "no-orchestrator") {
    return "이 프로젝트의 오케스트레이터가 실행 중이 아닙니다 — 마블로에서 오케를 켜 주세요.";
  }
  if (detail?.composer === "occupied") {
    return (
      "오케스트레이터 터미널 입력창에 제출되지 않은 글이 남아 있습니다. " +
      "남의 초안을 지우거나 대신 제출하지 않으므로, 그 줄을 제출하거나 지우면 풀립니다."
    );
  }
  if (detail?.composer === "awaiting-choice") {
    return (
      "오케스트레이터 터미널이 확인 다이얼로그([y/n]) 앞에서 대기 중입니다. " +
      "지금 쓰면 첫 글자가 선택으로 소비되므로 쓰지 않습니다. 다이얼로그에 답하면 풀립니다."
    );
  }
  return `오케스트레이터가 지금 입력을 받을 수 없는 상태입니다 (${
    detail?.refusal ?? "사유 미상"
  }).`;
}

function describeTarget(target: InboundTarget): InboundTargetDescriptor {
  try {
    return (
      target.describe?.() ?? {
        kind: "orchestrator",
        ptySessionId: null,
        status: target.isRunning?.() === false ? "stopped" : "running",
      }
    );
  } catch {
    return {
      kind: "orchestrator",
      ptySessionId: null,
      status: "unknown",
    };
  }
}

/**
 * Classify a getUpdates failure into a fixed, token-free vocabulary (ticket
 * 6umMHxuDmggv3R8Q1Mw6 — the journal used to record only a count, never why).
 * Never inspects the message body beyond `err.name`/`instanceof` checks, so it
 * cannot leak the bot token, a chat id, or message text even if a future
 * caller passes a richer error.
 */
export function classifyPollError(err: unknown): {
  kind: TelegramPollErrorKind;
  status: number | null;
} {
  if (err instanceof TelegramHttpError) {
    if (err.status === 409) return { kind: "http-409", status: err.status };
    if (err.status === 429) return { kind: "http-429", status: err.status };
    if (err.status >= 500) return { kind: "http-5xx", status: err.status };
    return { kind: "http-4xx", status: err.status };
  }
  // AbortController firing (our own timeout) surfaces as a DOMException/Error
  // named "AbortError" across Node's fetch implementations.
  if (err instanceof Error && err.name === "AbortError") {
    return { kind: "timeout", status: null };
  }
  if (err instanceof Error) {
    return { kind: "network", status: null };
  }
  return { kind: "unknown", status: null };
}

/**
 * Whether an outbound sendMessage error is worth retrying: 429 (rate limit) or
 * any 5xx from Telegram, plus non-HTTP errors (network reset / timeout / abort).
 * A 4xx other than 429 (bad chat id, blocked bot, etc.) is permanent → no retry.
 */
function isRetriableSendError(err: unknown): boolean {
  if (err instanceof TelegramHttpError) {
    return err.status === 429 || err.status >= 500;
  }
  // Network-level failure (fetch threw) — transient, retry.
  return true;
}

/**
 * How long to wait before the next outbound retry. Honors Telegram's
 * `retry_after` (seconds) on a 429; otherwise exponential backoff from base.
 */
function retryWaitMs(
  err: unknown,
  baseBackoffMs: number,
  attempt: number,
): number {
  if (err instanceof TelegramHttpError && typeof err.retryAfter === "number") {
    return Math.max(0, err.retryAfter * 1000);
  }
  return baseBackoffMs * 2 ** attempt;
}
