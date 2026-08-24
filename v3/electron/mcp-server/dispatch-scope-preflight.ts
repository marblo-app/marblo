import { execFile } from "node:child_process";
import * as path from "node:path";

export interface DispatchScopePreflightInput {
  cwd?: string;
  scope?: unknown;
  execFileImpl?: typeof execFile;
}

export interface DispatchScopePreflightResult {
  warning: string;
  missing: string[];
}

const MAX_SCOPE_PATHS = 40;

function execFileText(
  command: string,
  args: string[],
  options: { cwd?: string },
  execFileImpl: typeof execFile,
): Promise<{ ok: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFileImpl(
      command,
      args,
      { cwd: options.cwd, timeout: 5_000, maxBuffer: 1024 * 1024 },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout ?? ""),
          stderr: String(stderr ?? ""),
        });
      },
    );
  });
}

function normalizeScopePath(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.trim();
  if (!s) return null;
  s = s.replace(/^['"]|['"]$/g, "");
  if (!s || s.includes("\0")) return null;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return null;
  if (path.isAbsolute(s)) return null;
  if (s.startsWith("-")) return null;
  const normalized = path.posix.normalize(s.replace(/\\/g, "/"));
  if (!normalized || normalized === "." || normalized.startsWith("../")) {
    return null;
  }
  return normalized;
}

export function normalizeDispatchScopePaths(scope: unknown): string[] {
  if (!Array.isArray(scope)) return [];
  const seen = new Set<string>();
  for (const item of scope) {
    const normalized = normalizeScopePath(item);
    if (!normalized) continue;
    seen.add(normalized);
    if (seen.size >= MAX_SCOPE_PATHS) break;
  }
  return [...seen];
}

export function formatDispatchScopeWarning(missing: string[]): string {
  const shown = missing.slice(0, 8);
  const suffix =
    missing.length > shown.length ? ` 외 ${missing.length - shown.length}개` : "";
  return (
    `⚠️ dispatch scope preflight: HEAD 에 아직 없는 scope 파일 — ` +
    `${shown.join(", ")}${suffix}. 새 파일을 만드는 티켓이면 정상일 수 있어 ` +
    "디스패치는 계속합니다."
  );
}

export async function preflightDispatchScopeInHead(
  input: DispatchScopePreflightInput,
): Promise<DispatchScopePreflightResult> {
  const scopePaths = normalizeDispatchScopePaths(input.scope);
  if (!input.cwd || scopePaths.length === 0) {
    return { warning: "", missing: [] };
  }

  const execImpl = input.execFileImpl ?? execFile;
  const repoRoot = await execFileText(
    "git",
    ["rev-parse", "--show-toplevel"],
    { cwd: input.cwd },
    execImpl,
  );
  if (!repoRoot.ok) return { warning: "", missing: [] };

  const missing: string[] = [];
  for (const file of scopePaths) {
    const exists = await execFileText(
      "git",
      ["cat-file", "-e", `HEAD:${file}`],
      { cwd: input.cwd },
      execImpl,
    );
    if (!exists.ok) missing.push(file);
  }

  return {
    warning: missing.length ? formatDispatchScopeWarning(missing) : "",
    missing,
  };
}
