/**
 * Unit tests for the Claude cold-boot resume policy (reconnect-manager.ts).
 *
 * Regression: "83 phantom agents attached on launch". The `agents/` Firestore
 * collection has no machine/session identity, so a second machine signed into
 * the same account (Windows + macOS as the same user) rehydrates the WHOLE
 * project's agent docs — including stale zombies left by the other machine.
 *
 * The old `agent:reconnect` had an "adopt any unclaimed session" fallback for
 * labelless Claude agents. On the second machine that fallback let every one of
 * those foreign/stale docs grab an arbitrary local JSONL and launch a real CLI
 * process. resolveClaudeColdBootResumeId() encodes the fix: resume ONLY on an
 * agent-SPECIFIC match (a labels-file entry or a name/id-scoped scan); with no
 * specific match, return null so the agent is skipped (no-session) rather than
 * resurrected.
 */

import { describe, it, expect } from "vitest";
import {
  resolveClaudeColdBootResumeId,
  classifyMachineOwnership,
  isLaunchEligibleOnThisMachine,
  FOREIGN_MACHINE_SKIP_REASON,
} from "../../electron/reconnect-manager";

describe("resolveClaudeColdBootResumeId", () => {
  it("prefers the labels-file (agent-specific) session id", () => {
    expect(resolveClaudeColdBootResumeId("label-uuid", "scan-uuid")).toBe(
      "label-uuid",
    );
  });

  it("falls back to the name/id-scoped scan when there is no label match", () => {
    expect(resolveClaudeColdBootResumeId(null, "scan-uuid")).toBe("scan-uuid");
  });

  it("returns null (skip) when no agent-specific session matches — the core fix: a foreign/stale doc on a shared account is NOT resurrected via an arbitrary unclaimed session", () => {
    expect(resolveClaudeColdBootResumeId(null, null)).toBeNull();
  });

  it("never invents a session from nothing — a labelless agent with no local session stays unstarted (▶ Start)", () => {
    // Both signals null is the exact state of every phantom doc on the second
    // machine: no labels entry, no name/id-scoped JSONL. Must skip, not launch.
    const decision = resolveClaudeColdBootResumeId(null, null);
    expect(decision).toBeNull();
  });
});

/**
 * Machine-scoped boot restore + non-destructive reap (this ticket).
 *
 * The `agents/` collection is shared across every machine on one account. The
 * resume-id policy above already blocks phantom Claude *launches*, but it's
 * Claude-/session-specific. classifyMachineOwnership / isLaunchEligibleOnThisMachine
 * make the rule explicit and model-agnostic: a machine only ever relaunches its
 * OWN agent docs, and never mutates docs it doesn't own.
 */
describe("classifyMachineOwnership", () => {
  const THIS = "macbook-darwin-uuid-A";

  it("classifies a doc stamped with this machine's id as 'own'", () => {
    expect(classifyMachineOwnership(THIS, THIS)).toBe("own");
  });

  it("classifies a doc stamped with another machine's id as 'foreign'", () => {
    expect(classifyMachineOwnership("windows-win32-uuid-B", THIS)).toBe(
      "foreign",
    );
  });

  it("classifies an unstamped (null/undefined/empty) doc as 'legacy'", () => {
    expect(classifyMachineOwnership(null, THIS)).toBe("legacy");
    expect(classifyMachineOwnership(undefined, THIS)).toBe("legacy");
    expect(classifyMachineOwnership("", THIS)).toBe("legacy");
  });
});

describe("isLaunchEligibleOnThisMachine", () => {
  const THIS = "macbook-darwin-uuid-A";

  it("relaunches only this machine's own agents on boot", () => {
    expect(isLaunchEligibleOnThisMachine(THIS, THIS)).toBe(true);
  });

  it("REGRESSION (83 phantom agents): a foreign machine's doc is NOT launched — Windows boot must 0-launch Mac-owned agents", () => {
    expect(isLaunchEligibleOnThisMachine("windows-win32-uuid-B", THIS)).toBe(
      false,
    );
  });

  it("safe default: a legacy (unstamped) doc is NOT launched — it might belong to another machine", () => {
    expect(isLaunchEligibleOnThisMachine(null, THIS)).toBe(false);
    expect(isLaunchEligibleOnThisMachine(undefined, THIS)).toBe(false);
  });
});

describe("FOREIGN_MACHINE_SKIP_REASON (non-destructiveness guard)", () => {
  it("is NOT 'no-session' — foreign/legacy skips must not route to the renderer's stopped-marking branch, which would mutate another machine's live doc", () => {
    // The renderer only writes status:"stopped" for "no-session". Any other
    // reason hits its no-op branch. If this reason ever equaled "no-session",
    // a Windows boot would rewrite a Mac agent's status on the shared doc.
    expect(FOREIGN_MACHINE_SKIP_REASON).not.toBe("no-session");
    expect(FOREIGN_MACHINE_SKIP_REASON).toBe("foreign-machine");
  });
});
