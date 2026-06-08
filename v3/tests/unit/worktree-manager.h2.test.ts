import { beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { WorktreeManager } from "../../electron/worktree-manager";
// Reuse the temp-git fixture helpers from the sibling suite (same patterns).
import { git, makeRepo } from "./worktree-manager.test";

/**
 * Regression coverage for the worktree merge/rebase data-loss & correctness
 * bugs:
 *   H2 — squashMergeToBase must merge against `baseRef` itself (not repoRoot's
 *        checked-out branch) and must NEVER destroy repoRoot's uncommitted WIP.
 *   M5 — rebaseOntoBase must distinguish a real conflict from a pre-flight
 *        refusal (dirty tree / bad ref) instead of swallowing the cause.
 *   L4 — branch names must not collide when two taskIds share their first 8
 *        chars.
 */

describe("WorktreeManager.squashMergeToBase — H2 data-loss / baseRef correctness", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("H2 ②: refuses to merge when repoRoot has uncommitted WIP, preserving it (no reset --hard)", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "wipsafe0001",
      slug: "wip",
    });
    // Worktree commits a clean, otherwise-mergeable change.
    fs.writeFileSync(path.join(info.path, "FEATURE.md"), "feat\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);

    // repoRoot gains uncommitted WIP — a tracked-file edit AND an untracked
    // file. The OLD error paths ran `git reset --hard` on repoRoot, which would
    // have wiped BOTH of these.
    fs.writeFileSync(
      path.join(repoRoot, "README.md"),
      "PRECIOUS UNCOMMITTED EDIT\n",
    );
    fs.writeFileSync(path.join(repoRoot, "scratch.txt"), "do not delete me\n");

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );

    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/uncommitted/i);
    expect(res.needsResolve).toBeUndefined();

    // WIP fully preserved.
    expect(fs.readFileSync(path.join(repoRoot, "README.md"), "utf8")).toBe(
      "PRECIOUS UNCOMMITTED EDIT\n",
    );
    expect(fs.existsSync(path.join(repoRoot, "scratch.txt"))).toBe(true);
    expect(fs.readFileSync(path.join(repoRoot, "scratch.txt"), "utf8")).toBe(
      "do not delete me\n",
    );

    // No squash landed; worktree + branch preserved so the user can retry.
    expect(git(["log", "--oneline", "main"], repoRoot)).not.toMatch(/squash/i);
    expect(fs.existsSync(info.path)).toBe(true);
    expect(git(["branch", "--list", info.branch], repoRoot)).not.toBe("");
  });

  it("H2 ①: lands the squash on baseRef when repoRoot's branch is BEHIND base (origin/main-style divergence)", async () => {
    // `upstream` advances ahead of main; repoRoot stays on the stale main —
    // mirroring baseRef=origin/main while repoRoot sits on a behind local main.
    git(["checkout", "-b", "upstream"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "UPSTREAM.md"), "upstream change\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "upstream advance"], repoRoot);
    git(["checkout", "main"], repoRoot);

    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "behindbase1",
      slug: "behind",
      baseRef: "upstream",
    });
    fs.writeFileSync(path.join(info.path, "TASK.md"), "task work\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "task work"], info.path);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "upstream",
      info.branch,
    );

    expect(res.ok).toBe(true);
    expect(res.mergedSha).toBeTruthy();

    // repoRoot (main) fast-forwarded THROUGH upstream AND landed the task.
    expect(fs.existsSync(path.join(repoRoot, "TASK.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "UPSTREAM.md"))).toBe(true);
    expect(git(["rev-parse", "HEAD"], repoRoot)).toBe(res.mergedSha);

    // ① The squash commit's DIFF is the TASK ONLY — not conflated with the
    // upstream change. The old code squashed against the stale main and would
    // have bundled UPSTREAM.md into this single commit.
    const changed = git(
      ["show", "--name-only", "--format=", res.mergedSha!],
      repoRoot,
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(changed).toContain("TASK.md");
    expect(changed).not.toContain("UPSTREAM.md");

    // Cleanup performed.
    expect(fs.existsSync(info.path)).toBe(false);
    expect(git(["branch", "--list", info.branch], repoRoot)).toBe("");
  });

  it("H2 ①: squash contains only the task when repoRoot is AHEAD of base (consecutive merges before a push)", async () => {
    // `base` pinned at the init commit; main advances ahead of it (e.g. an
    // earlier squash not yet pushed).
    git(["branch", "base"], repoRoot);
    fs.writeFileSync(path.join(repoRoot, "AHEAD.md"), "local ahead\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main ahead of base"], repoRoot);

    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "aheadbase01",
      slug: "ahead",
      baseRef: "base",
    });
    fs.writeFileSync(path.join(info.path, "TASK.md"), "task\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "task"], info.path);

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "base",
      info.branch,
    );

    expect(res.ok).toBe(true);
    // main kept its ahead commit AND gained the task as a single squash.
    expect(fs.existsSync(path.join(repoRoot, "AHEAD.md"))).toBe(true);
    expect(fs.existsSync(path.join(repoRoot, "TASK.md"))).toBe(true);

    const changed = git(
      ["show", "--name-only", "--format=", res.mergedSha!],
      repoRoot,
    )
      .split("\n")
      .map((s) => s.trim())
      .filter(Boolean);
    expect(changed).toEqual(["TASK.md"]); // task-only squash onto the ahead main
  });
});

