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
): string {
  if (projectFilter === WORKTREE_PROJECT_FILTER_ALL) {
    return WORKTREE_PROJECT_FILTER_ALL;
  }

  return currentProjectId ?? WORKTREE_PROJECT_FILTER_LOADING;
}

