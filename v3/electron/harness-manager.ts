/**
 * Harness manager — installs / uninstalls / detects Harness catalog packages.
 *
 * Operates on the user's `~/.claude/` directory:
 *   - skills:    `~/.claude/skills/<name>/` (git clone or copy)
 *   - mcp:       `~/.claude.json` mcpServers entry (atomic merge)
 *   - bundled:   no-op (handled by bundle-installer)
 *   - manual:    no-op (UI shows instructions only)
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

export function detectStatus(pkg: HarnessPackage): InstallStatus {
  if (pkg.install.kind === "manual") {
    // Manual installs we can only check via path/mcp markers if provided.
    if (!pkg.detect.path && !pkg.detect.mcpKey) return "manual-required";
  }
  if (pkg.detect.path) {
    if (fileExists(path.join(CLAUDE_DIR, pkg.detect.path))) return "installed";
  }
  if (pkg.detect.mcpKey) {
    const cfg = readClaudeJson();
    const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
    if (pkg.detect.mcpKey in servers) return "installed";
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
