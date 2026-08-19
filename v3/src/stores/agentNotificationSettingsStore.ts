import { create } from "zustand";

export const AGENT_INPUT_WAIT_POPUPS_KEY =
  "marblo.agentInputWait.popupsEnabled";

export function resolveAgentInputWaitPopupsEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(AGENT_INPUT_WAIT_POPUPS_KEY) === "1";
  } catch {
    return false;
  }
}

function persistAgentInputWaitPopupsEnabled(enabled: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (enabled) window.localStorage.setItem(AGENT_INPUT_WAIT_POPUPS_KEY, "1");
    else window.localStorage.removeItem(AGENT_INPUT_WAIT_POPUPS_KEY);
  } catch {
    // Non-persistent storage still leaves the in-memory toggle usable.
  }
}

interface AgentNotificationSettingsState {
  inputWaitPopupsEnabled: boolean;
  setInputWaitPopupsEnabled: (enabled: boolean) => void;
}

export const useAgentNotificationSettingsStore =
  create<AgentNotificationSettingsState>((set) => ({
    inputWaitPopupsEnabled: resolveAgentInputWaitPopupsEnabled(),
    setInputWaitPopupsEnabled: (enabled) => {
      persistAgentInputWaitPopupsEnabled(enabled);
      set({ inputWaitPopupsEnabled: enabled });
    },
  }));
