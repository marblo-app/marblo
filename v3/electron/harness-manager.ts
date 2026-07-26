/**
 * Harness manager — installs / uninstalls / detects Harness catalog packages.
 *
 * Operates on the user's `~/.claude/` directory:
 *   - skills:     `~/.claude/skills/<name>/` (git clone or copy)
 *   - mcp:        `~/.claude.json` mcpServers entry (atomic merge)
 *   - bundled:    no-op (handled by bundle-installer)
 *   - manual:     no-op (UI shows instructions only)
 *   - npm-global: `npm install -g <package>` for CLI binaries (Codex,
 *                 Gemini, etc.) — detection via PATH/PATHEXT
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
const CODEX_DIR = path.join(HOME, ".codex");
// Antigravity (agy) shares the user's ~/.gemini. Its OAuth token lands in
// ~/.gemini/antigravity-cli/antigravity-oauth-token (agy) and/or
// ~/.gemini/oauth_creds.json (the shared Google login).
const GEMINI_DIR = path.join(HOME, ".gemini");
const AGY_CLI_DIR = path.join(GEMINI_DIR, "antigravity-cli");

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
  const extras =
    process.platform === "win32"
      ? [
          path.join(HOME, ".local", "bin"),
          path.join(
            process.env.APPDATA || path.join(HOME, "AppData", "Roaming"),
            "npm",
          ),
        ]
      : [
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
  return [...new Set([...basePath.split(path.delimiter), ...extras])].join(
    path.delimiter,
  );
}

function getPathDirs(enrichedPath: string): string[] {
  return enrichedPath.split(path.delimiter).filter(Boolean);
}

function candidateBinaryNames(binary: string): string[] {
  if (process.platform !== "win32" || path.extname(binary)) return [binary];
  const pathext = (process.env.PATHEXT || ".COM;.EXE;.BAT;.CMD")
    .split(";")
    .map((ext) => ext.trim().toLowerCase())
    .filter(Boolean);
  const extensions = ["", ".exe", ".cmd", ".bat", ".ps1", ...pathext];
  return [...new Set(extensions)].map((ext) => `${binary}${ext}`);
}

function commandForSpawn(
  command: string,
  args: string[],
): { command: string; args: string[] } {
  if (process.platform === "win32" && /\.(cmd|bat)$/i.test(command)) {
    return { command: "cmd.exe", args: ["/c", command, ...args] };
  }
  return { command, args };
}

function isBinaryOnPath(binary: string): boolean {
  return Boolean(findBinaryPath(binary));
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
    const resolved = commandForSpawn(cmd, args);
    const child = spawn(resolved.command, resolved.args, {
      cwd,
      env: process.env,
    });
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
        const executable = findBinaryPath(step.command) || step.command;
        const command = commandForSpawn(executable, step.args);
        const child = spawn(command.command, command.args, { env });
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
const TRUSTED_SHELL_INSTALLER_HOSTS = new Set<string>([
  "antigravity.google",
  "x.ai",
]);

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
  // Windows 는 bash 기반 curl-pipe 인스톨러를 자동 실행하지 않는다. 호스트별로
  // 예외를 두지 않는다 — x.ai/antigravity 둘 다 bash 스크립트라 win32 에서는
  // 어차피 못 돈다. 호스트를 붙여 어떤 CLI 를 수동 설치해야 하는지만 알려준다.
  if (process.platform === "win32") {
    throw new Error(
      `Windows에서는 bash 기반 shell 인스톨러를 자동 실행하지 않습니다(${url.host}). ` +
        "해당 CLI의 Windows용 공식 설치 안내에 따라 수동 설치 후 다시 시도하세요.",
    );
  }

  const enrichedPath = getEnrichedPathForDetection();
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: enrichedPath };

  // Pre-flight: bash + curl on PATH? Both are universal on macOS/Linux
  // but we still check to give a clean error message rather than a cryptic
  // ENOENT on spawn.
  const pathDirs = getPathDirs(enrichedPath);
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

/**
 * Pure: is a resolved binary path managed by npm's global prefix?
 *
 * Native installers (e.g. Claude Code's `~/.local/bin/claude` →
 * `~/.local/share/claude/versions/<v>`) live OUTSIDE the npm prefix and
 * self-update. Running `npm i -g` on them is wrong — it resurrects a stale,
 * conflicting npm copy which makes Claude Code itself report "Auto-update
 * failed". Callers compare the binary's realpath against the npm global
 * prefix to decide whether npm owns this CLI.
 */
