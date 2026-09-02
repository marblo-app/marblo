/**
 * 감사 원장 L4 — 워크트리 감사 뷰 + 오케용 조회 유닛 테스트.
 *
 * 티켓의 핵심 요구를 그대로 못박는다:
 *   - 물리 삭제된 워크트리도 조회된다(origin="ledger")
 *   - 규약 밖이어도 taskId 근거가 있으면 projectId/taskId 로 귀속한다
 *   - worktreeId=null(규약 외+taskId 없음)은 억지 귀속되지 않는다
 *   - preLedger 구간은 무결성 미보증으로 별도 집계된다
 *   - 오케 3질문(Q1 지금 도는가/Q2 지워도 안전한가/Q3 그때 뭐가 돌았나)은
 *     근거가 없으면 반드시 "unknown" — 절대 추측하지 않는다
 */
import { describe, it, expect } from "vitest";
import {
  classifyWorktreeDir,
  unionKnownWorktrees,
  summarizeSealStatus,
  pickLatestMerge,
  buildWorktreeAuditRows,
  describeProcessLiveness,
  describeSafeToDelete,
  describeActivityAtDecisionTime,
  evaluateSubmitForReviewRisk,
  type WorktreeAuditEvent,
  type MergeInfo,
} from "../../electron/mcp-server/worktree-audit";

const HOME = "/home/agent";

describe("classifyWorktreeDir", () => {
  it("규약 경로에서 worktreeId 를 파생한다", () => {
    const r = classifyWorktreeDir("/home/agent/.marblo/worktrees/proj1/task1", {
      homeDir: HOME,
    });
    expect(r.worktreeId).toBe("proj1/task1");
    expect(r.identity).toEqual({ projectId: "proj1", taskId: "task1" });
    expect(r.offConventionReason).toBeNull();
  });

  it("규약 밖 경로는 억지 귀속하지 않고 이유를 남긴다", () => {
    const r = classifyWorktreeDir("/tmp/manual-checkout", { homeDir: HOME });
    expect(r.worktreeId).toBeNull();
    expect(r.identity).toBeNull();
    expect(r.offConventionReason).toMatch(/규약/);
  });

  it("규약 밖 경로라도 taskId 근거가 있으면 티켓 워크트리로 귀속한다", () => {
    const r = classifyWorktreeDir("/tmp/manual-checkout", {
      homeDir: HOME,
      projectId: "proj1",
      taskId: "task1",
    });
    expect(r.worktreeId).toBe("proj1/task1");
    expect(r.identity).toEqual({ projectId: "proj1", taskId: "task1" });
    expect(r.offConventionReason).toMatch(/taskId/);
  });
});

describe("unionKnownWorktrees", () => {
  it("디스크와 원장의 합집합을 만들고 origin 을 태그한다", () => {
    const rows = unionKnownWorktrees(["p/a", "p/b"], ["p/b", "p/c"]);
    const byId = Object.fromEntries(rows.map((r) => [r.worktreeId, r.origin]));
    expect(byId).toEqual({ "p/a": "disk", "p/b": "both", "p/c": "ledger" });
  });

  it("★물리 삭제된 워크트리(디스크엔 없고 원장에만 있음)도 조회된다", () => {
    const rows = unionKnownWorktrees([], ["p/deleted"]);
    expect(rows).toEqual([{ worktreeId: "p/deleted", origin: "ledger" }]);
  });
});

describe("summarizeSealStatus", () => {
  it("체인 필드가 붙은 것과 preLedger 를 나눠 센다", () => {
    const sealed = {
      projectId: "p",
      agentId: "a",
      toolName: "x",
      params: {},
      result: "",
      duration: 0,
      success: true,
      kind: "action" as const,
      actorUid: null,
      model: null,
      tier: null,
      instructionHash: null,
      taskId: null,
      worktreeId: "p/a",
      seq: 0,
      prevHash: "genesis",
      hash: "sha256:x",
    };
    const preLedger = {
      ...sealed,
      seq: undefined,
      prevHash: undefined,
      hash: undefined,
    };
    const r = summarizeSealStatus([sealed, preLedger]);
    expect(r).toEqual({ sealed: 1, preLedger: 1 });
  });
});

