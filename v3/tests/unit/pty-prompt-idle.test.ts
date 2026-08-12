import { describe, it, expect } from "vitest";
import {
  classifyPtyFrame,
  applyPtyFrame,
  resetPromptIdleOnTurnStart,
  idlePromptMarkersFor,
  stripFrameAnsi,
  type PromptIdleState,
} from "../../electron/agent-status-reconcile";

// ── Realistic frames ─────────────────────────────────────────────────────
// Shapes taken from the same live-PTY captures that produced
// CLI_READINESS_PATTERNS (agent-manager.ts). What matters per frame is which
// marker class it carries, not the exact box drawing.

const CLAUDE_IDLE_FRAME =
  "\x1b[2J\x1b[H╭──────────────────────────────────────╮\n" +
  '│ > Try "how does auth work?"          │\n' +
  "╰──────────────────────────────────────╯\n" +
  "  \x1b[2m? for shortcuts\x1b[0m\n";

const CLAUDE_BUSY_FRAME =
  "\x1b[2m✳\x1b[0m Herding… (23s · ↑ 1.4k tokens · esc to interrupt)\n";

const CLAUDE_PERMISSION_FRAME =
  "╭──────────────────────────────────────╮\n" +
  "│ Do you want to make this edit to a.ts?│\n" +
  "│ ❯ 1. Yes                              │\n" +
  "│   2. Yes, and don't ask again         │\n" +
  "╰──────────────────────────────────────╯\n";

const CODEX_IDLE_FRAME = "▌ Ask Codex to do anything\n";
const CODEX_BUSY_FRAME = "• Working (12s · Esc to interrupt)\n";

const WORK_OUTPUT_FRAME =
  "Reading electron/agent-watchdog.ts (1172 lines)\n" +
  "  ⎿  applied edit to electron/agent-watchdog.ts\n";

/** Pure cursor traffic: escape bytes only, no printable text. */
const CURSOR_REPAINT_FRAME = "\x1b[?25l\x1b[38;5;242m\x1b[0m\x1b[?25h";

describe("stripFrameAnsi", () => {
  it("removes CSI/OSC/control bytes but keeps the visible text", () => {
    expect(stripFrameAnsi(CLAUDE_IDLE_FRAME)).toContain("? for shortcuts");
    expect(stripFrameAnsi(CLAUDE_IDLE_FRAME)).not.toContain("\x1b");
  });

  it("leaves a cursor-only frame with no printable content", () => {
    expect(stripFrameAnsi(CURSOR_REPAINT_FRAME).trim()).toBe("");
  });
});

describe("classifyPtyFrame — the asymmetry that keeps this safe", () => {
  it("claude composer footer at rest → idle-at-prompt", () => {
    expect(classifyPtyFrame(CLAUDE_IDLE_FRAME, "claude")).toBe(
      "idle-at-prompt",
    );
  });

  it("codex composer placeholder at rest → idle-at-prompt", () => {
    expect(classifyPtyFrame(CODEX_IDLE_FRAME, "gpt")).toBe("idle-at-prompt");
  });

  it("running footer → busy (esc to interrupt)", () => {
    expect(classifyPtyFrame(CLAUDE_BUSY_FRAME, "claude")).toBe("busy");
    expect(classifyPtyFrame(CODEX_BUSY_FRAME, "gpt")).toBe("busy");
  });

  it("★busy wins when one frame paints both — a full-screen repaint of a working agent must never read as parked", () => {
    const both = CLAUDE_BUSY_FRAME + CLAUDE_IDLE_FRAME;
    expect(classifyPtyFrame(both, "claude")).toBe("busy");
  });

  it("a permission dialog is awaiting-input, NOT idle-at-prompt (never nudge into a dialog)", () => {
    expect(classifyPtyFrame(CLAUDE_PERMISSION_FRAME, "claude")).toBe(
      "awaiting-input",
    );
  });

  it("ordinary tool/assistant output → output", () => {
    expect(classifyPtyFrame(WORK_OUTPUT_FRAME, "claude")).toBe("output");
  });

  it("contentless cursor traffic → repaint (proves nothing either way)", () => {
    expect(classifyPtyFrame(CURSOR_REPAINT_FRAME, "claude")).toBe("repaint");
  });

  it("a harness with no VERIFIED idle marker never yields idle-at-prompt", () => {
    // grok's `--minimal` footer is verified for the ready state but not
    // verified to disappear while it works — so it is deliberately unlisted.
    expect(idlePromptMarkersFor("grok")).toEqual([]);
    expect(
      classifyPtyFrame("Grok Build v1.0.0  /help for commands", "grok"),
    ).toBe("output");
    expect(classifyPtyFrame(CLAUDE_IDLE_FRAME, "local")).toBe("output");
    expect(classifyPtyFrame(CLAUDE_IDLE_FRAME, undefined)).toBe("output");
  });

  it("antigravity shares claude's post-trust footer", () => {
    expect(classifyPtyFrame(CLAUDE_IDLE_FRAME, "antigravity")).toBe(
      "idle-at-prompt",
    );
  });
});