export function isPathUnderNpmPrefix(
  binaryRealPath: string,
  npmGlobalPrefix: string,
): boolean {
  if (!binaryRealPath || !npmGlobalPrefix) return false;
  const strip = (p: string) => p.replace(/[/\\]+$/, "");
  const prefix = strip(npmGlobalPrefix);
  const real = strip(binaryRealPath);
  return real === prefix || real.startsWith(prefix + path.sep);
}

let npmGlobalPrefixCache: string | null | undefined;

/** Resolve `npm prefix -g` once. Returns null if npm is unavailable. */
async function getNpmGlobalPrefix(): Promise<string | null> {
  if (npmGlobalPrefixCache !== undefined) return npmGlobalPrefixCache;
  const npmPath = findBinaryPath("npm");
  if (!npmPath) {
    npmGlobalPrefixCache = null;
    return null;
  }
  const r = await runCommand(npmPath, ["prefix", "-g"], undefined, 5_000);
  npmGlobalPrefixCache = r.code === 0 ? r.stdout.trim() || null : null;
  return npmGlobalPrefixCache;
}

/**
 * Whether an installed npm-global CLI is actually owned by npm. Falls back to
 * `true` (assume npm-managed → allow update) when the prefix can't be
 * determined, preserving prior behavior. Returns `false` for externally
 * managed installs (native/self-updating) so auto-update skips them.
 */
