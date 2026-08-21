/**
 * W1 — agent status reconcile. Verifies the pure decision logic that keeps a
 * finished agent from being stranded at [working] by its own trailing turn
 * output (the stale-slot bug: qa-freshuser / onboarding-cli-gate /
 * web-guide-page all stuck [working] after completing).
 */
import { describe, it, expect } from "vitest";
import {
  shouldPromoteOnPtyOutput,
  shouldDemoteCompletedTurn,
  shouldDemoteAbandonedTurn,
  isTurnEndingStatus,
  TURN_COMPLETE_SETTLE_MS,
  ABANDONED_TURN_MS,
} from "../../electron/agent-status-reconcile";

const NOW = 1_000_000_000_000;

describe("shouldPromoteOnPtyOutput", () => {
  it("promotes an idle agent with no completed turn (normal case)", () => {
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("SUPPRESSES promotion within the settle window after a completed turn", () => {
    // Trailing render flush 1s after submit_for_review → must NOT re-promote.
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: NOW - 1_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  // CHANGED 2026-07-19: promotion used to resume once the 12s settle window
  // elapsed. That merely delayed the stranding — a finished CLI repaints its
  // prompt spinner forever, so the first chunk after 12s put the agent back at
  // [working] permanently, with nothing able to reap it (11 of 13 agents
  // stranded, load average 44). Output never starts a turn now; only submitted
  // INPUT does, via noteTurnStart clearing turnCompletedAt.
  it("keeps suppressing promotion long after the settle window (repaint is not work)", () => {
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: NOW - TURN_COMPLETE_SETTLE_MS - 1,
        now: NOW,
      }),
    ).toBe(false);
    // An hour of spinner noise still isn't a new turn.
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: NOW - 3_600_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("promotes again once a new turn is submitted (marker cleared)", () => {
    // noteTurnStart sets turnCompletedAt back to null on submitted input —
    // dispatch, reuse, a nudge, or a human pressing Enter. Real follow-up work
    // must flip to `working` immediately.
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: null,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("never promotes a stop-requested or non-idle agent", () => {
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: true,
        turnCompletedAt: null,
        now: NOW,
      }),
    ).toBe(false);
    expect(
      shouldPromoteOnPtyOutput({
        status: "working",
        stopRequested: false,
        turnCompletedAt: null,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("SUPPRESSES promotion while the boot instruction is undelivered", () => {
    // ★A live run typed a 6,447-char instruction into claude's folder-trust
    // dialog; the select list swallowed it, the CLI repainted, and that repaint
    // flipped the agent to `working`. The agent had been told nothing. This is
    // the predicate half of that fix: bytes emitted before the instruction
    // lands are boot chrome — banner, theme picker, trust dialog — never work.
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: null,
        bootPromptPending: true,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("promotes again once the instruction has been delivered", () => {
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: null,
        bootPromptPending: false,
        now: NOW,
      }),
    ).toBe(true);
  });
});

describe("shouldDemoteCompletedTurn", () => {
  it("demotes a working agent whose turn completed and PTY has settled", () => {
    expect(
      shouldDemoteCompletedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: NOW - 30_000,
        lastPtyActivity: NOW - TURN_COMPLETE_SETTLE_MS - 1,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does NOT demote while the PTY is still flushing (within settle)", () => {
    expect(
      shouldDemoteCompletedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: NOW - 30_000,
        lastPtyActivity: NOW - 1_000,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("demotes when lastWorkOutput is stale even if prompt repaint keeps lastPtyActivity fresh", () => {
    expect(
      shouldDemoteCompletedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: NOW - 30_000,
        lastPtyActivity: NOW - 100, // forever-repaint
        lastWorkOutput: NOW - TURN_COMPLETE_SETTLE_MS - 1,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does NOT demote an agent with no completed turn (genuinely working)", () => {
    expect(
      shouldDemoteCompletedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: null,
        lastPtyActivity: NOW - 999_999,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("ignores idle / stopped agents", () => {
    for (const status of ["idle", "stopped", "error"] as const) {
      expect(
        shouldDemoteCompletedTurn({
          status,
          stopRequested: false,
          turnCompletedAt: NOW - 30_000,
          lastPtyActivity: NOW - 60_000,
          now: NOW,
        }),
      ).toBe(false);
    }
  });
});

/**
 * ★ The safety-critical direction. Reporting live work as `idle` is worse than
 * reporting finished work as `working`: the orchestrator hands the "free" agent
 * more work, and any idleness-gated reaper kills a session that is mid-thought,
 * destroying the user's in-flight work. These tests exist to make that
 * regression impossible to reintroduce quietly.
 */
describe("a reasoning agent is NEVER demoted for being silent", () => {
  // An agent doing long inference, a large file read, or a slow MCP round-trip
  // emits NOTHING. The old rule (5 min of PTY silence ⇒ idle) called that idle.
  const silences: Array<[string, number]> = [
    ["30 seconds", 30_000],
    ["5 minutes (the old demotion threshold)", 5 * 60 * 1000],
    ["10 minutes", 10 * 60 * 1000],
    ["44 minutes (just under the wedged backstop)", 44 * 60 * 1000],
  ];

  for (const [label, silentMs] of silences) {
    it(`stays working after ${label} of PTY silence with an open turn`, () => {
      const input = {
        status: "working" as const,
        stopRequested: false,
        turnCompletedAt: null, // no completion report ⇒ turn is still open
        lastPtyActivity: NOW - silentMs,
        now: NOW,
      };
      expect(shouldDemoteCompletedTurn(input)).toBe(false);
      expect(shouldDemoteAbandonedTurn(input)).toBe(false);
    });
  }

  it("demotes only past the wedged-turn backstop, and says so", () => {
    expect(
      shouldDemoteAbandonedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: null,
        lastPtyActivity: NOW - ABANDONED_TURN_MS - 1,
        now: NOW,
      }),
    ).toBe(true);
    // The backstop must stay far above any plausible inference pause.
    expect(ABANDONED_TURN_MS).toBeGreaterThanOrEqual(30 * 60 * 1000);
  });

  it("leaves the completed-turn path to shouldDemoteCompletedTurn", () => {
    // A reported-complete agent is not "abandoned" — it's done. Only one
    // function should own that transition, or the backstop's warning log fires
    // on every normal completion.
    expect(
      shouldDemoteAbandonedTurn({
        status: "working",
        stopRequested: false,
        turnCompletedAt: NOW - 60_000,
        lastPtyActivity: NOW - ABANDONED_TURN_MS - 1,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("never touches a stop-requested or already-terminal agent", () => {
    for (const status of ["idle", "stopped", "error"] as const) {
      expect(
        shouldDemoteAbandonedTurn({
          status,
          stopRequested: false,
          turnCompletedAt: null,
          lastPtyActivity: NOW - ABANDONED_TURN_MS - 1,
          now: NOW,
        }),
      ).toBe(false);
    }
    expect(
      shouldDemoteAbandonedTurn({
        status: "working",
        stopRequested: true,
        turnCompletedAt: null,
        lastPtyActivity: NOW - ABANDONED_TURN_MS - 1,
        now: NOW,
      }),
    ).toBe(false);
  });
});

describe("isTurnEndingStatus", () => {
  it("treats REVIEW/DONE/FAILED/BLOCKED as turn-ending", () => {
    for (const s of ["REVIEW", "DONE", "FAILED", "BLOCKED"]) {
      expect(isTurnEndingStatus(s)).toBe(true);
    }
  });
  it("treats in-flight statuses as non-ending", () => {
    for (const s of ["TODO", "CLAIMED", "IN_PROGRESS", "", null, undefined]) {
      expect(isTurnEndingStatus(s)).toBe(false);
    }
  });
});
