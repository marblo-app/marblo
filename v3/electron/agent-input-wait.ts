/**
 * ═══════════════════════════════════════════════════════════════════════════
 * AGENT IS WAITING FOR A HUMAN  —  the renderer-facing half of the #935 signal
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * #935 taught the watchdog to tell "quiet because it is thinking" apart from
 * "quiet because it is parked at its input prompt" (agent-status-reconcile.ts
 * classifyPtyFrame → applyPtyFrame → promptIdleSince). That signal is consumed
 * by exactly one reader today: the watchdog, which answers it with a nudge.
 *
 * There is a second reader who needs it more — the PERSON. In simple mode the
 * terminals are not rendered at all, so an agent that stops at a prompt is
 * invisible: no output, no error, no completion, just a card that never moves.
 * The user has no way to even discover that something is waiting on them.
 *
 * This module folds the SAME classified frames into a UI verdict. It builds no
 * new detector — `kind` is classifyPtyFrame's output and `promptIdleSince` is
 * applyPtyFrame's state; both arrive unchanged from the #935 pipeline. All that
 * is added here is the question the watchdog never asks: *does a human need to
 * look at this right now?*
 *
 * ── Why the two reasons differ in urgency ──────────────────────────────────
 *   confirm — a frame positively identified as a confirmation dialog
 *             (AWAITING_INPUT_MARKERS: [y/n], "Do you want to proceed", …).
 *             Nothing will happen until someone answers, so it fires on the
 *             first frame with no grace at all.
 *   prompt  — the CLI has been sitting at its ready composer past a grace
 *             window WITH ITS TURN STILL OPEN. "Turn still open" is what makes
 *             this actionable rather than noise: an agent that reported its
 *             task terminal and then sits at its prompt is simply finished, and
 *             surfacing that as "needs you" would put a badge on every idle
 *             agent in the fleet.
 *
 * ── Why the bypass consent screen is NOT in here ───────────────────────────
 * The first-run `--dangerously-skip-permissions` consent screen — the exact
 * screen that motivated this ticket — matches NONE of the classifier's markers:
 * it is not a [y/n] dialog and it is not the ready composer, so it never
 * becomes `awaiting-input` and never sets `promptIdleSince`. Notifying about it
 * would therefore require a detector this module refuses to invent.
 *
 * It does not need one. WE pass that flag, so the consent is already granted by
 * construction and the screen is pure friction: shouldAutoAcceptBypass below
 * answers it via a PTY write and the stall never exists. Only prompts we did
 * NOT provoke reach the notification path.
 *
 * ★No PTY content is retained here either (the F-7 원문 금지 contract): every
 * function takes a chunk or a frame kind, answers, and keeps nothing.
 */

import { stripFrameAnsi, type PtyFrameKind } from "./agent-status-reconcile";

/** Why a human is being asked to look. See the block comment above. */
export type InputWaitReason = "confirm" | "prompt";

/**
 * How long the CLI must sit at its ready composer, turn still open, before the
 * renderer is told a human is needed.
 *
 * Much shorter than the watchdog's promptIdleGraceMs (90 s) on purpose — these
 * two act on the same observation with opposite cost profiles. A wrong nudge
 * costs the agent a spurious turn; a wrong notification costs the user a glance
 * at a badge they can dismiss. The expensive mistake here is being LATE, since
 * the whole failure mode is a person who never learns they were asked anything.
 */
export const INPUT_WAIT_PROMPT_GRACE_MS = 20_000;

export interface InputWaitInput {
  /**
   * The frame just classified by classifyPtyFrame, or null when this is a
   * timer-driven re-evaluation with no new frame (the per-agent heartbeat).
   * A parked TUI repaints, so the frame path normally wins the race; the timer
   * exists so a CLI that parks and then goes completely silent still surfaces.
   */
  kind: PtyFrameKind | null;
  /** applyPtyFrame state — epoch-ms since parked at the ready prompt, or null. */
  promptIdleSince: number | null;
  /** Turn boundary: null while a turn is open (see AgentInstance). */
  turnCompletedAt: number | null;
  /** stopRequested, or a stopped/error PTY — nothing can be waiting on input. */
  terminal: boolean;
  now: number;
  graceMs?: number;
}

/**
 * Fold one observation into the agent's input-wait verdict. Pure.
 *
 * `prev` matters for exactly one case: a confirmation dialog. A dialog's own
 * repaint routinely arrives as chunks that carry none of its markers (the
 * question line in one write, the option list in the next), and those chunks
 * classify as plain `output`. Dropping the verdict on them would flap the
 * notification on and off while the dialog just sits there. So a standing
 * `confirm` survives ordinary output and is cleared only by evidence that the
 * dialog is gone: a busy marker (work resumed), the ready composer (dialog
 * dismissed), a submitted turn, or the agent going terminal.
 */
