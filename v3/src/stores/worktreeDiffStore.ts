import { create } from "zustand";

/**
 * Outcome of the "이 워크트리 보기" diff auto-open (see lib/worktreeDiff).
 *
 * ── Why every branch is a named state ────────────────────────────────────────
 * PR#489's bug in this same area was a *silent non-render*: worktreeStore was a
 * one-shot snapshot, findTaskWorktree returned null, and the button simply
 * never appeared — nothing told the user why. The diff path has the same
 * failure shapes (no changes, everything committed, unreadable file, git
 * error), so it does NOT get to fail quietly: each one is an explicit state
 * that CodeTab renders as a banner. There is no "we did nothing and said
 * nothing" path.
 */
export type WorktreeDiffState =
  /** No worktree diff has been requested (or it was dismissed). */
  | { kind: "idle" }
  /** git status in flight. */
  | { kind: "loading"; worktreeId: string; worktreePath: string }
  /** A changed file was opened and the Code surface is in diff mode. */
  | {
      kind: "opened";
      worktreeId: string;
      worktreePath: string;
      openedPath: string;
      files: WorktreeChangedFile[];
      /**
       * merge-base(baseRef, HEAD) — the baseline these files were collected
       * against, handed to the diff surface so *committed* work renders as a
       * diff. Undefined on the legacy `gitStatus` fallback path, where the
       * baseline is HEAD.
       */
      baseSha?: string;
    }
  /**
   * Working tree is clean but the branch has commits vs. its base — the agent
   * already committed. Reporting a flat "변경 없음" here would be a lie.
   */
  | {
      kind: "committedOnly";
      worktreeId: string;
      worktreePath: string;
      filesChanged: number;
    }
  /** Working tree clean AND branch has nothing vs. base — genuinely empty. */
  | { kind: "clean"; worktreeId: string; worktreePath: string }
  /** Every change is a deletion, so there is no file left on disk to diff. */
  | {
      kind: "deletionsOnly";
      worktreeId: string;
      worktreePath: string;
      files: WorktreeChangedFile[];
    }
  /** git status threw, or the chosen file could not be opened. */
  | {
      kind: "error";
      worktreeId: string;
      worktreePath: string;
      message: string;
    };

export interface WorktreeChangedFile {
  /** Absolute path, as keyed by fs.gitStatus. */
  path: string;
  /** Trimmed two-char porcelain code ("M", "??", "MD", …). */
  status: string;
  /** Path segment below the worktree root — what we show in the UI. */
  relPath: string;
  /** False for deletions: the file is gone from disk, so it cannot be opened. */
  openable: boolean;
}

interface WorktreeDiffStoreState {
  state: WorktreeDiffState;
  /**
   * Monotonic token. Every openWorktreeDiff() call takes the next one and
   * discards its own async result if a later call has since started — clicking
   * worktree A then B must land on B, never on whichever git status finished
   * last.
   */
  requestSeq: number;
  nextRequest: () => number;
  /** Apply a result only if `seq` is still the newest request. */
  settle: (seq: number, state: WorktreeDiffState) => void;
  reset: () => void;
}

export const useWorktreeDiffStore = create<WorktreeDiffStoreState>(
  (set, get) => ({
    state: { kind: "idle" },
    requestSeq: 0,

    nextRequest: () => {
      const seq = get().requestSeq + 1;
      set({ requestSeq: seq });
      return seq;
    },

    settle: (seq, state) => {
      if (get().requestSeq !== seq) return; // superseded by a newer click
      set({ state });
    },

    reset: () => set({ state: { kind: "idle" } }),
  }),
);
