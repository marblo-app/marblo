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
  results: Record<string, CliProbe | undefined>,
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
  results: Record<string, CliProbe | undefined>,
): boolean {
  return candidateIds.some((id) => results[id]?.installed === true);
}

/** Whether at least one orchestrator candidate CLI is ready to spawn. */
export function requiredReady(
  candidateIds: string[],
  results: Record<string, CliProbe | undefined>,
): boolean {
  return candidateIds.some(
    (id) =>
      results[id]?.installed === true && results[id]?.authenticated === true,
  );
}
