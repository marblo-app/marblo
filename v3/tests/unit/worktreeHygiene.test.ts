import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  archiveReason,
  isActiveOngoingWorktree,
  isAutoArchived,
  isWorktreeArchived,
  loadArchiveOverrides,
  persistArchiveOverrides,
  setOverride,
  worktreeKey,
  type ArchiveOverrides,
} from "../../src/lib/worktreeHygiene";
import type { Worktree, WorktreeStaleInfo } from "../../src/types/worktree";

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
