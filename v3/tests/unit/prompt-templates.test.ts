// v3/tests/unit/prompt-templates.test.ts
import { describe, expect, it } from "vitest";
import {
  buildDecomposePrompt,
  buildAddTasksPrompt,
} from "../../electron/orchestrator/prompt-templates";

describe("decompose prompts request structured fields", () => {
  it("DECOMPOSE_SYSTEM mentions the four sections", () => {
    const sys = buildDecomposePrompt("build X")[0].content;
    for (const k of ["goal", "changes", "acceptance", "notes"]) {
      expect(sys).toContain(`"${k}"`);
    }
    expect(sys).toContain("add_activity");
  });
  it("ADD_TASKS_SYSTEM mentions the four sections", () => {
    const sys = buildAddTasksPrompt("existing", "new")[0].content;
    for (const k of ["goal", "changes", "acceptance", "notes"]) {
      expect(sys).toContain(`"${k}"`);
    }
  });
});
