import type { Worktree } from "../types/worktree";
import { useEditorStore } from "../stores/editorStore";
import {
  useWorktreeDiffStore,
  type WorktreeChangedFile,
} from "../stores/worktreeDiffStore";

/**
 * Auto-open the diff for a worktree the user just switched to.
 *
 * ── What "the worktree's diff" resolves to ───────────────────────────────────
 * DiffSurface (PR#478) is a *per-file* surface: it renders when a file is open
 * and `editorStore.showDiff` is true, diffing that file against its git
 * baseline. So showing "the worktree's diff" means: list the worktree's changed
 * files, open one, and put the Code surface into diff mode. That is what this
 * does — it adds no new diff renderer and no new IPC.
 *
 * ── Source of the file list ──────────────────────────────────────────────────
 * `fs.gitWorktreeChanges(root, baseRef)` lists everything the worktree changed
 * against `merge-base(baseRef, HEAD)` — committed, uncommitted and untracked in
 * one set — and returns that baseline so the diff surface compares against it
 * rather than HEAD.
 *
 * This replaces the original `fs.gitStatus` source, which saw the working tree
 * only. Agents commit their work, so on the live checkout 36 of 50 worktrees
 * had a clean working tree and non-empty branch: `gitStatus` returned zero
 * files and the auto-open opened nothing for most worktrees. PR#493 covered
 * that with a `committedOnly` banner cross-checked against
 * `worktree.status.filesChanged`, but PR#495/#498 switched enumeration to the
 * light path that leaves `status` undefined, so even the banner degraded to a
 * flat "변경 없음" — the collection failing silently as an honest-looking empty
 * result (ticket F2WGGGVthmg7lN490PDy).
 *
 * Collection is on-demand for the single clicked worktree. It does not restore
 * the per-worktree status sweep PR#495/#498 removed.
 *
 * Every dead end (git error, all-deletions, unreadable file) is a named state,
 * never a no-op — and a *failed* collection is never reported as "no changes".
 * See {@link WorktreeDiffState}.
 */
