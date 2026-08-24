import { describe, it, expect } from "vitest";
import {
  autoInstallComplete,
  canAdvanceWizard,
  initialWizardStep,
  nextWizardStep,
  resolveGateVisibility,
  requiredInstalled,
  requiredReady,
  shouldOpenGateOnReopen,
  shouldShowPostAuthStep,
  WIZARD_STEPS,
  type CliProbe,
} from "../../src/lib/cliSetupGate";

const ready: CliProbe = { installed: true, authenticated: true };
const installedOnly: CliProbe = { installed: true, authenticated: false };
const missing: CliProbe = { installed: false, authenticated: false };

describe("autoInstallComplete (FT-8)", () => {
  it("true only when every previously-missing CLI is now installed", () => {
    expect(
      autoInstallComplete(["cli-claude-code", "cli-codex"], {
        "cli-claude-code": installedOnly,
        "cli-codex": ready,
      }),
    ).toBe(true);
  });

  it("false when any install failed — so the flag is NOT persisted and retries", () => {
    expect(
      autoInstallComplete(["cli-claude-code", "cli-codex"], {
        "cli-claude-code": missing, // install failed
        "cli-codex": ready,
      }),
    ).toBe(false);
  });

  it("false when a row is absent from the results map", () => {
    expect(
      autoInstallComplete(["cli-claude-code"], {
        /* nothing probed back */
      }),
    ).toBe(false);
  });
});

describe("resolveGateVisibility (FT-6 + first-run)", () => {
  it("first run, nothing installed → visible, nothing to clear", () => {
    expect(
      resolveGateVisibility({
        requiredReady: false,
        requiredInstalled: false,
        dismissed: false,
      }),
    ).toEqual({ visible: true, clearDismissed: false });
  });

  it("dismissed but a required CLI still NOT installed → re-surface + clear stale dismissal", () => {
    expect(
      resolveGateVisibility({
        requiredReady: false,
        requiredInstalled: false,
        dismissed: true,
      }),
    ).toEqual({ visible: true, clearDismissed: true });
  });

  it("dismissed, installed but not authed (login-only gap) → stays quiet, dismissal honored", () => {
    expect(
      resolveGateVisibility({
        requiredReady: false,
        requiredInstalled: true,
        dismissed: true,
      }),
    ).toEqual({ visible: false, clearDismissed: false });
  });

  it("fully ready → never visible regardless of dismissal", () => {
    expect(
      resolveGateVisibility({
        requiredReady: true,
        requiredInstalled: true,
        dismissed: false,
      }),
    ).toEqual({ visible: false, clearDismissed: false });
    expect(
      resolveGateVisibility({
        requiredReady: true,
        requiredInstalled: true,
        dismissed: true,
      }).visible,
    ).toBe(false);
  });

  it("not dismissed and not ready → visible (login needed, first prompt)", () => {
    expect(
      resolveGateVisibility({
        requiredReady: false,
        requiredInstalled: true,
        dismissed: false,
      }),
    ).toEqual({ visible: true, clearDismissed: false });
  });
});

describe("requiredInstalled / requiredReady", () => {
  const ids = ["cli-claude-code", "cli-codex"];

  it("requiredInstalled true when at least one orchestrator candidate is installed", () => {
    expect(
      requiredInstalled(ids, {
        "cli-claude-code": missing,
        "cli-codex": ready,
      }),
    ).toBe(true);
  });

  it("requiredInstalled false when no orchestrator candidate is installed", () => {
    expect(
      requiredInstalled(ids, {
        "cli-claude-code": missing,
        "cli-codex": missing,
      }),
    ).toBe(false);
  });

  it("requiredReady passes when at least one orchestrator candidate is installed AND authenticated", () => {
    expect(
      requiredReady(ids, {
        "cli-claude-code": installedOnly, // not authed
        "cli-codex": ready,
      }),
    ).toBe(true);
    expect(
      requiredReady(ids, {
        "cli-claude-code": ready,
        "cli-codex": installedOnly,
      }),
    ).toBe(true);
  });

  it("requiredReady false when candidates are only installed, not authenticated", () => {
    expect(
      requiredReady(ids, {
        "cli-claude-code": installedOnly,
        "cli-codex": installedOnly,
      }),
    ).toBe(false);
  });
});

