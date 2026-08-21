/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLAUDE FOLDER TRUST  —  pre-empted, not answered
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * A new Mac does not stall on the bypass-permissions consent screen. That one
 * is answered (agent-input-wait.ts) and it is recorded MACHINE-WIDE, so it
 * happens at most once per computer. The screen that comes back forever is the
 * other one:
 *
 *   bypass consent  →  ~/.claude/settings.json  skipDangerousModePermissionPrompt
 *                      ── once per MACHINE
 *   folder trust    →  ~/.claude.json  projects[<dir>].hasTrustDialogAccepted
 *                      ── once per DIRECTORY
 *
 * Live measurement (2026-08-21, claude 2.1.238, isolated HOME — see
 * docs/FIRST-RUN-BOOT-LIVE-VERIFICATION.md scenario 1b): the trust dialog is
 * correctly RECOGNISED by looksLikeFirstRunDialog and the boot prompt is held,
 * so we type nothing — which is safe and also terminal, because nobody answers
 * it. Boot never completes and the orchestrator gives up at 70.1 s.
 *
 * ── Why pre-empt instead of answering ──────────────────────────────────────
 * Codex has been pre-empted since agent-config.ts:3507 (`trust_level =
 * "trusted"` in the isolated CODEX_HOME's config.toml) and never renders its
 * dialog at all. Claude has an exact equivalent, and it is not a guess we are
 * making about someone's private file format — the CLI itself prints it as the
 * supported alternative when it drops project-scoped config for lack of trust:
 *
 *   "Run Claude Code interactively here once and accept the trust dialog, or
 *    set projects[<dir>].hasTrustDialogAccepted: true in <global config>."
 *
 * Pre-empting is strictly better than answering: no keystroke is ever produced,
 * so there is no screen to mis-identify and no `\r` that could land somewhere
 * else. (Answering is also worse than it looks. 2.1.238 renders the trust
 * dialog with `<sc confirmLabel="Yes, I trust this folder" …>` and NO `focus`
 * prop, and `sc` defaults to `focus: "confirm"` — so the default highlight is
 * `❯ 1. Yes, I trust this folder`, matching the live capture and contradicting
 * the old agent-manager comment that said "No". A stray `\r` there does not
 * kill the CLI; it silently ACCEPTS and swallows whatever was typed with it,
 * which is the quiet instruction loss recorded as F-2.)
 *
 * ── Which key ──────────────────────────────────────────────────────────────
 * Claude derives the key as `normalize(gitMainWorktreeRoot(dir) ?? NFC(resolve(dir)))`
 * — a LINKED GIT WORKTREE folds onto the main repository root, via the
 * `commondir` file next to its gitdir. Marblo runs its workers in exactly such
 * worktrees, so getting this wrong is not hypothetical. Rather than reproduce
 * a private normalisation exactly and silently no-op when it drifts, we write
 * every candidate the same way the codex side does (raw · realpath · git main
 * root), which is cheap, idempotent, and cannot miss.
 *
 * ── Concurrency ────────────────────────────────────────────────────────────
 * ★`~/.claude.json` is not ours. Every live Claude Code session rewrites it
 * (startup counts, project history), and it is ~240 KB on this machine. Claude
 * writes it under a `<config>.lock` directory lock (proper-lockfile: the lock
 * IS the directory, staleness by mtime), so a plain read-modify-write —
 * including harness-manager's writeClaudeJsonAtomic, which takes no lock —
 * can clobber a concurrent session's whole file. We honour that lock.
 *
 * The fast path takes no lock at all: if the directory already resolves as
 * trusted we return before touching anything, which is what happens on every
 * launch after the first in a given tree.
 */
import fs from "fs";
import os from "os";
import path from "path";

/** What `ensureClaudeFolderTrust` did, for logging and for the tests. */
export interface ClaudeTrustResult {
  /** false only when trust was missing AND we could not record it. */
  ok: boolean;
  /** Trust already resolved before we ran — nothing was written. */
  alreadyTrusted: boolean;
  /** Config keys we added. Empty when alreadyTrusted. */
  written: string[];
  /** Absolute path of the config file consulted. */
  configPath: string;
  /** Present when ok === false. Never contains config contents. */
  reason?: string;
}

interface ClaudeGlobalConfig {
  projects?: Record<string, { hasTrustDialogAccepted?: boolean } & object>;
  [key: string]: unknown;
}

/**
 * Where claude 2.1.238 keeps its global config, mirroring its own resolution:
 * a legacy `<configDir>/.config.json` wins if it exists, otherwise
 * `$CLAUDE_CONFIG_DIR || $HOME` + `.claude.json`.
 *
 * Read lazily (never cached at module load) so an isolated HOME — the live
 * harness, and any future test — is honoured rather than the real one.
 */
export function claudeGlobalConfigPath(): string {
  const configDir =
    process.env.CLAUDE_CONFIG_DIR || path.join(os.homedir(), ".claude");
  const legacy = path.join(configDir, ".config.json");
  try {
    if (fs.existsSync(legacy)) return legacy;
  } catch {
    // Unreadable config dir — fall through to the default location.
  }
  return path.join(
    process.env.CLAUDE_CONFIG_DIR || os.homedir(),
    ".claude.json",
  );
}

function safeRealpath(p: string): string | null {
  try {
    return fs.realpathSync(p);
  } catch {
    return null;
  }
}

/**
 * The main worktree root for `dir`, or null when `dir` is not inside a linked
 * git worktree. Mirrors claude's own resolution without spawning git: walk up
 * to the `.git` entry; when it is a FILE it holds `gitdir: <path>`, and that
 * directory's `commondir` points at the main repository's `.git`.
 */
function gitMainWorktreeRoot(dir: string): string | null {
  let cur = path.resolve(dir);
  for (let depth = 0; depth < 64; depth += 1) {
    const dotGit = path.join(cur, ".git");
    let stat: fs.Stats | null = null;
    try {
      stat = fs.statSync(dotGit);
    } catch {
      stat = null;
    }
    if (stat?.isDirectory()) return cur; // already the main worktree
    if (stat?.isFile()) {
      try {
        const raw = fs.readFileSync(dotGit, "utf-8").trim();
        if (!raw.startsWith("gitdir:")) return cur;
        const gitDir = path.resolve(cur, raw.slice("gitdir:".length).trim());
        const commonRaw = fs.readFileSync(
          path.join(gitDir, "commondir"),
          "utf-8",
        );
        const common = path.resolve(gitDir, commonRaw.trim());
        // `common` is the main repo's `.git`; its parent is the worktree root.
        return path.dirname(common);
      } catch {
        return cur;
      }
    }
    const parent = path.dirname(cur);
    if (parent === cur) return null;
    cur = parent;
  }
  return null;
}

/**
 * Every config key that could stand for `dir`. Order is stable so the log line
 * and the tests read the same way; duplicates are collapsed.
 */
export function claudeTrustKeyCandidates(dir: string): string[] {
  const resolved = path.resolve(dir);
  const candidates = [
    resolved,
    safeRealpath(resolved),
    gitMainWorktreeRoot(resolved),
  ];
  const out: string[] = [];
  for (const c of candidates) {
    if (!c) continue;
    // NFC + path.normalize is claude's own key shape (`Zu` ∘ `Rdt`).
    const key = path.normalize(c.normalize("NFC"));
    if (!out.includes(key)) out.push(key);
  }
  return out;
}

function readConfig(configPath: string): ClaudeGlobalConfig | null {
  try {
    if (!fs.existsSync(configPath)) return {};
    const parsed: unknown = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }
    return parsed as ClaudeGlobalConfig;
  } catch {
    // ★Unparseable is NOT "empty". Writing `{}` over a config we failed to read
    // would destroy the user's account, history and MCP entries — the exact
    // damage this module is supposed to avoid causing.
    return null;
  }
}

