import { create } from "zustand";
import { where } from "firebase/firestore";
import type { Agent, AgentStatus } from "../types/agent";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as agentService from "../services/agentService";
import { useProjectStore } from "./projectStore";
import { useSubscriptionStore } from "./subscriptionStore";
import { checkAgentSpawn } from "../lib/planLimits";

const COLLECTION = "agents";
const DATE_FIELDS = ["createdAt"];

function toAgent(raw: Record<string, unknown>): Agent {
  return convertTimestamps<Agent>(raw, DATE_FIELDS);
}

interface AgentState {
  agents: Agent[];
  loading: boolean;
  error: string | null;

  subscribeToAgents: (projectId: string) => () => void;
  createAgent: (data: Omit<Agent, "id" | "createdAt">) => Promise<string>;
  updateAgent: (id: string, data: Partial<Agent>) => Promise<void>;
  deleteAgent: (id: string) => Promise<void>;
  launchAgent: (agent: Agent, cwd: string) => Promise<void>;
  stopAgent: (id: string) => Promise<void>;
  restartAgent: (id: string) => Promise<void>;
  getAgentByName: (name: string) => Agent | undefined;
  clearError: () => void;
}

export const useAgentStore = create<AgentState>((set, get) => ({
  agents: [],
  loading: false,
  error: null,

  subscribeToAgents: (projectId: string) => {
    if (!projectId) {
      set({ agents: [], loading: false });
      return () => {};
    }
    set({ loading: true });
    return subscribeToCollection<Record<string, unknown>>(
      COLLECTION,
      [where("projectId", "==", projectId)],
      (docs) => {
        set({ agents: docs.map(toAgent), loading: false });
      }
    );
  },

  createAgent: async (data) => {
    try {
      // Plan throttle: gate before creating the Firestore doc so a
      // blocked free user doesn't leave a leftover row behind.
      const plan = useSubscriptionStore.getState().getPlan();
      const check = checkAgentSpawn(plan, get().agents);
      if (!check.allowed) {
        const msg =
          check.reason ?? "현재 플랜의 동시 에이전트 한도에 도달했습니다.";
        set({ error: msg });
        throw new Error(msg);
      }
      const id = await agentService.createAgent(data);
      // Launch via IPC — pass current project ID for MCP context
      const agent = { ...data, id, createdAt: new Date() } as Agent;
      const projectId = useProjectStore.getState().currentProject?.id;
      await window.electronAPI.agent.launch(
        agent,
        "",
        undefined,
        undefined,
        projectId
      );
      return id;
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to create agent",
      });
      throw err;
    }
  },

  updateAgent: async (id, data) => {
    await agentService.updateAgent(id, data);
  },

  deleteAgent: async (id) => {
    try {
      try {
        await window.electronAPI.agent.stop(id);
      } catch {
        // Agent may not be running
      }
      // Remove from AgentManager in-memory map
      await window.electronAPI.agent.remove(id).catch(() => {});
      // Delete from Firestore
      await agentService.deleteAgent(id);
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to delete agent",
      });
      throw err;
    }
  },

  launchAgent: async (agent, cwd) => {
    try {
      // Re-check on direct launch too — Firestore doc may exist (created
      // earlier) but the user could still be over the active limit if
      // they've spun up others since. The agent being relaunched is
      // currently stopped, so it doesn't count toward `active`.
      const plan = useSubscriptionStore.getState().getPlan();
      const others = get().agents.filter((a) => a.id !== agent.id);
      const check = checkAgentSpawn(plan, others);
      if (!check.allowed) {
        const msg =
          check.reason ?? "현재 플랜의 동시 에이전트 한도에 도달했습니다.";
        set({ error: msg });
        throw new Error(msg);
      }
      const projectId = useProjectStore.getState().currentProject?.id;
      await window.electronAPI.agent.launch(
        agent,
        cwd,
        undefined,
        undefined,
        projectId
      );
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to launch agent",
      });
      throw err;
    }
  },

  stopAgent: async (id) => {
    try {
      await window.electronAPI.agent.stop(id);
      await agentService.updateAgent(id, { status: "stopped" as AgentStatus });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to stop agent",
      });
      throw err;
    }
  },

  getAgentByName: (name: string): Agent | undefined => {
    const { agents } = get();
    return agents.find(
      (a: Agent) => a.name.toLowerCase() === name.toLowerCase()
    );
  },

  restartAgent: async (id) => {
    try {
      const MODEL_ICONS: Record<string, string> = {
        claude: "🟣",
        gemini: "🔵",
        gpt: "🟢",
        antigravity: "🟠",
        local: "⚫",
        custom: "⚪",
      };
      const result = await window.electronAPI.agent.restart(id);
      if (result) {
        await agentService.updateAgent(id, { status: "idle" as AgentStatus });
        // Send restart notification to chat
        const currentAgents = get().agents;
        const restartedAgent = currentAgents.find((a: Agent) => a.id === id);
        const projectId = useProjectStore.getState().currentProject?.id;
        if (restartedAgent && projectId) {
          import("../services/agentNotificationService").then(
            ({ notifyAgentRestarted }) => {
              notifyAgentRestarted(projectId, restartedAgent.name).catch(
                () => {}
              );
            }
          );
        }
        // Re-register the (possibly new) PTY in the renderer's terminalStore.
        // restart() kills the old PTY and creates a new one with the same
        // `agent-${id}` ptySessionId; the old terminalStore entry may have
        // been detached (project switch, window reopen) and never re-attached
        // — without this, AgentListPanel's row.ptySessionId stays undefined
        // even though the PTY is alive, and the user keeps seeing the Start
        // placeholder.
        if (restartedAgent && result.ptySessionId) {
          const { useTerminalStore } = await import("./terminalStore");
          useTerminalStore
            .getState()
            .attachSession(
              result.ptySessionId,
              `${MODEL_ICONS[restartedAgent.model] || "⚪"} ${
                restartedAgent.name
              }`
            );
        }
        return;
      }
      // Restart returned null — agent not in Electron memory (app was restarted).
      // Re-launch using Firestore data.
      const { agents } = get();
      const agent = agents.find((a: Agent) => a.id === id);
      if (!agent) throw new Error("Agent not found");

      // Use the project's rootPath as cwd. Previously hardcoded "~" which
      // meant restarted agents booted in the user's home dir instead of the
      // project — breaking file access from inside the agent.
      const { useEditorStore } = await import("./editorStore");
      const cwd = useEditorStore.getState().rootPath ?? "~";
      const launchResult = await window.electronAPI.agent.launch(agent, cwd);
      await agentService.updateAgent(id, { status: "idle" as AgentStatus });

      // Attach terminal session (MODEL_ICONS hoisted to top of restartAgent)
      const { useTerminalStore } = await import("./terminalStore");
      useTerminalStore
        .getState()
        .attachSession(
          launchResult.ptySessionId,
          `${MODEL_ICONS[agent.model] || "⚪"} ${agent.name}`
        );
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to restart agent",
      });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));

