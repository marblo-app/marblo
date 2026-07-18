import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";
import { classifyChangeType } from "../../electron/merge-features";
// Reuse the temp-git fixture helpers from the sibling suite.
import { git, makeRepo } from "./worktree-manager.test";

// End-to-end verification of the routing-data merge-feature capture (ticket
// cZBlOnkg): a real squash-merge → `git show --numstat` → aggregate stats →
// path-derived change category. Proves the collection path produces correct
// de-identified labels, not just that the pure parser works.
describe("WorktreeManager.mergedCommitDiffStat", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("computes files/added/deleted for a squash-merged commit and classifies it", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "diffstat1",
      slug: "diffstat",
    });
    // Two new source files (+3 lines total), no deletions.
    fs.writeFileSync(path.join(info.path, "a.ts"), "one\ntwo\n");
    fs.writeFileSync(path.join(info.path, "b.ts"), "three\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "feature work"], info.path);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );
    expect(res.ok).toBe(true);
    expect(res.mergedSha).toBeTruthy();

    const stat = await mgr.mergedCommitDiffStat(repoRoot, res.mergedSha!);
    expect(stat).not.toBeNull();
    expect(stat!.filesChanged).toBe(2);
    expect(stat!.linesAdded).toBe(3);
    expect(stat!.linesDeleted).toBe(0);
    expect(stat!.paths.sort()).toEqual(["a.ts", "b.ts"]);
    expect(classifyChangeType(stat!.paths)).toBe("code");
  });

  it("classifies a docs-only merge as 'docs'", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "diffstat2",
      slug: "docs",
    });
    fs.writeFileSync(path.join(info.path, "GUIDE.md"), "# Guide\nhello\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "docs"], info.path);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );
    expect(res.ok).toBe(true);
    const stat = await mgr.mergedCommitDiffStat(repoRoot, res.mergedSha!);
    expect(stat!.filesChanged).toBe(1);
    expect(classifyChangeType(stat!.paths)).toBe("docs");
  });

  it("returns null for an unresolvable sha instead of throwing", async () => {
    const stat = await mgr.mergedCommitDiffStat(repoRoot, "deadbeefdeadbeef");
    expect(stat).toBeNull();
  });
});
