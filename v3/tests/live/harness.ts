/**
 * LIVE first-run boot harness — real CLIs, real PTYs, real wiring.
 *
 * Everything under electron/ that decides what gets typed is the REAL module:
 *   · OrchestratorManager.launch()   — the boot path itself
 *   · PtyManager                     — real node-pty, real writeAndSubmit
 *   · agent-input-wait               — auto-accept + first-run dialog gate
 *   · harness-manager                — login backstop + auth probe
 * Only AgentConfigGenerator is stubbed, so no config is written outside the
 * isolated HOME this harness creates. The stub reproduces the real generator's
 * orchestrator output verbatim (see agent-config.ts case "gpt" / "claude").
 *
 * ★HOME is repointed at an isolated directory BEFORE any electron module is
 * imported, because harness-manager captures `os.homedir()` at module load.
 * Nothing here ever reads or writes the real ~/.claude.json or ~/.codex/*.
 */
import fs from "fs";
import path from "path";
import { stripFrameAnsi } from "../../electron/agent-status-reconcile";

export interface Ev {
  t: number;
  kind: string;
  detail?: string;
}

export interface RunResult {
  events: Ev[];
  /** Every byte WE wrote to the pty, with the ms it was written. */
  writes: Array<{ t: number; via: "write" | "writeAndSubmit"; data: string }>;
  statuses: Array<{ t: number; status: string }>;
  /** ANSI-stripped transcript of everything the CLI painted. */
  transcript: string;
  exitCode: number | null;
}

/** Screens we want a timestamp for. Observation only — never acted on. */
const SCREEN_MARKERS: Array<[string, RegExp]> = [
  ["claude:theme-picker", /Choose\s*the\s*text\s*style/i],
  ["claude:folder-trust", /trust\s*this\s*folder/i],
  ["claude:bypass-consent", /yes,\s*i\s*accept/i],
  ["claude:login-menu", /Select\s*login\s*method/i],
  ["claude:composer(⏵⏵)", /⏵⏵/],
  ["codex:skeleton(model:loading)", /\bmodel:\s*loading\b/i],
  ["codex:folder-trust", /Do\s*you\s*trust\s*the\s*contents\s*of\s*this/i],
  ["codex:login-menu", /Sign\s*in\s*with\s*ChatGPT/i],
  ["codex:oauth-browser", /Finish\s*signing\s*in\s*via\s*your\s*browser/i],
  ["codex:composer", /Ask\s*Codex/i],
  ["turn-started", /esc to interrupt|Esc to interrupt|Working|Thinking/],
];

export interface RunOpts {
  label: string;
  model: "claude" | "gpt" | "antigravity" | "grok";
  home: string;
  projectDir: string;
  /** Override the binary (used by the fake-CLI provocation run). */
  command?: string;
  args?: string[];
  /** Extra env for the spawned CLI. */
  env?: Record<string, string>;
  /** What the real generator would return as mcpConfigPath. */
  mcpConfigPath?: string;
  /** Hard stop for the run. */
  timeoutMs: number;
  /** Stop early once this fires (default: boot prompt submitted). */
  stopWhen?: (r: { events: Ev[]; writes: RunResult["writes"] }) => boolean;
  /** Grace after stopWhen before killing, so we can see the turn start. */
  graceMs?: number;
}

