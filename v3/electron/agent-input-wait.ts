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
  // Completion report outstanding (submit_for_review / DONE / FAILED / …).
  // The agent already said it is finished — parking at the prompt (or a leftover
  // confirm frame) is not a request for the user. Surfacing "waiting for you"
  // here is exactly the post-merge notification spam.
  if (input.turnCompletedAt !== null) return null;
  // Work in flight — whatever we thought was waiting, the agent moved on.
  if (input.kind === "busy") return null;
  // A confirmation dialog is unambiguous and blocking. No grace.
  if (input.kind === "awaiting-input") return "confirm";

  // Parked at the ready composer past the grace, with the turn still open.
  const parked =
    input.promptIdleSince !== null &&
    input.now - input.promptIdleSince >= graceMs;
  if (parked) return "prompt";

  // Back at the ready composer but not parked long enough. The CLI is not
  // showing a dialog, so a standing `confirm` is stale.
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
export const BYPASS_FLAG_MODELS = new Set(["claude", "antigravity"]);

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
 * ═══════════════════════════════════════════════════════════════════════════
 * THE COMPOSER IS ALIVE  —  the gate that closes the consent window early
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * The 180 s boot window above was the ONLY thing standing between a quoted
 * string and a live composer, and it is not enough. The latch
 * (`alreadyAnswered`) only arms itself by MEETING the consent screen, and a
 * returning user never sees that screen — so on their machine the latch stays
 * false forever and every one of the first 180 seconds is armed. Live PTY
 * capture (scenario R, 2026-08-21): boot prompt submitted at 1741 ms, the CLI
 * printed the accept line at 8243 ms while quoting THIS FILE, and `2` + `\r`
 * went into the live conversation at 8244 / 8396 ms.
 *
 * ★Why this is not fixed by making the MARKER stricter. See
 * BYPASS_ACCEPT_MARKER's comment: chunks are classified individually with no
 * rolling buffer, and the warning headline sits five lines above the option
 * list, so the two routinely arrive in different writes. A conjunction would
 * stop matching the REAL screen, and a new Mac would stall again — trading a
 * misfire for the outage the auto-accept exists to prevent.
 *
 * So the marker is left exactly as it was and the ARMING is narrowed instead,
 * on evidence that the consent screen is behind us rather than on how the TUI
 * happened to chunk. Two proofs, each one-way (once true, true for this PTY's
 * whole life), and the real consent screen precedes BOTH of them:
 *
 *   composer frame — a frame carrying Claude Code's composer-mode footer
 *     glyph. Verified against live frames: the glyph appears on the ready
 *     composer and on NO first-run screen (consent, folder trust, theme
 *     picker, login menu) — the same capture that made it the orchestrator's
 *     readiness marker. The consent dialog cannot carry it: claude mounts
 *     `BypassPermissionsModeDialog` as an awaited modal BEFORE the REPL exists
 *     (two mount sites in 2.1.238, both pre-REPL), so there is no code path
 *     that repaints the consent screen once a composer has been drawn.
 *
 *   we typed — we submitted the boot prompt (or injected a message) into this
 *     PTY. We only ever write into a composer we believe is live, and the
 *     orchestrator proves it before writing: sendPrompt() holds the boot prompt
 *     while looksLikeFirstRunDialog() is true, and BYPASS_ACCEPT_MARKER is one
 *     of those markers. "Boot prompt sent" therefore already MEANS "the consent
 *     screen was not on screen".
 *
 * The order matters at the call site: fold the frame into the proof BEFORE
 * asking whether to answer it. An agent quoting the accept line does so inside
 * a live composer, and claude repaints the whole screen — footer included — so
 * the quoting frame usually carries its own disproof.
 */
export const LIVE_COMPOSER_MARKER = /\u23f5\u23f5/;

/**
 * Does this frame prove the CLI is at its live composer?
 *
 * Pure; the frame is read and dropped (the F-7 원문 금지 contract).
 *
 * ★Matched as a GLYPH, not as words, for the same reason the orchestrator's
 * readiness pattern is: the same footer renders as `⏵⏵ bypass permissions on`
 * and, when claude paints with cursor-forward escapes instead of spaces, as
 * `⏵⏵bypasspermissionson`. The glyph survives both.
 *
 * Claude Code only. antigravity carries the same bypass flag but not this
 * footer, so its consent window is closed by the "we typed" proof alone —
 * strictly better than the 180 s free-for-all it had before, and never worse.
 */
export function looksLikeLiveComposer(frame: string): boolean {
  return LIVE_COMPOSER_MARKER.test(stripFrameAnsi(frame));
}

/**
 * Should this PTY chunk be answered as the first-run bypass consent screen?
 * Pure — the chunk is read and dropped.
 *
 * All five gates must hold. The marker alone is not enough: it is a string, and
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
  /**
   * This PTY has been proven to be at a live composer at or before this chunk
   * (see the block comment above). One-way: callers never clear it.
   */
  composerProvenLive: boolean;
  windowMs?: number;
}): boolean {
  if (input.alreadyAnswered) return false;
  // ★The gate this ticket exists for. A live composer means the consent screen
  // is behind us for good, so the remaining boot window is not ours to use.
  if (input.composerProvenLive) return false;
  if (!input.model || !BYPASS_FLAG_MODELS.has(input.model)) return false;
  const windowMs = input.windowMs ?? BYPASS_CONSENT_WINDOW_MS;
  if (input.now - input.spawnedAt > windowMs) return false;
  return BYPASS_ACCEPT_MARKER.test(stripFrameAnsi(input.chunk));
}

