/**
 * Unit tests for the stale-agent reap decision (agent-reap.ts).
 *
 * Regression: cleanup_agents only reclaimed agents whose PTY had died
 * (stopped/error), so an agent that FINISHED its task — task DONE/FAILED on the
 * board — but whose CLI still sat at its prompt stayed alive forever (57 had to
 * be hand-killed in one session). evaluateTerminalTaskReap() is the gate that
 * now reaps those zombies, while never misjudging a genuinely-working agent.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateTerminalTaskReap,
  isTerminalTaskStatus,
  STALE_TERMINAL_REAP_MS,
} from "../../electron/mcp-server/agent-reap";

const NOW = 1_000_000_000_000;
const PAST_GRACE = NOW - STALE_TERMINAL_REAP_MS - 1; // idle just past the window
const WITHIN_GRACE = NOW - 1_000; // active 1s ago

describe("isTerminalTaskStatus", () => {
  it("treats DONE and FAILED as terminal", () => {
    expect(isTerminalTaskStatus("DONE")).toBe(true);
    expect(isTerminalTaskStatus("FAILED")).toBe(true);
  });

  it("treats every in-flight / unknown status as non-terminal", () => {
    for (const s of [
      "TODO",
      "CLAIMED",
      "IN_PROGRESS",
      "REVIEW",
      "BLOCKED",
      null,
      undefined,
      "",
    ]) {
      expect(isTerminalTaskStatus(s)).toBe(false);
    }
  });
});

describe("evaluateTerminalTaskReap — reap branch", () => {
  it("reaps an agent on a DONE task that has been PTY-idle past the grace window", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-done",
      taskStatus: "DONE",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(true);
    expect(d.reason).toContain("t-done");
    expect(d.reason).toContain("DONE");
  });

  it("reaps an agent on a FAILED task that is idle past the grace window", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-failed",
      taskStatus: "FAILED",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(true);
  });

  it("reaps exactly at the grace boundary (idle === staleMs)", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-edge",
      taskStatus: "DONE",
      lastPtyActivity: NOW - STALE_TERMINAL_REAP_MS,
      now: NOW,
    });
    expect(d.reap).toBe(true);
  });
});

describe("evaluateTerminalTaskReap — preserve branch (never misjudge live work)", () => {
  it("preserves an agent whose task is still IN_PROGRESS, even if long idle", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-live",
      taskStatus: "IN_PROGRESS",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("not terminal");
  });

  it("preserves an agent on a terminal task that is still actively emitting PTY (within grace)", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-just-done",
      taskStatus: "DONE",
      lastPtyActivity: WITHIN_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("grace");
  });

  it("preserves an unbound agent (no connected task)", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      taskStatus: "DONE",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("no connected task");
  });

  it("preserves when the task status could not be resolved (null/unknown)", () => {
    for (const taskStatus of [null, undefined, "MYSTERY"]) {
      const d = evaluateTerminalTaskReap({
        currentTaskId: "t-unknown",
        taskStatus,
        lastPtyActivity: PAST_GRACE,
        now: NOW,
      });
      expect(d.reap).toBe(false);
    }
  });

  it("honors a custom staleMs override", () => {
    // Idle 2s; default window would preserve, but a 1s window reaps.
    const base = {
      currentTaskId: "t-custom",
      taskStatus: "DONE" as const,
      lastPtyActivity: NOW - 2_000,
      now: NOW,
    };
    expect(evaluateTerminalTaskReap({ ...base }).reap).toBe(false);
    expect(evaluateTerminalTaskReap({ ...base, staleMs: 1_000 }).reap).toBe(
      true,
    );
  });
});

describe("evaluateTerminalTaskReap — orchestrator is never auto-reaped", () => {
  // Regression: a working orchestrator vanished from get_agents + its terminal
  // tab mid-session. Root cause — the orchestrator is a long-lived singleton
  // coordinator that legitimately sits PTY-silent while waiting on its
  // subagents to report back. When it stayed bound (currentTaskId) to a task it
  // had just driven to DONE/FAILED, cleanup_agents Pass 2 mistook it for a
  // finished zombie and killed it (/kill-agent → remove + agent:deleted). The
  // role guard below makes role==='orchestrator' unconditionally preserved, so
  // no terminal-task + idle combination can ever rug-pull it.

  it("preserves an orchestrator on a DONE task past the grace window", () => {
    const d = evaluateTerminalTaskReap({
      role: "orchestrator",
      currentTaskId: "t-done",
      taskStatus: "DONE",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("orchestrator");
  });

  it("preserves an orchestrator on a FAILED task even when long idle", () => {
    const d = evaluateTerminalTaskReap({
      role: "orchestrator",
      currentTaskId: "t-failed",
      taskStatus: "FAILED",
      lastPtyActivity: NOW - STALE_TERMINAL_REAP_MS * 100,
      now: NOW,
    });
    expect(d.reap).toBe(false);
  });

  it("still reaps a NON-orchestrator worker under the same terminal+idle conditions", () => {
    // Guards the guard: the role exclusion must not disable zombie cleanup for
    // ordinary workers (the original 57-zombie problem).
    for (const role of ["backend", "frontend", undefined]) {
      const d = evaluateTerminalTaskReap({
        role,
        currentTaskId: "t-done",
        taskStatus: "DONE",
        lastPtyActivity: PAST_GRACE,
        now: NOW,
      });
      expect(d.reap).toBe(true);
    }
  });
});