// ── Agent sync status listener ──────────────────────────────
// Bridge Server sends 'agent:syncStatus' when dispatch_task changes an agent's
// status. We update Firestore so the real-time subscription picks it up in the UI.
if (typeof window !== "undefined" && window.electronAPI?.agent?.onSyncStatus) {
  window.electronAPI.agent.onSyncStatus(
    ({ agentName, status, currentTaskId }) => {
      const updates: Partial<{
        status: AgentStatus;
        currentTaskId: string | null;
      }> = {
        status: status as AgentStatus,
      };
      if (currentTaskId !== undefined) {
        updates.currentTaskId = currentTaskId;
      }

      // Match by name — AgentManager UUID != Firestore doc ID, but names are shared
      const { agents } = useAgentStore.getState();
      const match = agents.find(
        (a) => a.name.toLowerCase() === agentName.toLowerCase()
      );
      if (match) {
        agentService.updateAgent(match.id, updates).catch((err) => {
          console.error(
            "[AgentStore] Failed to sync agent status to Firestore:",
            err
          );
        });
      }
    }
  );
}

// ── Agent PTY status listener ──────────────────────────────
// AgentManager broadcasts 'agent:statusChanged' when a PTY transitions
// (launch → idle, exit → stopped, restart-fail → error). On app restart
// the reconnect path re-spawns the PTY and emits this so the renderer can
// sync Firestore back to "idle". Without this, agents that auto-reconnected
// stayed visible as their pre-quit status (often "stopped"/"working") and
// looked dead even though the PTY was alive.
//
// agentId here is the Firestore doc id (same as AgentManager's internal id
// for agents that were created through the normal UI path), so we update
// the doc directly instead of name-matching like onSyncStatus does above.
if (
  typeof window !== "undefined" &&
  window.electronAPI?.agent?.onStatusChange
) {
  window.electronAPI.agent.onStatusChange(({ agentId, status }) => {
    if (!agentId) return;
    agentService
      .updateAgent(agentId, { status: status as AgentStatus })
      .catch((err) => {
        // Non-fatal: doc may not exist yet (race with Firestore subscribe)
        // or may have been deleted. Log for visibility only.
        console.warn(
          "[AgentStore] Failed to sync PTY status to Firestore:",
          agentId,
          status,
          err
        );
      });
  });
}
