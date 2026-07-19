/**
 * Unit tests for the ghost-agent / worktree-sweep reclaim decisions
 * (agent-lifecycle-reclaim.ts).
 *
 * Regression: 1,057 accumulated `agents/` docs, 28 of them stuck at
 * `status: "working"` from previous Electron instances (renderer-only status
 * writes die with the app; cleanup_agents only scans in-memory agents). The
 * reclaim gate must catch exactly those ghosts while NEVER touching a live
 * agent of another machine or another Electron instance on this machine.
 */

import { describe, it, expect } from "vitest";
import {
  evaluateGhostReclaim,
  isReclaimableAgentStatus,
  LEGACY_OWN_DOC_AGE_MS,
  parseWorktreeTaskPath,
  deriveRepoRootFromGitFile,
  isWorktreeSweepEligibleTaskStatus,
  evaluateAccumulationAlert,
  ACCUMULATION_ALERT_DEDUPE_MS,
} from "../../electron/agent-lifecycle-reclaim";

const NOW = 1_800_000_000_000;
const THIS_MACHINE = "macmini-darwin-uuid";
const OTHER_MACHINE = "macbook-darwin-uuid";
const THIS_PID = 4242;
const DEAD_PID = 999;
const LIVE_PID = 555;

function base(over: Partial<Parameters<typeof evaluateGhostReclaim>[0]> = {}) {
  return {
    status: "working" as unknown,
    machineId: THIS_MACHINE as string | null | undefined,
    instancePid: DEAD_PID as number | null | undefined,
    role: "backend" as string | null | undefined,
    lastTouchedAtMs: NOW - 2 * LEGACY_OWN_DOC_AGE_MS,
    thisMachineId: THIS_MACHINE,
    thisPid: THIS_PID,
    inMemory: false,
    isPidAlive: (pid: number) => pid === LIVE_PID || pid === THIS_PID,
    now: NOW,
    ...over,
  };
}

describe("isReclaimableAgentStatus", () => {
  it("only working/idle are candidates", () => {
    expect(isReclaimableAgentStatus("working")).toBe(true);
    expect(isReclaimableAgentStatus("idle")).toBe(true);
    for (const s of ["stopped", "error", "", null, undefined, 3]) {
      expect(isReclaimableAgentStatus(s)).toBe(false);
    }
  });
});

describe("evaluateGhostReclaim — never touch live agents", () => {
  it("skips docs already terminal", () => {
    for (const status of ["stopped", "error"]) {
      const d = evaluateGhostReclaim(base({ status }));
      expect(d.reclaim).toBe(false);
    }
  });

  it("skips agents live in this instance's memory", () => {
    const d = evaluateGhostReclaim(base({ inMemory: true }));
    expect(d.reclaim).toBe(false);
    expect(d.reason).toMatch(/live/);
  });

  it("skips unstamped (legacy, possibly-foreign) docs entirely", () => {
    for (const machineId of [null, undefined, ""]) {
      const d = evaluateGhostReclaim(base({ machineId }));
      expect(d.reclaim).toBe(false);
      expect(d.reason).toMatch(/unstamped/);
    }
  });

  it("skips foreign-machine docs even when everything else screams ghost", () => {
    const d = evaluateGhostReclaim(
      base({ machineId: OTHER_MACHINE, instancePid: DEAD_PID }),
    );
    expect(d.reclaim).toBe(false);
    expect(d.reason).toMatch(/another machine/);
  });

  it("skips own docs whose instance pid is still alive (dev+prod side-by-side)", () => {
    const d = evaluateGhostReclaim(base({ instancePid: LIVE_PID }));
    expect(d.reclaim).toBe(false);
    expect(d.reason).toMatch(/alive/);
  });
});