export async function openWorktreeDiff(worktree: Worktree): Promise<void> {
  const diffStore = useWorktreeDiffStore.getState();
  const seq = diffStore.nextRequest();
  const base = { worktreeId: worktree.id, worktreePath: worktree.path };

  diffStore.settle(seq, { kind: "loading", ...base });

  let collected: CollectedChanges;
  try {
    collected = await collectChanges(worktree);
  } catch (err) {
    useWorktreeDiffStore.getState().settle(seq, {
      kind: "error",
      ...base,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // The user may have switched roots while git was running. Bail rather than
  // yank the editor to a worktree they already navigated away from; the newer
  // request owns the store from here.
  if (useEditorStore.getState().rootPath !== worktree.path) return;

  const { files, baseSha } = collected;

  if (files.length === 0) {
    // With the merge-base collection an empty set genuinely means "nothing
    // changed vs. base". The legacy fallback can't tell on its own, so it
    // resolves `committedFilesChanged` before we get here.
    const filesChanged = collected.committedFilesChanged ?? 0;
    useWorktreeDiffStore
      .getState()
      .settle(
        seq,
        filesChanged > 0
          ? { kind: "committedOnly", ...base, filesChanged }
          : { kind: "clean", ...base },
      );
    return;
  }

  const target = files.find((f) => f.openable);
  if (!target) {
    useWorktreeDiffStore
      .getState()
      .settle(seq, { kind: "deletionsOnly", ...base, files });
    return;
  }

  const editor = useEditorStore.getState();
  await editor.openFile(target.path);

  // editorStore.openFile swallows read failures (catch → console.error), which
  // would leave the user staring at an unchanged pane with no explanation.
  // Verify the file actually landed and promote a swallowed failure to a
  // visible error.
  if (
    !useEditorStore.getState().openFiles.some((f) => f.path === target.path)
  ) {
    useWorktreeDiffStore.getState().settle(seq, {
      kind: "error",
      ...base,
      message: target.relPath,
    });
    return;
  }

  useEditorStore.getState().setShowDiff(true);
  useWorktreeDiffStore.getState().settle(seq, {
    kind: "opened",
    ...base,
    openedPath: target.path,
    files,
    baseSha,
  });
}

interface CollectedChanges {
  files: WorktreeChangedFile[];
  /** Baseline the files were collected against; undefined on the legacy path. */
  baseSha?: string;
  /**
   * Legacy path only: branch-vs-base file count, used to tell "agent already
   * committed" apart from "genuinely clean" when the working tree is empty.
   */
  committedFilesChanged?: number;
}

/**
 * Collect the worktree's changed files, preferring the merge-base source and
 * falling back to the working-tree-only one when the preload predates it (dev
 * HMR / renderer newer than main) — the same fallback shape PR#495 used for
 * `listLight`.
 *
 * Throws on collection failure. Callers must surface that as an error state;
 * degrading it to an empty file list is the bug this function exists to fix.
 */
async function collectChanges(worktree: Worktree): Promise<CollectedChanges> {
  const api = window.electronAPI.fs;

  if (api.gitWorktreeChanges) {
    const { baseSha, files } = await api.gitWorktreeChanges(
      worktree.path,
      worktree.baseRef,
    );
    return { files: fromChangedEntries(files, worktree.path), baseSha };
  }

  const statusMap = await api.gitStatus(worktree.path);
  const files = toChangedFiles(statusMap, worktree.path);
  if (files.length > 0) return { files };

  // Working tree clean on the legacy path: resolve branch-vs-base on demand so
  // an already-committed worktree is not reported as "변경 없음". `status` on
  // the Worktree is undefined under light enumeration (PR#495/#498), so we ask
  // for this one worktree rather than relying on the carried snapshot.
  //
  // Best-effort, unlike the primary collection above: the file list itself
  // already succeeded, so a failure here only costs us the committedOnly/clean
  // distinction. We degrade to the carried snapshot rather than failing an
  // otherwise-good collection.
  let committedFilesChanged = worktree.status?.filesChanged ?? 0;
  try {
    const status = await window.electronAPI.worktree?.status?.(
      worktree.path,
      worktree.baseRef,
    );
    if (status) committedFilesChanged = status.filesChanged;
  } catch {
    // keep the snapshot value
  }
  return { files, committedFilesChanged };
}

/**
 * Normalise `fs.gitWorktreeChanges` entries into the display-ready list.
 *
 * Ordering matches {@link toChangedFiles} — openable-first, then by path — so
 * the same worktree always opens the same file; a diff that jumps to a
 * different file each click reads as a bug.
 */
export function fromChangedEntries(
  entries: Array<{ relPath: string; status: string }>,
  worktreePath: string,
): WorktreeChangedFile[] {
  const prefix = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;

  return entries
    .map(({ relPath, status }) => ({
      path: `${prefix}${relPath}`,
      status,
      relPath,
      // "D" is a deletion — nothing left on disk for the diff surface to read.
      openable: status !== "D",
    }))
    .sort((a, b) => {
      if (a.openable !== b.openable) return a.openable ? -1 : 1;
      return a.relPath.localeCompare(b.relPath);
    });
}

/**
 * Normalise fs.gitStatus's `{ absolutePath: porcelainCode }` map into a stable,
 * display-ready list.
 *
 * Ordering is deterministic (openable-first, then by path) so the same worktree
 * always opens the same file — a diff that jumps to a different file each click
 * reads as a bug.
 */
export function toChangedFiles(
  statusMap: Record<string, string>,
  worktreePath: string,
): WorktreeChangedFile[] {
  const prefix = worktreePath.endsWith("/") ? worktreePath : `${worktreePath}/`;

  const files = Object.entries(statusMap).map(([rawPath, status]) => {
    // Renames come through porcelain as "old -> new"; the joined absolute path
    // inherits that, so keep the destination (the file that exists on disk).
    const arrow = rawPath.lastIndexOf(" -> ");
    const path =
      arrow === -1 ? rawPath : `${prefix}${rawPath.slice(arrow + 4).trim()}`;

    return {
      path,
      status,
      relPath: path.startsWith(prefix) ? path.slice(prefix.length) : path,
      // A deletion ("D", " D", "MD", "AD" → trimmed "D"/"MD"/"AD") has no file
      // left on disk, so there is nothing for the diff surface to read.
      openable: !status.endsWith("D"),
    };
  });

  return files.sort((a, b) => {
    if (a.openable !== b.openable) return a.openable ? -1 : 1;
    return a.relPath.localeCompare(b.relPath);
  });
}
