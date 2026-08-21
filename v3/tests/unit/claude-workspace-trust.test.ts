/**
 * ═══════════════════════════════════════════════════════════════════════════
 * CLAUDE FOLDER TRUST — pre-emption, against a REAL config file
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Everything here runs against a throwaway HOME and a throwaway git repo. The
 * user's `~/.claude.json` is never read and never written: `CLAUDE_CONFIG_DIR`
 * is repointed for the duration of each test, and claudeGlobalConfigPath()
 * reads it lazily (not at module load) precisely so that repointing works.
 *
 * The behaviours worth pinning are the ones whose failure is SILENT:
 *   · a key shape claude would not look up  → dialog still appears, boot stalls
 *   · a read-modify-write that loses fields → someone's account/history gone
 *   · a lock we ignore                      → a live session's file clobbered
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { execFileSync } from "child_process";
import {
  claudeGlobalConfigPath,
  claudeTrustKeyCandidates,
  claudeTrustResolves,
  ensureClaudeFolderTrust,
} from "../../electron/claude-workspace-trust";

let home: string;
let prevConfigDir: string | undefined;

function configPath(): string {
  return path.join(home, ".claude.json");
}
function readConfig(): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(configPath(), "utf8")) as Record<
    string,
    unknown
  >;
}
function trustedKeys(): string[] {
  const projects = (readConfig().projects ?? {}) as Record<
    string,
    { hasTrustDialogAccepted?: boolean }
  >;
  return Object.entries(projects)
    .filter(([, v]) => v.hasTrustDialogAccepted === true)
    .map(([k]) => k);
}

beforeEach(() => {
  home = fs.mkdtempSync(path.join(os.tmpdir(), "mb-trust-"));
  prevConfigDir = process.env.CLAUDE_CONFIG_DIR;
  // CLAUDE_CONFIG_DIR is claude's own override and is what keeps this suite off
  // the real file — the fallback branch resolves to `<dir>/.claude.json`.
  process.env.CLAUDE_CONFIG_DIR = home;
});

afterEach(() => {
  if (prevConfigDir === undefined) delete process.env.CLAUDE_CONFIG_DIR;
  else process.env.CLAUDE_CONFIG_DIR = prevConfigDir;
  fs.rmSync(home, { recursive: true, force: true });
});

describe("where claude keeps its global config", () => {
  it("honours CLAUDE_CONFIG_DIR", () => {
    expect(claudeGlobalConfigPath()).toBe(path.join(home, ".claude.json"));
  });

  it("prefers a legacy <configDir>/.config.json when it exists", () => {
    // claude checks this first (`qo_`); missing it would write the trust entry
    // into a file the CLI never reads — a silent no-op.
    const legacy = path.join(home, ".config.json");
    fs.writeFileSync(legacy, "{}");
    expect(claudeGlobalConfigPath()).toBe(legacy);
  });
});

describe("the key a directory resolves to", () => {
  it("records the plain resolved path for an ordinary directory", () => {
    const dir = fs.mkdtempSync(path.join(home, "plain-"));
    expect(claudeTrustKeyCandidates(dir)).toContain(fs.realpathSync(dir));
  });

  it("★folds a linked git worktree onto its main repository root", () => {
    // This is the case that matters: every Marblo worker runs in a worktree,
    // and claude's key derivation follows `.git` → gitdir → commondir back to
    // the main root. Writing only the worktree path would leave the dialog up.
    const repo = path.join(home, "repo");
    fs.mkdirSync(repo);
    const git = (...args: string[]) =>
      execFileSync("git", args, {
        cwd: repo,
        env: {
          ...process.env,
          GIT_CONFIG_GLOBAL: "/dev/null",
          GIT_CONFIG_SYSTEM: "/dev/null",
          GIT_AUTHOR_NAME: "t",
          GIT_AUTHOR_EMAIL: "t@t",
          GIT_COMMITTER_NAME: "t",
          GIT_COMMITTER_EMAIL: "t@t",
        },
        stdio: "ignore",
      });
    git("init", "-q", "-b", "main");
    fs.writeFileSync(path.join(repo, "f"), "x");
    git("add", "f");
    git("commit", "-qm", "init");
    const wt = path.join(home, "wt");
    git("worktree", "add", "-q", wt);

    const keys = claudeTrustKeyCandidates(wt);
    expect(keys).toContain(fs.realpathSync(wt));
    expect(keys).toContain(fs.realpathSync(repo));

    // And the whole point: trusting the worktree makes the worktree trusted.
    expect(ensureClaudeFolderTrust(wt).ok).toBe(true);
    expect(claudeTrustResolves(readConfig(), wt)).toBe(true);
  });
});

describe("ancestor inheritance matches claude's own walk", () => {
  it("inherits from a parent directory", () => {
    const parent = fs.mkdtempSync(path.join(home, "p-"));
    const child = path.join(parent, "a", "b");
    fs.mkdirSync(child, { recursive: true });
    const config = {
      projects: { [path.resolve(parent)]: { hasTrustDialogAccepted: true } },
    };
    expect(claudeTrustResolves(config, child)).toBe(true);
  });

  it("★walks the same un-realpath'd path claude walks", () => {
    // claude's ancestor walk (`e3d`) starts at `resolve(cwd)` and never calls
    // realpath, so on macOS an entry written under /private/var does NOT cover
    // a cwd reached through /var. Reading this as "trusted" would make us SKIP
    // the write and hand the user the dialog anyway — so the check stays
    // conservative and the WRITE records both spellings instead.
    const parent = fs.mkdtempSync(path.join(home, "q-"));
    const child = path.join(parent, "a");
    fs.mkdirSync(child, { recursive: true });
    const real = fs.realpathSync(parent);
    if (real === path.resolve(parent)) return; // no symlinked tmp here
    const config = { projects: { [real]: { hasTrustDialogAccepted: true } } };
    expect(claudeTrustResolves(config, child)).toBe(false);
  });

  it("does NOT inherit from a sibling", () => {
    const base = fs.mkdtempSync(path.join(home, "s-"));
    fs.mkdirSync(path.join(base, "A"));
    fs.mkdirSync(path.join(base, "B"));
    const config = {
      projects: {
        [path.join(path.resolve(base), "A")]: {
          hasTrustDialogAccepted: true,
        },
      },
    };
    expect(claudeTrustResolves(config, path.join(base, "B"))).toBe(false);
  });

  it("treats a false flag as untrusted rather than as a present key", () => {
    const dir = fs.mkdtempSync(path.join(home, "f-"));
    const config = {
      projects: { [path.resolve(dir)]: { hasTrustDialogAccepted: false } },
    };
    expect(claudeTrustResolves(config, dir)).toBe(false);
  });
});

describe("ensureClaudeFolderTrust", () => {
  it("creates the entry when the directory is untrusted", () => {
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    const r = ensureClaudeFolderTrust(dir);
    expect(r.ok).toBe(true);
    expect(r.alreadyTrusted).toBe(false);
    expect(r.written.length).toBeGreaterThan(0);
    expect(trustedKeys()).toContain(fs.realpathSync(dir));
  });

  it("is idempotent — a second call writes nothing", () => {
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    ensureClaudeFolderTrust(dir);
    const before = fs.readFileSync(configPath(), "utf8");
    const r = ensureClaudeFolderTrust(dir);
    expect(r.alreadyTrusted).toBe(true);
    expect(r.written).toEqual([]);
    expect(fs.readFileSync(configPath(), "utf8")).toBe(before);
  });

  it("★preserves every other key in the config", () => {
    // The damage mode this guards: a read-modify-write that drops the user's
    // oauth account, MCP servers, or the other 45 project entries.
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    const other = path.join(home, "someone-elses-project");
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        numStartups: 41,
        oauthAccount: { accountUuid: "keep-me" },
        mcpServers: { marblo: { command: "node" } },
        projects: {
          [other]: { hasTrustDialogAccepted: true, allowedTools: ["Bash"] },
        },
      }),
    );
    ensureClaudeFolderTrust(dir);
    const after = readConfig();
    expect(after.numStartups).toBe(41);
    expect(after.oauthAccount).toEqual({ accountUuid: "keep-me" });
    expect(after.mcpServers).toEqual({ marblo: { command: "node" } });
    const projects = after.projects as Record<string, unknown>;
    expect(projects[other]).toEqual({
      hasTrustDialogAccepted: true,
      allowedTools: ["Bash"],
    });
    expect(trustedKeys()).toContain(fs.realpathSync(dir));
  });

  it("merges into an existing project entry instead of replacing it", () => {
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    fs.writeFileSync(
      configPath(),
      JSON.stringify({
        projects: {
          [fs.realpathSync(dir)]: {
            allowedTools: ["Read"],
            hasCompletedProjectOnboarding: true,
          },
        },
      }),
    );
    ensureClaudeFolderTrust(dir);
    const projects = readConfig().projects as Record<string, unknown>;
    expect(projects[fs.realpathSync(dir)]).toEqual({
      allowedTools: ["Read"],
      hasCompletedProjectOnboarding: true,
      hasTrustDialogAccepted: true,
    });
  });

  it("★refuses to write over a config it could not parse", () => {
    // An unparseable config is NOT an empty one. Writing `{}` here would be the
    // worst thing this module could possibly do to someone.
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    fs.writeFileSync(configPath(), "{ this is not json");
    const r = ensureClaudeFolderTrust(dir);
    expect(r.ok).toBe(false);
    expect(fs.readFileSync(configPath(), "utf8")).toBe("{ this is not json");
  });

  it("★backs off rather than clobbering a config another writer holds", () => {
    // claude locks the global config with a DIRECTORY at `<file>.lock`
    // (proper-lockfile). Ignoring it is how a live session loses its whole file.
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    fs.writeFileSync(configPath(), JSON.stringify({ numStartups: 7 }));
    fs.mkdirSync(`${configPath()}.lock`);
    try {
      const r = ensureClaudeFolderTrust(dir);
      expect(r.ok).toBe(false);
      expect(r.reason).toMatch(/lock/i);
      expect(readConfig()).toEqual({ numStartups: 7 });
    } finally {
      fs.rmdirSync(`${configPath()}.lock`);
    }
  });

  it("reaps a lock whose holder died and proceeds", () => {
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    const lock = `${configPath()}.lock`;
    fs.mkdirSync(lock);
    // proper-lockfile calls a lock stale at 10 s of untouched mtime.
    const old = new Date(Date.now() - 60_000);
    fs.utimesSync(lock, old, old);
    const r = ensureClaudeFolderTrust(dir);
    expect(r.ok).toBe(true);
    expect(trustedKeys()).toContain(fs.realpathSync(dir));
    expect(fs.existsSync(lock)).toBe(false);
  });

  it("releases the lock it took", () => {
    const dir = fs.mkdtempSync(path.join(home, "d-"));
    ensureClaudeFolderTrust(dir);
    expect(fs.existsSync(`${configPath()}.lock`)).toBe(false);
  });

  it("does nothing, safely, when handed no directory", () => {
    expect(ensureClaudeFolderTrust("").ok).toBe(false);
    expect(fs.existsSync(configPath())).toBe(false);
  });
});
