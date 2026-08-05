import { beforeEach, describe, expect, it } from "vitest";
import { doc, getDoc, setDoc, __resetStore } from "../mocks/firebase-firestore";
import {
  applyProjection,
  type MissionProjection,
  type TaskProjection,
} from "../../electron/mcp-server/projection";

const db = {} as never;

beforeEach(() => __resetStore());

describe("mission projection capture", () => {
  it("mission task status transition fills missions.projection and taskIds", async () => {
    await setDoc(doc(db, "missions", "m1"), {
      projectId: "p1",
      taskIds: [],
    });
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: "p1",
      status: "TODO",
      missionId: "m1",
      contextId: "m1",
    });

    await applyProjection(db, "t1", {
      newStatus: "IN_PROGRESS",
      lastAgentId: "agent-1",
      lastActivitySummary: "started",
    });

    const mission = (await getDoc(doc(db, "missions", "m1"))).data() as {
      taskIds: string[];
      projection: MissionProjection;
    };
    expect(mission.taskIds).toEqual(["t1"]);
    expect(mission.projection.statusCounts).toEqual({
      TODO: 0,
      IN_PROGRESS: 1,
    });
    expect(mission.projection.lastTaskActivityAt).toBeTruthy();
  });

  it("legacy contextId-only mission task is backfilled and captured on activity", async () => {
    await setDoc(doc(db, "missions", "m1"), {
      projectId: "p1",
      taskIds: [],
    });
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: "p1",
      status: "DONE",
      contextId: "m1",
    });

    await applyProjection(db, "t1", {
      lastAgentId: "agent-1",
      lastActivitySummary: "completion notes",
      activityPayload: { agentId: "agent-1", message: "completion notes" },
    });

    const task = (await getDoc(doc(db, "tasks", "t1"))).data() as {
      missionId?: string;
      projection: TaskProjection;
    };
    const mission = (await getDoc(doc(db, "missions", "m1"))).data() as {
      taskIds: string[];
      projection: MissionProjection;
    };
    expect(task.missionId).toBe("m1");
    expect(task.projection.lastActivitySummary).toBe("completion notes");
    expect(mission.taskIds).toEqual(["t1"]);
    expect(mission.projection.statusCounts).toEqual({ DONE: 1 });
  });

  it("mission taskIds heal without duplicating existing entries", async () => {
    await setDoc(doc(db, "missions", "m1"), {
      projectId: "p1",
      taskIds: ["t1"],
      projection: { statusCounts: { TODO: 1 } },
    });
    await setDoc(doc(db, "tasks", "t1"), {
      projectId: "p1",
      status: "TODO",
      missionId: "m1",
      contextId: "m1",
    });

    await applyProjection(db, "t1", {
      newStatus: "DONE",
      lastAgentId: "agent-1",
    });

    const mission = (await getDoc(doc(db, "missions", "m1"))).data() as {
      taskIds: string[];
      projection: MissionProjection;
    };
    expect(mission.taskIds).toEqual(["t1"]);
    expect(mission.projection.statusCounts).toEqual({ TODO: 0, DONE: 1 });
  });
});
