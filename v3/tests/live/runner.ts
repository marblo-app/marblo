/**
 * One scenario per PROCESS — HOME has to be repointed before harness-manager
 * captures os.homedir() at module load, so scenarios cannot share a process.
 *
 *   node runner.mjs <scenario> <outfile>
 */
import fs from "fs";
import path from "path";
import os from "os";
import { runLive, report, mkHome, type RunResult } from "./harness";

const BASE = path.join(os.tmpdir(), "mb-firstrun-live");
fs.mkdirSync(BASE, { recursive: true });

function mkProject(name: string): string {
  const p = path.join(BASE, `proj-${name}`);
  fs.mkdirSync(p, { recursive: true });
  fs.writeFileSync(path.join(p, "README.md"), "# live boot probe\n");
  return p;
}

/** Reproduce what agent-config.ts writes into an isolated CODEX_HOME. */
function seedCodexHome(codexHome: string, projectDir: string, auth: boolean) {
  fs.mkdirSync(codexHome, { recursive: true });
  const real = fs.realpathSync(projectDir);
  const trust = [projectDir, real]
    .filter((v, i, a) => a.indexOf(v) === i)
    .map((d) => `[projects.${JSON.stringify(d)}]\ntrust_level = "trusted"\n`)
    .join("\n");
  // The orchestrator refuses to launch codex without [mcp_servers.marblo]
  // (assertCodexMarbloSurface). Point it at a no-op binary: we are verifying
  // BOOT, not the MCP surface, and this keeps the run off the real bridge.
  fs.writeFileSync(
    path.join(codexHome, "config.toml"),
    trust + '\n[mcp_servers.marblo]\ncommand = "/usr/bin/true"\nargs = []\n',
  );
  if (auth) {
    // Production symlinks the user's auth.json in (agent-config.ts ~3450).
    // A symlink is a READ of the real file — it is never written or moved.
    const userAuth = path.join(REAL_HOME, ".codex", "auth.json");
    if (fs.existsSync(userAuth)) {
      fs.symlinkSync(userAuth, path.join(codexHome, "auth.json"));
    }
  }
}

const REAL_HOME = process.env.HOME!;
const scenario = process.argv[2];
const outfile = process.argv[3];

