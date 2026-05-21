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
  cwd?: string,
  timeoutMs?: number,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, { cwd, env: process.env });
    let timer: ReturnType<typeof setTimeout> | null = null;
    if (timeoutMs && timeoutMs > 0) {
      timer = setTimeout(() => {
        try {
          child.kill("SIGKILL");
        } catch {
          /* ignore */
        }
        stderr += `\n[runCommand] timed out after ${timeoutMs}ms`;
      }, timeoutMs);
    }
    const done = (code: number) => {
      if (timer) clearTimeout(timer);
      resolve({ code, stdout, stderr });
    };
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => done(code ?? -1));
    child.on("error", (err) => {
      stderr += err.message;
      done(-1);
    });
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
  enrichedPath: string,
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
          resolve({ code: code ?? -1, stdout, stderr }),
        );
        child.on("error", (err) =>
          resolve({ code: -1, stdout, stderr: stderr + err.message }),
        );
      });
      if (result.code !== 0) {
        console.warn(
          `[harness] postInstallExec ${step.command} ${step.args.join(
            " ",
          )} exit ${result.code}: ${(result.stderr || result.stdout).trim()}`,
        );
      }
    } catch (err) {
      console.warn(
        `[harness] postInstallExec ${step.command} threw:`,
        err instanceof Error ? err.message : err,
      );
    }
  }
}

// Hosts whose curl-pipe-bash installer scripts are trusted to run. Each
// entry must be the EXACT hostname (no path/scheme). Keep this list small
// and curated — the user implicitly trusts whatever runs through here.
const TRUSTED_SHELL_INSTALLER_HOSTS = new Set<string>(["antigravity.google"]);

