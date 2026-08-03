/**
 * Known activation gaps re-check, 3.0.18 -> 3.0.22.
 *
 * This is intentionally narrow: the historical failures were decision bugs, so
 * the durable regression guard should pin the decision functions without
 * needing a live account, Firebase, or an Electron shell.
 */
import { describe, expect, it } from "vitest";
import {
  authSatisfied,
  canAdvanceWizard,
  installSatisfied,
} from "../../src/lib/cliSetupGate";
import {
  EMPTY_PROGRESS,
  parseProgress,
  setDismissed,
  shouldLandOnStartHere,
} from "../../src/lib/onboardingProgress";
import {
  deliveryFromRoute,
  firstTicketView,
  ORCHESTRATOR_NOT_RUNNING,
} from "../../src/lib/firstTicketDelivery";
import {
  byomGateContribution,
  byomOptions,
  type ByomOption,
} from "../../src/lib/byomOnboarding";
import type { VendorSetupCard } from "../../src/lib/vendorOnboarding";

function vendorCard(overrides: Partial<VendorSetupCard> = {}): VendorSetupCard {
  return {
    vendor: "xai",
    label: "Grok",
    harness: "grok",
    command: "grok",
    kind: "nativeCli",
    status: "ready",
    requiredEnvKeys: [],
    missingEnvKeys: [],
    modelIds: ["grok-4.5"],
    exampleModelId: "grok-4.5",
    cliRowId: "cli-grok",
    ...overrides,
  };
}

describe("activation known gaps re-check (3.0.18 -> 3.0.22)", () => {
  it("F2 fixed: a dismissed onboarding banner does not auto-land again after restart", () => {
    const dismissed = setDismissed(EMPTY_PROGRESS, true);
    const relaunched = parseProgress(JSON.stringify(dismissed), false);

    expect(relaunched.dismissed).toBe(true);
    expect(shouldLandOnStartHere(relaunched)).toBe(false);
  });

  it("F3 fixed: queued first-ticket delivery is not treated as success", () => {
    const delivery = deliveryFromRoute("queued");
    const view = firstTicketView(delivery);

    expect(delivery).toBe("queued");
    expect(view.completesStep).toBe(false);
    expect(view.tone).toBe("warning");
    expect(view.telemetry).toEqual({
      phase: "fail",
      reason: ORCHESTRATOR_NOT_RUNNING,
    });
  });

  it("F4 fixed: a ready BYOM orchestrator path satisfies install/auth gates", () => {
    const options = byomOptions([vendorCard()], ["grok"]);
    const gate = byomGateContribution(options);

    expect(options).toHaveLength(1);
    expect(options[0].canHostOrchestrator).toBe(true);
    expect(gate).toEqual({ installed: true, ready: true });

    const state = {
      requiredInstalled: false,
      requiredReady: false,
      hasProject: false,
      byomInstalled: gate.installed,
      byomReady: gate.ready,
    };
    expect(installSatisfied(state)).toBe(true);
    expect(authSatisfied(state)).toBe(true);
    expect(canAdvanceWizard("install", state)).toBe(true);
    expect(canAdvanceWizard("auth", state)).toBe(true);
  });

  it("F4 still honest: worker-only BYOM vendors do not bypass auth", () => {
    const workerOnly: ByomOption = {
      ...vendorCard({ kind: "envSwap", harness: "claude", command: "claude" }),
      canHostOrchestrator: false,
    };

    expect(byomGateContribution([workerOnly])).toEqual({
      installed: false,
      ready: false,
    });
  });
});