export async function runLive(opts: RunOpts): Promise<RunResult> {
  // ── isolate HOME before electron modules load ────────────────────────────
  process.env.HOME = opts.home;
  delete process.env.ANTHROPIC_API_KEY;
  delete process.env.ANTHROPIC_AUTH_TOKEN;
  delete process.env.OPENAI_API_KEY;
  delete process.env.XAI_API_KEY;

  const { PtyManager } = await import("../../electron/pty-manager");
  const { OrchestratorManager } =
    await import("../../electron/orchestrator-manager");

  const t0 = Date.now();
  const now = () => Date.now() - t0;
  const events: Ev[] = [];
  const writes: RunResult["writes"] = [];
  const statuses: Array<{ t: number; status: string }> = [];
  const seen = new Set<string>();
  let transcript = "";
  let exitCode: number | null = null;

  const push = (kind: string, detail?: string) => {
    events.push({ t: now(), kind, detail });
  };

  const real = new PtyManager();
  // Record every byte WE send, then delegate to the real implementation.
  const origWrite = real.write.bind(real);
  const origWAS = real.writeAndSubmit.bind(real);
  (real as unknown as { write: typeof origWrite }).write = (
    id: string,
    data: string,
  ) => {
    writes.push({ t: now(), via: "write", data });
    push("WRITE", JSON.stringify(data).slice(0, 60));
    return origWrite(id, data);
  };
  (real as unknown as { writeAndSubmit: typeof origWAS }).writeAndSubmit = (
    id: string,
    text: string,
    d?: number,
    b?: boolean,
  ) => {
    writes.push({ t: now(), via: "writeAndSubmit", data: text });
    push("BOOT-PROMPT-SUBMIT", `${text.length} chars`);
    return origWAS(id, text, d, b);
  };

  const configGenerator = {
    getLaunchConfig: (agent: { model: string; command: string }) => {
      const env: Record<string, string> = {
        ...(process.env as Record<string, string>),
        HOME: opts.home,
        ...(opts.env ?? {}),
      };
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
      delete env.OPENAI_API_KEY;
      let command = opts.command ?? agent.command;
      let args: string[] = opts.args ? [...opts.args] : [];
      if (!opts.command && agent.model === "gpt") {
        command = "codex";
        args = [
          "-c",
          'approval_policy="never"',
          "-c",
          'sandbox_mode="danger-full-access"',
        ];
      }
      return {
        model: agent.model,
        command,
        args,
        env,
        mcpConfigPath:
          opts.mcpConfigPath ?? path.join(opts.home, "__mcp__", "cfg.json"),
      };
    },
    cleanup: () => {},
    hasSavedSession: () => false,
  };

  const manager = new OrchestratorManager(
    real as never,
    configGenerator as never,
    (s: string) => {
      statuses.push({ t: now(), status: s });
      push("STATUS", s);
    },
    "board",
  );

  let ptyId: string | null = null;
  manager.launch(
    "live-proj",
    opts.projectDir,
    4242,
    (id: string) => {
      ptyId = id;
      push("PTY-SPAWNED", id);
      real.onData(id, (chunk: string) => {
        transcript += stripFrameAnsi(chunk);
        if (transcript.length > 400_000)
          transcript = transcript.slice(-400_000);
        const tail = transcript.slice(-4000);
        for (const [name, re] of SCREEN_MARKERS) {
          if (seen.has(name)) continue;
          if (re.test(tail)) {
            seen.add(name);
            push("SCREEN", name);
          }
        }
      });
      real.onExit(id, (code: number) => {
        exitCode = code;
        push("PTY-EXIT", String(code));
      });
    },
    "new",
    undefined,
    { modelOverride: opts.model },
  );

  const stopWhen =
    opts.stopWhen ?? ((r) => r.writes.some((w) => w.via === "writeAndSubmit"));
  const grace = opts.graceMs ?? 2500;
  const deadline = Date.now() + opts.timeoutMs;
  let fired = 0;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 100));
    if (exitCode !== null) break;
    if (fired) {
      if (Date.now() - fired > grace) break;
      continue;
    }
    if (stopWhen({ events, writes })) fired = Date.now();
  }
  push("HARNESS-STOP");
  try {
    manager.stop();
  } catch {
    /* ignore */
  }
  if (ptyId) {
    try {
      real.kill(ptyId);
    } catch {
      /* ignore */
    }
  }
  await new Promise((r) => setTimeout(r, 400));
  return { events, writes, statuses, transcript, exitCode };
}

export function mkHome(base: string, name: string): string {
  const home = path.join(base, name);
  fs.rmSync(home, { recursive: true, force: true });
  fs.mkdirSync(home, { recursive: true });
  return home;
}

export function report(label: string, r: RunResult): string {
  const lines = [`\n══ ${label} ══`];
  for (const e of r.events) {
    lines.push(
      `  ${String(e.t).padStart(6)}ms  ${e.kind}${e.detail ? "  " + e.detail : ""}`,
    );
  }
  lines.push(
    `  writes: ${r.writes.length} → ${r.writes
      .map((w) => `${w.t}ms:${w.via}:${JSON.stringify(w.data.slice(0, 12))}`)
      .join(", ")}`,
  );
  return lines.join("\n");
}
