import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveReason,
  archiveSafetyBlocker,
  isActiveOngoingWorktree,
  isAutoArchived,
  isWorktreeArchived,
  loadArchiveOverrides,
  persistArchiveOverrides,
  setOverride,
  worktreeKey,
  LEGACY_IDLE_ARCHIVE_DAYS,
  type ArchiveOverrides,
  type ArchiveSignals,
} from "../../src/lib/worktreeHygiene";
import type {
  Worktree,
  WorktreeStaleInfo,
  WorktreeStatus,
} from "../../src/types/worktree";

// The lib reads/writes bare `localStorage` (a renderer global). Tests run in the
// `node` environment (vitest.config.ts), so provide an in-memory stand-in on the
// global scope — matching the `vi.stubGlobal` pattern in terminalPersist.test.ts.
const store: Record<string, string> = {};
vi.stubGlobal("localStorage", {
  getItem: (k: string) => (k in store ? store[k] : null),
  setItem: (k: string, v: string) => {
    store[k] = String(v);
  },
  removeItem: (k: string) => {
    delete store[k];
  },
  clear: () => {
    for (const k of Object.keys(store)) delete store[k];
  },
});

function wt(partial: Partial<Worktree>): Worktree {
  return {
    id: "wt1",
    taskId: "T1",
    projectId: "p1",
    agentId: null,
    branch: "marblo/x",
    baseRef: "main",
    path: "/repo/.worktrees/x",
    repoRoot: "/repo",
    createdAt: null,
    ...partial,
  };
}

function stale(partial: Partial<WorktreeStaleInfo>): WorktreeStaleInfo {
  return { merged: false, idleDays: 0, stale: false, ...partial };
}

function status(partial: Partial<WorktreeStatus> = {}): WorktreeStatus {
  return {
    branch: "marblo/x",
    baseRef: "main",
    ahead: 0,
    behind: 0,
    dirty: false,
    mergeable: true,
    conflicts: [],
    filesChanged: 0,
    insertions: 0,
    deletions: 0,
    ...partial,
  };
}

describe("isAutoArchived", () => {
  it("archives a merged worktree", () => {
    expect(
      isAutoArchived(wt({ staleInfo: stale({ merged: true, stale: true }) })),
    ).toBe(true);
  });

  it("archives an idle-stale (not merged) worktree", () => {
    expect(
      isAutoArchived(
        wt({ staleInfo: stale({ merged: false, idleDays: 30, stale: true }) }),
      ),
    ).toBe(true);
  });

  it("falls back to the flat `stale` flag when staleInfo is absent", () => {
    expect(isAutoArchived(wt({ stale: true }))).toBe(true);
  });

  it("keeps an active worktree out of the archive", () => {
    expect(isAutoArchived(wt({ staleInfo: stale({}), stale: false }))).toBe(
      false,
    );
    expect(isAutoArchived(wt({}))).toBe(false);
  });
});

describe("archiveReason", () => {
  it("reports 'merged' for a merged worktree even when stale is also set", () => {
    expect(
      archiveReason(wt({ staleInfo: stale({ merged: true, stale: true }) })),
    ).toBe("merged");
  });

  it("reports 'stale' for an idle worktree", () => {
    expect(
      archiveReason(wt({ staleInfo: stale({ idleDays: 30, stale: true }) })),
    ).toBe("stale");
  });

  it("reports 'stale' from the flat flag when staleInfo is absent", () => {
    expect(archiveReason(wt({ stale: true }))).toBe("stale");
  });

  it("returns null for an active worktree", () => {
    expect(archiveReason(wt({}))).toBeNull();
  });
});

describe("isWorktreeArchived — manual override wins over the auto verdict", () => {
  it("a manual 'active' override un-hides a merged worktree", () => {
    const merged = wt({
      path: "/repo/.worktrees/m",
      staleInfo: stale({ merged: true, stale: true }),
    });
    const overrides: ArchiveOverrides = { "/repo/.worktrees/m": "active" };
    expect(isWorktreeArchived(merged, overrides)).toBe(false);
  });

  it("a manual 'archived' override hides an otherwise-active worktree", () => {
    const active = wt({ path: "/repo/.worktrees/a" });
    const overrides: ArchiveOverrides = { "/repo/.worktrees/a": "archived" };
    expect(isWorktreeArchived(active, overrides)).toBe(true);
  });

  it("with no override, uses the auto verdict", () => {
    expect(isWorktreeArchived(wt({ stale: true }), {})).toBe(true);
    expect(isWorktreeArchived(wt({}), {})).toBe(false);
  });
});

