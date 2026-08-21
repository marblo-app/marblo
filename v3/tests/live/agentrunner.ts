/**
 * The AGENT (worker) half of the same question.
 *
 * PR #1070 put `looksLikeFirstRunDialog` in front of the ORCHESTRATOR's write.
 * The worker path (agent-manager.ts) had no such gate — only
 * STARTUP_DIALOG_MATCHERS (antigravity trust + codex update) and a 10 s blind
 * fallback. This runs the REAL AgentManager.launch() against the REAL claude
 * CLI and records what we type.
 *
 * Two scenarios, because a gate that never opens is as broken as one that never
 * closes:
 *
 *   a1 (default)  a directory claude has NEVER seen — i.e. every dispatched
 *                 worker worktree. ★Since P0 (LIdW3JrjgaQmZ3V92xaM) landed,
 *                 launch() pre-empts the trust key before the spawn, so the
 *                 dialog no longer renders at all. PASS = composer, and the
 *                 instruction delivered to it.
 *   a2            the same home with the directory already trusted. Nothing to
 *                 hold for. ★PASS = the instruction IS delivered.
 *   a3            ★the reason the gate still exists. Same new worktree as a1,
 *                 but claude's own `<config>.lock` is held by a live holder for
 *                 the whole run, so the pre-emption CANNOT record the key and
 *                 returns ok:false — exactly what it does on a machine with
 *                 busy claude sessions, an unwritable config, or a key shape
 *                 that drifts in a future CLI. The dialog comes back.
 *                 PASS = writes 0, never `working`, then a stated `error`.
 *
 *   node agentrunner.mjs [a1|a2|a3] <outfile>
 */
import fs from "fs";
import path from "path";
import os from "os";

const BASE = path.join(os.tmpdir(), "mb-firstrun-live");
const REAL_HOME = process.env.HOME!;

