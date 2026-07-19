import type { Worktree } from "../types/worktree";
import {
  isActiveOngoingWorktree,
  type ArchiveOverrides,
  type ArchiveSignals,
} from "./worktreeHygiene";

/**
 * Pure helpers backing the FileTree sidebar header.
 *
 * The sidebar tree follows `editorStore.rootPath`, which switches as the user
 * activates a task / worktree / project. Because a worktree's basename is
 * often a generated id, the header must spell out *which* root is currently
 * being viewed so a worktree switch is unmistakable.
 */

export type RootKind = "project" | "worktree" | "folder";

export interface RootView {
  /** Short label for the header (worktree branch, else basename). */
  label: string;
  /** Absolute path currently being viewed. */
  fullPath: string;
  /** How this root relates to the active project. */
  kind: RootKind;
  /** Secondary detail for a worktree (task id, when present). */
  detail?: string;
}

function basename(p: string): string {
  // Handle both POSIX (/) and Windows (\) separators so native Windows paths
  // collapse to their last segment instead of returning the whole path.
  return (
    p
      .replace(/[\\/]+$/, "")
      .split(/[\\/]/)
      .pop() || p
  );
}

/** Strip trailing separators so "/repo" and "/repo/" compare equal. */
function normalizePath(p: string): string {
  return p.replace(/[\\/]+$/, "");
}

/**
 * Tolerant path equality for the sidebar's root bookkeeping.
 *
 * Only normalises trailing separators — it deliberately does NOT resolve
 * symlinks (the renderer can't) — but it is the single chokepoint every path
 * comparison in this module now flows through, so the symlink-aware matching we
 * layer on top (recognising the project folder as the main checkout even when
 * git realpath'd it) lives in one place. See {@link findMainWorktree}.
 */
function samePath(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  return normalizePath(a) === normalizePath(b);
}

/** True when `child` is `parent` itself or nested beneath it. */
function isInsidePath(child: string, parent: string): boolean {
  const c = normalizePath(child);
  const p = normalizePath(parent);
  return c === p || c.startsWith(`${p}/`) || c.startsWith(`${p}\\`);
}

/**
 * Locate the repo's *main* working tree in a worktree list.
 *
 * The main checkout is the entry with no inferred task id (task worktrees live
 * under `.../<projectId>/<taskId>`, so `inferTaskId` populates theirs; the main
 * checkout's path doesn't contain the project id, so its taskId stays null).
 *
 * This is load-bearing for multi-machine correctness: `worktree-manager.list`
 * realpaths every entry (symlinks resolved), while `rootPath` / `projectRootPath`
 * arrive raw (a folder-picker / Firestore path with symlinks intact). So we
 * canNOT rely on `path === repoRoot`; on a machine whose checkout sits behind a
 * symlink that equality never holds and the main checkout was going undetected —
 * the root cause of the "ROOT" header + dead home button. Keying off taskId
 * finds it regardless of symlink layout; the folderPath / repoRoot matches below
 * are only *preferences* to disambiguate when several taskId-less entries exist
 * (e.g. ad-hoc `.claude/worktrees/*` branches that also lack a task id).
 */
export function findMainWorktree(
  worktrees: Worktree[],
  projectRootPath: string | null,
): Worktree | null {
  const resolved = resolveMainWorktree(worktrees, projectRootPath);
  return resolved.ok ? resolved.worktree : null;
}

/**
 * Why a "home" target could not be determined. Surfaced to the UI so an
 * unresolvable main is *visible* instead of silently redirecting the user
 * somewhere wrong — the failure mode this module has now regressed into twice
 * (#307's dead home button, and the home-goes-to-another-worktree report this
 * resolution was written for).
 */
export type MainResolutionFailure =
  /** No worktrees are known for this project yet (list not loaded / empty). */
  | "no-worktrees"
  /**
   * Several candidates and nothing distinguishes one as main — git's `isMain`
   * flag is absent (pre-flag snapshot) and no candidate matches the project
   * folder. Previously this silently returned `mains[0]`.
   */
  | "ambiguous";

export type MainResolution =
  | { ok: true; worktree: Worktree }
  | { ok: false; reason: MainResolutionFailure };

