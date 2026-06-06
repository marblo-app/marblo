import { spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

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
  /** Unmerged paths captured before the safe `--abort` (only when ok=false). */
  conflicts?: string[];
}

/** Result of the clean squash-merge path (WORKTREE-SPEC §6 머지 실행 주체). */
export interface SquashMergeResult {
  ok: boolean;
  /** True when the rebase step hit a conflict → caller routes to Resolve(agent). */
  needsResolve?: boolean;
  conflicts?: string[];
  /** Populated when a deterministic git step failed for a non-conflict reason. */
  error?: string;
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
}

/** Options for stale detection. `now` is injectable for deterministic tests. */
export interface StaleOptions {
  /** Idle days that mark a worktree stale even when unmerged. Default 14. */
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

const STALE_MS_PER_DAY = 24 * 60 * 60 * 1000;
const DEFAULT_MAX_IDLE_DAYS = 14;

/**
 * Timeout for the pre-create `git fetch origin` (WORKTREE-SPEC §3 최신 base).
 * A short cap so an offline/auth-wedged fetch can't hang worktree creation —
 * on timeout we fall back to the last-known local origin ref.
 */
const DEFAULT_FETCH_TIMEOUT_MS = 15_000;

/**
 * Relative node_modules locations to provision into a fresh worktree, in the
 * order they are linked. Monorepo-aware: node_modules can live at the repo root
 * and/or under the `v3/` package, so we link whichever sources actually exist.
 */
const NODE_MODULES_CANDIDATES = [
  "node_modules",
  path.join("v3", "node_modules"),
];

/**
 * Symlink the main repo's node_modules into a freshly created worktree so the
 * isolated agent can run npm typecheck/test/build without a fresh install.
 * node_modules is `.gitignore`d, so it never exists in a fresh checkout.
 *
 * For each candidate (repo root + the v3 monorepo package), if the source
 * exists under `repoRoot` it is linked to the matching path under
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

export class WorktreeManager {
  private worktreesRoot: string;

  constructor(opts?: { worktreesRoot?: string }) {
    this.worktreesRoot =
      opts?.worktreesRoot ?? path.join(os.homedir(), ".marblo", "worktrees");
  }

  /**
   * Single choke-point for git. Never rejects — always resolves a GitResult.
   * With `opts.timeoutMs`, a hung process is SIGKILLed and resolved as a
   * non-zero failure (stderr notes the timeout) so callers never hang.
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
        resolve(r);
      };
      try {
        const proc = spawn("git", args, { cwd });
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

  /** marblo/<sanitized-slug>-<first 8 of taskId> */
  private branchName(slug: string, taskId: string): string {
    const cleanSlug =
      slug
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-+|-+$/g, "")
        .slice(0, 32) || "task";
    return `marblo/${cleanSlug}-${taskId.slice(0, 8)}`;
  }

  async create(params: CreateWorktreeParams): Promise<WorktreeInfo> {
    const idPattern = /^[A-Za-z0-9_-]+$/;
    if (!idPattern.test(params.projectId)) {
      throw new Error(`invalid projectId: ${params.projectId}`);
    }
    if (!idPattern.test(params.taskId)) {
      throw new Error(`invalid taskId: ${params.taskId}`);
    }
    // Refresh origin BEFORE resolving the base so the worktree forks off the
    // latest upstream main — UNLESS the caller pinned an explicit baseRef, in
    // which case we respect their intent and skip the fetch. fetchOrigin()
    // never throws; a fetch failure only warns and falls back to the local ref.
    if (params.baseRef === undefined) {
      await this.fetchOrigin(params.repoRoot);
    }
    const baseRef =
      params.baseRef ?? (await this.resolveBaseRef(params.repoRoot));
    const branch = this.branchName(params.slug, params.taskId);
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
   * Rebase the worktree's branch onto `baseRef` (WORKTREE-SPEC §4 머지단계).
   * Runs `git rebase <baseRef>` inside the worktree. On success → {ok:true}.
   * On conflict, capture the unmerged paths, then `git rebase --abort` to
   * restore the working tree (safe stop — never leaves a half-rebased tree),
   * returning {ok:false, conflicts:[...]}.
   */
  async rebaseOntoBase(
    worktreePath: string,
    baseRef: string,
  ): Promise<RebaseResult> {
    const res = await this.runGit(["rebase", baseRef], worktreePath);
    if (res.code === 0) return { ok: true };

    // Conflict (or other failure): list unmerged paths while the rebase is
    // still in progress, then abort to leave the working tree exactly as it
    // was before the rebase started.
    const unmerged = await this.runGit(
      ["diff", "--name-only", "--diff-filter=U"],
      worktreePath,
    );
    const conflicts = unmerged.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean);
    await this.runGit(["rebase", "--abort"], worktreePath);
    return { ok: false, conflicts };
  }

  /**
   * Clean merge path (WORKTREE-SPEC §6): rebase the worktree branch onto base,
   * squash it onto the checked-out base branch in repoRoot, then remove the
   * worktree + branch. Deterministic; safe-stops on conflict without breaking
   * either working tree.
   *
   *   (a) rebaseOntoBase — conflict → {ok:false, needsResolve:true} and STOP.
   *   (b) `git merge --squash <branch>` + commit on base.
   *   (c) remove(repoRoot, worktreePath, {deleteBranch:true}).
   */
  async squashMergeToBase(
    repoRoot: string,
    worktreePath: string,
    baseRef: string,
    branch: string,
  ): Promise<SquashMergeResult> {
    // (a) Rebase first — bail to the Resolve(agent) path on conflict.
    const rebase = await this.rebaseOntoBase(worktreePath, baseRef);
    if (!rebase.ok) {
      return { ok: false, needsResolve: true, conflicts: rebase.conflicts };
    }

    // (b) Squash the rebased branch onto the base branch checked out in
    // repoRoot. --squash stages the changes without advancing <branch> or
    // creating a merge commit; the explicit commit lands a single squashed
    // commit on base.
    const squash = await this.runGit(["merge", "--squash", branch], repoRoot);
    if (squash.code !== 0) {
      // Defensive: a clean rebase shouldn't conflict here, but never leave a
      // half-staged base — back it out so repoRoot stays pristine.
      await this.runGit(["merge", "--abort"], repoRoot);
      await this.runGit(["reset", "--hard"], repoRoot);
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
      await this.runGit(["reset", "--hard"], repoRoot);
      return {
        ok: false,
        error: `squash commit failed: ${commit.stderr.trim()}`,
      };
    }

    // (c) Tear down the now-merged worktree and its branch.
    await this.remove(repoRoot, worktreePath, { deleteBranch: true });
    return { ok: true };
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
   * how many whole days idle, and the combined `stale` flag
   * (`merged || idleDays >= maxIdleDays`, default maxIdleDays=14).
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
    return { merged, idleDays, stale };
  }

  /**
   * Bulk-remove every stale worktree under `repoRoot` (WORKTREE-SPEC §4 일괄
   * cleanup). Reuses list() + staleInfo() to decide, then remove() with
   * deleteBranch:true. The main working tree (path === repoRoot) is always
   * skipped — it is "merged" by definition and cannot be `git worktree remove`d.
   * Never throws on a single failure: each failure is collected in `failed` so
   * one stuck worktree doesn't block the rest.
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

    const removed: string[] = [];
    const failed: { path: string; error: string }[] = [];
    for (const wt of worktrees) {
      if (wt.path === realRepoRoot) continue; // never touch the main worktree
      const info = await this.staleInfo(wt.path, baseRef, opts);
      if (!info.stale) continue;
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
}
