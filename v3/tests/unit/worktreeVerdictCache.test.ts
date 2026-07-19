import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildVerdictCache,
  cachedVerdictFor,
  loadVerdictCache,
  saveVerdictCache,
} from "../../src/lib/worktreeVerdictCache";
import {
  archiveReason,
  countUnknownVerdicts,
  isVerdictUnknown,
  isWorktreeArchived,
} from "../../src/lib/worktreeHygiene";
import { useWorktreeStore } from "../../src/stores/worktreeStore";
import type { Worktree, WorktreeStatus } from "../../src/types/worktree";

/**
 * 티켓 HruNFJpj — Code 탭 진입 시 앱 전반 저하의 근본원인은 CodeTab/FileTree
 * 마운트마다 돌던 full worktree:list 스윕(워크트리당 최대 7 git 스폰, ~680개
 * 환경 실측 12–26s 디스크 포화)이었다. 두 마운트는 light(ensureFresh) 로
 * 전환됐고, light 데이터에 없는 아카이브 verdict(stale/merged) 는 이 캐시가
 * localStorage 로 이어준다 — full 스윕이 산출한 verdict 를 HEAD 가 안 움직인
 * 워크트리에 한해 재사용해, 드롭다운/루트선택기의 아카이브 필터(#475)가
 * 스윕 없이도 유지된다.
 */

function makeStatus(over: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "marblo/task-1",
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
    id: "proj1:/w/proj1/task-1",
    taskId: "task-1",
    projectId: "proj1",
    agentId: null,
    branch: "marblo/task-1",
    baseRef: "origin/main",
    path: "/w/proj1/task-1",
    repoRoot: "/repo",
    head: "abc123",
    createdAt: null,
    ...over,
  };
}

function stubLocalStorage(): Record<string, string> {
  const backing: Record<string, string> = {};
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => backing[k] ?? null,
    setItem: (k: string, v: string) => {
      backing[k] = v;
    },
    removeItem: (k: string) => {
      delete backing[k];
    },
  });
  return backing;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("verdict cache — 순수 헬퍼", () => {
  it("buildVerdictCache 는 verdict 있는 워크트리만 담는다 (light-only 항목 제외)", () => {
    const cache = buildVerdictCache([
      wt({
        path: "/w/a",
        stale: true,
        staleInfo: { merged: true, idleDays: 3, stale: true },
      }),
      // verdict 없는 (light) 항목 — 캐시에 실리면 안 된다
      wt({ path: "/w/b", stale: undefined, staleInfo: undefined }),
      // head 없는 항목도 제외 (HEAD 가드 불가)
      wt({ path: "/w/c", head: undefined, stale: false }),
    ]);
    expect(Object.keys(cache)).toEqual(["/w/a"]);
    expect(cache["/w/a"]).toEqual({
      head: "abc123",
      stale: true,
      staleInfo: { merged: true, idleDays: 3, stale: true },
    });
  });

  it("cachedVerdictFor 는 HEAD 일치 시에만 돌려준다 (움직인 HEAD → 낡은 verdict 폐기)", () => {
    const cache = buildVerdictCache([
      wt({ path: "/w/a", head: "abc123", stale: true }),
    ]);
    expect(cachedVerdictFor(cache, "/w/a", "abc123")?.stale).toBe(true);
    expect(cachedVerdictFor(cache, "/w/a", "def456")).toBeNull();
    expect(cachedVerdictFor(cache, "/w/a", undefined)).toBeNull();
    expect(cachedVerdictFor(cache, "/w/zzz", "abc123")).toBeNull();
  });

  it("save→load 왕복이 verdict 를 보존하고, 깨진 항목은 걸러낸다", () => {
    stubLocalStorage();
    saveVerdictCache({
      "/w/a": {
        head: "abc123",
        stale: false,
        staleInfo: { merged: false, idleDays: 0, stale: false },
      },
    });
    expect(loadVerdictCache()).toEqual({
      "/w/a": {
        head: "abc123",
        stale: false,
        staleInfo: { merged: false, idleDays: 0, stale: false },
      },
    });

    // 깨진 페이로드 — 조용히 빈 캐시
    localStorage.setItem("marblo.worktree.verdicts.v1", "{not json");
    expect(loadVerdictCache()).toEqual({});
  });

  it("localStorage 가 없어도(테스트/SSR) 안전하게 no-op", () => {
    expect(loadVerdictCache()).toEqual({});
    expect(() => saveVerdictCache({})).not.toThrow();
  });
});

