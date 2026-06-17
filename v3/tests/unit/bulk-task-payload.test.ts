import { describe, expect, it } from "vitest";
import {
  BULK_TASK_INSERT_CHUNK_SIZE,
  chunkBulkTasks,
  normalizeBulkTasksPayload,
} from "../../electron/mcp-server/bulk-task-payload";

function makeTask(index: number) {
  return {
    title: `Bulk task ${index}`,
    goal: `Create task ${index}`,
    changes: [
      `Update service path ${index}`,
      `Preserve dependency mapping ${index}`,
    ],
    acceptance: [`Task ${index} is created`],
    role: "backend",
    priority: index,
  };
}

describe("normalizeBulkTasksPayload", () => {
  it("parses large tasks string payloads sent through tasks", () => {
    const encoded = JSON.stringify([makeTask(1), makeTask(2), makeTask(3)]);

    const result = normalizeBulkTasksPayload({ tasks: encoded });

    expect(result.error).toBeUndefined();
    expect(result.tasks).toHaveLength(3);
    expect(result.tasks?.[0].title).toBe("Bulk task 1");
    expect(result.tasks?.[2].acceptance).toEqual(["Task 3 is created"]);
  });

  it("keeps direct single-task arrays working", () => {
    const direct = [makeTask(1)];

    const result = normalizeBulkTasksPayload({ tasks: direct });

    expect(result.error).toBeUndefined();
    expect(result.tasks).toEqual(direct);
  });

  it("keeps small tasks_json payloads working", () => {
    const result = normalizeBulkTasksPayload({
      tasks_json: JSON.stringify([makeTask(1), makeTask(2)]),
    });

    expect(result.error).toBeUndefined();
    expect(result.tasks?.map((task) => task.title)).toEqual([
      "Bulk task 1",
      "Bulk task 2",
    ]);
  });

  it("returns clear errors for invalid JSON instead of throwing", () => {
    const result = normalizeBulkTasksPayload({ tasks: "[not-json" });

    expect(result.tasks).toBeUndefined();
    expect(result.error).toMatch(/^Error: Invalid tasks JSON:/);
  });

  it("returns clear errors for non-array payloads", () => {
    const result = normalizeBulkTasksPayload({
      tasks: JSON.stringify({ title: "not an array" }),
    });

    expect(result.tasks).toBeUndefined();
    expect(result.error).toBe("Error: tasks must be a JSON array.");
  });

  it("returns clear errors for non-object task entries", () => {
    const result = normalizeBulkTasksPayload({
      tasks_json: JSON.stringify([makeTask(1), "bad"]),
    });

    expect(result.tasks).toBeUndefined();
    expect(result.error).toBe("Error: tasks_json[1] must be a task object.");
  });
});

describe("chunkBulkTasks", () => {
  it("splits large inserts into server-side chunks", () => {
    const tasks = Array.from(
      { length: BULK_TASK_INSERT_CHUNK_SIZE + 3 },
      (_, i) => makeTask(i + 1),
    );

    const chunks = chunkBulkTasks(tasks);

    expect(chunks).toHaveLength(2);
    expect(chunks[0]).toHaveLength(BULK_TASK_INSERT_CHUNK_SIZE);
    expect(chunks[1]).toHaveLength(3);
  });

  it("keeps small inserts in one chunk", () => {
    expect(chunkBulkTasks([makeTask(1), makeTask(2)])).toHaveLength(1);
  });
});
