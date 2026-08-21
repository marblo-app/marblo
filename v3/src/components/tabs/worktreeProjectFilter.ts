export const WORKTREE_PROJECT_FILTER_ALL = "all";
export const WORKTREE_PROJECT_FILTER_LOADING = "__current_project_loading__";

export function initialWorktreeProjectFilter(
  currentProjectId: string | null | undefined,
): string {
  return currentProjectId ?? WORKTREE_PROJECT_FILTER_LOADING;
}

export function nextWorktreeProjectFilter(
  projectFilter: string,
  currentProjectId: string | null | undefined,
  availableProjectIds: readonly string[] = [],
): string {
  if (projectFilter === WORKTREE_PROJECT_FILTER_ALL) {
    return WORKTREE_PROJECT_FILTER_ALL;
  }

  if (!currentProjectId) return WORKTREE_PROJECT_FILTER_LOADING;

  // The window's project binding may be restored after the worktree IPC
  // response. A stale binding must not turn a successful non-empty response
  // into an empty list. Until the matching binding arrives, show the known
  // worktrees rather than silently filtering every one of them out.
  if (
    availableProjectIds.length > 0 &&
    !availableProjectIds.includes(currentProjectId)
  ) {
    return WORKTREE_PROJECT_FILTER_ALL;
  }

  return currentProjectId;
}
