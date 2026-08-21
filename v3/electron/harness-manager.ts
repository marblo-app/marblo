/**
 * Harness manager — installs / uninstalls / detects Harness catalog packages.
 *
 * Operates on the user's `~/.claude/` directory:
 *   - skills:     `~/.claude/skills/<name>/` (git clone or copy)
 *   - mcp:        `~/.claude.json` mcpServers entry (atomic merge)
 *   - bundled:    no-op (handled by bundle-installer)
 *   - manual:     no-op (UI shows instructions only)
 *   - npm-global: `npm install -g <package>` for CLI binaries (Gemini) —
 *                 detection via PATH/PATHEXT, user-prefix fallback on EACCES
 *   - shell:      vendor's official native installer — curl|bash on
 *                 macOS/Linux, PowerShell irm|iex on Windows (winSource)
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
import { harnessForModel } from "./model-registry";
import { vendorEnvReadiness } from "./agent-config";

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

// registry-installer 가 같은 파일을 같은 원자적 패턴으로 다루도록 export —
// 단 설치 정책·검증은 공유하지 않는다(§4.4: untrusted 입력은 별도 경로).
export function readClaudeJson(): { mcpServers?: Record<string, unknown> } {
  try {
    if (!fileExists(CLAUDE_JSON)) return {};
    return JSON.parse(fs.readFileSync(CLAUDE_JSON, "utf-8"));
  } catch {
    return {};
  }
}

export function writeClaudeJsonAtomic(data: object): void {
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
  "claude.ai",
  "chatgpt.com",
]);

function assertTrustedInstallerUrl(rawUrl: string): URL {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new Error(`Invalid installer URL: ${rawUrl}`);
  }
  if (url.protocol !== "https:") {
    throw new Error(
      `Shell installer URL must be HTTPS (got ${url.protocol}): ${rawUrl}`,
    );
  }
  if (!TRUSTED_SHELL_INSTALLER_HOSTS.has(url.host)) {
    throw new Error(
      `Shell installer host not whitelisted: ${url.host}. ` +
        `Allowed: ${[...TRUSTED_SHELL_INSTALLER_HOSTS].join(", ")}`,
    );
  }
  return url;
}

/**
 * Pure: pick the platform-appropriate official installer invocation for a
 * `shell` strategy. macOS/Linux run `curl -fsSL <source> | bash`; Windows
 * runs PowerShell `irm <winSource> | iex` — but ONLY when the vendor
 * actually publishes a Windows installer (`winSource`). No winSource on
 * win32 = honest "unsupported" error, never a guessed URL. The trusted-host
 * allowlist applies to both platforms.
 */
export function resolveShellInstallerSpawn(
  strategy: InstallStrategy,
  platform: NodeJS.Platform,
): { url: string; command: string; args: string[] } {
  if (!strategy.source) {
    throw new Error("shell install requires installer URL in source");
  }
  if (platform === "win32") {
    if (!strategy.winSource) {
      const host = assertTrustedInstallerUrl(strategy.source).host;
      throw new Error(
        `이 CLI(${host})는 Windows용 공식 인스톨러를 제공하지 않습니다. ` +
          "해당 CLI의 공식 설치 안내에 따라 수동 설치 후 다시 시도하세요.",
      );
    }
    assertTrustedInstallerUrl(strategy.winSource);
    // PowerShell single quotes are literal — no interpolation of URL chars.
    const installCmd = `irm '${strategy.winSource}' | iex`;
    return {
      url: strategy.winSource,
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        installCmd,
      ],
    };
  }
  assertTrustedInstallerUrl(strategy.source);
  // bash -c "curl -fsSL <url> | bash". Single-quoted URL so shell metachars
  // in the URL (unlikely but defensive) don't expand. Whitelist already
  // rejected anything not from a known host.
  return {
    url: strategy.source,
    command: "bash",
    args: ["-c", `curl -fsSL '${strategy.source}' | bash`],
  };
}

