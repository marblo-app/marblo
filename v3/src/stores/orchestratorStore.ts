import { create } from "zustand";

export type OrchestratorStatus = "stopped" | "starting" | "running" | "error";
export const ORCHESTRATOR_MODEL_OPTIONS = [
  { value: "claude", label: "Claude" },
  { value: "codex", label: "Codex" },
] as const;

export type OrchestratorModel =
  (typeof ORCHESTRATOR_MODEL_OPTIONS)[number]["value"];

export function isOrchestratorModel(
  model: unknown,
): model is OrchestratorModel {
  return ORCHESTRATOR_MODEL_OPTIONS.some((option) => option.value === model);
}
export type OrchestratorSwitchStatus =
  | "idle"
  | "snapshotting"
  | "stopping"
  | "starting"
  | "error";

interface HandoffSummary {
  activeMissionCount: number;
  inFlightTaskCount: number;
  unresolvedDecisionCount: number;
}

interface OrchestratorState {
  sessionId: string | null;
  ptySessionId: string | null;
  status: OrchestratorStatus;
  isCollapsed: boolean;
  selectedModel: OrchestratorModel;
  runningModel: OrchestratorModel | null;
  switchStatus: OrchestratorSwitchStatus;
  lastHandoffSummary: HandoffSummary | null;

  setSession: (
    sessionId: string,
    ptySessionId: string,
    model?: OrchestratorModel,
  ) => void;
  setStatus: (status: OrchestratorStatus) => void;
  setCollapsed: (collapsed: boolean) => void;
  setSelectedModel: (model: OrchestratorModel) => void;
  setSwitchStatus: (status: OrchestratorSwitchStatus) => void;
  setHandoffSummary: (summary: HandoffSummary | null) => void;
  toggleCollapsed: () => void;
  clear: () => void;
}

export const useOrchestratorStore = create<OrchestratorState>((set, get) => ({
  sessionId: null,
  ptySessionId: null,
  status: "stopped",
  isCollapsed: true,
  selectedModel: "claude",
  runningModel: null,
  switchStatus: "idle",
  lastHandoffSummary: null,

  setSession: (sessionId, ptySessionId, model) =>
    set((state) => ({
      sessionId,
      ptySessionId,
      status: "starting",
      runningModel: model ?? state.selectedModel,
    })),

  setStatus: (status) => set({ status }),

  setCollapsed: (collapsed) => set({ isCollapsed: collapsed }),

  setSelectedModel: (selectedModel) => set({ selectedModel }),

  setSwitchStatus: (switchStatus) => set({ switchStatus }),

  setHandoffSummary: (lastHandoffSummary) => set({ lastHandoffSummary }),

  toggleCollapsed: () => set({ isCollapsed: !get().isCollapsed }),

  clear: () =>
    set({
      sessionId: null,
      ptySessionId: null,
      status: "stopped",
      runningModel: null,
      switchStatus: "idle",
    }),
}));
