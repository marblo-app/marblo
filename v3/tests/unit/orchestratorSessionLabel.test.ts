import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  OrchestratorManager,
  ORCHESTRATOR_PROMPT_SIGNATURE,
  buildCodexBootHealthSummary,
  buildCodexBootInstructions,
  firstUserMessageStartsWith,
  isOrchestratorSession,
} from "../../electron/orchestrator-manager";
import { encodeClaudeProjectDir } from "../../electron/claude-paths";
import type { LaunchConfig } from "../../electron/agent-config";

/**
 * Regression tests for orchestrator session auto-reconnect.
 *
 * Root cause: reconnect matched only on the "Orchestrator" label, but in
 * real projects marblo-labels.json is frequently absent, so the orchestrator
 * always started fresh — while agents reconnected via a label-independent
 * fallback. The fix identifies the orchestrator's own session by a content
 * signature (its opening prompt) so labeling is precise in busy shared dirs
 * AND reconnect recovers the prior session with no labels file at all.
 */
describe("OrchestratorManager session reconnect", () => {
  let tmpHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  // A REAL directory. The crash auto-restart path now refuses to relaunch into
  // a rootPath that no longer exists (ticket 4xSVtpGzt5NJE4FISfmj) — a shell
  // spawned there dies in ~6ms with no error, so retrying it 3x was pure noise.
  // These tests exercise the RESTART logic, so their root has to exist.
  let rootPath: string;

  function sessionsDir(): string {
    return path.join(
      tmpHome,
      ".claude",
      "projects",
      encodeClaudeProjectDir(rootPath),
    );
  }
  function labelsPath(): string {
    return path.join(sessionsDir(), "marblo-labels.json");
  }
  function storePath(): string {
    return path.join(sessionsDir(), "marblo-orch-sessions.json");
  }
  function makeManager(kind = "board"): OrchestratorManager {
    const ptyManager = {
      onDanger: vi.fn(() => vi.fn()),
      setBlockDangerousForSession: vi.fn(),
    };
    const mgr = new OrchestratorManager(
      ptyManager as never,
      {} as never,
      undefined,
      kind,
    );
    (mgr as unknown as { session: unknown }).session = {
      sessionId: "orchestrator-x",
      ptySessionId: "pty-1",
      status: "starting",
      projectId: "x",
      rootPath,
    };
    return mgr;
  }
  // A real orchestrator session: newer metadata-prefixed format, then the
  // injected opening prompt as the first user turn.
  function writeOrchestratorJsonl(id: string, mtimeOffset = 0) {
    const lines = [
      JSON.stringify({ type: "last-prompt", value: "x" }),
      JSON.stringify({ type: "permission-mode", mode: "default" }),
      JSON.stringify({
        type: "user",
        message: {
          role: "user",
          content: `${ORCHESTRATOR_PROMPT_SIGNATURE}. Read the orchestrator skill file.`,
        },
      }),
      JSON.stringify({ type: "assistant", message: { content: "ok" } }),
    ];
    const p = path.join(sessionsDir(), `${id}.jsonl`);
    fs.writeFileSync(p, lines.join("\n") + "\n", "utf-8");
    if (mtimeOffset) {
      const t = new Date(Date.now() + mtimeOffset);
      fs.utimesSync(p, t, t);
    }
  }
  // A non-orchestrator session (agent or user) — different first user turn.
  function writeOtherJsonl(id: string) {
    const lines = [
      JSON.stringify({
        type: "user",
        message: { role: "user", content: "Fix the login bug please" },
      }),
      JSON.stringify({ type: "assistant", message: { content: "sure" } }),
    ];
    fs.writeFileSync(
      path.join(sessionsDir(), `${id}.jsonl`),
      lines.join("\n") + "\n",
      "utf-8",
    );
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "orch-label-"));
    rootPath = fs.mkdtempSync(path.join(os.tmpdir(), "orch-root-"));
    fs.mkdirSync(sessionsDir(), { recursive: true });
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
    fs.rmSync(rootPath, { recursive: true, force: true });
  });

  describe("firstUserMessageStartsWith", () => {
    it("matches the orchestrator opening prompt (string content)", () => {
      writeOrchestratorJsonl("a");
      expect(
        firstUserMessageStartsWith(
          path.join(sessionsDir(), "a.jsonl"),
          ORCHESTRATOR_PROMPT_SIGNATURE,
        ),
      ).toBe(true);
    });
    it("matches when content is an array of text blocks", () => {
      fs.writeFileSync(
        path.join(sessionsDir(), "arr.jsonl"),
        JSON.stringify({
          type: "user",
          message: {
            role: "user",
            content: [
              { type: "text", text: `${ORCHESTRATOR_PROMPT_SIGNATURE}.` },
            ],
          },
        }) + "\n",
        "utf-8",
      );
      expect(
        firstUserMessageStartsWith(
          path.join(sessionsDir(), "arr.jsonl"),
          ORCHESTRATOR_PROMPT_SIGNATURE,
        ),
      ).toBe(true);
    });
    it("does not match a non-orchestrator session", () => {
      writeOtherJsonl("b");
      expect(
        firstUserMessageStartsWith(
          path.join(sessionsDir(), "b.jsonl"),
          ORCHESTRATOR_PROMPT_SIGNATURE,
        ),
      ).toBe(false);
    });
  });

  describe("launch MCP env context", () => {
    function writeClaudeMcpConfig(filePath: string): void {
      fs.writeFileSync(
        filePath,
        JSON.stringify({ mcpServers: { marblo: { env: {} } } }),
        "utf-8",
      );
    }

    function writeCodexMcpConfig(filePath: string): void {
      fs.writeFileSync(
        filePath,
        [
          "[mcp_servers.marblo]",
          'command = "/Applications/Marblo.app/Contents/MacOS/Marblo"',
          'args = ["dist-mcp/index.js"]',
          "",
          "[mcp_servers.marblo.env]",
          'ELECTRON_RUN_AS_NODE = "1"',
          'MARBLO_AGENT_ID = "existing-agent"',
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    function makeLaunchManager(
      kind: string,
      mcpConfigPath: string,
      model: LaunchConfig["model"] = "claude",
      hasSavedSession = false,
    ): OrchestratorManager {
      const ptyManager = {
        create: vi.fn(),
        onData: vi.fn(),
        onDanger: vi.fn(() => vi.fn()),
        setBlockDangerousForSession: vi.fn(),
        onExit: vi.fn(),
        writeAndSubmit: vi.fn(),
        kill: vi.fn(),
      };
      const launchConfig: LaunchConfig = {
        model,
        command: model === "gpt" ? "codex" : "claude",
        args: [],
        env: {},
        mcpConfigPath,
        skillContent: "",
      };
      const configGenerator = {
        getLaunchConfig: vi.fn(() => launchConfig),
        hasSavedSession: vi.fn(() => hasSavedSession),
        cleanup: vi.fn(),
      };
      return new OrchestratorManager(
        ptyManager as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[0],
        configGenerator as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[1],
        undefined,
        kind,
      );
    }

    function makeInspectableLaunchManager(
      kind: string,
      mcpConfigPath: string,
      model: LaunchConfig["model"],
      hasSavedSession: boolean,
    ): {
      mgr: OrchestratorManager;
      ptyManager: {
        create: ReturnType<typeof vi.fn>;
        onData: ReturnType<typeof vi.fn>;
        onDanger: ReturnType<typeof vi.fn>;
        setBlockDangerousForSession: ReturnType<typeof vi.fn>;
        onExit: ReturnType<typeof vi.fn>;
        writeAndSubmit: ReturnType<typeof vi.fn>;
        kill: ReturnType<typeof vi.fn>;
      };
    } {
      const ptyManager = {
        create: vi.fn(),
        onData: vi.fn(),
        onDanger: vi.fn(() => vi.fn()),
        setBlockDangerousForSession: vi.fn(),
        onExit: vi.fn(),
        writeAndSubmit: vi.fn(),
        kill: vi.fn(),
      };
      const configGenerator = {
        getLaunchConfig: vi.fn(
          (
            _agent: unknown,
            _projectDir: string,
            _initialPrompt?: string,
            _marbloProjectId?: string,
            resume?: string,
          ) => ({
            model,
            command: model === "gpt" ? "codex" : "claude",
            args:
              model === "gpt" && resume && resume !== "new"
                ? ["resume", resume === "latest" ? "--last" : resume]
                : ([] as string[]),
            env: {} as Record<string, string>,
            mcpConfigPath,
            skillContent: "",
          }),
        ),
        hasSavedSession: vi.fn(() => hasSavedSession),
        cleanup: vi.fn(),
      };
      const mgr = new OrchestratorManager(
        ptyManager as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[0],
        configGenerator as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[1],
        undefined,
        kind,
      );
      return { mgr, ptyManager };
    }

    function readMcpEnv(filePath: string): Record<string, string | undefined> {
      const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        mcpServers: { marblo: { env: Record<string, string | undefined> } };
      };
      return config.mcpServers.marblo.env;
    }

    function readCodexMcpEnv(
      filePath: string,
    ): Record<string, string | undefined> {
      const config = fs.readFileSync(filePath, "utf-8");
      const match = /\[mcp_servers\.marblo\.env\]\n([\s\S]*?)(?=\n\[|$)/.exec(
        config,
      );
      if (!match) return {};
      const env: Record<string, string | undefined> = {};
      for (const line of match[1].split("\n")) {
        const lineMatch = /^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/.exec(
          line.trim(),
        );
        if (!lineMatch) continue;
        const [, key, rawValue] = lineMatch;
        const value = JSON.parse(rawValue) as unknown;
        if (typeof value === "string") {
          env[key] = value;
        }
      }
      return env;
    }

    it("injects MARBLO_CONTEXT=board for board orchestrators", () => {
      const mcpConfigPath = path.join(tmpHome, "board-mcp.json");
      writeClaudeMcpConfig(mcpConfigPath);
      const mgr = makeLaunchManager("board", mcpConfigPath);

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readMcpEnv(mcpConfigPath)).toMatchObject({
        ELECTRON_RUN_AS_NODE: "1",
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
        MARBLO_CONTEXT: "board",
      });
    });

    it("leaves MARBLO_CONTEXT unset for non-board orchestrators", () => {
      const mcpConfigPath = path.join(tmpHome, "mission-mcp.json");
      writeClaudeMcpConfig(mcpConfigPath);
      const mgr = makeLaunchManager("mission", mcpConfigPath);

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readMcpEnv(mcpConfigPath)).toMatchObject({
        ELECTRON_RUN_AS_NODE: "1",
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
      });
      expect(readMcpEnv(mcpConfigPath).MARBLO_CONTEXT).toBeUndefined();
    });

    it("patches codex TOML env without stripping existing Electron node mode", () => {
      const mcpConfigPath = path.join(tmpHome, "codex-config.toml");
      writeCodexMcpConfig(mcpConfigPath);
      const mgr = makeLaunchManager("board", mcpConfigPath, "gpt");

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readCodexMcpEnv(mcpConfigPath)).toMatchObject({
        ELECTRON_RUN_AS_NODE: "1",
        MARBLO_AGENT_ID: "existing-agent",
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
        MARBLO_CONTEXT: "board",
      });
    });

    // Regression (H7Es8X1l): grok 의 격리 GROK_HOME/config.toml 도 TOML 이라
    // JSON 분기로 보내면 `JSON.parse` 가 던지고 catch 가 삼킨다 → 브리지 포트/
    // 토큰이 통째로 유실돼 오케의 spawn_agent·dispatch_task 가 401 난다.
    it("patches grok TOML env (not the JSON branch) so the bridge token reaches its MCP", () => {
      const mcpConfigPath = path.join(tmpHome, "grok-config.toml");
      writeCodexMcpConfig(mcpConfigPath); // 같은 [mcp_servers.marblo] TOML 모양
      const mgr = makeLaunchManager("board", mcpConfigPath, "grok");

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readCodexMcpEnv(mcpConfigPath)).toMatchObject({
        ELECTRON_RUN_AS_NODE: "1",
        MARBLO_AGENT_ID: "existing-agent",
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
        MARBLO_CONTEXT: "board",
      });
    });

    it("resumes Codex with the native resume subcommand and skips the boot prompt", async () => {
      const mcpConfigPath = path.join(tmpHome, "codex-resume-config.toml");
      writeCodexMcpConfig(mcpConfigPath);
      const { mgr, ptyManager } = makeInspectableLaunchManager(
        "board",
        mcpConfigPath,
        "gpt",
        true,
      );

      const session = mgr.launch(
        "project-1",
        rootPath,
        12345,
        undefined,
        "latest",
        undefined,
        { modelOverride: "gpt" },
      );

      expect(session.launchConfig.args.slice(0, 2)).toEqual([
        "resume",
        "--last",
      ]);
      await vi.advanceTimersByTimeAsync(4000);
      expect(ptyManager.writeAndSubmit).not.toHaveBeenCalled();
      expect(mgr.getStatus()).toBe("running");
    });

    // 라이브 사고(0zV1apB3CvIiabHlYHxQ) 회귀 가드: claude uuid 가 codex 에
    // concrete id 로 넘어오면 `codex resume <uuid>` 는 exit 1 즉사한다. 저장된
    // codex 세션이 "있어도" 통과시키면 안 된다 — #464 이후 남아있던 구멍.
    it("discards a non-codex concrete resume id under gpt → resumes --last instead (saved session exists)", () => {
      const mcpConfigPath = path.join(tmpHome, "codex-guard-config.toml");
      writeCodexMcpConfig(mcpConfigPath);
      const { mgr, ptyManager } = makeInspectableLaunchManager(
        "board",
        mcpConfigPath,
        "gpt",
        true, // hasSavedSession
      );

      const claudeUuid = "c85a033d-077d-49fc-9201-ae14964a6d18";
      const session = mgr.launch(
        "project-1",
        rootPath,
        12345,
        undefined,
        claudeUuid,
        undefined,
        { modelOverride: "gpt" },
      );

      expect(session.launchConfig.args).not.toContain(claudeUuid);
      expect(session.launchConfig.args.slice(0, 2)).toEqual([
        "resume",
        "--last",
      ]);
      const ptyArgs = ptyManager.create.mock.calls[0][3] as string[];
      expect(ptyArgs).not.toContain(claudeUuid);
    });

    it("discards a non-codex concrete resume id under gpt → fresh when no saved codex session", () => {
      const mcpConfigPath = path.join(tmpHome, "codex-guard-fresh.toml");
      writeCodexMcpConfig(mcpConfigPath);
      const { mgr, ptyManager } = makeInspectableLaunchManager(
        "board",
        mcpConfigPath,
        "gpt",
        false, // no saved session
      );

      const claudeUuid = "c85a033d-077d-49fc-9201-ae14964a6d18";
      const session = mgr.launch(
        "project-1",
        rootPath,
        12345,
        undefined,
        claudeUuid,
        undefined,
        { modelOverride: "gpt" },
      );

      expect(session.launchConfig.args).not.toContain("resume");
      expect(session.launchConfig.args).not.toContain(claudeUuid);
      const ptyArgs = ptyManager.create.mock.calls[0][3] as string[];
      expect(ptyArgs).not.toContain(claudeUuid);
    });

    it("marks gpt mission ownership in the orch store (marker, not a claude uuid)", () => {
      const mcpConfigPath = path.join(tmpHome, "codex-mission-config.toml");
      writeCodexMcpConfig(mcpConfigPath);
      const { mgr } = makeInspectableLaunchManager(
        "mission",
        mcpConfigPath,
        "gpt",
        false,
      );

      mgr.launch("project-1", rootPath, 12345, undefined, "new", "mission-1", {
        modelOverride: "gpt",
      });

      const store = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      expect(store["mission:mission-1"]?.sessionId).toBe("gpt-latest");
      // 같은 미션만 소유자로 판정, 다른 미션은 fresh 로 가야 한다.
      expect(mgr.hasGptMissionMarker(rootPath, "mission-1")).toBe(true);
      expect(mgr.hasGptMissionMarker(rootPath, "mission-2")).toBe(false);
      // 마커는 claude resume 경로(resolveMissionResumeId)로 절대 새지 않는다 —
      // 실재 .jsonl 이 아니므로 isResumableSession 이 거부한다.
      expect(mgr.resolveMissionResumeId(rootPath, "mission-1")).toBeNull();
    });
  });

  describe("detectAndLabelNewSession (poll → signature → label)", () => {
    function detect(
      mgr: OrchestratorManager,
      existing: Set<string>,
      label: string,
    ) {
      (
        mgr as unknown as {
          detectAndLabelNewSession: (
            r: string,
            p: string,
            e: Set<string>,
            l: string,
          ) => void;
        }
      ).detectAndLabelNewSession(rootPath, "pty-1", existing, label);
    }

    it("labels the orchestrator session once its prompt appears (after first poll)", async () => {
      const mgr = makeManager();
      detect(mgr, new Set(), "Orchestrator");

      // First poll: nothing yet — must keep polling.
      await vi.advanceTimersByTimeAsync(2000);
      expect(fs.existsSync(labelsPath())).toBe(false);

      const id = "11111111-2222-3333-4444-555555555555";
      writeOrchestratorJsonl(id);
      await vi.advanceTimersByTimeAsync(2000);

      const labels = JSON.parse(fs.readFileSync(labelsPath(), "utf-8"));
      expect(labels[id]?.label).toBe("Orchestrator");
    });

    it("does NOT label a concurrent non-orchestrator session (busy shared dir)", async () => {
      const mgr = makeManager();
      detect(mgr, new Set(), "Orchestrator");

      // A noisy agent/background-job session appears — must be ignored.
      writeOtherJsonl("noise00-0000-0000-0000-000000000000");
      await vi.advanceTimersByTimeAsync(2000);
      expect(fs.existsSync(labelsPath())).toBe(false);

      // The real orchestrator session appears later → only this one is labeled.
      const orchId = "orch0000-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(orchId);
      await vi.advanceTimersByTimeAsync(2000);

      const labels = JSON.parse(fs.readFileSync(labelsPath(), "utf-8"));
      expect(labels[orchId]?.label).toBe("Orchestrator");
      expect(labels["noise00-0000-0000-0000-000000000000"]).toBeUndefined();
    });

    it("stops polling when the launch is superseded (stale pty)", async () => {
      const mgr = makeManager();
      (
        mgr as unknown as { session: { ptySessionId: string } }
      ).session.ptySessionId = "pty-2";
      detect(mgr, new Set(), "Orchestrator");
      writeOrchestratorJsonl("stale000-0000-0000-0000-000000000000");
      await vi.advanceTimersByTimeAsync(2000);
      expect(fs.existsSync(labelsPath())).toBe(false);
    });
  });

  describe("resolveOrchestratorResumeId", () => {
    it("recovers the prior session by content when NO labels file exists", () => {
      // The exact failure mode: sessions exist, no marblo-labels.json.
      writeOtherJsonl("agent000-0000-0000-0000-000000000000");
      const orchId = "orch1111-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(orchId);
      expect(fs.existsSync(labelsPath())).toBe(false);

      const mgr = makeManager();
      const resolved = mgr.resolveOrchestratorResumeId(rootPath);
      expect(resolved).toBe(orchId);
      // Self-heals the label for the fast path next time.
      const labels = JSON.parse(fs.readFileSync(labelsPath(), "utf-8"));
      expect(labels[orchId]?.label).toBe("Orchestrator");
    });

    it("returns the most-recent orchestrator session among several", () => {
      writeOrchestratorJsonl("old00000-0000-0000-0000-000000000000", -60_000);
      const recent = "new00000-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(recent, 60_000);
      const mgr = makeManager();
      expect(mgr.resolveOrchestratorResumeId(rootPath)).toBe(recent);
    });

    it("returns null when no orchestrator session exists", () => {
      writeOtherJsonl("only-agent-0000-0000-0000-000000000000");
      const mgr = makeManager();
      expect(mgr.resolveOrchestratorResumeId(rootPath)).toBeNull();
    });

    it("persists the recovered session to the dedicated store", () => {
      const orchId = "orch2222-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(orchId);
      const mgr = makeManager();
      expect(mgr.resolveOrchestratorResumeId(rootPath)).toBe(orchId);
      const store = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      expect(store.board?.sessionId).toBe(orchId);
    });
  });

  describe("isOrchestratorSession (agent fallback guard)", () => {
    it("is true for an orchestrator session, false for an agent session", () => {
      writeOrchestratorJsonl("orch5555-0000-0000-0000-000000000000");
      writeOtherJsonl("agent555-0000-0000-0000-000000000000");
      expect(
        isOrchestratorSession(rootPath, "orch5555-0000-0000-0000-000000000000"),
      ).toBe(true);
      expect(
        isOrchestratorSession(rootPath, "agent555-0000-0000-0000-000000000000"),
      ).toBe(false);
    });
    it("is false for a missing session", () => {
      expect(isOrchestratorSession(rootPath, "nope")).toBe(false);
    });
  });

  describe("dedicated stable-id store (agy-style primary path)", () => {
    it("resolves from the store without any labels file or content scan", () => {
      const orchId = "store000-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(orchId);
      const mgr = makeManager();
      mgr.saveOrchSessionId(rootPath, orchId);
      // Remove the label file to prove the store alone is enough.
      if (fs.existsSync(labelsPath())) fs.rmSync(labelsPath());
      expect(mgr.resolveOrchestratorResumeId(rootPath)).toBe(orchId);
    });

    it("ignores a stored id whose session no longer exists, falls back", () => {
      const mgr = makeManager();
      mgr.saveOrchSessionId(rootPath, "deleted0-0000-0000-0000-000000000000");
      const realId = "real0000-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(realId);
      // Stored id has no jsonl → must fall through to content recovery.
      expect(mgr.resolveOrchestratorResumeId(rootPath)).toBe(realId);
      const store = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      expect(store.board?.sessionId).toBe(realId);
    });

    it("keeps board and mission orchestrators under separate keys", () => {
      const boardId = "boardaaa-0000-0000-0000-000000000000";
      const missionId = "mission0-0000-0000-0000-000000000000";
      makeManager("board").saveOrchSessionId(rootPath, boardId);
      makeManager("mission").saveOrchSessionId(rootPath, missionId);
      const store = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      expect(store.board?.sessionId).toBe(boardId);
      expect(store.mission?.sessionId).toBe(missionId);
    });
  });

  // Regression: 새 미션을 시작하면 미션 오케스트레이터가 직전(아카이브된) 미션의
  // Claude 세션을 resume → /compact + 옛 컨텍스트로 첫 스텝이 stall 했다. 수정:
  // 세션을 mission 단위로 스코프 — 새 미션 = fresh("new"), 같은 미션 = resume.
  describe("mission-scoped resume (new mission = fresh, same mission = resume)", () => {
    // currentMissionId 를 주입한 mission 매니저 (full launch 없이 store 키잉 테스트용).
    function missionManager(missionId: string | null): OrchestratorManager {
      const mgr = makeManager("mission");
      (mgr as unknown as { currentMissionId: string | null }).currentMissionId =
        missionId;
      return mgr;
    }

    it("saves a mission session under a mission:<id> key with missionId recorded", () => {
      const mA = "m-aaaaaaaa";
      const sidA = "sessA000-0000-0000-0000-000000000000";
      missionManager(mA).saveOrchSessionId(rootPath, sidA);
      const store = JSON.parse(fs.readFileSync(storePath(), "utf-8"));
      expect(store[`mission:${mA}`]?.sessionId).toBe(sidA);
      expect(store[`mission:${mA}`]?.missionId).toBe(mA);
      // 레거시 단일 "mission" 키는 건드리지 않는다 (프로젝트 단위 오염 방지).
      expect(store.mission).toBeUndefined();
    });

    it("resumes the SAME mission's session, returns null (→ fresh) for a NEW mission", () => {
      const mA = "m-aaaaaaaa";
      const sidA = "sessA111-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(sidA); // 실재하는 resumable 세션
      missionManager(mA).saveOrchSessionId(rootPath, sidA);

      // 같은 미션 → resume.
      expect(makeManager("mission").resolveMissionResumeId(rootPath, mA)).toBe(
        sidA,
      );
      // 다른(새) 미션 → null → 호출부가 "new"(fresh)로 띄운다. ★ 핵심 회귀.
      expect(
        makeManager("mission").resolveMissionResumeId(rootPath, "m-bbbbbbbb"),
      ).toBeNull();
    });

    it("ignores a stored mission session whose jsonl no longer exists (→ fresh)", () => {
      const mA = "m-cccccccc";
      // 저장은 됐지만 .jsonl 이 없는(삭제된) 세션 → resumable 아님 → null.
      missionManager(mA).saveOrchSessionId(
        rootPath,
        "gone0000-0000-0000-0000-000000000000",
      );
      expect(
        makeManager("mission").resolveMissionResumeId(rootPath, mA),
      ).toBeNull();
    });

    it("board kind never mission-resumes (always null)", () => {
      const sid = "boardxxx-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(sid);
      makeManager("board").saveOrchSessionId(rootPath, sid);
      expect(
        makeManager("board").resolveMissionResumeId(rootPath, "whatever"),
      ).toBeNull();
    });

    it("tracks the running mission via getOwnerMissionId (used to swap on new mission)", () => {
      const mgr = missionManager("m-dddddddd");
      expect(mgr.getOwnerMissionId()).toBe("m-dddddddd");
      const fresh = makeManager("mission");
      expect(fresh.getOwnerMissionId()).toBeNull();
    });
  });

  // Regression: 오케 PTY 가 갑자기 꺼지고(crash, exit!=0) 자동재시작될 때, 직전에
  // 크래시한 *바로 그 세션* 을 resume 해 직전 컨텍스트가 그대로 보여야 한다(blank
  // 금지). 예전엔 board 가 launch(..., "latest") 로 재시작 → 라벨 전용 약한
  // resolver 를 타, marblo-labels.json 이 없으면(흔한 경우) 매치 실패 → fresh 세션
  // 부팅으로 직전 대화가 orphan(빈화면). 수정: robust resolver(store→라벨→컨텐츠
  // 시그니처)로 정확한 UUID 를 집어 재개한다.
  describe("crash auto-restart resumes the EXACT prior session (no blank)", () => {
    interface CreateCall {
      ptyId: string;
      args: string[];
    }

    function writeRestartCodexMcpConfig(filePath: string): void {
      fs.writeFileSync(
        filePath,
        [
          "[mcp_servers.marblo]",
          'command = "/Applications/Marblo.app/Contents/MacOS/Marblo"',
          'args = ["dist-mcp/index.js"]',
          "",
          "[mcp_servers.marblo.env]",
          'ELECTRON_RUN_AS_NODE = "1"',
          "",
        ].join("\n"),
        "utf-8",
      );
    }

    function makeRestartManager(
      kind = "board",
      model: LaunchConfig["model"] = "claude",
      hasSavedSession = false,
    ): {
      mgr: OrchestratorManager;
      createCalls: CreateCall[];
      exitCbs: Map<string, (code: number) => void>;
      mcpConfigPath: string;
    } {
      const createCalls: CreateCall[] = [];
      const exitCbs = new Map<string, (code: number) => void>();
      const mcpConfigPath = path.join(
        sessionsDir(),
        `${kind}-restart-mcp.${model === "gpt" ? "toml" : "json"}`,
      );
      if (model === "gpt") {
        writeRestartCodexMcpConfig(mcpConfigPath);
      } else {
        fs.writeFileSync(
          mcpConfigPath,
          JSON.stringify({ mcpServers: { marblo: { env: {} } } }),
          "utf-8",
        );
      }
      const ptyManager = {
        create: vi.fn(
          (ptyId: string, _name: string, _cmd: string, args: string[]) => {
            createCalls.push({ ptyId, args: [...args] });
          },
        ),
        onData: vi.fn(),
        onDanger: vi.fn(() => vi.fn()),
        setBlockDangerousForSession: vi.fn(),
        onExit: vi.fn((ptyId: string, cb: (code: number) => void) => {
          exitCbs.set(ptyId, cb);
        }),
        writeAndSubmit: vi.fn(),
        kill: vi.fn(),
      };
      // Fresh launch config per call so --resume args never accumulate across
      // relaunches (each launch must own its own args array).
      const configGenerator = {
        getLaunchConfig: vi.fn(
          (
            _agent: unknown,
            _projectDir: string,
            _initialPrompt?: string,
            _marbloProjectId?: string,
            resume?: string,
          ) => ({
            model,
            command: model === "gpt" ? "codex" : "claude",
            args:
              model === "gpt" && resume && resume !== "new"
                ? ["resume", resume === "latest" ? "--last" : resume]
                : ([] as string[]),
            env: {} as Record<string, string>,
            mcpConfigPath,
            skillContent: "",
          }),
        ),
        hasSavedSession: vi.fn(() => hasSavedSession),
        cleanup: vi.fn(),
      };
      const mgr = new OrchestratorManager(
        ptyManager as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[0],
        configGenerator as unknown as ConstructorParameters<
          typeof OrchestratorManager
        >[1],
        undefined,
        kind,
      );
      return { mgr, createCalls, exitCbs, mcpConfigPath };
    }

    it("resumes the crashed session by content signature even with NO labels/store file", async () => {
      const crashedId = "crashed0-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(crashedId);

      const { mgr, createCalls, exitCbs } = makeRestartManager("board");

      // Initial launch resuming the (about-to-crash) session.
      const session = mgr.launch(
        "proj-x",
        rootPath,
        4567,
        undefined,
        crashedId,
      );
      const firstPty = session.ptySessionId;
      expect(createCalls[0].args).toEqual(
        expect.arrayContaining(["--resume", crashedId]),
      );

      // Simulate the EXACT failure mode: the labels + store files are gone
      // (the documented "common case"). Only the content signature remains.
      if (fs.existsSync(labelsPath())) fs.rmSync(labelsPath());
      if (fs.existsSync(storePath())) fs.rmSync(storePath());

      // Crash (non-zero exit) → auto-restart timer.
      exitCbs.get(firstPty)?.(1);
      await vi.advanceTimersByTimeAsync(2100); // past 2s backoff

      // The relaunch must resume the SAME session — recovered by content
      // signature — not boot a fresh one (which would render blank/orphan).
      const relaunch = createCalls[createCalls.length - 1];
      expect(relaunch.ptyId).not.toBe(firstPty);
      expect(relaunch.args).toEqual(
        expect.arrayContaining(["--resume", crashedId]),
      );
    });

    it("does NOT pass the weak literal 'latest' to the restart launch", async () => {
      const crashedId = "crashed1-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(crashedId);
      const { mgr, createCalls, exitCbs } = makeRestartManager("board");
      const { ptySessionId: firstPty } = mgr.launch(
        "proj-x",
        rootPath,
        4567,
        undefined,
        crashedId,
      );

      exitCbs.get(firstPty)?.(1);
      await vi.advanceTimersByTimeAsync(2100);

      const relaunch = createCalls[createCalls.length - 1];
      // The crashed session is concrete; "latest" must never leak through.
      expect(relaunch.args).not.toContain("latest");
      expect(relaunch.args).toEqual(
        expect.arrayContaining(["--resume", crashedId]),
      );
    });

    it("boots fresh (no --resume) when the prior session is genuinely gone", async () => {
      const crashedId = "crashed2-0000-0000-0000-000000000000";
      writeOrchestratorJsonl(crashedId);
      const { mgr, createCalls, exitCbs } = makeRestartManager("board");
      const { ptySessionId: firstPty } = mgr.launch(
        "proj-x",
        rootPath,
        4567,
        undefined,
        crashedId,
      );

      // The session jsonl disappears (deleted) AND labels/store are gone →
      // nothing resumable. Must start fresh rather than --resume a ghost.
      fs.rmSync(path.join(sessionsDir(), `${crashedId}.jsonl`));
      if (fs.existsSync(labelsPath())) fs.rmSync(labelsPath());
      if (fs.existsSync(storePath())) fs.rmSync(storePath());

      exitCbs.get(firstPty)?.(1);
      await vi.advanceTimersByTimeAsync(2100);

      const relaunch = createCalls[createCalls.length - 1];
      expect(relaunch.args).not.toContain("--resume");
    });

    it("restarts Codex with native resume --last instead of a fresh boot", async () => {
      const { mgr, createCalls, exitCbs } = makeRestartManager(
        "board",
        "gpt",
        true,
      );
      const { ptySessionId: firstPty } = mgr.launch(
        "proj-x",
        rootPath,
        4567,
        undefined,
        "latest",
        undefined,
        { modelOverride: "gpt" },
      );
      expect(createCalls[0].args.slice(0, 2)).toEqual(["resume", "--last"]);

      exitCbs.get(firstPty)?.(1);
      await vi.advanceTimersByTimeAsync(2100);

      const relaunch = createCalls[createCalls.length - 1];
      expect(relaunch.ptyId).not.toBe(firstPty);
      expect(relaunch.args.slice(0, 2)).toEqual(["resume", "--last"]);
      expect(relaunch.args).not.toContain("latest");
    });
  });
});