export function foldInputWait(
  prev: InputWaitReason | null,
  input: InputWaitInput,
): InputWaitReason | null {
  const graceMs = input.graceMs ?? INPUT_WAIT_PROMPT_GRACE_MS;
  if (input.terminal) return null;
  // Work in flight — whatever we thought was waiting, the agent moved on.
  if (input.kind === "busy") return null;
  // A confirmation dialog is unambiguous and blocking. No grace.
  if (input.kind === "awaiting-input") return "confirm";

  // Parked at the ready composer past the grace, with the turn still open.
  const parked =
    input.promptIdleSince !== null &&
    input.turnCompletedAt === null &&
    input.now - input.promptIdleSince >= graceMs;
  if (parked) return "prompt";

  // Back at the ready composer but not parked long enough (or the turn is
  // already reported done). Either way the CLI is not showing a dialog, so a
  // standing `confirm` is stale.
  if (input.kind === "idle-at-prompt") return null;

  // Ordinary output, a contentless repaint, or no frame at all: says nothing
  // about a dialog either way — see the doc comment.
  return prev === "confirm" ? "confirm" : null;
}

/**
 * The models we launch with a bypass-permissions flag (agent-config.ts):
 * Claude Code's `--dangerously-skip-permissions` and antigravity's identically
 * named flag. Any other harness never renders this consent screen, so it is
 * excluded rather than probed.
 */
const BYPASS_FLAG_MODELS = new Set(["claude", "antigravity"]);

/**
 * How long after spawn the consent screen may be auto-accepted. It is a
 * FIRST-RUN screen shown during boot; a match arriving minutes later is far
 * more likely to be the agent quoting the string (a worker reading this very
 * file, say) than the real dialog, and a stray "2⏎" into a live composer is
 * the one outcome worth designing against.
 */
export const BYPASS_CONSENT_WINDOW_MS = 180_000;

/**
 * The accept option on Claude Code's bypass-permissions consent screen.
 *
 * Deliberately ONE marker rather than a conjunction with the warning headline:
 * chunks are classified individually (no rolling buffer — the F-7 contract),
 * and the headline and the option list sit five lines apart, so they routinely
 * arrive in different writes. Requiring both in one chunk would mean never
 * matching at all. The narrowing that a conjunction would have bought is bought
 * instead by the call-site gates below (flag-bearing model · boot window ·
 * once per instance), which do not depend on how the TUI happens to chunk.
 */
const BYPASS_ACCEPT_MARKER = /yes,\s*i\s*accept/i;

/**
 * Keystrokes that accept the consent screen: select option 2, then confirm.
 *
 * Sent as two writes because the two behaviors we might be facing need
 * different halves. If the digit both selects AND confirms (Claude Code's
 * numeric shortcut), the trailing Enter lands in the composer that replaces the
 * screen as an empty submit, which the CLI ignores. If the digit only moves the
 * highlight, the Enter is what accepts. Either way one of the two is a no-op
 * and neither can pick "No, exit".
 */
export const BYPASS_CONSENT_SELECT = "2";
export const BYPASS_CONSENT_CONFIRM = "\r";
/** Gap between the two writes so the TUI processes them as separate keys. */
export const BYPASS_CONSENT_CONFIRM_DELAY_MS = 150;

/**
 * Should this PTY chunk be answered as the first-run bypass consent screen?
 * Pure — the chunk is read and dropped.
 *
 * All four gates must hold. The marker alone is not enough: it is a string, and
 * strings show up in transcripts.
 */
export function shouldAutoAcceptBypass(input: {
  chunk: string;
  /** AgentInstance.model — only flag-bearing harnesses render this screen. */
  model: string | undefined;
  /** epoch-ms of this instance's spawn (AgentInstance.spawnedAt). */
  spawnedAt: number;
  now: number;
  /** Latch — this instance already answered once. */
  alreadyAnswered: boolean;
  windowMs?: number;
}): boolean {
  if (input.alreadyAnswered) return false;
  if (!input.model || !BYPASS_FLAG_MODELS.has(input.model)) return false;
  const windowMs = input.windowMs ?? BYPASS_CONSENT_WINDOW_MS;
  if (input.now - input.spawnedAt > windowMs) return false;
  return BYPASS_ACCEPT_MARKER.test(stripFrameAnsi(input.chunk));
}

/** What main sends the renderer on every input-wait transition. Carries no PTY
 * content — an id, a name, and why. */
export interface AgentInputWaitEvent {
  agentId: string;
  agentName: string;
  /** Owning project, used by main to scope the event to the right window(s). */
  projectId: string;
  /** Ticket the agent is bound to, for the notification's subtitle. */
  taskId: string | null;
  /** false is the RETRACTION — the renderer drops the notification. */
  waiting: boolean;
  reason: InputWaitReason | null;
  /** epoch-ms the wait began, or null on a retraction. */
  since: number | null;
}
