import fs from "fs";
import path from "path";

/**
 * Recover which clone actually OWNS each task worktree.
 *
 * ── Why this exists (ticket NHCsWfnp) ──────────────────────────────────────
 * The worktree pool is keyed by projectId (`<pool>/<projectId>/<taskId>`), but
 * a worktree is registered in whichever *clone* created it. Those two facts
 * drift apart the moment a project is re-bound to a second clone of the same
 * repo: the pool keeps filling one directory while `git worktree list` answers
 * from only the currently-bound clone.
 *
 * Measured instance: 81 directories under one projectId, split 74 /
 * `~/Documents/programming/marblo` + 7 / `~/Marblo/marblo`. Every project-root
 * source in main.ts (`app-state.json`, `connections.json`, orchestrator session
 * roots) named only the second clone, so the tab enumerated 7 and the other 74
 * were never listed — not filtered, never fetched.
 *
 * A worktree checkout's `.git` is a FILE holding `gitdir: <clone>/.git/worktrees/<name>`.
 * That pointer is git's own ownership record, written at creation and updated by
 * `git worktree move`/`repair`, so it cannot drift from the truth the way a
 * remembered project path can. Reading it back is how we recover every clone
 * that hosts worktrees for a project instead of trusting a single stored root.
 */

/** A clone that owns at least one task worktree for the project. */
export interface DiscoveredWorktreeRoot {
  /** Absolute path to the owning clone's working tree. */
  repoRoot: string;
  /** How many pool directories point at this clone. */
  worktreeCount: number;
  /** False when the clone itself is gone from disk (dangling pointer). */
  exists: boolean;
}

/** One pool directory that really is a linked worktree, and its owning clone. */
export interface OwnedWorktreeDir {
  dir: string;
  repoRoot: string;
}

export interface WorktreeRootDiscovery {
  projectId: string;
  /** Pool directories inspected (`<pool>/<projectId>/*`). */
  onDiskCount: number;
  /**
   * Directories that carry a git ownership pointer — i.e. the ones that a
   * `git worktree list` can be expected to report. Callers comparing "on disk"
   * against "on screen" must diff against THIS, not against every directory:
   * a stray folder in the pool is not a worktree, and reporting it as a missing
   * one would be its own small lie.
   */
  owned: OwnedWorktreeDir[];
  /** Owning clones, most-worktrees first. */
  roots: DiscoveredWorktreeRoot[];
  /**
   * Pool directories whose owner could not be recovered — no `.git`, an
   * unreadable one, or a pointer that does not name a worktree. These can never
   * appear in any `git worktree list`, so a caller reporting coverage must
   * account for them separately rather than blaming a filter.
   */
  unresolved: string[];
}

/** `gitdir: /clone/.git/worktrees/<name>` → `/clone`. Null if not that shape. */
export function repoRootFromGitdirPointer(
  pointer: string,
  worktreeDir: string
): string | null {
  const raw = pointer.replace(/^gitdir:\s*/, "").trim();
  if (!raw) return null;
  // Git normally writes an absolute path; a relative one is anchored at the
  // worktree directory that contained the pointer.
  const abs = path.isAbsolute(raw) ? raw : path.resolve(worktreeDir, raw);
  const normalized = abs.replace(/\/+$/, "");
  const marker = `${path.sep}.git${path.sep}worktrees${path.sep}`;
  const at = normalized.lastIndexOf(marker);
  if (at <= 0) return null;
  return normalized.slice(0, at);
}

/**
 * Read one pool directory's ownership pointer. Returns null when the directory
 * is not a linked worktree (no `.git` file, or `.git` is a real directory —
 * i.e. a nested standalone clone, which no `git worktree list` would report).
 */
function ownerOf(worktreeDir: string): string | null {
  const dotGit = path.join(worktreeDir, ".git");
  let stat: fs.Stats;
  try {
    stat = fs.statSync(dotGit);
  } catch {
    return null;
  }
  if (!stat.isFile()) return null;
  try {
    return repoRootFromGitdirPointer(
      fs.readFileSync(dotGit, "utf-8"),
      worktreeDir
    );
  } catch {
    return null;
  }
}

/**
 * Enumerate every clone that owns a task worktree for `projectId`.
 *
 * Never throws: a missing pool, an unreadable directory, or a corrupt pointer
 * degrades to fewer discovered roots, never to a failed worktree listing.
 */
export function discoverWorktreeRoots(
  worktreesRoot: string,
  projectId: string
): WorktreeRootDiscovery {
  const empty: WorktreeRootDiscovery = {
    projectId,
    onDiskCount: 0,
    owned: [],
    roots: [],
    unresolved: [],
  };
  if (!projectId) return empty;

  const projectPool = path.join(worktreesRoot, projectId);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(projectPool, { withFileTypes: true });
  } catch {
    return empty;
  }

  const counts = new Map<string, number>();
  const owned: OwnedWorktreeDir[] = [];
  const unresolved: string[] = [];
  let onDiskCount = 0;

  for (const entry of entries) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue;
    const dir = path.join(projectPool, entry.name);
    onDiskCount += 1;
    const owner = ownerOf(dir);
    if (!owner) {
      unresolved.push(dir);
      continue;
    }
    owned.push({ dir, repoRoot: owner });
    counts.set(owner, (counts.get(owner) ?? 0) + 1);
  }

  const roots: DiscoveredWorktreeRoot[] = Array.from(counts.entries())
    .map(([repoRoot, worktreeCount]) => ({
      repoRoot,
      worktreeCount,
      exists: fs.existsSync(repoRoot),
    }))
    .sort(
      (a, b) =>
        b.worktreeCount - a.worktreeCount ||
        a.repoRoot.localeCompare(b.repoRoot)
    );

  return { projectId, onDiskCount, owned, roots, unresolved };
}
