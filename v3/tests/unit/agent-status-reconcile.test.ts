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
  isTurnEndingStatus,
  TURN_COMPLETE_SETTLE_MS,
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

  it("resumes promoting once the settle window elapses (genuine new work)", () => {
    expect(
      shouldPromoteOnPtyOutput({
        status: "idle",
        stopRequested: false,
        turnCompletedAt: NOW - TURN_COMPLETE_SETTLE_MS - 1,
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
