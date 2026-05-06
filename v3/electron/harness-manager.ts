/**
 * Harness manager — installs / uninstalls / detects Harness catalog packages.
 *
 * Operates on the user's `~/.claude/` directory:
 *   - skills:     `~/.claude/skills/<name>/` (git clone or copy)
 *   - mcp:        `~/.claude.json` mcpServers entry (atomic merge)
 *   - bundled:    no-op (handled by bundle-installer)
 *   - manual:     no-op (UI shows instructions only)
 *   - npm-global: `npm install -g <package>` for CLI binaries (Codex,
 *                 Gemini, etc.) — detection via PATH `which <binary>`
 */
import fs from "fs";
import os from "os";
import path from "path";
import { spawn } from "child_process";
import {
  CATALOG,
  type HarnessPackage,
  type InstallStrategy,
} from "./harness-catalog";

const HOME = os.homedir();
const CLAUDE_DIR = path.join(HOME, ".claude");
const CLAUDE_JSON = path.join(HOME, ".claude.json");

export type InstallStatus =
  | "installed"
  | "not-installed"
  | "manual-required"
  | "unknown";

export interface PackageStatus extends HarnessPackage {
  status: InstallStatus;
}

function fileExists(p: string): boolean {
  try {
    return fs.existsSync(p);
  } catch {
    return false;
  }
}

function readClaudeJson(): { mcpServers?: Record<string, unknown> } {
  try {
    if (!fileExists(CLAUDE_JSON)) return {};
    return JSON.parse(fs.readFileSync(CLAUDE_JSON, "utf-8"));
  } catch {
    return {};
  }
}

