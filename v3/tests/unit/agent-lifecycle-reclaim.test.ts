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
  AGENT_HEARTBEAT_STALE_MS,
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

// ────────────────────────────────────────────────────────────────────────────
// 에이전트 자신의 heartbeat 축 — 티켓 nzkdcE7W6P2uGYqCa3rU (진단 §5.3-a)
//
// 문제였던 것: liveness 를 **에이전트가 아니라 Electron 인스턴스 pid** 로 판정했다.
// 그래서 앱이 안 죽으면 에이전트가 죽어도 pid 는 살아 있고, 고아 문서는 영원히
// 회수되지 않았다(실측: 9시간). instancePid 는 에이전트의 pid 가 아니다.
//
// 고친 것: 에이전트 **자신의** heartbeat(lastHeartbeatAtMs = 그 에이전트의 MCP 툴
// 호출이 서버에 닿은 시각)를 본다. 넓히는 방향으로는 딱 한 곳(pid 살아있음 갈래)
// 에서만, 좁히는 방향으로는 어디서나 쓰인다.
//
// ★가장 중요한 것은 반대방향이다: 살아 있는 에이전트의 작업은 어떤 경우에도
//   회수되지 않는다. 잘못 회수하면 돌고 있는 에이전트의 작업이 중간에 뺏긴다.
// ────────────────────────────────────────────────────────────────────────────
describe("evaluateGhostReclaim — 에이전트 자신의 heartbeat", () => {
  describe("★반대방향: 살아 있는 에이전트의 티켓은 절대 회수되지 않는다", () => {
    it("heartbeat 가 최근이면 pid 가 살아 있는 다른 인스턴스 문서를 건드리지 않는다", () => {
      const d = evaluateGhostReclaim(
        base({
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - 60_000, // 1분 전 — 방금 툴콜을 했다
        }),
      );
      expect(d.reclaim).toBe(false);
      expect(d.reason).toContain("heartbeat");
    });

    it("heartbeat 가 임계 직전이면(1ms 차) 여전히 회수하지 않는다", () => {
      const d = evaluateGhostReclaim(
        base({
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - (AGENT_HEARTBEAT_STALE_MS - 1),
        }),
      );
      expect(d.reclaim).toBe(false);
    });

    it("heartbeat 가 최근이면 24h 를 넘긴 레거시(pid 없음) 문서도 건드리지 않는다", () => {
      // 문서의 updatedAt 은 하루 넘게 낡았지만(렌더러가 status 를 안 써 준다),
      // 에이전트 자신은 5분 전에 툴콜을 했다 = 살아 있다.
      const d = evaluateGhostReclaim(
        base({
          instancePid: null,
          lastTouchedAtMs: NOW - 3 * LEGACY_OWN_DOC_AGE_MS,
          lastHeartbeatAtMs: NOW - 5 * 60_000,
        }),
      );
      expect(d.reclaim).toBe(false);
      expect(d.reason).toContain("heartbeat");
    });

    it("이 인스턴스 메모리에 있으면 heartbeat 와 무관하게 회수하지 않는다", () => {
      const d = evaluateGhostReclaim(
        base({
          inMemory: true,
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - 10 * AGENT_HEARTBEAT_STALE_MS,
        }),
      );
      expect(d.reclaim).toBe(false);
      expect(d.reason).toContain("AgentManager");
    });

    it("다른 머신 문서는 heartbeat 가 아무리 낡아도 회수하지 않는다", () => {
      const d = evaluateGhostReclaim(
        base({
          machineId: OTHER_MACHINE,
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - 10 * AGENT_HEARTBEAT_STALE_MS,
        }),
      );
      expect(d.reclaim).toBe(false);
      expect(d.reason).toContain("another machine");
    });

    it("종결 상태(stopped)는 heartbeat 가 낡아도 후보가 아니다", () => {
      const d = evaluateGhostReclaim(
        base({
          status: "stopped",
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - 10 * AGENT_HEARTBEAT_STALE_MS,
        }),
      );
      expect(d.reclaim).toBe(false);
    });
  });

  describe("고친 갈래: 앱은 살아 있는데 에이전트만 죽은 경우", () => {
    it("pid 는 살아 있지만 에이전트 heartbeat 가 임계를 넘겨 끊기면 회수한다", () => {
      const d = evaluateGhostReclaim(
        base({
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - (AGENT_HEARTBEAT_STALE_MS + 60_000),
        }),
      );
      expect(d.reclaim).toBe(true);
      // 사유가 "왜 넘어섰는지"를 말한다.
      expect(d.reason).toContain("heartbeat");
      expect(d.reason).toContain(String(LIVE_PID));
    });

    it("실측 사례 모양(9시간 침묵 · Electron 은 생존)에서 회수된다", () => {
      const d = evaluateGhostReclaim(
        base({
          instancePid: LIVE_PID,
          lastHeartbeatAtMs: NOW - 9 * 60 * 60 * 1000,
        }),
      );
      expect(d.reclaim).toBe(true);
    });
  });

  describe("증거가 없으면 예전 그대로 — 회귀 0", () => {
    it("heartbeat 미관측이면 pid 살아있음 갈래는 여전히 회수하지 않는다", () => {
      for (const hb of [undefined, null, Number.NaN]) {
        const d = evaluateGhostReclaim(
          base({ instancePid: LIVE_PID, lastHeartbeatAtMs: hb }),
        );
        expect(d.reclaim).toBe(false);
        expect(d.reason).toContain("no agent heartbeat observed");
      }
    });

    it("죽은 인스턴스 pid 는 heartbeat 없이도 예전처럼 회수한다", () => {
      const d = evaluateGhostReclaim(base({ instancePid: DEAD_PID }));
      expect(d.reclaim).toBe(true);
      expect(d.reason).toContain("dead instance");
    });

    it("이 인스턴스 pid 인데 메모리에 없으면 heartbeat 와 무관하게 유령이다", () => {
      // 이 갈래는 heartbeat 보다 강한 증거다 — "우리가 찍었는데 우리 메모리에 없다".
      const d = evaluateGhostReclaim(
        base({ instancePid: THIS_PID, lastHeartbeatAtMs: NOW - 1_000 }),
      );
      expect(d.reclaim).toBe(true);
      expect(d.reason).toContain("THIS instance");
    });
  });
});