async function main() {
  // A RETURNING user's home: bypass consent already accepted machine-wide,
  // one directory already trusted. Built by trustscope.mjs.
  const src = path.join(BASE, "home-trust");
  const home = path.join(BASE, "home-agent");
  fs.rmSync(home, { recursive: true, force: true });
  fs.cpSync(src, home, { recursive: true });
  process.env.HOME = home;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;

  const wantsTrusted = process.argv[2] === "a2";
  const wantsLockedOut = process.argv[2] === "a3";
  const scenario = wantsTrusted
    ? "a2-agent-claude-trusted-worktree"
    : wantsLockedOut
      ? "a3-agent-claude-preemption-blocked"
      : "a1-agent-claude-new-worktree";
  const outfile =
    process.argv[2] === "a1" || wantsTrusted || wantsLockedOut
      ? process.argv[3]
      : process.argv[2];

  // a1: a worktree claude has never been run in — i.e. every dispatched task.
  // a2: the same, with the trust already recorded for that exact directory
  //     (`projects[dir].hasTrustDialogAccepted` — per-directory, siblings do
  //     NOT inherit; see tests/live/README.md).
  const cwd = path.join(BASE, `worktree-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "README.md"), "# fresh worktree\n");
  if (scenario.startsWith("a2")) {
    const cfgPath = path.join(home, ".claude.json");
    const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")) as {
      projects?: Record<string, Record<string, unknown>>;
    };
    cfg.projects = cfg.projects ?? {};
    // ★Key by the RESOLVED path. claude records trust under the realpath, so on
    // macOS an entry written as `/var/folders/…` is invisible to a CLI that
    // resolved its cwd to `/private/var/folders/…` — the dialog comes up anyway.
    // Measured here, and it is the trap any pre-emption of this dialog has to
    // avoid (ticket LIdW3JrjgaQmZ3V92xaM).
    const key = fs.realpathSync(cwd);
    cfg.projects[key] = {
      ...(cfg.projects[key] ?? {}),
      hasTrustDialogAccepted: true,
    };
    fs.writeFileSync(cfgPath, JSON.stringify(cfg));
  }

  // a3: stand in for a live claude session that is writing its config right
  // now. claude locks `~/.claude.json` with proper-lockfile, whose lock IS the
  // directory `<file>.lock` and whose liveness IS its mtime — so a held lock is
  // a held DIRECTORY with a fresh mtime, and that is all it takes to reproduce.
  // ★We do NOT touch the pre-emption code to make this happen: the product runs
  // exactly as shipped and simply loses the race, which is the failure mode the
  // gate is the backstop for.
  let lockKeeper: ReturnType<typeof setInterval> | null = null;
  const lockPath = path.join(home, ".claude.json.lock");
  if (wantsLockedOut) {
    fs.mkdirSync(lockPath, { recursive: true });
    // The stealer reaps a lock older than 10 s; a real holder keeps it fresh.
    lockKeeper = setInterval(() => {
      try {
        fs.utimesSync(lockPath, new Date(), new Date());
      } catch {
        /* ignore */
      }
    }, 2_000);
    lockKeeper.unref?.();
  }

  const { PtyManager } = await import("../../electron/pty-manager");
  const { AgentManager } = await import("../../electron/agent-manager");
  const { stripFrameAnsi } =
    await import("../../electron/agent-status-reconcile");

  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const events: Array<{ t: number; kind: string; detail?: string }> = [];
  const writes: Array<{ t: number; via: string; head: string; len: number }> =
    [];
  let transcript = "";
  const seen = new Set<string>();

  const real = new PtyManager();
  const origWrite = real.write.bind(real);
  const origWAS = real.writeAndSubmit.bind(real);
  (real as never as { write: typeof origWrite }).write = (
    id: string,
    data: string,
  ) => {
    writes.push({
      t: now(),
      via: "write",
      head: data.slice(0, 20),
      len: data.length,
    });
    events.push({
      t: now(),
      kind: "WRITE",
      detail: JSON.stringify(data.slice(0, 20)),
    });
    return origWrite(id, data);
  };
  (real as never as { writeAndSubmit: typeof origWAS }).writeAndSubmit = (
    id: string,
    text: string,
    d?: number,
    b?: boolean,
  ) => {
    writes.push({
      t: now(),
      via: "writeAndSubmit",
      head: text.slice(0, 30),
      len: text.length,
    });
    events.push({
      t: now(),
      kind: "PROMPT-SUBMIT",
      detail: `${text.length} chars`,
    });
    return origWAS(id, text, d, b);
  };

  const configGenerator = {
    getLaunchConfig: () => ({
      model: "claude",
      command: "claude",
      // What agent-config emits for a claude worker, minus the MCP wiring.
      args: ["--dangerously-skip-permissions"],
      env: { ...(process.env as Record<string, string>), HOME: home },
      mcpConfigPath: path.join(home, "__mcp__", "cfg.json"),
    }),
    cleanup: () => {},
    hasSavedSession: () => false,
  };

  // AgentManager builds its OWN AgentConfigGenerator, so the config path is
  // the real one — pointed at the isolated HOME and a /tmp userData by the
  // electron stub. `configGenerator` below is kept only to document what the
  // real generator emits for a claude worker.
  void configGenerator;
  const manager = new AgentManager(
    real as never,
    (id: string, status: string) =>
      events.push({ t: now(), kind: "STATUS", detail: `${id}:${status}` }),
  );

  const id = "live-worker-1";
  manager.launch({
    id,
    name: "LiveWorker",
    model: "claude",
    role: "backend",
    command: "claude",
    cwd,
    initialPrompt: "Reply with the single word READY and nothing else.",
    resumeSessionId: "new",
    projectId: "live-proj",
  } as never);

  const ptySessionId = `agent-${id}`;
  real.onData(ptySessionId, (chunk: string) => {
    transcript += stripFrameAnsi(chunk);
    if (transcript.length > 200_000) transcript = transcript.slice(-200_000);
    const tail = transcript.slice(-4000);
    for (const [name, re] of [
      ["claude:folder-trust", /trust\s*this\s*folder/i],
      ["claude:bypass-consent", /yes,\s*i\s*accept/i],
      ["claude:composer(⏵⏵)", /⏵⏵/],
      ["turn-started", /esc to interrupt/i],
    ] as Array<[string, RegExp]>) {
      if (seen.has(name)) continue;
      if (re.test(tail)) {
        seen.add(name);
        events.push({ t: now(), kind: "SCREEN", detail: name });
      }
    }
  });

  // a3 has to outlive the hold's give-up window (60 s, counted from the PTY
  // spawn on both the worker and the orchestrator) — the whole point is to see
  // whether the agent ends up as a stated error rather than a silent `working`.
  // a1 and a2 now both deliver in seconds, so they need only a short tail.
  await new Promise((r) => setTimeout(r, wantsLockedOut ? 80_000 : 30_000));
  events.push({ t: now(), kind: "HARNESS-STOP" });
  try {
    real.kill(ptySessionId);
  } catch {
    /* ignore */
  }
  if (lockKeeper) {
    clearInterval(lockKeeper);
    try {
      fs.rmdirSync(lockPath);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));

  const trustRecorded = (() => {
    try {
      const cfg = JSON.parse(
        fs.readFileSync(path.join(home, ".claude.json"), "utf8"),
      ) as { projects?: Record<string, unknown> };
      return Object.keys(cfg.projects ?? {}).map((p) => path.basename(p));
    } catch {
      return ["<unreadable>"];
    }
  })();

  const out = {
    scenario,
    cwd,
    events,
    writes,
    trustRecordedAfter: trustRecorded,
    transcriptTail: transcript.slice(-2500),
  };
  console.log(JSON.stringify(out.events, null, 1));
  console.log("writes:", JSON.stringify(writes));
  console.log("trust recorded after run:", JSON.stringify(trustRecorded));
  if (outfile) fs.writeFileSync(outfile, JSON.stringify(out, null, 2));
  process.exit(0);
}

void REAL_HOME;
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
