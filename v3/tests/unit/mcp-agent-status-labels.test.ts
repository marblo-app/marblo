import { describe, expect, it } from "vitest";
import {
  formatAgentTaskRoleLabel,
  normalizeFirestoreFallbackAgentStatus,
} from "../../electron/mcp-server/agent-status-labels";

describe("MCP agent/task role labels", () => {
  it("uses a single role label when agent and task roles match", () => {
    expect(formatAgentTaskRoleLabel("backend", "backend")).toBe("role=backend");
  });

  it("shows both roles when a reused agent handles a different task role", () => {
    expect(formatAgentTaskRoleLabel("frontend", "devops")).toBe(
      "agentRole=devops, taskRole=frontend",
    );
  });

  it("falls back to the task role when the agent role is unavailable", () => {
    expect(formatAgentTaskRoleLabel("test", null)).toBe("role=test");
  });
});

describe("Firestore fallback agent status", () => {
  it("does not present persisted active states as live when bridge is absent", () => {
    expect(normalizeFirestoreFallbackAgentStatus("working")).toEqual({
      status: "stopped",
      staleActive: true,
    });
    expect(normalizeFirestoreFallbackAgentStatus("idle")).toEqual({
      status: "stopped",
      staleActive: true,
    });
  });

  it("preserves terminal statuses", () => {
    expect(normalizeFirestoreFallbackAgentStatus("stopped")).toEqual({
      status: "stopped",
      staleActive: false,
    });
    expect(normalizeFirestoreFallbackAgentStatus("error")).toEqual({
      status: "error",
      staleActive: false,
    });
  });
});
