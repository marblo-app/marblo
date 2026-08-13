import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";
import { gitSpawnEnv } from "./git-path";
import { annotateGitFailure } from "./xcode-clt";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  gitStatus?: string;
  /**
   * 숨김/gitignore 규칙 때문에 드러난 디렉터리라서 **내용을 걷지 않았다**는 표시.
   * `children: []` 이 "빈 폴더"라는 거짓말로 읽히지 않게 하려는 플래그.
   * 왜 안 걷나 — {@link ReadTreeOptions.showHidden} 참조.
   */
  truncated?: boolean;
}

export interface ReadTreeOptions {
  /**
   * 숨김 항목(`.` 으로 시작하는 이름)과 루트의 .gitignore 항목까지 나열한다.
   * 기본 false — 켜지 않으면 기존과 **완전히 동일한** 트리다.
   *
   * 왜 필요한가(티켓 D8yiihCWgDMd3AU7xkEy): 파이썬 사용자가 `.venv` 를 만들면
   * 디스크에는 만들어지는데 트리엔 절대 안 나타나 "폴더 생성이 안 된다"로
   * 보였다. `venv` 도 .gitignore 에 있으면 같은 결과였다.
   *
   * ★단, 이 옵션으로 **드러난** 디렉터리는 나열만 하고 재귀하지 않는다
   * (truncated=true). venv/site-packages 는 파일 수만 명 단위이고 FileTree 는
   * 이 트리를 5초마다 다시 읽으므로, 재귀하면 메인 프로세스가 폴링마다 수만
   * 개를 동기 순회한다. "폴더가 보인다"는 목적은 나열만으로 달성된다.
   */
  showHidden?: boolean;
}

/** 한 엔트리의 표시 판정. */
type Visibility =
  /** 항상 감춤 — 성능·소음 목적(node_modules/.git/dist…). showHidden 도 못 켠다. */
  | "blocked"
  /** 기본은 감춤, showHidden 이면 나열(단 디렉터리는 재귀 안 함). */
  | "hidden"
  | "visible";

// Directories/files to always ignore
const DEFAULT_IGNORES = new Set([
  "node_modules",
  ".git",
  ".DS_Store",
  "__pycache__",
  ".next",
  "dist",
  "dist-electron",
  "dist-mcp",
  "dist-flow-engine",
  "dist-orchestrator",
  ".cache",
  ".vite",
  ".vscode",
  ".idea",
  "coverage",
  ".nyc_output",
  ".parcel-cache",
  "build",
]);

export class FsManager {
  /**
   * Token-keyed watchers. Each window gets its own token (typically derived
   * from the renderer's webContents id) so multiple windows can each watch
   * their own rootPath without one window's `watch` killing another's.
   */
  private watchers: Map<string, fs.FSWatcher> = new Map();

