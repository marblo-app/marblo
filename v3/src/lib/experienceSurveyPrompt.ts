export const EXPERIENCE_SURVEY_STORAGE_KEYS = {
  sessionCount: "marblo:experienceSurvey:sessionCount",
  sessionCounted: "marblo:experienceSurvey:sessionCounted",
  lastPromptedSession: "marblo:experienceSurvey:lastPromptedSession",
  submitted: "marblo:experienceSurvey:submitted",
} as const;

export const EXPERIENCE_SURVEY_FIRST_PROMPT_SESSION = 2;
export const EXPERIENCE_SURVEY_REPEAT_START_SESSION = 5;
export const EXPERIENCE_SURVEY_REPEAT_EVERY = 5;

export type ExperienceSurveyStorage = Pick<Storage, "getItem" | "setItem">;

function readInt(storage: ExperienceSurveyStorage, key: string): number {
  const raw = storage.getItem(key);
  if (!raw) return 0;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

export function incrementExperienceSurveySession(
  storage: ExperienceSurveyStorage | null,
  sessionStorage: ExperienceSurveyStorage | null,
): number {
  if (!storage) return 0;
  if (sessionStorage?.getItem(EXPERIENCE_SURVEY_STORAGE_KEYS.sessionCounted)) {
    return readInt(storage, EXPERIENCE_SURVEY_STORAGE_KEYS.sessionCount);
  }

  const next = readInt(storage, EXPERIENCE_SURVEY_STORAGE_KEYS.sessionCount) + 1;
  storage.setItem(EXPERIENCE_SURVEY_STORAGE_KEYS.sessionCount, String(next));
  sessionStorage?.setItem(EXPERIENCE_SURVEY_STORAGE_KEYS.sessionCounted, "1");
  return next;
}

export function shouldShowExperienceSurveyPrompt(args: {
  sessionCount: number;
  submitted: boolean;
  lastPromptedSession: number;
  firstPromptSession?: number;
  repeatStartSession?: number;
  repeatEvery?: number;
}): boolean {
  const firstPromptSession =
    args.firstPromptSession ?? EXPERIENCE_SURVEY_FIRST_PROMPT_SESSION;
  const repeatStartSession =
    args.repeatStartSession ?? EXPERIENCE_SURVEY_REPEAT_START_SESSION;
  const repeatEvery = args.repeatEvery ?? EXPERIENCE_SURVEY_REPEAT_EVERY;

  if (args.submitted) return false;
  if (args.sessionCount <= 0) return false;
  if (args.lastPromptedSession === args.sessionCount) return false;
  if (args.sessionCount === firstPromptSession) return true;
  if (args.sessionCount < repeatStartSession) return false;
  return (args.sessionCount - repeatStartSession) % repeatEvery === 0;
}

export function hasSubmittedExperienceSurvey(
  storage: ExperienceSurveyStorage | null,
): boolean {
  return storage?.getItem(EXPERIENCE_SURVEY_STORAGE_KEYS.submitted) === "1";
}

export function markExperienceSurveyPrompted(
  storage: ExperienceSurveyStorage | null,
  sessionCount: number,
): void {
  if (!storage || sessionCount <= 0) return;
  storage.setItem(
    EXPERIENCE_SURVEY_STORAGE_KEYS.lastPromptedSession,
    String(sessionCount),
  );
}

export function markExperienceSurveySubmitted(
  storage: ExperienceSurveyStorage | null,
): void {
  if (!storage) return;
  storage.setItem(EXPERIENCE_SURVEY_STORAGE_KEYS.submitted, "1");
}

export function readExperienceSurveyLastPromptedSession(
  storage: ExperienceSurveyStorage | null,
): number {
  return storage
    ? readInt(storage, EXPERIENCE_SURVEY_STORAGE_KEYS.lastPromptedSession)
    : 0;
}

export function isValidShareUrl(value: string): boolean {
  try {
    const url = new URL(value.trim());
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
