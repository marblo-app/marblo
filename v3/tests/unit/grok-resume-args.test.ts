import { afterEach, describe, expect, it } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  AgentConfigGenerator,
  CONFIG_DIR,
  grokSessionArgs,
  grokSessionsDir,
} from "../../electron/agent-config";
import {
  resolveRestartResumeSessionId,
  resolveSwitchHandoffResumeSessionId,
  usesIsolatedHomeSentinelResume,
} from "../../electron/orchestrator-handoff";

/**
 * Grok Build resume contract, pinned against the REAL AgentConfigGenerator.
 *
 * Regression this file guards: `case "grok"` in buildCLICommand ignored
 * `resumeSessionId` entirely, so grok — alone among the five harnesses — got a
 * FRESH conversation on every spawn. The orchestrator "이전 대화 이어짐" after
 * an app restart simply never happened on grok.
 *
 * Every flag asserted here was verified LIVE against grok 0.2.112 on an
 * isolated GROK_HOME (headless `-p` turns):
 *
 *   --session-id <uuid>  pins a NEW conversation to that uuid; the session
 *                        directory is named after it. Reusing an existing id
 *                        → "Session ID … is already in use" (fatal).
 *   --resume <uuid>      resumes that exact session, cwd-INDEPENDENTLY
 *                        ("found locally (originally in …)"). An UNKNOWN id
 *                        falls through to the remote session registry and
 *                        404s → exit. Same 즉사 shape as
 *                        `codex resume <unknown-id>`.
 *   --continue           resumes the most recent session FOR THE CWD; fatal
 *                        with "No session found for current directory" when
 *                        that directory has none.
 */
describe("grokSessionArgs (pure decision table)", () => {
  const NEW_ID = "11111111-2222-3333-4444-555555555555";

  it("pins a fresh launch to a new --session-id and reports it back", () => {
    expect(grokSessionArgs(undefined, NEW_ID)).toEqual({
      args: ["--session-id", NEW_ID],
      sessionId: NEW_ID,
    });
  });

  it("treats the 'new' sentinel as fresh (not as a session id)", () => {
    expect(grokSessionArgs("new", NEW_ID).args).toEqual([
      "--session-id",
      NEW_ID,
    ]);
  });

  it("resumes a concrete uuid with --resume and never also pins --session-id", () => {
    const uuid = "ea83fb29-401c-4d3a-9dbd-d4a99e5f7ddc";
    const { args, sessionId } = grokSessionArgs(uuid, NEW_ID);
    expect(args).toEqual(["--resume", uuid]);
    expect(args).not.toContain("--session-id");
    expect(sessionId).toBe(uuid);
  });

  it("maps the 'latest' sentinel to grok's native --continue, with no id to report", () => {
    // grok resolves "most recent for this cwd" itself, so there is nothing to
    // pin — reporting a made-up id here would be a lie to the caller.
    expect(grokSessionArgs("latest", NEW_ID)).toEqual({
      args: ["--continue"],
      sessionId: undefined,
    });
  });

  it("never emits --resume together with --continue", () => {
    for (const req of [undefined, "new", "latest", NEW_ID]) {
      const { args } = grokSessionArgs(req, NEW_ID);
      expect(args.includes("--resume") && args.includes("--continue")).toBe(
        false,
      );
    }
  });
});

