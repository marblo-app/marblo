/**
 * agent-stall-policy — 워치독·dispatch·정체 레인이 공유하는 정지 의심 정책.
 *
 * 고정하는 것:
 *   · 우선순위별 임계(P4+ 20분 / 그 외 45분)와 env 덮어쓰기
 *   · 보드 활동만으로 quiet 판정(PTY 는 안 본다) + 기준 없으면 quiet 아님
 *   · PTY 상태 설명 분류(busy/parked/awaiting-input/silent/dead/missing)
 *   · 바운드 에이전트 stale 판정 — "활동 1건이라도 있으면 영구 live" 가 더는 아니다
 *   · 풀려난 선임은 후임의 live worker 가 아니다(isOtherLiveWorkerForTask)
 */
import { describe, expect, it } from "vitest";
import {
  DEFAULT_STALL_POLICY,
  STALL_FIRST_ACTIVITY_QUIET_MS,
  STALL_QUIET_NORMAL_MS,
  STALL_QUIET_URGENT_MS,
  classifyPtyLiveness,
  evaluateBoardQuiet,
  evaluateBoundAgent,
  evaluateExitQuiet,
  evaluateFirstActivityQuiet,
  isOtherLiveWorkerForTask,
  quietThresholdMs,
  resolveStallPolicy,
  stallTier,
} from "../../electron/agent-stall-policy";

const MIN = 60_000;
const NOW = 10_000_000;

describe("stall policy — thresholds", () => {
  it("P4/P5 are urgent (20m), P1–P3 and unknown are normal (45m)", () => {
    expect(stallTier(5)).toBe("urgent");
    expect(stallTier(4)).toBe("urgent");
    expect(stallTier(3)).toBe("normal");
    expect(stallTier(1)).toBe("normal");
    expect(stallTier(null)).toBe("normal");
    expect(stallTier(undefined)).toBe("normal");
    expect(quietThresholdMs(5)).toBe(STALL_QUIET_URGENT_MS);
    expect(quietThresholdMs(2)).toBe(STALL_QUIET_NORMAL_MS);
    expect(STALL_QUIET_URGENT_MS).toBe(20 * MIN);
    expect(STALL_QUIET_NORMAL_MS).toBe(45 * MIN);
  });

  it("env overrides each knob; garbage falls back to defaults", () => {
    const p = resolveStallPolicy({
      MARBLO_STALL_QUIET_URGENT_MS: "600000",
      MARBLO_STALL_QUIET_NORMAL_MS: "abc",
      MARBLO_STALL_REPEAT_MS: "-1",
      MARBLO_STALL_URGENT_PRIORITY_MIN: "3",
    });
    expect(p.quietUrgentMs).toBe(600_000);
    expect(p.quietNormalMs).toBe(DEFAULT_STALL_POLICY.quietNormalMs);
    expect(p.repeatMs).toBe(DEFAULT_STALL_POLICY.repeatMs);
    expect(p.urgentPriorityMin).toBe(3);
    expect(stallTier(3, p)).toBe("urgent");
  });

  it("first-activity axis defaults to 5m and is env-overridable", () => {
    expect(STALL_FIRST_ACTIVITY_QUIET_MS).toBe(5 * MIN);
    expect(DEFAULT_STALL_POLICY.firstActivityQuietMs).toBe(5 * MIN);
    const p = resolveStallPolicy({ MARBLO_STALL_FIRST_ACTIVITY_MS: "180000" });
    expect(p.firstActivityQuietMs).toBe(180_000);
    const garbage = resolveStallPolicy({
      MARBLO_STALL_FIRST_ACTIVITY_MS: "not-a-number",
    });
    expect(garbage.firstActivityQuietMs).toBe(
      DEFAULT_STALL_POLICY.firstActivityQuietMs,
    );
  });
});

