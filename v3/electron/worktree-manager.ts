import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { parseDiffNumstat, type DiffStat } from "./merge-features";
import { gitSpawnEnv } from "./git-path";
import { annotateGitFailure } from "./xcode-clt";

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export interface WorktreeInfo {
  path: string;
  branch: string;
  head: string;
}

export interface WorktreeStatus {
  branch: string;
  baseRef: string;
  ahead: number;
  behind: number;
  dirty: boolean;
  mergeable: boolean;
  conflicts: string[];
  filesChanged: number;
  insertions: number;
  deletions: number;
}

export interface CreateWorktreeParams {
  repoRoot: string;
  projectId: string;
  taskId: string;
  slug: string;
  baseRef?: string;
}

/** Result of a rebase-onto-base attempt (WORKTREE-SPEC §4 머지단계). */
export interface RebaseResult {
  ok: boolean;
  /** Unmerged paths captured before the safe `--abort` (only on a real conflict). */
  conflicts?: string[];
  /**
   * Set when the rebase failed for a NON-conflict reason (dirty working tree,
   * bad ref, etc.) — i.e. git refused before a rebase ever started, so there
   * are no `conflicts` to resolve. Lets callers distinguish "needs conflict
   * resolution" from "couldn't even begin" instead of swallowing the cause.
   */
  error?: string;
}

/** Result of the clean squash-merge path (WORKTREE-SPEC §6 머지 실행 주체). */
export interface SquashMergeResult {
  ok: boolean;
  /** True when the rebase step hit a conflict → caller routes to Resolve(agent). */
  needsResolve?: boolean;
  conflicts?: string[];
  /** Populated when a deterministic git step failed for a non-conflict reason. */
  error?: string;
  /**
   * SHA of the squashed commit landed on base — captured before the worktree
   * is torn down, so the merge can be recorded in the audit trail and the
   * original diff recovered later via `git show <sha>`.
   */
  mergedSha?: string;
}

/**
 * Review owner for a worktree's Review stage (WORKTREE-SPEC §6). Pluggable:
 * a human gate, the orchestrator, or the assigned agent. v1 default = 'human'.
 */
export type ReviewOwner = "human" | "orchestrator" | "agent";

/** Default review owner — v1 keeps the final merge click with a human. */
export const DEFAULT_REVIEW_OWNER: ReviewOwner = "human";

/**
 * Review/merge policy attached to a worktree row. `autoMergeWhenGreen` is the
 * opt-in "green이면 자동 머지" toggle from §6 — a placeholder hook in v1 (UI
 * wiring is a follow-up); defaults keep merges human-gated.
 */
export interface ReviewPolicy {
  owner: ReviewOwner;
  autoMergeWhenGreen: boolean;
}

/** v1 default policy: human owner, auto-merge off. */
export const DEFAULT_REVIEW_POLICY: ReviewPolicy = {
  owner: DEFAULT_REVIEW_OWNER,
  autoMergeWhenGreen: false,
};

/** Stale-hygiene verdict for one worktree (WORKTREE-SPEC §4 stale 감지). */
export interface StaleInfo {
  /** Branch tip has no commits beyond base (already merged / nothing to merge). */
  merged: boolean;
  /** Whole days since the last commit (0 when there is no commit / can't tell). */
  idleDays: number;
  /** Cleanup candidate: merged OR idle past the threshold. */
  stale: boolean;
  /**
   * Branch carries commits that exist ONLY here — not in base, and not on a
   * remote-tracking ref. Removing or hiding such a worktree can strand work no
   * one else can see, so it vetoes auto-archive at ANY idle threshold (see
   * `archiveSafetyBlocker` in src/lib/worktreeHygiene).
   *
   * True when the branch is unmerged AND either it is ahead of its upstream or
   * it has no upstream at all (never pushed → every commit is local-only).
   * `false` for a merged branch: base already carries the work.
   *
   * Optional so a verdict produced before this field existed (persisted cache,
   * older main process) reads as "not known to be unpushed" rather than
   * fabricating a safety guarantee — callers pair it with the other blockers.
   */
  unpushed?: boolean;
}

/** Options for stale detection. `now` is injectable for deterministic tests. */
export interface StaleOptions {
  /** Idle days that mark a worktree stale even when unmerged. Default 5. */
  maxIdleDays?: number;
  /** Reference "now" for idleDays math. Defaults to the wall clock. */
  now?: Date;
}

/** Outcome of a bulk stale cleanup (WORKTREE-SPEC §4 일괄 cleanup). */
export interface CleanupStaleResult {
  /** Worktree paths successfully removed. */
  removed: string[];
  /** Worktrees that were stale but failed to remove, with the reason. */
  failed: { path: string; error: string }[];
}

/**
 * Work-loss safety verdict for reaping one worktree. A worktree is only
 * `safe` to remove when removing it cannot lose work: the tree is clean AND
 * every commit is either already merged into base or pushed to the remote
 * (a PR carries it). `blockers` enumerates the reasons it is NOT safe.
 */
export interface ReapSafety {
  /** Working tree has uncommitted changes (`git status --porcelain` non-empty). */
  dirty: boolean;
  /** Branch tip has no commits beyond base (already merged / never diverged). */
  merged: boolean;
  /**
   * Commits on HEAD that are neither in base nor on `origin/<branch>` — i.e.
   * local-only work that removal would destroy. `-1` means the branch state
   * could not be read (treated as unsafe, conservatively).
   */
  unpushedCommits: number;
  /** Safe to `git worktree remove` without losing work. */
  safe: boolean;
  /** Human-readable reasons removal was refused (empty when `safe`). */
  blockers: string[];
}

/** Outcome of reaping a single worktree (auto-reap on DONE / merge). */
export interface ReapResult {
  path: string;
  removed: boolean;
  /** Branch the worktree was on (captured before teardown), when known. */
  branch?: string;
  /** Why it was removed, or why it was preserved. */
  reason: string;
  safety: ReapSafety;
}

/** Outcome of a bulk reap sweep over every worktree under a repo. */
export interface ReapAllResult {
  /** Worktree paths successfully removed. */
  removed: string[];
  /** Worktrees deliberately kept (unmerged/dirty work), with the reason. */
  preserved: { path: string; reason: string }[];
  /** Worktrees that were reap candidates but errored, with the reason. */
  failed: { path: string; error: string }[];
}

/** Options for a reap (single or bulk). */
export interface ReapOptions {
  /** Override the auto-resolved base ref (origin default branch). */
  baseRef?: string;
  /**
   * Only reap when the branch is fully merged into base. Use for the
   * "PR merged" trigger; leave false for the "task DONE" trigger, which still
   * reaps a clean, fully-pushed worktree even before the squash lands on base.
   */
  requireMerged?: boolean;
}

const STALE_MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Idle days after which an unmerged worktree counts as stale (auto-archive
 * candidate). Lowered 14 → 5 (ticket MT2ny8ng).
 *
 * ── Why 5 ────────────────────────────────────────────────────────────────────
 * At 14 days the filter barely bit: measured over 135 live worktrees, only 15
 * unmerged ones cleared it while 55 sat in the 4–13 day band — visible, and
 * uniformly dead. The idle histogram has no natural cliff inside the approved
 * 3–5 day range, so the tie-break is the work week, not the data: idleDays
 * counts from the last COMMIT, so a branch committed Thursday and picked back
 * up Monday reads as 4 days idle. A 4-day threshold hides live work across an
 * ordinary weekend; 5 clears it. Hence the top of the approved range.
 *
 * Crossing this threshold is necessary but NOT sufficient to hide a worktree —
 * dirty / unpushed / busy each veto it outright. See `archiveSafetyBlocker`.
 */
