import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';

export interface FileNode {
  name: string;
  path: string;
  type: 'file' | 'directory';
  children?: FileNode[];
  gitStatus?: string;
}

// Directories/files to always ignore
const DEFAULT_IGNORES = new Set([
  'node_modules', '.git', '.DS_Store', '__pycache__', '.next',
  'dist', 'dist-electron', 'dist-mcp', 'dist-flow-engine', 'dist-orchestrator',
  '.cache', '.vite', '.vscode', '.idea',
  'coverage', '.nyc_output', '.parcel-cache', 'build',
]);

export class FsManager {
  private watcher: ReturnType<typeof fs.watch> | null = null;
  private watchers: fs.FSWatcher[] = [];

  /**
   * Read gitignore patterns from a directory
   */
  private readGitignore(rootPath: string): Set<string> {
    const ignores = new Set(DEFAULT_IGNORES);
    const gitignorePath = path.join(rootPath, '.gitignore');
    try {
      const content = fs.readFileSync(gitignorePath, 'utf-8');
      for (const line of content.split('\n')) {
        const trimmed = line.trim();
        if (trimmed && !trimmed.startsWith('#')) {
          // Simple pattern: strip leading/trailing slashes for directory matching
          ignores.add(trimmed.replace(/^\/|\/$/g, ''));
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
    if (name.startsWith('.') && name !== '.env.example') return true;
    return ignores.has(name);
  }

  /**
   * Recursively read directory tree
   */
  readTree(rootPath: string, depth = 0, maxDepth = 10): FileNode[] {
    if (depth > maxDepth) return [];

    const ignores = depth === 0 ? this.readGitignore(rootPath) : new Set(DEFAULT_IGNORES);

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
            type: 'directory',
            children: this.readTree(fullPath, depth + 1, maxDepth),
          });
        } else {
          nodes.push({
            name: entry.name,
            path: fullPath,
            type: 'file',
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
    return fs.readFileSync(filePath, 'utf-8');
  }

  /**
   * Write file content
   */
  writeFile(filePath: string, content: string): void {
    fs.writeFileSync(filePath, content, 'utf-8');
  }

  /**
   * Get git status for all files in a repository
   */
  async getGitStatus(rootPath: string): Promise<Record<string, string>> {
    return new Promise((resolve) => {
      const result: Record<string, string> = {};
      try {
        const proc = spawn('git', ['status', '--porcelain', '-uall'], { cwd: rootPath });
        let output = '';

        proc.stdout.on('data', (data) => {
          output += data.toString();
        });

        proc.on('close', () => {
          for (const line of output.split('\n')) {
            if (!line.trim()) continue;
            const status = line.substring(0, 2).trim();
            const filePath = line.substring(3).trim();
            const fullPath = path.join(rootPath, filePath);
            result[fullPath] = status;
          }
          resolve(result);
        });

        proc.on('error', () => resolve(result));
      } catch {
        resolve(result);
      }
    });
  }

  /**
   * Get git diff for a specific file
   */
  async getGitDiff(filePath: string): Promise<{ original: string; modified: string }> {
    const dir = path.dirname(filePath);
    return new Promise((resolve) => {
      try {
        // Get the original version from git
        const proc = spawn('git', ['show', `HEAD:${path.relative(this.findGitRoot(dir), filePath)}`], { cwd: dir });
        let original = '';

        proc.stdout.on('data', (data) => {
          original += data.toString();
        });

        proc.on('close', () => {
          const modified = fs.readFileSync(filePath, 'utf-8');
          resolve({ original, modified });
        });

        proc.on('error', () => {
          const modified = fs.readFileSync(filePath, 'utf-8');
          resolve({ original: '', modified });
        });
      } catch {
        resolve({ original: '', modified: '' });
      }
    });
  }

  /**
   * Find the git root directory
   */
  private findGitRoot(startPath: string): string {
    let current = startPath;
    while (current !== path.dirname(current)) {
      if (fs.existsSync(path.join(current, '.git'))) {
        return current;
      }
      current = path.dirname(current);
    }
    return startPath;
  }

  /**
   * Watch a directory for changes
   */
  watchDirectory(rootPath: string, callback: (event: string, filePath: string) => void): void {
    this.stopWatching();
    try {
      const watcher = fs.watch(rootPath, { recursive: true }, (eventType, filename) => {
        if (filename) {
          const fullPath = path.join(rootPath, filename);
          // Skip ignored directories
          const parts = filename.split(path.sep);
          if (parts.some(p => DEFAULT_IGNORES.has(p))) return;
          callback(eventType, fullPath);
        }
      });
      this.watchers.push(watcher);
    } catch {
      // Directory might not exist
    }
  }

  /**
   * Stop watching
   */
  stopWatching(): void {
    for (const w of this.watchers) {
      w.close();
    }
    this.watchers = [];
  }
}