describe("evaluateFirstActivityQuiet — 'never reported once, ever' only", () => {
  it("★스폰 후 6분간 활동 0건(임계 5분) → 신호, 20/45분 임계와 무관", () => {
    const v = evaluateFirstActivityQuiet({
      now: NOW,
      lastBoardActivityMs: null,
      activeSinceMs: NOW - 6 * MIN,
    });
    expect(v.quiet).toBe(true);
    expect(v.ageMs).toBe(6 * MIN);
    expect(v.thresholdMs).toBe(5 * MIN);
  });

  it("임계 전(4분)이면 아직 신호 없음", () => {
    expect(
      evaluateFirstActivityQuiet({
        now: NOW,
        lastBoardActivityMs: null,
        activeSinceMs: NOW - 4 * MIN,
      }).quiet,
    ).toBe(false);
  });

  it("이미 활동 기록이 있으면(재무활동) 이 축은 절대 quiet 로 보지 않는다 — evaluateBoardQuiet 의 몫", () => {
    // Even a VERY old single report keeps this axis silent — it is not the
    // "how long since the last report" axis.
    expect(
      evaluateFirstActivityQuiet({
        now: NOW,
        lastBoardActivityMs: NOW - 999 * MIN,
        activeSinceMs: NOW - 999 * MIN,
      }).quiet,
    ).toBe(false);
  });

  it("기준(activeSinceMs)이 없으면 판정 불가 → quiet 아님 (오판 비용이 더 크다)", () => {
    expect(
      evaluateFirstActivityQuiet({
        now: NOW,
        lastBoardActivityMs: null,
        activeSinceMs: null,
      }).quiet,
    ).toBe(false);
  });
});

describe("evaluateExitQuiet — 사망은 즉시, 추론이 아니라 사실", () => {
  it("★terminalLocal 이면 무활동 나이와 무관하게 즉시 quiet=true, exitCode 를 싣는다", () => {
    const v = evaluateExitQuiet({
      now: NOW,
      terminalLocal: true,
      terminalSinceMs: NOW - 1000,
      lastBoardActivityMs: NOW - 2 * MIN,
      exitCode: 1,
    });
    expect(v).not.toBeNull();
    expect(v?.quiet).toBe(true);
    expect(v?.exitCode).toBe(1);
    expect(v?.ageMs).toBe(1000);
  });

  it("terminalLocal 이 아니면 null — 이 축의 소관이 아니다", () => {
    expect(
      evaluateExitQuiet({
        now: NOW,
        terminalLocal: false,
        lastBoardActivityMs: NOW - 2 * MIN,
      }),
    ).toBeNull();
  });

  it("terminalSinceMs 를 모르면 마지막 보드 활동 시각으로 대체한다", () => {
    const v = evaluateExitQuiet({
      now: NOW,
      terminalLocal: true,
      terminalSinceMs: null,
      lastBoardActivityMs: NOW - 5 * MIN,
      exitCode: null,
    });
    expect(v?.ageMs).toBe(5 * MIN);
    expect(v?.exitCode).toBeNull();
  });
});

describe("evaluateBoardQuiet — board activity only", () => {
  it("P5 ticket quiet 25m → quiet (urgent tier)", () => {
    const v = evaluateBoardQuiet({
      now: NOW,
      lastBoardActivityMs: NOW - 25 * MIN,
      priority: 5,
    });
    expect(v).toMatchObject({ quiet: true, tier: "urgent" });
    expect(v.quietMs).toBe(25 * MIN);
  });

  it("P3 ticket quiet 25m → NOT quiet (normal tier is 45m) — the false-positive guard", () => {
    expect(
      evaluateBoardQuiet({
        now: NOW,
        lastBoardActivityMs: NOW - 25 * MIN,
        priority: 3,
      }).quiet,
    ).toBe(false);
    expect(
      evaluateBoardQuiet({
        now: NOW,
        lastBoardActivityMs: NOW - 46 * MIN,
        priority: 3,
      }).quiet,
    ).toBe(true);
  });

  it("no activity yet → counts from activeSince; no clock at all → never quiet", () => {
    expect(
      evaluateBoardQuiet({
        now: NOW,
        lastBoardActivityMs: null,
        activeSinceMs: NOW - 30 * MIN,
        priority: 5,
      }).quiet,
    ).toBe(true);
    expect(
      evaluateBoardQuiet({
        now: NOW,
        lastBoardActivityMs: null,
        activeSinceMs: null,
        priority: 5,
      }).quiet,
    ).toBe(false);
  });
});

