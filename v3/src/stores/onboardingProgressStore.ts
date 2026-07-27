import { create } from "zustand";
import { DISMISSED_KEY, type WizardStep } from "../lib/cliSetupGate";
import {
  ONBOARDING_PROGRESS_KEY,
  markStepDone,
  markStepSkipped,
  parseProgress,
  serializeProgress,
  setCurrentStep,
  setDismissed,
  type OnboardingProgress,
} from "../lib/onboardingProgress";

/**
 * Durable onboarding progress for the "시작하기" (Start Here) tab.
 *
 * The record is written on every transition so a restart — or a mid-flow
 * detour into another tab — resumes exactly where the user left off. Reads and
 * writes are wrapped so a storage failure (private mode, node test env)
 * degrades to in-memory state rather than throwing.
 *
 * All decision logic lives in lib/onboardingProgress (pure, unit-tested); this
 * store is only persistence + reactivity.
 */

function readString(key: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeProgress(p: OnboardingProgress): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ONBOARDING_PROGRESS_KEY, serializeProgress(p));
  } catch {
    // Private mode — keep the in-memory value for this session.
  }
}

/**
 * Mirror the dismissal onto the legacy `marblo.cliSetupGateDismissed` flag.
 *
 * `progress.dismissed` is the single source of truth (see
 * {@link isOnboardingDismissed}), but the legacy key is what
 * {@link parseProgress} seeds from on a cold start, so the two must never
 * disagree — otherwise a stale `"1"` would resurrect a dismissal the user has
 * since turned back off. Cleared (not set to "0") on re-enable so a fresh
 * install and a re-enabled user look identical.
 */
function writeLegacyDismissed(dismissed: boolean): void {
  if (typeof window === "undefined") return;
  try {
    if (dismissed) localStorage.setItem(DISMISSED_KEY, "1");
    else localStorage.removeItem(DISMISSED_KEY);
  } catch {
    // Private mode — best effort; the JSON record still carries the truth.
  }
}

/** Initial record: stored JSON if present, else seeded from the legacy flag. */
export function readInitialProgress(): OnboardingProgress {
  return parseProgress(
    readString(ONBOARDING_PROGRESS_KEY),
    readString(DISMISSED_KEY) === "1",
  );
}

interface OnboardingProgressState {
  progress: OnboardingProgress;
  markDone: (step: WizardStep) => void;
  markSkipped: (step: WizardStep) => void;
  setCurrent: (step: WizardStep) => void;
  setDismissed: (dismissed: boolean) => void;
}

export const useOnboardingProgressStore = create<OnboardingProgressState>(
  (set, get) => {
    // Every mutator funnels through here so nothing can update memory without
    // persisting, and a no-op transition never triggers a re-render.
    const apply = (fn: (p: OnboardingProgress) => OnboardingProgress): void => {
      const next = fn(get().progress);
      if (next === get().progress) return;
      writeProgress(next);
      set({ progress: next });
    };

    return {
      progress: readInitialProgress(),
      markDone: (step) => apply((p) => markStepDone(p, step)),
      markSkipped: (step) => apply((p) => markStepSkipped(p, step)),
      setCurrent: (step) => apply((p) => setCurrentStep(p, step)),
      setDismissed: (dismissed) => {
        // Mirror unconditionally, not inside `apply`: a no-op transition still
        // has to converge the legacy key (e.g. an in-memory `true` seeded from
        // a legacy flag that a later write dropped).
        writeLegacyDismissed(dismissed);
        apply((p) => setDismissed(p, dismissed));
      },
    };
  },
);

/**
 * The dismissal, read imperatively — for effects that must not subscribe.
 *
 * ★ This is the ONE place non-React code asks "did the user say 'not now'?".
 * The engine used to read the legacy `marblo.cliSetupGateDismissed` flag
 * directly, which only the legacy modal ever wrote: in the split shell nothing
 * set it, so the post-auth branch re-surfaced the onboarding banner on EVERY
 * restart and the ✕ could not stick (activation barrier F2). Every writer now
 * funnels through {@link useOnboardingProgressStore.setDismissed}, and every
 * reader through here.
 */
export function isOnboardingDismissed(): boolean {
  return useOnboardingProgressStore.getState().progress.dismissed;
}

/** Imperative counterpart of the store mutator, for the same non-React callers. */
export function setOnboardingDismissed(dismissed: boolean): void {
  useOnboardingProgressStore.getState().setDismissed(dismissed);
}