describe("evaluateGhostReclaim — the ghosts it must catch", () => {
  it("reclaims own doc stamped by THIS instance but absent from memory", () => {
    const d = evaluateGhostReclaim(base({ instancePid: THIS_PID }));
    expect(d.reclaim).toBe(true);
    expect(d.reason).toMatch(/THIS instance/);
  });

  it("reclaims own doc stamped by a dead previous instance", () => {
    const d = evaluateGhostReclaim(base({ instancePid: DEAD_PID }));
    expect(d.reclaim).toBe(true);
    expect(d.reason).toMatch(/dead instance/);
  });

  it("reclaims idle ghosts too, not only working", () => {
    const d = evaluateGhostReclaim(
      base({ status: "idle", instancePid: DEAD_PID }),
    );
    expect(d.reclaim).toBe(true);
  });
});

describe("evaluateGhostReclaim — legacy own docs (no instancePid)", () => {
  it("reclaims only past the 24h age gate", () => {
    const old = evaluateGhostReclaim(
      base({
        instancePid: null,
        lastTouchedAtMs: NOW - LEGACY_OWN_DOC_AGE_MS - 1,
      }),
    );
    expect(old.reclaim).toBe(true);

    const young = evaluateGhostReclaim(
      base({
        instancePid: null,
        lastTouchedAtMs: NOW - LEGACY_OWN_DOC_AGE_MS + 60_000,
      }),
    );
    expect(young.reclaim).toBe(false);
  });

  it("never reclaims a legacy orchestrator doc", () => {
    const d = evaluateGhostReclaim(
      base({
        instancePid: null,
        role: "orchestrator",
        lastTouchedAtMs: NOW - 10 * LEGACY_OWN_DOC_AGE_MS,
      }),
    );
    expect(d.reclaim).toBe(false);
    expect(d.reason).toMatch(/orchestrator/);
  });

  it("skips when staleness cannot be proven (no timestamps)", () => {
    const d = evaluateGhostReclaim(
      base({ instancePid: null, lastTouchedAtMs: null }),
    );
    expect(d.reclaim).toBe(false);
  });

  it("honors a custom age gate override", () => {
    const d = evaluateGhostReclaim(
      base({
        instancePid: null,
        lastTouchedAtMs: NOW - 90_000,
        legacyAgeMs: 60_000,
      }),
    );
    expect(d.reclaim).toBe(true);
  });
});

describe("long-run simulation — ghosts stop accumulating across restarts", () => {
  interface Doc {
    status: string;
    machineId: string;
    instancePid: number;
  }

  it("every boot sweep clears all previous instances' docs; live docs survive", () => {
    const docs: Doc[] = [];
    const AGENTS_PER_INSTANCE = 5;
    const INSTANCES = 10;

    for (let i = 1; i <= INSTANCES; i++) {
      const pid = 1000 + i;
      // This instance spawns agents (docs written at working, stamped).
      for (let a = 0; a < AGENTS_PER_INSTANCE; a++) {
        docs.push({ status: "working", machineId: THIS_MACHINE, instancePid: pid });
      }
      // App dies without finalizing (the incident path), next instance boots
      // and runs the sweep. Only the CURRENT instance's pids are alive.
      const bootPid = 1000 + i; // sweep runs inside instance i itself next boot
      for (const d of docs) {
        const decision = evaluateGhostReclaim({
          status: d.status,
          machineId: d.machineId,
          instancePid: d.instancePid,
          role: "backend",
          lastTouchedAtMs: NOW,
          thisMachineId: THIS_MACHINE,
          thisPid: bootPid,
          // Live agents of the current instance are in AgentManager memory.
          inMemory: d.instancePid === bootPid,
          isPidAlive: (pid) => pid === bootPid,
          now: NOW,
        });
        if (decision.reclaim) d.status = "stopped";
      }
      // Invariant: after each sweep, the only docs still claiming live work
      // belong to the running instance — ghost count is zero.
      const ghosts = docs.filter(
        (d) => d.status === "working" && d.instancePid !== bootPid,
      );
      expect(ghosts).toHaveLength(0);
    }

    // 10 restarts later: exactly one instance's worth of docs is "working".
    expect(docs.filter((d) => d.status === "working")).toHaveLength(
      AGENTS_PER_INSTANCE,
    );
  });
});

