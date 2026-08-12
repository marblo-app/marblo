/**
 * ═══════════════════════════════════════════════════════════════════════════
 * WHAT `working` MEANS  (read this before touching any status logic)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * `working` means **this agent has an unfinished turn** — work was submitted to
 * it and it has not yet reported that turn complete. It does NOT mean "the
 * terminal is painting pixels".
 *
 * That distinction is the whole bug (2026-07-19 incident, load average 44 on a
 * 12-core box; 11 of 13 agents stranded). Status used to be derived from PTY
 * output, which gets BOTH directions wrong, in opposite ways:
 *
 *   - A FINISHED agent looks busy. A CLI sitting at its prompt keeps repainting
 *     its spinner / status line / cursor, so every chunk re-promoted it to
 *     `working` forever. The orchestrator saw a slot that never freed.
 *   - A BUSY agent looks free. **An agent that is reasoning emits nothing.**
 *     Long inference, a big file read, a slow tool call — all PTY-silent. The
 *     old 5-minute silence timer demoted that live work to `idle`, and the
 *     orchestrator then treated a thinking agent as available (and a reaper
 *     would treat it as garbage — that is how live work gets killed).
 *
 * So PTY bytes are demoted to a *hint*, and turn boundaries are anchored on the
 * two signals that actually mean something:
 *
 *   TURN STARTS on submitted INPUT (PtyManager.onSubmit — dispatch, reuse,
 *     nudge, Telegram forward, or a human pressing Enter in the terminal tab).
 *     Input is unambiguous: something asked this agent to do something.
 *   TURN ENDS on the agent's own COMPLETION REPORT (submit_for_review /
 *     update_task_status → REVIEW·DONE·FAILED·BLOCKED), which stamps
 *     `turnCompletedAt`.
 *
 * Between those two, the agent is `working` NO MATTER HOW QUIET IT IS. Silence
 * is not evidence of idleness. After a completion report it is `idle` no matter
 * how much the terminal keeps repainting. Noise is not evidence of work.
 *
 * The one escape hatch is ABANDONED_TURN_MS below: an agent with no completion
 * report AND no output for far longer than any plausible inference pause is
 * assumed wedged and demoted, so a crashed-but-not-exited CLI can't hold a slot
 * forever. It is deliberately much longer than the old 5-minute window, because
 * demoting a live agent is the expensive mistake and demoting a wedged one late
 * is the cheap one.
 *
 * ───────────────────────────────────────────────────────────────────────────
 * Original W1 note (the narrower fix this generalizes) follows.
 * ───────────────────────────────────────────────────────────────────────────
 *
 * Pure decision logic for reconciling an agent's live working/idle status after
 * it has finished a turn (W1).
 *
 * Background: when a worker calls submit_for_review / update_task_status(REVIEW·
 * DONE·FAILED·BLOCKED), the MCP tool POSTs /set-agent-status → AgentManager
 * demotes the agent working→idle. But the worker is STILL flushing its final
 * turn output, and every PTY chunk runs the onData hook which promotes
 * idle→working again. The agent therefore snaps back to `working` a beat after
 * the completion signal and stays there until the 5-min heartbeat idle window —
 * so the orchestrator sees a permanently `[working]` slot that never frees, and
 * treats a finished agent as "still running" (the exact stale-slot bug: 3 agents
 * — qa-freshuser / onboarding-cli-gate / web-guide-page — all stuck [working]
 * after completing).
 *
 * The fix is a short "turn-complete settle window": once an agent's bound task
 * goes terminal we stamp `turnCompletedAt`, and for a brief window afterwards we
 * SUPPRESS the trailing-output idle→working promotion (that output is the render
 * flush of the just-finished turn, not new work). The heartbeat additionally
 * demotes any agent still marked `working` whose turn completed and whose PTY
 * has been quiet for the settle window — a belt-and-suspenders in case a chunk
 * promoted it to `working` in the race BEFORE the completion signal landed.
 *
 * All decisions are pure (no clock, no I/O) so they unit-test without a live
 * PTY / Electron. AgentManager owns the mutable `turnCompletedAt` field and
 * feeds these functions.
 */

/** Settle window after a turn completes during which trailing PTY output must
 * NOT re-promote the agent to `working`, and after which a still-`working`
 * completed agent is demoted. Short (vs IDLE_INACTIVITY_MS = 5 min) so the slot
 * frees within seconds of submit — the W1 acceptance criterion — while still
 * long enough to absorb a normal end-of-turn render flush. A genuinely NEW turn
 * (dispatch / route / nudge) clears `turnCompletedAt`, so real follow-up work is
 * never suppressed beyond this window. */
export const TURN_COMPLETE_SETTLE_MS = 12_000; // 12s

