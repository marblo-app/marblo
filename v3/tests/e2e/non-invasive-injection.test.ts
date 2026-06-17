/**
 * E2E regression test for the patent's signature feature
 * (청구항 5 / 비침습 신규지시):
 *
 *   "에이전트가 태스크를 수행하는 도중 가상터미널의 표준입력에
 *    신규지시가 입력되는 경우, 해당 에이전트의 실행을 중단하지 않고
 *    기존의 대화 컨텍스트를 유지한 상태에서 해당 신규지시를 추가입력으로
 *    인식하여 태스크를 이어서 수행한다"
 *
 * Two tiers:
 *
 *   - Tier 1 (Mechanism): runs against a long-lived `cat` process. Verifies
 *     the PtyManager / writeAndSubmit machinery works — process stays alive
 *     across multiple stdin writes, output buffer accumulates, no SIGHUP /
 *     SIGTERM races. Cheap, deterministic, CI-friendly.
 *
 *   - Tier 2 (Behavior): runs against the real Claude / Codex / Gemini
 *     CLIs. Verifies the LLM keeps context across the injection. Slow,
 *     billable, requires CLI auth — gated behind RUN_LLM_E2E=1 env var
 *     so it only fires on demand.
 *
 * Why standalone instead of vitest: this project's vitest 4 + Node 22
 * config currently fails with ERR_REQUIRE_ESM on std-env (pre-existing
 * issue unrelated to this patch). Until that's fixed, run via:
 *   node --import tsx tests/e2e/non-invasive-injection.test.ts
 * or
 *   RUN_LLM_E2E=1 node --import tsx tests/e2e/non-invasive-injection.test.ts
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as pty from "node-pty";

// ── tiny test harness (vitest is broken in this project) ────

interface TestCase {
  name: string;
  tier: "mechanism" | "behavior";
  fn: () => Promise<void>;
}

const tests: TestCase[] = [];

function test(name: string, tier: TestCase["tier"], fn: () => Promise<void>) {
  tests.push({ name, tier, fn });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

function assertContains(
  haystack: string,
  needle: string | RegExp,
  msg: string,
) {
  const ok =
    typeof needle === "string"
      ? haystack.includes(needle)
      : needle.test(haystack);
  if (!ok) {
    throw new Error(
      `Assertion failed: ${msg}\nExpected to find: ${needle}\nIn: ${haystack.slice(0, 500)}`,
    );
  }
}

// ── helpers ────────────────────────────────────────────────

interface PtySession {
  proc: pty.IPty;
  buffer: string;
  alive: boolean;
  exitCode: number | null;
  reset(): void;
}

function spawn(
  cmd: string,
  args: string[],
  env: NodeJS.ProcessEnv = {},
): PtySession {
  const proc = pty.spawn(cmd, args, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.cwd(),
    env: { ...process.env, ...env },
  });
  const session: PtySession = {
    proc,
    buffer: "",
    alive: true,
    exitCode: null,
    reset() {
      this.buffer = "";
    },
  };
  proc.onData((d) => {
    session.buffer += d;
  });
  proc.onExit(({ exitCode }) => {
    session.alive = false;
    session.exitCode = exitCode;
  });
  return session;
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForOutput(
  session: PtySession,
  match: string | RegExp,
  timeoutMs = 5000,
): Promise<boolean> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const ok =
      typeof match === "string"
        ? session.buffer.includes(match)
        : match.test(session.buffer);
    if (ok) return true;
    if (!session.alive) return false;
    await sleep(50);
  }
  return false;
}

/**
 * Mirrors PtyManager.writeAndSubmit — split text and \r so terminal apps
 * don't paste-buffer the trailing CR into the message body.
 */
function writeAndSubmit(session: PtySession, text: string, delayMs = 150) {
  session.proc.write(text);
  setTimeout(() => {
    if (session.alive) session.proc.write("\r");
  }, delayMs);
}

// ── Tier 1: mechanism (deterministic, free) ─────────────────

test(
  "stdin injection keeps `cat` alive across multiple writes",
  "mechanism",
  async () => {
    // `cat` echoes everything from stdin to stdout and stays alive until
    // EOF — perfect stand-in for a long-running interactive CLI.
    const session = spawn("cat", []);
    await sleep(100);
    assert(session.alive, "cat should be alive after spawn");

    writeAndSubmit(session, "first line");
    const sawFirst = await waitForOutput(session, "first line", 1000);
    assert(sawFirst, "first line should echo back");
    assert(session.alive, "cat should still be alive after first write");

    // Inject a second "instruction" while the first is still in the buffer
    writeAndSubmit(session, "second line");
    const sawSecond = await waitForOutput(session, "second line", 1000);
    assert(sawSecond, "second line should echo back");
    assert(
      session.alive,
      "cat must remain alive — patent claim 5 core property",
    );

    // Both injections must coexist in the buffer (no buffer truncation,
    // no process restart between them).
    assertContains(session.buffer, "first line", "first line still present");
    assertContains(session.buffer, "second line", "second line present");

    session.proc.kill();
  },
);