describe("grok launch args (real buildCLICommand)", () => {
  const generator = new AgentConfigGenerator();

  function grokArgs(resumeSessionId?: string): string[] {
    return generator.getLaunchConfig(
      {
        id: "grok-resume-args-test-agent",
        model: "grok",
        role: "backend",
        command: "grok",
      },
      process.cwd(),
      undefined,
      "test-project",
      resumeSessionId,
    ).args;
  }

  function grokLaunch(resumeSessionId?: string) {
    return generator.getLaunchConfig(
      {
        id: "grok-resume-args-test-agent",
        model: "grok",
        role: "backend",
        command: "grok",
      },
      process.cwd(),
      undefined,
      "test-project",
      resumeSessionId,
    );
  }

  it("REGRESSION: a fresh spawn pins --session-id and surfaces the id", () => {
    const launch = grokLaunch(undefined);
    const idx = launch.args.indexOf("--session-id");
    expect(idx).toBeGreaterThanOrEqual(0);
    const emitted = launch.args[idx + 1];
    expect(emitted).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
    );
    // The launch tells the caller WHICH session directory it just claimed.
    expect(launch.grokSessionId).toBe(emitted);
  });

  it("REGRESSION: a concrete resume id reaches argv as --resume <uuid> (it used to be dropped on the floor)", () => {
    const uuid = "ea83fb29-401c-4d3a-9dbd-d4a99e5f7ddc";
    const args = grokArgs(uuid);
    expect(args).toContain("--resume");
    expect(args[args.indexOf("--resume") + 1]).toBe(uuid);
    expect(args).not.toContain("--session-id");
    expect(args).not.toContain("--continue");
  });

  it("REGRESSION: the 'latest' sentinel reaches argv as --continue", () => {
    const args = grokArgs("latest");
    expect(args).toContain("--continue");
    expect(args).not.toContain("--resume");
    expect(args).not.toContain("--session-id");
  });

  it("keeps every pre-existing grok flag intact on all resume shapes (회귀 0)", () => {
    for (const req of [
      undefined,
      "new",
      "latest",
      "ea83fb29-401c-4d3a-9dbd-d4a99e5f7ddc",
    ]) {
      const args = grokArgs(req);
      expect(args).toContain("--minimal");
      expect(args[args.indexOf("--permission-mode") + 1]).toBe(
        "bypassPermissions",
      );
      // The model pin must still be present and still be a model id.
      expect(args[args.indexOf("-m") + 1]).toMatch(/^grok/);
    }
  });

  it("never leaks another harness's resume syntax onto grok", () => {
    // `--last` is codex's, `--conversation` is agy's. Either one would make
    // grok exit with an unknown-option error.
    for (const req of ["latest", "ea83fb29-401c-4d3a-9dbd-d4a99e5f7ddc"]) {
      const args = grokArgs(req);
      expect(args).not.toContain("--last");
      expect(args).not.toContain("--conversation");
      expect(args).not.toContain("resume");
    }
  });

  it("puts GROK_HOME on the same isolated home the session tree lives under — fresh and resume must agree or the session file is invisible", () => {
    const agentId = "grok-resume-args-test-agent";
    for (const req of [undefined, "latest"]) {
      const launch = generator.getLaunchConfig(
        { id: agentId, model: "grok", role: "backend", command: "grok" },
        process.cwd(),
        undefined,
        "test-project",
        req,
      );
      expect(launch.env.GROK_HOME).toBe(path.dirname(grokSessionsDir(agentId)));
    }
  });
});

