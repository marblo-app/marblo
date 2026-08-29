import { useState, useEffect, useCallback } from "react";
import { where } from "firebase/firestore";
import type { Agent, AgentStatus } from "../types/agent";
import {
  subscribeToCollection,
  convertTimestamps,
} from "../services/firestore";
import * as agentService from "../services/agentService";
import {
  filterVisibleProjectAgents,
  projectAgentQueryScope,
} from "../services/agentVisibility";
import { useProjectStore } from "../stores/projectStore";

const COLLECTION = "agents";
const DATE_FIELDS = ["createdAt"];

function toAgent(raw: Record<string, unknown>): Agent {
  return convertTimestamps<Agent>(raw, DATE_FIELDS);
}

function agentVisibilityContext(projectId: string) {
  const { currentProject, projects, subscribedUserId, machineId } =
    useProjectStore.getState();
  const project =
    currentProject?.id === projectId
      ? currentProject
      : projects.find((candidate) => candidate.id === projectId);
  return {
    projectOwnerId: project?.ownerId ?? null,
    viewerUserId: subscribedUserId,
    localMachineId: machineId,
  };
}

export function useAgents(projectId: string) {
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Real-time subscription to Firestore
  useEffect(() => {
    if (!projectId) {
      setAgents([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const context = agentVisibilityContext(projectId);
    const scope = projectAgentQueryScope(context);
    if (scope.kind === "none") {
      setAgents([]);
      setLoading(false);
      return;
    }
    const constraints = [
      where("projectId", "==", projectId),
      ...(scope.kind === "machine"
        ? [where("machineId", "==", scope.machineId)]
        : []),
    ];
    const unsubscribe = subscribeToCollection<Record<string, unknown>>(
      COLLECTION,
      constraints,
      (docs) => {
        setAgents(
          filterVisibleProjectAgents(
            docs.map(toAgent),
            agentVisibilityContext(projectId),
          ),
        );
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [projectId]);

  const launch = useCallback(async (agent: Agent, cwd: string) => {
    try {
      const result = await window.electronAPI.agent.launch(agent, cwd);
      return result;
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to launch agent");
      throw err;
    }
  }, []);

  const stop = useCallback(async (agentId: string) => {
    try {
      await window.electronAPI.agent.stop(agentId);
      await agentService.updateAgent(agentId, {
        status: "stopped" as AgentStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stop agent");
      throw err;
    }
  }, []);

  const restart = useCallback(async (agentId: string) => {
    try {
      await window.electronAPI.agent.restart(agentId);
      await agentService.updateAgent(agentId, {
        status: "idle" as AgentStatus,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to restart agent");
      throw err;
    }
  }, []);

  const createAndLaunch = useCallback(
    async (data: Omit<Agent, "id" | "createdAt">, cwd: string) => {
      try {
        // Save to Firestore
        const id = await agentService.createAgent(data);
        const agent = { ...data, id, createdAt: new Date() } as Agent;

        // Launch via IPC
        await window.electronAPI.agent.launch(agent, cwd);

        return id;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to create agent");
        throw err;
      }
    },
    [],
  );

  const deleteAgent = useCallback(async (agentId: string) => {
    try {
      // Stop first if running
      try {
        await window.electronAPI.agent.stop(agentId);
      } catch {
        // Agent may not be running
      }
      await agentService.deleteAgent(agentId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete agent");
      throw err;
    }
  }, []);

  return {
    agents,
    loading,
    error,
    launch,
    stop,
    restart,
    createAndLaunch,
    deleteAgent,
    clearError: () => setError(null),
  };
}