function writeClaudeJsonAtomic(data: object): void {
  const tmp = `${CLAUDE_JSON}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, CLAUDE_JSON);
}

/** Build a PATH that includes common binary locations Electron may miss. */
function getEnrichedPathForDetection(): string {
  const basePath = process.env.PATH || "";
  const extras = [
    "/opt/homebrew/bin",
    "/opt/homebrew/sbin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin",
    path.join(HOME, ".npm-global/bin"),
    path.join(HOME, ".npm/bin"),
    path.join(HOME, ".bun/bin"),
    path.join(HOME, ".local/bin"),
    path.join(HOME, ".cargo/bin"),
    path.join(HOME, ".deno/bin"),
    path.join(HOME, ".volta/bin"),
  ];
  return [...new Set([...basePath.split(":"), ...extras])].join(":");
}

function isBinaryOnPath(binary: string): boolean {
  const enrichedPath = getEnrichedPathForDetection();
  for (const dir of enrichedPath.split(":")) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, binary);
      // fs.existsSync follows symlinks — good enough for this check.
      if (fileExists(candidate)) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

export function detectStatus(pkg: HarnessPackage): InstallStatus {
  if (pkg.install.kind === "manual") {
    // Manual installs we can only check via path/mcp markers if provided.
    if (!pkg.detect.path && !pkg.detect.mcpKey && !pkg.detect.binary) {
      return "manual-required";
    }
  }
  if (pkg.detect.path) {
    if (fileExists(path.join(CLAUDE_DIR, pkg.detect.path))) return "installed";
  }
  if (pkg.detect.mcpKey) {
    const cfg = readClaudeJson();
    const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    if (pkg.detect.mcpKey in servers) return "installed";
  }
  if (pkg.detect.binary) {
    if (isBinaryOnPath(pkg.detect.binary)) return "installed";
  }
  if (pkg.install.kind === "manual") return "manual-required";
  return "not-installed";
}

export function listCatalog(): PackageStatus[] {
  return CATALOG.map((pkg) => ({ ...pkg, status: detectStatus(pkg) }));
}

function expandEnv(value: string): string {
  return value.replace(/\$\{(\w+)\}/g, (_, key: string) => {
    if (key === "HOME") return HOME;
    return process.env[key] ?? `\${${key}}`;
  });
}

function runCommand(
  cmd: string,
  args: string[],
  cwd?: string
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { cwd, env: process.env });
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: stderr + err.message })
    );
  });
}

async function installGit(strategy: InstallStrategy): Promise<void> {
  if (!strategy.source || !strategy.dest) {
    throw new Error("git install requires source and dest");
  }
  const target = path.join(CLAUDE_DIR, "skills", strategy.dest);
  fs.mkdirSync(path.join(CLAUDE_DIR, "skills"), { recursive: true });
  if (fileExists(target)) {
    // Update existing clone with `git pull`.
    const r = await runCommand("git", ["-C", target, "pull", "--ff-only"]);
    if (r.code !== 0) {
      throw new Error(`git pull failed: ${r.stderr || r.stdout}`);
    }
    return;
  }
  const r = await runCommand("git", ["clone", strategy.source, target]);
  if (r.code !== 0) {
    throw new Error(`git clone failed: ${r.stderr || r.stdout}`);
  }
}

/**
 * Run optional post-install hooks (e.g. `codex features enable goals`).
 * Best-effort: errors are logged to console but never thrown — a feature-flag
 * failure should not invalidate a successful CLI install.
 */
async function runPostInstallExec(
  strategy: InstallStrategy,
  enrichedPath: string
): Promise<void> {
  if (!strategy.postInstallExec || strategy.postInstallExec.length === 0) {
    return;
  }
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: enrichedPath };
  for (const step of strategy.postInstallExec) {
    try {
      const result = await new Promise<{
        code: number;
        stdout: string;
        stderr: string;
      }>((resolve) => {
        let stdout = "";
        let stderr = "";
        const child = spawn(step.command, step.args, { env });
        child.stdout.on("data", (d) => (stdout += d.toString()));
        child.stderr.on("data", (d) => (stderr += d.toString()));
        child.on("close", (code) =>
          resolve({ code: code ?? -1, stdout, stderr })
        );
        child.on("error", (err) =>
          resolve({ code: -1, stdout, stderr: stderr + err.message })
        );
      });
      if (result.code !== 0) {
        console.warn(
          `[harness] postInstallExec ${step.command} ${step.args.join(
            " "
          )} exit ${result.code}: ${(result.stderr || result.stdout).trim()}`
        );
      }
    } catch (err) {
      console.warn(
        `[harness] postInstallExec ${step.command} threw:`,
        err instanceof Error ? err.message : err
      );
    }
  }
}

async function installNpmGlobal(strategy: InstallStrategy): Promise<void> {
  if (!strategy.source) {
    throw new Error("npm-global install requires a package name in source");
  }
  // Find npm via the same enriched-PATH search detect uses, since
  // Electron-spawned children may not inherit the full shell PATH.
  const enrichedPath = getEnrichedPathForDetection();
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: enrichedPath };
  // Pre-flight: does npm exist at all?
  let npmPath = "";
  for (const dir of enrichedPath.split(":")) {
    if (!dir) continue;
    const candidate = path.join(dir, "npm");
    if (fileExists(candidate)) {
      npmPath = candidate;
      break;
    }
  }
  if (!npmPath) {
    throw new Error(
      "npm을 찾을 수 없습니다. Node.js / npm 설치 후 다시 시도하세요. (https://nodejs.org)"
    );
  }
  const result = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(npmPath, ["install", "-g", strategy.source!], { env });
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: stderr + err.message })
    );
  });
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout)
      .trim()
      .split("\n")
      .slice(-5)
      .join("\n");
    throw new Error(
      `npm install -g ${strategy.source} 실패 (exit ${result.code})\n${tail}`
    );
  }
  // npm install 성공 — feature-flag 같은 후속 작업 (best-effort)
  await runPostInstallExec(strategy, enrichedPath);
}

async function installMcp(
  pkg: HarnessPackage,
  strategy: InstallStrategy
): Promise<void> {
  if (!strategy.source) {
    throw new Error("mcp install requires source command");
  }
  const cfg = readClaudeJson() as Record<string, unknown> & {
    mcpServers?: Record<string, unknown>;
  };
  const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
  const key = pkg.detect.mcpKey ?? pkg.id;
  servers[key] = {
    command: strategy.source,
    args: (strategy.args ?? []).map(expandEnv),
    env: Object.fromEntries(
      Object.entries(strategy.env ?? {}).map(([k, v]) => [k, expandEnv(v)])
    ),
  };
  cfg.mcpServers = servers;
  writeClaudeJsonAtomic(cfg);
}

export async function installPackage(id: string): Promise<void> {
  const pkg = CATALOG.find((p) => p.id === id);
  if (!pkg) throw new Error(`Unknown package: ${id}`);
  switch (pkg.install.kind) {
    case "bundled":
      // Bundle-installer handles these. No-op (already installed).
      return;
    case "manual":
      throw new Error(
        "이 패키지는 자동 설치를 지원하지 않습니다. instructions 참고."
      );
    case "git":
      await installGit(pkg.install);
      return;
    case "mcp":
      await installMcp(pkg, pkg.install);
      return;
    case "npm-global":
      await installNpmGlobal(pkg.install);
      return;
  }
}

function uninstallGit(pkg: HarnessPackage): void {
  if (!pkg.install.dest) return;
  const target = path.join(CLAUDE_DIR, "skills", pkg.install.dest);
  if (fileExists(target)) fs.rmSync(target, { recursive: true, force: true });
}

function uninstallMcp(pkg: HarnessPackage): void {
  const key = pkg.detect.mcpKey ?? pkg.id;
  const cfg = readClaudeJson() as Record<string, unknown> & {
    mcpServers?: Record<string, unknown>;
  };
  if (cfg.mcpServers && key in cfg.mcpServers) {
    delete cfg.mcpServers[key];
    writeClaudeJsonAtomic(cfg);
  }
}

export async function uninstallPackage(id: string): Promise<void> {
  const pkg = CATALOG.find((p) => p.id === id);
  if (!pkg) throw new Error(`Unknown package: ${id}`);
  if (pkg.category === "required") {
    throw new Error("필수 패키지는 제거할 수 없습니다.");
  }
  switch (pkg.install.kind) {
    case "git":
      uninstallGit(pkg);
      return;
    case "mcp":
      uninstallMcp(pkg);
      return;
    default:
      // bundled / manual — no automatic uninstall.
      return;
  }
}
