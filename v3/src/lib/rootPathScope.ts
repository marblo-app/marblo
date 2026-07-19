/**
 * Renderer-side rules for which rootPaths may leave this window.
 *
 * The main-process counterpart is `electron/rootPathHealth.ts` (it also
 * classifies WHY a dead root failed, for the recovery dialog). These are kept
 * separate rather than shared because electron/ and src/ have no cross-imports
 * in this codebase and the main-process version depends on node's `path`.
 * Both must agree on what counts as an agent worktree — keep them in sync.
 */

/**
 * True when `p` is inside the agent worktree pool (`~/.marblo/worktrees/**`).
 *
 * Segment-matched rather than `includes()` so a project legitimately named
 * something like `my.marblo/worktrees-notes` can't be mistaken for the pool.
 * Handles both separators: the check has to hold for a Windows path too, since
 * a foreign path can reach this code via Firestore (see isForeignPlatformPath).
 */
export function isAgentWorktreePath(p: string | null | undefined): boolean {
  if (!p) return false;
  const segments = p.split(/[\\/]+/);
  const i = segments.indexOf(".marblo");
  return i !== -1 && segments[i + 1] === "worktrees";
}

/**
 * True when `p` is shaped for a different OS than the one we're running on.
 *
 * Firestore `projects.folderPath` holds ONE machine's local path in a document
 * shared by every machine on the account — whichever machine registered the repo
 * first wins, and nothing updates it afterwards. So a Mac opening a repo that a
 * Windows box registered inherits `C:\Users\...`, which can never exist here.
 * Adopting it as a rootPath spawns doomed PTYs and persists the bad path to this
 * machine's app-state. Detect it by shape — existence checks can't tell "not
 * here yet" from "not on this OS, ever".
 */
export function isForeignPlatformPath(p: string | null | undefined): boolean {
  if (!p) return false;
  const isWindowsShaped = /^[a-zA-Z]:[\\/]/.test(p) || p.startsWith("\\\\");
  const onWindows = navigator.userAgent.includes("Windows");
  return onWindows ? !isWindowsShaped : isWindowsShaped;
}

/**
 * Whether a rootPath may be written to the GLOBAL app-state slot
 * (`lastRootPath`), as opposed to this window's own restore record.
 *
 * The global slot is the primary window's cold-start fallback and the fallback
 * target when another window's root dies — so it must name something durable.
 * An agent worktree is neither: it is per-task and reaped as soon as the task
 * settles, at which point the global slot points at a deleted directory and
 * EVERY window that falls back to it lands on the same dead path. That is the
 * "작업 폴더가 사라졌습니다" popup on every boot. Per-window records may still
 * hold a worktree — those get scrubbed at removal time.
 */
export function canBeGlobalRoot(p: string | null | undefined): boolean {
  return !!p && !isAgentWorktreePath(p) && !isForeignPlatformPath(p);
}