describe("verdict cache — worktreeStore 통합 (콜드스타트 아카이브 필터 유지)", () => {
  const PROJECT = "proj1";
  const PATH = `/w/${PROJECT}/task-old`;

  const listMock = vi.fn();
  const listLightMock = vi.fn();

  beforeEach(() => {
    listMock.mockReset();
    listLightMock.mockReset();
    stubLocalStorage();
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

  it("full refresh 가 verdict 를 영속화하고, 콜드스타트 light refresh 가 같은 HEAD 에 재적용한다", async () => {
    listMock.mockResolvedValueOnce([
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: [
          {
            path: PATH,
            branch: "marblo/task-old",
            head: "abc123",
            status: makeStatus(),
            stale: true,
            staleInfo: { merged: true, idleDays: 9, stale: true },
          },
        ],
      },
    ]);
    await useWorktreeStore.getState().refresh();

    // 콜드스타트 재현: 스토어 스냅샷을 비운다 (앱 재시작 = in-memory 소실)
    useWorktreeStore.setState({ worktrees: [], lastRefreshedAt: null });

    listLightMock.mockResolvedValueOnce([
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: [{ path: PATH, branch: "marblo/task-old", head: "abc123" }],
      },
    ]);
    await useWorktreeStore.getState().refreshLight();

    const restored = useWorktreeStore.getState().worktrees[0];
    expect(restored.stale).toBe(true);
    expect(restored.staleInfo).toEqual({
      merged: true,
      idleDays: 9,
      stale: true,
    });
    // status 는 캐시 대상이 아니다 — pill 은 다음 full refresh 가 채운다
    expect(restored.status).toBeUndefined();
  });

  it("HEAD 가 움직였으면 캐시 verdict 를 쓰지 않는다 (active 워크트리 오은닉 방지)", async () => {
    listMock.mockResolvedValueOnce([
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: [
          {
            path: PATH,
            branch: "marblo/task-old",
            head: "abc123",
            status: makeStatus(),
            stale: true,
            staleInfo: { merged: true, idleDays: 9, stale: true },
          },
        ],
      },
    ]);
    await useWorktreeStore.getState().refresh();
    useWorktreeStore.setState({ worktrees: [], lastRefreshedAt: null });

    listLightMock.mockResolvedValueOnce([
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees: [{ path: PATH, branch: "marblo/task-old", head: "def456" }],
      },
    ]);
    await useWorktreeStore.getState().refreshLight();

    const restored = useWorktreeStore.getState().worktrees[0];
    // ★ NaviULZe: '판정 없음' 은 undefined(unknown) 이지 false(안 stale)가 아니다.
    // 예전에는 false 로 눌러담았고, 그래서 캐시가 통째로 비었을 때도 필터가
    // '전부 active' 라고 자신있게 답하며 160개를 그대로 통과시켰다.
    expect(restored.stale).toBeUndefined();
    expect(restored.staleInfo).toBeUndefined();
  });
});

/**
 * 티켓 NaviULZe — 진범은 '캐시를 쓰는 쪽' 이 아니라 '쓰는(write) 쪽' 이었다.
 * saveVerdictCache 호출부가 full refresh() 단 하나뿐인데 마운트 경로는 전부
 * light 라, Worktrees 탭을 한 번도 안 연 프로필에서는 캐시 키가 영영 생기지
 * 않았다. 아래는 (a) light 응답이 verdict 를 실어오면 콜드 캐시에서도 필터가
 * 살아있고, (b) light 경로가 캐시를 시딩한다는 것을 고정한다.
 */
