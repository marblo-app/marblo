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
 * ── Source of the file list, and its one blind spot ──────────────────────────
 * `fs.gitStatus(root)` (git status --porcelain -uall) gives working-tree
 * changes, which is exactly the set DiffSurface can render per file. It does
 * NOT see work the agent already committed on the branch. Rather than report
 * that as "변경 없음" — a lie, and precisely the kind of quiet wrong answer
 * PR#489 was about — we cross-check `worktree.status.filesChanged` (branch vs.
 * base, already carried on the Worktree) and emit a distinct `committedOnly`
 * state that says so and points at the Worktrees tab's full-branch diff.
 *
 * Every other dead end (git error, all-deletions, unreadable file) is likewise
 * a named state, never a no-op. See {@link WorktreeDiffState}.
 */
export async function openWorktreeDiff(worktree: Worktree): Promise<void> {
  const diffStore = useWorktreeDiffStore.getState();
  const seq = diffStore.nextRequest();
  const base = { worktreeId: worktree.id, worktreePath: worktree.path };

  diffStore.settle(seq, { kind: "loading", ...base });

  let statusMap: Record<string, string>;
  try {
    statusMap = await window.electronAPI.fs.gitStatus(worktree.path);
  } catch (err) {
    useWorktreeDiffStore.getState().settle(seq, {
      kind: "error",
      ...base,
      message: err instanceof Error ? err.message : String(err),
    });
    return;
  }

  // The user may have switched roots while git status was running. Bail rather
  // than yank the editor to a worktree they already navigated away from; the
  // newer request owns the store from here.
  if (useEditorStore.getState().rootPath !== worktree.path) return;

  const files = toChangedFiles(statusMap, worktree.path);

  if (files.length === 0) {
    const filesChanged = worktree.status?.filesChanged ?? 0;
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
