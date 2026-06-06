# Structured Task Tickets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 태스크 티켓 `description` 자유서술을 `goal/changes/acceptance/notes` 4섹션 스키마 필드로 전환해, 모든 오케스트레이터가 일관되게 깔끔한 티켓을 쓰게 한다.

**Architecture:** 포맷팅을 LLM이 아니라 코드(`composeTaskBody()`)가 담당. MCP `create_task`/`create_tasks_bulk`(직접 호출 경로)와 미션 분해(`dispatcher` 경로) 양쪽에서 구조화 필드를 저장하고, 에이전트 instruction은 `composeTaskBody()`로 합성. UI는 구조화 필드를 직접 섹션 렌더(마크다운 의존 없음). 새 필드는 전부 optional → 기존 티켓 무손상.

**Tech Stack:** TypeScript, Electron(ESM, `.js` import 확장자), Firebase Firestore, React + Zustand + Tailwind, Zod, Vitest.

**참조 스펙:** `docs/superpowers/specs/2026-06-06-structured-task-tickets-design.md`
**추적 티켓:** marblo `xWS7QqhrxgEqSpqmUPLq` (project `GF88JnJrrX6AqahqmGB3`)

---

## 사전 작업: 브랜치

- [ ] **Step 0: 전용 브랜치 생성 (현재 HEAD에서 — 스펙/플랜 커밋 포함)**

현재 작업트리에 무관한 WIP가 있으므로 **모든 커밋은 명시적 파일 경로로만 스테이징**한다 (`git add -A` 금지).

```bash
cd /Users/dongwonkim/Documents/programming/marblo
git checkout -b feat/structured-task-tickets
git add docs/superpowers/plans/2026-06-06-structured-task-tickets.md
git commit -m "docs(v3): 구조화된 태스크 티켓 구현 플랜"
```

---

## Task 1: composeTaskBody 코어 (순수 함수, TDD)

티켓 본문 합성·검증·저장필드 매핑의 단일 출처. 순수 함수라 먼저 TDD로 고정한다.

**Files:**

- Create: `v3/electron/task-body.ts`
- Test: `v3/tests/unit/task-body.test.ts`

- [ ] **Step 1: 실패 테스트 작성**

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd v3 && npx vitest run tests/unit/task-body.test.ts`
Expected: FAIL — `Cannot find module '../../electron/task-body'`.

- [ ] **Step 3: 구현 작성**

```ts
// v3/electron/task-body.ts

/** 섹션 라벨 (UI 렌더러와 동일 라벨 유지). */
export const SECTION_LABELS = {
  goal: "목표",
  changes: "변경·접근",
  acceptance: "완료 기준",
  notes: "제약·주의",
} as const;

export interface TaskBodyFields {
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  /** legacy 자유서술 — 구조화 필드가 없을 때만 사용. */
  description?: string;
}

