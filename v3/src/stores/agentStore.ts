import { create } from "zustand";
import { where } from "firebase/firestore";
import type { Agent, AgentStatus } from "../types/agent";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as agentService from "../services/agentService";
import { usePtyMirrorStore } from "./ptyMirrorStore";
import { getSessionIdForAgent } from "./agentSessionMap";
import { useProjectStore } from "./projectStore";
import { useSubscriptionStore } from "./subscriptionStore";
import { useUiStore } from "./uiStore";
import { checkAgentSpawn } from "../lib/planLimits";
import { t } from "../lib/i18n";

const COLLECTION = "agents";
const DATE_FIELDS = ["createdAt"];

function toAgent(raw: Record<string, unknown>): Agent {
  return convertTimestamps<Agent>(raw, DATE_FIELDS);
}

function dedupeAgentsById(agents: Agent[]): Agent[] {
  const byId = new Map<string, Agent>();
  for (const agent of agents) {
    byId.set(agent.id, agent);
  }
  return Array.from(byId.values());
}

interface AgentState {
  agents: Agent[];
  // Account-global agents (where ownerId == uid), independent of the
  // currently selected project. Used only for the rate-limit panel, which
  // must aggregate across ALL projects: Claude/Codex rate limits are
  // account/subscription-global, so an agent in any project burns the same
  // limit. Cost/spend aggregation stays project-scoped via `agents`.
  ownedAgents: Agent[];
  loading: boolean;
  error: string | null;

