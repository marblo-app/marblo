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
      setDismissed: (dismissed) => apply((p) => setDismissed(p, dismissed)),
    };
  },
);