async function installShell(strategy: InstallStrategy): Promise<void> {
  const spawnPlan = resolveShellInstallerSpawn(strategy, process.platform);

  const enrichedPath = getEnrichedPathForDetection();
  const env: NodeJS.ProcessEnv = { ...process.env, PATH: enrichedPath };

  const pathDirs = getPathDirs(enrichedPath);
  const hasBin = (name: string) =>
    pathDirs.some((dir) => fileExists(path.join(dir, name)));
  if (process.platform === "win32") {
    // powershell.exe lives in System32 which is always on PATH; check anyway
    // for a clean error instead of a cryptic ENOENT on spawn.
    if (!hasBin("powershell.exe")) {
      throw new Error(
        "PowerShell 을 찾을 수 없습니다. shell 인스톨러를 실행할 수 없습니다.",
      );
    }
  } else {
    // Pre-flight: bash + curl on PATH? Both are universal on macOS/Linux
    // but we still check to give a clean error message rather than a cryptic
    // ENOENT on spawn.
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
  }

  console.log(
    `[harness] installShell: ${spawnPlan.command} ${spawnPlan.args.join(" ")}`,
  );

  const result = await new Promise<{
    code: number;
    stdout: string;
    stderr: string;
  }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(spawnPlan.command, spawnPlan.args, { env });
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
      `Shell installer 실패 (${spawnPlan.url}, exit ${result.code})\n${tail}`,
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

/**
 * Is the npm global prefix writable by this user? Checks the deepest
 * existing directory npm would write into (`lib/node_modules` on POSIX,
 * `node_modules` on Windows, then the prefix itself). A system-Node prefix
 * like /usr/local or /usr fails this → `npm i -g` would EACCES.
 */
export function isNpmPrefixWritable(prefix: string): boolean {
  const candidates = [
    path.join(prefix, "lib", "node_modules"),
    path.join(prefix, "node_modules"),
    path.join(prefix, "lib"),
    prefix,
  ];
  for (const p of candidates) {
    if (!fileExists(p)) continue;
    try {
      fs.accessSync(p, fs.constants.W_OK);
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/** User-writable npm prefix used when the global prefix would EACCES.
 *  `~/.npm-global/bin` is already on the enriched detection PATH. */
export function userNpmPrefixFallback(): string {
  return path.join(HOME, ".npm-global");
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
  // EACCES 회피: 시스템 전역 prefix(/usr/local 등)가 사용자 쓰기 불가면
  // sudo 를 요구하는 대신 사용자 홈의 ~/.npm-global prefix 로 설치한다.
  // 그 bin 은 enriched PATH 에 이미 있어 감지·스폰이 그대로 동작한다.
  const globalPrefix = await getNpmGlobalPrefix();
  const prefixArgs =
    globalPrefix && !isNpmPrefixWritable(globalPrefix)
      ? ["--prefix", userNpmPrefixFallback()]
      : [];
  if (prefixArgs.length) {
    console.log(
      `[harness] npm global prefix not writable (${globalPrefix}) — ` +
        `falling back to --prefix ${userNpmPrefixFallback()}`,
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
      ...prefixArgs,
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
 * Human-runnable install command for a catalog CLI, derived from the same
 * `install` strategy `installPackage` executes (single source of truth).
 * Platform-aware: win32 gets the vendor's PowerShell one-liner when one
 * exists, and an honest "unsupported" note when it doesn't.
 */
export function officialInstallCommand(catalogId: string): string {
  const pkg = CATALOG.find((p) => p.id === catalogId);
  const install = pkg?.install;
  if (!install) return `unknown package: ${catalogId}`;
  if (install.kind === "npm-global") {
    return `npm install -g ${install.source}`;
  }
  if (process.platform === "win32") {
    return install.winSource
      ? `irm ${install.winSource} | iex`
      : `이 CLI는 Windows용 공식 인스톨러가 없습니다 — 공식 설치 안내 참고: ${
          pkg.url ?? install.source
        }`;
  }
  return `curl -fsSL ${install.source} | bash`;
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
        action: officialInstallCommand("cli-claude-code"),
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
        action: officialInstallCommand("cli-codex"),
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
        action: officialInstallCommand("cli-grok"),
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
        action: officialInstallCommand("cli-antigravity"),
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
// leaving a dead PTY with no explanation). Only claude/codex/grok are gated —
// gemini/antigravity/custom/local have no probe, so they pass through
// unchanged (backstopped by looksLikeLoginScreen at the readiness loop).
//
// ★인증 축은 하네스가 아니라 **핀된 모델**이 정한다. env-swap 벤더(GLM/MiniMax/
// Kimi)는 우리 claude 바이너리로 뜨지만 붙는 곳은 Anthropic 이 아니므로, 그 스폰의
// 준비 여부는 Anthropic 계정이 아니라 벤더 크레덴셜이 답한다(`envSwapSpawn`).

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
  reason?: "not-installed" | "not-authenticated" | "vendor-not-configured";
  /**
   * env-swap 벤더로 판정했을 때 그 벤더 id(zai/minimax/moonshot). 이 필드가 있으면
   * 인증 축은 **Anthropic 계정이 아니라 벤더 크레덴셜**이었다는 뜻이다.
   */
  vendor?: string;
  /** 아직 설정되지 않은 벤더 시크릿 env **키 이름**들(값은 절대 담지 않는다). */
  missingEnvKeys?: string[];
}

/**
 * ★스폰이 게이트에서 막힌 순간의 **비식별** 관측치 (티켓 9dXgBdkGn1LyJokShh1g).
 *
 * 온램프 스파이크 두 건(#883/#885)의 공통 결론이 "무료→유료 투자를 하기 전에
 * '구독/크레딧/인증이 없어 최초에 멈추는 유저'가 몇 명인지부터 세야 하는데 그
 * 이벤트가 텔레메트리에 **0건**이라 문제 크기를 모른다" 였다. 차단 판정은 전부
 * 이 함수 한 곳을 지나가므로, 관측도 여기 한 곳에 붙인다 — 호출부(agent:launch /
 * 오케 런치 / 오케 스위치)마다 흩뿌리면 새 호출부가 생길 때 조용히 빠진다.
 *
 * 관찰자 주입(observer)인 이유는 이 모듈이 electron 을 import 하지 않기 때문이다
 * (유닛 테스트가 fake home 으로 통째로 로드한다). main 이 부팅 때 한 번 꽂는다.
 */
export interface SpawnGateBlockedEvent {
  /** 어느 표면에서 막혔나(agent_launch / orchestrator_launch / orchestrator_switch). */
  surface: string;
  /** 스폰하려던 하네스(claude/gpt/grok/...). */
  model: string;
  /** 차단 사유 — SpawnAuthGate.reason 어휘 그대로. */
  reason: "not-installed" | "not-authenticated" | "vendor-not-configured";
  installed: boolean;
  /** env-swap 벤더 축이었으면 그 벤더 id. */
  vendor?: string;
  /**
   * 빠진 벤더 env 키의 **개수**. 키 이름도 값도 싣지 않는다 — 개수만으로
   * "벤더 설정 미완" 을 세기에 충분하고, 텔레메트리에 시크릿 축을 만들지 않는다.
   */
  missingEnvKeyCount?: number;
}

let spawnGateObserver: ((e: SpawnGateBlockedEvent) => void) | null = null;

/** 차단 관측자를 꽂는다(main 부팅 1회). null 로 해제. */
export function setSpawnGateObserver(
  fn: ((e: SpawnGateBlockedEvent) => void) | null,
): void {
  spawnGateObserver = fn;
}

function reportSpawnGateBlocked(e: SpawnGateBlockedEvent): void {
  try {
    spawnGateObserver?.(e);
  } catch {
    // 관측이 스폰 판정을 깨뜨려서는 안 된다.
  }
}

/**
 * ★게이트 **통과** 관측 (티켓 Tw6m14gR).
 *
 * 사장님 결정으로 "10분 안에 첫 multi-agent 성공" 의 시계가 first_run 이 아니라
 * **모델 연결 완료 시점**부터가 됐다. 그 "연결 완료" 의 코드상 정의가 바로 이
 * 게이트의 통과다 — 바이너리가 있고 인증이 됐거나(또는 env-swap 벤더 키가 전부
 * 준비돼) **지금 스폰이 가능한 상태**. 종전에는 거절만 관측했으므로 그 순간이
 * 데이터에 없었다.
 *
 * 상시 발신이다 — 설치당 1회로 접는 일은 렌더러가 한다(one-shot 마커가
 * localStorage 라 거기에만 있다. first_conversation 과 같은 분업).
 */
export interface SpawnGatePassedEvent {
  /** 어느 표면에서 통과했나(agent_launch / orchestrator_launch / ...). */
  surface: string;
  /** 스폰하려던 하네스(claude/gpt/grok/...). */
  model: string;
  /** env-swap 벤더 축으로 통과했으면 그 벤더 id. */
  vendor?: string;
  /** CLI 인증 축이 없는 하네스(로컬 모델 등)라 프로브 없이 통과했나. */
  noAuthAxis?: boolean;
}

let spawnGatePassedObserver: ((e: SpawnGatePassedEvent) => void) | null = null;

/** 통과 관측자를 꽂는다(main 부팅 1회). null 로 해제. */
export function setSpawnGatePassedObserver(
  fn: ((e: SpawnGatePassedEvent) => void) | null,
): void {
  spawnGatePassedObserver = fn;
}

function reportSpawnGatePassed(e: SpawnGatePassedEvent): void {
  try {
    spawnGatePassedObserver?.(e);
  } catch {
    // 관측이 스폰 판정을 깨뜨려서는 안 된다(차단 쪽과 같은 규율).
  }
}

/** 이 스폰이 env-swap 벤더로 붙는가 — 붙는다면 그 크레덴셜 준비 상태. */
interface EnvSwapSpawn {
  vendor: string;
  ready: boolean;
  /** 값이 아니라 키 **이름**들. */
  missingEnvKeys: string[];
  requiredEnvKeys: string[];
}

/**
 * 이 launch 의 **핀된 모델**이 env-swap 벤더 행인지 판정한다(GLM/MiniMax/Kimi).
 *
 * env-swap 벤더는 우리 `claude` 바이너리를 그대로 스폰하고 백엔드만 env 로 바꾼다
 * (`agent-config.applyVendorEnv`). 그래서 하네스만 보면 전부 "claude" 로 보이고,
 * 종전 게이트는 그 스폰을 **Anthropic 계정 프로브**로 판정했다 — Claude 계정이
 * 없는 BYOM 유저는 벤더 키를 다 넣고도 스폰조차 못 했다. 인증 축이 틀렸던 것이다.
 *
 * 핀이 없거나(=하네스 기본 모델) 네이티브 벤더 행이면 null 을 돌려 **종전 경로**로
 * 보낸다(기존 Anthropic/OpenAI 유저 회귀 0).
 */
function envSwapSpawn(
  harness: string,
  pinnedModelId?: string,
): EnvSwapSpawn | null {
  if (!pinnedModelId) return null;
  const readiness = vendorEnvReadiness(pinnedModelId);
  // hasProfile=false → 네이티브 CLI 로그인으로 붙는 행. 종전 프로브 그대로.
  if (!readiness.hasProfile) return null;
  // 하네스가 어긋난 핀은 스폰 쪽(`agent:launch` 의 pinApplies, getLaunchConfig)이
  // 이미 버린다. 게이트만 그 핀을 믿으면 "인증은 통과했는데 스폰은 다른 벤더로"
  // 라는 어긋남이 생기므로 여기서도 똑같이 버린다.
  const pinHarness = harnessForModel(pinnedModelId);
  const spawnHarness = harness === "codex" ? "gpt" : harness;
  if (pinHarness !== spawnHarness) {
    console.warn(
      `[spawn-gate] 모델 핀 "${pinnedModelId}"(harness=${
        pinHarness ?? "미지"
      })이 스폰 하네스 "${spawnHarness}" 와 어긋나 벤더 판정에서 제외합니다`,
    );
    return null;
  }
  return {
    vendor: readiness.vendor ?? "unknown",
    ready: readiness.ready,
    missingEnvKeys: readiness.missingEnvKeys,
    requiredEnvKeys: readiness.requiredEnvKeys,
  };
}

/**
 * Live-probe whether it's safe to spawn `model`. Non-interactive and fast
 * (delegates to probeCliAuth). Ungated models short-circuit to ok:true.
 *
 * @param pinnedModelId 이 launch 가 실제로 쓰는 구체 모델 id(`agent-config` 의
 *   `applyVendorEnv` 에 가는 값과 **같은 값**이어야 한다). 이 값이 env-swap 벤더
 *   행이면 인증 축이 벤더 크레덴셜로 바뀐다:
 *
 *     - 준비됨(전 키 존재)  → **Anthropic 계정 프로브를 건너뛰고 통과**. BYOM 유저가
 *       Claude 계정 없이 첫 티켓을 스폰할 수 있게 하는 관문이다.
 *     - 미준비(키 하나라도 없음) → 차단. 부분 주입 금지(전부-아니면-전무) 때문에
 *       그대로 두면 우리 Anthropic 크레덴셜을 든 claude 가 `--model glm-4.7` 로
 *       Anthropic 에 붙는다 — 조용한 쿼터 소모 + "왜 인증이 안 되지" 오독이다.
 *       여기서 막고 **어떤 키가 비었는지**(이름만) 돌려주는 편이 정직하다.
 *
 *   ★바이너리 설치 검사는 어느 경우에도 건너뛰지 않는다 — env-swap 벤더도 결국
 *   우리 `claude` 바이너리로 뜨기 때문이다.
 */
export async function checkSpawnAuthGate(
  model: string,
  pinnedModelId?: string,
  /** 관측용 표면 라벨(텔레메트리에만 쓰인다 — 판정에는 영향 없음). */
  surface = "unknown",
): Promise<SpawnAuthGate> {
  const cliModel = modelToCliAuth(model);
  if (!cliModel) {
    // CLI 인증 축이 없는 하네스(로컬 모델 등) — 프로브 없이 스폰 가능하다.
    // 그것도 "지금 돌릴 수 있다" 이므로 연결 앵커로 센다.
    reportSpawnGatePassed({ surface, model, noAuthAxis: true });
    return { ok: true, model: null, installed: true, authenticated: true };
  }
  const vendorSpawn = envSwapSpawn(model, pinnedModelId);
  const r = await probeCliAuth(cliModel);
  if (!r.installed) {
    reportSpawnGateBlocked({
      surface,
      model,
      reason: "not-installed",
      installed: false,
      ...(vendorSpawn ? { vendor: vendorSpawn.vendor } : {}),
    });
    return {
      ok: false,
      model: cliModel,
      installed: false,
      authenticated: false,
      action: r.action,
      reason: "not-installed",
      ...(vendorSpawn ? { vendor: vendorSpawn.vendor } : {}),
    };
  }
  if (vendorSpawn) {
    if (vendorSpawn.ready) {
      // ★BYOM(env-swap) 경로는 우리 연결 마법사도 funding 프로브도 거치지
      // 않는다 — 이 통과 관측이 없으면 그 유저는 '연결한 적 없는 설치'로
      // 남아 10분 KPI 분모에서 통째로 빠진다.
      reportSpawnGatePassed({ surface, model, vendor: vendorSpawn.vendor });
      return {
        ok: true,
        model: cliModel,
        installed: true,
        authenticated: true,
        vendor: vendorSpawn.vendor,
      };
    }
    reportSpawnGateBlocked({
      surface,
      model,
      reason: "vendor-not-configured",
      installed: true,
      vendor: vendorSpawn.vendor,
      missingEnvKeyCount: vendorSpawn.missingEnvKeys.length,
    });
    return {
      ok: false,
      model: cliModel,
      installed: true,
      authenticated: false,
      // 키 **이름**만 노출한다(값 금지 — 스킬 §시크릿 출력 금지).
      action: `설정 → 벤더 키에 ${vendorSpawn.missingEnvKeys.join(", ")} 등록`,
      reason: "vendor-not-configured",
      vendor: vendorSpawn.vendor,
      missingEnvKeys: vendorSpawn.missingEnvKeys,
    };
  }
  if (!r.authenticated) {
    reportSpawnGateBlocked({
      surface,
      model,
      reason: "not-authenticated",
      installed: true,
    });
    return {
      ok: false,
      model: cliModel,
      installed: true,
      authenticated: false,
      action: r.action,
      reason: "not-authenticated",
    };
  }
  reportSpawnGatePassed({ surface, model });
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
// ★불변식 — 이 배열의 패턴은 **하나의 연속된 문구**만 담는다. 임의 텍스트를 건너뛰는
// `.*` / `.+` 브리지는 금지다(구조 불변식 테스트가 강제한다).
//
// 이유는 라이브 실측이다(grok 1.0.0, 2026-08-08): 전면 TUI 가 뱉는 PTY 바이트에는
// **개행이 없다** — 130,177 바이트 캡처에 `\n` 이 1개, `\r` 은 0개였다. TUI 는 줄바꿈
// 대신 `ESC[row;colH` 커서 이동으로 화면을 그리기 때문이다. 그래서 이 버퍼에서 `.` 은
// 화면 전체를 가로지른다: `A.*B` 는 "A 와 B 가 같은 줄" 이 아니라 "4KB 창 어딘가에 A 가
// 있고 그 뒤 어딘가에 B 가 있다" 는 뜻이 된다. 화면 어딘가에 상주하는 헤더/푸터 문구를
// 앞부분에 두면 사실상 항상 매칭되는 패턴이 만들어진다(아래 grok 사례).
export const LOGIN_SCREEN_PATTERNS: RegExp[] = [
  /Sign in with ChatGPT/i, // codex login menu
  /Welcome to Codex/i, // codex first-run when logged out
  // codex 0.149.0 OAuth wait screen (라이브 캡처): 로그인 메뉴에서 넘어간 뒤
  // 브라우저 승인을 기다리는 화면이다. 메뉴 문구가 사라진 뒤에도 CLI 는 여전히
  // 멈춰 있으므로 이 문구가 없으면 그 구간이 "로그인 화면 아님" 으로 읽힌다.
  /Finish signing in via your browser/i,
  /Provide (an )?API key/i, // codex/claude API-key entry
  /Device Code/i, // codex device-code login
  /Select login method/i, // claude login menu
  /Log ?in (with|to) (your )?(Claude|Anthropic)/i, // claude login
  /Claude account with subscription/i, // claude login option
  /Anthropic Console account/i, // claude login option
  // ── Grok Build 1.0.0 ────────────────────────────────────────────
  // 종전엔 `/Grok Build.*(login|auth)/i` 하나였고, 그 패턴은 **양방향으로** 틀렸다:
  //
  //   ① 오탐 — "Grok Build" 는 로그인 화면 문구가 아니라 minimal 모드의 **준비 상태
  //      푸터**에 상주한다("Grok Build  v1.0.0 … Model … /help for commands").
  //      개행 없는 TUI 버퍼에서 `.*` 가 화면 전체를 가로지르므로, 그 뒤 어딘가에
  //      "auth"/"login" 부분문자열이 한 번이라도 있으면(MCP 패널의 "needs auth",
  //      "authenticated", 경로·파일명 …) 준비된 grok 이 로그인 화면으로 판정됐다.
  //   ② 미탐 — 정작 grok 1.0.0 의 **진짜** 로그인 화면에는 "Grok Build" 가 없다.
  //      라이브 device-code 로그인 화면 130KB 캡처를 감지기에 넣으면 매칭이 0 이었다
  //      (looksLikeLoginScreen=false) — 진짜 미인증 grok 을 못 잡고 blind fallback 이
  //      로그인 화면에 지시문을 타이핑했다.
  //
  // 아래는 그 캡처(★)와 grok 1.0.0 바이너리 문자열표(☆)로 확인한 실문구다.
  /Approve in your browser to finish signing in/i, // ★ device-code 승인 화면
  /Make sure your browser shows this code/i, // ★ 같은 화면
  /Waiting for approval\.{3}/i, // ★ 같은 화면 하단
  /Copying not working\? Click here to show full URL/i, // ★ 같은 화면 하단
  /Open this URL in your browser to approve/i, // ☆ device-code (full 렌더)
  /Opening your browser to sign in/i, // ☆ loopback OAuth 진입
  /Sign in to Grok/i, // ☆ 로그인 화면 제목
  /Login with grok\.com/i, // ☆ 웰컴 화면 버튼(기본 프로바이더 라벨)
  /A browser window will open for authentication/i, // ☆ 로그인 안내
  /Waiting for login to complete/i, // ☆ 로그인 대기
  /Waiting for auth URL/i, // ☆ 로그인 URL 대기
  /Paste your token here/i, // ☆ 토큰 수동 입력
  // grok 1.0.0 바이너리에는 이 렌더 문구가 없다(0.2.x 잔재로 보인다). 구버전·롤백
  // 대비로 남기지만, `.*` 브리지가 없어 오탐 표면이 없다.
  /Sign in with (Grok|xAI|X)\b/i, // grok browser auth (구버전 방어)
  // Antigravity (agy) / gemini OAuth flow — the CLI blocks on a browser
  // sign-in spinner. Distinctive to the auth handshake, so it won't trip on
  // ordinary boot output. Lets the readiness backstop suppress blind typing
  // for an unauthenticated agy spawn even though agy is ungated pre-spawn.
  /Waiting for authentication/i, // agy/gemini OAuth spinner
  /Sign in with Google/i, // agy/gemini login
  /How would you like to authenticate/i, // gemini auth-type dialog
];

/**
 * ★약한 신호 — 로그인 '화면'이 아니라 인증 '안내/전이'에서도 지나가듯 뜨는 문구들.
 *
 * grok 부팅이 대표 사례다: **정상 인증된** grok 도 부팅 중 인증 방법 안내로
 * `Browser OIDC` 를 뱉고, 토큰을 갱신하는 순간 `You are not authenticated` 를 한 번
 * 출력한 뒤 곧바로 준비 상태로 넘어간다. 이 문구들만으로 즉시 needsAuth 를 때리면
 * 정상 사용자에게 매 스폰 인증 팝업이 뜬다(이 티켓의 진범).
 *
 * 그래서 이 패턴들은 **혼자서는 판정하지 못한다** — 같은 버퍼에 로그인 '메뉴' 맥락
 * (선택지 나열·"Select login method"·화살표 안내 등)이 함께 있을 때만 로그인 화면으로
 * 친다. 맥락 없이 스쳐 지나간 매칭은 백스톱의 grace 창(createLoginScreenBackstop)이
 * readiness 도달 여부로 최종 판정한다.
 *
 * ★버전 주석(2026-08-08, grok 1.0.0 바이너리 문자열표 실측): 아래 셋 중 실제로
 * 존재하는 렌더 문구는 "You are not authenticated." 뿐이고, 그나마 TUI 가 아니라
 * `grok models` 같은 **비-TUI 상태 출력**의 문구다. "Browser OIDC" 와 "Log in with
 * Grok/xAI" 는 1.0.0 바이너리에 0회 — 0.2.x 시절 문구로 보인다. 약한 신호라 혼자서는
 * 발화하지 못하므로 구버전 방어용으로 남긴다.
 */
export const AMBIGUOUS_LOGIN_PATTERNS: RegExp[] = [
  /You are not authenticated\.?/i, // grok: 토큰 갱신 중에도 스쳐 지나간다
  /Browser OIDC/i, // grok 0.2.x: 인증 '방법' 안내 문구 (1.0.0 에는 없음)
  /Log ?in (with|to) (your )?(Grok|xAI|X account)/i, // grok 0.2.x login 안내문
];

/**
 * 로그인 '메뉴' 맥락 — 사용자의 선택을 기다리며 CLI 가 **멈춰 있다**는 신호.
 * 약한 신호를 확정으로 승격시키는 조건이며, 준비된 CLI 의 입력 프롬프트에는
 * 나타나지 않는 표현만 담는다.
 */
const LOGIN_MENU_CONTEXT_PATTERNS: RegExp[] = [
  /select (a |an |your )?(login|sign[- ]?in|auth\w*)/i,
  /(login|sign[- ]?in|auth\w*) method/i,
  /use (the )?arrow keys/i,
  /press enter to (continue|select|sign)/i,
  // 번호가 매겨진 선택지가 둘 이상 — 메뉴가 열려 있다는 뜻.
  // ※ 이 패턴은 개행이 있는 라인 지향 CLI(claude/codex login)에서만 동작한다.
  //   전면 TUI(grok 1.0.0 등)의 PTY 바이트에는 개행이 사실상 없어서(라이브 실측:
  //   130KB 중 `\n` 1개) 여기서 승격이 일어날 일이 없다 — TUI 하네스는 약한 신호
  //   대신 위 LOGIN_SCREEN_PATTERNS 의 실문구로 잡아야 한다.
  /^\s*\d[.)]\s+\S.*\r?\n(?:.*\r?\n){0,3}?\s*\d[.)]\s+\S/m,
];

/** 이 버퍼가 선택을 기다리는 로그인 **메뉴**로 보이는가. */
export function looksLikeLoginMenu(buffer: string): boolean {
  return LOGIN_MENU_CONTEXT_PATTERNS.some((re) => re.test(buffer));
}

/** Whether freshly-booted CLI output looks like an interactive login prompt. */
export function looksLikeLoginScreen(buffer: string): boolean {
  if (LOGIN_SCREEN_PATTERNS.some((re) => re.test(buffer))) return true;
  // 약한 신호는 로그인 메뉴 맥락이 함께 있을 때만 확정으로 친다.
  return (
    AMBIGUOUS_LOGIN_PATTERNS.some((re) => re.test(buffer)) &&
    looksLikeLoginMenu(buffer)
  );
}

// ── Login-screen backstop reconciler ───────────────────────────────
//
// 종전 백스톱은 **패턴 1회 매칭 = 즉시 needsAuth 래치**였다. readiness 도달 여부도,
// 스폰 직전 probe 결과도 다시 보지 않았기 때문에 정상 인증된 grok 이 부팅 중 뱉는
// 인증 안내 문구 하나로 인증 팝업이 떴고, 그 래치가 프롬프트 주입까지 막았다.
//
// 이 조정기(reconciler)는 같은 매칭을 **두 축**으로 다시 본다:
//
//   ① 사전 probe   — 스폰 직전 `probeCliAuth` 가 authenticated:true 라고 했나?
//                    그렇다면 이 매칭은 오탐일 가능성이 크므로 grace 창을 연다.
//                    false(또는 probe 자체가 없는 모델)면 종전대로 즉시 발화한다
//                    — 진짜 미인증 회귀 가드.
//   ② readiness   — grace 창 안에 CLI 가 준비 상태에 도달하면 그 매칭은 transient
//                    였다고 확정하고 발화하지 않는다. grace 가 끝났는데도 로그인
//                    화면이 **여전히** 버퍼에 남아 있을 때만 발화한다("지속/반복").
//
// 발화한 뒤에라도 readiness 에 도달하면 `onResolved` 로 **철회**한다(agent-manager 가
// `agent:authResolved` 로 렌더러에 알려 팝업을 닫는다).
export type LoginBackstopFireReason =
  | "no-probe" // 프로브가 없는 모델(agy 등) — 종전 동작 유지
  | "probe-unauthenticated" // 사전 probe 가 미인증이라고 답했다
  | "grace-expired"; // probe=authed 였지만 grace 안에 readiness 없음 + 로그인 화면 지속

/** grace 창 기본값. 에이전트 blind-fallback(10s)보다 **짧아야** 한다. */
export const LOGIN_BACKSTOP_GRACE_MS = 7_000;

export interface LoginScreenBackstopOptions {
  /**
   * 이 모델에 사전 auth probe 가 존재하나(claude/gpt/grok=true, agy 처럼 프로브가
   * 없는 모델=false). false 면 grace 없이 종전대로 즉시 발화한다.
   */
  hasProbe: boolean;
  /** probe 결과. 아직 도착 전이면 null — 도착 전 매칭은 grace 로 취급한다. */
  preProbeAuthenticated?: boolean | null;
  graceMs?: number;
  /** 실제 needsAuth 발화. */
  onNeedsAuth: (reason: LoginBackstopFireReason) => void;
  /** 발화했던 판정을 철회(오탐 확정). */
  onResolved?: () => void;
  /** 발화를 grace 로 미룬 순간(관측용). */
  onGrace?: (graceMs: number) => void;
}

/** observe() 가 돌려주는 현재 판정. */
export type LoginBackstopState =
  | "clear" // 로그인 신호 없음 — 평소 부팅 경로
  | "hold" // 로그인 신호는 봤지만 grace 로 판정 보류 — 주입성 키 입력은 금지
  | "blocked"; // needsAuth 발화됨

export interface LoginScreenBackstop {
  /** 새 PTY 버퍼를 평가한다. 호출자는 "clear" 가 아니면 대화형 키 입력을 멈춘다. */
  observe(buffer: string): LoginBackstopState;
  /** CLI 가 readiness 에 도달했다. @returns 발화했던 판정을 철회했으면 true. */
  noteReadiness(): boolean;
  /** 사전 probe 결과가 늦게 도착했을 때 주입. */
  setPreProbeAuthenticated(authenticated: boolean): void;
  /** 현재 판정(로그/테스트용). */
  state(): LoginBackstopState;
  /** 타이머 정리 — 프롬프트 전송/PTY 종료 시. */
  dispose(): void;
}

export function createLoginScreenBackstop(
  opts: LoginScreenBackstopOptions,
): LoginScreenBackstop {
  const graceMs = opts.graceMs ?? LOGIN_BACKSTOP_GRACE_MS;
  let preProbe: boolean | null = opts.preProbeAuthenticated ?? null;
  let fired = false;
  let settled = false; // readiness 도달 — 더는 로그인 판정을 하지 않는다
  let graceTimer: ReturnType<typeof setTimeout> | null = null;
  let lastBuffer = "";

  const clearGrace = (): void => {
    if (graceTimer) {
      clearTimeout(graceTimer);
      graceTimer = null;
    }
  };

  const fire = (reason: LoginBackstopFireReason): void => {
    if (fired || settled) return;
    clearGrace();
    fired = true;
    opts.onNeedsAuth(reason);
  };

  const armGrace = (): void => {
    if (graceTimer) return;
    graceTimer = setTimeout(() => {
      graceTimer = null;
      // "지속/반복" 확인: grace 가 끝난 시점에도 로그인 화면이 여전히 보일 때만
      // 발화한다. 스쳐 지나간 문구(버퍼에서 이미 밀려남)는 여기서 조용히 소멸하고,
      // 호출자의 blind-fallback 이 종전대로 프롬프트를 넣는다.
      if (looksLikeLoginScreen(lastBuffer)) fire("grace-expired");
    }, graceMs);
    opts.onGrace?.(graceMs);
  };

  return {
    observe(buffer: string): LoginBackstopState {
      lastBuffer = buffer;
      if (settled) return "clear";
      if (fired) return "blocked";
      if (!looksLikeLoginScreen(buffer)) {
        return graceTimer ? "hold" : "clear";
      }
      if (!opts.hasProbe) {
        fire("no-probe");
        return "blocked";
      }
      if (preProbe === false) {
        fire("probe-unauthenticated");
        return "blocked";
      }
      // preProbe === true(인증됨) 또는 null(아직 미도착) → 판정 보류.
      armGrace();
      return "hold";
    },
    noteReadiness(): boolean {
      if (settled) return false;
      settled = true;
      clearGrace();
      if (!fired) return false;
      fired = false;
      opts.onResolved?.();
      return true;
    },
    setPreProbeAuthenticated(authenticated: boolean): void {
      preProbe = authenticated;
      // 보류 중인데 probe 가 "미인증"으로 답했다면 더 기다릴 이유가 없다.
      if (!authenticated && graceTimer && looksLikeLoginScreen(lastBuffer)) {
        fire("probe-unauthenticated");
      }
    },
    state(): LoginBackstopState {
      if (settled) return "clear";
      if (fired) return "blocked";
      return graceTimer ? "hold" : "clear";
    },
    dispose(): void {
      clearGrace();
    },
  };
}
