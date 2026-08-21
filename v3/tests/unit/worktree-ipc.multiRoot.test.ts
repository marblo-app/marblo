import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";

import {
  registerWorktreeIpc,
  type WorktreeCoverage,
  type WorktreeProjectGroup,
  type WorktreeProjectRoot,
} from "../../electron/worktree-ipc";
import type {
  WorktreeManager,
  WorktreeStatus,
} from "../../electron/worktree-manager";

const PROJECT = "P1";

let tmp: string;
let pool: string;
/** The clone the app remembers (connections.json / app-state.json). */
let bound: string;
/** The clone that actually owns most of the pool. */
let other: string;

type Handler = (event: unknown, args: unknown) => unknown;

/** Minimal IpcMain double: records handlers so a test can invoke them. */
function fakeIpcMain() {
  const handlers = new Map<string, Handler>();
  return {
    ipcMain: {
      handle: (channel: string, handler: Handler) => {
        handlers.set(channel, handler);
      },
    },
    invoke: (channel: string, args?: unknown) => {
      const handler = handlers.get(channel);
      if (!handler) throw new Error(`no handler for ${channel}`);
      return handler(undefined, args);
    },
  };
}

const status = (branch: string): WorktreeStatus => ({
  branch,
  baseRef: "main",
  ahead: 0,
  behind: 0,
  dirty: false,
  mergeable: true,
  conflicts: [],
  filesChanged: 0,
  insertions: 0,
  deletions: 0,
});

/**
 * Stub manager that answers `list` the way git does: only worktrees registered
 * in the queried clone. This is the behaviour that made the bug invisible —
 * asking the wrong clone is not an error, it is a short, successful answer.
 */
function stubManager(registry: Map<string, string[]>): WorktreeManager {
  return {
    getWorktreesRoot: () => pool,
    resolveBaseRef: async () => "main",
    list: async (repoRoot: string) =>
      (registry.get(repoRoot) ?? []).map((p) => ({
        path: p,
        branch: path.basename(p),
        head: `head-${path.basename(p)}`,
      })),
    status: async (p: string) => status(path.basename(p)),
    staleInfo: async () => ({ stale: false }),
    staleInfoByHead: async () => new Map(),
  } as unknown as WorktreeManager;
}

function makeWorktree(name: string, owner: string): string {
  const dir = path.join(pool, PROJECT, name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(
    path.join(dir, ".git"),
    `gitdir: ${path.join(owner, ".git", "worktrees", name)}\n`,
    "utf-8",
  );
  return dir;
}

beforeEach(() => {
  tmp = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), "wt-ipc-multi-")),
  );
  pool = path.join(tmp, "pool");
  bound = path.join(tmp, "bound-clone");
  other = path.join(tmp, "other-clone");
  fs.mkdirSync(bound, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
});

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("worktree IPC across multiple owning clones (ticket NHCsWfnp)", () => {
  it("lists worktrees from EVERY owning clone, not just the bound one", async () => {
    const boundPaths = [makeWorktree("b1", bound), makeWorktree("b2", bound)];
    const otherPaths = [
      makeWorktree("o1", other),
      makeWorktree("o2", other),
      makeWorktree("o3", other),
    ];
    const registry = new Map([
      [bound, [bound, ...boundPaths]],
      [other, [other, ...otherPaths]],
    ]);

    // Both roots are supplied, as main.ts now does after recovering owners
    // from the pool's gitdir pointers.
    const roots: WorktreeProjectRoot[] = [
      { projectId: PROJECT, repoRoot: bound },
      { projectId: PROJECT, repoRoot: other },
    ];

    const { ipcMain, invoke } = fakeIpcMain();
    registerWorktreeIpc(ipcMain as never, stubManager(registry), () => roots);

    const groups = (await invoke("worktree:list")) as WorktreeProjectGroup[];

    expect(groups).toHaveLength(2);
    const listed = groups.flatMap((g) => g.worktrees.map((w) => w.path));
    // All five task worktrees reach the renderer — the regression was that
    // only the bound clone's two ever did.
    for (const p of [...boundPaths, ...otherPaths]) expect(listed).toContain(p);
  });

  it("coverage reports zero missing once every owner is enumerated", async () => {
    const boundPaths = [makeWorktree("b1", bound)];
    const otherPaths = [makeWorktree("o1", other), makeWorktree("o2", other)];
    const registry = new Map([
      [bound, [bound, ...boundPaths]],
      [other, [other, ...otherPaths]],
    ]);

    const { ipcMain, invoke } = fakeIpcMain();
    registerWorktreeIpc(ipcMain as never, stubManager(registry), () => [
      { projectId: PROJECT, repoRoot: bound },
      { projectId: PROJECT, repoRoot: other },
    ]);

    const [coverage] = (await invoke(
      "worktree:coverage",
    )) as WorktreeCoverage[];

    expect(coverage.onDisk).toBe(3);
    expect(coverage.missing).toBe(0);
    expect(coverage.unreachableRoots).toEqual([]);
  });

  it("coverage exposes the loss when an owning clone is NOT enumerated", async () => {
    // Exactly the production shape: the pool is split, but only the bound
    // clone is a known project root. The list succeeds and is short — so the
    // filter banner sees nothing wrong. Coverage is what makes it visible.
    const boundPaths = [makeWorktree("b1", bound)];
    for (let i = 0; i < 7; i++) makeWorktree(`o${i}`, other);
    const registry = new Map([[bound, [bound, ...boundPaths]]]);

    const { ipcMain, invoke } = fakeIpcMain();
    registerWorktreeIpc(ipcMain as never, stubManager(registry), () => [
      { projectId: PROJECT, repoRoot: bound },
    ]);

    const groups = (await invoke("worktree:list")) as WorktreeProjectGroup[];
    const [coverage] = (await invoke(
      "worktree:coverage",
    )) as WorktreeCoverage[];

    // The list itself looks perfectly healthy — no error, no empty result.
    expect(groups).toHaveLength(1);
    expect(coverage.onDisk).toBe(8);
    expect(coverage.listed).toBe(2); // main + b1
    expect(coverage.missing).toBe(7);
    expect(coverage.unreachableRoots).toEqual([other]);
  });

  it("does not call a stray leftover folder a missing worktree", async () => {
    // A leftover directory in the pool is not a worktree and never will be.
    // Counting it as "missing" would raise an alarm no action can clear — a
    // smaller version of the wrong-cause problem this banner exists to fix.
    makeWorktree("b1", bound);
    fs.mkdirSync(path.join(pool, PROJECT, "stray"), { recursive: true });
    const registry = new Map([
      [bound, [bound, path.join(pool, PROJECT, "b1")]],
    ]);

    const { ipcMain, invoke } = fakeIpcMain();
    registerWorktreeIpc(ipcMain as never, stubManager(registry), () => [
      { projectId: PROJECT, repoRoot: bound },
    ]);

    const [coverage] = (await invoke(
      "worktree:coverage",
    )) as WorktreeCoverage[];

    expect(coverage.onDisk).toBe(2);
    expect(coverage.missing).toBe(0);
    expect(coverage.strayDirs).toBe(1);
  });
});