  /**
   * Read gitignore patterns from a directory
   */
  private readGitignore(rootPath: string): Set<string> {
    const ignores = new Set(DEFAULT_IGNORES);
    const gitignorePath = path.join(rootPath, ".gitignore");
    try {
      const content = fs.readFileSync(gitignorePath, "utf-8");
      for (const line of content.split("\n")) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith("#")) {
          // Simple pattern: strip leading/trailing slashes for directory matching
          ignores.add(trimmed.replace(/^\/|\/$/g, ""));
        }
      }
    } catch {
      // No .gitignore, use defaults
    }
    return ignores;
  }

  /**
   * Classify one entry: always-hidden (perf/noise), hideable, or plain visible.
   *
   * `gitignored` carries only the .gitignore-derived names (root depth); the
   * always-blocked DEFAULT_IGNORES are checked separately so `showHidden` can
   * reveal the former without ever unleashing node_modules on the tree walk.
   */
  private classify(name: string, gitignored: Set<string>): Visibility {
    // Env config files (.env, .env.local, .env.production, .env.example, …)
    // are always shown, even though they're dotfiles and usually gitignored —
    // users need to see and edit them in the tree. This wins over BOTH the
    // blanket dotfile hide below AND the gitignore-derived set.
    if (name === ".env" || name.startsWith(".env.")) return "visible";
    if (DEFAULT_IGNORES.has(name)) return "blocked";
    if (name.startsWith(".")) return "hidden";
    return gitignored.has(name) ? "hidden" : "visible";
  }

  /**
   * Recursively read directory tree.
   *
   * @param options {@link ReadTreeOptions} — `showHidden` reveals dotfiles and
   * root .gitignore entries. Omitted/false reproduces the previous tree exactly.
   */
  readTree(rootPath: string, options: ReadTreeOptions = {}): FileNode[] {
    return this.readTreeAt(rootPath, options.showHidden === true, 0, 10);
  }

  private readTreeAt(
    rootPath: string,
    showHidden: boolean,
    depth: number,
    maxDepth: number,
  ): FileNode[] {
    if (depth > maxDepth) return [];

    // .gitignore only applies at the root, as before — reading one per level
    // would be a different (and much more expensive) feature.
    const gitignored =
      depth === 0 ? this.readGitignore(rootPath) : new Set<string>();

    try {
      const entries = fs.readdirSync(rootPath, { withFileTypes: true });
      const nodes: FileNode[] = [];

      // Sort: directories first, then files, alphabetically
      const sorted = entries.sort((a, b) => {
        if (a.isDirectory() && !b.isDirectory()) return -1;
        if (!a.isDirectory() && b.isDirectory()) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const entry of sorted) {
        const visibility = this.classify(entry.name, gitignored);
        if (visibility === "blocked") continue;
        if (visibility === "hidden" && !showHidden) continue;

        const fullPath = path.join(rootPath, entry.name);

        if (entry.isDirectory()) {
          // A directory revealed ONLY by showHidden is listed but not walked —
          // see ReadTreeOptions.showHidden for why (a .venv can hold 10⁵ files
          // and this tree is re-read every 5s by the FileTree poll).
          const truncated = visibility === "hidden";
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: "directory",
            children: truncated
              ? []
              : this.readTreeAt(fullPath, showHidden, depth + 1, maxDepth),
            ...(truncated ? { truncated: true } : {}),
          });
        } else {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: "file",
          });
        }
      }

      return nodes;
    } catch {
      return [];
    }
  }

  /**
   * Read file content
   */
  readFile(filePath: string): string {
    return fs.readFileSync(filePath, "utf-8");
  }

  /**
   * Write file content
   */
  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, "utf-8");
  }

  /**
   * Get git status for all files in a repository
   */
  async getGitStatus(rootPath: string): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      const result: Record<string, string> = {};
      try {
        const proc = spawn("git", ["status", "--porcelain", "-uall"], {
          cwd: rootPath,
          env: gitSpawnEnv(),
        });
        let output = "";

        proc.stdout.on("data", (data) => {
          output += data.toString();
        });

        proc.on("close", () => {
          for (const line of output.split("\n")) {
            if (!line.trim()) continue;
            const status = line.substring(0, 2).trim();
            const filePath = line.substring(3).trim();
            const fullPath = path.join(rootPath, filePath);
            result[fullPath] = status;
          }
          resolve(result);
        });

        proc.on("error", () => resolve(result));
      } catch {
        resolve(result);
      }
    });
  }

  /**
   * Run a git command, rejecting on non-zero exit.
   *
   * Deliberately NOT the resolve-empty-on-error shape `getGitStatus` uses: the
   * worktree-diff collection path must be able to tell "this worktree has no
   * changes" apart from "we failed to find out". Swallowing the failure into an
   * empty list is what made a broken collection render as an honest-looking
   * "변경 없음" (ticket F2WGGGVthmg7lN490PDy).
   */
  private git(args: string[], cwd: string): Promise<string> {
    return new Promise((resolve, reject) => {
      let proc;
      try {
        proc = spawn("git", args, { cwd, env: gitSpawnEnv() });
      } catch (err) {
        reject(err);
        return;
      }
      let out = "";
      let errOut = "";
      proc.stdout.on("data", (d) => {
        out += d.toString();
      });
      proc.stderr.on("data", (d) => {
        errOut += d.toString();
      });
      proc.on("error", reject);
      proc.on("close", (code) => {
        if (code === 0) resolve(out);
        else
          reject(
            new Error(
              `git ${args[0]} exited ${code}${
                errOut.trim()
                  ? // macOS Xcode CLT 문제면 raw xcrun 출력 대신 실행할 명령을
                    // 담은 안내로 바뀐다 (티켓 nETj7szjEtT5prbYsg1D).
                    `: ${annotateGitFailure(errOut.trim())}`
                  : ""
              }`,
            ),
          );
      });
    });
  }

  /**
   * Everything a worktree changed relative to its base branch — the file set
   * behind "이 워크트리 보기".
   *
   * ── Why merge-base and not HEAD ──────────────────────────────────────────────
   * `git status` only sees the working tree, so a worktree whose agent already
   * committed reports zero changed files. Measured on the live checkout: 36 of
   * 50 worktrees were in exactly that state, which is why the diff auto-open
   * (PR#493) opened nothing for most worktrees. Diffing against
   * `merge-base(baseRef, HEAD)` instead gives one baseline that covers committed
   * AND uncommitted work in a single set, and it is stable while base moves on.
   *
   * Untracked files are unioned in separately — `git diff` never reports them,
   * but a brand-new file an agent wrote is a change the user expects to see.
   *
   * On-demand only: this runs for ONE worktree when the user clicks it, never as
   * part of enumeration. It does not reintroduce the per-worktree status sweep
   * that PR#495/#498 removed for performance.
   */
  async getWorktreeChanges(
    rootPath: string,
    baseRef: string,
  ): Promise<{
    baseSha: string;
    files: Array<{ relPath: string; status: string }>;
  }> {
    // merge-base pins the fork point, so later commits on base don't show up as
    // this worktree's changes. Fall back to the ref itself for a detached or
    // otherwise unrelated history rather than failing the whole collection.
    let baseSha: string;
    try {
      baseSha = (
        await this.git(["merge-base", baseRef, "HEAD"], rootPath)
      ).trim();
    } catch {
      baseSha = (await this.git(["rev-parse", baseRef], rootPath)).trim();
    }

    const nameStatus = await this.git(
      ["diff", "--name-status", "--no-renames", baseSha],
      rootPath,
    );
    const untracked = await this.git(
      ["ls-files", "--others", "--exclude-standard"],
      rootPath,
    );

    const files = new Map<string, string>();
    for (const line of nameStatus.split("\n")) {
      if (!line.trim()) continue;
      // "<status>\t<path>" — --no-renames keeps this to a single path column.
      const tab = line.indexOf("\t");
      if (tab === -1) continue;
      const status = line.slice(0, tab).trim();
      const relPath = line.slice(tab + 1).trim();
      if (relPath) files.set(relPath, status);
    }
    for (const line of untracked.split("\n")) {
      const relPath = line.trim();
      // A tracked-and-modified path wins over the untracked listing.
      if (relPath && !files.has(relPath)) files.set(relPath, "??");
    }

    return {
      baseSha,
      files: [...files].map(([relPath, status]) => ({ relPath, status })),
    };
  }

  /**
   * Get git diff for a specific file.
   *
   * `baseSha` selects the baseline the file is compared against. Omitted it
   * stays HEAD (the working-tree-edit case every existing caller wants); the
   * worktree diff passes the merge-base from {@link getWorktreeChanges} so
   * already-committed work still renders as a diff instead of an empty one.
   */
  async getGitDiff(
    filePath: string,
    baseSha?: string,
  ): Promise<{ original: string; modified: string }> {
    const dir = path.dirname(filePath);
    return new Promise((resolve) => {
      try {
        // Get the original version from git
        const proc = spawn(
          "git",
          [
            "show",
            `${baseSha ?? "HEAD"}:${path.relative(
              this.findGitRoot(dir),
              filePath,
            )}`,
          ],
          { cwd: dir },
        );
        let original = "";

        proc.stdout.on("data", (data) => {
          original += data.toString();
        });

        proc.on("close", () => {
          const modified = fs.readFileSync(filePath, "utf-8");
          resolve({ original, modified });
        });

        proc.on("error", () => {
          const modified = fs.readFileSync(filePath, "utf-8");
          resolve({ original: "", modified });
        });
      } catch {
        resolve({ original: "", modified: "" });
      }
    });
  }

  async getGitRemoteUrl(rootPath: string): Promise<string | null> {
    return new Promise((resolve) => {
      try {
        const proc = spawn("git", ["remote", "get-url", "origin"], {
          cwd: rootPath,
          env: gitSpawnEnv(),
        });
        let output = "";
        proc.stdout.on("data", (data) => {
          output += data.toString();
        });
        proc.on("close", (code) => {
          if (code !== 0) {
            resolve(null);
            return;
          }
          const trimmed = output.trim();
          resolve(trimmed.length > 0 ? trimmed : null);
        });
        proc.on("error", () => resolve(null));
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Find the git root directory
   */
  private findGitRoot(startPath: string): string {
    let current = startPath;
    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, ".git"))) {
        return current;
      }
      current = path.dirname(current);
    }
    return startPath;
  }

  /**
   * Create an empty file. Throws if it already exists.
   */
  createFile(filePath: string): void {
    if (fs.existsSync(filePath)) {
      throw new Error("이미 존재합니다");
    }
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, "", "utf-8");
  }

  /**
   * Create a directory recursively. No-op if already exists.
   */
  createDirectory(dirPath: string): void {
    if (fs.existsSync(dirPath)) {
      const stat = fs.statSync(dirPath);
      if (stat.isDirectory()) return;
      throw new Error("동일한 이름의 파일이 이미 존재합니다");
    }
    fs.mkdirSync(dirPath, { recursive: true });
  }

  /**
   * Rename or move a file/directory. Throws if destination exists.
   */
  rename(fromPath: string, toPath: string): void {
    if (fromPath === toPath) return;
    if (fs.existsSync(toPath)) {
      throw new Error("이미 존재합니다");
    }
    fs.mkdirSync(path.dirname(toPath), { recursive: true });
    fs.renameSync(fromPath, toPath);
  }

  /**
   * Permanently delete a file or directory (recursive).
   */
  remove(targetPath: string): void {
    if (!fs.existsSync(targetPath)) return;
    fs.rmSync(targetPath, { recursive: true, force: true });
  }

  /**
   * Copy a file or directory recursively. If destination exists, append " copy"
   * (or " copy 2", "copy 3"...) to the basename until a unique path is found.
   * Returns the actual destination path used.
   */
  copy(fromPath: string, toPath: string): string {
    const finalPath = this.findUniqueCopyPath(toPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    fs.cpSync(fromPath, finalPath, { recursive: true });
    return finalPath;
  }

  /**
   * Generate a unique path by appending " copy" / " copy 2" etc. before the extension.
   */
  private findUniqueCopyPath(targetPath: string): string {
    if (!fs.existsSync(targetPath)) return targetPath;

    const dir = path.dirname(targetPath);
    const ext = path.extname(targetPath);
    const base = path.basename(targetPath, ext);

    for (let i = 1; i < 1000; i++) {
      const suffix = i === 1 ? " copy" : ` copy ${i}`;
      const candidate = path.join(dir, `${base}${suffix}${ext}`);
      if (!fs.existsSync(candidate)) return candidate;
    }
    throw new Error("고유한 복사 이름을 만들 수 없습니다");
  }

  /**
   * Validate that a target path is inside rootPath (prevents path traversal).
   */
  isInsideRoot(rootPath: string, targetPath: string): boolean {
    const resolvedRoot = path.resolve(rootPath);
    const resolvedTarget = path.resolve(targetPath);
    const rel = path.relative(resolvedRoot, resolvedTarget);
    return !rel.startsWith("..") && !path.isAbsolute(rel);
  }

  /**
   * Watch a directory for changes. The watcher is keyed by `token` so
   * multiple windows can each maintain their own watcher (one per token).
   * Calling again with the same token replaces that token's watcher,
   * leaving other windows' watchers untouched.
   */
  watchDirectory(
    token: string,
    rootPath: string,
    callback: (event: string, filePath: string) => void,
  ): void {
    const existing = this.watchers.get(token);
    if (existing) existing.close();
    this.watchers.delete(token);
    try {
      const watcher = fs.watch(
        rootPath,
        { recursive: true },
        (eventType, filename) => {
          if (filename) {
            const fullPath = path.join(rootPath, filename);
            // Skip ignored directories
            const parts = filename.split(path.sep);
            if (parts.some((p) => DEFAULT_IGNORES.has(p))) return;
            callback(eventType, fullPath);
          }
        },
      );
      this.watchers.set(token, watcher);
    } catch {
      // Directory might not exist
    }
  }

  /**
   * Stop a specific window's watcher (e.g., on window close).
   */
  stopWatching(token: string): void {
    const w = this.watchers.get(token);
    if (w) {
      w.close();
      this.watchers.delete(token);
    }
  }

  /**
   * Stop every watcher (e.g., on app quit).
   */
  stopAllWatching(): void {
    for (const w of this.watchers.values()) w.close();
    this.watchers.clear();
  }
}
