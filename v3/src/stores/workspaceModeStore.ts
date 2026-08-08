import { create } from "zustand";

/**
 * Single flag for the unified Workspace shell (IDE split: file tree ·
 * orchestrator + agent terminals · tabbed work view · activity).
 *
 * ★ ALWAYS ON in production. The flag's history: opt-IN experiment (PR#477) →
 * opt-OUT with the shell as default → (now) no user-facing switch at all. The
 * Settings toggle was removed because the shell IS the product; keeping a
 * persisted opt-out without a toggle would be a trap, not a choice — a user who
 * once wrote "0" would be stuck in the legacy <Layout /> forever with no UI to
 * come back.
 *
 * The legacy <Layout /> branch in App.tsx is NOT deleted, and this is not an
 * oversight: it is still exercised on purpose by the cleanroom E2E
 * (`switchToLegacyLayout` in tests/playwright/cleanroom/helpers/cleanroom.ts,
 * two first-run scenarios) and it owns onboarding surfaces the shell does not
 * have (CliSetupGate, TabBar). So the opt-out survives as a **test-only hatch**:
 * honored only when the app runs under MARBLO_TEST_BYPASS_AUTH=1, which preload
 * (and only preload) can set and production builds never do.
 */
const STORAGE_KEY = "marblo.workspaceMode.enabled";

/**
 * Whether the workspace shell renders. Exported for the unit test — the store
 * itself is a module singleton evaluated at import time, so the branch is only
 * observable through this function.
 */
export function resolveWorkspaceModeEnabled(): boolean {
  if (typeof window === "undefined") return true;
  // Production has no opt-out: the persisted "0" (and any other value) is
  // ignored, so old opt-outs graduate to the shell on the next launch.
  if (!window.electronAPI?.testMode?.bypassAuth) return true;
  try {
    // Test harness only. Explicit "0" → legacy <Layout />; anything else → shell.
    return window.localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

interface WorkspaceModeState {
  /** When true, the app renders the WorkspaceShell instead of the legacy Layout. */
  enabled: boolean;
}

export const useWorkspaceModeStore = create<WorkspaceModeState>(() => ({
  enabled: resolveWorkspaceModeEnabled(),
}));
