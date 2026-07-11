import { create } from "zustand";
import type { PlanType } from "../types/subscription";

/**
 * App-level UI state that must be triggered from non-component code (stores,
 * callbacks) and rendered once at the app shell.
 *
 * Two concerns live here:
 *  1. The global Upgrade modal — a Free user hitting a plan limit (2nd project,
 *     6th agent) anywhere in the app opens ONE modal rendered in Layout. Stores
 *     like agentStore/projectStore can't render JSX, so they call showUpgrade().
 *  2. A cross-tab request to open Settings on a specific section (e.g. billing).
 *     The Upgrade modal's CTA routes the user to the in-app subscription page
 *     (Settings → Billing, Toss checkout) instead of a direct Paddle popup.
 */
export interface UpgradeModalState {
  /** Feature key that was gated (drives the modal copy + label). */
  feature: string;
  /** Minimum plan that unlocks it. */
  requiredPlan: PlanType;
}

interface UiState {
  upgradeModal: UpgradeModalState | null;
  showUpgrade: (feature: string, requiredPlan?: PlanType) => void;
  hideUpgrade: () => void;

  // Latched request to open Settings on `section`. Layout switches to the
  // Settings tab when this is set; SettingsPage consumes + clears it to select
  // the sub-tab. A latch (not an event) because the Settings tab may be
  // unmounted when the request is made.
  pendingSettingsSection: string | null;
  openSettingsSection: (section: string) => void;
  consumeSettingsSection: () => string | null;
}

export const useUiStore = create<UiState>((set, get) => ({
  upgradeModal: null,
  showUpgrade: (feature, requiredPlan = "pro") =>
    set({ upgradeModal: { feature, requiredPlan } }),
  hideUpgrade: () => set({ upgradeModal: null }),

  pendingSettingsSection: null,
  openSettingsSection: (section) => set({ pendingSettingsSection: section }),
  consumeSettingsSection: () => {
    const s = get().pendingSettingsSection;
    if (s) set({ pendingSettingsSection: null });
    return s;
  },
}));