describe("hasSavedSession('grok') — the gate that keeps --continue off an empty home", () => {
  const generator = new AgentConfigGenerator();
  const made: string[] = [];

  afterEach(() => {
    for (const dir of made.splice(0)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  function seedSession(
    agentId: string,
    cwd: string,
    opts: { withSessionDir: boolean },
  ): void {
    const cwdKey = path.join(grokSessionsDir(agentId), encodeURIComponent(cwd));
    fs.mkdirSync(cwdKey, { recursive: true });
    made.push(path.join(CONFIG_DIR, `grok-home-${agentId}`));
    // grok writes this directly under the cwd key, session or not.
    fs.writeFileSync(path.join(cwdKey, "prompt_history.jsonl"), "{}\n");
    if (opts.withSessionDir) {
      const sessionDir = path.join(
        cwdKey,
        "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      );
      fs.mkdirSync(sessionDir, { recursive: true });
      fs.writeFileSync(path.join(sessionDir, "updates.jsonl"), "{}\n");
    }
  }

  it("reports no saved session for an agent that never ran", () => {
    expect(
      generator.hasSavedSession("grok-agent-that-never-ran-9f3a2b1c", "grok"),
    ).toBe(false);
  });

  it("finds this agent's session for the cwd it was created in", () => {
    const agentId = "grok-has-session-test";
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cwd-"));
    made.push(cwd);
    seedSession(agentId, cwd, { withSessionDir: true });
    expect(generator.hasSavedSession(agentId, "grok", cwd)).toBe(true);
  });

  it("says NO for a DIFFERENT cwd — `--continue` is cwd-scoped and would exit there", () => {
    const agentId = "grok-other-cwd-test";
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cwd-"));
    const otherCwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-other-"));
    made.push(cwd, otherCwd);
    seedSession(agentId, cwd, { withSessionDir: true });
    expect(generator.hasSavedSession(agentId, "grok", otherCwd)).toBe(false);
  });

  it("does NOT count a bare prompt_history.jsonl as a resumable session", () => {
    // The loose history file exists even when no session directory was ever
    // written. Counting it would greenlight `--continue` and kill the launch.
    const agentId = "grok-history-only-test";
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cwd-"));
    made.push(cwd);
    seedSession(agentId, cwd, { withSessionDir: false });
    expect(generator.hasSavedSession(agentId, "grok", cwd)).toBe(false);
    expect(generator.hasSavedSession(agentId, "grok")).toBe(false);
  });

  it("without a cwd, answers 'does this agent's home hold any session at all'", () => {
    const agentId = "grok-any-session-test";
    const cwd = fs.mkdtempSync(path.join(os.tmpdir(), "grok-cwd-"));
    made.push(cwd);
    seedSession(agentId, cwd, { withSessionDir: true });
    expect(generator.hasSavedSession(agentId, "grok")).toBe(true);
  });

  it("leaves the other harnesses' answers untouched (회귀 0)", () => {
    const cwd = process.cwd();
    for (const model of ["gpt", "gemini", "antigravity"] as const) {
      expect(
        generator.hasSavedSession("agent-never-ran-1a2b3c", model, cwd),
      ).toBe(false);
    }
  });
});

describe("orchestrator resume routing — grok joins the isolated-home harnesses", () => {
  it("classifies gpt and grok as sentinel-resumed, claude/gemini/antigravity as not", () => {
    expect(usesIsolatedHomeSentinelResume("gpt")).toBe(true);
    expect(usesIsolatedHomeSentinelResume("grok")).toBe(true);
    expect(usesIsolatedHomeSentinelResume("claude")).toBe(false);
    expect(usesIsolatedHomeSentinelResume("gemini")).toBe(false);
    expect(usesIsolatedHomeSentinelResume("antigravity")).toBe(false);
  });

  it("REGRESSION: a grok orchestrator restart resolves to the 'latest' sentinel, NOT a claude uuid", () => {
    const resumeSessionId = resolveRestartResumeSessionId({
      targetModel: "grok",
      hasSavedIsolatedHomeSession: () => true,
      // The claude-only resolver. Routing grok through it hands grok a uuid
      // its own CLI cannot find → remote 404 → 오케 즉사.
      resolvePreviousNonGptSession: () => {
        throw new Error("claude resolver must not run for grok");
      },
    });
    expect(resumeSessionId).toBe("latest");
  });

  it("starts a grok orchestrator fresh when its isolated home has no session", () => {
    expect(
      resolveRestartResumeSessionId({
        targetModel: "grok",
        hasSavedIsolatedHomeSession: () => false,
        resolvePreviousNonGptSession: () => "claude-uuid",
      }),
    ).toBeNull();
  });

  it("routes the grok model SWITCH handoff the same way", () => {
    expect(
      resolveSwitchHandoffResumeSessionId({
        resume: "previous",
        targetModel: "grok",
        hasSavedIsolatedHomeSession: () => true,
        resolvePreviousNonGptSession: () => {
          throw new Error("claude resolver must not run for grok");
        },
      }),
    ).toBe("latest");
    expect(
      resolveSwitchHandoffResumeSessionId({
        resume: "previous",
        targetModel: "grok",
        hasSavedIsolatedHomeSession: () => false,
        resolvePreviousNonGptSession: () => "claude-uuid",
      }),
    ).toBe("new");
  });

  it("leaves claude on the concrete-uuid resolver (회귀 0)", () => {
    expect(
      resolveRestartResumeSessionId({
        targetModel: "claude",
        hasSavedIsolatedHomeSession: () => {
          throw new Error("isolated-home check must not run for claude");
        },
        resolvePreviousNonGptSession: () => "claude-uuid",
      }),
    ).toBe("claude-uuid");
  });
});
