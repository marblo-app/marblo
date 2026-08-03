import { describe, expect, it } from "vitest";
import {
  hasSeenFirstMissionShareNudge,
  markFirstMissionShareNudgeSeen,
  type FirstMissionShareNudgeStorage,
} from "../../src/stores/firstMissionShareNudge";

function memoryStorage(): FirstMissionShareNudgeStorage {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("first mission share nudge watermark", () => {
  it("has not been seen before it is marked", () => {
    const storage = memoryStorage();
    expect(hasSeenFirstMissionShareNudge(storage, "project-1")).toBe(false);
  });

  it("is seen after being marked, and stays scoped to the project", () => {
    const storage = memoryStorage();
    markFirstMissionShareNudgeSeen(storage, "project-1");

    expect(hasSeenFirstMissionShareNudge(storage, "project-1")).toBe(true);
    expect(hasSeenFirstMissionShareNudge(storage, "project-2")).toBe(false);
  });

  it("marking again is idempotent", () => {
    const storage = memoryStorage();
    markFirstMissionShareNudgeSeen(storage, "project-1");
    markFirstMissionShareNudgeSeen(storage, "project-1");

    expect(hasSeenFirstMissionShareNudge(storage, "project-1")).toBe(true);
  });

  it("treats a null storage or project id as unseen / a no-op", () => {
    const storage = memoryStorage();
    expect(hasSeenFirstMissionShareNudge(null, "project-1")).toBe(false);
    expect(hasSeenFirstMissionShareNudge(storage, null)).toBe(false);

    // Should not throw when there's nothing to write to.
    markFirstMissionShareNudgeSeen(null, "project-1");
    markFirstMissionShareNudgeSeen(storage, null);
    expect(hasSeenFirstMissionShareNudge(storage, "project-1")).toBe(false);
  });
});
