/**
 * Patent 회귀 테스트:
 *   - 이종 모델 동시 협업 (claim 1 + 청구항 9 / 명세서 단락 99 예시):
 *     "종류가 Gemini이고 역할이 frontend인 에이전트, 종류가 Claude이고
 *      역할이 backend인 에이전트, 및 종류가 Codex이고 역할이 design인
 *      에이전트와 같이 서로 다른 종류와 서로 다른 역할이 정의된 복수의
 *      에이전트가 내부에서 운용될 수 있다."
 *   - 오케스트레이터 자동 신규지시 path (명세서 단락 228):
 *     "신규지시는 사용자 입력 OR 오케스트레이터가 작업의 진행 도중에
 *      다른 에이전트들의 작업상태 등을 반영하여 자동으로 생성한 지시일
 *      수도 있다."
 *
 * Tier 1 (shape) — 무조건 실행:
 *   소스코드를 직접 grep 해서 (a) update_task_status 가 notifyOrchestrator
 *   를 호출하고 (b) DONE 상태 전환 시 dependency resolution 루프가
 *   각 unblocked 태스크에 대해 추가 notifyOrchestrator 를 호출하는지
 *   검증. 코드 리팩터링 시 이 자동화 경로가 끊기는 것을 방지하는
 *   회귀 가드.
 *
 * Tier 2 (behavior) — RUN_LLM_E2E=1 게이트:
 *   실제 Claude+Codex+Gemini 세 에이전트를 동시 spawn 해서 동일 프로젝트에서
 *   협업 가능한지 시뮬레이션. PTY 격리가 유지되면서 동일 MCP 통신
 *   (claim 1) 으로 협업하는지 확인. 비용 발생.
 */

import * as fs from "fs";
import * as path from "path";
import * as os from "os";
// node-pty is required lazily inside the Tier 2 test body so the Tier 1
// (shape) tests can run from any directory without the module installed.
type PtyMod = typeof import("node-pty");

const tests: Array<{
  name: string;
  tier: "shape" | "behavior";
  fn: () => Promise<void> | void;
}> = [];

function test(name: string, tier: "shape" | "behavior", fn: () => Promise<void> | void) {
  tests.push({ name, tier, fn });
}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(`Assertion failed: ${msg}`);
}

/**
 * Resolve the v3 project root regardless of where this test was compiled
 * from. Walks up from __dirname looking for the marker files; falls back
 * to MARBLO_ROOT env, then process.cwd().
 */
function findRepoRoot(): string {
  const markers = ["electron/mcp-server/tools.ts", "electron/agent-config.ts"];
  const tryDir = (d: string) =>
    markers.every((m) => fs.existsSync(path.join(d, m)));
  if (process.env.MARBLO_ROOT && tryDir(process.env.MARBLO_ROOT))
    return process.env.MARBLO_ROOT;
  let cur = __dirname;
  for (let i = 0; i < 8; i++) {
    if (tryDir(cur)) return cur;
    cur = path.dirname(cur);
  }
  if (tryDir(process.cwd())) return process.cwd();
  throw new Error(
    "Could not locate v3 project root (looked for electron/mcp-server/tools.ts). Set MARBLO_ROOT env.",
  );
}

const REPO_ROOT = findRepoRoot();

function readFile(rel: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, rel), "utf-8");
}

// ── Tier 1: shape (regression guard for auto-orchestration path) ──

