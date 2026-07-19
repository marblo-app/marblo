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
      wt({ status: makeStatus({ mergeable: true, conflicts: ["a.ts"] }) }),
    );
    expect(p.tone).toBe("danger");
  });
  it("danger 가 stale 보다 우선 (충돌+stale → danger)", () => {
    const p = statusPill(
      wt({ stale: true, status: makeStatus({ mergeable: false }) }),
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
      wt({ stale: true, status: makeStatus({ behind: 3 }) }),
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

/**
 * resolveWorktree — 실패 경로 풀스윕 회귀 가드 (티켓 jSVKHpBzjvWUQHlmXBU0).
 *
 * #495 가 조회를 0.144s 로 줄였지만 TaskDetailModal 은 라이트 스냅샷 miss 시
 * refresh()(풀스윕)로 폴백했다. 실측: status() 1개당 61ms × 160개 → 순차 9.4s,
 * 스폰 경합 시 12~26s. 그런데 두 IPC 는 같은 worktreeManager.list 열거를
 * 쓰므로 풀스윕이 라이트가 못 찾은 워크트리를 찾아낼 방법은 애초에 없다 —
 * miss 경로에서 얻는 것 없이 값만 다 치르는 구조였다.
 */
describe("resolveWorktree — 단건 on-demand 해소", () => {
  type LightGroup = {
    projectId: string;
    repoRoot: string;
    baseRef: string;
    worktrees: { path: string; branch: string; head: string }[];
  };

  const PROJECT = "GFB8JnJrrX6AgahqmGB3";
  const listMock = vi.fn();
  const listLightMock = vi.fn<() => Promise<LightGroup[]>>();

  function lightGroup(paths: string[]): LightGroup[] {
    return [
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: paths.map((path) => ({
          path,
          branch: `marblo/${path.split("/").pop()}`,
          head: "abc123",
        })),
      },
    ];
  }

  const selectTask = (id: string) => (worktrees: Worktree[]) =>
    findTaskWorktree(worktrees, { id });

  beforeEach(() => {
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
    vi.unstubAllGlobals();
  });

  it("스냅샷에 이미 있으면 IPC 를 아예 안 탄다", async () => {
    listLightMock.mockResolvedValue(lightGroup([`/w/${PROJECT}/task-a`]));
    await useWorktreeStore.getState().refreshLight();
    listLightMock.mockClear();

    const found = await useWorktreeStore
      .getState()
      .resolveWorktree(selectTask("task-a"));
    expect(found?.taskId).toBe("task-a");
    expect(listLightMock).not.toHaveBeenCalled();
    expect(listMock).not.toHaveBeenCalled();
  });

  it("★miss 는 경량 재열거 1회로만 승격한다 — 풀스윕 worktree:list 호출 금지", async () => {
    listLightMock.mockResolvedValueOnce(lightGroup([`/w/${PROJECT}/task-a`]));
    await useWorktreeStore.getState().refreshLight();
    listLightMock.mockClear();

    // 방금 디스패치된 워크트리 — 스냅샷엔 없고 재열거하면 나온다.
    listLightMock.mockResolvedValueOnce(
      lightGroup([`/w/${PROJECT}/task-a`, `/w/${PROJECT}/task-new`]),
    );
    const found = await useWorktreeStore
      .getState()
      .resolveWorktree(selectTask("task-new"));

    expect(found?.taskId).toBe("task-new");
    expect(listLightMock).toHaveBeenCalledTimes(1);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("재열거 후에도 없으면 null — 조용히 성공한 척하지 않는다", async () => {
    listLightMock.mockResolvedValue(lightGroup([`/w/${PROJECT}/task-a`]));
    const found = await useWorktreeStore
      .getState()
      .resolveWorktree(selectTask("task-ghost"));

    expect(found).toBeNull();
    expect(listLightMock).toHaveBeenCalledTimes(1);
    expect(listMock).not.toHaveBeenCalled();
  });

  it("miss 재열거가 실패하면 throw — 호출자가 '워크트리 없음'으로 위장할 수 없다", async () => {
    listLightMock.mockRejectedValueOnce(new Error("ipc down"));
    await expect(
      useWorktreeStore.getState().resolveWorktree(selectTask("task-a")),
    ).rejects.toThrow("ipc down");
  });

  it("TTL 로 게이트되지 않는다 — 방금 경량 조회했어도 miss 면 다시 열거한다", async () => {
    listLightMock.mockResolvedValueOnce(lightGroup([]));
    await useWorktreeStore.getState().ensureFresh();
    expect(useWorktreeStore.getState().lastRefreshedAt).not.toBeNull();
    listLightMock.mockClear();

    listLightMock.mockResolvedValueOnce(lightGroup([`/w/${PROJECT}/task-new`]));
    const found = await useWorktreeStore
      .getState()
      .resolveWorktree(selectTask("task-new"));

    expect(found?.taskId).toBe("task-new");
    expect(listLightMock).toHaveBeenCalledTimes(1);
  });

  it("select 의 우선순위(taskId > 경로 > 브랜치)를 리스트 순서가 뒤집지 못한다", async () => {
    // 브랜치에만 id 가 있는 워크트리가 배열 앞에 오고, 경로로 매칭되는
    // 워크트리가 뒤에 온다. per-item predicate 였다면 앞의 것이 이겼을 것.
    useWorktreeStore.setState({
      worktrees: [
        {
          id: "p:/w/other",
          taskId: null,
          projectId: PROJECT,
          agentId: null,
          branch: "marblo/task-a-followup",
          baseRef: "origin/main",
          path: "/w/other",
          repoRoot: "/repo",
          createdAt: null,
        } as Worktree,
        {
          id: `p:/w/${PROJECT}/task-a`,
          taskId: "task-a",
          projectId: PROJECT,
          agentId: null,
          branch: "marblo/whatever",
          baseRef: "origin/main",
          path: `/w/${PROJECT}/task-a`,
          repoRoot: "/repo",
          createdAt: null,
        } as Worktree,
      ],
    });

    const found = await useWorktreeStore
      .getState()
      .resolveWorktree(selectTask("task-a"));
    expect(found?.path).toBe(`/w/${PROJECT}/task-a`);
    expect(listLightMock).not.toHaveBeenCalled();
  });
});

describe("statusPill — 현재 동작 고정(잠재 갭 문서화)", () => {
  // statusPill 은 `dirty`(uncommitted) 를 무시한다. 미커밋 변경이 있어도
  // ahead>0·mergeable 이면 "머지 가능"으로 보인다. 실제 squash-merge 전엔
  // 커밋이 필요하므로 이는 잠재적 오해 소지(후속 보강 후보)지만, 현 동작을
  // 회귀 가드로 고정해 둔다.
  it("dirty=true 여도 ahead>0·mergeable 이면 ready (dirty 무시 — 현 동작)", () => {
    const p = statusPill(
      wt({ status: makeStatus({ ahead: 2, behind: 0, dirty: true }) }),
    );
    expect(p.tone).toBe("ready");
  });
});
