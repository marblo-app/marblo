/**
 * Layout / WorkspaceShell global-overlay PARITY guard (ticket djYMmyNksWmjdiWhQN8j).
 *
 * Root cause of the shipped bug: App.tsx renders either <Layout/> (workspace
 * mode OFF) or <WorkspaceShell/> (ON), but only Layout mounted the app's
 * global overlays (RepoConnectModal, FirstProjectSurvey, …) — so anything
 * added there silently never reached the workspace-mode shell.
 *
 * The fix centralizes those overlays in <GlobalOverlays/>, mounted by BOTH
 * shells. This test is a static source guard (no React render — Layout and
 * WorkspaceShell each pull in dozens of app-lifecycle hooks that would need
 * heavy mocking to actually mount) that keeps the fix from drifting back:
 *  1. Both shells must render <GlobalOverlays .../>.
 *  2. Neither shell may mount the individual overlays directly — that would
 *     either double-render them or let a future edit silently re-fork parity
 *     by adding a banner to only one shell again.
 *
 * CliSetupGate (Layout) / CliSetupHost (WorkspaceShell) are intentionally
 * excluded — they are two different onboarding surfaces by design, not a
 * drifted duplicate (see CliSetupHost's own doc comment), so each shell is
 * expected to keep mounting its own.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SRC = path.resolve(__dirname, "../../src");

const LAYOUT_SOURCE = readFileSync(
  path.join(SRC, "components/Layout.tsx"),
  "utf-8",
);
const WORKSPACE_SHELL_SOURCE = readFileSync(
  path.join(SRC, "components/workspace/WorkspaceShell.tsx"),
  "utf-8",
);

// Overlay component names that must live ONLY inside GlobalOverlays — a
// direct <X/> usage in either shell means the drift the ticket fixed is back.
const OVERLAY_COMPONENT_NAMES = [
  "UpdateBanner",
  "MarketingReconsentBanner",
  "ProjectSetupBanners",
  "RepoConnectModal",
  "FirstProjectSurvey",
  "PrivacyConsentGate",
  "ChatToastHost",
  "BugReportNoticeToast",
  "UpgradeModal",
];

describe("Layout / WorkspaceShell global-overlay parity", () => {
  it("both shells mount <GlobalOverlays/>", () => {
    expect(LAYOUT_SOURCE).toMatch(/<GlobalOverlays\b/);
    expect(WORKSPACE_SHELL_SOURCE).toMatch(/<GlobalOverlays\b/);
  });

  it("both shells import GlobalOverlays from the shared component", () => {
    expect(LAYOUT_SOURCE).toMatch(
      /import\s*\{\s*GlobalOverlays\s*\}\s*from\s*["']\.\/GlobalOverlays["']/,
    );
    expect(WORKSPACE_SHELL_SOURCE).toMatch(
      /import\s*\{\s*GlobalOverlays\s*\}\s*from\s*["']\.\.\/GlobalOverlays["']/,
    );
  });

  it.each(OVERLAY_COMPONENT_NAMES)(
    "neither shell mounts <%s/> directly (must go through GlobalOverlays)",
    (name) => {
      const jsxUsage = new RegExp(`<${name}\\b`);
      expect(LAYOUT_SOURCE).not.toMatch(jsxUsage);
      expect(WORKSPACE_SHELL_SOURCE).not.toMatch(jsxUsage);
    },
  );

  it("GlobalOverlays itself renders every listed overlay exactly once", () => {
    const globalOverlaysSource = readFileSync(
      path.join(SRC, "components/GlobalOverlays.tsx"),
      "utf-8",
    );
    for (const name of OVERLAY_COMPONENT_NAMES) {
      const matches = globalOverlaysSource.match(
        new RegExp(`<${name}\\b`, "g"),
      );
      expect(matches?.length ?? 0).toBe(1);
    }
  });
});
