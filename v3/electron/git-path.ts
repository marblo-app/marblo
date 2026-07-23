import * as path from "node:path";

/**
 * PATH the `git` spawns run with. When the app is launched from Finder/Dock
 * (not a terminal) the GUI process inherits a minimal PATH — often just
 * `/usr/bin:/bin:/usr/sbin:/sbin` — which can miss the actual `git` (e.g.
 * Homebrew's `/opt/homebrew/bin/git`), so `spawn("git")` throws ENOENT. This
 * broke the "완료 이력" view (`worktree:showCommit`) and any other bare git
 * spawn in the main process. Enrich PATH with the same common locations
 * harness-manager uses so every git spawn resolves the binary.
 *
 * Use as: `spawn("git", args, { cwd, env: gitSpawnEnv() })`.
 */
export function gitSpawnPath(): string {
  const base = process.env.PATH || "";
  const extras =
    process.platform === "win32"
      ? []
      : [
          "/opt/homebrew/bin",
          "/opt/homebrew/sbin",
          "/usr/local/bin",
          "/usr/bin",
          "/bin",
          "/usr/sbin",
          "/sbin",
        ];
  return [...new Set([...base.split(path.delimiter), ...extras])]
    .filter(Boolean)
    .join(path.delimiter);
}

/** Convenience: process env with a git-resolvable PATH for spawn options. */
export function gitSpawnEnv(): NodeJS.ProcessEnv {
  return { ...process.env, PATH: gitSpawnPath() };
}