export interface PromotionInput {
  /** Current live status of the agent. */
  status: "idle" | "working" | "error" | "stopped";
  /** True once stop()/kill() has been requested — never auto-promote then. */
  stopRequested: boolean;
  /** epoch-ms the agent's bound task last went terminal (turn finished), or
   * null when the agent has no just-completed turn. */
  turnCompletedAt: number | null;
  /** epoch-ms now. */
  now: number;
  /** Override the settle window (defaults to TURN_COMPLETE_SETTLE_MS). */
  settleMs?: number;
}

/**
 * Should a PTY-output chunk promote an `idle` agent to `working`?
 *
 * NO whenever a completion report is outstanding (`turnCompletedAt` set) —
 * with no time limit. Every byte after "I'm done" is the finished turn's
 * repaint: the trailing render flush, then the idle prompt's spinner and
 * cursor, forever. Promoting on any of it is exactly what stranded 11 agents
 * at `[working]` with nothing left to reap them.
 *
 * This used to expire after a 12s settle window, which merely delayed the
 * stranding by 12 seconds. The marker is now cleared only by a real turn start
 * — submitted input (see PtyManager.onSubmit) or an explicit promotion — so
 * genuine follow-up work still flips the agent to `working` instantly, while
 * pure noise never can.
 *
 * Returns false for stopRequested / non-idle as well (the caller only promotes
 * from idle, but the guard is explicit).
 */
export function shouldPromoteOnPtyOutput(input: PromotionInput): boolean {
  const { status, stopRequested, turnCompletedAt } = input;
  if (stopRequested) return false;
  if (status !== "idle") return false;
  // Completion report outstanding → these bytes are repaint, not work.
  if (turnCompletedAt !== null) return false;
  return true;
}

/**
 * Heartbeat reconcile: should a `working` agent whose turn has completed be
 * demoted to `idle`? True when the bound task went terminal (`turnCompletedAt`
 * set) and the PTY has been quiet for the settle window — i.e. the race where a
 * chunk promoted it to `working` just before the completion signal, so the
 * immediate /set-agent-status demote was overwritten. Does NOT wait the full
 * 5-min IDLE_INACTIVITY_MS, so the slot frees promptly.
 */
export function shouldDemoteCompletedTurn(input: {
  status: "idle" | "working" | "error" | "stopped";
  stopRequested: boolean;
  turnCompletedAt: number | null;
  lastPtyActivity: number;
  now: number;
  settleMs?: number;
}): boolean {
  const settleMs = input.settleMs ?? TURN_COMPLETE_SETTLE_MS;
  if (input.stopRequested) return false;
  if (input.status !== "working") return false;
  if (input.turnCompletedAt === null) return false;
  // Turn completed AND the PTY has settled → the trailing flush is over and no
  // new work resumed. Free the slot.
  return input.now - input.lastPtyActivity >= settleMs;
}

/**
 * Silence window after which a `working` agent that has NOT reported completion
 * is presumed wedged (crashed-but-not-exited CLI, hung tool call) and demoted
 * so its slot eventually frees.
 *
 * Deliberately far longer than the old 5-minute timer: **an agent that is
 * reasoning is PTY-silent**, and long inference, a large file read, or a slow
 * MCP round-trip routinely exceed five minutes. Demoting live work is the
 * expensive error — the orchestrator hands the "free" agent more work, and any
 * reaper gated on idleness will kill a session that is mid-thought. Demoting a
 * wedged agent 45 minutes late is merely untidy. When in doubt, believe the
 * agent is working.
 */
export const ABANDONED_TURN_MS = 45 * 60 * 1000; // 45 min

/**
 * Heartbeat reconcile: should a `working` agent with NO completion report be
 * demoted because it has gone silent far past any plausible inference pause?
 *
 * This is the wedged-agent backstop, NOT the normal completion path (that is
 * shouldDemoteCompletedTurn). It intentionally ignores how long the turn has
 * been running and looks only at silence since the last byte — a chatty agent
 * working for hours is fine; a totally mute one for 45 minutes is not.
 */