/**
 * Does `config` already grant trust for `dir`?
 *
 * Mirrors claude's `hNb`/`e3d`/`t3d`: an exact key match, or an ANCESTOR
 * directory that carries the flag — with the walk bounded by the git root,
 * because that is where claude stops. (This is why a `/` entry, which some
 * long-lived machines have, does not actually cover paths inside a repo.)
 */
export function claudeTrustResolves(
  config: ClaudeGlobalConfig,
  dir: string,
): boolean {
  const projects = config.projects;
  if (!projects) return false;
  const trusted = (key: string): boolean =>
    projects[key]?.hasTrustDialogAccepted === true;
  for (const key of claudeTrustKeyCandidates(dir)) {
    if (trusted(key)) return true;
  }
  const start = path.normalize(path.resolve(dir).normalize("NFC"));
  const gitRoot = gitMainWorktreeRoot(start);
  const boundary = gitRoot ? path.normalize(gitRoot.normalize("NFC")) : null;
  let cur = start;
  for (let depth = 0; depth < 128; depth += 1) {
    if (boundary !== null) {
      const withinBoundary =
        cur === boundary ||
        cur.startsWith(
          boundary.endsWith(path.sep) ? boundary : boundary + path.sep,
        );
      if (!withinBoundary) return false;
    }
    if (trusted(cur)) return true;
    if (cur === boundary) return false;
    const parent = path.normalize(path.resolve(cur, ".."));
    if (parent === cur) return false;
    cur = parent;
  }
  return false;
}

