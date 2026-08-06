import { describe, expect, it } from "vitest";
import {
  hasSubmittedExperienceSurvey,
  incrementExperienceSurveySession,
  isValidShareUrl,
  markExperienceSurveyPrompted,
  markExperienceSurveySubmitted,
  readExperienceSurveyLastPromptedSession,
  shouldShowExperienceSurveyPrompt,
  type ExperienceSurveyStorage,
} from "../../src/lib/experienceSurveyPrompt";

function memoryStorage(): ExperienceSurveyStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("experience survey prompt timing", () => {
  it("increments once per browser session", () => {
    const local = memoryStorage();
    const session = memoryStorage();

    expect(incrementExperienceSurveySession(local, session)).toBe(1);
    expect(incrementExperienceSurveySession(local, session)).toBe(1);
    expect(incrementExperienceSurveySession(local, memoryStorage())).toBe(2);
  });

  it("shows on session 2, then session 5 and every 5 sessions", () => {
    const shown = Array.from({ length: 16 }, (_, index) => index + 1).filter(
      (sessionCount) =>
        shouldShowExperienceSurveyPrompt({
          sessionCount,
          submitted: false,
          lastPromptedSession: 0,
        }),
    );

    expect(shown).toEqual([2, 5, 10, 15]);
  });

  it("does not show twice in the same counted session", () => {
    const storage = memoryStorage();
    markExperienceSurveyPrompted(storage, 2);

    expect(
      shouldShowExperienceSurveyPrompt({
        sessionCount: 2,
        submitted: false,
        lastPromptedSession: readExperienceSurveyLastPromptedSession(storage),
      }),
    ).toBe(false);
  });

  it("never shows after a successful submission", () => {
    const storage = memoryStorage();
    markExperienceSurveySubmitted(storage);

    expect(hasSubmittedExperienceSurvey(storage)).toBe(true);
    for (const sessionCount of [2, 5, 10, 15]) {
      expect(
        shouldShowExperienceSurveyPrompt({
          sessionCount,
          submitted: hasSubmittedExperienceSurvey(storage),
          lastPromptedSession: 0,
        }),
      ).toBe(false);
    }
  });

  it("validates only http(s) share URLs", () => {
    expect(isValidShareUrl("https://blog.example.com/marblo")).toBe(true);
    expect(isValidShareUrl("http://example.com/post")).toBe(true);
    expect(isValidShareUrl("ftp://example.com/post")).toBe(false);
    expect(isValidShareUrl("not a url")).toBe(false);
  });
});