describe("shouldOpenGateOnReopen (ticket nB4eenxPkNWNtCuHf65o)", () => {
  it("does NOT open when a required candidate is already ready — spurious agent:needsAuth on restart must not popup an authed user", () => {
    expect(shouldOpenGateOnReopen(true)).toBe(false);
  });

  it("opens when nothing is ready — a genuinely signed-out user still gets the gate", () => {
    expect(shouldOpenGateOnReopen(false)).toBe(true);
  });
});

describe("shouldShowPostAuthStep (ticket bRABKQX7)", () => {
  it("opens the PRD step for a fresh (not-dismissed) first-run user", () => {
    expect(shouldShowPostAuthStep(false)).toBe(true);
  });

  it("does NOT re-open PRD when the user previously dismissed — no popup on every restart", () => {
    expect(shouldShowPostAuthStep(true)).toBe(false);
  });
});

describe("linear wizard step transitions (ticket ir94m9C6)", () => {
  it("WIZARD_STEPS is the ordered activation funnel", () => {
    expect(WIZARD_STEPS).toEqual([
      "install",
      "auth",
      "prd",
      "git",
      "firstTicket",
    ]);
  });

  describe("initialWizardStep — opens at the earliest incomplete step", () => {
    it("nothing installed → install", () => {
      expect(
        initialWizardStep({
          requiredInstalled: false,
          requiredReady: false,
          hasProject: false,
        }),
      ).toBe("install");
    });

    it("installed but not authed → auth", () => {
      expect(
        initialWizardStep({
          requiredInstalled: true,
          requiredReady: false,
          hasProject: false,
        }),
      ).toBe("auth");
    });

    it("authed, no project → prd", () => {
      expect(
        initialWizardStep({
          requiredInstalled: true,
          requiredReady: true,
          hasProject: false,
        }),
      ).toBe("prd");
    });

    it("authed with a project (re-open) → prd, never firstTicket as an entry", () => {
      expect(
        initialWizardStep({
          requiredInstalled: true,
          requiredReady: true,
          hasProject: true,
        }),
      ).toBe("prd");
    });

    it("authed with a non-git project → git", () => {
      expect(
        initialWizardStep({
          requiredInstalled: true,
          requiredReady: true,
          hasProject: true,
          gitInitialized: false,
        }),
      ).toBe("git");
    });
  });

  describe("canAdvanceWizard — per-step completion gate", () => {
    const base = {
      requiredInstalled: false,
      requiredReady: false,
      hasProject: false,
    };

    it("install advances only once a candidate is installed", () => {
      expect(canAdvanceWizard("install", base)).toBe(false);
      expect(
        canAdvanceWizard("install", { ...base, requiredInstalled: true }),
      ).toBe(true);
    });

    it("auth advances only once a candidate is authenticated", () => {
      expect(
        canAdvanceWizard("auth", { ...base, requiredInstalled: true }),
      ).toBe(false);
      expect(
        canAdvanceWizard("auth", {
          ...base,
          requiredInstalled: true,
          requiredReady: true,
        }),
      ).toBe(true);
    });

    it("prd advances only once a folder is connected (PRD itself optional)", () => {
      expect(canAdvanceWizard("prd", { ...base, requiredReady: true })).toBe(
        false,
      );
      expect(
        canAdvanceWizard("prd", {
          ...base,
          requiredReady: true,
          hasProject: true,
        }),
      ).toBe(true);
    });

    it("git advances only once the connected folder is a git repository", () => {
      expect(
        canAdvanceWizard("git", {
          ...base,
          requiredReady: true,
          hasProject: true,
          gitInitialized: false,
        }),
      ).toBe(false);
      expect(
        canAdvanceWizard("git", {
          ...base,
          requiredReady: true,
          hasProject: true,
          gitInitialized: true,
        }),
      ).toBe(true);
      expect(
        canAdvanceWizard("git", {
          ...base,
          requiredReady: true,
          hasProject: true,
        }),
      ).toBe(true);
    });

    it("firstTicket is terminal — never advances", () => {
      expect(
        canAdvanceWizard("firstTicket", {
          requiredInstalled: true,
          requiredReady: true,
          hasProject: true,
        }),
      ).toBe(false);
    });
  });

  describe("nextWizardStep — linear order, terminal at firstTicket", () => {
    it("walks install → auth → prd → git → firstTicket → null", () => {
      expect(nextWizardStep("install")).toBe("auth");
      expect(nextWizardStep("auth")).toBe("prd");
      expect(nextWizardStep("prd")).toBe("git");
      expect(nextWizardStep("git")).toBe("firstTicket");
      expect(nextWizardStep("firstTicket")).toBeNull();
    });
  });
});
