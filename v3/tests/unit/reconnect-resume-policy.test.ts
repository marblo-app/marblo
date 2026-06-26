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
import { resolveClaudeColdBootResumeId } from "../../electron/reconnect-manager";

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
