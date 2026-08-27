import { describe, expect, it } from "vitest";
import {
  buildMergedReapPlan,
  classifyMergedWorktree,
  parseWorktreeListPorcelain,
  removalTargetsForPlan,
  type MergedWorktreeFacts,
} from "../../electron/scripts/merged-worktree-reap";

function facts(
  overrides: Partial<MergedWorktreeFacts> = {}
): MergedWorktreeFacts {
  return {
    path: "/tmp/wt",
    branch: "marblo/example",
    originBranchMerged: true,
    remoteBranchExists: true,
    statusPorcelain: "",
    nonMergeUniqueCommits: [],
    ...overrides,
  };
}

describe("merged worktree reap classification", () => {
  it("marks a worktree safe only when all three proven conditions pass", () => {
    const verdict = classifyMergedWorktree(facts());

    expect(verdict.disposition).toBe("safe");
    expect(verdict.reason).toContain("origin branch is merged");
    expect(verdict.reason).toContain("worktree is clean");
    expect(verdict.reason).toContain("no non-merge commits");
  });

  it("does not mark an unmerged origin branch safe", () => {
    const verdict = classifyMergedWorktree(
      facts({ originBranchMerged: false })
    );

    expect(verdict.disposition).toBe("out-of-scope");
    expect(verdict.reason).toContain("not merged");
  });

  it("does not mark a merged-but-dirty worktree safe", () => {
    const verdict = classifyMergedWorktree(
      facts({
        statusPorcelain:
          "D  v3/docs/routing/label-capture-audit-2026-08-10.md\n",
      })
    );

    expect(verdict.disposition).toBe("hold");
    expect(verdict.reason).toContain("uncommitted changes");
  });

  it("does not mark a worktree with non-merge unique commits safe", () => {
    const verdict = classifyMergedWorktree(
      facts({ nonMergeUniqueCommits: ["abc123"] })
    );

    expect(verdict.disposition).toBe("hold");
    expect(verdict.reason).toContain("non-merge commit");
  });

  it("keeps missing remote branches out of this ticket's cleanup scope", () => {
    const verdict = classifyMergedWorktree(
      facts({ remoteBranchExists: false, originBranchMerged: false })
    );

    expect(verdict.disposition).toBe("out-of-scope");
    expect(verdict.reason).toContain("separate policy");
  });

  it("does not repeat wrong criterion 1: origin branch comparison noise is not enough", () => {
    const verdict = classifyMergedWorktree(
      facts({
        originBranchMerged: false,
        nonMergeUniqueCommits: [],
      })
    );

    expect(verdict.disposition).not.toBe("safe");
  });

  it("does not repeat wrong criterion 2: local merge commits are ignored but dirty state still blocks", () => {
    const verdict = classifyMergedWorktree(
      facts({
        statusPorcelain: " M v3/docs/wiki/routing-label-coverage.md\n",
        nonMergeUniqueCommits: [],
      })
    );

    expect(verdict.disposition).toBe("hold");
    expect(verdict.reason).toContain("uncommitted changes");
  });

  it("does not repeat wrong criterion 3: origin/main diff noise does not bypass non-merge unique commits", () => {
    const verdict = classifyMergedWorktree(
      facts({
        statusPorcelain: "",
        nonMergeUniqueCommits: ["feedface"],
      })
    );

    expect(verdict.disposition).toBe("hold");
    expect(verdict.reason).toContain("non-merge commit");
  });

  it("never includes held worktrees in delete-approved targets", () => {
    const safe = classifyMergedWorktree(facts({ path: "/tmp/safe" }));
    const dirty = classifyMergedWorktree(
      facts({ path: "/tmp/dirty", statusPorcelain: "D  old.md\n" })
    );
    const unique = classifyMergedWorktree(
      facts({ path: "/tmp/unique", nonMergeUniqueCommits: ["abc"] })
    );
    const outOfScope = classifyMergedWorktree(
      facts({
        path: "/tmp/missing-remote",
        remoteBranchExists: false,
        originBranchMerged: false,
      })
    );

    expect(
      removalTargetsForPlan(
        buildMergedReapPlan([safe, dirty, unique, outOfScope])
      )
    ).toEqual(["/tmp/safe"]);
  });
});

describe("worktree list parser", () => {
  it("parses porcelain worktree paths and local branches", () => {
    expect(
      parseWorktreeListPorcelain(`worktree /repo
HEAD abc
branch refs/heads/main

worktree /worktrees/p/task
HEAD def
branch refs/heads/marblo/task-123

`)
    ).toEqual([
      { path: "/repo", branch: "main" },
      { path: "/worktrees/p/task", branch: "marblo/task-123" },
    ]);
  });
});
