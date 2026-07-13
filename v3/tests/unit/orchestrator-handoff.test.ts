import { describe, expect, it } from "vitest";
import {
  buildOrchestratorHandoffSnapshot,
  formatHandoffPrompt,
  resolveSwitchHandoffResumeSessionId,
  sanitizeHandoffValue,
} from "../../electron/orchestrator-handoff";

describe("orchestrator handoff snapshot", () => {
  it("redacts sensitive values and limits mission timeline", () => {
    const contextLog = Array.from({ length: 20 }, (_, i) => ({
      ts: new Date(2026, 0, i + 1),
      type: i === 19 ? "agent.stuck" : "supervisor.note",
      payload: {
        message: `event-${i}`,
        apiKey: "sk-1234567890abcdef",
        nested: { token: "secret-token-value" },
      },
    }));

    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old", claudeSessionId: "claude-old" },
      targetModel: "gpt",
      resumeSessionId: "new",
      missions: [
        {
          id: "mission-1",
          data: {
            projectId: "project-1",
            goal: "Ship feature",
            status: "waiting_for_human",
            currentStepIndex: 0,
            steps: [
              {
                index: 0,
                type: "gstack",
                status: "running",
                args: "use token abc.defghijklmnopqrstuvwxyz",
                liveOutput: "tail with sk-1234567890abcdef",
              },
            ],
            taskIds: ["task-1"],
            contextLog,
            lastActivityAt: new Date(2026, 0, 21),
          },
        },
      ],
      tasks: [],
      now: 123,
    });

    const mission = snapshot.activeMissions[0];
    expect(mission.recentTimeline).toHaveLength(12);
    expect(mission.unresolvedDecisions.length).toBeGreaterThan(0);
    expect(JSON.stringify(snapshot)).not.toContain("sk-1234567890abcdef");
    expect(JSON.stringify(snapshot)).toContain("[redacted]");
  });

  it("captures in-flight, blocked, and review board work", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: null },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [
        {
          id: "task-1",
          data: {
            title: "Implement",
            status: "IN_PROGRESS",
            role: "frontend",
            claimedBy: "agent-1",
            updatedAt: new Date(2026, 0, 2),
          },
        },
        {
          id: "task-2",
          data: {
            title: "Blocked",
            status: "BLOCKED",
            role: "backend",
            comment: "needs token sk-1234567890abcdef",
          },
        },
        {
          id: "task-3",
          data: {
            title: "Review",
            status: "REVIEW",
            role: "test",
            prUrl: "https://example.test/pr/1",
          },
        },
      ],
      now: 123,
    });

    expect(snapshot.board.inFlightTasks).toHaveLength(1);
    expect(snapshot.board.blockedTasks).toEqual([
      {
        id: "task-2",
        title: "Blocked",
        comment: "needs token [redacted]",
      },
    ]);
    expect(snapshot.board.reviewTasks).toHaveLength(1);
  });

  it("formats wait and takeover prompts with source-of-truth guardrails", () => {
    const snapshot = buildOrchestratorHandoffSnapshot({
      projectId: "project-1",
      rootPath: "/repo",
      from: { ptySessionId: "pty-old" },
      targetModel: "claude",
      resumeSessionId: "new",
      missions: [],
      tasks: [],
      now: 123,
    });

    expect(formatHandoffPrompt(snapshot, "wait")).toContain(
      "wait for the user",
    );
    expect(formatHandoffPrompt(snapshot, "takeover")).toContain(
      "continue only the next safe action",
    );
    expect(formatHandoffPrompt(snapshot, "wait")).toContain(
      "Firestore missions/* and tasks/* are the source of truth",
    );
  });

  it("redacts by sensitive key names", () => {
    expect(
      sanitizeHandoffValue({
        accessToken: "plain-token",
        nested: { password: "pw" },
      }),
    ).toEqual({
      accessToken: "[redacted]",
      nested: { password: "[redacted]" },
    });
  });

  it("falls back to a new Codex switch session when no saved session exists", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "gpt",
      hasSavedGptSession: () => false,
      resolvePreviousNonGptSession: () => {
        throw new Error("non-gpt resolver should not run for Codex");
      },
    });

    expect(resumeSessionId).toBe("new");
  });

  it("uses Codex latest only when the isolated orchestrator home has a saved session", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "gpt",
      hasSavedGptSession: () => true,
      resolvePreviousNonGptSession: () => null,
    });

    expect(resumeSessionId).toBe("latest");
  });

  it("keeps non-Codex switch resume resolution on the orchestrator labels", () => {
    const resumeSessionId = resolveSwitchHandoffResumeSessionId({
      resume: "previous",
      targetModel: "claude",
      hasSavedGptSession: () => {
        throw new Error("Codex saved-session check should not run for Claude");
      },
      resolvePreviousNonGptSession: () => "claude-session-1",
    });

    expect(resumeSessionId).toBe("claude-session-1");
  });
});