async function main(): Promise<RunResult> {
  switch (scenario) {
    // ── 1. claude, VIRGIN home: theme picker → folder trust → bypass consent
    case "s1-claude-virgin": {
      const home = mkHome(BASE, "home-s1");
      const proj = mkProject("s1");
      return runLive({
        label: scenario,
        model: "claude",
        home,
        projectDir: proj,
        timeoutMs: 90_000,
      });
    }

    // ── 1b. claude, onboarding done (the fixture README's state)
    case "s1b-claude-onboarded": {
      const home = mkHome(BASE, "home-s1b");
      fs.writeFileSync(
        path.join(home, ".claude.json"),
        JSON.stringify({ hasCompletedOnboarding: true, theme: "dark" }),
      );
      const proj = mkProject("s1b");
      return runLive({
        label: scenario,
        model: "claude",
        home,
        projectDir: proj,
        timeoutMs: 90_000,
      });
    }

    // ── 1c. claude, folder ALREADY trusted, consent NOT yet accepted.
    //        This is the exact screen PR #1070 auto-accepts.
    case "s1c-claude-consent-only": {
      const home = path.join(BASE, "home-s1c");
      fs.rmSync(home, { recursive: true, force: true });
      fs.cpSync(path.join(BASE, "home-trust"), home, { recursive: true });
      // Re-arm the consent screen exactly the way the fixture README says:
      // delete skipDangerousModePermissionPrompt from .claude/settings.json.
      const st = path.join(home, ".claude", "settings.json");
      const cfg = JSON.parse(fs.readFileSync(st, "utf8")) as Record<
        string,
        unknown
      >;
      delete cfg.skipDangerousModePermissionPrompt;
      fs.writeFileSync(st, JSON.stringify(cfg));
      return runLive({
        label: scenario,
        model: "claude",
        home,
        projectDir: path.join(BASE, "trust-dirA"),
        timeoutMs: 60_000,
      });
    }

    // ── 2. claude, RETURNING user: trusted dir + consent already accepted
    case "s2-claude-returning": {
      const home = path.join(BASE, "home-s2");
      fs.rmSync(home, { recursive: true, force: true });
      fs.cpSync(path.join(BASE, "home-trust"), home, { recursive: true });
      return runLive({
        label: scenario,
        model: "claude",
        home,
        projectDir: path.join(BASE, "trust-dirA"),
        timeoutMs: 60_000,
      });
    }

    // ── 3. codex, AUTHENTICATED
    case "s3-codex-authed": {
      const home = mkHome(BASE, "home-s3");
      // probeCliAuth reads $HOME/.codex/auth.json — mirror the real machine.
      fs.mkdirSync(path.join(home, ".codex"), { recursive: true });
      fs.symlinkSync(
        path.join(REAL_HOME, ".codex", "auth.json"),
        path.join(home, ".codex", "auth.json"),
      );
      const proj = mkProject("s3");
      const codexHome = path.join(home, "codex-agent");
      seedCodexHome(codexHome, proj, true);
      return runLive({
        label: scenario,
        model: "gpt",
        home,
        projectDir: proj,
        env: { CODEX_HOME: codexHome },
        mcpConfigPath: path.join(codexHome, "config.toml"),
        timeoutMs: 90_000,
      });
    }

    // ── 4. ★codex, UNAUTHENTICATED (a brand new Mac)
    case "s4-codex-unauthed": {
      const home = mkHome(BASE, "home-s4");
      const proj = mkProject("s4");
      const codexHome = path.join(home, "codex-agent");
      seedCodexHome(codexHome, proj, false);
      return runLive({
        label: scenario,
        model: "gpt",
        home,
        projectDir: proj,
        env: { CODEX_HOME: codexHome },
        mcpConfigPath: path.join(codexHome, "config.toml"),
        // Nothing should ever be submitted — run the full give-up window so we
        // also see whether a REASON reaches the UI.
        timeoutMs: 75_000,
        stopWhen: () => false,
      });
    }

    // ── R. ★reverse: the accept string quoted by a LIVE composer
    case "r-quote-in-composer": {
      const home = mkHome(BASE, "home-r");
      const proj = mkProject("r");
      const fake = path.join(BASE, "fake-claude.mjs");
      fs.writeFileSync(fake, FAKE_CLAUDE);
      // launch() unshifts --dangerously-skip-permissions for claude, so the
      // stand-in has to swallow it the way the real binary does.
      fs.rmSync(path.join(BASE, "fake-stdin.log"), { force: true });
      const sh = path.join(BASE, "fake-claude.sh");
      fs.writeFileSync(sh, `#!/bin/sh\nexec ${process.execPath} ${fake}\n`);
      fs.chmodSync(sh, 0o755);
      return runLive({
        label: scenario,
        model: "claude",
        home,
        projectDir: proj,
        command: sh,
        args: [],
        env: { FAKE_LOG: path.join(BASE, "fake-stdin.log") },
        timeoutMs: 30_000,
        stopWhen: () => false,
      });
    }

    default:
      throw new Error(`unknown scenario ${scenario}`);
  }
}

/**
 * A stand-in CLI that is READY from byte one — no first-run dialog ever — and
 * then, mid-conversation, prints the consent screen's accept line the way an
 * agent reading agent-input-wait.ts would quote it. Real pty, real listeners,
 * real timing; only the CLI is simulated, because provoking the real one into
 * quoting the string would cost an API turn and prove the same thing.
 */
const FAKE_CLAUDE = `
import fs from "fs";
const LOG = process.env.FAKE_LOG;
const note = (m) => { try { fs.appendFileSync(LOG, m + "\\n"); } catch {} };
note("boot isTTY=" + process.stdin.isTTY + " pid=" + process.pid);
process.stdout.write("\\u23f5\\u23f5 bypass permissions on (shift+tab to cycle)\\r\\n");
process.stdout.write("? for shortcuts\\r\\n");
let typed = "";
process.stdin.setEncoding("utf8");
process.stdin.resume();
process.stdin.on("data", (b) => { typed += b.toString(); process.stdout.write("[stdin " + JSON.stringify(b.toString().slice(0,20)) + "]\\r\\n"); });
setTimeout(() => {
  process.stdout.write("assistant: the marker list is: 2. Yes, I accept  (from agent-input-wait.ts)\\r\\n");
}, 8000);
setTimeout(() => { process.stdout.write("DONE typed=" + JSON.stringify(typed) + "\\r\\n"); process.exit(0); }, 20000);
`;

main()
  .then((r) => {
    const text = report(scenario, r);
    console.log(text);
    if (outfile) {
      fs.writeFileSync(
        outfile,
        JSON.stringify(
          {
            scenario,
            events: r.events,
            writes: r.writes.map((w) => ({
              t: w.t,
              via: w.via,
              head: w.data.slice(0, 40),
              len: w.data.length,
            })),
            statuses: r.statuses,
            exitCode: r.exitCode,
            transcriptTail: r.transcript.slice(-3000),
          },
          null,
          2,
        ),
      );
    }
    process.exit(0);
  })
  .catch((e) => {
    console.error("FAILED", e);
    process.exit(1);
  });