describe("pickLatestMerge", () => {
  it("mergedAtMs 가 가장 큰 행을 고른다", () => {
    const r = pickLatestMerge([
      { taskId: "t", branch: "b1", headSha: "s1", mergedAtMs: 100 },
      { taskId: "t", branch: "b2", headSha: "s2", mergedAtMs: 300 },
      { taskId: "t", branch: "b3", headSha: "s3", mergedAtMs: 200 },
    ]);
    expect(r).toEqual({ branch: "b2", headSha: "s2", mergedAtMs: 300 });
  });

  it("mergedAtMs 없는 행은 근거 없음으로 버린다", () => {
    expect(
      pickLatestMerge([
        { taskId: "t", branch: null, headSha: null, mergedAtMs: null },
      ]),
    ).toBeNull();
    expect(pickLatestMerge([])).toBeNull();
  });
});

describe("buildWorktreeAuditRows", () => {
  it("조인·정렬·집계를 순수하게 수행한다", () => {
    const events: WorktreeAuditEvent[] = [
      {
        agentId: "agent-1",
        occurredAtMs: 1000,
        toolName: "add_activity",
        seq: 0,
        prevHash: "genesis",
        hash: "h0",
      },
      {
        agentId: "agent-1",
        occurredAtMs: 2000,
        toolName: "submit_for_review",
        seq: 1,
        prevHash: "h0",
        hash: "h1",
      },
    ];
    const rows = buildWorktreeAuditRows({
      known: [
        { worktreeId: "p/a", origin: "both" },
        { worktreeId: "p/deleted", origin: "ledger" },
      ],
      eventsByWorktreeId: new Map([["p/a", events]]),
      mergeByTaskId: new Map([
        ["a", { branch: "b", headSha: "s", mergedAtMs: 5000 } as MergeInfo],
      ]),
    });
    expect(rows).toEqual([
      {
        worktreeId: "p/a",
        taskId: "a",
        origin: "both",
        existsOnDisk: true,
        lastAgentId: "agent-1",
        lastEventAtMs: 2000,
        sealed: 2,
        preLedger: 0,
        merged: true,
        mergedAtMs: 5000,
      },
      {
        worktreeId: "p/deleted",
        taskId: "deleted",
        origin: "ledger",
        existsOnDisk: false,
        lastAgentId: null,
        lastEventAtMs: null,
        sealed: 0,
        preLedger: 0,
        merged: false,
        mergedAtMs: null,
      },
    ]);
  });
});

describe("evaluateSubmitForReviewRisk", () => {
  it("워크트리를 못 찾는 판정/조사 티켓은 경고하지 않는다", () => {
    expect(
      evaluateSubmitForReviewRisk({
        worktreeExists: false,
        commitsSinceBase: null,
        uncommittedFileCount: null,
        pushedToOrigin: null,
        prUrl: null,
      }),
    ).toEqual({ risk: null, notification: null });
  });

  it("미커밋 파일은 제출을 막지 않고 파일 수를 경고한다", () => {
    const r = evaluateSubmitForReviewRisk({
      worktreeExists: true,
      commitsSinceBase: 0,
      uncommittedFileCount: 2,
      pushedToOrigin: true,
      prUrl: null,
    });
    expect(r.risk).toBe("uncommitted-work");
    expect(r.notification).toBe("★ PR 없음 · 미커밋 2개");
  });

  it("미커밋 경고는 이미 커밋이 있어도 우선해 잔존 파일을 보존한다", () => {
    const r = evaluateSubmitForReviewRisk({
      worktreeExists: true,
      commitsSinceBase: 1,
      uncommittedFileCount: 1,
      pushedToOrigin: null,
      prUrl: null,
    });
    expect(r.risk).toBe("uncommitted-work");
  });

  it("미푸시 커밋은 제출을 막지 않고 경고한다", () => {
    const r = evaluateSubmitForReviewRisk({
      worktreeExists: true,
      commitsSinceBase: 2,
      uncommittedFileCount: 0,
      pushedToOrigin: false,
      prUrl: null,
    });
    expect(r.risk).toBe("unpushed-commits");
    expect(r.notification).toBe("★ PR 없음 · 미푸시 커밋 2개");
  });

  it("원격 커밋만 있고 PR 이 없으면 경고한다", () => {
    const r = evaluateSubmitForReviewRisk({
      worktreeExists: true,
      commitsSinceBase: 1,
      uncommittedFileCount: 0,
      pushedToOrigin: true,
      prUrl: null,
    });
    expect(r.risk).toBe("missing-pr");
    expect(r.notification).toBe("★ PR 없음 · 원격 커밋 1개");
  });

  it("커밋 + push + PR 이 있으면 경고하지 않는다", () => {
    expect(
      evaluateSubmitForReviewRisk({
        worktreeExists: true,
        commitsSinceBase: 1,
        uncommittedFileCount: 0,
        pushedToOrigin: true,
        prUrl: "https://github.com/acme/repo/pull/1",
      }),
    ).toEqual({ risk: null, notification: null });
  });
});

