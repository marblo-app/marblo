import { describe, it, expect } from "vitest";
import {
  EMPTY_PROGRESS,
  effectiveDone,
  isOnboardingComplete,
  markStepDone,
  markStepSkipped,
  parseProgress,
  remainingSteps,
  resumeStep,
  serializeProgress,
  setCurrentStep,
  setDismissed,
  shouldLandOnStartHere,
  stepViews,
  type OnboardingProgress,
} from "../../src/lib/onboardingProgress";
import type { WizardGateState } from "../../src/lib/cliSetupGate";

const NOTHING: WizardGateState = {
  requiredInstalled: false,
  requiredReady: false,
  hasProject: false,
};
const INSTALLED: WizardGateState = { ...NOTHING, requiredInstalled: true };
const AUTHED: WizardGateState = {
  requiredInstalled: true,
  requiredReady: true,
  hasProject: false,
};
const PROJECT: WizardGateState = {
  requiredInstalled: true,
  requiredReady: true,
  hasProject: true,
};

function progress(p: Partial<OnboardingProgress> = {}): OnboardingProgress {
  return { ...EMPTY_PROGRESS, ...p };
}

describe("parseProgress", () => {
  it("returns a fresh record for missing / malformed storage", () => {
    expect(parseProgress(null)).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("{not json")).toEqual(EMPTY_PROGRESS);
    expect(parseProgress("[1,2,3]").done).toEqual([]);
  });

  it("drops unknown step ids and de-duplicates", () => {
    const p = parseProgress(
      JSON.stringify({
        done: ["install", "install", "nope"],
        skipped: ["auth"],
      }),
    );
    expect(p.done).toEqual(["install"]);
    expect(p.skipped).toEqual(["auth"]);
  });

  it("never lists a step as both done and skipped", () => {
    const p = parseProgress(
      JSON.stringify({ done: ["auth"], skipped: ["auth", "prd"] }),
    );
    expect(p.done).toEqual(["auth"]);
    expect(p.skipped).toEqual(["prd"]);
  });

  // Regression bRABKQX7: an existing user who dismissed the old modal must not
  // be re-prompted (here: re-landed on the tab) after the upgrade.
  it("seeds dismissed from the legacy cliSetupGateDismissed flag", () => {
    expect(parseProgress(null, true).dismissed).toBe(true);
    expect(parseProgress(null, false).dismissed).toBe(false);
  });

  it("lets an explicitly persisted dismissed=false win over the legacy flag", () => {
    expect(
      parseProgress(JSON.stringify({ dismissed: false }), true).dismissed,
    ).toBe(false);
  });

  it("round-trips through serializeProgress", () => {
    const p = progress({
      done: ["install"],
      skipped: ["auth"],
      current: "prd",
    });
    expect(parseProgress(serializeProgress(p))).toEqual(p);
  });
});

describe("transitions", () => {
  it("markStepDone promotes a skipped step and is idempotent", () => {
    const skipped = markStepSkipped(EMPTY_PROGRESS, "install");
    expect(skipped.skipped).toEqual(["install"]);
    const done = markStepDone(skipped, "install");
    expect(done.done).toEqual(["install"]);
    expect(done.skipped).toEqual([]);
    // Idempotent: same reference back, so the store never re-renders for a no-op.
    expect(markStepDone(done, "install")).toBe(done);
  });

  it("markStepSkipped never marks a step done and never re-skips", () => {
    const p = markStepSkipped(EMPTY_PROGRESS, "auth");
    expect(p.done).toEqual([]);
    expect(markStepSkipped(p, "auth")).toBe(p);
    // A finished step can't be "skipped" backwards.
    const done = markStepDone(EMPTY_PROGRESS, "auth");
    expect(markStepSkipped(done, "auth")).toBe(done);
  });

  it("setCurrentStep / setDismissed no-op when unchanged", () => {
    const p = progress({ current: "prd" });
    expect(setCurrentStep(p, "prd")).toBe(p);
    expect(setCurrentStep(p, "auth").current).toBe("auth");
    expect(setDismissed(p, false)).toBe(p);
    expect(setDismissed(p, true).dismissed).toBe(true);
  });
});