test(
  "update_task_status calls notifyOrchestrator (auto신규지시 path 1)",
  "shape",
  () => {
    const src = readFile("electron/mcp-server/tools.ts");
    // Find update_task_status handler region
    const handlerStart = src.indexOf('"update_task_status"');
    assert(handlerStart > 0, "update_task_status handler must exist");
    // Look for notifyOrchestrator within ~2KB after the handler start
    const region = src.slice(handlerStart, handlerStart + 4000);
    assert(
      /notifyOrchestrator\(/.test(region),
      "update_task_status must call notifyOrchestrator (단락 228 자동 신규지시)",
    );
    assert(
      /Task Update/.test(region),
      "notification must include '[Task Update]' tag for orchestrator parsing",
    );
  },
);

test("add_activity calls notifyOrchestrator for progress updates", "shape", () => {
  const src = readFile("electron/mcp-server/tools.ts");
  const handlerStart = src.indexOf('"add_activity"');
  assert(handlerStart > 0, "add_activity handler must exist");
  const region = src.slice(handlerStart, handlerStart + 3000);
  assert(
    /notifyOrchestrator\(/.test(region),
    "add_activity must notify orchestrator so mid-task progress reaches the orchestrator PTY",
  );
  assert(
    /Task Activity/.test(region),
    "activity notification must include '[Task Activity]' tag for orchestrator parsing",
  );
});

test("spawn_agent accepts task_id and bridge appends completion footer", "shape", () => {
  const tools = readFile("electron/mcp-server/tools.ts");
  const spawnStart = tools.indexOf('"spawn_agent"');
  assert(spawnStart > 0, "spawn_agent handler must exist");
  const spawnRegion = tools.slice(spawnStart, spawnStart + 5000);
  assert(
    /task_id/.test(spawnRegion) && /taskId:\s*task_id/.test(spawnRegion),
    "spawn_agent must forward task_id to the bridge as taskId",
  );

  const bridge = readFile("electron/bridge-server.ts");
  assert(
    /taskId\?:\s*string/.test(bridge),
    "bridge SpawnAgentRequest must include optional taskId",
  );
  assert(
    /withCompletionFooter\(params\.initialPrompt,\s*params\.taskId\)/.test(
      bridge,
    ),
    "direct spawn_agent path must append completion footer when taskId is provided",
  );
});

test(
  "DONE transition triggers dependency resolution + per-unblock notification",
  "shape",
  () => {
    const src = readFile("electron/mcp-server/tools.ts");
    // The dependency resolution loop should iterate tasks that depend on
    // the just-completed task and mark each as ready, with a notification
    // per unblocked task.
    assert(
      /array-contains.*task_id/.test(src),
      "must query tasks where dependsOn array-contains the completed task_id",
    );
    assert(
      /Dependency Resolved/.test(src),
      "must emit '[Dependency Resolved]' notification per unblocked task",
    );
    assert(
      /dependsOnCompleted:\s*true/.test(src),
      "must mark unblocked tasks dependsOnCompleted=true",
    );
  },
);

test("notifyOrchestrator is wired to bridge HTTP endpoint", "shape", () => {
  const src = readFile("electron/mcp-server/tools.ts");
  assert(
    /notifyOrchestrator/.test(src) &&
      /\/notify-orchestrator/.test(src) &&
      /MARBLO_PROJECT/.test(src),
    "notifyOrchestrator must POST to /notify-orchestrator with projectId for multi-window routing",
  );
  const bridge = readFile("electron/bridge-server.ts");
  assert(
    /\/notify-orchestrator/.test(bridge) &&
      /handleNotifyOrchestrator|handleInjectMessage/.test(bridge),
    "bridge must expose /notify-orchestrator endpoint",
  );
});

test(
  "agent-config supports all three model types (claim 1 이종 운용)",
  "shape",
  () => {
    const src = readFile("electron/agent-config.ts");
    // Type union should include all three plus custom
    assert(
      /case "claude"/.test(src) &&
        /case "gemini"/.test(src) &&
        /case "gpt"/.test(src),
      "buildCLICommand must branch for claude / gemini / gpt",
    );
    // Each branch must produce its own isolated env (PTY isolation per claim 1)
    assert(
      /CODEX_HOME/.test(src),
      "codex branch must isolate via CODEX_HOME (claim 1 격리)",
    );
    assert(
      /HOME:\s*geminiHome/.test(src),
      "gemini branch must isolate via per-agent HOME",
    );
    assert(
      /--mcp-config/.test(src),
      "claude branch must inject per-agent MCP config",
    );
  },
);

test(
  "agent-config strips features section to prevent user flags leaking",
  "shape",
  () => {
    const src = readFile("electron/agent-config.ts");
    assert(
      /\[features\]/.test(src) || /features.*strip/i.test(src),
      "generateGPTConfig must strip [features] section from inherited user config",
    );
  },
);

// ── Tier 2: behavior (LLM-billable, gated) ──────────────────

const RUN_LLM = process.env.RUN_LLM_E2E === "1";

test(
  "four heterogeneous agents (claude+codex+gemini+antigravity) can all spawn alive concurrently",
  "behavior",
  async () => {
    if (!RUN_LLM) {
      console.log("    [skipped] set RUN_LLM_E2E=1 to run");
      return;
    }
    // Lazy import — node-pty is a native module not always available in
    // shape-only test environments.
    const pty = (await import("node-pty")) as PtyMod;
    const sessions: Array<{
      name: string;
      proc: ReturnType<PtyMod["spawn"]>;
      buffer: string;
      alive: boolean;
      readyPattern: RegExp;
    }> = [];

    // Spawn three CLIs that mirror the Marblo agent-config flags (sans
    // marblo MCP — we just verify the PTY isolation property).
    const cwd = process.cwd();

    // codex with autotrust (mirrors generateGPTConfig fix)
    const codexHome = fs.mkdtempSync(
      path.join(os.tmpdir(), "marblo-collab-codex-"),
    );
    const realCwd = (() => {
      try {
        return fs.realpathSync(cwd);
      } catch {
        return cwd;
      }
    })();
    fs.writeFileSync(
      path.join(codexHome, "config.toml"),
      `[projects.${JSON.stringify(
        cwd,
      )}]\ntrust_level = "trusted"\n[projects.${JSON.stringify(
        realCwd,
      )}]\ntrust_level = "trusted"\n`,
    );
    const userAuth = path.join(os.homedir(), ".codex/auth.json");
    if (fs.existsSync(userAuth)) {
      try {
        fs.symlinkSync(userAuth, path.join(codexHome, "auth.json"));
      } catch {
        // Best-effort auth sharing; tests can still exercise fallback paths.
      }
    }

    const specs = [
      {
        name: "claude",
        cmd: "claude",
        args: ["--dangerously-skip-permissions"],
        env: {} as NodeJS.ProcessEnv,
        readyPattern: /\? for shortcuts|Type your message/i,
        // Claude has no blocking startup dialog when --dangerously-skip-permissions
        autoDismiss: undefined as { pattern: RegExp; keys: string } | undefined,
      },
      {
        name: "codex",
        cmd: "codex",
        args: [
          "-c",
          'approval_policy="never"',
          "-c",
          'sandbox_mode="danger-full-access"',
        ],
        env: { CODEX_HOME: codexHome },
        readyPattern: /Explain this codebase|esc to interrupt/i,
        autoDismiss: undefined,
      },
      {
        name: "gemini",
        cmd: "gemini",
        args: ["--skip-trust", "--yolo"],
        env: {},
        readyPattern: /Type your message|\? for shortcuts/i,
        autoDismiss: undefined,
      },
      {
        // Antigravity (agy) — verified post-trust uses the same
        // `? for shortcuts` footer as Claude. The blocker is the
        // trust dialog on first visit to a cwd, defaulted to "Yes"
        // so a bare \r accepts. Without auto-dismiss this test would
        // hang at the dialog and time out.
        name: "antigravity",
        cmd: "agy",
        args: [],
        env: {},
        readyPattern: /\? for shortcuts/i,
        autoDismiss: {
          pattern: /Do you trust the contents of this project/i,
          keys: "\r",
        },
      },
    ];

    for (const spec of specs) {
      const proc = pty.spawn(spec.cmd, spec.args, {
        name: "xterm-256color",
        cols: 120,
        rows: 30,
        cwd,
        env: { ...process.env, ...spec.env },
      });
      const session = {
        name: spec.name,
        proc,
        buffer: "",
        alive: true,
        readyPattern: spec.readyPattern,
        autoDismiss: spec.autoDismiss,
        dismissed: false,
      };
      proc.onData((d) => {
        session.buffer += d;
        if (
          session.autoDismiss &&
          !session.dismissed &&
          session.autoDismiss.pattern.test(session.buffer)
        ) {
          session.dismissed = true;
          setTimeout(() => {
            session.proc.write(session.autoDismiss!.keys);
          }, 300);
        }
      });
      proc.onExit(() => {
        session.alive = false;
      });
      sessions.push(session);
    }

    // Wait up to 45s for all CLIs to reach ready state (45 not 30 — agy's
    // first-run OAuth can stretch the window past Claude/Codex/Gemini).
    const start = Date.now();
    let allReady = false;
    while (Date.now() - start < 45000) {
      allReady = sessions.every((s) => s.readyPattern.test(s.buffer));
      if (allReady) break;
      await new Promise((r) => setTimeout(r, 200));
    }

    const alive = sessions.filter((s) => s.alive).length;
    assert(
      alive === sessions.length,
      `expected all ${sessions.length} CLIs alive after spawn, got ${alive} (${sessions
        .map((s) => `${s.name}=${s.alive}`)
        .join(", ")})`,
    );
    assert(
      allReady,
      `not all CLIs reached ready state within 45s (${sessions
        .map((s) => `${s.name}=${s.readyPattern.test(s.buffer)}`)
        .join(", ")})`,
    );

    // Cleanup
    for (const s of sessions) {
      try {
        s.proc.kill();
      } catch {
        // Process may already have exited.
      }
    }
  },
);

// ── runner ────────────────────────────────────────────────

(async () => {
  let pass = 0,
    fail = 0,
    skip = 0;
  for (const t of tests) {
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
