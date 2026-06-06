// v3/tests/unit/task-body.test.ts
import { describe, expect, it } from "vitest";
import {
  composeTaskBody,
  hasStructuredBody,
  validateTaskBodyInput,
  taskBodyStorageFields,
} from "../../electron/task-body";

describe("composeTaskBody", () => {
  it("composes all four sections, omitting nothing", () => {
    const out = composeTaskBody({
      goal: "머지 액션 + merge IPC 추가",
      changes: [
        "rebaseOntoBase(worktreePath, baseRef)",
        "squashMergeToBase(repoRoot, ...)",
      ],
      acceptance: ["worktree-manager.merge.test.ts 통과"],
      notes: ["충돌 시 안전 실패(rollback)"],
    });
    expect(out).toBe(
      [
        "## 목표",
        "머지 액션 + merge IPC 추가",
        "",
        "## 변경·접근",
        "- rebaseOntoBase(worktreePath, baseRef)",
        "- squashMergeToBase(repoRoot, ...)",
        "",
        "## 완료 기준",
        "- [ ] worktree-manager.merge.test.ts 통과",
        "",
        "## 제약·주의",
        "- 충돌 시 안전 실패(rollback)",
      ].join("\n"),
    );
  });

  it("omits empty sections (header included)", () => {
    expect(
      composeTaskBody({ goal: "G", changes: [], acceptance: ["a1"] }),
    ).toBe(["## 목표", "G", "", "## 완료 기준", "- [ ] a1"].join("\n"));
  });

  it("falls back to legacy description when no structured fields", () => {
    expect(composeTaskBody({ description: "hello world" })).toBe("hello world");
    expect(composeTaskBody({})).toBe("");
  });

  it("trims whitespace-only entries", () => {
    expect(composeTaskBody({ goal: "  ", changes: ["  ", "c1"] })).toBe(
      ["## 변경·접근", "- c1"].join("\n"),
    );
  });
});

describe("hasStructuredBody", () => {
  it("is true when any section has content", () => {
    expect(hasStructuredBody({ goal: "x" })).toBe(true);
    expect(hasStructuredBody({ acceptance: ["a"] })).toBe(true);
  });
  it("is false for legacy-only / empty", () => {
    expect(hasStructuredBody({ description: "x" })).toBe(false);
    expect(hasStructuredBody({ changes: ["  "] })).toBe(false);
    expect(hasStructuredBody({})).toBe(false);
  });
});

describe("validateTaskBodyInput", () => {
  it("errors when neither goal nor description present", () => {
    expect(validateTaskBodyInput({}).error).toMatch(/required/i);
  });
  it("warns when structured but no acceptance", () => {
    const r = validateTaskBodyInput({ goal: "G", changes: ["c"] });
    expect(r.error).toBeUndefined();
    expect(r.warning).toMatch(/acceptance|완료 기준/);
  });
  it("passes for legacy description", () => {
    expect(validateTaskBodyInput({ description: "x" })).toEqual({});
  });
});

describe("taskBodyStorageFields", () => {
  it("returns structured fields + blanked description when structured", () => {
    expect(
      taskBodyStorageFields({
        goal: "G",
        changes: ["c", "  "],
        acceptance: ["a"],
        notes: [],
      }),
    ).toEqual({
      goal: "G",
      changes: ["c"],
      acceptance: ["a"],
      notes: [],
      description: "",
    });
  });
  it("returns only description when legacy", () => {
    expect(taskBodyStorageFields({ description: "  hi  " })).toEqual({
      description: "hi",
    });
  });
});