describe("describeProcessLiveness (Q1)", () => {
  it("머지 기록이 없으면 not-merged", () => {
    const r = describeProcessLiveness({
      mergeInfo: null,
      bakedCommit: "abc123",
      ancestorResult: "unknown",
    });
    expect(r.status).toBe("not-merged");
  });

  it("baked 커밋이 없으면(unbundled) unknown — 추측하지 않는다", () => {
    const r = describeProcessLiveness({
      mergeInfo: { branch: "b", headSha: "s", mergedAtMs: 1 },
      bakedCommit: null,
      ancestorResult: "unknown",
    });
    expect(r.status).toBe("unknown");
  });

  it("git 조상관계 확인 실패면 unknown", () => {
    const r = describeProcessLiveness({
      mergeInfo: { branch: "b", headSha: "s", mergedAtMs: 1 },
      bakedCommit: "abc123",
      ancestorResult: "unknown",
    });
    expect(r.status).toBe("unknown");
  });

  it("머지 커밋이 실행 중 빌드의 조상이면 confirmed-live", () => {
    const r = describeProcessLiveness({
      mergeInfo: { branch: "b", headSha: "s", mergedAtMs: 1 },
      bakedCommit: "abc123",
      ancestorResult: "ancestor",
    });
    expect(r.status).toBe("confirmed-live");
  });

  it("조상이 아니면 confirmed-not-live", () => {
    const r = describeProcessLiveness({
      mergeInfo: { branch: "b", headSha: "s", mergedAtMs: 1 },
      bakedCommit: "abc123",
      ancestorResult: "not-ancestor",
    });
    expect(r.status).toBe("confirmed-not-live");
  });
});

describe("describeSafeToDelete (Q2)", () => {
  it("디스크에 없으면 already-gone", () => {
    const r = describeSafeToDelete({
      existsOnDisk: false,
      dirty: null,
      unpushedCount: null,
      agentBusy: null,
    });
    expect(r.verdict).toBe("already-gone");
  });

  it("dirty/unpushed/busy 위험 신호가 있으면 not-safe", () => {
    const r = describeSafeToDelete({
      existsOnDisk: true,
      dirty: true,
      unpushedCount: 0,
      agentBusy: false,
    });
    expect(r.verdict).toBe("not-safe");
    expect(r.reasons.join(" ")).toMatch(/dirty/);
  });

  it("★위험 신호가 없어도 확인 못 한 축이 있으면 unknown — 안전으로 반올림하지 않는다", () => {
    const r = describeSafeToDelete({
      existsOnDisk: true,
      dirty: false,
      unpushedCount: 0,
      agentBusy: null,
    });
    expect(r.verdict).toBe("unknown");
  });

  it("모든 축이 확인되고 위험 신호가 없으면 likely-safe", () => {
    const r = describeSafeToDelete({
      existsOnDisk: true,
      dirty: false,
      unpushedCount: 0,
      agentBusy: false,
    });
    expect(r.verdict).toBe("likely-safe");
  });
});

describe("describeActivityAtDecisionTime (Q3)", () => {
  const events = [
    {
      toolName: "a",
      occurredAtMs: 1000,
      agentId: "x",
      success: true,
      kind: "action",
    },
    {
      toolName: "b",
      occurredAtMs: 5000,
      agentId: "x",
      success: true,
      kind: "action",
    },
    {
      toolName: "c",
      occurredAtMs: 100000,
      agentId: "x",
      success: true,
      kind: "action",
    },
  ];

  it("창 안의 이벤트만 시간순으로 돌려준다", () => {
    const r = describeActivityAtDecisionTime(events, 3000, 5000);
    expect(r.events.map((e) => e.toolName)).toEqual(["a", "b"]);
  });

  it("★창이 비어도 caveat 로 lifecycle 신호 부재를 명시한다(모른다≠괜찮다)", () => {
    const r = describeActivityAtDecisionTime([], 3000, 100);
    expect(r.events).toEqual([]);
    expect(r.caveat).toMatch(/lifecycle/);
  });
});
