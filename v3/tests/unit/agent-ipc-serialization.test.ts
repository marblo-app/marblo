/**
 * Regression test for the `agent:list` IPC crash.
 *
 *   Symptom — calling `agent:list` (and any IPC handler returning agent
 *   objects) threw "An object could not be cloned" once an agent was live.
 *   Electron copies an `ipcMain.handle` return value to the renderer with the
 *   structured-clone algorithm, which cannot clone functions or host objects.
 *   A running AgentInstance carries an `onPtyReady` callback, `restartTimer` /
 *   `heartbeatTimer` Timer handles, and a `launchConfig` — so returning the
 *   raw instance was always fatal once a heartbeat timer / callback was set.
 *
 *   Fix — serializeAgent() projects an AgentInstance down to the serializable
 *   scalars the renderer consumes; the handler maps every agent through it.
 *
 * agent-manager pulls in node-pty (native) + electron + telemetry via its
 * import graph, so we stub those exactly like agent-lifecycle.test.ts.
 */

import { describe, it, expect, vi } from "vitest";

vi.mock("node-pty", () => ({ spawn: () => ({}) }));
vi.mock("electron", () => ({ BrowserWindow: class {} }));
vi.mock("../../electron/claude-paths", () => ({
  encodeClaudeProjectDir: (p: string) => p.replace(/\//g, "-"),
}));
vi.mock("../../electron/telemetry", () => ({ mainTelemetry: {} }));

import {
  serializeAgent,
  type AgentInstance,
} from "../../electron/agent-manager";

/**
 * Build an AgentInstance carrying every structured-clone-hostile field — a
 * function (onPtyReady), live Timer handles, and a nested launchConfig. This
 * mirrors what a running / restored agent looks like in the map.
 */
function makeRunningAgent(): AgentInstance {
  return {
    id: "agent-1",
    name: "backend-1",
    model: "claude",
    role: "backend",
    ptySessionId: "agent-agent-1",
    status: "working",
    command: "claude",
    cwd: "/tmp/project",
    currentTaskId: "task-1",
    launchConfig: {
      env: { MARBLO_PROJECT: "proj-1" },
    } as AgentInstance["launchConfig"],
    restartCount: 0,
    fastFailCount: 0,
    spawnedAt: 1,
    lastExitCode: null,
    stopRequested: false,
    restartTimer: setTimeout(() => {}, 60_000),
    heartbeatTimer: setInterval(() => {}, 30_000),
    onPtyReady: () => {},
    lastPtyActivity: 0,
  };
}

describe("agent:list IPC serialization (regression)", () => {
  it("a raw AgentInstance is NOT structured-clone-able (documents the bug)", () => {
    const agent = makeRunningAgent();
    try {
      expect(() => structuredClone(agent)).toThrow();
    } finally {
      clearTimeout(agent.restartTimer ?? undefined);
      clearInterval(agent.heartbeatTimer ?? undefined);
    }
  });

  it("serializeAgent output survives structuredClone and a JSON round-trip", () => {
    const agent = makeRunningAgent();
    try {
      const plain = serializeAgent(agent);

      expect(() => structuredClone(plain)).not.toThrow();
      expect(() => JSON.stringify(plain)).not.toThrow();
      expect(JSON.parse(JSON.stringify(plain))).toEqual(plain);

      expect(plain).toEqual({
        id: "agent-1",
        name: "backend-1",
        model: "claude",
        role: "backend",
        ptySessionId: "agent-agent-1",
        status: "working",
        currentTaskId: "task-1",
      });
      // No function / Timer / nested config leaked through.
      expect(Object.values(plain).every((v) => typeof v !== "function")).toBe(
        true,
      );
    } finally {
      clearTimeout(agent.restartTimer ?? undefined);
      clearInterval(agent.heartbeatTimer ?? undefined);
    }
  });
});
