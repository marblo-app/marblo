import { describe, expect, it } from "vitest";
import {
  initialWorktreeProjectFilter,
  nextWorktreeProjectFilter,
  WORKTREE_PROJECT_FILTER_ALL,
  WORKTREE_PROJECT_FILTER_LOADING,
} from "../../src/components/tabs/worktreeProjectFilter";

describe("worktree project filter", () => {
  it("defaults to the current project when it is available", () => {
    expect(initialWorktreeProjectFilter("project-a")).toBe("project-a");
  });

  it("uses an explicit loading sentinel while currentProject is unavailable", () => {
    expect(initialWorktreeProjectFilter(null)).toBe(
      WORKTREE_PROJECT_FILTER_LOADING,
    );
  });

  it("preserves an explicit All projects selection across project changes", () => {
    expect(nextWorktreeProjectFilter(WORKTREE_PROJECT_FILTER_ALL, "project-b"))
      .toBe(WORKTREE_PROJECT_FILTER_ALL);
  });

  it("moves a specific project selection to the new current project", () => {
    expect(nextWorktreeProjectFilter("project-a", "project-b")).toBe(
      "project-b",
    );
  });

  it("does not leave a stale specific project selected when currentProject drops out", () => {
    expect(nextWorktreeProjectFilter("project-a", null)).toBe(
      WORKTREE_PROJECT_FILTER_LOADING,
    );
  });

  it("falls back to all projects when a restored binding has no worktrees", () => {
    expect(
      nextWorktreeProjectFilter("project-a", "stale-project", ["project-a"]),
    ).toBe(WORKTREE_PROJECT_FILTER_ALL);
  });

  it("converges to the real project once its worktrees arrive", () => {
    expect(
      nextWorktreeProjectFilter("project-a", "project-b", [
        "project-a",
        "project-b",
      ]),
    ).toBe("project-b");
  });
});
