import { describe, it, expect } from "vitest";
import {
  autoInstallComplete,
  resolveGateVisibility,
  requiredInstalled,
  requiredReady,
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

  it("requiredInstalled true when both installed (auth irrelevant)", () => {
    expect(
      requiredInstalled(ids, {
        "cli-claude-code": installedOnly,
        "cli-codex": ready,
      }),
    ).toBe(true);
  });

  it("requiredInstalled false when one missing", () => {
    expect(
      requiredInstalled(ids, {
        "cli-claude-code": missing,
        "cli-codex": ready,
      }),
    ).toBe(false);
  });

  it("requiredReady demands both installed AND authenticated", () => {
    expect(
      requiredReady(ids, {
        "cli-claude-code": installedOnly, // not authed
        "cli-codex": ready,
      }),
    ).toBe(false);
    expect(
      requiredReady(ids, {
        "cli-claude-code": ready,
        "cli-codex": ready,
      }),
    ).toBe(true);
  });
});
