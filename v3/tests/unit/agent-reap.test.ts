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
  isCompletedReportTaskStatus,
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

describe("isCompletedReportTaskStatus", () => {
  it("includes submit/DONE/FAILED/BLOCKED — the statuses that free the agent", () => {
    for (const s of ["DONE", "FAILED", "REVIEW", "BLOCKED"]) {
      expect(isCompletedReportTaskStatus(s)).toBe(true);
    }
  });

  it("excludes live work statuses", () => {
    for (const s of ["TODO", "CLAIMED", "IN_PROGRESS", null, undefined, ""]) {
      expect(isCompletedReportTaskStatus(s)).toBe(false);
    }
  });
});

/**
 * ★★ THE TEST THAT MATTERS MOST.
 *
 * This change widens what can be reaped, and reaping kills a live CLI process —
 * an over-reap destroys the user's in-flight work, while an under-reap only
 * leaves a process to clean up later. Proving we DON'T kill live agents is
 * therefore more important than proving we do kill dead ones.
 *
 * Below: every shape of genuinely-live agent we could plausibly encounter,
 * asserted to survive. If a future widening of the gate breaks one of these,
 * that is a data-loss bug, not a test that needs updating.
 */
describe("★ over-reap safety — no live agent is ever reaped", () => {
  const LIVE_TASK_STATUSES = ["TODO", "CLAIMED", "IN_PROGRESS", "REVIEW"];

  it("never reaps an agent on a live task, at ANY silence duration", () => {
    // The critical interaction with the status fix: a reasoning agent is
    // PTY-silent. Silence must never, on its own, make an agent reapable.
    const silences = [0, 60_000, 5 * 60 * 1000, 60 * 60 * 1000, 86_400_000];
    for (const taskStatus of LIVE_TASK_STATUSES) {
      for (const silentMs of silences) {
        const d = evaluateTerminalTaskReap({
          currentTaskId: "t-live",
          taskStatus,
          lastPtyActivity: NOW - silentMs,
          now: NOW,
        });
        expect(
          d.reap,
          `reaped a live ${taskStatus} agent silent for ${silentMs}ms`,
        ).toBe(false);
      }
    }
  });

  it("never reaps on an unresolvable task status, however long it has been quiet", () => {
    // A board lookup failure must fail SAFE. Treating "I couldn't check" as
    // "it's done" would reap live agents during any Firestore hiccup.
    for (const taskStatus of [null, undefined, "", "WEIRD_NEW_STATUS"]) {
      for (const taskId of [
        { currentTaskId: "t", lastTaskId: null },
        { currentTaskId: null, lastTaskId: "t" },
      ]) {
        const d = evaluateTerminalTaskReap({
          ...taskId,
          taskStatus,
          lastPtyActivity: NOW - 86_400_000,
          now: NOW,
        });
        expect(d.reap).toBe(false);
      }
    }
  });

  it("never reaps an agent that has no task evidence at all", () => {
    // "Unbound and quiet" is NOT proof of finished work — it also describes an
    // agent still starting up, or one whose binding was never recorded. The
    // ticket proposed reaping these; we deliberately report them instead.
    for (const silentMs of [0, 60 * 60 * 1000, 86_400_000]) {
      const d = evaluateTerminalTaskReap({
        currentTaskId: null,
        lastTaskId: null,
        taskStatus: null,
        lastPtyActivity: NOW - silentMs,
        now: NOW,
      });
      expect(d.reap).toBe(false);
    }
  });

  it("never reaps the orchestrator under any combination", () => {
    for (const taskStatus of [...LIVE_TASK_STATUSES, "DONE", "FAILED", null]) {
      for (const binding of [
        { currentTaskId: "t", lastTaskId: null },
        { currentTaskId: null, lastTaskId: "t" },
        { currentTaskId: null, lastTaskId: null },
      ]) {
        const d = evaluateTerminalTaskReap({
          role: "orchestrator",
          ...binding,
          taskStatus,
          lastPtyActivity: NOW - 86_400_000,
          now: NOW,
        });
        expect(d.reap).toBe(false);
      }
    }
  });

  it("requires BOTH terminal status and past-grace silence — never just one", () => {
    // Terminal task but still emitting → preserve.
    expect(
      evaluateTerminalTaskReap({
        currentTaskId: "t",
        taskStatus: "DONE",
        lastPtyActivity: WITHIN_GRACE,
        now: NOW,
      }).reap,
    ).toBe(false);
    // Long silent but task still live → preserve.
    expect(
      evaluateTerminalTaskReap({
        currentTaskId: "t",
        taskStatus: "IN_PROGRESS",
        lastPtyActivity: PAST_GRACE,
        now: NOW,
      }).reap,
    ).toBe(false);
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

  it("preserves an unbound agent with no completed turn behind it", () => {
    // No currentTaskId AND no lastTaskId — this agent has never been bound to
    // anything, so nothing proves its work is done. taskStatus is irrelevant
    // here (there is no task to have that status).
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      lastTaskId: null,
      taskStatus: "DONE",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("no connected or completed task");
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

describe("evaluateTerminalTaskReap — reaping a cleanly-completed agent (the load-44 bug)", () => {
  // Regression: markTurnComplete clears currentTaskId on the worker's own
  // completion report — the very event that makes the agent reapable. The gate
  // required currentTaskId, so an agent that finished CLEANLY became
  // permanently unreapable: 11 of 13 stranded, cleanup_agents answering "no
  // reapable agents found" while a 12-core box sat at load average 44.
  // lastTaskId retains the evidence the binding release used to destroy.

  it("reaps an agent whose RETAINED task is DONE and PTY has gone quiet", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: null, // cleared by markTurnComplete
      lastTaskId: "t-reported-done",
      taskStatus: "DONE",
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(true);
    expect(d.reason).toContain("t-reported-done");
    expect(d.reason).toContain("completed task");
  });

  it("still re-checks the board — a retained task back in live work is preserved", () => {
    // The fallback recovers evidence; it does not lower the bar. If the task
    // the agent reported on is somehow back in flight, the agent stays.
    for (const taskStatus of ["IN_PROGRESS", "TODO", "CLAIMED"]) {
      const d = evaluateTerminalTaskReap({
        currentTaskId: null,
        lastTaskId: "t-reopened",
        taskStatus,
        lastPtyActivity: PAST_GRACE,
        now: NOW,
      });
      expect(d.reap).toBe(false);
      expect(d.reason).toContain("not terminal");
    }
  });

  it("reaps a released binding whose board status is REVIEW/BLOCKED (completion report)", () => {
    // submit_for_review → REVIEW; update_task_status(BLOCKED) → BLOCKED. Both
    // free the agent via markTurnComplete. Holding them forever was the
    // waiting-notif spam + unreapable zombie combo.
    for (const taskStatus of ["REVIEW", "BLOCKED"]) {
      const d = evaluateTerminalTaskReap({
        currentTaskId: null,
        lastTaskId: "t-submitted",
        taskStatus,
        lastPtyActivity: PAST_GRACE,
        lastWorkOutput: PAST_GRACE,
        now: NOW,
      });
      expect(d.reap, `should reap viaCompletedTurn + ${taskStatus}`).toBe(true);
    }
  });

  it("does NOT reap a LIVE binding still held on a REVIEW task", () => {
    // Unusual — markTurnComplete normally releases — but if somehow still
    // bound, REVIEW must not kill mid-hand-back.
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-review",
      lastTaskId: "t-review",
      taskStatus: "REVIEW",
      lastPtyActivity: PAST_GRACE,
      lastWorkOutput: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
  });

  it("reaps on turnCompletedAt alone even when never bound (completion stamp)", () => {
    // Agents that reported done without a retained lastTaskId used to show up
    // as "never bound to a task" suspects forever.
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      lastTaskId: null,
      taskStatus: null,
      turnCompletedAt: NOW - 60_000,
      lastPtyActivity: NOW, // prompt still repainting
      lastWorkOutput: PAST_GRACE, // but real work stopped
      now: NOW,
    });
    expect(d.reap).toBe(true);
    expect(d.reason).toContain("completion reported");
  });

  it("ignores prompt-repaint noise when lastWorkOutput is stale", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      lastTaskId: "t-done",
      taskStatus: "DONE",
      lastPtyActivity: WITHIN_GRACE, // repaint keeps this fresh
      lastWorkOutput: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(true);
  });

  it("preserves a completion-stamped agent whose retained task is live again", () => {
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      lastTaskId: "t-reopened",
      taskStatus: "IN_PROGRESS",
      turnCompletedAt: NOW - 60_000,
      lastPtyActivity: PAST_GRACE,
      lastWorkOutput: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("live");
  });

  it("preserves a retained-task agent that is still emitting (within grace)", () => {
    // Just reported DONE and still writing its closing summary — reaping here
    // would rug-pull it mid-sentence.
    const d = evaluateTerminalTaskReap({
      currentTaskId: null,
      lastTaskId: "t-just-reported",
      taskStatus: "DONE",
      lastPtyActivity: WITHIN_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("grace");
  });

  it("preserves when the retained task can't be resolved", () => {
    for (const taskStatus of [null, undefined, "MYSTERY"]) {
      const d = evaluateTerminalTaskReap({
        currentTaskId: null,
        lastTaskId: "t-gone",
        taskStatus,
        lastPtyActivity: PAST_GRACE,
        now: NOW,
      });
      expect(d.reap).toBe(false);
    }
  });

  it("prefers the LIVE binding over the retained one", () => {
    // Agent finished t-old, then got dispatched t-new which is still running.
    // Reaping on the stale retained id would kill an actively working agent.
    const d = evaluateTerminalTaskReap({
      currentTaskId: "t-new",
      lastTaskId: "t-old",
      taskStatus: "IN_PROGRESS", // status of t-new, the live one
      lastPtyActivity: PAST_GRACE,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("t-new");
    expect(d.reason).not.toContain("t-old");
  });

  it("never reaps the orchestrator via the retained-task path either", () => {
    const d = evaluateTerminalTaskReap({
      role: "orchestrator",
      currentTaskId: null,
      lastTaskId: "t-done",
      taskStatus: "DONE",
      lastPtyActivity: NOW - STALE_TERMINAL_REAP_MS * 100,
      now: NOW,
    });
    expect(d.reap).toBe(false);
    expect(d.reason).toContain("orchestrator");
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
