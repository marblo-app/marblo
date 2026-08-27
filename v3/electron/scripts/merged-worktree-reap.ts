import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export type MergedWorktreeDisposition =
  | "safe"
  | "hold"
  | "out-of-scope"
  | "failed";

export interface MergedWorktreeFacts {
  path: string;
  branch?: string;
  originBranchMerged: boolean;
  statusPorcelain?: string;
  nonMergeUniqueCommits?: string[];
  remoteBranchExists: boolean;
  gitError?: string;
}

export interface MergedWorktreeVerdict {
  path: string;
  branch?: string;
  disposition: MergedWorktreeDisposition;
  reason: string;
}

export interface ParsedWorktree {
  path: string;
  branch?: string;
}

export interface MergedReapPlan {
  safe: MergedWorktreeVerdict[];
  hold: MergedWorktreeVerdict[];
  outOfScope: MergedWorktreeVerdict[];
  failed: MergedWorktreeVerdict[];
}

interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

const DEFAULT_BASE_REF = "origin/main";
const DEFAULT_WORKTREES_ROOT = path.join(os.homedir(), ".marblo", "worktrees");

/**
 * Classify one Marblo-managed worktree for the merged-worktree cleanup approval
 * list. This deliberately requires all three proven signals:
 *
 * 1. `git branch -r --merged origin/main` contains `origin/<branch>`.
 * 2. `git -C <wt> status --porcelain` is empty.
 * 3. `git -C <wt> log --no-merges origin/main..HEAD` has zero lines.
 *
 * The fourth-attempt rule matters because three tempting checks are wrong:
 * - `git log origin/<branch>..HEAD` reports hundreds of "unpushed" main commits
 *   after a worktree has pulled main, so it confuses synced base history with
 *   branch work.
 * - `git log origin/main..HEAD` reports a local "merge main into branch" commit
 *   even when that merge commit is only noise, not original task work.
 * - `git diff origin/main HEAD` reports reverse diffs after main moves forward
 *   past the worktree, so it can make a stale-but-empty branch look meaningful.
 *
 * Only non-merge commits unique to the worktree are real work that could be lost.
 */
export function classifyMergedWorktree(
  facts: MergedWorktreeFacts
): MergedWorktreeVerdict {
  if (facts.gitError) {
    return {
      path: facts.path,
      branch: facts.branch,
      disposition: "failed",
      reason: facts.gitError,
    };
  }
  if (!facts.branch) {
    return {
      path: facts.path,
      disposition: "out-of-scope",
      reason: "detached HEAD or no local branch",
    };
  }
  if (!facts.remoteBranchExists) {
    return {
      path: facts.path,
      branch: facts.branch,
      disposition: "out-of-scope",
      reason: `origin/${facts.branch} is missing; remote-missing cleanup is a separate policy`,
    };
  }
  if (!facts.originBranchMerged) {
    return {
      path: facts.path,
      branch: facts.branch,
      disposition: "out-of-scope",
      reason: `origin/${facts.branch} is not merged into ${DEFAULT_BASE_REF}`,
    };
  }

  const dirty = (facts.statusPorcelain ?? "").trim().length > 0;
  if (dirty) {
    return {
      path: facts.path,
      branch: facts.branch,
      disposition: "hold",
      reason: "remote branch is merged, but worktree has uncommitted changes",
    };
  }

  const nonMergeUniqueCount = facts.nonMergeUniqueCommits?.length ?? 0;
  if (nonMergeUniqueCount > 0) {
    return {
      path: facts.path,
      branch: facts.branch,
      disposition: "hold",
      reason: `remote branch is merged, but HEAD has ${nonMergeUniqueCount} non-merge commit(s) not in ${DEFAULT_BASE_REF}`,
    };
  }

  return {
    path: facts.path,
    branch: facts.branch,
    disposition: "safe",
    reason:
      "origin branch is merged into origin/main, worktree is clean, and HEAD has no non-merge commits beyond origin/main",
  };
}

export function buildMergedReapPlan(
  verdicts: MergedWorktreeVerdict[]
): MergedReapPlan {
  return {
    safe: verdicts.filter((v) => v.disposition === "safe"),
    hold: verdicts.filter((v) => v.disposition === "hold"),
    outOfScope: verdicts.filter((v) => v.disposition === "out-of-scope"),
    failed: verdicts.filter((v) => v.disposition === "failed"),
  };
}

