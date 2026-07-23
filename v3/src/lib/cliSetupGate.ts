/**
 * Pure decision helpers for the first-run CLI setup gate (CliSetupGate.tsx).
 *
 * Extracted so the onboarding-critical branches — when to keep re-prompting a
 * user who clicked "Later" (FT-6) and when it's safe to remember that the
 * one-time auto-install already ran (FT-8) — are unit-testable without a DOM.
 * The component wires probe results + localStorage into these; the logic lives
 * here.
 */

export interface CliProbe {
  installed: boolean;
  authenticated: boolean;
}

/**
 * Linear onboarding wizard steps (ticket ir94m9C6) — the activation funnel that
 * carries a fresh signup straight to the "first ticket" finish line:
 *
 *   install → auth → prd → firstTicket
 *
 * ① install     — install the orchestrator CLI (auto `npm i -g`, official
 *                  fallback on failure).
 * ② auth        — sign in to Claude OR Codex (at least one; `requiredReady`).
 * ③ prd         — connect a folder + seed a starter PRD.md.
 * ④ firstTicket — hand the PRD to the orchestrator as the very first prompt,
 *                  the aha-moment (routeInstructionToOrchestrator).
 *
 * The old notice/connect/project steps collapse into this: the cost notice is
 * folded into the install step's banner; connect splits into install + auth so
 * the funnel can see where a user drops (a missing CLI vs a failed sign-in);
 * project splits into prd + firstTicket so onboarding no longer ends at "folder
 * connected" but at "first ticket handed off".
 */
export type WizardStep = "install" | "auth" | "prd" | "firstTicket";

/** Ordered steps, source of truth for the progress indicator + transitions. */
export const WIZARD_STEPS: WizardStep[] = [
  "install",
  "auth",
  "prd",
  "firstTicket",
];

export interface WizardGateState {
  /** At least one orchestrator candidate (Claude/Codex) is installed. */
  requiredInstalled: boolean;
  /** At least one orchestrator candidate is installed AND authenticated. */
  requiredReady: boolean;
  /** A project folder is connected (orchestrator can be launched/messaged). */
  hasProject: boolean;
}

/**
 * Which step to open the wizard at, given the live gate state. Lands the user
 * on the earliest step that still needs their attention so a re-open (blocked
 * launch mid-session, already installed/authed) doesn't re-walk finished steps.
 * Never returns firstTicket as an entry — that step is only reached by an
 * explicit advance once a project + PRD exist.
 */
export function initialWizardStep(state: WizardGateState): WizardStep {
  if (!state.requiredInstalled) return "install";
  if (!state.requiredReady) return "auth";
  return "prd";
}

/**
 * Whether the user may advance from `step` to the next one, given gate state.
 * The primary "Next" button is gated on this; the completion criteria per step:
 *   install → requires an installed orchestrator candidate
 *   auth    → requires an authenticated one (Claude OR Codex)
 *   prd     → requires a connected folder (the PRD itself is optional)
 *   firstTicket → terminal; nothing to advance to
 */
export function canAdvanceWizard(
  step: WizardStep,
  state: WizardGateState
): boolean {
  switch (step) {
    case "install":
      return state.requiredInstalled;
    case "auth":
      return state.requiredReady;
    case "prd":
      return state.hasProject;
    case "firstTicket":
      return false;
  }
}

/** The step after `step`, or null at the end of the linear flow. */
export function nextWizardStep(step: WizardStep): WizardStep | null {
  const i = WIZARD_STEPS.indexOf(step);
  if (i < 0 || i >= WIZARD_STEPS.length - 1) return null;
  return WIZARD_STEPS[i + 1];
}

/**
 * FT-8 — auto-install completion.
 *
 * The gate auto-installs any missing REQUIRED CLI exactly once, guarded by a
 * localStorage flag. That flag must be set only once every previously-missing
 * CLI is *actually* installed; otherwise a failed/partial install would be
 * remembered as "done" and never retried. Returns true iff all `missingIds`
 * are now installed.
 */
export function autoInstallComplete(
  missingIds: string[],
  results: Record<string, CliProbe | undefined>
): boolean {
  // Vacuously true when nothing was missing — but callers only persist the
  // flag when they actually ran an install pass, so this stays meaningful.
  return missingIds.every((id) => results[id]?.installed === true);
}

/**
 * FT-6 + first-run — gate visibility.
 *
 * A prior "Later" (dismissed) is honored ONLY while at least one orchestrator
 * candidate CLI is installed. If none is installed the user can't launch
 * anything, so we re-surface the gate and signal that the stale dismissal
 * should be cleared — the next run behaves like a first run until install
 * succeeds. Login-only gaps (installed but not authenticated) keep respecting
 * the dismissal.
 *
 * @param requiredReady    any orchestrator candidate installed AND authenticated
 * @param requiredInstalled any orchestrator candidate at least installed
 * @param dismissed        user previously clicked "Later"
 */
export function resolveGateVisibility(input: {
  requiredReady: boolean;
  requiredInstalled: boolean;
  dismissed: boolean;
}): { visible: boolean; clearDismissed: boolean } {
  const clearDismissed = input.dismissed && !input.requiredInstalled;
  const effectiveDismissed = input.dismissed && !clearDismissed;
  return {
    visible: !input.requiredReady && !effectiveDismissed,
    clearDismissed,
  };
}

/** Whether at least one orchestrator candidate CLI is at least installed. */
export function requiredInstalled(
  candidateIds: string[],
  results: Record<string, CliProbe | undefined>
): boolean {
  return candidateIds.some((id) => results[id]?.installed === true);
}

/** Whether at least one orchestrator candidate CLI is ready to spawn. */
export function requiredReady(
  candidateIds: string[],
  results: Record<string, CliProbe | undefined>
): boolean {
  return candidateIds.some(
    (id) =>
      results[id]?.installed === true && results[id]?.authenticated === true
  );
}