describe("effectiveDone — persisted ∪ live probe truth", () => {
  it("credits install/auth/prd from the live gate state", () => {
    expect([...effectiveDone(EMPTY_PROGRESS, INSTALLED)]).toEqual(["install"]);
    const authed = effectiveDone(EMPTY_PROGRESS, AUTHED);
    expect(authed.has("install")).toBe(true);
    expect(authed.has("auth")).toBe(true);
    expect(effectiveDone(EMPTY_PROGRESS, PROJECT).has("prd")).toBe(true);
  });

  it("treats authenticated as implying installed", () => {
    const live = {
      requiredInstalled: false,
      requiredReady: true,
      hasProject: false,
    };
    expect(effectiveDone(EMPTY_PROGRESS, live).has("install")).toBe(true);
  });

  it("takes firstTicket only from the persisted record (no live signal)", () => {
    expect(effectiveDone(EMPTY_PROGRESS, PROJECT).has("firstTicket")).toBe(
      false,
    );
    expect(
      effectiveDone(progress({ done: ["firstTicket"] }), PROJECT).has(
        "firstTicket",
      ),
    ).toBe(true);
  });

  it("a skipped step is NOT done", () => {
    const p = markStepSkipped(EMPTY_PROGRESS, "install");
    expect(effectiveDone(p, NOTHING).has("install")).toBe(false);
  });
});

describe("resumeStep", () => {
  it("resumes where the user left off", () => {
    expect(resumeStep(progress({ current: "prd" }), AUTHED)).toBe("prd");
  });

  it("skips ahead when the remembered step is already satisfied live", () => {
    // Remembered "install", but a CLI got installed + authed outside the app.
    expect(resumeStep(progress({ current: "install" }), AUTHED)).toBe("prd");
  });

  it("parks on the last step once everything is done", () => {
    const p = progress({ done: ["firstTicket"], current: "firstTicket" });
    expect(resumeStep(p, PROJECT)).toBe("firstTicket");
  });

  it("returns to a skipped step rather than dropping it", () => {
    const p = markStepSkipped(progress({ current: "auth" }), "install");
    expect(resumeStep(p, NOTHING)).toBe("auth");
    expect(remainingSteps(p, NOTHING)).toContain("install");
  });
});

describe("stepViews", () => {
  it("marks done / current / remaining exactly once each", () => {
    const views = stepViews(progress({ current: "prd" }), AUTHED);
    expect(views.map((v) => v.status)).toEqual([
      "done", // install
      "done", // auth
      "current", // prd
      "remaining", // firstTicket
    ]);
    expect(views.map((v) => v.id)).toEqual([
      "install",
      "auth",
      "prd",
      "firstTicket",
    ]);
  });

  // ★ The core "유실 없이" rule: skipping hides nothing.
  it("keeps a skipped step in the list, flagged as skipped", () => {
    const p = markStepSkipped(progress({ current: "auth" }), "install");
    const views = stepViews(p, NOTHING);
    const install = views.find((v) => v.id === "install")!;
    expect(install.status).toBe("remaining");
    expect(install.skipped).toBe(true);
    expect(views).toHaveLength(4);
  });

  it("clears the skipped flag once the step is actually satisfied", () => {
    const p = markStepSkipped(EMPTY_PROGRESS, "install");
    const install = stepViews(p, INSTALLED).find((v) => v.id === "install")!;
    expect(install.status).toBe("done");
    expect(install.skipped).toBe(false);
  });
});

describe("isOnboardingComplete", () => {
  it("needs the first ticket, not just a connected project", () => {
    expect(isOnboardingComplete(EMPTY_PROGRESS, PROJECT)).toBe(false);
    expect(
      isOnboardingComplete(progress({ done: ["firstTicket"] }), PROJECT),
    ).toBe(true);
  });
});

describe("shouldLandOnStartHere", () => {
  it("lands an unfinished, non-dismissed onboarding", () => {
    expect(shouldLandOnStartHere(EMPTY_PROGRESS)).toBe(true);
    expect(shouldLandOnStartHere(progress({ done: ["install", "auth"] }))).toBe(
      true,
    );
  });

  it("stops once every step is persisted done", () => {
    expect(
      shouldLandOnStartHere(
        progress({ done: ["install", "auth", "prd", "firstTicket"] }),
      ),
    ).toBe(false);
  });

  // Regression bRABKQX7 — "나중에" must survive restarts.
  it("respects a dismissal even with work outstanding", () => {
    expect(shouldLandOnStartHere(progress({ dismissed: true }))).toBe(false);
  });
});
