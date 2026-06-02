import path from "path";
import os from "os";

/**
 * Encode a working-directory path the SAME way Claude Code names its
 * per-project session directory under ~/.claude/projects.
 *
 * Claude replaces EVERY non-alphanumeric character (`/`, `_`, `.`, space, …)
 * with `-`. For example:
 *   /Users/me/Documents/programming/hankang_prj/temu_to_coupang
 *   → -Users-me-Documents-programming-hankang-prj-temu-to-coupang
 *
 * The old encoding `rootPath.replace(/\//g, "-")` only swapped slashes, so any
 * project whose path contained `_`, `.`, or a space resolved to a directory
 * that does NOT exist. Every Claude session lookup (resume, labels, reconnect,
 * cost tracking) then silently found nothing and each launch started a fresh
 * session — while Gemini/Antigravity were unaffected because they don't key off
 * ~/.claude/projects. That mismatch is exactly this bug.
 */
export function encodeClaudeProjectDir(rootPath: string): string {
  return rootPath.replace(/[^a-zA-Z0-9]/g, "-");
}

/** Absolute path to Claude Code's session directory for `rootPath`. */
export function claudeProjectDir(rootPath: string): string {
  return path.join(
    os.homedir(),
    ".claude",
    "projects",
    encodeClaudeProjectDir(rootPath),
  );
}