describe("isActiveOngoingWorktree", () => {
  it("accepts an ongoing task worktree", () => {
    expect(
      isActiveOngoingWorktree(wt({ taskId: "T1", stale: false }), {}),
    ).toBe(true);
  });

  it("rejects an ad-hoc worktree with no taskId", () => {
    expect(isActiveOngoingWorktree(wt({ taskId: null }), {})).toBe(false);
  });

  it("rejects a merged/stale task worktree", () => {
    expect(isActiveOngoingWorktree(wt({ taskId: "T1", stale: true }), {})).toBe(
      false,
    );
  });

  it("re-accepts a restored (manual 'active') merged worktree", () => {
    const merged = wt({
      path: "/repo/.worktrees/m",
      taskId: "T1",
      stale: true,
    });
    expect(
      isActiveOngoingWorktree(merged, { "/repo/.worktrees/m": "active" }),
    ).toBe(true);
  });

  it("still rejects a restored worktree that has no taskId", () => {
    const adhoc = wt({
      path: "/repo/.worktrees/adhoc",
      taskId: null,
      stale: true,
    });
    expect(
      isActiveOngoingWorktree(adhoc, { "/repo/.worktrees/adhoc": "active" }),
    ).toBe(false);
  });
});

describe("setOverride", () => {
  it("adds an override immutably", () => {
    const base: ArchiveOverrides = {};
    const next = setOverride(base, "/a", "archived");
    expect(next).toEqual({ "/a": "archived" });
    expect(base).toEqual({});
  });

  it("clears an override when passed null", () => {
    const next = setOverride({ "/a": "archived", "/b": "active" }, "/a", null);
    expect(next).toEqual({ "/b": "active" });
  });

  it("overwrites an existing override", () => {
    const next = setOverride({ "/a": "archived" }, "/a", "active");
    expect(next).toEqual({ "/a": "active" });
  });
});

/**
 * ★ 이 블록이 이 파일에서 가장 중요하다 (티켓 MT2ny8ng).
 *
 * 아카이브는 삭제가 아니라 숨김이지만, 숨겨지면 사용자는 자기 작업을 잃어버린다.
 * 그래서 dirty / unpushed / busy 는 "개수를 줄인다" 는 목적보다 우선하며,
 * 어떤 임계값에서도, merged·DONE 을 포함한 어떤 아카이브 신호에 대해서도
 * 자동 아카이브를 거부해야 한다. 개수 감소 테스트가 이 테스트와 충돌하면
 * 이기는 쪽은 항상 이쪽이다.
 *
 * 실측 근거 (135개 라이브 워크트리, 임계값 14→5 하향 시점):
 * 새로 숨겨질 dirty 10개가 전부 ahead==0 (푸시 완료) 이었다. 즉 unpushed 가드는
 * dirty 를 대신 막아주지 못한다 — 둘은 독립이고 둘 다 필요하다.
 */
