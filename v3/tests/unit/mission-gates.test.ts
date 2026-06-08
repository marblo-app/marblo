import { describe, expect, it } from "vitest";

import { verifyStepGate } from "../../electron/mission-engine/gates";
import type { Mission, MissionStep } from "../../electron/mission-engine/types";

describe("verifyStepGate", () => {
  it("fails wait steps while mission tasks are not all DONE", async () => {
    const result = await verifyStepGate(step({ type: "wait" }), {
      mission: mission(["task-1", "task-2", "task-3"]),
      getTaskStatuses: async () => ({
        "task-1": "DONE",
        "task-2": "IN_PROGRESS",
      }),
    });

    expect(result).toEqual({ pass: false, reason: "2 tasks pending" });
  });

  it("passes wait steps when all mission tasks are DONE", async () => {
    const result = await verifyStepGate(step({ type: "wait" }), {
      mission: mission(["task-1", "task-2"]),
      getTaskStatuses: async () => ({
        "task-1": "DONE",
        "task-2": "DONE",
      }),
    });

    expect(result).toEqual({ pass: true });
  });

  it("uses the same task completion gate for dispatch steps", async () => {
    const result = await verifyStepGate(step({ type: "dispatch" }), {
      mission: mission(["task-1"]),
      getTaskStatuses: async () => ({ "task-1": "REVIEW" }),
    });

    expect(result).toEqual({ pass: false, reason: "1 tasks pending" });
  });

  it("fails ship steps without a GitHub PR URL", async () => {
    const result = await verifyStepGate(
      step({ type: "gstack", skill: "/ship", output: "ready to ship" }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: false, reason: "no PR url" });
  });

  it("passes ship steps with a GitHub PR URL", async () => {
    const result = await verifyStepGate(
      step({
        type: "gstack",
        skill: "/ship",
        output: "Created https://github.com/marblo-app/marblo/pull/123",
      }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: true });
  });

  it("fails regular gstack steps with no output", async () => {
    const result = await verifyStepGate(
      step({ type: "gstack", skill: "/investigate", output: "   " }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: false, reason: "no output yet" });
  });

  it("passes regular gstack steps with non-empty output", async () => {
    const result = await verifyStepGate(
      step({ type: "gstack", skill: "/investigate", output: "done" }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: true });
  });

  it("passes review steps by default unless a fail marker is present", async () => {
    const result = await verifyStepGate(
      step({ type: "gstack", skill: "/review", output: "" }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: true });
  });

  it("fails review steps when a fail marker is present", async () => {
    const result = await verifyStepGate(
      step({
        type: "gstack",
        skill: "/review",
        output: "REJECT: missing tests",
      }),
      {
        mission: mission([]),
        getTaskStatuses: async () => ({}),
      },
    );

    expect(result).toEqual({ pass: false, reason: "review failed" });
  });
});

function step(patch: Partial<MissionStep>): MissionStep {
  return {
    index: 0,
    type: "gstack",
    status: "success",
    ...patch,
  };
}

function mission(taskIds: string[]): Mission {
  const now = new Date("2026-06-08T00:00:00.000Z");

  return {
    id: "mission-1",
    projectId: "project-1",
    goal: "Verify gate behavior",
    templateId: "quick-fix",
    status: "active",
    ownerOrchestratorSessionId: "session-1",
    steps: [],
    currentStepIndex: 0,
    taskIds,
    contextLog: [],
    launchedAt: now,
    lastActivityAt: now,
    completedAt: null,
  };
}