const DEFAULT_MAX_IDLE_DAYS = 5;

/**
 * The pre-MT2ny8ng threshold, kept as a distinct band rather than deleted.
 *
 * The renderer can only enforce the `dirty` veto where it actually has a
 * `status` probe, and the light (topology-only) path deliberately has none —
 * probing dirtiness per worktree is exactly the per-worktree-spawn pattern #511
 * removed (measured: 2 repo-level spawns 52ms vs 135 status spawns 960ms).
 * So the newly aggressive 5–13 day band only archives when cleanliness is
 * *known*; at 14+ the legacy behaviour stands unchanged. See `isAutoArchived`.
 */
export const LEGACY_MAX_IDLE_DAYS = 14;

/**
 * Timeout for the pre-create `git fetch origin` (WORKTREE-SPEC §3 최신 base).
 * A short cap so an offline/auth-wedged fetch can't hang worktree creation —
 * on timeout we fall back to the last-known local origin ref.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Relative node_modules locations to provision into a fresh worktree, in the
 * order they are linked. Monorepo-aware: node_modules can live at the repo root
 * and/or under packages with their own dependency trees that agents commonly
 * test from isolated worktrees, so we link whichever sources actually exist.
 */
const NODE_MODULES_CANDIDATES = [
  "node_modules",
  path.join("v3", "node_modules"),
  path.join("v3", "functions", "node_modules"),
];

/**
 * Symlink the main repo's node_modules into a freshly created worktree so the
 * isolated agent can run npm typecheck/test/build without a fresh install.
 * node_modules is `.gitignore`d, so it never exists in a fresh checkout.
 *
 * For each candidate (repo root + selected v3 package dependency dirs), if the
 * source exists under `repoRoot` it is linked to the matching path under
 * `worktreePath` with an ABSOLUTE symlink (no copy → instant, zero disk).
 *
 * - Idempotent: any existing entry at the target — including a symlink, even a
 *   broken one — is left untouched and skipped (`lstat` does not follow links).
 * - Never throws: a missing source or a failed link only logs a warning;
 *   worktree creation itself must always succeed.
 *
 * Exported (not just a private method) so it is directly unit-testable.
 */
export function provisionNodeModules(
  repoRoot: string,
  worktreePath: string,
): void {
  for (const rel of NODE_MODULES_CANDIDATES) {
    const src = path.resolve(repoRoot, rel); // absolute → absolute symlink
    const dest = path.join(worktreePath, rel);
    try {
      // Source must exist — skip silently otherwise (never-throw).
      if (!fs.existsSync(src)) continue;
      // Idempotent: bail if anything already occupies the target. lstat does
      // not follow symlinks, so a present (even broken) link still counts.
      try {
        fs.lstatSync(dest);
        continue; // already provisioned
      } catch {
        // ENOENT — nothing there; fall through and create the link.
      }
      // The parent (e.g. <wt>/v3) exists in any real checkout; mkdir is a
      // cheap, idempotent guard so an unexpected layout can't make us throw.
      fs.mkdirSync(path.dirname(dest), { recursive: true });
      fs.symlinkSync(src, dest, "dir");
    } catch (e) {
      // Best-effort: log and move on so create() still resolves successfully.
      console.warn(
        `[WorktreeManager] node_modules provisioning skipped for ${rel}: ${
          e instanceof Error ? e.message : String(e)
        }`,
      );
    }
  }
}

/**
 * Does this branch carry commits that live ONLY in this worktree?
 *
 * Derived from `git for-each-ref`'s `%(upstream)` / `%(upstream:track)` fields,
 * so it is computable for every branch in one repo-level spawn.
 *
 *  - merged into base        → false. Base already has the work; nothing to strand.
 *  - no upstream configured  → true.  Never pushed, so every commit beyond base
 *                                     exists on this disk and nowhere else.
 *  - "[ahead N]" / "[gone]"  → true.  Local commits the remote does not have,
 *                                     or a remote branch that has been deleted.
 *  - "" or "[behind N]" only → false. Everything local is on the remote; a PR
 *                                     or the remote branch carries it.
 *
 * Exported for direct unit testing of the parse — the `[ahead 1, behind 2]`
 * shape is the one a naive `includes("ahead")` check gets right by luck and a
 * whitespace split gets wrong.
 */
export function computeUnpushed(
  merged: boolean,
  upstream: string,
  track: string,
): boolean {
  if (merged) return false;
  if (!upstream.trim()) return true;
  const t = track.trim();
  return t.includes("ahead") || t.includes("gone");
}

export class WorktreeManager {
  private worktreesRoot: string;

  constructor(opts?: { worktreesRoot?: string }) {
    this.worktreesRoot =
      opts?.worktreesRoot ?? path.join(os.homedir(), ".marblo", "worktrees");
  }

  /** Root that holds every task worktree (`<root>/<projectId>/<taskId>`).
   * Exposed for the lifecycle sweep, which enumerates it directly. */
  getWorktreesRoot(): string {
    return this.worktreesRoot;
  }