describe("parseWorktreeTaskPath", () => {
  const ROOT = "/Users/u/.marblo/worktrees";

  it("parses the canonical <root>/<projectId>/<taskId> layout", () => {
    expect(parseWorktreeTaskPath(ROOT, `${ROOT}/proj1/taskA`, "/")).toEqual({
      projectId: "proj1",
      taskId: "taskA",
    });
  });

  it("tolerates a trailing separator on the root", () => {
    expect(parseWorktreeTaskPath(`${ROOT}/`, `${ROOT}/p/t`, "/")).toEqual({
      projectId: "p",
      taskId: "t",
    });
  });

  it("rejects paths outside the root, wrong depth, and the root itself", () => {
    expect(parseWorktreeTaskPath(ROOT, "/tmp/other/p/t", "/")).toBeNull();
    expect(parseWorktreeTaskPath(ROOT, `${ROOT}/p`, "/")).toBeNull();
    expect(parseWorktreeTaskPath(ROOT, `${ROOT}/p/t/nested`, "/")).toBeNull();
    expect(parseWorktreeTaskPath(ROOT, ROOT, "/")).toBeNull();
  });

  it("rejects a sibling dir whose name merely starts with the root", () => {
    expect(
      parseWorktreeTaskPath(ROOT, `${ROOT}-backup/p/t`, "/"),
    ).toBeNull();
  });
});

describe("deriveRepoRootFromGitFile", () => {
  it("derives the repo root from a linked worktree .git file", () => {
    expect(
      deriveRepoRootFromGitFile(
        "gitdir: /Users/u/code/Marblo/.git/worktrees/task-1\n",
      ),
    ).toBe("/Users/u/code/Marblo");
  });

  it("returns null for non-worktree gitdirs and garbage", () => {
    expect(deriveRepoRootFromGitFile("gitdir: /repo/.git/modules/sub")).toBeNull();
    expect(deriveRepoRootFromGitFile("ref: refs/heads/main")).toBeNull();
    expect(deriveRepoRootFromGitFile("")).toBeNull();
  });
});

describe("isWorktreeSweepEligibleTaskStatus", () => {
  it("only DONE/FAILED tasks free their worktree", () => {
    expect(isWorktreeSweepEligibleTaskStatus("DONE")).toBe(true);
    expect(isWorktreeSweepEligibleTaskStatus("FAILED")).toBe(true);
    for (const s of ["TODO", "CLAIMED", "IN_PROGRESS", "REVIEW", "BLOCKED", null]) {
      expect(isWorktreeSweepEligibleTaskStatus(s)).toBe(false);
    }
  });
});

describe("evaluateAccumulationAlert", () => {
  const counts = { agentDocs: 1057, worktrees: 696 };

  it("alerts when any count exceeds its threshold", () => {
    const d = evaluateAccumulationAlert({
      counts,
      lastAlertAtMs: null,
      now: NOW,
    });
    expect(d.alert).toBe(true);
    expect(d.message).toMatch(/1057/);
    expect(d.message).toMatch(/696/);
  });

  it("stays silent under thresholds and for unreadable (null) counts", () => {
    expect(
      evaluateAccumulationAlert({
        counts: { agentDocs: 10, worktrees: 5 },
        lastAlertAtMs: null,
        now: NOW,
      }).alert,
    ).toBe(false);
    expect(
      evaluateAccumulationAlert({
        counts: { agentDocs: null, worktrees: null },
        lastAlertAtMs: null,
        now: NOW,
      }).alert,
    ).toBe(false);
  });

  it("dedupes to one alert per 24h window", () => {
    const recent = evaluateAccumulationAlert({
      counts,
      lastAlertAtMs: NOW - ACCUMULATION_ALERT_DEDUPE_MS + 1000,
      now: NOW,
    });
    expect(recent.alert).toBe(false);

    const stale = evaluateAccumulationAlert({
      counts,
      lastAlertAtMs: NOW - ACCUMULATION_ALERT_DEDUPE_MS - 1000,
      now: NOW,
    });
    expect(stale.alert).toBe(true);
  });
});