describe("★ archiveSafetyBlocker — dirty/unpushed/busy 는 절대 자동 아카이브되지 않는다", () => {
  const BLOCKED: { name: string; patch: Partial<Worktree> }[] = [
    {
      name: "dirty (커밋 안 된 변경)",
      patch: { status: status({ dirty: true }) },
    },
    {
      name: "unpushed (로컬에만 있는 커밋)",
      patch: {
        staleInfo: stale({ idleDays: 999, stale: true, unpushed: true }),
      },
    },
    { name: "busy (에이전트가 붙어 있음)", patch: { agentId: "agent-1" } },
  ];

  // 아카이브를 유발할 수 있는 모든 신호. 가드는 이 전부를 이겨야 한다.
  const ARCHIVE_SIGNALS: {
    name: string;
    patch: Partial<Worktree>;
    signals: ArchiveSignals;
  }[] = [
    {
      name: "merged",
      patch: { staleInfo: stale({ merged: true, stale: true }) },
      signals: {},
    },
    {
      name: "DONE 티켓",
      patch: {},
      signals: { doneTaskIds: new Set(["T1"]) },
    },
    {
      name: "idle 999일 (어떤 임계값도 초과)",
      patch: {
        status: status(),
        staleInfo: stale({ idleDays: 999, stale: true }),
      },
      signals: {},
    },
    {
      name: "flat stale 플래그",
      patch: { stale: true },
      signals: {},
    },
  ];

  for (const blocked of BLOCKED) {
    for (const signal of ARCHIVE_SIGNALS) {
      it(`${blocked.name} 은 '${signal.name}' 신호에도 아카이브되지 않는다`, () => {
        const worktree = wt({
          taskId: "T1",
          ...signal.patch,
          ...blocked.patch,
          // staleInfo 를 양쪽이 건드리면 blocked 쪽 의도가 지워지므로 병합한다.
          staleInfo:
            blocked.patch.staleInfo && signal.patch.staleInfo
              ? { ...signal.patch.staleInfo, ...blocked.patch.staleInfo }
              : (blocked.patch.staleInfo ?? signal.patch.staleInfo),
        });
        expect(isAutoArchived(worktree, signal.signals)).toBe(false);
        expect(isWorktreeArchived(worktree, {}, signal.signals)).toBe(false);
        // 그리고 루트 셀렉터에 계속 보여야 한다 — 이게 실제 사용자 영향이다.
        expect(isActiveOngoingWorktree(worktree, {}, signal.signals)).toBe(
          true,
        );
      });
    }
  }

  it("blocker 를 종류별로 정확히 지목한다", () => {
    expect(archiveSafetyBlocker(wt({ status: status({ dirty: true }) }))).toBe(
      "dirty",
    );
    expect(
      archiveSafetyBlocker(wt({ staleInfo: stale({ unpushed: true }) })),
    ).toBe("unpushed");
    expect(archiveSafetyBlocker(wt({ agentId: "a1" }))).toBe("busy");
    expect(
      archiveSafetyBlocker(wt({ taskId: "T1" }), {
        busyTaskIds: new Set(["T1"]),
      }),
    ).toBe("busy");
    expect(archiveSafetyBlocker(wt({ status: status() }))).toBeNull();
  });

  it("깨끗함이 '증명된' 워크트리는 정상적으로 아카이브된다 (가드가 전부를 막지는 않는다)", () => {
    const clean = wt({
      taskId: "T1",
      status: status({ dirty: false }),
      staleInfo: stale({ idleDays: 30, stale: true, unpushed: false }),
    });
    expect(archiveSafetyBlocker(clean)).toBeNull();
    expect(isAutoArchived(clean)).toBe(true);
  });

  it("★수동 아카이브는 가드를 넘어선다 — 사용자가 스스로 숨기는 건 사고가 아니라 선택", () => {
    const dirty = wt({
      path: "/repo/.worktrees/d",
      status: status({ dirty: true }),
    });
    expect(
      isWorktreeArchived(dirty, { "/repo/.worktrees/d": "archived" }),
    ).toBe(true);
  });
});

describe("DONE 티켓 신호 — 시간이 아니라 의미로 판정", () => {
  const done: ArchiveSignals = { doneTaskIds: new Set(["T-done"]) };

  it("티켓이 DONE 이면 idle 0일이어도 아카이브한다", () => {
    const fresh = wt({
      taskId: "T-done",
      status: status(),
      staleInfo: stale({ idleDays: 0, stale: false }),
    });
    expect(isAutoArchived(fresh, done)).toBe(true);
    expect(archiveReason(fresh, done)).toBe("done");
  });

  it("DONE 이 아닌 티켓은 아카이브하지 않는다", () => {
    const open = wt({
      taskId: "T-open",
      status: status(),
      staleInfo: stale({ idleDays: 0, stale: false }),
    });
    expect(isAutoArchived(open, done)).toBe(false);
  });

  it("signals 가 없으면 (신호 미주입) 아무 동작도 하지 않는다 — 기존 호출자 무해", () => {
    const fresh = wt({ taskId: "T-done", staleInfo: stale({ idleDays: 0 }) });
    expect(isAutoArchived(fresh)).toBe(false);
  });

  it("taskId 가 없는 ad-hoc 워크트리는 DONE 조회 대상이 아니다", () => {
    const adhoc = wt({ taskId: null, staleInfo: stale({ idleDays: 0 }) });
    expect(isAutoArchived(adhoc, { doneTaskIds: new Set([""]) })).toBe(false);
  });

  it("DONE 이라도 dirty 면 아카이브하지 않고, 사유 배지도 달지 않는다", () => {
    const dirtyDone = wt({ taskId: "T-done", status: status({ dirty: true }) });
    expect(isAutoArchived(dirtyDone, done)).toBe(false);
    expect(archiveReason(dirtyDone, done)).toBeNull();
  });
});

