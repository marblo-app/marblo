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
 * "User clicked 나중에/Skip." Predates the Start Here tab, so it is also the
 * legacy seed for OnboardingProgress.dismissed — keep the key stable or every
 * existing user gets re-prompted (regression bRABKQX7).
 */
export const DISMISSED_KEY = "marblo.cliSetupGateDismissed";
/** One-shot guard for the background auto-install pass (FT-8). */
export const AUTO_INSTALL_KEY = "marblo.cliAutoInstallDone";

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
  /**
   * ★BYOM 축(F4) — 벤더 키/CLI 만으로 ①②단계를 만족했는가.
   *
   * Claude/Codex 계정이 하나도 없는 사용자(해외·BYOM 유입의 기본형)는 종전 두 축
   * 만으로는 ②단계를 영구히 통과하지 못했다. 이 두 필드는 기존 축을 **대체하지
   * 않고 OR 로 합쳐진다** — 미지정(undefined)이면 값이 없는 것과 같아 종전 동작과
   * 바이트 동일하다(기존 호출자·테스트 무회귀).
   *
   * 무엇이 이 값을 참으로 만드는지는 `lib/byomOnboarding` 이 정한다. 요점은
   * **오케스트레이터를 태울 수 있는 BYOM 경로만** 여기 기여한다는 것이다 —
   * ③④단계가 전부 오케를 거치므로, 워커 전용 벤더로 ②단계를 넘기면 화면만
   * 넘어가고 ④단계에서 다시 막힌다.
   */
  byomInstalled?: boolean;
  byomReady?: boolean;
}

/** ①단계가 만족됐나 — 종전 축 OR BYOM 축. */
export function installSatisfied(state: WizardGateState): boolean {
  return state.requiredInstalled || state.byomInstalled === true;
}

/** ②단계가 만족됐나 — 종전 축 OR BYOM 축. */
export function authSatisfied(state: WizardGateState): boolean {
  return state.requiredReady || state.byomReady === true;
}

/**
 * Which step to open the wizard at, given the live gate state. Lands the user
 * on the earliest step that still needs their attention so a re-open (blocked
 * launch mid-session, already installed/authed) doesn't re-walk finished steps.
 * Never returns firstTicket as an entry — that step is only reached by an
 * explicit advance once a project + PRD exist.
 */
export function initialWizardStep(state: WizardGateState): WizardStep {
  if (!installSatisfied(state)) return "install";
  if (!authSatisfied(state)) return "auth";
  return "prd";
}

/**
 * Whether the user may advance from `step` to the next one, given gate state.
 * The primary "Next" button is gated on this; the completion criteria per step:
 *   install → requires an installed orchestrator candidate (OR a BYOM path)
 *   auth    → requires an authenticated one (Claude OR Codex OR a BYOM path)
 *   prd     → requires a connected folder (the PRD itself is optional)
 *   firstTicket → terminal; nothing to advance to
 */
export function canAdvanceWizard(
  step: WizardStep,
  state: WizardGateState,
): boolean {
  switch (step) {
    case "install":
      return installSatisfied(state);
    case "auth":
      return authSatisfied(state);
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

/**
 * Re-open guard for the `marblo:open-cli-setup` event.
 *
 * The event is a *request* to consider showing the gate, not a command to force
 * it open — it fires from the spawn guard AND from agent-manager's login-screen
 * backstop, which can mis-read a restart-restored PTY as a fresh needsAuth and
 * emit a spurious `agent:needsAuth`. If the orchestrator set is already ready
 * (Claude OR Codex installed & authed), an authenticated user would otherwise
 * see the popup on every restart. So: re-probe first, and only open when a
 * required candidate is NOT ready. A genuinely signed-out user (nothing ready)
 * still gets the gate.
 */
export function shouldOpenGateOnReopen(requiredReady: boolean): boolean {
  return !requiredReady;
}

/**
 * Post-auth (first-run, no-project) wizard advance — dismissal guard.
 *
 * When the orchestrator set transitions to ready on a first run with no project
 * yet, the gate advances to the PRD step to keep onboarding moving toward the
 * first ticket. But that transition also fires on every app restart: the auth
 * probe starts false and flips false→true once the (already-authed) user's CLIs
 * are re-probed. Without honoring a prior dismissal, a user who clicked
 * "Later"/"Skip" saw the PRD popup re-open on every restart (ticket bRABKQX7).
 *
 * So the no-project post-auth branch only auto-opens the PRD step when the user
 * has NOT dismissed the wizard. The `marblo:cli-auth-ready` event still fires
 * either way (the orchestrator auto-launch must always resume) — only the wizard
 * visibility is gated on dismissal.
 */
export function shouldShowPostAuthStep(dismissed: boolean): boolean {
  return !dismissed;
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