describe("classifyPtyLiveness — description, not verdict", () => {
  it("recent work output → busy (a spinning hung tool looks like this too)", () => {
    expect(
      classifyPtyLiveness({
        now: NOW,
        status: "working",
        lastWorkOutputMs: NOW - 30_000,
      }),
    ).toBe("busy");
  });
  it("awaiting-input beats parked beats busy; dead/missing first", () => {
    expect(
      classifyPtyLiveness({
        now: NOW,
        status: "working",
        lastWorkOutputMs: NOW,
        promptIdleSinceMs: NOW - 1000,
        inputWaitReason: "confirm",
      }),
    ).toBe("awaiting-input");
    expect(
      classifyPtyLiveness({
        now: NOW,
        status: "idle",
        lastWorkOutputMs: NOW,
        promptIdleSinceMs: NOW - 1000,
      }),
    ).toBe("parked");
    expect(
      classifyPtyLiveness({
        now: NOW,
        status: "working",
        lastWorkOutputMs: NOW - 10 * MIN,
      }),
    ).toBe("silent");
    expect(classifyPtyLiveness({ now: NOW, status: "stopped" })).toBe("dead");
    expect(classifyPtyLiveness({ now: NOW, status: null })).toBe("missing");
  });
});

describe("evaluateBoundAgent — dispatch's 'live activity evidence'", () => {
  it("★80 minutes quiet on a P5 ticket is NOT live any more (the 2026-08-22 case)", () => {
    const v = evaluateBoundAgent({
      withinFirstActivityGrace: false,
      hasBoardActivity: true,
      lastBoardActivityMs: NOW - 80 * MIN,
      priority: 5,
      now: NOW,
    });
    expect(v.live).toBe(false);
    if (!v.live) {
      expect(v.quietMs).toBe(80 * MIN);
      expect(v.thresholdMs).toBe(STALL_QUIET_URGENT_MS);
    }
  });

  it("recent activity stays live; first-activity grace stays live regardless", () => {
    expect(
      evaluateBoundAgent({
        withinFirstActivityGrace: false,
        hasBoardActivity: true,
        lastBoardActivityMs: NOW - 5 * MIN,
        priority: 5,
        now: NOW,
      }).live,
    ).toBe(true);
    expect(
      evaluateBoundAgent({
        withinFirstActivityGrace: true,
        hasBoardActivity: false,
        lastBoardActivityMs: null,
        now: NOW,
      }).live,
    ).toBe(true);
  });

  it("a normal-priority ticket quiet 30m is still live (45m threshold) — long work is not bypassed early", () => {
    expect(
      evaluateBoundAgent({
        withinFirstActivityGrace: false,
        hasBoardActivity: true,
        lastBoardActivityMs: NOW - 30 * MIN,
        priority: 2,
        now: NOW,
      }).live,
    ).toBe(true);
  });

  it("no board activity beyond the baseline → not live (born-dead, unchanged)", () => {
    expect(
      evaluateBoundAgent({
        withinFirstActivityGrace: false,
        hasBoardActivity: false,
        lastBoardActivityMs: null,
        now: NOW,
      }).live,
    ).toBe(false);
  });

  it("activity present but age unknown (old hook) → live, as before — never lean to 'dead' on missing evidence", () => {
    expect(
      evaluateBoundAgent({
        withinFirstActivityGrace: false,
        hasBoardActivity: true,
        lastBoardActivityMs: null,
        now: NOW,
      }).live,
    ).toBe(true);
  });
});

describe("isOtherLiveWorkerForTask — W3 stand-down guard predicate", () => {
  const ticket = { taskId: "T1", agentId: "new-worker" };
  it("the ticket's own agent and dead agents never count", () => {
    expect(
      isOtherLiveWorkerForTask(
        { id: "new-worker", status: "working", currentTaskId: "T1" },
        ticket,
      ),
    ).toBe(false);
    expect(
      isOtherLiveWorkerForTask(
        { id: "x", status: "stopped", currentTaskId: "T1" },
        ticket,
      ),
    ).toBe(false);
  });
  it("another agent bound by currentTaskId or sitting in the task worktree counts", () => {
    expect(
      isOtherLiveWorkerForTask(
        { id: "x", status: "working", currentTaskId: "T1" },
        ticket,
      ),
    ).toBe(true);
    expect(
      isOtherLiveWorkerForTask(
        { id: "x", status: "idle", currentTaskId: null, cwd: "/wt/px/T1" },
        ticket,
      ),
    ).toBe(true);
  });
  it("★a predecessor RELEASED from this task (currentTaskId null, lastTaskId = task) does NOT count even from the worktree", () => {
    expect(
      isOtherLiveWorkerForTask(
        {
          id: "old-worker",
          status: "working",
          currentTaskId: null,
          lastTaskId: "T1",
          cwd: "/wt/px/T1",
        },
        ticket,
      ),
    ).toBe(false);
  });
});
