import { describe, expect, it } from "vitest";
import { statusPill } from "../../src/stores/worktreeStore";
import type { Worktree, WorktreeStatus } from "../../src/types/worktree";

/**
 * statusPill 은 Worktrees 칵핏의 행 상태 pill 을 결정하는 순수 함수다.
 * 우선순위(먼저 매칭되는 것이 이긴다):
 *   🔴 danger  = !mergeable || conflicts.length>0
 *   ⚠️ warning = stale
 *   🟡 behind  = behind>0
 *   🟢 ready   = mergeable && behind===0 && ahead>0
 *   ⚪ idle    = 그 외 (status 없음 / 변경 없음)
 */

function makeStatus(over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "marblo/feat-abc12345",
    baseRef: "origin/main",
    ahead: 0,
    behind: 0,
    dirty: false,
    mergeable: true,
    conflicts: [],
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    ...over,
  };
}

function wt(over: Partial<Worktree> = {}): Worktree {
  return {
    id: "proj1:/wt/path",
    taskId: "task-1",
    projectId: "proj1",
    agentId: null,
    branch: "marblo/feat-abc12345",
    baseRef: "origin/main",
    path: "/wt/path",
    repoRoot: "/repo",
    createdAt: null,
    status: makeStatus(),
    ...over,
  };
}

describe("statusPill — danger (🔴 충돌)", () => {
  it("mergeable=false → danger", () => {
    const p = statusPill(wt({ status: makeStatus({ mergeable: false }) }));
    expect(p.tone).toBe("danger");
    expect(p.icon).toBe("🔴");
  });
  it("conflicts 비어있지 않으면 mergeable=true 라도 danger", () => {
    const p = statusPill(
      wt({ status: makeStatus({ mergeable: true, conflicts: ["a.ts"] }) })
    );
    expect(p.tone).toBe("danger");
  });
  it("danger 가 stale 보다 우선 (충돌+stale → danger)", () => {
    const p = statusPill(
      wt({ stale: true, status: makeStatus({ mergeable: false }) })
    );
    expect(p.tone).toBe("danger");
  });
});

describe("statusPill — warning (⚠️ stale)", () => {
  it("stale=true (mergeable, 충돌없음) → warning", () => {
    const p = statusPill(wt({ stale: true, status: makeStatus() }));
    expect(p.tone).toBe("warning");
    expect(p.icon).toBe("⚠️");
  });
  it("stale 가 behind 보다 우선 (stale+behind → warning)", () => {
    const p = statusPill(
      wt({ stale: true, status: makeStatus({ behind: 3 }) })
    );
    expect(p.tone).toBe("warning");
  });
});

describe("statusPill — behind (🟡 뒤처짐)", () => {
  it("behind>0 (mergeable, 충돌없음, stale 아님) → behind", () => {
    const p = statusPill(wt({ status: makeStatus({ behind: 2, ahead: 1 }) }));
    expect(p.tone).toBe("behind");
    expect(p.icon).toBe("🟡");
  });
  it("behind 가 ready 보다 우선 (ahead>0 이어도 behind>0 이면 behind)", () => {
    const p = statusPill(wt({ status: makeStatus({ behind: 1, ahead: 5 }) }));
    expect(p.tone).toBe("behind");
  });
});

describe("statusPill — ready (🟢 머지 가능)", () => {
  it("mergeable && behind===0 && ahead>0 → ready", () => {
    const p = statusPill(wt({ status: makeStatus({ ahead: 4, behind: 0 }) }));
    expect(p.tone).toBe("ready");
    expect(p.icon).toBe("🟢");
  });
});

describe("statusPill — idle (⚪ 작업중)", () => {
  it("변경 없음(ahead=0,behind=0) → idle", () => {
    const p = statusPill(wt({ status: makeStatus({ ahead: 0, behind: 0 }) }));
    expect(p.tone).toBe("idle");
    expect(p.icon).toBe("⚪");
  });
  it("status 없음 → idle", () => {
    const p = statusPill(wt({ status: undefined }));
    expect(p.tone).toBe("idle");
  });
});

describe("statusPill — 현재 동작 고정(잠재 갭 문서화)", () => {
  // statusPill 은 `dirty`(uncommitted) 를 무시한다. 미커밋 변경이 있어도
  // ahead>0·mergeable 이면 "머지 가능"으로 보인다. 실제 squash-merge 전엔
  // 커밋이 필요하므로 이는 잠재적 오해 소지(후속 보강 후보)지만, 현 동작을
  // 회귀 가드로 고정해 둔다.
  it("dirty=true 여도 ahead>0·mergeable 이면 ready (dirty 무시 — 현 동작)", () => {
    const p = statusPill(
      wt({ status: makeStatus({ ahead: 2, behind: 0, dirty: true }) })
    );
    expect(p.tone).toBe("ready");
  });
});