/**
 * Resolve the repo's main working tree, or say why it can't be.
 *
 * Resolution order, strongest evidence first:
 *
 *  1. `isMain` — git's own answer, stamped from `git worktree list` order by
 *     the store's normalizers (both the full and the light/#495 path). This is
 *     the only *authoritative* signal and it short-circuits everything below.
 *  2. The entry matching `projectRootPath` among taskId-less candidates —
 *     a path preference, kept for snapshots that predate `isMain`.
 *  3. A single remaining candidate — unambiguous by construction.
 *
 * What it deliberately does NOT do any more:
 *
 *  - Match `path === repoRoot`. `repoRoot` is not git's main worktree; it is
 *    whatever session root the main process reported (an orchestrator session
 *    rootPath, which is frequently a *task worktree*). That comparison actively
 *    elected task worktrees as "main".
 *  - Fall back to `mains[0]`. With the projectId absent from the worktree paths
 *    `inferTaskId` returns null for *every* entry, so that index was an
 *    arbitrary worktree presented as the home target with no evidence at all.
 */
export function resolveMainWorktree(
  worktrees: Worktree[],
  projectRootPath: string | null,
): MainResolution {
  if (worktrees.length === 0) return { ok: false, reason: "no-worktrees" };

  // (1) Authoritative: git listed this entry first. Duplicate groups (same
  // projectId enumerated under two repoRoots) can flag the same path twice, so
  // prefer the project-folder match before falling back to the first flag.
  const flagged = worktrees.filter((w) => w.isMain);
  if (flagged.length > 0) {
    const byProject = projectRootPath
      ? flagged.find((w) => samePath(w.path, projectRootPath))
      : undefined;
    return { ok: true, worktree: byProject ?? flagged[0] };
  }

  // (2)/(3) Pre-flag snapshot: fall back to path evidence only.
  const candidates = worktrees.filter((w) => w.taskId == null);
  if (candidates.length === 0) return { ok: false, reason: "ambiguous" };
  if (projectRootPath) {
    const byProject = candidates.find((w) => samePath(w.path, projectRootPath));
    if (byProject) return { ok: true, worktree: byProject };
  }
  if (candidates.length === 1) return { ok: true, worktree: candidates[0] };
  return { ok: false, reason: "ambiguous" };
}

/**
 * The "home" target, or why there isn't one.
 *
 * Mirrors {@link resolveLocalMainPath} but keeps the failure explicit: when no
 * main worktree can be identified we fall back to the Firestore
 * `projectRootPath` *only when it exists locally as a known root*, and
 * otherwise report the failure instead of navigating somewhere arbitrary.
 */
export function resolveLocalMainTarget(
  worktrees: Worktree[],
  projectRootPath: string | null,
): { ok: true; path: string } | { ok: false; reason: MainResolutionFailure } {
  const resolved = resolveMainWorktree(worktrees, projectRootPath);
  if (resolved.ok) return { ok: true, path: resolved.worktree.path };
  // No local main entry — the Firestore project folder is the only remaining
  // candidate. It is a *foreign-machine* path as often as not (folderPath is
  // written by whichever machine registered the project), so it is a fallback,
  // never a preference.
  if (projectRootPath) return { ok: true, path: projectRootPath };
  return { ok: false, reason: resolved.reason };
}

/**
 * This machine's canonical main-checkout path — the target a "home" reset must
 * land on. Prefers the local worktree list's main entry (git-realpath'd, so it
 * always matches the tree the app actually loads); falls back to the Firestore
 * `projectRootPath` only when no local main entry is known.
 */
export function resolveLocalMainPath(
  worktrees: Worktree[],
  projectRootPath: string | null,
): string | null {
  const target = resolveLocalMainTarget(worktrees, projectRootPath);
  return target.ok ? target.path : null;
}

export function filterWorktreesByProject(
  worktrees: Worktree[],
  projectId: string | null | undefined,
): Worktree[] {
  if (!projectId) return [];
  return worktrees.filter((worktree) => worktree.projectId === projectId);
}

/**
 * Describe the root the tree is currently showing.
 *
 * - matches a known worktree  → kind "worktree" (label = branch, detail = taskId)
 * - is the main checkout       → kind "worktree" (main branch), even when reached
 *   via a non-canonical/symlinked path that the exact match above misses
 * - equals the project folder  → kind "project" (no worktree list available)
 * - anything else              → kind "folder"
 */
