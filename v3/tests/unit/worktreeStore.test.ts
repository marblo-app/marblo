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
 * null → 버튼 조용히 미렌더. 수정은 TTL+in-flight 게이트가 걸린 ensureFresh 로.
 *
 * 티켓 yJgz7s03: ensureFresh 는 이제 worktree:listLight(열거만, 실측 0.17s)를
 * 탄다 — full sweep(실측 19~26s/681개)은 카드/모달엔 순수 낭비였고 프로세스
 * 폭주가 티켓 화면을 얼렸다. 정확성(존재 여부)은 열거만으로 동일하게 보장된다.
 */
describe("ensureFresh — 스테일 스냅샷 회귀 가드 (listLight 경로)", () => {
  type LightGroup = {
    projectId: string;
    repoRoot: string;
    baseRef: string;
    worktrees: { path: string; branch: string; head: string }[];
  };
  type FullGroup = {
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

  function lightGroup(paths: string[], head = "abc123"): LightGroup[] {
    return [
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: paths.map((path) => ({
          path,
          branch: `marblo/${path.split("/").pop()}`,
          head,
        })),
      },
    ];
  }

  function fullGroup(paths: string[], head = "abc123"): FullGroup[] {
    return [
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: paths.map((path) => ({
          path,
          branch: `marblo/${path.split("/").pop()}`,
          head,
          status: makeStatus(),
        })),
      },
    ];
  }

  const listMock = vi.fn<() => Promise<FullGroup[]>>();
  const listLightMock = vi.fn<() => Promise<LightGroup[]>>();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-18T16:21:39Z"));
    listMock.mockReset();
    listLightMock.mockReset();
    vi.stubGlobal("window", {
      electronAPI: {
        worktree: { list: listMock, listLight: listLightMock },
      },
    });
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
    listLightMock.mockResolvedValue(lightGroup([`/w/${PROJECT}/task-old`]));
    await Promise.all([
      useWorktreeStore.getState().ensureFresh(),
      useWorktreeStore.getState().ensureFresh(),
      useWorktreeStore.getState().ensureFresh(),
    ]);
    expect(listLightMock).toHaveBeenCalledTimes(1);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
    expect(useWorktreeStore.getState().lastRefreshedAt).not.toBeNull();
  });

  it("ensureFresh 는 경량 열거만 부른다 — full worktree:list(20s 스윕)는 호출 금지", async () => {
    listLightMock.mockResolvedValue(lightGroup([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().ensureFresh();
    expect(listLightMock).toHaveBeenCalledTimes(1);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("TTL 안에서는 다시 부르지 않는다", async () => {
    listLightMock.mockResolvedValue(lightGroup([]));
    await useWorktreeStore.getState().ensureFresh();
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS - 1);
    await useWorktreeStore.getState().ensureFresh();
    expect(listLightMock).toHaveBeenCalledTimes(1);
  });

  it("TTL 이 지나면 재조회한다 — 세션 중 생성된 워크트리가 나타나고 findTaskWorktree 가 매칭한다 (버그의 치유 경로)", async () => {
    // 부팅 스냅샷: 새 태스크의 워크트리가 아직 없음 → 버튼 미렌더 상태.
    listLightMock.mockResolvedValueOnce(lightGroup([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().ensureFresh();
    expect(
      findTaskWorktree(useWorktreeStore.getState().worktrees, {
        id: "task-new",
      }),
    ).toBeNull();

    // 디스패치가 워크트리를 만들고 TTL 이 지난 뒤 → 재조회로 나타난다.
    listLightMock.mockResolvedValueOnce(
      lightGroup([`/w/${PROJECT}/task-old`, `/w/${PROJECT}/task-new`]),
    );
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS + 1);
    await useWorktreeStore.getState().ensureFresh();
    expect(listLightMock).toHaveBeenCalledTimes(2);
    expect(
      findTaskWorktree(useWorktreeStore.getState().worktrees, {
        id: "task-new",
      }),
    ).not.toBeNull();
  });

  it("실패한 refresh 는 lastRefreshedAt 을 남기지 않아 다음 ensureFresh 가 재시도한다", async () => {
    listLightMock.mockRejectedValueOnce(new Error("ipc down"));
    await expect(useWorktreeStore.getState().ensureFresh()).rejects.toThrow(
      "ipc down",
    );
    expect(useWorktreeStore.getState().lastRefreshedAt).toBeNull();

    listLightMock.mockResolvedValueOnce(lightGroup([]));
    await useWorktreeStore.getState().ensureFresh();
    expect(listLightMock).toHaveBeenCalledTimes(2);
  });

  it("경량 refresh 는 HEAD 가 안 변한 워크트리의 status/stale 을 보존한다 (WorktreeTab pill 유지)", async () => {
    // full refresh 로 status 가 채워진 상태에서…
    listMock.mockResolvedValueOnce(fullGroup([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().refresh();
    expect(useWorktreeStore.getState().worktrees[0].status).toBeDefined();

    // …TTL 경과 후 경량 재조회가 돌아도 같은 HEAD 면 status 를 버리지 않는다.
    listLightMock.mockResolvedValueOnce(lightGroup([`/w/${PROJECT}/task-old`]));
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS + 1);
    await useWorktreeStore.getState().ensureFresh();
    const wt = useWorktreeStore.getState().worktrees[0];
    expect(wt.status).toBeDefined();
    expect(wt.status?.baseRef).toBe("origin/main");
  });

  it("경량 refresh 는 HEAD 가 움직인 워크트리의 status 를 버린다 (낡은 머지 상태 오표시 방지)", async () => {
    listMock.mockResolvedValueOnce(fullGroup([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().refresh();

    listLightMock.mockResolvedValueOnce(
      lightGroup([`/w/${PROJECT}/task-old`], "def456"),
    );
    vi.advanceTimersByTime(WORKTREE_FRESH_TTL_MS + 1);
    await useWorktreeStore.getState().ensureFresh();
    const wt = useWorktreeStore.getState().worktrees[0];
    expect(wt.status).toBeUndefined();
    expect(wt.head).toBe("def456");
  });

  it("preload 에 listLight 가 없으면(구 preload) full list 로 폴백한다", async () => {
    vi.stubGlobal("window", {
      electronAPI: { worktree: { list: listMock } },
    });
    listMock.mockResolvedValueOnce(fullGroup([`/w/${PROJECT}/task-old`]));
    await useWorktreeStore.getState().ensureFresh();
    expect(listMock).toHaveBeenCalledTimes(1);
    expect(useWorktreeStore.getState().worktrees).toHaveLength(1);
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