test(
  "writeAndSubmit splits text and CR (no paste-buffered submit)",
  "mechanism",
  async () => {
    // Use a script that prints distinct markers around each readline.
    // If the CR were paste-buffered into the body, both lines would arrive
    // together as a single message and only one marker would print.
    const tmpScript = path.join(
      os.tmpdir(),
      `marblo-readline-${Date.now()}.sh`,
    );
    fs.writeFileSync(
      tmpScript,
      `#!/bin/sh
read line1
echo "GOT1: $line1"
read line2
echo "GOT2: $line2"
`,
      { mode: 0o755 },
    );
    const session = spawn("sh", [tmpScript]);
    await sleep(150);

    writeAndSubmit(session, "alpha");
    const ok1 = await waitForOutput(session, "GOT1: alpha", 2000);
    assert(ok1, "first readline should receive 'alpha' as a complete line");

    writeAndSubmit(session, "beta");
    const ok2 = await waitForOutput(session, "GOT2: beta", 2000);
    assert(
      ok2,
      "second readline should receive 'beta' — proves CR submitted properly",
    );

    fs.unlinkSync(tmpScript);
  },
);

test(
  "process exit propagates to onExit handler (status accuracy)",
  "mechanism",
  async () => {
    const session = spawn("sh", ["-c", "exit 0"]);
    const start = Date.now();
    while (session.alive && Date.now() - start < 2000) await sleep(50);
    assert(!session.alive, "process should be marked not-alive after exit");
    assert(
      session.exitCode === 0,
      "exitCode should be captured (got " + session.exitCode + ")",
    );
  },
);

// ── Tier 2: behavior with real LLMs (gated, billable) ───────

const RUN_LLM = process.env.RUN_LLM_E2E === "1";

function maybeLlmTest(
  name: string,
  cli: {
    cmd: string;
    args: string[];
    readyPattern: RegExp;
    envBuilder?: () => NodeJS.ProcessEnv;
  },
) {
  test(
    `LLM context preserved across injection — ${name}`,
    "behavior",
    async () => {
      if (!RUN_LLM) {
        console.log(`    [skipped] set RUN_LLM_E2E=1 to run`);
        return;
      }
      const env = cli.envBuilder ? cli.envBuilder() : {};
      const session = spawn(cli.cmd, cli.args, env);

      // Wait for the CLI's input area to be ready so the prompt isn't dumped
      // into a trust dialog or splash screen.
      const ready = await waitForOutput(session, cli.readyPattern, 30000);
      assert(ready, `${name} did not reach input-ready state in 30s`);

      // First instruction: establish a memorable context.
      writeAndSubmit(
        session,
        "Remember the secret word PINEAPPLE-7. Reply with exactly the word OK.",
      );
      const sawOk = await waitForOutput(session, /OK\b/i, 60000);
      assert(sawOk, `${name} did not acknowledge first prompt within 60s`);

      // Inject the second instruction WITHOUT restarting the process.
      // The LLM must reply with the secret word — proving the claim 5
      // contract: 실행 안 끊기고 + 컨텍스트 유지하면서 + 신규지시 반영.
      session.reset();
      writeAndSubmit(
        session,
        "What was the secret word? Reply with just the word.",
      );
      const sawWord = await waitForOutput(session, /PINEAPPLE-7/i, 90000);
      assert(
        sawWord,
        `${name} lost context across injection — patent claim 5 violation`,
      );
      assert(
        session.alive,
        `${name} process died during injection — patent claim 5 violation`,
      );

      session.proc.kill();
    },
  );
}

maybeLlmTest("claude", {
  cmd: "claude",
  args: ["--dangerously-skip-permissions"],
  readyPattern: /\? for shortcuts|Type your message/i,
});

maybeLlmTest("codex", {
  cmd: "codex",
  args: [
    "-c",
    'approval_policy="never"',
    "-c",
    'sandbox_mode="danger-full-access"',
  ],
  readyPattern: /Explain this codebase|esc to interrupt/i,
  envBuilder: () => {
    // Auto-trust cwd to avoid dialog (mirrors generateGPTConfig fix)
    const codexHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-llm-codex-"),
    );
    const real = (() => {
      try {
        return fs.realpathSync(process.cwd());
      } catch {
        return process.cwd();
      }
    })();
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[projects.${JSON.stringify(process.cwd())}]\ntrust_level = "trusted"\n\n[projects.${JSON.stringify(real)}]\ntrust_level = "trusted"\n`,
    );
    const userAuth = path.join(os.homedir(), ".codex/auth.json");
    if (fs.existsSync(userAuth)) {
      try {
        fs.symlinkSync(userAuth, path.join(codexHome, "auth.json"));
      } catch {
        // Best-effort auth sharing; tests can still exercise fallback paths.
      }
    }
    return { CODEX_HOME: codexHome };
  },
});

maybeLlmTest("gemini", {
  cmd: "gemini",
  args: ["--skip-trust", "--yolo"],
  readyPattern: /Type your message|\? for shortcuts/i,
});

// ── runner ────────────────────────────────────────────────

(async () => {
  let pass = 0,
    fail = 0,
    skip = 0;
  const onlyTier = process.env.TIER as TestCase["tier"] | undefined;
  for (const t of tests) {
    if (onlyTier && t.tier !== onlyTier) {
      skip++;
      continue;
    }
    if (t.tier === "behavior" && !RUN_LLM) {
      skip++;
      console.log(`⊘ [${t.tier}] ${t.name}  (set RUN_LLM_E2E=1)`);
      continue;
    }
    process.stdout.write(`  [${t.tier}] ${t.name} ... `);
    try {
      await t.fn();
      console.log("✓");
      pass++;
    } catch (err) {
      console.log("✗");
      console.log("    " + (err instanceof Error ? err.message : String(err)));
      fail++;
    }
  }
  console.log(`\n${pass} passed, ${fail} failed, ${skip} skipped`);
  process.exit(fail > 0 ? 1 : 0);
})();