export function describeRootView(
  rootPath: string | null,
  worktrees: Worktree[],
  projectRootPath: string | null,
): RootView | null {
  if (!rootPath) return null;
  const base = basename(rootPath);

  const worktree = worktrees.find((w) => samePath(w.path, rootPath));
  if (worktree) {
    return {
      label: worktree.branch || base,
      fullPath: rootPath,
      kind: "worktree",
      detail: worktree.taskId ?? undefined,
    };
  }

  // The project folder IS the repo's main working tree. When rootPath points at
  // it via a non-canonical path (e.g. a symlinked checkout on another machine,
  // where git's worktree list realpath'd the entry but folderPath / rootPath
  // stayed raw), the exact-path match above misses. Recognise it as the main
  // checkout and surface its branch — matching how the canonical-path machine
  // renders it — instead of degrading to a bare "ROOT"/basename label.
  if (projectRootPath && samePath(rootPath, projectRootPath)) {
    const main = findMainWorktree(worktrees, projectRootPath);
    if (main) {
      return {
        label: main.branch || base,
        fullPath: rootPath,
        kind: "worktree",
        detail: main.taskId ?? undefined,
      };
    }
    return { label: base, fullPath: rootPath, kind: "project" };
  }

  return { label: base, fullPath: rootPath, kind: "folder" };
}

/** A switch target offered in the header (main worktree or a task worktree). */
export interface RootSwitchTarget {
  /** Absolute path to switch the tree root to. */
  path: string;
  /** Short label (branch, else basename). */
  label: string;
  /** Task id, when this is a task worktree. */
  taskId?: string;
}

export interface WorktreeMenuAnchorRect {
  left: number;
  right: number;
  bottom: number;
}

export interface WorktreeMenuPosition {
  left: number;
  top: number;
}

/**
 * Position the portal worktree menu opening *rightwards* from the trigger.
 *
 * The trigger lives in the narrow left sidebar header, so anchoring the menu's
 * right edge to the button (the old behaviour) made a 260–360px menu spill off
 * the left edge of the screen. Anchor the menu's *left* edge to the button and
 * clamp it inside the viewport so the menu always opens toward the roomy editor
 * area and never gets clipped.
 */
export function calculateWorktreeMenuPosition(
  anchorRect: WorktreeMenuAnchorRect,
  viewportWidth: number,
  gap = 4,
): WorktreeMenuPosition {
  const width = Math.max(260, Math.min(360, viewportWidth * 0.8));
  const margin = 8;
  let left = anchorRect.left; // open rightwards from the button's left edge
  left = Math.min(left, viewportWidth - width - margin); // clamp to right edge
  left = Math.max(margin, left); // clamp to left edge
  return { left, top: anchorRect.bottom + gap };
}

/**
 * Decide what the header's root-switch control should offer.
 *
 * The control only appears once a *main* worktree is detected (an entry whose
 * `path === repoRoot`, taskId null — falling back to the project folder path)
 * and there is at least one alternative to switch to.
 *
 * - viewing a task worktree → offer a jump back to MAIN (`toMain`)
 * - viewing MAIN / project / folder → offer the task worktree(s) (`toTasks`)
 *
 * Targets are stable-sorted by branch so the menu order doesn't flicker.
 */
export interface RootSwitch {
  mainPath: string;
  /** Set when currently on a task worktree: jump back to this main path. */
  toMain: string | null;
  /** Set when currently on main/project/folder: task worktrees to choose from. */
  toTasks: RootSwitchTarget[];
}

/**
 * Is this worktree an *active task* worktree worth offering as a switch target?
 *
 * The dropdown used to list every worktree under the project, but
 * `~/.marblo/worktrees` accumulates dozens of stale / abandoned
 * feat·fix·security branches that were created outside the task flow. We only
 * offer worktrees that:
 *
 *  1. belong to a task — `taskId != null`. This is the load-bearing filter:
 *     ad-hoc branches (e.g. `.claude/worktrees/feat/*`) have no inferred taskId,
 *     so they drop out here regardless of the stale heuristic.
 *  2. aren't archived. A worktree is archived when it is merged / idle-stale
 *     (the auto verdict computed in the electron main process, see
 *     {@link WorktreeStaleInfo}) OR the user manually archived it — unless the
 *     user manually restored it. This delegates to
 *     {@link isActiveOngoingWorktree} so the switcher, the Code-tab Root
 *     dropdown, and the Worktrees tab all agree on what "active/ongoing" means.
 *
 * `overrides` and `signals` both default to empty so existing callers (and the
 * auto verdict alone) keep working unchanged. Passing `signals` additionally
 * hides worktrees whose ticket is DONE and pins visible any worktree an agent
 * is currently working in — see {@link ArchiveSignals}.
 */