/** proper-lockfile's default staleness. A lock older than this is abandoned. */
const LOCK_STALE_MS = 10_000;
/** Total time we are willing to wait for another writer. */
const LOCK_WAIT_MS = 2_000;
const LOCK_POLL_MS = 25;

/**
 * Block the calling thread for `ms` without burning CPU.
 *
 * Sync on purpose: both launch() paths are synchronous and the spawn must not
 * race the write — an async write could land AFTER claude has already read the
 * config and drawn its dialog. The cost is bounded and, in the overwhelmingly
 * common case, never paid at all: the fast path returns before any locking
 * once the directory is trusted, which is every launch after the first.
 */
function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * Acquire claude's own config lock (proper-lockfile shape: the lock IS a
 * directory at `<file>.lock`, liveness is its mtime). Returns a release
 * function, or null if another writer held it for the whole wait.
 */
function acquireConfigLock(configPath: string): (() => void) | null {
  const lockPath = `${configPath}.lock`;
  const deadline = Date.now() + LOCK_WAIT_MS;
  let stealAttempted = false;
  for (;;) {
    try {
      fs.mkdirSync(lockPath);
      return () => {
        try {
          fs.rmdirSync(lockPath);
        } catch {
          // Already gone (someone reaped it as stale) — nothing to undo.
        }
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code !== "EEXIST") return null;
    }
    if (!stealAttempted) {
      // A holder that died leaves the directory behind forever. proper-lockfile
      // reaps it by mtime; do the same, once, so a crashed CLI cannot wedge us.
      try {
        const age = Date.now() - fs.statSync(lockPath).mtimeMs;
        if (age > LOCK_STALE_MS) {
          stealAttempted = true;
          fs.rmdirSync(lockPath);
          continue;
        }
      } catch {
        // Lock vanished between mkdir and stat — just retry.
      }
    }
    if (Date.now() >= deadline) return null;
    sleepSync(LOCK_POLL_MS);
  }
}

function writeConfigAtomic(configPath: string, data: ClaudeGlobalConfig): void {
  const tmp = `${configPath}.marblo-tmp-${process.pid}`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), "utf-8");
  fs.renameSync(tmp, configPath);
}

/**
 * Make sure claude will not render its folder-trust dialog for `dir`.
 *
 * Idempotent and synchronous — call it immediately before spawning a claude
 * PTY whose cwd is `dir`. Never throws: a failure here means the launch
 * proceeds exactly as it does today (dialog recognised, boot prompt held, no
 * keystroke), so the worst case is the status quo rather than a broken launch.
 */
export function ensureClaudeFolderTrust(dir: string): ClaudeTrustResult {
  const configPath = claudeGlobalConfigPath();
  const base: Omit<ClaudeTrustResult, "ok"> = {
    alreadyTrusted: false,
    written: [],
    configPath,
  };
  if (!dir) return { ...base, ok: false, reason: "no directory" };

  // Fast path — no lock, no write, no I/O beyond one read.
  const pre = readConfig(configPath);
  if (pre === null) {
    return {
      ...base,
      ok: false,
      reason: "global claude config is unreadable or not an object",
    };
  }
  if (claudeTrustResolves(pre, dir)) {
    return { ...base, ok: true, alreadyTrusted: true };
  }

  const release = acquireConfigLock(configPath);
  if (!release) {
    return {
      ...base,
      ok: false,
      reason: "another writer held the claude config lock",
    };
  }
  try {
    // Re-read INSIDE the lock: the holder we just waited out may have been a
    // session writing the very trust entry we are about to add.
    const config = readConfig(configPath);
    if (config === null) {
      return {
        ...base,
        ok: false,
        reason: "global claude config is unreadable or not an object",
      };
    }
    if (claudeTrustResolves(config, dir)) {
      return { ...base, ok: true, alreadyTrusted: true };
    }
    const projects = { ...(config.projects ?? {}) };
    const written: string[] = [];
    for (const key of claudeTrustKeyCandidates(dir)) {
      if (projects[key]?.hasTrustDialogAccepted === true) continue;
      // Merge, never replace: a project entry also carries allowedTools,
      // history and onboarding counters that are none of our business.
      projects[key] = {
        ...(projects[key] ?? {}),
        hasTrustDialogAccepted: true,
      };
      written.push(key);
    }
    if (written.length === 0)
      return { ...base, ok: true, alreadyTrusted: true };
    writeConfigAtomic(configPath, { ...config, projects });
    return { ...base, ok: true, written };
  } catch (err) {
    return {
      ...base,
      ok: false,
      reason: `write failed: ${(err as Error)?.message ?? "unknown"}`,
    };
  } finally {
    release();
  }
}