function nonEmpty(arr: string[] | undefined): string[] {
  return (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

/** 구조화 섹션 중 하나라도 내용이 있으면 true. */
export function hasStructuredBody(t: TaskBodyFields): boolean {
  return Boolean(
    (t.goal && t.goal.trim()) ||
    nonEmpty(t.changes).length ||
    nonEmpty(t.acceptance).length ||
    nonEmpty(t.notes).length,
  );
}

/** 구조화 필드 → 에이전트/플랫 텍스트 본문. 빈 섹션은 헤더째 생략. 구조화 필드가 없으면 legacy description. */
export function composeTaskBody(t: TaskBodyFields): string {
  if (!hasStructuredBody(t)) return (t.description ?? "").trim();
  const blocks: string[] = [];
  if (t.goal && t.goal.trim()) {
    blocks.push(`## ${SECTION_LABELS.goal}\n${t.goal.trim()}`);
  }
  const changes = nonEmpty(t.changes);
  if (changes.length) {
    blocks.push(
      `## ${SECTION_LABELS.changes}\n${changes.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  const acceptance = nonEmpty(t.acceptance);
  if (acceptance.length) {
    blocks.push(
      `## ${SECTION_LABELS.acceptance}\n${acceptance.map((a) => `- [ ] ${a}`).join("\n")}`,
    );
  }
  const notes = nonEmpty(t.notes);
  if (notes.length) {
    blocks.push(
      `## ${SECTION_LABELS.notes}\n${notes.map((n) => `- ${n}`).join("\n")}`,
    );
  }
  return blocks.join("\n\n");
}

/** create_task 입력 검증. error 면 차단, warning 은 안내. */
export function validateTaskBodyInput(t: TaskBodyFields): {
  error?: string;
  warning?: string;
} {
  const structured = hasStructuredBody(t);
  if (!structured && !(t.description && t.description.trim())) {
    return { error: "goal (또는 legacy description) is required." };
  }
  if (structured && nonEmpty(t.acceptance).length === 0) {
    return {
      warning:
        "완료 기준(acceptance)이 비어 있습니다 — 검증 가능한 항목을 추가하세요.",
    };
  }
  return {};
}

/** Firestore 저장용 본문 필드 부분집합. 구조화면 4필드 + description:"" , legacy면 description 만. */
export function taskBodyStorageFields(
  t: TaskBodyFields,
): Record<string, unknown> {
  if (hasStructuredBody(t)) {
    return {
      goal: t.goal?.trim() ?? "",
      changes: nonEmpty(t.changes),
      acceptance: nonEmpty(t.acceptance),
      notes: nonEmpty(t.notes),
      description: "",
    };
  }
  return { description: (t.description ?? "").trim() };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `cd v3 && npx vitest run tests/unit/task-body.test.ts`
Expected: PASS (all cases).

- [ ] **Step 5: 커밋**

```bash
git add v3/electron/task-body.ts v3/tests/unit/task-body.test.ts
git commit -m "feat(v3): composeTaskBody 코어 — 구조화 티켓 본문 합성/검증/저장필드"
```

---

## Task 2: DecomposedTask + decomposer 구조화 필드 전파 (TDD)

미션 자동 분해 경로가 구조화 필드를 끝까지 운반하도록 타입/검증을 확장한다.

**Files:**

- Modify: `v3/electron/orchestrator/dag-generator.ts:3-11`
- Modify: `v3/electron/orchestrator/task-decomposer.ts:13-65`
- Test: `v3/tests/unit/task-decomposer-validate.test.ts` (신규)

- [ ] **Step 1: 실패 테스트 작성**

```ts
// v3/tests/unit/task-decomposer-validate.test.ts
import { describe, expect, it } from "vitest";
import { validateTask } from "../../electron/orchestrator/task-decomposer";

describe("validateTask carries structured fields", () => {
  it("passes goal/changes/acceptance/notes through", () => {
    const out = validateTask(
      {
        title: "T",
        goal: "do X",
        changes: ["c1"],
        acceptance: ["a1"],
        notes: ["n1"],
        role: "backend",
        priority: 3,
        depends_on: [],
        scope: [],
        estimatedHours: 1,
      } as any,
      0,
      1,
    );
    expect(out.goal).toBe("do X");
    expect(out.changes).toEqual(["c1"]);
    expect(out.acceptance).toEqual(["a1"]);
    expect(out.notes).toEqual(["n1"]);
  });

  it("defaults arrays to empty when omitted", () => {
    const out = validateTask(
      {
        title: "T",
        role: "backend",
        priority: 3,
        depends_on: [],
        scope: [],
        estimatedHours: 1,
      } as any,
      0,
      1,
    );
    expect(out.changes).toEqual([]);
    expect(out.acceptance).toEqual([]);
    expect(out.notes).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd v3 && npx vitest run tests/unit/task-decomposer-validate.test.ts`
Expected: FAIL — `validateTask` not exported / `out.goal` undefined.

- [ ] **Step 3: DecomposedTask 확장**

`v3/electron/orchestrator/dag-generator.ts` 의 `DecomposedTask` (3-11) 에 `description` 아래로 추가:

```ts
export interface DecomposedTask {
  title: string;
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  role: "backend" | "frontend" | "test" | "devops";
  priority: number;
  depends_on: string[];
  scope: string[];
  estimatedHours: number;
}
```

- [ ] **Step 4: decomposer 응답 타입 + validateTask 확장**

`v3/electron/orchestrator/task-decomposer.ts`:

`DecomposeResponse` 와 `AddTasksResponse` 의 `tasks` 항목 타입(15-23, 27-35)을 다음으로 교체(두 곳 동일):

```ts
tasks: Array<{
  title: string;
  description?: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  role: string;
  priority: number;
  depends_on: string[];
  scope: string[];
  estimatedHours: number;
}>;
```

`validateTask` (43줄) 의 `function` 키워드 앞에 `export` 를 추가하고, return 객체(56-64)를 교체:

```ts
export function validateTask(
  raw: DecomposeResponse["tasks"][number],
  index: number,
  totalCount: number,
): DecomposedTask {
  const role = VALID_ROLES.has(raw.role)
    ? (raw.role as DecomposedTask["role"])
    : "backend";
  const priority = Math.max(1, Math.min(5, Math.round(raw.priority ?? 3)));
  const estimatedHours = Math.max(0.5, Math.min(8, raw.estimatedHours ?? 1));

  const validDeps = (raw.depends_on ?? []).filter((dep) => {
    if (!TASK_REF_RE.test(dep)) return false;
    const refIndex = parseInt(dep.replace(/^TASK-/i, ""), 10);
    return refIndex >= 1 && refIndex <= totalCount && refIndex !== index + 1;
  });

  return {
    title: raw.title || `Task ${index + 1}`,
    description: raw.description || "",
    goal: raw.goal?.trim() || undefined,
    changes: raw.changes ?? [],
    acceptance: raw.acceptance ?? [],
    notes: raw.notes ?? [],
    role,
    priority,
    depends_on: validDeps,
    scope: raw.scope ?? [],
    estimatedHours,
  };
}
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd v3 && npx vitest run tests/unit/task-decomposer-validate.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add v3/electron/orchestrator/dag-generator.ts v3/electron/orchestrator/task-decomposer.ts v3/tests/unit/task-decomposer-validate.test.ts
git commit -m "feat(v3): DecomposedTask/decomposer에 goal/changes/acceptance/notes 전파"
```

---

## Task 3: 분해 프롬프트 구조화 (TDD)

`DECOMPOSE_SYSTEM` / `ADD_TASKS_SYSTEM` 의 출력 JSON을 구조화 필드로 바꾸고 작성 규칙을 박는다.

**Files:**

- Modify: `v3/electron/orchestrator/prompt-templates.ts:6-32, 50-72`
- Test: `v3/tests/unit/prompt-templates.test.ts` (신규)

- [ ] **Step 1: 실패 테스트 작성**

```ts
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
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `cd v3 && npx vitest run tests/unit/prompt-templates.test.ts`
Expected: FAIL — `"goal"` not found.

- [ ] **Step 3: DECOMPOSE_SYSTEM 교체**

`v3/electron/orchestrator/prompt-templates.ts` 의 `DECOMPOSE_SYSTEM` (6-32) 를 교체:

```ts
const DECOMPOSE_SYSTEM = `You are a senior software architect who breaks down project requirements into actionable development tasks.

Rules:
- Each task should be 1-2 hours of focused work
- Assign roles: backend, frontend, test, devops
- Use TASK-NNN format (1-based) for depends_on references within the batch
- Priority: 1 (low) to 5 (critical)
- scope: list specific file paths the task will modify
- estimatedHours: realistic estimate (0.5 to 4)
- Ensure no circular dependencies
- Order tasks so dependencies come before dependents

Ticket body — fill these STRUCTURED fields (do NOT cram everything into one paragraph):
- goal: 1-2 sentences, what & why. No file paths here.
- changes: array of short bullet strings — concrete functions/behaviors to add or modify. No run-on sentences, no duplication.
- acceptance: array of verifiable done-criteria (e.g. "tests/unit/foo.test.ts passes").
- notes: array (optional) — constraints, rollback rules, reuse notes.
Put file paths in "scope", not in prose. Progress updates during work go to add_activity, never the ticket body.

Output format (strict JSON, no markdown):
{
  "projectName": "string",
  "tasks": [
    {
      "title": "string (한 줄)",
      "goal": "string",
      "changes": ["string"],
      "acceptance": ["string"],
      "notes": ["string"],
      "role": "backend" | "frontend" | "test" | "devops",
      "priority": 1-5,
      "depends_on": ["TASK-NNN"],
      "scope": ["path/to/file.ts"],
      "estimatedHours": 1.5
    }
  ]
}`;
```

- [ ] **Step 4: ADD_TASKS_SYSTEM 교체**

같은 파일 `ADD_TASKS_SYSTEM` (50-72) 를 교체:

```ts
const ADD_TASKS_SYSTEM = `You are a software architect adding new tasks to an existing project.

Rules:
- Review existing tasks to avoid duplication
- New tasks can depend on existing tasks (use their TASK-NNN IDs)
- New task numbering continues from where existing tasks end
- Same rules as decomposition: role, priority, scope, estimatedHours
- Ensure no circular dependencies with existing tasks

Ticket body — fill these STRUCTURED fields (do NOT cram everything into one paragraph):
- goal: 1-2 sentences, what & why. No file paths here.
- changes: array of short bullet strings — concrete functions/behaviors to add or modify.
- acceptance: array of verifiable done-criteria.
- notes: array (optional) — constraints, rollback rules, reuse notes.
Put file paths in "scope", not in prose. Progress updates during work go to add_activity, never the ticket body.

Output format (strict JSON, no markdown):
{
  "tasks": [
    {
      "title": "string (한 줄)",
      "goal": "string",
      "changes": ["string"],
      "acceptance": ["string"],
      "notes": ["string"],
      "role": "backend" | "frontend" | "test" | "devops",
      "priority": 1-5,
      "depends_on": ["TASK-NNN"],
      "scope": ["path/to/file.ts"],
      "estimatedHours": 1.5
    }
  ]
}`;
```

- [ ] **Step 5: 테스트 통과 확인**

Run: `cd v3 && npx vitest run tests/unit/prompt-templates.test.ts`
Expected: PASS.

- [ ] **Step 6: 커밋**

```bash
git add v3/electron/orchestrator/prompt-templates.ts v3/tests/unit/prompt-templates.test.ts
git commit -m "feat(v3): 분해 프롬프트를 구조화 4섹션 출력으로 전환"
```

---

## Task 4: MCP create_task 구조화 필드

오케스트레이터 직접 호출 경로의 단일 통제점. 구조화 필드를 받아 검증·저장한다.

**Files:**

- Modify: `v3/electron/mcp-server/tools.ts` (TaskDoc 105-121, create_task 313-378)

- [ ] **Step 1: import 추가**

`v3/electron/mcp-server/tools.ts` 상단 import 블록(`./projection.js` import 다음 줄)에 추가:

```ts
import { validateTaskBodyInput, taskBodyStorageFields } from "../task-body.js";
```

- [ ] **Step 2: TaskDoc 확장**

`TaskDoc` (105-121) 의 `description: string;` 아래에 추가:

```ts
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
```

- [ ] **Step 3: create_task 스키마·설명 교체**

`auditedTool("create_task", ...)` 의 설명 문자열(315)과 스키마 객체(316-331)를 교체:

```ts
    "create_task",
    "Create a task. Use STRUCTURED fields: goal (1-2 sentences), changes[] (bullets), acceptance[] (verifiable done-criteria), notes[] (optional). Put file paths in scope, not prose. role: backend/frontend/test/devops.",
    {
      title: z.string().describe("Task title (한 줄)"),
      goal: z.string().optional().describe("목표: 무엇을/왜 1-2문장. 핵심. 파일 경로 금지(→scope)."),
      changes: z.array(z.string()).optional().describe("변경·접근: 추가/수정할 함수·동작을 짧은 불릿으로. 줄글/중복 금지."),
      acceptance: z.array(z.string()).optional().describe("완료 기준: 검증 가능한 체크 항목(예: 'tests/unit/foo.test.ts 통과')."),
      notes: z.array(z.string()).optional().describe("제약·주의(선택): 롤백/재사용 규칙 등."),
      description: z.string().optional().describe("[legacy] 자유서술. 구조화 필드(goal 등)를 쓰면 생략."),
      role: z.string().describe("Agent role (backend/frontend/test/devops)"),
      priority: z.number().optional().describe("Priority 1-5 (higher = more urgent)"),
      depends_on: z.array(z.string()).optional().describe("Task IDs this depends on"),
      project_id: z.string().optional().describe("Project ID"),
      context: z.string().optional().describe("Environment constraints"),
      scope: z.array(z.string()).optional().describe("File paths to modify"),
    },
```

- [ ] **Step 4: create_task 핸들러 교체**

핸들러 destructure(332-341)와 본문(342-377)을 교체. 검증 후 `data` 에서 `description,` 를 `...taskBodyStorageFields(...)` 로 대체:

```ts
async ({
  title,
  goal,
  changes,
  acceptance,
  notes,
  description,
  role,
  priority,
  depends_on,
  project_id,
  context,
  scope,
}) => {
  const projectId = resolveProject(project_id);
  if (!projectId) {
    return text(
      "Error: No project context. Set MARBLO_PROJECT env var or pass project_id parameter.\n" +
        "In Electron: agents get this automatically. For external CLI: set MARBLO_PROJECT in MCP config.",
    );
  }

  const bodyInput = { goal, changes, acceptance, notes, description };
  const { error, warning } = validateTaskBodyInput(bodyInput);
  if (error) return text(`Error: ${error}`);

  const now = Timestamp.now();
  const deps = depends_on ?? [];

  const data: Record<string, unknown> = {
    title,
    ...taskBodyStorageFields(bodyInput),
    role,
    priority: priority ?? 0,
    status: "TODO",
    dependsOn: deps,
    dependsOnCompleted: deps.length === 0,
    claimedBy: null,
    claimedAt: null,
    scope: scope ?? [],
    comment: context ?? "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: now,
    updatedAt: now,
    projectId,
    contextId: resolveContextForWrite(),
  };

  const ref = await addDoc(collection(db, "tasks"), data);
  return text(
    `Task created successfully!\nID: ${ref.id}\nTitle: ${title}\nRole: ${role}\nPriority: ${priority ?? 0}` +
      (warning ? `\n⚠️ ${warning}` : ""),
  );
};
```

- [ ] **Step 5: 타입체크**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 6: 커밋**

```bash
git add v3/electron/mcp-server/tools.ts
git commit -m "feat(v3): create_task 구조화 필드(goal/changes/acceptance/notes) + 검증"
```

---

## Task 5: MCP create_tasks_bulk 구조화 필드

- [ ] **Step 1: 설명 문자열 교체**

`v3/electron/mcp-server/tools.ts` `auditedTool("create_tasks_bulk", ...)` 의 설명(384)을 교체:

```ts
    "Create multiple tasks at once. Pass tasks_json (JSON string) or tasks (array). Each item: title, goal, changes[], acceptance[], notes?, role, priority?, depends_on?, context?, scope?, alias?. Use structured fields (goal/changes/acceptance), not a single description blob. depends_on supports TASK-NNN (1-based index), alias, or UUID.",
```

- [ ] **Step 2: per-task 저장 교체**

루프 내 `data` 객체(492-508)의 `description: (t.description as string) || "",` 줄을 교체:

```ts
const data: Record<string, unknown> = {
  title: (t.title as string) || "",
  ...taskBodyStorageFields({
    goal: t.goal as string | undefined,
    changes: t.changes as string[] | undefined,
    acceptance: t.acceptance as string[] | undefined,
    notes: t.notes as string[] | undefined,
    description: t.description as string | undefined,
  }),
  role: (t.role as string) || "backend",
  priority: (t.priority as number) ?? 0,
  status: "TODO",
  dependsOn: deps,
  dependsOnCompleted: deps.length === 0,
  claimedBy: null,
  claimedAt: null,
  scope: (t.scope as string[]) || [],
  comment: (t.context as string) || "",
  prUrl: "",
  hasPmFeedback: false,
  createdAt: now,
  updatedAt: now,
};
```

- [ ] **Step 3: 타입체크**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit`
Expected: 에러 없음.

- [ ] **Step 4: 커밋**

```bash
git add v3/electron/mcp-server/tools.ts
git commit -m "feat(v3): create_tasks_bulk 구조화 필드 저장"
```

---

## Task 6: 디스패처 — instruction = composeTaskBody

미션 분해 경로에서 구조화 필드를 저장하고, 에이전트 instruction을 합성한다.

**Files:**

- Modify: `v3/electron/mission-engine/dispatcher-impl.ts` (docPayload 108-127, instruction 143)

- [ ] **Step 1: import 추가**

`dispatcher-impl.ts` 상단 import 블록에 추가:

```ts
import { composeTaskBody, taskBodyStorageFields } from "../task-body.js";
```

- [ ] **Step 2: docPayload 저장 교체**

docPayload(108-127) 의 `description: t.description,` 줄을 교체:

```ts
const docPayload = {
  title: t.title,
  ...taskBodyStorageFields(t),
  role: t.role,
  priority: t.priority,
  status: "TODO",
  dependsOn: resolvedDeps,
  dependsOnCompleted: resolvedDeps.length === 0,
  claimedBy: null,
  claimedAt: null,
  scope: t.scope ?? [],
  comment: `Mission ${input.missionId}`,
  prUrl: "",
  hasPmFeedback: false,
  projectId: input.projectId,
  missionId: input.missionId,
  contextId: input.missionId,
  createdAt: now,
  updatedAt: now,
};
```

- [ ] **Step 3: instruction 합성 교체**

dispatchOne 호출(141-148) 의 `instruction: t.description,` 줄을 교체:

```ts
const result = deps.dispatchOne({
  role: t.role,
  instruction: composeTaskBody(t),
  taskId,
  complexity: "standard",
  projectId: input.projectId,
  tags: t.scope ?? [],
});
```

> 주: fallback 단일 태스크(83-93)는 `description: enrichedGoal` 그대로 둔다 — `composeTaskBody`/`taskBodyStorageFields`가 legacy로 처리한다.

- [ ] **Step 4: 타입체크 + 기존 미션 테스트**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit && npx vitest run tests/unit/mission-engine.test.ts`
Expected: 에러 없음 / 기존 테스트 PASS.

- [ ] **Step 5: 커밋**

```bash
git add v3/electron/mission-engine/dispatcher-impl.ts
git commit -m "feat(v3): 디스패처 instruction을 composeTaskBody로 합성 + 구조화 저장"
```

---

## Task 7: 렌더러 Task 타입 확장

`toTask`가 Firestore 도큐먼트를 `...task`로 전체 스프레드하므로, 타입만 추가하면 새 필드가 자동 전파된다(taskService 변경 불필요).

**Files:**

- Modify: `v3/src/types/task.ts:11-32`

- [ ] **Step 1: Task 인터페이스에 필드 추가**

`description: string;` (16) 아래에 추가:

```ts
  description: string;
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
```

- [ ] **Step 2: 타입체크**

Run: `cd v3 && npx tsc --noEmit -p tsconfig.json`
Expected: 에러 없음. (tsconfig 경로가 다르면 `npx tsc --noEmit` 단독 실행.)

- [ ] **Step 3: 커밋**

```bash
git add v3/src/types/task.ts
git commit -m "feat(v3): 렌더러 Task 타입에 구조화 필드 추가"
```

---

## Task 8: UI 섹션 렌더러 (read-only)

구조화 필드를 섹션으로 직접 렌더. 구조화 필드가 없으면 legacy description 블록.

**Files:**

- Create: `v3/src/components/board/TaskBodySections.tsx`
- Modify: `v3/src/components/board/TaskDetailModal.tsx` (import 2-21, read-only 블록 578-595)

- [ ] **Step 1: TaskBodySections 컴포넌트 작성**

```tsx
// v3/src/components/board/TaskBodySections.tsx
import type { Task } from "../../types/task";

const LABELS = {
  goal: "목표",
  changes: "변경·접근",
  acceptance: "완료 기준",
  notes: "제약·주의",
} as const;

function nonEmpty(arr?: string[]): string[] {
  return (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function hasAnyBody(task: Task): boolean {
  return Boolean(
    task.goal?.trim() ||
    nonEmpty(task.changes).length ||
    nonEmpty(task.acceptance).length ||
    nonEmpty(task.notes).length ||
    task.description,
  );
}

function isStructured(task: Task): boolean {
  return Boolean(
    task.goal?.trim() ||
    nonEmpty(task.changes).length ||
    nonEmpty(task.acceptance).length ||
    nonEmpty(task.notes).length,
  );
}

export function TaskBodySections({ task }: { task: Task }) {
  if (!isStructured(task)) {
    if (!task.description) return null;
    return (
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
          Description
        </h3>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">
          {task.description}
        </p>
      </div>
    );
  }
  const changes = nonEmpty(task.changes);
  const acceptance = nonEmpty(task.acceptance);
  const notes = nonEmpty(task.notes);
  return (
    <div className="space-y-3">
      {task.goal?.trim() && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.goal}
          </h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">
            {task.goal}
          </p>
        </section>
      )}
      {changes.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.changes}
          </h3>
          <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-300">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      {acceptance.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.acceptance}
          </h3>
          <ul className="space-y-0.5 text-sm text-gray-300">
            {acceptance.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-500">☐</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notes.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.notes}
          </h3>
          <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-400">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
```

- [ ] **Step 2: TaskDetailModal에 import 추가**

`v3/src/components/board/TaskDetailModal.tsx` 의 import 블록(3행 부근)에 추가:

```tsx
import { TaskBodySections, hasAnyBody } from "./TaskBodySections";
```

- [ ] **Step 3: read-only 블록 교체**

`TaskDetailModal.tsx` 의 read-only 분기(578-595)를 교체. 기존:

```tsx
          ) : /* Description (read-only) */
          task.description ? (
            <div>
              <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
                Description
              </h3>
              <p className="text-sm text-gray-300 whitespace-pre-wrap">
                {task.description}
              </p>
            </div>
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full rounded border border-dashed border-gray-600 py-3 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
            >
              + 설명 추가 (클릭하여 편집)
            </button>
          )}
```

교체 후:

```tsx
          ) : /* Body (read-only, structured sections) */
          hasAnyBody(task) ? (
            <TaskBodySections task={task} />
          ) : (
            <button
              onClick={() => setEditing(true)}
              className="w-full rounded border border-dashed border-gray-600 py-3 text-xs text-gray-500 hover:border-gray-500 hover:text-gray-400 transition-colors"
            >
              + 설명 추가 (클릭하여 편집)
            </button>
          )}
```

> 주: edit 모드는 v1에서 기존 단일 textarea 그대로(legacy description 편집). 구조화 필드의 섹션별 편집은 fast-follow(아래 "후속" 참조).

- [ ] **Step 4: 빌드 확인**

Run: `cd v3 && npx tsc --noEmit && npm run build:mcp >/dev/null 2>&1; npx vite build`
Expected: 빌드 성공(타입 에러 없음). (vite build가 무거우면 `npx tsc --noEmit`만으로 갈음.)

- [ ] **Step 5: 커밋**

```bash
git add v3/src/components/board/TaskBodySections.tsx v3/src/components/board/TaskDetailModal.tsx
git commit -m "feat(v3): TaskDetailModal 구조화 섹션 렌더러 (read-only)"
```

---

## Task 9: 진행 분리 footer + 스킬/가이드 정렬

**Files:**

- Modify: `v3/electron/bridge-server.ts` (`withCompletionFooter` ~39)
- Modify: `.claude/skills/tf-create-tasks/SKILL.md`

- [ ] **Step 1: footer 현재 텍스트 확인**

Run: `cd v3 && sed -n '39,60p' electron/bridge-server.ts`
목적: `add_activity` 진행 로그 줄의 정확한 위치 확인.

- [ ] **Step 2: footer에 분리 규약 한 줄 추가**

`withCompletionFooter` 의 footer 배열에서 `진행 로그: add_activity(...)` 항목 **바로 다음 줄**에 추가:

```ts
    `- 진행 상황은 ticket 본문(description)이 아니라 add_activity 로만 보고 — 본문은 생성 시점의 불변 스펙이다.`,
```

- [ ] **Step 3: tf-create-tasks 카드 형식 교체**

`.claude/skills/tf-create-tasks/SKILL.md` 의 "태스크 카드 형식" 코드블록을 교체:

```
TASK-001: [제목 — 한 줄]
  role: backend | frontend | test | devops
  priority: 5(긴급) ~ 1(낮음)
  depends_on: [TASK-NNN, ...]
  scope: [수정할 파일 경로들]
  goal: 목표 1~2문장 (무엇을/왜)
  changes: [추가/수정할 함수·동작 불릿]
  acceptance: [검증 가능한 완료 기준]
  notes: [제약·주의 (선택)]
```

그리고 "분해 원칙" 5번 아래에 추가:

```
6. **본문 구조화**: 줄글 금지. goal/changes/acceptance/notes 필드로 나눠 작성. 파일 경로는 scope에만.
7. **진행 분리**: 작업 중 진행 내용은 description이 아니라 add_activity로 기록.
```

Phase 2 이후 `create_tasks_bulk` 호출 예시가 있으면 각 task 객체에 `goal/changes/acceptance/notes` 키를 쓰도록 갱신(없으면 생략).

- [ ] **Step 4: 커밋**

```bash
git add v3/electron/bridge-server.ts .claude/skills/tf-create-tasks/SKILL.md
git commit -m "docs(v3): 진행→add_activity 분리 규약 + tf-create-tasks 4섹션 정렬"
```

---

## Task 10: 통합 검증

- [ ] **Step 1: 전체 단위 테스트**

Run: `cd v3 && npm run test`
Expected: 전부 PASS (신규 task-body / decomposer-validate / prompt-templates 포함, 기존 회귀 없음).

- [ ] **Step 2: 전체 타입체크**

Run: `cd v3 && npx tsc -p electron/tsconfig.json --noEmit && npx tsc --noEmit`
Expected: 에러 없음.

- [ ] **Step 3: 엔드투엔드 수동 확인 (앱 실행)**

Run: `cd v3 && npm run dev`

- 오케스트레이터에서 구조화 필드로 `create_task` 호출(또는 미션 분해 실행).
- 보드에서 해당 티켓 클릭 → `TaskDetailModal` 에 목표/변경·접근/완료 기준/제약·주의 섹션이 분리 렌더되는지 확인.
- 기존(legacy) 티켓을 열어 단일 Description 블록이 그대로 보이는지(back-compat) 확인.
- 스크린샷 1장 첨부(before: 스샷의 줄글, after: 섹션 렌더).

- [ ] **Step 4: 추적 티켓 상태 업데이트**

marblo MCP: `submit_for_review(task_id="xWS7QqhrxgEqSpqmUPLq", ...)` 또는 진행 `add_activity`.

---

## 후속 (이 플랜 범위 밖, fast-follow)

- **구조화 필드 섹션별 편집** (`TaskDetailModal` edit 모드): goal input + changes/acceptance/notes textarea(줄 단위 = 항목). `taskStore.updateTask`/`taskService.updateTask`의 `Partial<Task>` 시그니처로 매핑. v1은 read-only.
- **완료 기준 인터랙티브 체크박스 토글**.
- **tf-spawn / tf-flow / tf-agent** 스킬 본문의 티켓 예시 정렬(가이드 텍스트).

---

## Self-Review (스펙 대비)

- 스펙 §4 데이터 모델 → Task 1(storageFields), Task 4/5(TaskDoc·저장), Task 7(렌더러 타입) ✅
- 스펙 §5 composeTaskBody → Task 1 ✅
- 스펙 §6 MCP 스키마 → Task 4/5 ✅
- 스펙 §7 UI 렌더 (선택 a) → Task 8 ✅ (편집은 §7.2 일부를 fast-follow로 축소 — 명시)
- 스펙 §8 미션 분해 경로 → Task 2/3/6 ✅
- 스펙 §9 진행→activity → Task 9 ✅
- 스펙 §10 프롬프트·스킬 → Task 3/9 ✅
- 스펙 §11 back-compat → Task 1(fallback), Task 8(legacy 분기), Task 10 Step3 확인 ✅
- 스펙 §12 테스트 → Task 1/2/3 단위 + Task 10 통합 ✅
- 타입/시그니처 일관성: `composeTaskBody`/`taskBodyStorageFields`/`validateTaskBodyInput`/`hasStructuredBody` 명칭이 Task 1 정의와 4·5·6 사용처에서 일치 ✅
- Placeholder 스캔: 모든 코드 스텝에 실제 코드/명령/기대결과 포함 ✅
