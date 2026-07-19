/**
 * English — `code.*` namespace. Typed `Record<keyof typeof koCode, string>`
 * so a key present in ko but missing here (or vice-versa) is a compile error
 * for this namespace alone.
 */
import type { code as koCode } from "../ko/code";

export const code: Record<keyof typeof koCode, string> = {
  "code.rootNotSelected": "No project root selected",
  "code.noFileSelected.title": "Select a file",
  "code.noFileSelected.hint": "Click a file in the sidebar to open it here",
  "code.diffView": "View diff",
  "code.diffLoading": "Loading diff...",
  "code.saveFailed": "Failed to save {name} — changes were not written to disk",
  "code.saveFailedDismiss": "Dismiss save error",
  "code.rootArchivedHint": "{count} archived · manage in the Worktrees tab",
  "code.rootUnknownHint": "{count} unjudged · hygiene status unavailable",

  "code.worktreeDiff.loading": "Checking worktree changes...",
  "code.worktreeDiff.changedCount": "{count} changed",
  "code.worktreeDiff.deletedFile": "{path} — deleted, cannot be opened",
  "code.worktreeDiff.clean":
    "This worktree has no changes (identical to its base).",
  "code.worktreeDiff.committedOnly":
    "No uncommitted changes — this branch has {count} file(s) changed against its base, all already committed.",
  "code.worktreeDiff.viewFullDiff": "View full diff",
  "code.worktreeDiff.deletionsOnly":
    "All {count} change(s) are deletions — no file left on disk to diff.",
  "code.worktreeDiff.error": "Could not open the worktree diff: {message}",
};