  subscribeToAgents: (projectId: string) => () => void;
  subscribeToOwnedAgents: (ownerId: string) => () => void;
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
  ownedAgents: [],
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
        set({ agents: dedupeAgentsById(docs.map(toAgent)), loading: false });
      },
    );
  },

  // Subscribe to every agent the user owns, across all projects. Single
  // equality filter (ownerId) — no composite index. Feeds the rate-limit
  // panel so the account-global limit shows the same regardless of which
  // project is selected, including projects that never probed it themselves.
  subscribeToOwnedAgents: (ownerId: string) => {
    if (!ownerId) {
      set({ ownedAgents: [] });
      return () => {};
    }
    return subscribeToCollection<Record<string, unknown>>(
      COLLECTION,
      [where("ownerId", "==", ownerId)],
      (docs) => {
        set({ ownedAgents: dedupeAgentsById(docs.map(toAgent)) });
      },
    );
  },

  createAgent: async (data) => {
    try {
      // Plan throttle: gate before creating the Firestore doc so a
      // blocked free user doesn't leave a leftover row behind.
      const plan = useSubscriptionStore.getState().getPlan();
      const check = checkAgentSpawn(plan, get().agents);
      if (!check.allowed) {
        const msg = check.reason ?? t("common.agentLimitReached");
        set({ error: msg });
        // Surface the upgrade path (Free hit the fair-use agent cap).
        useUiStore.getState().showUpgrade("agents", "pro");
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
        projectId,
        agent.currentTaskId ?? undefined,
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
      // Fleet 프리뷰 미러 회수 — 삭제된 에이전트의 버퍼/attached/리스너가 앱
      // 수명 내내 누적되지 않게(P2-8). 세션 id 는 launch 시 매핑되며 없으면
      // 결정적 `agent-${id}` fallback.
      usePtyMirrorStore.getState().release(getSessionIdForAgent(id));
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
        const msg = check.reason ?? t("common.agentLimitReached");
        set({ error: msg });
        useUiStore.getState().showUpgrade("agents", "pro");
        throw new Error(msg);
      }
      const projectId = useProjectStore.getState().currentProject?.id;
      await window.electronAPI.agent.launch(
        agent,
        cwd,
        undefined,
        undefined,
        projectId,
        agent.currentTaskId ?? undefined,
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
      (a: Agent) => a.name.toLowerCase() === name.toLowerCase(),
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
        // 재시작 이벤트는 우측 ActivityStreamPanel 에서 audit_logs 로 노출되며,
        // 팀 채팅(messages) 에는 보내지 않는다 — 채팅은 사람 간 대화 전용.
        const currentAgents = get().agents;
        const restartedAgent = currentAgents.find((a: Agent) => a.id === id);
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
              }`,
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
      // taskId 를 함께 넘겨 worktreeCoordinator.prepare 가 task 워크트리에서
      // 부팅하도록 한다 — 안 넘기면 앱 재시작 후 재기동된 task 에이전트가 repo
      // root 에서 떠 격리가 깨진다(launchAgent/createAgent 와 동일 규약).
      const launchResult = await window.electronAPI.agent.launch(
        agent,
        cwd,
        undefined,
        undefined,
        undefined,
        agent.currentTaskId ?? undefined,
      );
      await agentService.updateAgent(id, { status: "idle" as AgentStatus });

      // Attach terminal session (MODEL_ICONS hoisted to top of restartAgent)
      const { useTerminalStore } = await import("./terminalStore");
      useTerminalStore
        .getState()
        .attachSession(
          launchResult.ptySessionId,
          `${MODEL_ICONS[agent.model] || "⚪"} ${agent.name}`,
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

// ── Agent status listeners (module-level IPC bridge) ─────────────────
// Registered once per renderer window. Two channels feed Firestore:
//
//   • agent:syncStatus  — Bridge Server BROADCASTS to every window when
//     dispatch_task changes an agent's status (bridge-server.ts). If each
//     window wrote, N popout windows would issue N identical (idempotent)
//     Firestore writes → quota waste (P2-6). So only the LEADER window (the
//     main, non-popout window) performs the write.
//   • agent:statusChanged — main SCOPES this to the owning project's window(s)
//     (main.ts:538 sendToProject), i.e. delivery already dedupes to the window
//     showing that project. That window writes. Leader-gating THIS would drop
//     the write whenever a popout — not the main window — owns the agent's
//     project, so it is intentionally left project-scoped, not leader-gated.
//
// Tradeoff noted: popout windows inherit the main window's project on creation,
// so in the dominant topology the leader (main) does hold the synced agent and
// the write lands. A popout that later switches to a *different* project than
// main is the rare edge where a syncStatus write could be skipped; the status
// re-syncs on the next event (recoverable, matches the P2 rating).
//
// HMR: Vite re-evaluates this module on save. Without teardown each reload
// stacks another ipcRenderer.on, multiplying every Firestore write. The
// import.meta.hot.dispose below clears both channels via the generic off()
// (off(channel) === ipcRenderer.removeAllListeners(channel)) before re-eval —
// no dedicated preload removal path is required.

// Leader = the single main window. Popouts (Board/Code/History detached tabs)
// launch with --marblo-new-window. Absent API (unit tests / SSR) → treat as
// leader so the write still happens in non-Electron contexts.
function isLeaderWindow(): boolean {
  if (typeof window === "undefined") return false;
  const isNew = window.electronAPI?.window?.isNewWindow?.();
  return isNew !== true;
}

function registerAgentStatusListeners(): void {
  if (typeof window === "undefined") return;
  const agentApi = window.electronAPI?.agent;
  if (!agentApi) return;

  if (agentApi.onSyncStatus) {
    agentApi.onSyncStatus(({ agentName, status, currentTaskId }) => {
      // Broadcast channel — only the leader window writes (see header note).
      if (!isLeaderWindow()) return;

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
        (a) => a.name.toLowerCase() === agentName.toLowerCase(),
      );
      if (match) {
        agentService.updateAgent(match.id, updates).catch((err) => {
          console.error(
            "[AgentStore] Failed to sync agent status to Firestore:",
            err,
          );
        });
      }
    });
  }

  // AgentManager emits 'agent:statusChanged' when a PTY transitions
  // (launch → idle, exit → stopped, restart-fail → error). On app restart the
  // reconnect path re-spawns the PTY and emits this so the renderer can sync
  // Firestore back to "idle". Without it, auto-reconnected agents stayed
  // visible as their pre-quit status and looked dead though the PTY was alive.
  //
  // agentId here is the Firestore doc id, so we update the doc directly instead
  // of name-matching like onSyncStatus does above.
  if (agentApi.onStatusChange) {
    agentApi.onStatusChange(({ agentId, status }) => {
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
            err,
          );
        });
    });
  }
}

registerAgentStatusListeners();

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    if (typeof window === "undefined") return;
    // Drop this module's listeners so the re-evaluated module re-registers
    // exactly once instead of stacking a second handler on each channel.
    window.electronAPI?.off?.("agent:syncStatus");
    window.electronAPI?.off?.("agent:statusChanged");
  });
}