/**
 * idle 밴드: 새로 공격적이 된 5~13일 구간은 dirty 를 실제로 볼 수 있을 때(status
 * 존재)만 숨긴다. 라이트 경로(status 없음)에는 dirty 증거가 없고, 워크트리마다
 * status 를 프로브하는 건 #511 이 제거한 per-worktree spawn 패턴 그 자체다
 * (실측: 리포단위 2 spawn 52ms vs status 135 spawn 960ms).
 * 14일 이상은 종전 동작 그대로 — 이 변경으로 새로 위험해지는 구간이 아니다.
 */
describe("idle 밴드 — 증거 없이는 공격적으로 숨기지 않는다", () => {
  it("5~13일 + status 있음(clean 확인됨) → 아카이브", () => {
    const seen = wt({
      status: status({ dirty: false }),
      staleInfo: stale({ idleDays: 7, stale: true }),
    });
    expect(isAutoArchived(seen)).toBe(true);
  });

  it("★5~13일 + status 없음(dirty 알 수 없음) → 노출 유지", () => {
    const unseen = wt({ staleInfo: stale({ idleDays: 7, stale: true }) });
    expect(isAutoArchived(unseen)).toBe(false);
  });

  it("14일 이상은 status 가 없어도 아카이브 — 종전 동작 유지", () => {
    const old = wt({
      staleInfo: stale({ idleDays: LEGACY_IDLE_ARCHIVE_DAYS, stale: true }),
    });
    expect(isAutoArchived(old)).toBe(true);
  });

  it("임계값 미만은 status 유무와 무관하게 노출", () => {
    expect(
      isAutoArchived(
        wt({
          status: status(),
          staleInfo: stale({ idleDays: 3, stale: false }),
        }),
      ),
    ).toBe(false);
  });

  it("merged 는 밴드와 무관하게 아카이브 — base 에 이미 있으므로 잃을 게 없다", () => {
    const merged = wt({
      staleInfo: stale({ merged: true, stale: true, idleDays: 0 }),
    });
    expect(isAutoArchived(merged)).toBe(true);
  });
});

describe("worktreeKey", () => {
  it("keys off the worktree path", () => {
    expect(worktreeKey({ path: "/repo/.worktrees/x" })).toBe(
      "/repo/.worktrees/x",
    );
  });
});

describe("load / persist overrides (localStorage round-trip)", () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it("returns an empty map when nothing is stored", () => {
    expect(loadArchiveOverrides()).toEqual({});
  });

  it("round-trips a persisted map", () => {
    persistArchiveOverrides({ "/a": "archived", "/b": "active" });
    expect(loadArchiveOverrides()).toEqual({
      "/a": "archived",
      "/b": "active",
    });
  });

  it("drops corrupt / unknown values on load", () => {
    localStorage.setItem(
      "marblo.worktree.archiveOverrides.v1",
      JSON.stringify({ "/a": "archived", "/b": "bogus", "/c": 3 }),
    );
    expect(loadArchiveOverrides()).toEqual({ "/a": "archived" });
  });

  it("returns an empty map when the stored value is not valid JSON", () => {
    localStorage.setItem("marblo.worktree.archiveOverrides.v1", "not json{");
    expect(loadArchiveOverrides()).toEqual({});
  });
});
