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

export class WorktreeManager {
  private worktreesRoot: string;

  constructor(opts?: { worktreesRoot?: string }) {
    this.worktreesRoot =
      opts?.worktreesRoot ?? path.join(os.homedir(), ".marblo", "worktrees");
  }

  /** Single choke-point for git. Never rejects — always resolves a GitResult. */
  private runGit(args: string[], cwd: string): Promise<GitResult> {
    return new Promise((resolve) => {
      let stdout = "";
      let stderr = "";
      try {
        const proc = spawn("git", args, { cwd });
        proc.stdout.on("data", (d) => (stdout += d.toString()));
        proc.stderr.on("data", (d) => (stderr += d.toString()));
        proc.on("close", (code) =>
          resolve({ code: code ?? 1, stdout, stderr })
        );
        proc.on("error", (e) =>
          resolve({ code: 1, stdout, stderr: String(e) })
        );
      } catch (e) {
        resolve({ code: 1, stdout, stderr: String(e) });
      }
    });
  }

  /** Prefer origin's default branch; fall back to the local current branch. */
  async resolveBaseRef(repoRoot: string): Promise<string> {
    const sym = await this.runGit(
      ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"],
      repoRoot
    );
    if (sym.code === 0 && sym.stdout.trim()) return sym.stdout.trim();
    const cur = await this.runGit(
      ["rev-parse", "--abbrev-ref", "HEAD"],
      repoRoot
    );
    if (cur.code === 0 && cur.stdout.trim()) return cur.stdout.trim();
    return "HEAD";
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
    const baseRef =
      params.baseRef ?? (await this.resolveBaseRef(params.repoRoot));
    const branch = this.branchName(params.slug, params.taskId);
    const wtPath = path.join(
      this.worktreesRoot,
      params.projectId,
      params.taskId
    );
    fs.mkdirSync(path.dirname(wtPath), { recursive: true });

    const res = await this.runGit(
      ["worktree", "add", "-b", branch, wtPath, baseRef],
      params.repoRoot
    );
    if (res.code !== 0) {
      throw new Error(`git worktree add failed: ${res.stderr.trim()}`);
    }

    const headRes = await this.runGit(["rev-parse", "HEAD"], wtPath);
    // Normalize the path to resolve OS-level symlinks (e.g. /var → /private/var on macOS)
    // so that create() and list() return consistent paths for equality checks.
    const realWtPath = fs.realpathSync(wtPath);
    return { path: realWtPath, branch, head: headRes.stdout.trim() };
  }

  async list(repoRoot: string): Promise<WorktreeInfo[]> {
    const res = await this.runGit(
      ["worktree", "list", "--porcelain"],
      repoRoot
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
      worktreePath
    );
    const branch = branchRes.stdout.trim();

    // behind = left (baseRef-only), ahead = right (HEAD-only)
    const ab = await this.runGit(
      ["rev-list", "--left-right", "--count", `${baseRef}...HEAD`],
      worktreePath
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
      worktreePath
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

    // mergeable / conflicts — requires git >= 2.38 (--write-tree)
    const mt = await this.runGit(
      ["merge-tree", "--write-tree", "--name-only", baseRef, "HEAD"],
      worktreePath
    );
    const hasConflicts = mt.code === 1;
    let conflicts: string[] = [];
    if (hasConflicts) {
      // First stdout line is the conflicted tree OID; the rest are file names.
      const lines = mt.stdout
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean);
      conflicts = lines.slice(1);
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
    opts?: { deleteBranch?: boolean }
  ): Promise<void> {
    let branch = "";
    if (opts?.deleteBranch) {
      const b = await this.runGit(
        ["rev-parse", "--abbrev-ref", "HEAD"],
        worktreePath
      );
      if (b.code === 0) branch = b.stdout.trim();
    }

    const res = await this.runGit(
      ["worktree", "remove", "--force", worktreePath],
      repoRoot
    );
    if (res.code !== 0) {
      throw new Error(`git worktree remove failed: ${res.stderr.trim()}`);
    }

    if (opts?.deleteBranch && branch) {
      await this.runGit(["branch", "-D", branch], repoRoot);
    }
  }

  async prune(repoRoot: string): Promise<void> {
    await this.runGit(["worktree", "prune"], repoRoot);
  }
}