async function installShell(strategy: InstallStrategy): Promise<void> {
  if (!strategy.source) {
    throw new Error("shell install requires installer URL in source");
  }
  let url: URL;
  try {
    url = new URL(strategy.source);
  } catch {
    throw new Error(`Invalid installer URL: ${strategy.source}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `Shell installer URL must be HTTPS (got ${url.protocol}): ${strategy.source}`,
    );
  }
  if (!TRUSTED_SHELL_INSTALLER_HOSTS.has(url.host)) {
    throw new Error(
      `Shell installer host not whitelisted: ${url.host}. ` +
        `Allowed: ${[...TRUSTED_SHELL_INSTALLER_HOSTS].join(", ")}`,
    );
  }

  const enrichedPath = getEnrichedPathForDetection();
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: enrichedPath };

  // Pre-flight: bash + curl on PATH? Both are universal on macOS/Linux
  // but we still check to give a clean error message rather than a cryptic
  // ENOENT on spawn.
  const pathDirs = enrichedPath.split(":").filter(Boolean);
  const hasBin = (name: string) =>
    pathDirs.some((dir) => fileExists(path.join(dir, name)));
  if (!hasBin("bash")) {
    throw new Error(
      "bash 를 찾을 수 없습니다. shell 인스톨러를 실행할 수 없습니다.",
    );
  }
  if (!hasBin("curl")) {
    throw new Error(
      "curl 을 찾을 수 없습니다. shell 인스톨러를 실행할 수 없습니다.",
    );
  }

  // bash -c "curl -fsSL <url> | bash". Single-quoted URL so shell metachars
  // in the URL (unlikely but defensive) don't expand. Whitelist already
  // rejected anything not from a known host.
  const installCmd = `curl -fsSL '${strategy.source}' | bash`;
  console.log(`[harness] installShell: ${installCmd}`);

  const result = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn("bash", ["-c", installCmd], { env });
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout, stderr }));
    child.on("error", (err) =>
      resolve({ code: -1, stdout, stderr: stderr + err.message }),
    );
  });
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout)
      .trim()
      .split("\n")
      .slice(-10)
      .join("\n");
    throw new Error(
      `Shell installer 실패 (${strategy.source}, exit ${result.code})\n${tail}`,
    );
  }
  // Best-effort post-install hooks (e.g. environment setup). Most shell
  // installers handle their own post-install, so this is rarely populated
  // but kept consistent with npm-global for parity.
  await runPostInstallExec(strategy, enrichedPath);
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
      "npm을 찾을 수 없습니다. Node.js / npm 설치 후 다시 시도하세요. (https://nodejs.org)",
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
      resolve({ code: -1, stdout, stderr: stderr + err.message }),
    );
  });
  if (result.code !== 0) {
    const tail = (result.stderr || result.stdout)
      .trim()
      .split("\n")
      .slice(-5)
      .join("\n");
    throw new Error(
      `npm install -g ${strategy.source} 실패 (exit ${result.code})\n${tail}`,
    );
  }
  // npm install 성공 — feature-flag 같은 후속 작업 (best-effort)
  await runPostInstallExec(strategy, enrichedPath);
}

async function installMcp(
  pkg: HarnessPackage,
  strategy: InstallStrategy,
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
      Object.entries(strategy.env ?? {}).map(([k, v]) => [k, expandEnv(v)]),
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
        "이 패키지는 자동 설치를 지원하지 않습니다. instructions 참고.",
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
    case "shell":
      await installShell(pkg.install);
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

// ── Auto-update for npm-global CLIs ────────────────────────────────
//
// Marblo depends on `claude` / `codex` / `gemini` being current. Old codex
// builds in particular show an interactive "Update available!" dialog at
// startup that doesn't match any of agent-manager's readiness patterns —
// the 10s blind fallback then dumps the initial prompt into the menu and
// codex exits cleanly, leaving a dead PTY. Auto-upgrading the npm globals
// in the background keeps that class of issue from happening.

const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000; // 24h
const VERSION_LOOKUP_TIMEOUT_MS = 15_000;
const inFlightUpdates = new Set<string>();
let updateSweepTimer: ReturnType<typeof setInterval> | null = null;

export interface UpdateOutcome {
  id: string;
  source: string;
  from: string | null;
  to: string | null;
  status: "up-to-date" | "updated" | "skipped" | "error";
  error?: string;
}

function findBinaryPath(binary: string): string {
  const enrichedPath = getEnrichedPathForDetection();
  for (const dir of enrichedPath.split(":")) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    if (fileExists(candidate)) return candidate;
  }
  return "";
}

async function getLocalVersion(binary: string): Promise<string | null> {
  const binPath = findBinaryPath(binary);
  if (!binPath) return null;
  const r = await runCommand(binPath, ["--version"], undefined, 5_000);
  if (r.code !== 0) return null;
  // First semver-like token works for "1.2.3", "codex-cli 0.128.0",
  // "@anthropic-ai/claude-code 1.2.3 (Claude Code)", etc.
  const m = (r.stdout + r.stderr).match(/\d+\.\d+\.\d+(-[\w.]+)?/);
  return m ? m[0] : null;
}

async function getLatestNpmVersion(pkg: string): Promise<string | null> {
  const npmPath = findBinaryPath("npm");
  if (!npmPath) return null;
  const r = await runCommand(
    npmPath,
    ["view", pkg, "version"],
    undefined,
    VERSION_LOOKUP_TIMEOUT_MS,
  );
  if (r.code !== 0) return null;
  const v = r.stdout.trim();
  return /^\d+\.\d+\.\d+/.test(v) ? v : null;
}

export type UpdateState = "up-to-date" | "outdated" | "unknown";

export interface VersionInfo {
  localVersion: string | null;
  latestVersion: string | null;
  updateState: UpdateState;
}

/**
 * Look up local + npm latest version for every installed npm-global
 * package in the catalog. Best-effort — packages without binary detection
 * or with a failed lookup get `updateState: 'unknown'`. Used by the
 * Harness UI to show "v0.128.0 → v0.132.0" hints.
 */
export async function getCatalogVersions(): Promise<
  Record<string, VersionInfo>
> {
  const out: Record<string, VersionInfo> = {};
  await Promise.all(
    CATALOG.map(async (pkg) => {
      if (
        pkg.install.kind !== "npm-global" ||
        !pkg.install.source ||
        !pkg.detect.binary
      ) {
        return;
      }
      const [localVersion, latestVersion] = await Promise.all([
        getLocalVersion(pkg.detect.binary),
        getLatestNpmVersion(pkg.install.source),
      ]);
      let updateState: UpdateState = "unknown";
      if (localVersion && latestVersion) {
        updateState =
          localVersion === latestVersion ? "up-to-date" : "outdated";
      }
      out[pkg.id] = { localVersion, latestVersion, updateState };
    }),
  );
  return out;
}

/**
 * Check installed npm-global Harness CLIs and upgrade any that are behind
 * the latest published version. Best-effort: never throws. Returns an
 * outcome per checked package so callers can surface a toast / log.
 */
export async function checkAndUpdateHarness(): Promise<UpdateOutcome[]> {
  const outcomes: UpdateOutcome[] = [];
  for (const pkg of CATALOG) {
    if (pkg.install.kind !== "npm-global") continue;
    if (!pkg.install.source || !pkg.detect.binary) continue;
    if (detectStatus(pkg) !== "installed") continue;
    if (inFlightUpdates.has(pkg.id)) continue;
    inFlightUpdates.add(pkg.id);
    try {
      const [local, latest] = await Promise.all([
        getLocalVersion(pkg.detect.binary),
        getLatestNpmVersion(pkg.install.source),
      ]);
      if (!local || !latest) {
        outcomes.push({
          id: pkg.id,
          source: pkg.install.source,
          from: local,
          to: latest,
          status: "skipped",
          error: !local ? "local version unknown" : "npm view failed",
        });
        continue;
      }
      if (local === latest) {
        outcomes.push({
          id: pkg.id,
          source: pkg.install.source,
          from: local,
          to: latest,
          status: "up-to-date",
        });
        continue;
      }
      console.log(
        `[harness] Updating ${pkg.install.source}: ${local} → ${latest}`,
      );
      try {
        await installNpmGlobal(pkg.install);
        outcomes.push({
          id: pkg.id,
          source: pkg.install.source,
          from: local,
          to: latest,
          status: "updated",
        });
      } catch (err) {
        outcomes.push({
          id: pkg.id,
          source: pkg.install.source,
          from: local,
          to: latest,
          status: "error",
          error: err instanceof Error ? err.message : String(err),
        });
      }
    } finally {
      inFlightUpdates.delete(pkg.id);
    }
  }
  return outcomes;
}

/**
 * Kick off auto-update: one sweep immediately, then every 24h. Idempotent —
 * calling twice is a no-op. `onResult` fires after each sweep so the main
 * process can broadcast a `harness:updated` event to the renderer for a
 * toast notification.
 */
export function scheduleHarnessUpdates(
  onResult?: (outcomes: UpdateOutcome[]) => void,
): void {
  if (updateSweepTimer) return;
  const run = async () => {
    try {
      const outcomes = await checkAndUpdateHarness();
      onResult?.(outcomes);
      const updated = outcomes.filter((o) => o.status === "updated");
      if (updated.length > 0) {
        console.log(
          `[harness] Auto-update: ${updated
            .map((u) => `${u.source} ${u.from}→${u.to}`)
            .join(", ")}`,
        );
      }
    } catch (err) {
      console.warn("[harness] Auto-update sweep failed:", err);
    }
  };
  void run();
  updateSweepTimer = setInterval(run, UPDATE_CHECK_INTERVAL_MS);
}