export function removalTargetsForPlan(plan: MergedReapPlan): string[] {
  return plan.safe.map((v) => v.path);
}

export function parseWorktreeListPorcelain(stdout: string): ParsedWorktree[] {
  const result: ParsedWorktree[] = [];
  let current: ParsedWorktree | undefined;

  for (const raw of stdout.split("\n")) {
    const line = raw.trimEnd();
    if (!line) {
      if (current) result.push(current);
      current = undefined;
      continue;
    }
    if (line.startsWith("worktree ")) {
      if (current) result.push(current);
      current = { path: line.slice("worktree ".length) };
      continue;
    }
    if (line.startsWith("branch ") && current) {
      const ref = line.slice("branch ".length);
      current.branch = ref.startsWith("refs/heads/")
        ? ref.slice("refs/heads/".length)
        : ref;
    }
  }
  if (current) result.push(current);
  return result;
}

function runGit(args: string[], cwd: string): GitResult {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    env: { ...process.env, LC_ALL: "C", LANG: "C" },
  });
  return {
    code: result.status ?? 1,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function originRef(branch: string): string {
  return `origin/${branch}`;
}

function normalizeWorktreeRoot(root: string): string {
  return fs.existsSync(root) ? fs.realpathSync(root) : path.resolve(root);
}

function isUnderRoot(candidate: string, root: string): boolean {
  const relative = path.relative(root, normalizeWorktreeRoot(candidate));
  return (
    relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative)
  );
}

function mergedRemoteBranches(repoRoot: string): Set<string> {
  const result = runGit(
    ["branch", "-r", "--merged", DEFAULT_BASE_REF],
    repoRoot
  );
  if (result.code !== 0) {
    throw new Error(
      `git branch -r --merged ${DEFAULT_BASE_REF} failed: ${result.stderr.trim()}`
    );
  }
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^origin\/HEAD -> /, ""))
      .filter(Boolean)
  );
}

function allRemoteBranches(repoRoot: string): Set<string> {
  const result = runGit(["branch", "-r"], repoRoot);
  if (result.code !== 0) {
    throw new Error(`git branch -r failed: ${result.stderr.trim()}`);
  }
  return new Set(
    result.stdout
      .split("\n")
      .map((line) => line.trim().replace(/^origin\/HEAD -> /, ""))
      .filter(Boolean)
  );
}

function listManagedWorktrees(
  repoRoot: string,
  worktreesRoot: string
): ParsedWorktree[] {
  const result = runGit(["worktree", "list", "--porcelain"], repoRoot);
  if (result.code !== 0) {
    throw new Error(`git worktree list failed: ${result.stderr.trim()}`);
  }
  const normalizedRoot = normalizeWorktreeRoot(worktreesRoot);
  return parseWorktreeListPorcelain(result.stdout).filter((wt) => {
    if (!isUnderRoot(wt.path, normalizedRoot)) return false;
    const relative = path.relative(
      normalizedRoot,
      normalizeWorktreeRoot(wt.path)
    );
    // Marblo task worktrees live at <worktreesRoot>/<projectId>/<taskId>.
    // Direct children such as macbuild-* and marblo-bump are operational
    // checkouts with different lifecycle rules, so this ticket must not touch
    // or list them as approval candidates.
    return relative.split(path.sep).length >= 2;
  });
}