/**
 * ═══════════════════════════════════════════════════════════════════════════
 * FIRST-RUN SCREENS THAT MUST NEVER BE TYPED INTO
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A freshly spawned CLI does not go straight to its composer on a machine that
 * has never run it. It walks a short chain of full-screen dialogs first, and
 * every one of them is a SELECT LIST: arbitrary text is swallowed and the
 * trailing Enter picks whatever option is highlighted. Typing a boot prompt
 * into one is therefore not "a message that failed to send" — it is a keystroke
 * that answers a question nobody meant to answer.
 *
 * ★These are live measurements, not guesses (2026-08-21, PTY frames captured
 * against an isolated HOME/CODEX_HOME — see the ticket's activity log):
 *
 *   claude 2.1.238, fresh HOME
 *     0.6s  theme picker      "Choose the text style…"      (7 numbered options)
 *     ~     login menu        "Select login method:"        → LOGIN_SCREEN_PATTERNS
 *     0.3s  folder trust      "…trust this folder"          "Enter to confirm"
 *     1.0s  bypass consent    "2. Yes, I accept"            "Enter to confirm"
 *     2.8s  composer          "⏵⏵ bypass permissions on (shift+tab to cycle)"
 *
 *   codex 0.149.0, fresh CODEX_HOME
 *     0.12s SKELETON composer "› Ask Codex to do anything   ? for shortcuts"
 *           ← header still reads `model: loading` / `directory: loading`.
 *             This frame is a LIE: it carries two of our readiness markers
 *             while the TUI is not yet accepting input.
 *     0.17s folder trust      "Do you trust the contents of this directory?"
 *     0.32s login menu        "1. Sign in with ChatGPT … Press enter to continue"
 *
 * The codex skeleton is why a delay tweak cannot fix this: the readiness marker
 * arrives BEFORE the dialog does, so any fixed wait lands inside the dialog
 * rather than after it. The only sound gate is to re-read the screen at the
 * moment of the write, which is what looksLikeFirstRunDialog is for.
 *
 * Login screens are deliberately NOT listed here — harness-manager's
 * LOGIN_SCREEN_PATTERNS / createLoginScreenBackstop already own that decision
 * (including its probe + grace reconciliation), and duplicating it here would
 * be the second copy that only one side ever gets fixed in.
 */
const FIRST_RUN_DIALOG_MARKERS: RegExp[] = [
  // claude: bypass consent. SAME marker the auto-accept uses — imported by
  // reference rather than retyped, so the two can never drift apart.
  BYPASS_ACCEPT_MARKER,
  /trust\s*this\s*folder/i, // claude: folder trust dialog
  /Choose\s*the\s*text\s*style/i, // claude: first-run theme picker
  /Do\s*you\s*trust\s*the\s*contents\s*of\s*this\s*directory/i, // codex: folder trust
  // Confirmation footers. Both CLIs print one on every full-screen select list,
  // so they catch first-run screens we have not enumerated by name. Neither
  // appears on a ready composer.
  /Enter\s*to\s*confirm/i, // claude select lists
  /Press\s*enter\s*to\s*continue/i, // codex select lists
  // codex: the pre-initialisation skeleton. `model:` / `directory:` read
  // "loading" until the real session exists, and that word is what tells the
  // frame apart from the identical-looking ready header.
  /\bmodel:\s*loading\b/i,
  /\bdirectory:\s*loading\b/i,
];

/**
 * ★Why every marker above tolerates missing whitespace (`\s*`, never a literal
 * space): claude paints these screens with cursor-forward escapes instead of
 * spaces, so `stripFrameAnsi` yields `Yes,Iaccept` / `Entertoconfirm` /
 * `Itrustthisfolder`. A pattern written with real spaces matches the same
 * screen in one render path and misses it in another — the failure mode is
 * invisible until it is a P0. BYPASS_ACCEPT_MARKER has always been written this
 * way; the rest follow it.
 */

/**
 * Is this frame one of the first-run dialogs above — i.e. a screen where a
 * boot prompt would be swallowed and its Enter would answer a question?
 *
 * Pure; the frame is read and dropped (the F-7 원문 금지 contract). Callers
 * pass the CURRENT screen, not a boot-long transcript: a TUI repaints in full,
 * so a stale dialog scrolls out of a short window on its own and a long one
 * would keep the gate shut long after the dialog was answered.
 */
export function looksLikeFirstRunDialog(frame: string): boolean {
  const text = stripFrameAnsi(frame);
  return FIRST_RUN_DIALOG_MARKERS.some((re) => re.test(text));
}

/**
 * How long a held boot prompt may stay held before the CLI is declared stuck
 * and the panel/board is told so.
 *
 * ★Lives next to the gate rather than inside each caller: the orchestrator and
 * the worker hold the SAME screens for the SAME reason, and a second copy of
 * this number is the shape that lets one side get fixed and the other rot —
 * which is precisely how the worker path ended up with no gate at all while
 * the orchestrator had one.
 *
 * Why 60 s: the screens this holds for are answered by something else (the
 * bypass auto-accept, a pre-emptied trust entry, a human at the terminal tab),
 * and every one of those resolves in seconds. A minute of holding therefore
 * means nobody is going to answer — waiting longer only lengthens the window in
 * which the board shows a state nothing will leave.
 */
export const FIRST_RUN_DIALOG_GIVE_UP_MS = 60_000;

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