  /**
   * Single choke-point for git. Never rejects — always resolves a GitResult.
   * With `opts.timeoutMs`, a hung process is SIGKILLed and resolved as a
   * non-zero failure (stderr notes the timeout) so callers never hang.
   *
   * Because it is the single choke-point, it is also where a macOS Xcode CLT
   * failure (license not agreed / CLT missing) is translated: every downstream
   * error string here is built from `stderr`, so rewriting it once means every
   * worktree operation reports "run this command" instead of raw xcrun output
   * (ticket nETj7szjEtT5prbYsg1D).
   */
  private runGit(
    args: string[],
    cwd: string,
    opts?: { timeoutMs?: number },
  ): Promise<GitResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      let settled = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (r: GitResult) => {
        if (settled) return;
        settled = true;
        if (timer) clearTimeout(timer);
        resolve(
          r.code === 0 || !r.stderr
            ? r
            : { ...r, stderr: annotateGitFailure(r.stderr) },
        );
      };
      try {
        const proc = spawn("git", args, { cwd, env: gitSpawnEnv() });
        if (opts?.timeoutMs && opts.timeoutMs > 0) {
          timer = setTimeout(() => {
            try {
              proc.kill("SIGKILL");
            } catch {
              /* process already gone — ignore */
            }
            finish({
              code: 1,
              stdout,
              stderr:
                stderr ||
                `git ${args[0] ?? ""} timed out after ${opts.timeoutMs}ms`,
            });
          }, opts.timeoutMs);
          // Don't let a pending timeout keep the event loop alive.
          timer.unref?.();
        }
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", (code) => finish({ code: code ?? 1, stdout, stderr }));
        proc.on("error", (e) => finish({ code: 1, stdout, stderr: String(e) }));
      } catch (e) {
        finish({ code: 1, stdout, stderr: String(e) });
      }
    });
  }

  /** Prefer origin's default branch; fall back to the local current branch. */
  async resolveBaseRef(repoRoot: string): Promise<string> {
    const sym = await this.runGit(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoRoot,
    );
    if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim();
    const cur = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoRoot,
    );
    if (cur.code === 0 && cur.stdout.trim()) return cur.stdout.trim();
    return "HEAD";
  }

  /**
   * Refresh `origin` so a new worktree branches off the LATEST upstream base,
   * not a stale local tracking ref (WORKTREE-SPEC §3 최신 base 보장). Without
   * this, resolveBaseRef() reads `refs/remotes/origin/HEAD`, which is only as
   * fresh as the last fetch — main can have advanced since.
   *
   * Best-effort and NEVER throws (create() is a never-throw path): on offline /
   * auth failure / timeout it logs a VISIBLE warning and returns false so the
   * caller falls back to the last-known local origin ref. A short timeout
   * (default 15s) keeps a wedged fetch from hanging worktree creation.
   *
   * Returns true when the fetch succeeded (refs are fresh), false otherwise.
   */
  async fetchOrigin(
    repoRoot: string,
    timeoutMs: number = DEFAULT_FETCH_TIMEOUT_MS,
  ): Promise<boolean> {
    const res = await this.runGit(["fetch", "origin"], repoRoot, {
      timeoutMs,
    });
    if (res.code !== 0) {
      console.warn(
        `[WorktreeManager] git fetch origin failed — branching the worktree ` +
          `off the last-known local origin ref (may be stale): ${
            res.stderr.trim() || `exit ${res.code}`
          }`,
      );
      return false;
    }
    return true;
  }

  /** Sanitize a free-form slug into a branch-safe segment (≤32 chars). */
  private sanitizeSlug(slug: string): string {
    return (
      slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "task"
    );
  }

  /** marblo/<sanitized-slug>-<first 8 of taskId> (default, collision-prone). */
  private branchName(slug: string, taskId: string): string {
    return `marblo/${this.sanitizeSlug(slug)}-${taskId.slice(0, 8)}`;
  }

  /** True when a local branch ref `<name>` already exists in `repoRoot`. */
  private async branchExists(repoRoot: string, name: string): Promise<boolean> {
    const res = await this.runGit(
      ["rev-parse", "--verify", "--quiet", `refs/heads/${name}`],
      repoRoot,
    );
    return res.code === 0;
  }

  /**
   * Pick a branch name that does not collide with an existing local branch
   * (L4). The default `marblo/<slug>-<id8>` keeps the short, readable form for
   * the overwhelmingly common no-collision case; only on an actual clash do we
   * escalate specificity — first by widening the taskId slice (12 → 16 → full
   * id), then, if even the full id collides, by appending a numeric suffix.
   * This makes `create()` robust to two taskIds that share their first 8 chars
   * (or a leftover branch from a previous run) instead of failing the worktree
   * add outright. Returns the default name unchanged when there is no clash, so
   * existing exact-name expectations are preserved.
   */
  private async uniqueBranchName(
    repoRoot: string,
    slug: string,
    taskId: string,
  ): Promise<string> {
    const slugPart = this.sanitizeSlug(slug);
    const candidate = (idLen: number) =>
      `marblo/${slugPart}-${taskId.slice(0, idLen)}`;

    const base = candidate(8);
    if (!(await this.branchExists(repoRoot, base))) return base;

    // Collision — widen the id slice. Dedupe so we don't retest the same
    // string when taskId is shorter than the next width.
    const widths = [...new Set([12, 16, taskId.length])].filter((w) => w > 8);
    for (const w of widths) {
      const cand = candidate(w);
      if (cand !== base && !(await this.branchExists(repoRoot, cand))) {
        return cand;
      }
    }

    // Even the full id collides (or taskId ≤ 8 chars) — append a counter.
    for (let i = 2; i < 1000; i++) {
      const cand = `${base}-${i}`;
      if (!(await this.branchExists(repoRoot, cand))) return cand;
    }
    // Pathological: 1000 collisions. Fall back to the full id + base so the
    // caller still gets a deterministic name (worktree add will surface any
    // remaining clash as its own error).
    return `${base}-${taskId}`;
  }

  /**
   * Agent worktrees must have one unambiguous push destination when a remote
   * exists. An entirely local repository has no remote to mis-select, so it
   * remains valid and its later plain push stays noisy.
   */
  private async assertPinnedOrigin(repoRoot: string): Promise<boolean> {
    const remotes = await this.runGit(["remote"], repoRoot);
    if (remotes.code !== 0) {
      throw new Error("could not inspect remotes before worktree creation");
    }
    const names = remotes.stdout
      .split("\n")
      .map((name) => name.trim())
      .filter(Boolean);
    if (names.length === 0) return false;
    if (!names.includes("origin")) {
      throw new Error(
        "worktree creation requires an explicit origin remote; refusing to select another remote",
      );
    }

    const [fetchUrl, pushUrl] = await Promise.all([
      this.runGit(["remote", "get-url", "origin"], repoRoot),
      this.runGit(["remote", "get-url", "--push", "origin"], repoRoot),
    ]);
    if (
      fetchUrl.code !== 0 ||
      pushUrl.code !== 0 ||
      !fetchUrl.stdout.trim() ||
      !pushUrl.stdout.trim()
    ) {
      throw new Error(
        "origin must have explicit fetch and push URLs; refusing remote fallback",
      );
    }
    return true;
  }

  /** Pin a new branch to origin without changing shared push defaults. */
  private async configureBranchUpstream(
    repoRoot: string,
    branch: string,
  ): Promise<void> {
    // Linked worktrees share common config. Retry transient config.lock
    // contention between concurrent worktree creators before surfacing it.
    const setConfig = async (key: string, value: string) => {
      let result = await this.runGit(
        ["config", "--local", key, value],
        repoRoot,
      );
      for (let attempt = 1; attempt <= 3 && result.code !== 0; attempt++) {
        if (!/could not lock config file|config\.lock/i.test(result.stderr)) {
          return result;
        }
        await new Promise<void>((resolve) => setTimeout(resolve, attempt * 50));
        result = await this.runGit(["config", "--local", key, value], repoRoot);
      }
      return result;
    };
    const remote = await setConfig(`branch.${branch}.remote`, "origin");
    const merge = await setConfig(
      `branch.${branch}.merge`,
      `refs/heads/${branch}`,
    );
    if (remote.code !== 0 || merge.code !== 0) {
      const failure = remote.code !== 0 ? remote : merge;
      const contention = /could not lock config file|config\.lock/i.test(
        failure.stderr,
      );
      throw new Error(
        `failed to pin branch ${branch} to origin${
          contention
            ? " due to concurrent worktree creation config-lock contention"
            : ""
        }`,
      );
    }
  }

  async create(params: CreateWorktreeParams): Promise<WorktreeInfo> {
    const idPattern = /^[A-Za-z0-9_-]+$/;
    if (!idPattern.test(params.projectId)) {
      throw new Error(`invalid projectId: ${params.projectId}`);
    }
    if (!idPattern.test(params.taskId)) {
      throw new Error(`invalid taskId: ${params.taskId}`);
    }
    const hasPinnedOrigin = await this.assertPinnedOrigin(params.repoRoot);
    // Refresh origin BEFORE resolving the base so the worktree forks off the
    // latest upstream main — UNLESS the caller pinned an explicit baseRef, in
    // which case we respect their intent and skip the fetch. fetchOrigin()
    // never throws; a fetch failure only warns and falls back to the local ref.
    if (hasPinnedOrigin && params.baseRef === undefined) {
      await this.fetchOrigin(params.repoRoot);
    }
    const baseRef =
      params.baseRef ?? (await this.resolveBaseRef(params.repoRoot));
    // Collision-safe: keeps the short `marblo/<slug>-<id8>` name unless that
    // ref already exists, in which case it escalates specificity (L4).
    const branch = await this.uniqueBranchName(
      params.repoRoot,
      params.slug,
      params.taskId,
    );
    const wtPath = path.join(
      this.worktreesRoot,
      params.projectId,
      params.taskId,
    );
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    const res = await this.runGit(
      ["worktree", "add", "-b", branch, wtPath, baseRef],
      params.repoRoot,
    );
    if (res.code !== 0) {
      throw new Error(`git worktree add failed: ${res.stderr.trim()}`);
    }
    if (hasPinnedOrigin) {
      await this.configureBranchUpstream(params.repoRoot, branch);
    }

    // Provision node_modules immediately so the isolated agent can run
    // npm typecheck/test/build without a fresh install. Best-effort &
    // never-throws — a failure here must not fail worktree creation.
    provisionNodeModules(params.repoRoot, wtPath);

    const headRes = await this.runGit(["rev-parse", "HEAD"], wtPath);
    // Normalize the path to resolve OS-level symlinks (e.g. /var → /private/var on macOS)
    // so that create() and list() return consistent paths for equality checks.
    const realWtPath = fs.realpathSync(wtPath);
    return { path: realWtPath, branch, head: headRes.stdout.trim() };
  }

  async list(repoRoot: string): Promise<WorktreeInfo[]> {
    const res = await this.runGit(
      ["worktree", "list", "--porcelain"],
      repoRoot,
    );
    if (res.code !== 0) return [];

    const out: WorktreeInfo[] = [];
    let cur: Partial<WorktreeInfo> = {};
    const flush = () => {
      if (cur.path) {
        out.push({
          path: cur.path,
          branch: cur.branch ?? "",
          head: cur.head ?? "",
        });
      }
      cur = {};
    };
    for (const line of res.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        flush();
        const rawPath = line.slice("worktree ".length).trim();
        // Normalize symlinks (e.g. /var → /private/var on macOS) for consistent paths.
        cur.path = fs.existsSync(rawPath) ? fs.realpathSync(rawPath) : rawPath;
      } else if (line.startsWith("HEAD ")) {
        cur.head = line.slice("HEAD ".length).trim();
      } else if (line.startsWith("branch ")) {
        cur.branch = line
          .slice("branch ".length)
          .trim()
          .replace("refs/heads/", "");
      }
    }
    flush();
    return out;
  }

  async status(worktreePath: string, baseRef: string): Promise<WorktreeStatus> {
    const branchRes = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktreePath,
    );
    const branch = branchRes.stdout.trim();

    // behind = left (baseRef-only), ahead = right (HEAD-only)
    const ab = await this.runGit(
      ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`],
      worktreePath,
    );
    let behind = 0;
    let ahead = 0;
    if (ab.code === 0) {
      const parts = ab.stdout.trim().split(/\s+/);
      behind = parseInt(parts[0] ?? "0", 10) || 0;
      ahead = parseInt(parts[1] ?? "0", 10) || 0;
    }

    const st = await this.runGit(["status", "--porcelain"], worktreePath);
    const dirty = st.stdout.trim().length > 0;

    // ahead === 0 (trusted count) ⇒ HEAD is an ancestor of baseRef: the
    // three-dot diff is empty and merge-tree is trivially conflict-free, so
    // both subprocesses below are pure overhead. At 600+ registered worktrees
    // — most of them already merged — skipping them cuts a full worktree:list
    // sweep by two git spawns per merged worktree.
    if (ab.code === 0 && ahead === 0) {
      return {
        branch,
        baseRef,
        ahead,
        behind,
        dirty,
        mergeable: true,
        conflicts: [],
        filesChanged: 0,
        insertions: 0,
        deletions: 0,
      };
    }

    const ns = await this.runGit(
      ["diff", "--numstat", `${baseRef}...HEAD`],
      worktreePath,
    );
    let filesChanged = 0;
    let insertions = 0;
    let deletions = 0;
    for (const line of ns.stdout.split("\n")) {
      if (!line.trim()) continue;
      const [ins, del] = line.split("\t");
      filesChanged++;
      insertions += ins === "-" ? 0 : parseInt(ins, 10) || 0;
      deletions += del === "-" ? 0 : parseInt(del, 10) || 0;
    }

    // mergeable / conflicts — requires git >= 2.38 (--write-tree).
    // Output sections: <tree OID> line, conflicted file names, a blank line,
    // then informational messages. Treat as a real conflict ONLY when exit
    // code is 1 AND the first line is a tree OID — this distinguishes a true
    // conflict from "cannot merge / bad ref", which also exits 1 with no OID.
    const mt = await this.runGit(
      ["merge-tree", "--write-tree", "--name-only", baseRef, "HEAD"],
      worktreePath,
    );
    const mtLines = mt.stdout.split("\n");
    const firstLine = mtLines[0]?.trim() ?? "";
    const hasConflicts = mt.code === 1 && /^[0-9a-f]{7,64}$/.test(firstLine);
    let conflicts: string[] = [];
    if (hasConflicts) {
      // Cut at the first blank line after the OID — everything before it
      // (minus the OID line) is the conflicted-file-names section.
      const blankIdx = mtLines.findIndex((l, i) => i > 0 && l.trim() === "");
      const fileLines = blankIdx === -1 ? mtLines : mtLines.slice(0, blankIdx);
      conflicts = fileLines
        .slice(1)
        .map((l) => l.trim())
        .filter(Boolean);
    }

    return {
      branch,
      baseRef,
      ahead,
      behind,
      dirty,
      mergeable: !hasConflicts,
      conflicts,
      filesChanged,
      insertions,
      deletions,
    };
  }

  /**
   * De-identified diff stats for a single (squash-merged) commit landed on
   * base, via `git show --numstat`. `--format=` drops the commit header so only
   * numstat lines remain; `-M` folds renames. Returns null on any git failure —
   * merge-outcome telemetry treats missing stats as "unknown" and never fails
   * the merge over it. Privacy gate: only counts + paths, never diff text.
   */
  async mergedCommitDiffStat(
    repoRoot: string,
    sha: string,
  ): Promise<DiffStat | null> {
    const res = await this.runGit(
      ["show", "--numstat", "--format=", "-M", sha],
      repoRoot,
      { timeoutMs: 15_000 },
    );
    if (res.code !== 0) return null;
    return parseDiffNumstat(res.stdout);
  }

  async remove(
    repoRoot: string,
    worktreePath: string,
    opts?: { deleteBranch?: boolean },
  ): Promise<void> {
    let branch = "";
    if (opts?.deleteBranch) {
      const b = await this.runGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        worktreePath,
      );
      if (b.code === 0) branch = b.stdout.trim();
    }

    const res = await this.runGit(
      ["worktree", "remove", "--force", worktreePath],
      repoRoot,
    );
    if (res.code !== 0) {
      throw new Error(`git worktree remove failed: ${res.stderr.trim()}`);
    }

    if (opts?.deleteBranch && branch) {
      const del = await this.runGit(["branch", "-D", branch], repoRoot);
      if (del.code !== 0) {
        console.warn(
          `[WorktreeManager] failed to delete branch ${branch}: ${del.stderr.trim()}`,
        );
      }
    }
  }

  /**
   * True when a rebase is mid-flight in `worktreePath` — i.e. git's rebase
   * state dir (`rebase-merge` or `rebase-apply`) exists under this worktree's
   * git dir. This is the signal that `git rebase` actually STARTED and stopped
   * on a conflict, as opposed to refusing before it began (dirty tree, bad
   * ref). `git rev-parse --git-path` resolves the correct per-worktree git dir
   * for a linked worktree, so this is accurate even off the main checkout.
   */
  private async rebaseInProgress(worktreePath: string): Promise<boolean> {
    for (const state of ["rebase-merge", "rebase-apply"]) {
      const gp = await this.runGit(
        ["rev-parse", "--git-path", state],
        worktreePath,
      );
      if (gp.code !== 0) continue;
      const raw = gp.stdout.trim();
      if (!raw) continue;
      const abs = path.isAbsolute(raw) ? raw : path.join(worktreePath, raw);
      if (fs.existsSync(abs)) return true;
    }
    return false;
  }

  /**
   * Rebase the worktree's branch onto `baseRef` (WORKTREE-SPEC §4 머지단계).
   * Runs `git rebase <baseRef>` inside the worktree. On success → {ok:true}.
   *
   * On a non-zero exit we must NOT blindly assume "conflict" (the old bug, M5):
   * `git rebase` also exits non-zero when it refuses to even start — a dirty
   * working tree ("cannot rebase: you have unstaged changes"), a bad/unknown
   * ref, etc. Those leave NO rebase in progress and NO unmerged paths, so the
   * old code returned `{ok:false, conflicts:[]}` and spuriously ran
   * `rebase --abort` ("no rebase in progress"), mis-routing the caller to the
   * conflict-resolver with nothing to resolve and swallowing the real cause.
   *
   * So we discriminate on whether a rebase actually STARTED:
   *  - mid-flight (rebase state dir present) → genuine conflict. Capture the
   *    unmerged paths, `--abort` to restore the tree, return {ok:false,
   *    conflicts}.
   *  - not started → surface the underlying error as {ok:false, error}; there
   *    is nothing to abort.
   */
  async rebaseOntoBase(
    worktreePath: string,
    baseRef: string,
  ): Promise<RebaseResult> {
    const res = await this.runGit(["rebase", baseRef], worktreePath);
    if (res.code === 0) return { ok: true };

    // Did a rebase actually start and stop mid-flight? Only then is this a
    // real conflict that the resolver can act on.
    if (await this.rebaseInProgress(worktreePath)) {
      const unmerged = await this.runGit(
        ["diff", "--name-only", "--diff-filter=U"],
        worktreePath,
      );
      const conflicts = unmerged.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      // Abort to leave the working tree exactly as it was pre-rebase.
      await this.runGit(["rebase", "--abort"], worktreePath);
      return { ok: false, conflicts };
    }

    // Pre-flight refusal (dirty tree / bad ref / etc.): no rebase in progress,
    // nothing to abort. Surface the real reason instead of swallowing it.
    return {
      ok: false,
      error:
        res.stderr.trim() ||
        res.stdout.trim() ||
        `git rebase ${baseRef} failed (exit ${res.code})`,
    };
  }

  /**
   * Clean merge path (WORKTREE-SPEC §6): rebase the worktree branch onto base,
   * land a single squashed commit on the LOCAL base branch, then remove the
   * worktree + branch. Deterministic; safe-stops on conflict/dirty without
   * breaking either working tree.
   *
   * H2 (data-loss) hardening — two invariants this method now guarantees:
   *
   *  ① The squash is computed against `baseRef` itself (its resolved commit),
   *     NOT against whatever branch repoRoot happens to have checked out. The
   *     old code ran `git merge --squash` against repoRoot's HEAD, so when HEAD
   *     diverged from baseRef (e.g. baseRef=origin/main while repoRoot sat on a
   *     stale local main) the squash conflated unrelated commits or landed on
   *     the wrong branch. We resolve `baseRef^{commit}` and pick a landing
   *     strategy from how repoRoot relates to THAT commit.
   *
   *  ② No destructive git command (squash-stage, `reset --hard`, ff) ever runs
   *     against a repoRoot that has uncommitted changes. A dirty repoRoot is
   *     refused up front, so a user's in-progress WIP can never be wiped. The
   *     old error paths ran `git reset --hard` on repoRoot unconditionally,
   *     destroying any uncommitted work.
   *
   *   (a) rebaseOntoBase — real conflict → {ok:false, needsResolve:true}; a
   *       non-conflict rebase failure (dirty/bad ref) → {ok:false, error}.
   *   (b) Land the squash on base (strategy by repoRoot↔base relationship).
   *   (c) remove(repoRoot, worktreePath, {deleteBranch:true}).
   */
  async squashMergeToBase(
    repoRoot: string,
    worktreePath: string,
    baseRef: string,
    branch: string,
  ): Promise<SquashMergeResult> {
    // (a) Rebase first. A real conflict routes to Resolve(agent); a non-conflict
    // failure (dirty worktree / bad ref) is surfaced as a plain error rather
    // than mis-routed to the resolver with an empty conflict list (M5).
    const rebase = await this.rebaseOntoBase(worktreePath, baseRef);
    if (!rebase.ok) {
      if (rebase.error) return { ok: false, error: rebase.error };
      return {
        ok: false,
        needsResolve: true,
        conflicts: rebase.conflicts ?? [],
      };
    }

    // Resolve the EXACT base commit we squash onto — this, not repoRoot's
    // current HEAD, is the merge basis (H2 ①).
    const baseShaRes = await this.runGit(
      ["rev-parse", "--verify", `${baseRef}^{commit}`],
      repoRoot,
    );
    if (baseShaRes.code !== 0) {
      return {
        ok: false,
        error: `cannot resolve baseRef '${baseRef}': ${baseShaRes.stderr.trim()}`,
      };
    }
    const baseSha = baseShaRes.stdout.trim();

    const repoHeadRes = await this.runGit(["rev-parse", "HEAD"], repoRoot);
    if (repoHeadRes.code !== 0) {
      return {
        ok: false,
        error: `cannot resolve repoRoot HEAD: ${repoHeadRes.stderr.trim()}`,
      };
    }
    const repoHead = repoHeadRes.stdout.trim();

    // H2 ②: refuse to touch a repoRoot that has uncommitted changes. No squash,
    // no reset, no ref move — the user's WIP is left exactly as it is, and the
    // worktree is preserved so the merge can be retried after they commit/stash.
    const dirtyRes = await this.runGit(["status", "--porcelain"], repoRoot);
    if (dirtyRes.stdout.trim().length > 0) {
      return {
        ok: false,
        error:
          "repoRoot has uncommitted changes; commit or stash them before " +
          "merging (refusing to risk your working tree)",
      };
    }
    // repoRoot is clean from here on, so any `reset --hard` below restores a
    // known-clean state and cannot discard user work.

    // How does repoRoot's checked-out branch relate to the base commit?
    //  - baseSha is an ancestor of repoHead → repoRoot is at/ahead of base.
    //  - repoHead is an ancestor of baseSha → repoRoot is strictly behind base.
    const baseAncestorOfRepo =
      (
        await this.runGit(
          ["merge-base", "--is-ancestor", baseSha, repoHead],
          repoRoot,
        )
      ).code === 0;
    const repoAncestorOfBase =
      (
        await this.runGit(
          ["merge-base", "--is-ancestor", repoHead, baseSha],
          repoRoot,
        )
      ).code === 0;

    if (baseAncestorOfRepo) {
      // (b1) repoRoot is up-to-date with (or ahead of) base. merge-base(repoHead,
      // branch) == baseSha (branch was just rebased onto baseSha and repoHead
      // descends from baseSha), so `git merge --squash` stages exactly the
      // task's net changes onto the checked-out base branch — correct, and the
      // working tree reflects it. (This is the tested clean-merge path.)
      const squash = await this.runGit(["merge", "--squash", branch], repoRoot);
      if (squash.code !== 0) {
        // repoRoot verified clean above → restoring to the captured HEAD only
        // discards the half-staged merge, never user WIP. (`merge --abort` is a
        // no-op for --squash but harmless.)
        await this.runGit(["merge", "--abort"], repoRoot);
        await this.runGit(["reset", "--hard", repoHead], repoRoot);
        return {
          ok: false,
          error: `merge --squash failed: ${squash.stderr.trim()}`,
        };
      }
      const commit = await this.runGit(
        ["commit", "-m", `Merge ${branch} (squash)`],
        repoRoot,
      );
      if (commit.code !== 0) {
        await this.runGit(["reset", "--hard", repoHead], repoRoot);
        return {
          ok: false,
          error: `squash commit failed: ${commit.stderr.trim()}`,
        };
      }
    } else if (repoAncestorOfBase) {
      // (b2) repoRoot is strictly BEHIND base (e.g. local main behind
      // origin/main — the divergence the old code mis-squashed). Build the
      // squashed commit on top of the resolved base via pure plumbing
      // (commit-tree touches no working tree or index), then fast-forward
      // repoRoot onto it. repoHead is an ancestor of baseSha and the new commit
      // descends from baseSha, so `merge --ff-only` is a guaranteed pure
      // fast-forward: it brings repoRoot up to base AND lands the task in one
      // move, with zero risk (repoRoot verified clean).
      const treeRes = await this.runGit(
        ["rev-parse", "--verify", `${branch}^{tree}`],
        repoRoot,
      );
      if (treeRes.code !== 0) {
        return {
          ok: false,
          error: `cannot resolve tree of '${branch}': ${treeRes.stderr.trim()}`,
        };
      }
      const newCommit = await this.runGit(
        [
          "commit-tree",
          treeRes.stdout.trim(),
          "-p",
          baseSha,
          "-m",
          `Merge ${branch} (squash)`,
        ],
        repoRoot,
      );
      if (newCommit.code !== 0) {
        return {
          ok: false,
          error: `commit-tree failed: ${newCommit.stderr.trim()}`,
        };
      }
      const ff = await this.runGit(
        ["merge", "--ff-only", newCommit.stdout.trim()],
        repoRoot,
      );
      if (ff.code !== 0) {
        return {
          ok: false,
          error: `fast-forward to squash commit failed: ${ff.stderr.trim()}`,
        };
      }
    } else {
      // (b3) repoRoot's branch has diverged from base in BOTH directions
      // (unrelated history / rewritten base). Landing here would either lose
      // repoRoot's local commits or fabricate a misleading history — refuse and
      // preserve everything (worktree kept) rather than guess.
      return {
        ok: false,
        error:
          `repoRoot branch has diverged from base '${baseRef}' ` +
          "(neither is an ancestor of the other); resolve manually",
      };
    }

    // Capture the squashed commit's SHA on base BEFORE teardown — once the
    // worktree+branch are gone this is the only stable handle on the merge.
    const headRev = await this.runGit(["rev-parse", "HEAD"], repoRoot);
    const mergedSha = headRev.code === 0 ? headRev.stdout.trim() : undefined;

    // (c) Tear down the now-merged worktree and its branch.
    await this.remove(repoRoot, worktreePath, { deleteBranch: true });
    return { ok: true, mergedSha };
  }

  /**
   * Render a merged commit for the audit-trail diff view: `git show` with a
   * stat header + patch, no color/pager. Used by WorktreeTab's "완료 이력" to
   * recover what a now-removed worktree actually landed on base. Output is
   * capped so a giant squash can't flood the renderer.
   */
  async showCommit(repoRoot: string, sha: string): Promise<string> {
    const res = await this.runGit(
      ["show", "--stat", "--patch", "--no-color", sha],
      repoRoot,
    );
    if (res.code !== 0) {
      throw new Error(`git show ${sha} failed: ${res.stderr.trim()}`);
    }
    const MAX = 200_000; // ~200KB guard against pathological squashes
    return res.stdout.length > MAX
      ? `${res.stdout.slice(0, MAX)}\n\n…(생략됨 — 전체는 git show ${sha})`
      : res.stdout;
  }

  async prune(repoRoot: string): Promise<void> {
    await this.runGit(["worktree", "prune"], repoRoot);
  }

  /**
   * status()'s mergeability check uses `git merge-tree --write-tree`, which
   * requires git >= 2.38. Parse `git --version` and warn when the local git is
   * too old so the unreliable mergeable/conflicts fields are explained.
   */
  async gitSupportsMergeTree(): Promise<{ ok: boolean; version: string }> {
    const res = await this.runGit(["--version"], process.cwd());
    const m = res.stdout.match(/(\d+)\.(\d+)(?:\.(\d+))?/);
    const version = m ? m[0] : res.stdout.trim();
    const major = m ? parseInt(m[1], 10) : 0;
    const minor = m ? parseInt(m[2], 10) : 0;
    const ok = major > 2 || (major === 2 && minor >= 38);
    if (!ok) {
      console.warn(
        `[WorktreeManager] git ${version || "unknown"} < 2.38 — ` +
          `merge-tree --write-tree unsupported; status() mergeability may be unreliable.`,
      );
    }
    return { ok, version };
  }

  /**
   * True when the worktree's HEAD has no commits beyond `baseRef` — i.e. the
   * branch is already merged into base (or never diverged). Implemented via
   * `git rev-list --count <baseRef>..HEAD` (== ahead): 0 ⇒ merged. Accepts a
   * worktree path; on any git error returns false (conservative — never report
   * "merged" when we can't prove it). (WORKTREE-SPEC §4 stale 감지.)
   */
  async isMergedIntoBase(
    worktreePath: string,
    baseRef: string,
  ): Promise<boolean> {
    const res = await this.runGit(
      ["rev-list", "--count", `${baseRef}..HEAD`],
      worktreePath,
    );
    if (res.code !== 0) return false;
    const ahead = parseInt(res.stdout.trim(), 10);
    return Number.isFinite(ahead) && ahead === 0;
  }

  /** Last commit time of the worktree's HEAD (`git log -1 --format=%cI`), or null. */
  async lastActivityAt(worktreePath: string): Promise<Date | null> {
    const res = await this.runGit(["log", "-1", "--format=%cI"], worktreePath);
    if (res.code !== 0 || !res.stdout.trim()) return null;
    const when = new Date(res.stdout.trim());
    return Number.isNaN(when.getTime()) ? null : when;
  }

  /**
   * Stale-hygiene verdict for a worktree (WORKTREE-SPEC §4): merged into base,
   * how many whole days idle, the combined `stale` flag
   * (`merged || idleDays >= maxIdleDays`, default maxIdleDays=5), and whether
   * the branch holds unpushed local commits.
   */
  async staleInfo(
    worktreePath: string,
    baseRef: string,
    opts?: StaleOptions,
  ): Promise<StaleInfo> {
    const maxIdleDays = opts?.maxIdleDays ?? DEFAULT_MAX_IDLE_DAYS;
    const merged = await this.isMergedIntoBase(worktreePath, baseRef);
    const last = await this.lastActivityAt(worktreePath);
    const now = opts?.now ?? new Date();
    let idleDays = 0;
    if (last) {
      idleDays = Math.floor(
        (now.getTime() - last.getTime()) / STALE_MS_PER_DAY,
      );
      if (idleDays < 0) idleDays = 0;
    }
    const stale = merged || idleDays >= maxIdleDays;
    return {
      merged,
      idleDays,
      stale,
      unpushed: await this.isUnpushed(worktreePath, merged),
    };
  }

  /**
   * {@link computeUnpushed} for a single worktree. The batched path reads the
   * upstream fields straight out of `for-each-ref`; here there is no batch to
   * ride on, so ask git for this branch's tracking state directly.
   *
   * On any git error this returns `true` — "cannot prove the work is on a
   * remote" must read as unsafe, matching how `isMergedIntoBase` refuses to
   * claim "merged" it cannot prove. A fabricated `false` would hand the
   * archive filter a safety guarantee nobody checked.
   */
  private async isUnpushed(
    worktreePath: string,
    merged: boolean,
  ): Promise<boolean> {
    if (merged) return false;
    const upstream = await this.runGit(
      ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{upstream}"],
      worktreePath,
    );
    // Non-zero here is the ordinary "no upstream configured" answer, not a
    // malfunction — either way the branch was never pushed.
    if (upstream.code !== 0 || !upstream.stdout.trim()) return true;
    const ahead = await this.runGit(
      ["rev-list", "--count", "@{upstream}..HEAD"],
      worktreePath,
    );
    if (ahead.code !== 0) return true;
    const n = parseInt(ahead.stdout.trim(), 10);
    return !Number.isFinite(n) || n > 0;
  }

  /**
   * The same {@link staleInfo} verdict for EVERY branch in the repo, computed
   * in two repo-level git spawns instead of the two-per-worktree probes
   * `staleInfo()` runs — keyed by the branch tip's commit sha, which is exactly
   * the `head` {@link list} reports for a worktree with that branch checked out.
   *
   * ── Why ──────────────────────────────────────────────────────────────────
   * `staleInfo()` per worktree is what makes the full sweep unaffordable: at
   * ~680 registered worktrees it is ~1360 git spawns, part of the measured
   * 12–26s subprocess storm (tickets yJgz7s03 / HruNFJpj). The light list was
   * introduced to escape that cost — but light carries no verdict, so the
   * renderer's archived-worktree filter (#475) lost its evidence entirely and
   * every worktree stayed visible (ticket NaviULZe). Batching restores the
   * evidence without restoring the cost: `for-each-ref` answers for all
   * branches at once, measured 0.035s at 145 worktrees / 510 branches.
   *
   * ── Fail-closed ──────────────────────────────────────────────────────────
   * On any git failure this returns an EMPTY map, never a map of "not merged /
   * not stale" verdicts. An absent verdict is "unknown" to callers; a
   * fabricated negative one would silently un-archive the whole repo — which is
   * precisely the failure this method exists to fix.
   *
   * A detached-HEAD worktree has no branch ref, so its sha is simply absent —
   * unknown, by the same rule.
   */
  async staleInfoByHead(
    repoRoot: string,
    baseRef: string,
    opts?: StaleOptions,
  ): Promise<Map<string, StaleInfo>> {
    const maxIdleDays = opts?.maxIdleDays ?? DEFAULT_MAX_IDLE_DAYS;
    const now = opts?.now ?? new Date();

    // One spawn, three facts per branch. `upstream:track` reports "[ahead N]" /
    // "[ahead N, behind M]" / "[gone]" / "" — and an empty *upstream* field means
    // no tracking branch is configured at all. Both feed `unpushed` below, so the
    // safety signal costs zero extra spawns: the field list grows, the process
    // count does not (the #511 budget this must not regress).
    //
    // TAB-delimited because a ref name can contain spaces and `[ahead 1, behind 2]`
    // certainly does; splitting on whitespace would corrupt every tracked branch.
    const tips = await this.runGit(
      [
        "for-each-ref",
        "--format=%(objectname)%09%(committerdate:unix)%09%(upstream)%09%(upstream:track)",
        "refs/heads",
      ],
      repoRoot,
    );
    if (tips.code !== 0) return new Map();

    const mergedRes = await this.runGit(
      [
        "for-each-ref",
        `--merged=${baseRef}`,
        "--format=%(objectname)",
        "refs/heads",
      ],
      repoRoot,
    );
    if (mergedRes.code !== 0) return new Map();
    const mergedShas = new Set(
      mergedRes.stdout
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

    const out = new Map<string, StaleInfo>();
    for (const line of tips.stdout.split("\n")) {
      const [sha, unix, upstream, track] = line.split("\t");
      if (!sha?.trim()) continue;
      const seconds = Number(unix);
      let idleDays = 0;
      if (Number.isFinite(seconds)) {
        idleDays = Math.floor(
          (now.getTime() - seconds * 1000) / STALE_MS_PER_DAY,
        );
        if (idleDays < 0) idleDays = 0;
      }
      const merged = mergedShas.has(sha.trim());
      out.set(sha.trim(), {
        merged,
        idleDays,
        stale: merged || idleDays >= maxIdleDays,
        unpushed: computeUnpushed(merged, upstream ?? "", track ?? ""),
      });
    }
    return out;
  }

  /**
   * Bulk-remove every stale worktree under `repoRoot` (WORKTREE-SPEC §4 일괄
   * cleanup). Reuses list() + staleInfo() to decide, then remove() with
   * deleteBranch:true. The main working tree (path === repoRoot) is always
   * skipped — it is "merged" by definition and cannot be `git worktree remove`d.
   * Never throws on a single failure: each failure is collected in `failed` so
   * one stuck worktree doesn't block the rest.
   *
   * ★ This DELETES — worktree and branch both. It therefore does NOT inherit the
   * archive threshold. Archiving hides and is one click to undo; deletion is
   * final, so the two must not share a default: lowering the archive threshold
   * 14 → 5 (ticket MT2ny8ng) would otherwise have quadrupled the reach of this
   * destructive sweep as a silent side effect of a UI-visibility change. Callers
   * that genuinely want a tighter deletion window must pass `maxIdleDays`
   * explicitly and say so.
   *
   * Unpushed branches are skipped outright: their commits exist on this disk and
   * nowhere else, so `deleteBranch: true` would destroy the only copy.
   */
  async cleanupStale(
    repoRoot: string,
    opts?: StaleOptions,
  ): Promise<CleanupStaleResult> {
    const baseRef = await this.resolveBaseRef(repoRoot);
    const worktrees = await this.list(repoRoot);
    const realRepoRoot = fs.existsSync(repoRoot)
      ? fs.realpathSync(repoRoot)
      : repoRoot;
    const deleteOpts: StaleOptions = {
      ...opts,
      maxIdleDays: opts?.maxIdleDays ?? LEGACY_MAX_IDLE_DAYS,
    };

    const removed: string[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const wt of worktrees) {
      if (wt.path === realRepoRoot) continue; // never touch the main worktree
      const info = await this.staleInfo(wt.path, baseRef, deleteOpts);
      if (!info.stale) continue;
      if (info.unpushed) continue; // local-only commits — deleting loses them
      try {
        await this.remove(repoRoot, wt.path, { deleteBranch: true });
        removed.push(wt.path);
      } catch (e) {
        failed.push({
          path: wt.path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { removed, failed };
  }

  /** True when the worktree has uncommitted changes. Conservative: a git
   *  error reads as "dirty" so a reap never proceeds on an unreadable tree. */
  private async hasUncommittedChanges(worktreePath: string): Promise<boolean> {
    const st = await this.runGit(["status", "--porcelain"], worktreePath);
    if (st.code !== 0) return true;
    return st.stdout.trim().length > 0;
  }

  /**
   * Work-loss safety check for reaping a worktree (the guard behind the
   * auto-reap-on-DONE/merge hook). Removal is only `safe` when it cannot lose
   * work:
   *  - clean working tree (no uncommitted changes), AND
   *  - every commit beyond base is either merged into base OR already pushed to
   *    `origin/<branch>` (a PR carries it).
   * Anything else (dirty tree, local-only commits, unreadable state) is a
   * blocker → preserve. Never throws.
   */
  async reapSafety(worktreePath: string, baseRef: string): Promise<ReapSafety> {
    const dirty = await this.hasUncommittedChanges(worktreePath);
    const merged = await this.isMergedIntoBase(worktreePath, baseRef);

    const blockers: string[] = [];
    if (dirty) blockers.push("uncommitted changes");

    let unpushedCommits = 0;
    if (!merged) {
      // Branch has commits beyond base. They are safe to drop only if every
      // one is on the remote; otherwise removing the worktree destroys them.
      const ahead = await this.runGit(
        ["rev-list", "--count", `${baseRef}..HEAD`],
        worktreePath,
      );
      const aheadN = ahead.code === 0 ? parseInt(ahead.stdout.trim(), 10) : NaN;
      if (!Number.isFinite(aheadN)) {
        // Can't read branch state → refuse to reap (conservative).
        unpushedCommits = -1;
        blockers.push("branch state undeterminable");
      } else {
        const br = await this.runGit(
          ["rev-parse", "--abbrev-ref", "HEAD"],
          worktreePath,
        );
        const branch = br.code === 0 ? br.stdout.trim() : "HEAD";
        if (!branch || branch === "HEAD") {
          // Detached HEAD → no upstream to vouch for the commits; all local-only.
          unpushedCommits = aheadN;
        } else {
          const remote = await this.runGit(
            ["rev-list", "--count", `origin/${branch}..HEAD`],
            worktreePath,
          );
          // origin/<branch> missing (no push) → exit non-zero → all aheadN are
          // local-only. Otherwise the count is commits not yet on the remote.
          unpushedCommits =
            remote.code === 0
              ? parseInt(remote.stdout.trim(), 10) || 0
              : aheadN;
        }
        if (unpushedCommits > 0) {
          blockers.push(`${unpushedCommits} unmerged, unpushed commit(s)`);
        }
      }
    }

    return {
      dirty,
      merged,
      unpushedCommits,
      safe: blockers.length === 0,
      blockers,
    };
  }

  /**
   * Auto-reap a single worktree once its task is terminal (DONE) or its branch
   * is merged — the fix for the 100+ orphaned-worktree pileup that locked the
   * shared branch (WORKTREE-SPEC §4 라이프사이클 정리).
   *
   * Safety-gated by reapSafety(): a dirty tree or local-only (unmerged AND
   * unpushed) commits are PRESERVED with a warning, never removed — work loss
   * is worse than a stray worktree. The main checkout is never touched. The
   * branch is deleted only when fully merged; a pushed-but-unmerged branch
   * keeps its local ref so the PR's commits stay reachable. Never throws.
   */
  async reap(
    repoRoot: string,
    worktreePath: string,
    opts?: ReapOptions,
  ): Promise<ReapResult> {
    const realRepoRoot = fs.existsSync(repoRoot)
      ? fs.realpathSync(repoRoot)
      : repoRoot;
    const realWt = fs.existsSync(worktreePath)
      ? fs.realpathSync(worktreePath)
      : worktreePath;
    if (realWt === realRepoRoot) {
      return {
        path: worktreePath,
        removed: false,
        reason: "refusing to reap the main worktree",
        safety: {
          dirty: false,
          merged: true,
          unpushedCommits: 0,
          safe: false,
          blockers: ["main worktree"],
        },
      };
    }

    const baseRef = opts?.baseRef ?? (await this.resolveBaseRef(repoRoot));
    const safety = await this.reapSafety(worktreePath, baseRef);

    if (opts?.requireMerged && !safety.merged) {
      return {
        path: worktreePath,
        removed: false,
        reason: "branch not merged into base",
        safety,
      };
    }

    if (!safety.safe) {
      console.warn(
        `[WorktreeManager] preserving worktree ${worktreePath} — ${safety.blockers.join(
          "; ",
        )} (work-loss guard)`,
      );
      return {
        path: worktreePath,
        removed: false,
        reason: `preserved: ${safety.blockers.join("; ")}`,
        safety,
      };
    }

    // Capture the branch name before teardown for the audit trail.
    let branch: string | undefined;
    const b = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      worktreePath,
    );
    if (b.code === 0 && b.stdout.trim()) branch = b.stdout.trim();

    await this.remove(repoRoot, worktreePath, { deleteBranch: safety.merged });
    return {
      path: worktreePath,
      removed: true,
      branch,
      reason: safety.merged
        ? "merged into base"
        : "clean and fully pushed (no work to lose)",
      safety,
    };
  }

  /**
   * Bulk reap every worktree under `repoRoot` whose work is safely captured
   * elsewhere — the one-shot cleanup path for an accrued backlog of orphaned
   * worktrees. Runs `git worktree prune` first to drop admin entries for
   * already-deleted dirs, then reap()s each linked worktree under the same
   * work-loss guard (dirty/unmerged-unpushed are preserved, not removed).
   * The main checkout is always skipped. Never throws on a single failure.
   */
  async reapAll(repoRoot: string, opts?: ReapOptions): Promise<ReapAllResult> {
    await this.prune(repoRoot);
    const baseRef = opts?.baseRef ?? (await this.resolveBaseRef(repoRoot));
    const worktrees = await this.list(repoRoot);
    const realRepoRoot = fs.existsSync(repoRoot)
      ? fs.realpathSync(repoRoot)
      : repoRoot;

    const removed: string[] = [];
    const preserved: { path: string; reason: string }[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const wt of worktrees) {
      if (wt.path === realRepoRoot) continue; // never touch the main worktree
      try {
        const res = await this.reap(repoRoot, wt.path, {
          baseRef,
          requireMerged: opts?.requireMerged,
        });
        if (res.removed) removed.push(wt.path);
        else preserved.push({ path: wt.path, reason: res.reason });
      } catch (e) {
        failed.push({
          path: wt.path,
          error: e instanceof Error ? e.message : String(e),
        });
      }
    }
    return { removed, preserved, failed };
  }
}