export function isActiveTaskWorktree(
  worktree: Worktree,
  overrides: ArchiveOverrides = {},
  signals: ArchiveSignals = {},
): boolean {
  return isActiveOngoingWorktree(worktree, overrides, signals);
}

export function resolveRootSwitch(
  rootPath: string | null,
  worktrees: Worktree[],
  projectRootPath: string | null,
  overrides: ArchiveOverrides = {},
  signals: ArchiveSignals = {},
): RootSwitch | null {
  // Locate this machine's main checkout (symlink-tolerant, keyed off taskId —
  // see findMainWorktree) and fall back to the project folder path. mainPath is
  // therefore the git-realpath'd local path when a main entry exists, so a
  // "home" jump lands on the path the tree actually loads (which then matches in
  // describeRootView) rather than a raw/foreign folderPath that no-ops.
  const mainPath = resolveLocalMainPath(worktrees, projectRootPath);
  if (!mainPath) return null;

  // Switch targets: active task worktrees only — exclude the main worktree path,
  // ad-hoc branches without a taskId, and stale worktrees (see
  // isActiveTaskWorktree).
  const toTasks: RootSwitchTarget[] = worktrees
    .filter((w) => !samePath(w.path, mainPath))
    .filter((w) => isActiveTaskWorktree(w, overrides, signals))
    .map((w) => ({
      path: w.path,
      label: w.branch || basename(w.path),
      taskId: w.taskId ?? undefined,
    }))
    .sort((a, b) => a.label.localeCompare(b.label));

  // "On main" also covers reaching the main checkout via its raw project-folder
  // path (mainPath is canonical; rootPath may still be the symlinked folderPath),
  // so we never show a misleading "back to main" control while already on it.
  const onMain =
    samePath(rootPath, mainPath) ||
    (!!projectRootPath && samePath(rootPath, projectRootPath));

  // Only offer a control when there is somewhere to go.
  if (onMain) {
    if (toTasks.length === 0) return null;
    return { mainPath, toMain: null, toTasks };
  }

  // Off-main: always offer a jump back to main, plus any *other* task worktrees.
  return {
    mainPath,
    toMain: mainPath,
    toTasks: toTasks.filter((t) => !samePath(t.path, rootPath)),
  };
}

/**
 * True when the tree root is a *stray* worktrees container — the shared
 * `~/.marblo/worktrees` directory, or a per-project bucket inside it — rather
 * than a concrete checkout. Loading such a root spills sibling worktrees of
 * OTHER projects / tasks into the file tree (the long-standing "다른 프로젝트
 * 워크트리 노출" report). Callers use this to nudge back to main instead of
 * rendering the stray tree.
 *
 * Deliberately narrow so the read-only "Open Folder" browse feature keeps
 * working: a recognised concrete root (a real worktree entry, or the project
 * folder / anything beneath it) is never stray, and only the marblo container
 * path *shape* — `.marblo/worktrees` with at most one extra segment (the
 * projectId bucket) — trips it. A real leaf worktree
 * (`.marblo/worktrees/<projectId>/<taskId>`, two extra segments) does not.
 */
export function isStrayWorktreeContainerRoot(
  rootPath: string | null,
  worktrees: Worktree[],
  projectRootPath: string | null,
): boolean {
  if (!rootPath) return false;
  if (worktrees.some((w) => samePath(w.path, rootPath))) return false;
  if (projectRootPath && isInsidePath(rootPath, projectRootPath)) return false;
  return /(?:^|[\\/])\.marblo[\\/]worktrees(?:[\\/][^\\/]+)?$/.test(
    normalizePath(rootPath),
  );
}

/**
 * Stable signature of a loaded tree + git status, used to skip redundant
 * re-renders when a poll / watcher reload returns identical data.
 */
export function treeSignature(
  nodes: unknown,
  statuses: Record<string, string>,
): string {
  return JSON.stringify([nodes, statuses]);
}
