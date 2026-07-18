import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  statusPill,
  useWorktreeStore,
  WORKTREE_FRESH_TTL_MS,
} from "../../src/stores/worktreeStore";
import { findTaskWorktree } from "../../src/lib/taskWorktree";
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

/**
 * ensureFresh — "이 워크트리 보기" 미표시 버그(티켓 ZHCW4yX6)의 회귀 가드.
 *
 * 실측된 근본원인: worktreeStore 가 앱 시작 시 1회만 refresh 되는 스냅샷이라,
 * 세션 중(에이전트 디스패치로) 생성된 워크트리를 영영 모른다 → findTaskWorktree
 * null → 버튼 조용히 미렌더. 수정은 TTL+in-flight 게이트가 걸린 ensureFresh 로,
 * 카드 마운트·모달 오픈마다 불러도 worktree:list IPC(실측 ~20s/681개)는
 * 분당 1회로 묶인다.
 */
describe("ensureFresh — 스테일 스냅샷 회귀 가드", () => {
  type ListGroup = {
    projectId: string;
    repoRoot: string;
    baseRef: string;
    worktrees: {
      path: string;
      branch: string;
      head: string;
      status: WorktreeStatus;
    }[];
  };

  const PROJECT = "GFB8JnJrrX6AgahqmGB3";

  function group(paths: string[]): ListGroup[] {
    return [
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: paths.map((path) => ({
          path,
          branch: `marblo/${path.split("/").pop()}`,
          head: "abc123",
          status: makeStatus(),
        })),
      },
    ];
  }

  const listMock = vi.fn<() => Promise<ListGroup[]>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T16:21:39Z"));
    listMock.mockReset();
    vi.stubGlobal("window", { electronAPI: { worktree: { list: listMock } } });
    useWorktreeStore.setState({
      worktrees: [],
      loading: false,
      lastError: null,
      lastRefreshedAt: null,
    });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it("첫 호출은 refresh 하고, 동시 호출 폭주(카드 일괄 마운트)는 IPC 1회로 합쳐진다", async () => {
    listMock.mockResolvedValue(group([`/w/${PROJECT}/task-old`]));
    await Promise.all([
      useWorktreeStore.getState().ensureFresh(),
      useWorktreeStore.getState().ensureFresh(),
      useWorktreeStore.getState().ensureFresh(),
    ]);
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
    expect(useWorktreeStore.getState().lastRefreshedAt).not.toBeNull();
  });

  it("TTL 안에서는 다시 부르지 않는다", async () => {
    listMock.mockResolvedValue(group([]));
    await useWorktreeStore.getState().ensureFresh();
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS - 1);
    await useWorktreeStore.getState().ensureFresh();
    expect(listMock).toHaveBeenCalledTimes(1);
  });

  it("TTL 이 지나면 재조회한다 — 세션 중 생성된 워크트리가 나타나고 findTaskWorktree 가 매칭한다 (버그의 치유 경로)", async () => {
    // 부팅 스냅샷: 새 태스크의 워크트리가 아직 없음 → 버튼 미렌더 상태.
    listMock.mockResolvedValueOnce(group([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().ensureFresh();
    expect(
      findTaskWorktree(useWorktreeStore.getState().worktrees, {
        id: "task-new",
      }),
    ).toBeNull();

    // 디스패치가 워크트리를 만들고 TTL 이 지난 뒤 → 재조회로 나타난다.
    listMock.mockResolvedValueOnce(
      group([`/w/${PROJECT}/task-old`, `/w/${PROJECT}/task-new`]),
    );
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS + 1);
    await useWorktreeStore.getState().ensureFresh();
    expect(listMock).toHaveBeenCalledTimes(2);
    expect(
      findTaskWorktree(useWorktreeStore.getState().worktrees, {
        id: "task-new",
      }),
    ).not.toBeNull();
  });

  it("실패한 refresh 는 lastRefreshedAt 을 남기지 않아 다음 ensureFresh 가 재시도한다", async () => {
    listMock.mockRejectedValueOnce(new Error("ipc down"));
    await expect(useWorktreeStore.getState().ensureFresh()).rejects.toThrow(
      "ipc down",
    );
    expect(useWorktreeStore.getState().lastRefreshedAt).toBeNull();

    listMock.mockResolvedValueOnce(group([]));
    await useWorktreeStore.getState().ensureFresh();
    expect(listMock).toHaveBeenCalledTimes(2);
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
