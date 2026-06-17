/**
 * Bulk-reap orphaned git worktrees — the one-shot cleanup path for an accrued
 * backlog (the current 100+ pileup that wastes disk, makes `git worktree list`
 * unreadable, and locks the shared branch).
 *
 * Runs `git worktree prune` then safely removes every worktree whose work is
 * captured elsewhere. The work-loss guard (WorktreeManager.reapAll) PRESERVES
 * any worktree with uncommitted changes or local-only (unmerged AND unpushed)
 * commits — those are reported, never deleted.
 *
 * Usage:
 *   node dist-electron/scripts/reap-worktrees.js [repoRoot] [--merged-only]
 *     repoRoot       repo to sweep (default: process.cwd())
 *     --merged-only  only reap branches already merged into base (stricter)
 *
 * npm: `npm run worktree:reap -- [repoRoot] [--merged-only]`
 */
import { WorktreeManager } from "../worktree-manager";

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const requireMerged = args.includes("--merged-only");
  const repoRoot = args.find((a) => !a.startsWith("--")) ?? process.cwd();

  const mgr = new WorktreeManager();
  console.log(
    `[reap] scanning worktrees under ${repoRoot}${
      requireMerged ? " (merged-only)" : ""
    }…`,
  );

  const res = await mgr.reapAll(repoRoot, { requireMerged });

  console.log(`[reap] removed ${res.removed.length}`);
  for (const p of res.removed) console.log(`  ✓ ${p}`);

  if (res.preserved.length) {
    console.log(`[reap] preserved ${res.preserved.length} (work-loss guard)`);
    for (const p of res.preserved) console.log(`  • ${p.path} — ${p.reason}`);
  }

  if (res.failed.length) {
    console.log(`[reap] failed ${res.failed.length}`);
    for (const f of res.failed) console.log(`  ✗ ${f.path} — ${f.error}`);
  }

  // Non-zero exit when a reap candidate errored, so CI/scripts can react.
  if (res.failed.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error("[reap] fatal:", e);
  process.exit(1);
});