function collectFacts(
  worktree: ParsedWorktree,
  mergedRefs: Set<string>,
  remoteRefs: Set<string>
): MergedWorktreeFacts {
  if (!worktree.branch) {
    return {
      path: worktree.path,
      branch: worktree.branch,
      originBranchMerged: false,
      remoteBranchExists: false,
    };
  }

  const remoteRef = originRef(worktree.branch);
  const remoteBranchExists = remoteRefs.has(remoteRef);
  const originBranchMerged = mergedRefs.has(remoteRef);
  if (!remoteBranchExists || !originBranchMerged) {
    return {
      path: worktree.path,
      branch: worktree.branch,
      originBranchMerged,
      remoteBranchExists,
    };
  }

  const status = runGit(["status", "--porcelain"], worktree.path);
  if (status.code !== 0) {
    return {
      path: worktree.path,
      branch: worktree.branch,
      originBranchMerged,
      remoteBranchExists,
      gitError: `git status failed: ${status.stderr.trim()}`,
    };
  }

  const unique = runGit(
    ["log", "--no-merges", "--format=%H", `${DEFAULT_BASE_REF}..HEAD`],
    worktree.path
  );
  if (unique.code !== 0) {
    return {
      path: worktree.path,
      branch: worktree.branch,
      originBranchMerged,
      remoteBranchExists,
      statusPorcelain: status.stdout,
      gitError: `git log --no-merges ${DEFAULT_BASE_REF}..HEAD failed: ${unique.stderr.trim()}`,
    };
  }

  return {
    path: worktree.path,
    branch: worktree.branch,
    originBranchMerged,
    remoteBranchExists,
    statusPorcelain: status.stdout,
    nonMergeUniqueCommits: unique.stdout
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean),
  };
}

function printGroup(title: string, verdicts: MergedWorktreeVerdict[]): void {
  console.log(`${title} ${verdicts.length}`);
  for (const verdict of verdicts) {
    const branch = verdict.branch ? ` [${verdict.branch}]` : "";
    console.log(`  - ${verdict.path}${branch} — ${verdict.reason}`);
  }
}

function printPlan(plan: MergedReapPlan, dryRun: boolean): void {
  console.log(
    `[merged-worktree-reap] ${dryRun ? "dry-run" : "DELETE"}: safe ${
      plan.safe.length
    }, hold ${plan.hold.length}, out-of-scope ${
      plan.outOfScope.length
    }, failed ${plan.failed.length}`
  );
  printGroup("SAFE", plan.safe);
  printGroup("HOLD", plan.hold);
  printGroup("OUT_OF_SCOPE", plan.outOfScope);
  printGroup("FAILED", plan.failed);
}

function parseArgs(argv: string[]): {
  repoRoot: string;
  worktreesRoot: string;
  deleteApproved: boolean;
} {
  let repoRoot = process.cwd();
  let worktreesRoot = DEFAULT_WORKTREES_ROOT;
  let deleteApproved = false;

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--delete-approved") {
      deleteApproved = true;
    } else if (arg === "--worktrees-root") {
      worktreesRoot = argv[++i] ?? worktreesRoot;
    } else if (arg === "--repo-root") {
      repoRoot = argv[++i] ?? repoRoot;
    } else if (!arg.startsWith("--")) {
      repoRoot = arg;
    }
  }
  return { repoRoot, worktreesRoot, deleteApproved };
}

export function createMergedWorktreeReapPlan(
  repoRoot: string,
  worktreesRoot = DEFAULT_WORKTREES_ROOT
): MergedReapPlan {
  const mergedRefs = mergedRemoteBranches(repoRoot);
  const remoteRefs = allRemoteBranches(repoRoot);
  const worktrees = listManagedWorktrees(repoRoot, worktreesRoot);
  return buildMergedReapPlan(
    worktrees.map((worktree) =>
      classifyMergedWorktree(collectFacts(worktree, mergedRefs, remoteRefs))
    )
  );
}

async function main(): Promise<void> {
  const { repoRoot, worktreesRoot, deleteApproved } = parseArgs(
    process.argv.slice(2)
  );
  const plan = createMergedWorktreeReapPlan(repoRoot, worktreesRoot);
  printPlan(plan, !deleteApproved);

  if (!deleteApproved) {
    console.log("[merged-worktree-reap] dry-run only; no worktrees removed.");
    return;
  }

  for (const target of removalTargetsForPlan(plan)) {
    const removed = runGit(["worktree", "remove", "--force", target], repoRoot);
    if (removed.code !== 0) {
      console.error(
        `[merged-worktree-reap] failed to remove ${target}: ${removed.stderr.trim()}`
      );
      process.exitCode = 1;
    } else {
      console.log(`[merged-worktree-reap] removed ${target}`);
    }
  }
}

if (require.main === module) {
  main().catch((error) => {
    console.error(
      `[merged-worktree-reap] fatal: ${
        error instanceof Error ? error.message : String(error)
      }`
    );
    process.exit(1);
  });
}