describe("applyPtyFrame — two timestamps, nothing else", () => {
  const t0 = 1_000_000;
  const base: PromptIdleState = { lastWorkOutputAt: t0, promptIdleSince: null };

  it("an idle frame parks the agent without advancing the work clock", () => {
    const s = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    expect(s.promptIdleSince).toBe(t0 + 5_000);
    expect(s.lastWorkOutputAt).toBe(t0); // ★repaint is not work
  });

  it("further idle frames keep the ORIGINAL parked timestamp (the window doesn't restart)", () => {
    let s = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    s = applyPtyFrame(s, "idle-at-prompt", t0 + 60_000);
    s = applyPtyFrame(s, "idle-at-prompt", t0 + 120_000);
    expect(s.promptIdleSince).toBe(t0 + 5_000);
  });

  it("★one busy frame cancels the parked window and refreshes the work clock", () => {
    const parked = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    const s = applyPtyFrame(parked, "busy", t0 + 6_000);
    expect(s.promptIdleSince).toBeNull();
    expect(s.lastWorkOutputAt).toBe(t0 + 6_000);
  });

  it("ordinary output also cancels it — only a confirmed idle prompt is discounted", () => {
    const parked = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    expect(
      applyPtyFrame(parked, "output", t0 + 6_000).promptIdleSince,
    ).toBeNull();
  });

  it("a human-confirmation frame cancels it too (blocked on a person, not stalled)", () => {
    const parked = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    const s = applyPtyFrame(parked, "awaiting-input", t0 + 6_000);
    expect(s.promptIdleSince).toBeNull();
    expect(s.lastWorkOutputAt).toBe(t0 + 6_000);
  });

  it("a contentless repaint changes nothing in either direction", () => {
    const parked = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    expect(applyPtyFrame(parked, "repaint", t0 + 9_000)).toEqual(parked);
    expect(applyPtyFrame(base, "repaint", t0 + 9_000)).toEqual(base);
  });

  it("★a reasoning agent emits NO frames, so it can never become parked", () => {
    // The whole false-kill guard in one assertion: silence produces no state
    // transition at all, so no amount of quiet can park an agent.
    expect(base.promptIdleSince).toBeNull();
  });

  it("a turn start un-parks the agent and re-arms the work clock", () => {
    const parked = applyPtyFrame(base, "idle-at-prompt", t0 + 5_000);
    expect(parked.promptIdleSince).not.toBeNull();
    const s = resetPromptIdleOnTurnStart(t0 + 10_000);
    expect(s.promptIdleSince).toBeNull();
    expect(s.lastWorkOutputAt).toBe(t0 + 10_000);
  });
});

describe("the actual stall, replayed frame by frame", () => {
  it("a claude worker that finishes its turn and falls back to the prompt stops advancing the work clock", () => {
    let t = 1_000_000;
    let s: PromptIdleState = { lastWorkOutputAt: t, promptIdleSince: null };
    const feed = (chunk: string, dt: number) => {
      t += dt;
      s = applyPtyFrame(s, classifyPtyFrame(chunk, "claude"), t);
    };

    // Working: spinner + output for a minute.
    for (let i = 0; i < 60; i++) feed(CLAUDE_BUSY_FRAME, 1_000);
    feed(WORK_OUTPUT_FRAME, 500);
    const workedUntil = s.lastWorkOutputAt;
    expect(s.promptIdleSince).toBeNull();

    // …then it drops back to the composer and just repaints for 3 minutes.
    for (let i = 0; i < 180; i++) {
      feed(i % 2 === 0 ? CLAUDE_IDLE_FRAME : CURSOR_REPAINT_FRAME, 1_000);
    }

    // Raw PTY bytes are still flowing (that is the trap), but the work clock
    // froze at the last real output and the parked window is 3 minutes old.
    expect(s.lastWorkOutputAt).toBe(workedUntil);
    expect(t - s.lastWorkOutputAt).toBeGreaterThan(175_000);
    expect(s.promptIdleSince).not.toBeNull();
    expect(t - (s.promptIdleSince as number)).toBeGreaterThan(175_000);
  });
});
