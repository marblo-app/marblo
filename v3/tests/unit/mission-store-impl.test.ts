import { afterEach, describe, expect, it, vi } from "vitest";
import { rawToMission } from "../../electron/mission-engine/store-impl";

type RawMissionDoc = Parameters<typeof rawToMission>[1];

describe("mission store rawToMission", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does not create Invalid Date when a contextLog entry has no ts", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-10T12:00:00.000Z"));

    const raw = {
      projectId: "project-1",
      goal: "Keep legacy timeline entries readable",
      templateId: "quick-fix",
      status: "active",
      ownerOrchestratorSessionId: "orch-1",
      steps: [],
      currentStepIndex: 0,
      taskIds: [],
      contextLog: [
        {
          type: "supervisor.note",
          payload: { message: "legacy entry" },
        },
      ],
      launchedAt: new Date("2026-06-10T11:00:00.000Z"),
      lastActivityAt: new Date("2026-06-10T11:30:00.000Z"),
      completedAt: null,
    } as unknown as RawMissionDoc;

    const mission = rawToMission("mission-1", raw);
    const eventTs = mission.contextLog[0]?.ts;

    expect(eventTs).toBeInstanceOf(Date);
    expect(Number.isNaN(eventTs?.getTime())).toBe(false);
    expect(eventTs?.toISOString()).toBe("2026-06-10T12:00:00.000Z");
  });
});