export function shouldDemoteAbandonedTurn(input: {
  status: "idle" | "working" | "error" | "stopped";
  stopRequested: boolean;
  turnCompletedAt: number | null;
  lastPtyActivity: number;
  now: number;
  abandonedMs?: number;
}): boolean {
  const abandonedMs = input.abandonedMs ?? ABANDONED_TURN_MS;
  if (input.stopRequested) return false;
  if (input.status !== "working") return false;
  // A completion report is the other function's business.
  if (input.turnCompletedAt !== null) return false;
  return input.now - input.lastPtyActivity >= abandonedMs;
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * IDLE-AT-PROMPT  —  positive proof that an agent STOPPED (not that it is quiet)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything above says the same thing twice: silence is not evidence of
 * idleness. The mirror-image error is just as real and is what the WATCHDOG
 * tripped over — **noise is not evidence of work**. A CLI parked at its input
 * prompt keeps repainting its composer, footer and cursor forever, and the
 * watchdog counted every one of those bytes as "the worker is alive"
 * (agent-watchdog inspect(): `max(boardActivity, lastPtyActivity)`). So an agent
 * that fell back to its prompt mid-task — turn over, completion never reported —
 * looked eternally fresh: never `dead` (its PTY is alive), never `silent` (the
 * repaint keeps bumping the clock), past the born-dead window. It was not caught
 * late; it was never caught at all.
 *
 * The fix is NOT a shorter silence timer (that is exactly the false-kill
 * regression this module exists to prevent). It is to look at WHAT the terminal
 * is painting and only discount the frames we can positively identify as the
 * idle prompt:
 *
 *   busy          — a harness "esc to interrupt"-class marker. Work in flight.
 *   awaiting-input— a human confirmation dialog. Blocked on a person, not stuck.
 *   idle-at-prompt— a harness composer/footer marker with NO busy marker in the
 *                   same frame. The CLI is waiting for someone to type.
 *   repaint       — no printable content at all (pure cursor/escape traffic).
 *                   Proves nothing in either direction.
 *   output        — anything else. Ordinary work output.
 *
 * Only `idle-at-prompt` and `repaint` fail to refresh the liveness clock; every
 * other frame counts as activity exactly as before. The asymmetry is deliberate
 * and runs one way: **a misread busy/idle marker must cost us a missed
 * detection, never a killed agent.** Hence busy markers are generous and checked
 * first, idle markers are narrow, per-harness, and only ones that appear in the
 * ready input prompt; a harness with no verified idle marker (grok, local,
 * custom) simply never produces this signal and keeps the legacy behavior.
 *
 * A reasoning agent emits NOTHING — no frames at all — so it can never enter the
 * idle-at-prompt state, which is what makes this safe to act on quickly.
 *
 * ★No PTY content is retained. Each chunk is classified and dropped; only two
 * timestamps survive (the F-7 "원문 금지" contract — see AgentInstance.outputChars).
 */

/** How a single PTY frame reads. See the block comment above. */
export type PtyFrameKind =
  | "busy"
  | "awaiting-input"
  | "idle-at-prompt"
  | "repaint"
  | "output";

/* eslint-disable no-control-regex -- ANSI sanitizing intentionally matches ESC/C0 bytes. */
const FRAME_OSC = /\x1b[\]PX^_][\s\S]*?(?:\x07|\x1b\\)/g;
const FRAME_CSI = /\x1b\[[\x30-\x3f]*[\x20-\x2f]*[\x40-\x7e]/g;
const FRAME_SHORT_ESC = /\x1b[\x20-\x2f]*[\x30-\x7e]/g;
const FRAME_CTRL = /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g;
/* eslint-enable no-control-regex */

/** Strip ANSI/control bytes so markers match the text a human would see.
 * Mirrors src/lib/ansi.ts stripAnsi — duplicated (not imported) because the
 * electron main build has its own rootDir and this module must stay a pure,
 * dependency-free unit. */
export function stripFrameAnsi(input: string): string {
  if (!input) return "";
  return input
    .replace(FRAME_OSC, "")
    .replace(FRAME_CSI, "")
    .replace(FRAME_SHORT_ESC, "")
    .replace(FRAME_CTRL, "");
}

/**
 * Work-in-flight markers. Harness-agnostic and deliberately GENEROUS: a false
 * "busy" only costs a missed detection, while a missed "busy" could let a
 * working agent drift into the idle-at-prompt state. Checked before idle
 * markers, so a full-frame repaint that contains both reads as busy.
 */
const BUSY_MARKERS: RegExp[] = [
  /esc to interrupt/i, // claude / codex running footer
  /esc to cancel/i, // gemini running footer
  /ctrl\+c to (?:stop|interrupt|cancel)/i,
  /\besc\b\s*\)?\s*to\s+stop\b/i,
  /\bThinking[.…]/i,
  /\bWorking[.…]/i,
];

/**
 * Blocked on a HUMAN (permission / confirmation dialog). Not idle-at-prompt:
 * nudging one of these would type into a dialog whose default may be
 * destructive, and the renderer's AttentionBadge already surfaces it. Treated
 * as ordinary activity so watchdog behavior for these is unchanged.
 */
const AWAITING_INPUT_MARKERS: RegExp[] = [
  /\[y\/n\]/i,
  /\(y\/n\)/i,
  /Do you want to (?:proceed|make|create|allow)/i,
  /Press Enter to continue/i,
  /Yes, and don't ask again/i,
];

