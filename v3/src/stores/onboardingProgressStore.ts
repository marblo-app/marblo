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

export type GraduationJourneyMilestone =
  | "modeTour"
  | "repoGuide"
  | "betaSurvey";

export type GraduationJourneyDisposition =
  | "prompted"
  | "completed"
  | "later"
  | "dismissed";

export interface GraduationMilestoneRecord {
  promptedAt: number;
  completedAt: number;
  laterAt: number;
  dismissedAt: number;
}

export type GraduationJourneyState = Record<
  GraduationJourneyMilestone,
  GraduationMilestoneRecord
>;

const GRADUATION_JOURNEY_KEY = "marblo.onboarding.graduationJourney";

export const ONBOARDING_REPO_CONNECTED_EVENT =
  "marblo:onboarding:repo-connected";
export const ONBOARDING_REPO_GUIDE_LATER_EVENT =
  "marblo:onboarding:repo-guide-later";
export const ONBOARDING_CALENDAR_USED_EVENT = "marblo:onboarding:calendar-used";

const EMPTY_GRADUATION_RECORD: GraduationMilestoneRecord = {
  promptedAt: 0,
  completedAt: 0,
  laterAt: 0,
  dismissedAt: 0,
};

export const EMPTY_GRADUATION_JOURNEY: GraduationJourneyState = {
  modeTour: { ...EMPTY_GRADUATION_RECORD },
  repoGuide: { ...EMPTY_GRADUATION_RECORD },
  betaSurvey: { ...EMPTY_GRADUATION_RECORD },
};

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

function finiteAt(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0;
}

function parseGraduationJourney(raw: string | null): GraduationJourneyState {
  if (!raw)
    return {
      modeTour: { ...EMPTY_GRADUATION_RECORD },
      repoGuide: { ...EMPTY_GRADUATION_RECORD },
      betaSurvey: { ...EMPTY_GRADUATION_RECORD },
    };
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {
      modeTour: { ...EMPTY_GRADUATION_RECORD },
      repoGuide: { ...EMPTY_GRADUATION_RECORD },
      betaSurvey: { ...EMPTY_GRADUATION_RECORD },
    };
  }
  const source =
    parsed && typeof parsed === "object"
      ? (parsed as Partial<Record<GraduationJourneyMilestone, unknown>>)
      : {};
  const read = (key: GraduationJourneyMilestone): GraduationMilestoneRecord => {
    const value = source[key];
    const o =
      value && typeof value === "object"
        ? (value as Record<string, unknown>)
        : {};
    return {
      promptedAt: finiteAt(o.promptedAt),
      completedAt: finiteAt(o.completedAt),
      laterAt: finiteAt(o.laterAt),
      dismissedAt: finiteAt(o.dismissedAt),
    };
  };
  return {
    modeTour: read("modeTour"),
    repoGuide: read("repoGuide"),
    betaSurvey: read("betaSurvey"),
  };
}

function writeProgress(p: OnboardingProgress): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(ONBOARDING_PROGRESS_KEY, serializeProgress(p));
  } catch {
    // Private mode — keep the in-memory value for this session.
  }
}

function writeGraduationJourney(journey: GraduationJourneyState): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(GRADUATION_JOURNEY_KEY, JSON.stringify(journey));
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
  graduationJourney: GraduationJourneyState;
  activeGraduationMilestone: GraduationJourneyMilestone | null;
  markDone: (step: WizardStep) => void;
  markSkipped: (step: WizardStep) => void;
  setCurrent: (step: WizardStep) => void;
  setDismissed: (dismissed: boolean) => void;
  setActiveGraduationMilestone: (
    milestone: GraduationJourneyMilestone | null,
  ) => void;
  markGraduationMilestone: (
    milestone: GraduationJourneyMilestone,
    disposition: GraduationJourneyDisposition,
  ) => void;
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
      graduationJourney: parseGraduationJourney(
        readString(GRADUATION_JOURNEY_KEY),
      ),
      activeGraduationMilestone: null,
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
      setActiveGraduationMilestone: (milestone) =>
        set({ activeGraduationMilestone: milestone }),
      markGraduationMilestone: (milestone, disposition) => {
        const current = get().graduationJourney;
        const record = current[milestone];
        const now = Date.now();
        const nextRecord: GraduationMilestoneRecord = {
          ...record,
          ...(disposition === "prompted" ? { promptedAt: now } : {}),
          ...(disposition === "completed" ? { completedAt: now } : {}),
          ...(disposition === "later" ? { laterAt: now } : {}),
          ...(disposition === "dismissed" ? { dismissedAt: now } : {}),
        };
        const next: GraduationJourneyState = {
          ...current,
          [milestone]: nextRecord,
        };
        writeGraduationJourney(next);
        set({ graduationJourney: next });
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
