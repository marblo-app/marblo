/**
 * Pure onboarding-progress model for the "시작하기" (Start Here) tab.
 *
 * The activation wizard used to be a modal: dismiss it and the progress was
 * gone — the single biggest activation leak (a user who clicked "나중에" had no
 * way back to the remaining steps). Promoting onboarding to a first-class tab
 * only helps if the *progress* survives too, so this module owns the durable
 * record and every derived view of it:
 *
 *   - which steps are already done (persisted ∪ what a live probe proves),
 *   - which step to resume at when the user comes back,
 *   - which steps are still outstanding — including ones the user SKIPPED,
 *     which stay listed as "남은 단계" instead of disappearing,
 *   - whether the shell should land a cold start on the Start Here tab.
 *
 * Everything is a pure function of its inputs (no DOM / storage), so the
 * onboarding-critical rules are unit-testable in the node test environment.
 * The store (`onboardingProgressStore`) wires localStorage into these.
 */

import {
  WIZARD_STEPS,
  type WizardGateState,
  type WizardStep,
} from "./cliSetupGate";

/** localStorage key holding the serialized {@link OnboardingProgress}. */
export const ONBOARDING_PROGRESS_KEY = "marblo.onboarding.progress";

export interface OnboardingProgress {
  /** Steps the user actually finished. Union'd with live probe truth. */
  done: WizardStep[];
  /**
   * Steps the user explicitly skipped. Skipping is allowed — but a skipped
   * step is NOT done: it keeps showing up in the remaining list so nothing is
   * silently lost (the whole point of the tab promotion).
   */
  skipped: WizardStep[];
  /** Where the user was last working — the resume point on re-entry. */
  current: WizardStep;
  /**
   * The user opted out of being auto-landed on the Start Here tab ("나중에").
   * Seeded from the legacy `marblo.cliSetupGateDismissed` flag so a user who
   * already dismissed the old modal isn't re-landed (regression bRABKQX7).
   * The steps themselves stay visible in the tab — only the landing stops.
   */
  dismissed: boolean;
}

export const EMPTY_PROGRESS: OnboardingProgress = {
  done: [],
  skipped: [],
  current: "install",
  dismissed: false,
};

function isStep(v: unknown): v is WizardStep {
  return typeof v === "string" && (WIZARD_STEPS as string[]).includes(v);
}

function uniqueSteps(v: unknown): WizardStep[] {
  if (!Array.isArray(v)) return [];
  const out: WizardStep[] = [];
  for (const item of v) if (isStep(item) && !out.includes(item)) out.push(item);
  return out;
}

/**
 * Parse the persisted record. Anything malformed degrades to a fresh record
 * rather than throwing — a corrupt entry must never brick onboarding.
 *
 * `legacyDismissed` carries the pre-tab `marblo.cliSetupGateDismissed` flag:
 * an existing user who already clicked "나중에" on the modal keeps that choice
 * on their first run with the tab.
 */
export function parseProgress(
  raw: string | null | undefined,
  legacyDismissed = false,
): OnboardingProgress {
  if (!raw) return { ...EMPTY_PROGRESS, dismissed: legacyDismissed };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ...EMPTY_PROGRESS, dismissed: legacyDismissed };
  }
  if (!parsed || typeof parsed !== "object") {
    return { ...EMPTY_PROGRESS, dismissed: legacyDismissed };
  }
  const o = parsed as Record<string, unknown>;
  const done = uniqueSteps(o.done);
  const skipped = uniqueSteps(o.skipped).filter((s) => !done.includes(s));
  return {
    done,
    skipped,
    current: isStep(o.current)
      ? o.current
      : done.length
        ? "firstTicket"
        : "install",
    // An explicitly persisted `false` must win over a stale legacy flag; only
    // fall back to the legacy flag when the field was never written.
    dismissed: typeof o.dismissed === "boolean" ? o.dismissed : legacyDismissed,
  };
}

export function serializeProgress(p: OnboardingProgress): string {
  return JSON.stringify(p);
}

/** Record `step` as finished (and no longer merely skipped). */
export function markStepDone(
  p: OnboardingProgress,
  step: WizardStep,
): OnboardingProgress {
  if (p.done.includes(step) && !p.skipped.includes(step)) return p;
  return {
    ...p,
    done: p.done.includes(step) ? p.done : [...p.done, step],
    skipped: p.skipped.filter((s) => s !== step),
  };
}

/**
 * Record `step` as skipped. Never marks it done — the step stays in the
 * remaining list so the user can come back to it.
 */
