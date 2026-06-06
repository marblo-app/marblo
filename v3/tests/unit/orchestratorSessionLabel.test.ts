import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import {
  OrchestratorManager,
  ORCHESTRATOR_PROMPT_SIGNATURE,
  firstUserMessageStartsWith,
  isOrchestratorSession,
} from "../../electron/orchestrator-manager";
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
  const rootPath = "/proj/marblo-x";
  const encoded = rootPath.replace(/\//g, "-");

  function sessionsDir(): string {
    return path.join(tmpHome, ".claude", "projects", encoded);
  }
  function labelsPath(): string {
    return path.join(sessionsDir(), "marblo-labels.json");
  }
  function storePath(): string {
    return path.join(sessionsDir(), "marblo-orch-sessions.json");
  }
  function makeManager(kind = "board"): OrchestratorManager {
    const mgr = new OrchestratorManager(
      {} as never,
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
    fs.mkdirSync(sessionsDir(), { recursive: true });
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
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
    function writeMcpConfig(filePath: string): void {
      fs.writeFileSync(
        filePath,
        JSON.stringify({ mcpServers: { marblo: { env: {} } } }),
        "utf-8",
      );
    }

    function makeLaunchManager(
      kind: string,
      mcpConfigPath: string,
    ): OrchestratorManager {
      const ptyManager = {
        create: vi.fn(),
        onData: vi.fn(),
        onExit: vi.fn(),
        writeAndSubmit: vi.fn(),
        kill: vi.fn(),
      };
      const launchConfig: LaunchConfig = {
        model: "claude",
        command: "claude",
        args: [],
        env: {},
        mcpConfigPath,
        skillContent: "",
      };
      const configGenerator = {
        getLaunchConfig: vi.fn(() => launchConfig),
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

    function readMcpEnv(filePath: string): Record<string, string | undefined> {
      const config = JSON.parse(fs.readFileSync(filePath, "utf-8")) as {
        mcpServers: { marblo: { env: Record<string, string | undefined> } };
      };
      return config.mcpServers.marblo.env;
    }

    it("injects MARBLO_CONTEXT=board for board orchestrators", () => {
      const mcpConfigPath = path.join(tmpHome, "board-mcp.json");
      writeMcpConfig(mcpConfigPath);
      const mgr = makeLaunchManager("board", mcpConfigPath);

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readMcpEnv(mcpConfigPath)).toMatchObject({
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
        MARBLO_CONTEXT: "board",
      });
    });

    it("leaves MARBLO_CONTEXT unset for non-board orchestrators", () => {
      const mcpConfigPath = path.join(tmpHome, "mission-mcp.json");
      writeMcpConfig(mcpConfigPath);
      const mgr = makeLaunchManager("mission", mcpConfigPath);

      mgr.launch("project-1", rootPath, 12345, undefined, "new");

      expect(readMcpEnv(mcpConfigPath)).toMatchObject({
        MARBLO_BRIDGE_PORT: "12345",
        MARBLO_PROJECT: "project-1",
      });
      expect(readMcpEnv(mcpConfigPath).MARBLO_CONTEXT).toBeUndefined();
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
});
