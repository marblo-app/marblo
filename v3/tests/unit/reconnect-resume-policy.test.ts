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
  resolveReconnectCwd,
  classifyNoSessionReason,
  summarizeReconnectSkips,
  type ReconnectSkip,
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

/**
 * Regression: "claude 만 전멸" (uvyCqzJ3tRP3VYVSon7K).
 *
 * `agent:reconnect` used to search/relaunch every agent under the single
 * project `rootPath`, even though task agents actually run in a per-task
 * worktree (`<worktreesRoot>/<projectId>/<taskId>` — same convention as
 * `worktreeCoordinator.prepare()`). Claude's session store is keyed by the
 * literal cwd, so a task agent's session was never found under `rootPath` —
 * every single time, independent of whether the worktree still existed.
 * Codex/Gemini sessions are keyed by agentId alone, so they were never
 * exposed to this bug, which is the entire asymmetry the ticket reports.
 *
 * resolveReconnectCwd is the fix: pick the agent's REAL cwd (its task
 * worktree, when it has one and it still exists) instead of always falling
 * back to rootPath.
 */
describe("resolveReconnectCwd", () => {
  it("uses rootPath for an agent with no currentTaskId (unaffected legacy path)", () => {
    const result = resolveReconnectCwd("/project/root", null, false);
    expect(result).toEqual({
      cwd: "/project/root",
      isTaskScoped: false,
      worktreeMissing: false,
    });
  });

  it("REGRESSION FIX: uses the task worktree path (not rootPath) when it exists — this is the exact case that made every Claude task agent 'no-session' on cold boot", () => {
    const result = resolveReconnectCwd(
      "/project/root",
      "/home/.marblo/worktrees/proj123/task456",
      true,
    );
    expect(result).toEqual({
      cwd: "/home/.marblo/worktrees/proj123/task456",
      isTaskScoped: true,
      worktreeMissing: false,
    });
  });

  it("case (나) — worktree genuinely gone (e.g. merge_and_close): falls back to rootPath but flags worktreeMissing so the caller can report the CORRECT reason instead of a generic no-session", () => {
    const result = resolveReconnectCwd(
      "/project/root",
      "/home/.marblo/worktrees/proj123/task456",
      false,
    );
    expect(result.worktreeMissing).toBe(true);
    expect(result.isTaskScoped).toBe(true);
    // cwd still needs to be a valid string for callers, even though nothing
    // will actually be resumed (worktreeMissing gates that upstream).
    expect(result.cwd).toBe("/project/root");
  });
});

describe("classifyNoSessionReason", () => {
  it("classifies a genuinely-gone worktree as 'worktree-missing' — case (나): correct behavior, not a bug", () => {
    expect(classifyNoSessionReason(true)).toBe("worktree-missing");
  });

  it("classifies an existing-but-sessionless directory as 'session-not-found' — worth investigating as a possible resume-path defect (case 가)", () => {
    expect(classifyNoSessionReason(false)).toBe("session-not-found");
  });
});

/**
 * 오케 리뷰 (PR #1488): worktree-missing(정상) 과 session-not-found/
 * launch-failed(결함 가능성) 를 같은 볼륨으로 알리면 안 된다 — 워크트리를
 * 여러 개 정리한 날 오케 PTY 에 에이전트 수만큼 줄이 쏟아지면 알림을 무시하게
 * 만든다. summarizeReconnectSkips 는 전자를 개수 한 줄로 접고, 후자만
 * 이름별로 나열한다.
 */
describe("summarizeReconnectSkips", () => {
  it("returns an empty summary for no skips", () => {
    expect(summarizeReconnectSkips([])).toEqual({
      message: "",
      signature: "",
    });
  });

  it("collapses worktree-missing into ONE count line — NOT one line per agent", () => {
    const skips: ReconnectSkip[] = [
      {
        name: "backend-claude-1",
        model: "claude",
        category: "worktree-missing",
      },
      {
        name: "backend-claude-2",
        model: "claude",
        category: "worktree-missing",
      },
      {
        name: "backend-claude-3",
        model: "claude",
        category: "worktree-missing",
      },
    ];
    const { message } = summarizeReconnectSkips(skips);
    const lines = message.split("\n");
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("3");
    // Individual agent names must NOT leak into the "expected, not a bug"
    // summary line — that's exactly the volume this ticket flags.
    expect(message).not.toContain("backend-claude-1");
  });

  it("itemizes session-not-found by name — this is the category worth a closer look", () => {
    const skips: ReconnectSkip[] = [
      {
        name: "backend-claude-1",
        model: "claude",
        category: "session-not-found",
      },
      {
        name: "frontend-claude-2",
        model: "claude",
        category: "session-not-found",
      },
    ];
    const { message } = summarizeReconnectSkips(skips);
    expect(message).toContain("backend-claude-1");
    expect(message).toContain("frontend-claude-2");
    expect(message).toContain("session-not-found");
  });

  it("itemizes launch-failed with its error detail", () => {
    const skips: ReconnectSkip[] = [
      {
        name: "backend-gpt-1",
        model: "gpt",
        category: "launch-failed",
        detail: "spawn ENOENT",
      },
    ];
    const { message } = summarizeReconnectSkips(skips);
    expect(message).toContain("backend-gpt-1");
    expect(message).toContain("spawn ENOENT");
  });

  it("keeps worktree-missing and concerning categories on separate lines when both occur", () => {
    const skips: ReconnectSkip[] = [
      { name: "a", model: "claude", category: "worktree-missing" },
      { name: "b", model: "claude", category: "worktree-missing" },
      { name: "c", model: "claude", category: "session-not-found" },
    ];
    const { message } = summarizeReconnectSkips(skips);
    const lines = message.split("\n");
    expect(lines).toHaveLength(2);
    expect(lines.some((l) => l.includes("2") && !l.includes("c"))).toBe(true);
    expect(lines.some((l) => l.includes("c"))).toBe(true);
  });

  it("signature is order-independent — the same failing set produces the same signature regardless of iteration order (required for the upstream throttle to recognize 'unchanged')", () => {
    const a: ReconnectSkip[] = [
      { name: "x", model: "claude", category: "session-not-found" },
      { name: "y", model: "claude", category: "worktree-missing" },
    ];
    const b: ReconnectSkip[] = [a[1], a[0]];
    expect(summarizeReconnectSkips(a).signature).toBe(
      summarizeReconnectSkips(b).signature,
    );
  });

  it("signature changes when the failing set changes — a NEW failure must not be swallowed by the throttle", () => {
    const before: ReconnectSkip[] = [
      { name: "x", model: "claude", category: "session-not-found" },
    ];
    const after: ReconnectSkip[] = [
      { name: "x", model: "claude", category: "session-not-found" },
      { name: "z", model: "claude", category: "session-not-found" },
    ];
    expect(summarizeReconnectSkips(before).signature).not.toBe(
      summarizeReconnectSkips(after).signature,
    );
  });
});