describe("WorktreeManager.rebaseOntoBase — M5 dirty/error vs real conflict", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("M5: a dirty worktree is surfaced as an error, NOT a conflict with an empty list", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "m5dirty0001",
      slug: "m5",
    });
    fs.writeFileSync(path.join(info.path, "FEATURE.md"), "feat\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    // Base advances so a rebase actually needs to replay.
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "other\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);
    // Worktree gains an UNSTAGED edit to a tracked file → git rebase refuses
    // BEFORE it starts (no rebase in progress, no unmerged paths).
    fs.writeFileSync(path.join(info.path, "README.md"), "uncommitted edit\n");

    const res = await mgr.rebaseOntoBase(info.path, "main");

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy(); // real cause surfaced
    expect(res.conflicts).toBeUndefined(); // NOT mis-reported as a conflict
    // The unstaged edit is untouched — no spurious `rebase --abort`/reset.
    expect(fs.readFileSync(path.join(info.path, "README.md"), "utf8")).toBe(
      "uncommitted edit\n",
    );
  });

  it("M5: a non-existent baseRef is surfaced as an error, not a conflict", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "m5badref001",
      slug: "m5b",
    });

    const res = await mgr.rebaseOntoBase(info.path, "no/such/ref");

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.conflicts).toBeUndefined();
  });

  it("M5: a genuine conflict still returns conflicts (and aborts cleanly, no error)", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "m5conf00001",
      slug: "m5c",
    });
    fs.writeFileSync(path.join(info.path, "README.md"), "worktree edit\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "wt edit"], info.path);
    fs.writeFileSync(path.join(repoRoot, "README.md"), "main edit\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main edit"], repoRoot);

    const res = await mgr.rebaseOntoBase(info.path, "main");

    expect(res.ok).toBe(false);
    expect(res.conflicts).toContain("README.md");
    expect(res.error).toBeUndefined();
    // Working tree restored by the abort.
    expect(fs.readFileSync(path.join(info.path, "README.md"), "utf8")).toBe(
      "worktree edit\n",
    );
  });

  it("M5: squashMergeToBase surfaces a dirty-worktree rebase failure as error, not needsResolve", async () => {
    const info = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "m5squash001",
      slug: "m5s",
    });
    fs.writeFileSync(path.join(info.path, "FEATURE.md"), "feat\n");
    git(["add", "."], info.path);
    git(["commit", "-m", "feat"], info.path);
    fs.writeFileSync(path.join(repoRoot, "OTHER.md"), "other\n");
    git(["add", "."], repoRoot);
    git(["commit", "-m", "main advance"], repoRoot);
    fs.writeFileSync(path.join(info.path, "README.md"), "uncommitted\n");

    const res = await mgr.squashMergeToBase(
      repoRoot,
      info.path,
      "main",
      info.branch,
    );

    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(res.needsResolve).toBeUndefined();
    expect(res.conflicts).toBeUndefined();
    // Worktree preserved — nothing destructive happened.
    expect(fs.existsSync(info.path)).toBe(true);
  });
});

describe("WorktreeManager.create — L4 branch-name collision safety", () => {
  let repoRoot: string;
  let mgr: WorktreeManager;
  beforeEach(() => {
    ({ repoRoot, mgr } = makeRepo());
  });

  it("L4: two taskIds sharing the first 8 chars get distinct branch names and both worktrees are created", async () => {
    const a = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "abcdef1200000000",
      slug: "dup",
    });
    const b = await mgr.create({
      repoRoot,
      projectId: "p",
      taskId: "abcdef1299999999",
      slug: "dup",
    });

    // First keeps the short id8 form; second escalates to a longer id slice.
    expect(a.branch).toBe("marblo/dup-abcdef12");
    expect(b.branch).not.toBe(a.branch);
    expect(b.branch.startsWith("marblo/dup-")).toBe(true);

    // Both branches really exist (worktree add succeeded for both).
    expect(git(["branch", "--list", a.branch], repoRoot)).not.toBe("");
    expect(git(["branch", "--list", b.branch], repoRoot)).not.toBe("");
  });
});
