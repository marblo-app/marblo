// v3/tests/unit/task-body.test.ts
import { describe, expect, it } from "vitest";
import {
  composeTaskBody,
  hasStructuredBody,
  validateTaskBodyInput,
  taskBodyStorageFields,
  validateTaskBodySections,
} from "../../electron/mcp-server/task-body";

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

  it("renders the structured body even when description is blank-stored", () => {
    // Structured tasks are persisted with description:"" (taskBodyStorageFields).
    // get_task must render the structured body instead of showing "(empty)",
    // else agents read the brief as "설명 비어있음". (friction #5)
    const out = composeTaskBody({
      goal: "G",
      changes: ["c1"],
      acceptance: ["a1"],
      description: "",
    });
    expect(out).toContain("## 목표");
    expect(out).toContain("c1");
    expect(out).not.toBe("");
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

// 티켓 20GMXojE9iHf5giBckOR — create_tasks_bulk 가 "(arr ?? []).map is not a
// function" 으로 배치 전체를 죽이던 버그. MCP 입력은 Record<string, unknown>
// 이라 tools.ts 가 `as string[]` 로 무검증 캐스팅했고, 호출자가 섹션 필드를
// 문자열로 주면 nonEmpty() 안에서 TypeError 가 나 핸들러 밖으로 튀었다.
describe("섹션 필드가 배열이 아닐 때 (MCP 무검증 캐스팅 방어)", () => {
  const badShapes: Array<[string, unknown]> = [
    ["문자열", "한 줄짜리 변경사항"],
    ["숫자", 42],
    ["객체", { a: 1 }],
  ];

  for (const [label, value] of badShapes) {
    it(`hasStructuredBody 가 ${label} 에 대해 throw 하지 않는다`, () => {
      expect(() =>
        hasStructuredBody({ changes: value } as never),
      ).not.toThrow();
    });

    it(`taskBodyStorageFields 가 ${label} 에 대해 throw 하지 않는다`, () => {
      expect(() =>
        taskBodyStorageFields({ goal: "G", notes: value } as never),
      ).not.toThrow();
    });
  }

  it("문자열은 한 줄짜리 섹션으로 해석한다(명백한 의도)", () => {
    expect(
      taskBodyStorageFields({ goal: "G", changes: "한 줄" } as never),
    ).toMatchObject({ changes: ["한 줄"] });
  });

  it("배열 안의 비문자열 원소는 버린다", () => {
    expect(
      taskBodyStorageFields({ goal: "G", changes: ["ok", 5, null] } as never),
    ).toMatchObject({ changes: ["ok"] });
  });
});

describe("validateTaskBodySections", () => {
  it("정상 입력은 통과", () => {
    expect(validateTaskBodySections({ goal: "G", changes: ["a"] })).toBeNull();
  });

  it("배열이어야 할 필드가 문자열이면 필드명과 기대 타입을 알려준다", () => {
    const err = validateTaskBodySections({ changes: "문자열" } as never);
    expect(err).toContain("changes");
    expect(err).toMatch(/배열|array/);
  });

  it("여러 필드가 잘못돼도 첫 필드를 지목한다", () => {
    expect(validateTaskBodySections({ acceptance: 1 } as never)).toContain(
      "acceptance",
    );
  });
});