export function markStepSkipped(
  p: OnboardingProgress,
  step: WizardStep,
): OnboardingProgress {
  if (p.done.includes(step) || p.skipped.includes(step)) return p;
  return { ...p, skipped: [...p.skipped, step] };
}

export function setCurrentStep(
  p: OnboardingProgress,
  step: WizardStep,
): OnboardingProgress {
  return p.current === step ? p : { ...p, current: step };
}

export function setDismissed(
  p: OnboardingProgress,
  dismissed: boolean,
): OnboardingProgress {
  return p.dismissed === dismissed ? p : { ...p, dismissed };
}

/**
 * Steps that are provably complete: what we persisted, plus what the LIVE
 * probe says right now. Live truth matters because a user can install/sign in
 * outside the tab (their own terminal, another machine's dotfiles) — we must
 * never ask them to redo a step that is already satisfied.
 *
 * `firstTicket` has no live signal (it's a one-shot hand-off), so it comes
 * from the persisted record only.
 */
export function effectiveDone(
  p: OnboardingProgress,
  live: WizardGateState,
): Set<WizardStep> {
  const done = new Set<WizardStep>(p.done);
  // Authenticated implies installed — an authed CLI can't be missing.
  if (live.requiredInstalled || live.requiredReady) done.add("install");
  if (live.requiredReady) done.add("auth");
  if (live.hasProject) done.add("prd");
  return done;
}

/**
 * Where to drop the user when they (re)open the tab: the step they were last
 * on if it still needs work, otherwise the earliest unfinished step. Once
 * everything is done we park on the final step so the tab shows the finish
 * line rather than bouncing back to install.
 */
export function resumeStep(
  p: OnboardingProgress,
  live: WizardGateState,
): WizardStep {
  const done = effectiveDone(p, live);
  if (!done.has(p.current)) return p.current;
  return (
    WIZARD_STEPS.find((s) => !done.has(s)) ??
    WIZARD_STEPS[WIZARD_STEPS.length - 1]
  );
}

export type StepStatus = "done" | "current" | "remaining";

export interface StepView {
  id: WizardStep;
  status: StepStatus;
  /** Skipped-but-not-done — rendered as remaining, flagged so we can say so. */
  skipped: boolean;
}

/**
 * The full checklist as rendered in the tab: a ✓ per finished step, one
 * highlighted current step, and everything else remaining (skipped steps
 * included — they never vanish).
 */
export function stepViews(
  p: OnboardingProgress,
  live: WizardGateState,
): StepView[] {
  const done = effectiveDone(p, live);
  const current = resumeStep(p, live);
  return WIZARD_STEPS.map((id) => ({
    id,
    status: done.has(id) ? "done" : id === current ? "current" : "remaining",
    skipped: !done.has(id) && p.skipped.includes(id),
  }));
}

/** Steps still outstanding, in order. Skipped steps are included by design. */
export function remainingSteps(
  p: OnboardingProgress,
  live: WizardGateState,
): WizardStep[] {
  const done = effectiveDone(p, live);
  return WIZARD_STEPS.filter((s) => !done.has(s));
}

/** Every step finished — the activation finish line (first ticket handed off). */
export function isOnboardingComplete(
  p: OnboardingProgress,
  live: WizardGateState,
): boolean {
  const done = effectiveDone(p, live);
  return WIZARD_STEPS.every((s) => done.has(s));
}

/**
 * Cold-start landing rule (persisted-only — the live probe hasn't run yet when
 * the shell decides which tab to open).
 *
 * Land on Start Here while onboarding is unfinished, unless the user opted out.
 * This never *forces* anything mid-session: a user who picks another tab has
 * that choice persisted, and {@link initialActiveTab} honors it first.
 */
export function shouldLandOnStartHere(p: OnboardingProgress): boolean {
  if (p.dismissed) return false;
  return !isPersistedComplete(p);
}

/**
 * Persisted-only completion check (no live probe) — the counterpart to
 * {@link isOnboardingComplete} for the cold-start tab decision, which runs
 * before the live probe exists. `firstTicket` is the last step and has no live
 * signal anyway (it's a one-shot hand-off), so the persisted record alone is
 * enough to decide graduation: once every step is truly `done` (skipped does
 * not count — see the `skipped` field), a returning user no longer needs to
 * be auto-landed on Start Here.
 */
export function isPersistedComplete(p: OnboardingProgress): boolean {
  return WIZARD_STEPS.every((s) => p.done.includes(s));
}