async function isNpmGlobalManaged(binary: string): Promise<boolean> {
  const binPath = findBinaryPath(binary);
  if (!binPath) return false;
  let real = binPath;
  try {
    real = fs.realpathSync(binPath);
  } catch {
    /* keep unresolved path */
  }
  const prefix = await getNpmGlobalPrefix();
  if (!prefix) return true;
  return isPathUnderNpmPrefix(real, prefix);
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
  const npmPath = findBinaryPath("npm");
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
    const command = commandForSpawn(npmPath, [
      "install",
      "-g",
      strategy.source!,
    ]);
    const child = spawn(command.command, command.args, { env });
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
  for (const dir of getPathDirs(enrichedPath)) {
    for (const name of candidateBinaryNames(binary)) {
      const candidate = path.join(dir, name);
      if (fileExists(candidate)) return candidate;
    }
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
        pkg.deprecated ||
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
 * Check installed Harness CLIs and upgrade any that are behind the latest
 * published version. npm-global packages are version-compared before install.
 * Whitelisted shell installers (Antigravity/agy) are re-run idempotently
 * because their upstream installer owns update detection.
 *
 * Best-effort: never throws. Returns an outcome per checked package so callers
 * can surface a toast / log.
 */
export async function checkAndUpdateHarness(): Promise<UpdateOutcome[]> {
  const outcomes: UpdateOutcome[] = [];
  for (const pkg of CATALOG) {
    if (pkg.deprecated) continue;
    if (pkg.install.kind !== "npm-global" && pkg.install.kind !== "shell")
      continue;
    if (!pkg.install.source || !pkg.detect.binary) continue;
    if (detectStatus(pkg) !== "installed") continue;
    if (inFlightUpdates.has(pkg.id)) continue;
    inFlightUpdates.add(pkg.id);
    try {
      if (pkg.install.kind === "shell") {
        const local = await getLocalVersion(pkg.detect.binary);
        console.log(
          `[harness] Refreshing shell CLI ${pkg.id} via ${pkg.install.source}`,
        );
        try {
          await installShell(pkg.install);
          outcomes.push({
            id: pkg.id,
            source: pkg.install.source,
            from: local,
            to: null,
            status: "updated",
          });
        } catch (err) {
          outcomes.push({
            id: pkg.id,
            source: pkg.install.source,
            from: local,
            to: null,
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        }
        continue;
      }

      // Skip CLIs that aren't actually owned by npm (e.g. Claude Code's
      // native install at ~/.local/bin). Forcing `npm i -g` on them
      // resurrects a conflicting npm copy and breaks their self-updater.
      if (!(await isNpmGlobalManaged(pkg.detect.binary))) {
        const local = await getLocalVersion(pkg.detect.binary);
        console.log(
          `[harness] ${pkg.id} is externally managed (native/self-updating) — skipping npm update`,
        );
        outcomes.push({
          id: pkg.id,
          source: pkg.install.source,
          from: local,
          to: null,
          status: "skipped",
          error: "externally managed (native install) — self-updates",
        });
        continue;
      }

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

// ── CLI auth live-probe ────────────────────────────────────────────
//
// A CLI binary being on PATH only means it's *installed* — not that the
// user has logged in. Spawning an unauthenticated `claude` / `codex` drops
// into an interactive login prompt that hangs the PTY (no readiness pattern
// ever matches). Before spawning, the UI live-probes login state via cheap,
// NON-INTERACTIVE signals (env keys + on-disk credential files) so it can
// surface a "login required" badge with the exact command to run instead of
// silently hanging.

export type CliAuthModel = "claude" | "codex" | "grok" | "antigravity";

export interface CliAuthResult {
  /** Binary present on PATH. */
  installed: boolean;
  /** Login/credentials detected. Always false when `installed` is false. */
  authenticated: boolean;
  /** Concrete next command to run (install or login) when blocked. */
  action?: string;
}

function envHasValue(...names: string[]): boolean {
  return names.some((n) => {
    const v = process.env[n];
    return typeof v === "string" && v.trim().length > 0;
  });
}

/**
 * macOS keychain probe — best-effort fallback. Claude Code stores OAuth
 * tokens in the login keychain on macOS rather than a flat file. We only
 * check *existence* (no `-w`, so the secret is never read) and cap it with a
 * short timeout so a keychain access prompt can't hang the probe.
 */
async function macKeychainHasClaudeCreds(): Promise<boolean> {
  if (process.platform !== "darwin") return false;
  const security = findBinaryPath("security");
  if (!security) return false;
  const r = await runCommand(
    security,
    ["find-generic-password", "-s", "Claude Code-credentials"],
    undefined,
    2_000,
  );
  return r.code === 0;
}

/** Synchronous, non-interactive signals that Claude Code is logged in. */
function claudeAuthenticatedSync(): boolean {
  // 1) API key via env — Claude Code authenticates non-interactively with it.
  if (envHasValue("ANTHROPIC_API_KEY", "ANTHROPIC_AUTH_TOKEN")) return true;
  // 2) Linux/Windows OAuth token store.
  if (fileExists(path.join(CLAUDE_DIR, ".credentials.json"))) return true;
  // 3) `~/.claude.json` records the logged-in account / configured key.
  const cfg = readClaudeJson() as Record<string, unknown>;
  if (cfg && typeof cfg === "object") {
    if (cfg.oauthAccount && typeof cfg.oauthAccount === "object") return true;
    if (
      cfg.customApiKeyResponses &&
      typeof cfg.customApiKeyResponses === "object"
    ) {
      return true;
    }
    if (typeof cfg.primaryApiKey === "string" && cfg.primaryApiKey.length > 0) {
      return true;
    }
  }
  return false;
}

/** Non-interactive signals that Codex is logged in. */
function codexAuthenticated(): boolean {
  // Codex honors an API key from the environment.
  if (envHasValue("OPENAI_API_KEY")) return true;
  // `codex login` writes credentials to ~/.codex/auth.json.
  const authPath = path.join(CODEX_DIR, "auth.json");
  if (!fileExists(authPath)) return false;
  try {
    const raw = JSON.parse(fs.readFileSync(authPath, "utf-8")) as Record<
      string,
      unknown
    >;
    if (!raw || typeof raw !== "object") return false;
    if (
      typeof raw.OPENAI_API_KEY === "string" &&
      raw.OPENAI_API_KEY.length > 0
    ) {
      return true;
    }
    if (raw.tokens && typeof raw.tokens === "object") return true;
    // A non-empty auth.json generally means a completed login.
    return Object.keys(raw).length > 0;
  } catch {
    // Exists but unreadable/corrupt — treat as not authenticated.
    return false;
  }
}

/** Non-interactive signals that Grok Build is logged in. */
function grokAuthenticated(): boolean {
  if (envHasValue("XAI_API_KEY")) return true;
  const grokDir = path.join(HOME, ".grok");
  for (const rel of [
    "auth.json",
    "credentials.json",
    "session.json",
    path.join("auth", "tokens.json"),
    path.join("auth", "session.json"),
  ]) {
    if (fileExists(path.join(grokDir, rel))) return true;
  }
  return false;
}

/**
 * Non-interactive signals that Antigravity (agy) is logged in. agy shares the
 * user's ~/.gemini (Google account), so a completed OAuth leaves an
 * antigravity-oauth-token and/or the shared oauth_creds.json. An API key in
 * the environment also authenticates non-interactively.
 */
function antigravityAuthenticated(): boolean {
  if (envHasValue("GOOGLE_API_KEY", "GEMINI_API_KEY")) return true;
  if (fileExists(path.join(AGY_CLI_DIR, "antigravity-oauth-token")))
    return true;
  if (fileExists(path.join(GEMINI_DIR, "oauth_creds.json"))) return true;
  return false;
}

/**
 * Live-probe install + login state for a required CLI. Fast and
 * non-interactive: PATH lookup + env/file checks, with a single guarded
 * keychain existence check on macOS for Claude. Never spawns the CLI itself.
 */
export async function probeCliAuth(
  model: CliAuthModel,
): Promise<CliAuthResult> {
  if (model === "claude") {
    if (!isBinaryOnPath("claude")) {
      return {
        installed: false,
        authenticated: false,
        action: "npm install -g @anthropic-ai/claude-code",
      };
    }
    let authed = claudeAuthenticatedSync();
    if (!authed) authed = await macKeychainHasClaudeCreds();
    return authed
      ? { installed: true, authenticated: true }
      : { installed: true, authenticated: false, action: "claude login" };
  }
  if (model === "codex") {
    if (!isBinaryOnPath("codex")) {
      return {
        installed: false,
        authenticated: false,
        action: "npm install -g @openai/codex",
      };
    }
    return codexAuthenticated()
      ? { installed: true, authenticated: true }
      : { installed: true, authenticated: false, action: "codex login" };
  }
  if (model === "grok") {
    if (!isBinaryOnPath("grok")) {
      return {
        installed: false,
        authenticated: false,
        action: "curl -fsSL https://x.ai/cli/install.sh | bash",
      };
    }
    return grokAuthenticated()
      ? { installed: true, authenticated: true }
      : { installed: true, authenticated: false, action: "grok login" };
  }
  if (model === "antigravity") {
    if (!isBinaryOnPath("agy")) {
      return {
        installed: false,
        authenticated: false,
        action: "curl -fsSL https://antigravity.google/cli/install.sh | bash",
      };
    }
    // agy completes login by running `agy` once (opens the OAuth browser flow).
    return antigravityAuthenticated()
      ? { installed: true, authenticated: true }
      : { installed: true, authenticated: false, action: "agy" };
  }
  // Exhaustive guard for an unexpected model value.
  return {
    installed: false,
    authenticated: false,
    action: `unknown model: ${String(model)}`,
  };
}

// ── Pre-spawn auth gate ────────────────────────────────────────────
//
// Agent/orchestrator spawn entry points call this BEFORE launching a CLI so an
// unauthenticated `claude` / `codex` never gets spawned into its interactive
// login prompt (which no readiness pattern matches → the 10s blind fallback
// then types the instruction into the login menu and the CLI exits cleanly,
// leaving a dead PTY with no explanation). Only claude/codex are gated —
// gemini/antigravity/custom/local have no probe, so they pass through
// unchanged (backstopped by looksLikeLoginScreen at the readiness loop).

/** Map an AgentManager ModelType to the CLI auth model, or null if ungated. */
export function modelToCliAuth(model: string): CliAuthModel | null {
  if (model === "claude") return "claude";
  if (model === "gpt" || model === "codex") return "codex";
  if (model === "grok") return "grok";
  return null;
}

export interface SpawnAuthGate {
  /** true = safe to spawn (ready, or an ungated model). */
  ok: boolean;
  /** The gated CLI model, or null for ungated models (gemini/agy/custom). */
  model: CliAuthModel | null;
  installed: boolean;
  authenticated: boolean;
  /** Concrete next command (install or login) when blocked. */
  action?: string;
  reason?: "not-installed" | "not-authenticated";
}

/**
 * Live-probe whether it's safe to spawn `model`. Non-interactive and fast
 * (delegates to probeCliAuth). Ungated models short-circuit to ok:true.
 */
export async function checkSpawnAuthGate(
  model: string,
): Promise<SpawnAuthGate> {
  const cliModel = modelToCliAuth(model);
  if (!cliModel) {
    return { ok: true, model: null, installed: true, authenticated: true };
  }
  const r = await probeCliAuth(cliModel);
  if (!r.installed) {
    return {
      ok: false,
      model: cliModel,
      installed: false,
      authenticated: false,
      action: r.action,
      reason: "not-installed",
    };
  }
  if (!r.authenticated) {
    return {
      ok: false,
      model: cliModel,
      installed: true,
      authenticated: false,
      action: r.action,
      reason: "not-authenticated",
    };
  }
  return { ok: true, model: cliModel, installed: true, authenticated: true };
}

// ── Login-screen detection (readiness-loop backstop) ───────────────
//
// Defense-in-depth for the readiness loops in agent-manager /
// orchestrator-manager. If a CLI *does* boot into an interactive login prompt
// (e.g. a spawn path that bypassed checkSpawnAuthGate, or auth that lapsed
// between probe and spawn), these signatures let the loop recognise it and
// SUPPRESS the blind-fallback keystrokes rather than typing the instruction
// into the login menu. Verified against live PTY captures (QA
// vj7ZvHphYOIhsNd340ad): codex shows "Sign in with ChatGPT" / "Welcome to
// Codex"; claude's `claude login` shows a "Select login method" menu.
//
// These are only ever tested against a freshly-spawned CLI's BOOT output
// (before any instruction is sent), so an agent "discussing" these phrases in
// chat can't trip them — the buffer is closed to further matching once the
// prompt is sent.
export const LOGIN_SCREEN_PATTERNS: RegExp[] = [
  /Sign in with ChatGPT/i, // codex login menu
  /Welcome to Codex/i, // codex first-run when logged out
  /Provide (an )?API key/i, // codex/claude API-key entry
  /Device Code/i, // codex device-code login
  /Select login method/i, // claude login menu
  /Log ?in (with|to) (your )?(Claude|Anthropic)/i, // claude login
  /Claude account with subscription/i, // claude login option
  /Anthropic Console account/i, // claude login option
  /Grok Build.*(login|auth)/i, // grok first-run auth
  /Log ?in (with|to) (your )?(Grok|xAI|X account)/i, // grok login
  /Sign in with (Grok|xAI|X)/i, // grok browser auth
  /Browser OIDC/i, // grok login method docs/flow wording
  // Antigravity (agy) / gemini OAuth flow — the CLI blocks on a browser
  // sign-in spinner. Distinctive to the auth handshake, so it won't trip on
  // ordinary boot output. Lets the readiness backstop suppress blind typing
  // for an unauthenticated agy spawn even though agy is ungated pre-spawn.
  /Waiting for authentication/i, // agy/gemini OAuth spinner
  /Sign in with Google/i, // agy/gemini login
  /How would you like to authenticate/i, // gemini auth-type dialog
];

/** Whether freshly-booted CLI output looks like an interactive login prompt. */
export function looksLikeLoginScreen(buffer: string): boolean {
  return LOGIN_SCREEN_PATTERNS.some((re) => re.test(buffer));
}
