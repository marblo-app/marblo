import * as fs from "fs";
import * as path from "path";
import { spawn } from "child_process";

export interface FileNode {
  name: string;
  path: string;
  type: "file" | "directory";
  children?: FileNode[];
  gitStatus?: string;
}

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
   * Check if a name should be ignored
   */
  private shouldIgnore(name: string, ignores: Set<string>): boolean {
    if (name.startsWith(".") && name !== ".env.example") return true;
    return ignores.has(name);
  }

  /**
   * Recursively read directory tree
   */
  readTree(rootPath: string, depth = 0, maxDepth = 10): FileNode[] {
    if (depth > maxDepth) return [];

    const ignores =
      depth === 0 ? this.readGitignore(rootPath) : new Set(DEFAULT_IGNORES);

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
        if (this.shouldIgnore(entry.name, ignores)) continue;

        const fullPath = path.join(rootPath, entry.name);

        if (entry.isDirectory()) {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: "directory",
            children: this.readTree(fullPath, depth + 1, maxDepth),
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
   * Get git diff for a specific file
   */
  async getGitDiff(
    filePath: string,
  ): Promise<{ original: string; modified: string }> {
    const dir = path.dirname(filePath);
    return new Promise((resolve) => {
      try {
        // Get the original version from git
        const proc = spawn(
          "git",
          ["show", `HEAD:${path.relative(this.findGitRoot(dir), filePath)}`],
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
