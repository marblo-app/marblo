/**
 * The AGENT (worker) half of the same question.
 *
 * PR #1070 put `looksLikeFirstRunDialog` in front of the ORCHESTRATOR's write.
 * The worker path (agent-manager.ts) has no such gate — it still has only
 * STARTUP_DIALOG_MATCHERS (antigravity trust + codex update) and a 10 s blind
 * fallback. This runs the REAL AgentManager.launch() against the REAL claude
 * CLI in a directory claude has never seen, which is what every worker worktree
 * is, and records what we type.
 *
 *   node agentrunner.mjs <outfile>
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

  // A worktree claude has never been run in — i.e. every dispatched task.
  const cwd = path.join(BASE, `worktree-${Date.now()}`);
  fs.mkdirSync(cwd, { recursive: true });
  fs.writeFileSync(path.join(cwd, "README.md"), "# fresh worktree\n");

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

  await new Promise((r) => setTimeout(r, 30_000));
  events.push({ t: now(), kind: "HARNESS-STOP" });
  try {
    real.kill(ptySessionId);
  } catch {
    /* ignore */
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
    scenario: "a1-agent-claude-new-worktree",
    cwd,
    events,
    writes,
    trustRecordedAfter: trustRecorded,
    transcriptTail: transcript.slice(-2500),
  };
  console.log(JSON.stringify(out.events, null, 1));
  console.log("writes:", JSON.stringify(writes));
  console.log("trust recorded after run:", JSON.stringify(trustRecorded));
  const outfile = process.argv[2];
  if (outfile) fs.writeFileSync(outfile, JSON.stringify(out, null, 2));
  process.exit(0);
}

void REAL_HOME;
main().catch((e) => {
  console.error("FAILED", e);
  process.exit(1);
});