/**
 * Per-harness READY-INPUT-PROMPT markers — the narrow half of the asymmetry.
 * Each entry must appear ONLY when the CLI is waiting for someone to type.
 * Sourced from the same live-PTY captures as CLI_READINESS_PATTERNS
 * (agent-manager.ts); note the two lists differ on purpose — readiness asks
 * "is the CLI up?" (where `esc to interrupt` qualifies), this one asks "is the
 * CLI waiting for input?" (where it disqualifies).
 *
 * A harness absent from this table never yields `idle-at-prompt`, so it keeps
 * the pre-existing board-activity-only behavior. grok's `--minimal` footer
 * (`/help for commands`) is NOT listed: it is verified for the ready state but
 * has not been verified to disappear while grok is working, and an unverified
 * idle marker is the one mistake this design refuses to make.
 */
const HARNESS_IDLE_PROMPT_MARKERS: Record<string, RegExp[]> = {
  // Claude Code's composer footer. agy (antigravity) renders the same footer
  // post-trust — verified in the CLI_READINESS_PATTERNS capture.
  claude: [/\? for shortcuts/, /Type your message/i],
  antigravity: [/\? for shortcuts/, /Type your message/i],
  // Codex TUI composer placeholders (empty input area only).
  gpt: [/Ask Codex/i, /Explain this codebase/i],
  gemini: [/Type your message/i],
};

/** Idle-prompt markers for a harness/model key, or [] when none are verified. */
export function idlePromptMarkersFor(harness: string | undefined): RegExp[] {
  if (!harness) return [];
  return HARNESS_IDLE_PROMPT_MARKERS[harness] ?? [];
}

/**
 * Classify one PTY chunk. Pure — the chunk is read and dropped, nothing is
 * stored. Chunks are classified individually (no rolling buffer): a marker
 * split across two writes is simply missed, which costs one frame out of the
 * many a parked TUI repaints, and keeps the "no PTY content retained" contract
 * literally true.
 */
export function classifyPtyFrame(
  chunk: string,
  harness: string | undefined,
): PtyFrameKind {
  const text = stripFrameAnsi(chunk);
  // Contentless cursor/escape traffic — proves nothing either way.
  if (text.trim().length === 0) return "repaint";
  if (BUSY_MARKERS.some((re) => re.test(text))) return "busy";
  if (AWAITING_INPUT_MARKERS.some((re) => re.test(text)))
    return "awaiting-input";
  const idle = idlePromptMarkersFor(harness);
  if (idle.length > 0 && idle.some((re) => re.test(text))) {
    return "idle-at-prompt";
  }
  return "output";
}

/** The two timestamps distilled from the PTY stream. Nothing else is kept. */
export interface PromptIdleState {
  /** epoch-ms of the last frame that counted as WORK. This — not raw
   * lastPtyActivity — is the liveness clock the watchdog should read. */
  lastWorkOutputAt: number;
  /** epoch-ms since which every classified frame has been an idle-prompt
   * repaint, or null when the agent is not (provably) parked at its prompt. */
  promptIdleSince: number | null;
}

/**
 * Fold one classified frame into the state.
 *
 *   idle-at-prompt → start/extend the parked window; the work clock does NOT
 *                    advance (this is the whole point — repaint ≠ work).
 *   repaint        → no opinion; leave both fields alone.
 *   anything else  → real activity: bump the work clock and cancel any parked
 *                    window. ONE busy/output frame is enough to clear it.
 */
export function applyPtyFrame(
  prev: PromptIdleState,
  kind: PtyFrameKind,
  now: number,
): PromptIdleState {
  if (kind === "repaint") return prev;
  if (kind === "idle-at-prompt") {
    return {
      lastWorkOutputAt: prev.lastWorkOutputAt,
      promptIdleSince: prev.promptIdleSince ?? now,
    };
  }
  return { lastWorkOutputAt: now, promptIdleSince: null };
}

/**
 * A new turn was submitted (dispatch / reuse / nudge / a human pressing Enter).
 * The agent is no longer parked, and the submission itself is fresh evidence of
 * life — so a nudged agent gets a full new window before it can be judged
 * parked again.
 */
export function resetPromptIdleOnTurnStart(now: number): PromptIdleState {
  return { lastWorkOutputAt: now, promptIdleSince: null };
}

/** Task statuses that mean the agent's turn is finished and its slot should be
 * released immediately (idempotent completion signal from the MCP tools). */
export function isTurnEndingStatus(status: unknown): boolean {
  return (
    status === "REVIEW" ||
    status === "DONE" ||
    status === "FAILED" ||
    status === "BLOCKED"
  );
}