describe("verdict 시딩 — light 경로 (NaviULZe)", () => {
  const PROJECT = "proj1";
  const listMock = vi.fn();
  const listLightMock = vi.fn();
  let backing: Record<string, string>;

  beforeEach(() => {
    listMock.mockReset();
    listLightMock.mockReset();
    backing = stubLocalStorage();
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

  function lightGroup(worktrees: unknown[]) {
    return [
      {
        projectId: PROJECT,
        repoRoot: "/repo",
        baseRef: "origin/main",
        worktrees,
      },
    ];
  }

  it("★캐시가 완전히 빈 상태에서도 light 응답의 verdict 로 아카이브가 판정된다", async () => {
    expect(backing["marblo.worktree.verdicts.v1"]).toBeUndefined();

    listLightMock.mockResolvedValueOnce(
      lightGroup([
        {
          path: `/w/${PROJECT}/merged-task`,
          branch: "marblo/merged-task",
          head: "aaa",
          stale: true,
          staleInfo: { merged: true, idleDays: 2, stale: true },
        },
        {
          path: `/w/${PROJECT}/live-task`,
          branch: "marblo/live-task",
          head: "bbb",
          stale: false,
          staleInfo: { merged: false, idleDays: 0, stale: false },
        },
      ]),
    );
    await useWorktreeStore.getState().refreshLight();

    const [merged, live] = useWorktreeStore.getState().worktrees;
    expect(isWorktreeArchived(merged, {})).toBe(true);
    expect(isWorktreeArchived(live, {})).toBe(false);
    expect(archiveReason(merged)).toBe("merged");
  });

  it("★light refresh 가 verdict 캐시를 시딩한다 (예전엔 full refresh 만 썼다)", async () => {
    listLightMock.mockResolvedValueOnce(
      lightGroup([
        {
          path: `/w/${PROJECT}/merged-task`,
          branch: "marblo/merged-task",
          head: "aaa",
          stale: true,
          staleInfo: { merged: true, idleDays: 2, stale: true },
        },
      ]),
    );
    await useWorktreeStore.getState().refreshLight();

    const persisted = loadVerdictCache();
    expect(persisted[`/w/${PROJECT}/merged-task`]).toEqual({
      head: "aaa",
      stale: true,
      staleInfo: { merged: true, idleDays: 2, stale: true },
    });
  });

  it("verdict 없는 light 응답(구 preload)은 unknown 으로 남고 숨기지 않는다", async () => {
    listLightMock.mockResolvedValueOnce(
      lightGroup([
        { path: `/w/${PROJECT}/t1`, branch: "marblo/t1", head: "ccc" },
      ]),
    );
    await useWorktreeStore.getState().refreshLight();

    const [wt0] = useWorktreeStore.getState().worktrees;
    expect(isVerdictUnknown(wt0)).toBe(true);
    // 판정 불가를 아카이브로 취급하면 살아있는 작업까지 숨는다 — 보이게 둔다.
    expect(isWorktreeArchived(wt0, {})).toBe(false);
    expect(countUnknownVerdicts(useWorktreeStore.getState().worktrees)).toBe(1);
  });

  it("light 의 최신 verdict 가 오래된 캐시보다 우선한다 (같은 HEAD, 판정이 뒤집힌 경우)", async () => {
    saveVerdictCache({
      [`/w/${PROJECT}/t1`]: {
        head: "ddd",
        stale: false,
        staleInfo: { merged: false, idleDays: 0, stale: false },
      },
    });

    listLightMock.mockResolvedValueOnce(
      lightGroup([
        {
          path: `/w/${PROJECT}/t1`,
          branch: "marblo/t1",
          head: "ddd",
          stale: true,
          staleInfo: { merged: true, idleDays: 1, stale: true },
        },
      ]),
    );
    await useWorktreeStore.getState().refreshLight();

    const [wt0] = useWorktreeStore.getState().worktrees;
    expect(wt0.staleInfo).toEqual({ merged: true, idleDays: 1, stale: true });
    expect(isWorktreeArchived(wt0, {})).toBe(true);
  });
});