describe("Codex orchestrator boot prompt", () => {
  const surface = {
    codexHome: "/tmp/codex-home-orch",
    configPath: "/tmp/codex-home-orch/config.toml",
    marbloMcpConfigured: true,
    tfPromptCount: 14,
    requiredTfPromptsPresent: true,
    fallbackCliPresent: true,
    fallbackCliPath: "/tmp/codex-home-orch/bin/marblo-fallback",
  };

  it("keeps startup instructions slim while preserving MCP, tf, and fallback guidance", () => {
    const prompt = buildCodexBootInstructions({ surface });

    expect(prompt).toContain('get_agent_skill("orchestrator")');
    expect(prompt).toContain("create_task");
    expect(prompt).toContain("create_tasks_bulk");
    expect(prompt).toContain("dispatch_task");
    expect(prompt).toContain(surface.fallbackCliPath);
    expect(prompt).not.toMatch(/first response/i);
    expect(prompt).not.toMatch(/boot health summary/i);
    expect(prompt).not.toMatch(/Count the Marblo MCP tools/i);
  });

  it("keeps health summary diagnostic-only and compact", () => {
    const summary = buildCodexBootHealthSummary({
      projectId: "project-1",
      contextId: "board",
      bridgeConnected: true,
      surface,
    });

    expect(summary).toContain("mcp=yes");
    expect(summary).toContain("bridge=yes");
    expect(summary).toContain("requiredTools=");
    expect(summary).not.toContain(surface.fallbackCliPath);
    expect(summary.split("\n").length).toBeLessThanOrEqual(8);
  });
});
