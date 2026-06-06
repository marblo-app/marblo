# Quick Lanes — Plan 1: contextId Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `contextId` tag to every task so the board UI can SEE all tasks (마킹) while the board orchestrator only QUERIES its own context (`"board"`) — the "눈/브레인 분리" that later lets Quick Lanes run independently without polluting the main orchestrator.

**Architecture:** A new pure helper module (`mcp-server/context.ts`) resolves context from the `MARBLO_CONTEXT` env var. Writes always label a task (`"board"` fallback); reads only scope when `MARBLO_CONTEXT` is explicitly set. The board orchestrator (and only it) gets `MARBLO_CONTEXT="board"` injected, so its `get_all_tasks` becomes context-scoped while every other caller (mission orchestrator, plain agents, external CLI) stays unscoped — zero regression. A one-off backfill labels existing tasks before the board-orchestrator scoping is shipped (last task).

**Tech Stack:** TypeScript, Electron, React, Firebase Web SDK (Firestore), Vitest (unit), Playwright (e2e). Firestore is mocked in unit tests via `vitest.config.mjs` alias → `tests/mocks/firebase-firestore.ts`.

**Spec:** `v3/docs/QUICK-LANES-SPEC.md` · **TaskForce:** `d27a6197-c5b6-4f6b-9f19-b1924aa0156b`

**Scope note:** This is Plan 1 of 2. Plan 2 (Quick Lanes tab + lane creation with harness picker + board marking of lane tasks) depends on the worktree-per-task work (`WORKTREE-SPEC.md` / TaskForce `4ac84c57`, still in implementation) and will be written once that lands. Plan 1 is independently shippable and delivers the eyes/brain separation.

---

## File Structure

**New files:**

- `v3/electron/mcp-server/context.ts` — pure context helpers (resolve/read-filter/kind/backfill). No firebase import → unit-testable in isolation. One responsibility: context-id policy.
- `v3/src/lib/laneContext.ts` — frontend pure helper `isLaneTask()`. One responsibility: "is this task from a non-board context?".
- `v3/scripts/backfill-context-id.mjs` — thin one-off runner that applies `computeContextIdBackfill()` to live Firestore.
- `v3/tests/unit/context.test.ts`, `v3/tests/unit/laneContext.test.ts` — unit tests for the pure helpers.

**Modified files:**

- `v3/electron/mcp-server/tools.ts` — import context helpers; add `contextId` to `TaskDoc`; write `contextId` in `create_task` + `create_tasks_bulk`; add `all_contexts` + context filter to `get_all_tasks`.
- `v3/electron/mission-engine/dispatcher-impl.ts` — write `contextId: input.missionId` on dispatched tasks.
- `v3/electron/orchestrator-manager.ts` — inject `MARBLO_CONTEXT` for board-kind orchestrators (last task, post-backfill).
- `v3/src/types/task.ts` — add `contextId` field.
- `v3/src/services/taskService.ts` — map `contextId` in `toTask`.
- `v3/src/components/board/TaskCard.tsx` — render a context chip when the task is a lane task.

---

## Task 1: Pure context helpers (`context.ts`)

**Files:**

- Create: `v3/electron/mcp-server/context.ts`
- Test: `v3/tests/unit/context.test.ts`

- [ ] **Step 1: Write the failing test**

Create `v3/tests/unit/context.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import {
  resolveContext,
  resolveContextForWrite,
  contextReadFilter,
  contextForKind,
  computeContextIdBackfill,
} from "../../electron/mcp-server/context";

describe("resolveContext (read-scope)", () => {
  it("returns the MARBLO_CONTEXT value when set", () => {
    expect(resolveContext({ MARBLO_CONTEXT: "board" })).toBe("board");
    expect(resolveContext({ MARBLO_CONTEXT: "lane:abc123" })).toBe(
      "lane:abc123"
    );
  });
  it("returns empty string (unscoped) when unset", () => {
    expect(resolveContext({})).toBe("");
  });
});

describe("resolveContextForWrite (write-label)", () => {
  it("defaults to 'board' so every task is labeled", () => {
    expect(resolveContextForWrite({})).toBe("board");
  });
  it("uses the explicit context when set", () => {
    expect(resolveContextForWrite({ MARBLO_CONTEXT: "lane:x" })).toBe("lane:x");
  });
});

describe("contextReadFilter", () => {
  it("returns '' (no filter) when all_contexts is true", () => {
    expect(contextReadFilter(true, { MARBLO_CONTEXT: "board" })).toBe("");
  });
  it("returns the resolved context when all_contexts is false", () => {
    expect(contextReadFilter(false, { MARBLO_CONTEXT: "board" })).toBe("board");
  });
  it("returns '' (unscoped) when context unset and all_contexts false", () => {
    expect(contextReadFilter(false, {})).toBe("");
  });
});

describe("contextForKind", () => {
  it("maps board → 'board'", () => {
    expect(contextForKind("board")).toBe("board");
  });
  it("maps non-board kinds → '' (unscoped, no regression)", () => {
    expect(contextForKind("mission")).toBe("");
  });
});

describe("computeContextIdBackfill", () => {
  it("labels tasks missing contextId: missionId wins, else 'board'", () => {
    const out = computeContextIdBackfill([
      { id: "a" },
      { id: "b", missionId: "m1" },
      { id: "c", contextId: "lane:z" },
    ]);
    expect(out).toEqual([
      { id: "a", contextId: "board" },
      { id: "b", contextId: "m1" },
    ]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npm test -- tests/unit/context.test.ts`
Expected: FAIL — `Cannot find module '../../electron/mcp-server/context'`.

- [ ] **Step 3: Write the implementation**

Create `v3/electron/mcp-server/context.ts`:

```typescript
/**
 * Eyes/brain context policy (Quick Lanes 눈/브레인 분리).
 *
 * READ vs WRITE defaults are intentionally asymmetric:
 *  - WRITE always labels a task ("board" fallback) so nothing is unlabeled.
 *  - READ only scopes when MARBLO_CONTEXT is explicitly set. Callers that do
 *    NOT set it (mission orchestrator, plain agents, external CLI) stay
 *    unscoped → zero behavior change. Only the board orchestrator sets
 *    MARBLO_CONTEXT="board", so only it becomes context-scoped.
 *
 * Pure module — no firebase import — so it unit-tests in isolation. Env is a
 * parameter (defaults to process.env) so tests never mutate global state.
 */
type Env = Record<string, string | undefined>;

/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env: Env = process.env): string {
  return env.MARBLO_CONTEXT || "";
}

/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env: Env = process.env): string {
  return resolveContext(env) || "board";
}

/** contextId to filter get_all_tasks by; "" = no context constraint. */
export function contextReadFilter(
  allContexts: boolean,
  env: Env = process.env
): string {
  return allContexts ? "" : resolveContext(env);
}

/** MARBLO_CONTEXT value to inject for an orchestrator of the given kind. */
export function contextForKind(kind: string): string {
  return kind === "board" ? "board" : "";
}

/** Compute contextId backfill for tasks missing it. missionId wins, else "board". */
export function computeContextIdBackfill(
  tasks: { id: string; contextId?: string; missionId?: string }[]
): { id: string; contextId: string }[] {
  return tasks
    .filter((t) => !t.contextId)
    .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npm test -- tests/unit/context.test.ts`
Expected: PASS (all describe blocks green).

- [ ] **Step 5: Commit**

```bash
cd v3 && git add electron/mcp-server/context.ts tests/unit/context.test.ts
git commit -m "v3(mcp): contextId 정책 순수 헬퍼(context.ts) + 단위 테스트"
```

---

## Task 2: Write `contextId` at all task-creation sites

**Files:**

- Modify: `v3/electron/mcp-server/tools.ts` (TaskDoc interface ~104-119, create_task data ~341-358, create_tasks_bulk data ~480-499)
- Modify: `v3/electron/mission-engine/dispatcher-impl.ts` (~108-126)

No new unit test (mechanical field add through firebase glue; covered by type-check + Task 6 backfill test + the board-marking path). Verify with the type checker.

- [ ] **Step 1: Add the import + `contextId` to `TaskDoc`**

In `v3/electron/mcp-server/tools.ts`, add to the existing import block near the top (after the `firebase/firestore` import):

```typescript
import { resolveContextForWrite, contextReadFilter } from "./context.js";
```

Then in the `TaskDoc` interface (currently lines 104-119), add `contextId` after `projectId`:

```typescript
interface TaskDoc {
  id: string;
  projectId: string;
  contextId: string;
  title: string;
  // ...rest unchanged...
}
```

- [ ] **Step 2: Write `contextId` in `create_task`**

In the `create_task` data object (lines 341-358), add `contextId` right after `projectId`:

```typescript
const data: Record<string, unknown> = {
  title,
  description,
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
```

- [ ] **Step 3: Write `contextId` in `create_tasks_bulk`**

In the `create_tasks_bulk` data object (lines 480-499), add `contextId` after the `data.projectId = project;` line:

```typescript
// Always use the resolved project (Firestore doc ID from MARBLO_PROJECT env)
// Ignore per-task project_id overrides — they cause ID mismatch with the board
data.projectId = project;
data.contextId = resolveContextForWrite();
```

- [ ] **Step 4: Write `contextId` in the mission dispatcher**

In `v3/electron/mission-engine/dispatcher-impl.ts`, in the `docPayload` (lines 108-126), add `contextId: input.missionId` right after `missionId: input.missionId`:

```typescript
        projectId: input.projectId,
        missionId: input.missionId,
        contextId: input.missionId,
        createdAt: now,
        updatedAt: now,
```

- [ ] **Step 5: Verify type-check passes**

Run: `cd v3 && npx tsc --noEmit`
Expected: PASS (no new type errors from the added field).

- [ ] **Step 6: Commit**

```bash
cd v3 && git add electron/mcp-server/tools.ts electron/mission-engine/dispatcher-impl.ts
git commit -m "v3(mcp): 모든 태스크 생성 지점에 contextId 기록(board 기본/미션=missionId)"
```

---

## Task 3: `get_all_tasks` — context filter + `all_contexts` escape hatch

**Files:**

- Modify: `v3/electron/mcp-server/tools.ts` (`get_all_tasks` definition, lines 222-261)

The filtering logic itself (`contextReadFilter`) is already unit-tested in Task 1. This task wires it into the handler.

- [ ] **Step 1: Add the `all_contexts` param to the schema**

In `get_all_tasks` (lines 226-238), add `all_contexts` to the schema object after `all_projects`:

```typescript
      all_projects: z
        .boolean()
        .optional()
        .describe(
          "Ignore default project filter, show all projects (default: false)",
        ),
      all_contexts: z
        .boolean()
        .optional()
        .describe(
          "Ignore default context filter, show all contexts in the project (default: false)",
        ),
```

- [ ] **Step 2: Apply the context filter in the handler**

Update the handler (lines 239-258). Change the destructure and add the context constraint:

```typescript
    async ({ project_id, role, all_projects, all_contexts }) => {
      const projectId = all_projects ? "" : resolveProject(project_id);
      const contextId = contextReadFilter(!!all_contexts);
      const constraints: QueryConstraint[] = [];
      if (projectId) constraints.push(where("projectId", "==", projectId));
      if (contextId) constraints.push(where("contextId", "==", contextId));
      if (role) constraints.push(where("role", "==", role));

      const q = query(collection(db, "tasks"), ...constraints);
      const snap = await getDocs(q);

      if (snap.empty) return text("No tasks found.");

      const docs = snap.docs
        .map((d) => ({ id: d.id, ...d.data() }))
        .sort((a: any, b: any) => (b.priority ?? 0) - (a.priority ?? 0));
      const lines = docs.map((t: any) => {
        const claimed = t.claimedBy ? ` → ${t.claimedBy}` : "";
        const proj = all_projects ? ` project=${t.projectId || "(none)"}` : "";
        const ctx = all_contexts ? ` ctx=${t.contextId || "(none)"}` : "";
        return `- [${t.status}] ${t.title} (role=${t.role}, id=${t.id}${proj}${ctx})${claimed}`;
      });
      return text(lines.join("\n"));
    },
```

- [ ] **Step 3: Verify type-check passes**

Run: `cd v3 && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Verify behavior with the existing unit suite**

Run: `cd v3 && npm test -- tests/unit/context.test.ts`
Expected: PASS — confirms the filter selector logic the handler now uses. (`contextReadFilter(false, {})` → `""` → no context constraint → unscoped, proving the no-MARBLO_CONTEXT path is unchanged.)

- [ ] **Step 5: Commit**

```bash
cd v3 && git add electron/mcp-server/tools.ts
git commit -m "v3(mcp): get_all_tasks contextId 필터 + all_contexts escape hatch"
```

---

## Task 4: Frontend — `contextId` on Task type + service mapper + `isLaneTask`

**Files:**

- Modify: `v3/src/types/task.ts` (interface lines 4-24)
- Modify: `v3/src/services/taskService.ts` (`toTask` mapper)
- Create: `v3/src/lib/laneContext.ts`
- Test: `v3/tests/unit/laneContext.test.ts`

- [ ] **Step 1: Write the failing test for `isLaneTask`**

Create `v3/tests/unit/laneContext.test.ts`:

```typescript
import { describe, expect, it } from "vitest";
import { isLaneTask } from "../../src/lib/laneContext";

describe("isLaneTask", () => {
  it("is false for the board context", () => {
    expect(isLaneTask("board")).toBe(false);
  });
  it("is false when contextId is missing/empty (treated as board)", () => {
    expect(isLaneTask(undefined)).toBe(false);
    expect(isLaneTask("")).toBe(false);
  });
  it("is true for a lane context", () => {
    expect(isLaneTask("lane:abc123")).toBe(true);
  });
  it("is true for a mission context", () => {
    expect(isLaneTask("mission-xyz")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd v3 && npm test -- tests/unit/laneContext.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/laneContext'`.

- [ ] **Step 3: Implement `isLaneTask`**

Create `v3/src/lib/laneContext.ts`:

```typescript
/**
 * A task belongs to a "lane" (non-board context) when its contextId is set and
 * is not the reserved "board" default. Used to render a distinguishing marking
 * on the Kanban board so board + lane + mission work is visible together.
 */
export function isLaneTask(contextId: string | undefined): boolean {
  return !!contextId && contextId !== "board";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd v3 && npm test -- tests/unit/laneContext.test.ts`
Expected: PASS.

- [ ] **Step 5: Add `contextId` to the Task type**

In `v3/src/types/task.ts`, add `contextId` to the `Task` interface (after `projectId`):

```typescript
export interface Task {
  id: string;
  projectId: string;
  contextId: string;
  title: string;
  // ...rest unchanged...
}
```

- [ ] **Step 6: Map `contextId` in the service `toTask`**

In `v3/src/services/taskService.ts`, find the `toTask` mapper (it converts a Firestore doc to a `Task`). Add the `contextId` mapping alongside the other fields, defaulting missing values to `"board"`:

```typescript
    contextId: (data.contextId as string) || "board",
```

(Place it next to the existing `projectId: ...` mapping line. The board's `subscribeToTasks` query is unchanged — it still loads ALL project tasks by `projectId`, so the board UI keeps seeing everything; only the marking is new.)

- [ ] **Step 7: Verify type-check + tests**

Run: `cd v3 && npx tsc --noEmit && npm test -- tests/unit/laneContext.test.ts`
Expected: PASS.

- [ ] **Step 8: Commit**

```bash
cd v3 && git add src/types/task.ts src/services/taskService.ts src/lib/laneContext.ts tests/unit/laneContext.test.ts
git commit -m "v3(board): Task.contextId 타입+매퍼 + isLaneTask 헬퍼"
```

---

## Task 5: Board marking — context chip on `TaskCard`

**Files:**

- Modify: `v3/src/components/board/TaskCard.tsx` (badge row in `TaskCardContent`, ~lines 240-256)

- [ ] **Step 1: Import the helper**

At the top of `v3/src/components/board/TaskCard.tsx`, add:

```typescript
import { isLaneTask } from "../../lib/laneContext";
```

- [ ] **Step 2: Render a context chip in the badge row**

In `TaskCardContent`, inside the badge row `<div className="flex items-center gap-2 flex-wrap">` (after the role and priority spans, ~line 252), add a context chip rendered only for lane tasks:

```tsx
{
  isLaneTask(task.contextId) && (
    <span
      className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium bg-amber-500/20 text-amber-300"
      title={`context: ${task.contextId}`}
    >
      ⛙ {task.contextId.startsWith("lane:") ? "Lane" : task.contextId}
    </span>
  );
}
```

Also add a left color bar to the card root for at-a-glance scanning. Change the root `<div>`'s className to append a conditional left border when it is a lane task — insert before the closing backtick of the existing className:

```tsx
      className={`relative cursor-pointer rounded-lg bg-gray-800 p-3 shadow hover:bg-gray-750 transition-colors border border-gray-700/50 hover:border-gray-600 ${statusHighlight} ${
        isDragging ? "ring-2 ring-blue-500" : ""
      } ${isLaneTask(task.contextId) ? "border-l-2 border-l-amber-500" : ""}`}
```

- [ ] **Step 3: Verify type-check + build**

Run: `cd v3 && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 4: Manual / Playwright verification**

The existing `@mocked` board test seeds mock cards (`tests/playwright/mocked/kanban-dnd.spec.ts`, `openMockKanban`). Run the board smoke to confirm the card still renders without errors:

Run: `cd v3 && npm run test:e2e:pw -- --grep "@mocked Board"`
Expected: PASS (no `ErrorBoundary` fallback; columns + cards render). Lane-specific marking is exercised in Plan 2 once lane tasks exist; for Plan 1 this confirms the conditional chip does not break the board for board-context tasks (chip hidden when `contextId === "board"`).

- [ ] **Step 5: Commit**

```bash
cd v3 && git add src/components/board/TaskCard.tsx
git commit -m "v3(board): 비-board context 태스크에 칩+좌측바 마킹"
```

---

## Task 6: Backfill existing tasks + run it

**Files:**

- Create: `v3/scripts/backfill-context-id.mjs`
- (Logic `computeContextIdBackfill` already implemented + tested in Task 1.)

- [ ] **Step 1: Write the runner script**

Create `v3/scripts/backfill-context-id.mjs`:

```javascript
/**
 * One-off backfill: label every task missing `contextId`.
 *   contextId = missionId ?? "board"
 * Run BEFORE shipping Task 8 (board-orchestrator context scoping), otherwise the
 * board orchestrator (scoped to "board") would not see its existing tasks.
 *
 * Usage (from v3/):
 *   DRY:   node scripts/backfill-context-id.mjs           # logs only, no writes
 *   APPLY: node scripts/backfill-context-id.mjs --apply
 *
 * Requires the same Firebase env the app uses (FIREBASE_* / VITE_FIREBASE_*).
 */
import { initializeApp } from "firebase/app";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
} from "firebase/firestore";

const APPLY = process.argv.includes("--apply");

const firebaseConfig = {
  apiKey: process.env.FIREBASE_API_KEY || process.env.VITE_FIREBASE_API_KEY,
  authDomain:
    process.env.FIREBASE_AUTH_DOMAIN || process.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId:
    process.env.FIREBASE_PROJECT_ID || process.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket:
    process.env.FIREBASE_STORAGE_BUCKET ||
    process.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId:
    process.env.FIREBASE_MESSAGING_SENDER_ID ||
    process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.FIREBASE_APP_ID || process.env.VITE_FIREBASE_APP_ID,
};

// Inlined copy of computeContextIdBackfill (Task 1) — keep in sync.
function computeContextIdBackfill(tasks) {
  return tasks
    .filter((t) => !t.contextId)
    .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}

async function main() {
  if (!firebaseConfig.projectId) {
    throw new Error(
      "Missing Firebase env (FIREBASE_PROJECT_ID / VITE_FIREBASE_PROJECT_ID)."
    );
  }
  const app = initializeApp(firebaseConfig);
  const db = getFirestore(app);

  const snap = await getDocs(collection(db, "tasks"));
  const tasks = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const updates = computeContextIdBackfill(tasks);

  console.log(`Total tasks: ${tasks.length}, need backfill: ${updates.length}`);
  for (const u of updates) {
    console.log(`  ${u.id} → contextId=${u.contextId}`);
  }

  if (!APPLY) {
    console.log("\nDRY RUN — no writes. Re-run with --apply to commit.");
    return;
  }
  for (const u of updates) {
    await updateDoc(doc(db, "tasks", u.id), { contextId: u.contextId });
  }
  console.log(`\nApplied ${updates.length} updates.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
```

- [ ] **Step 2: Dry-run against the target Firestore**

Run (with the app's Firebase env exported in the shell):

```bash
cd v3 && node scripts/backfill-context-id.mjs
```

Expected: prints `Total tasks: N, need backfill: M` and a list of `<id> → contextId=board|<missionId>`. No writes.

- [ ] **Step 3: Apply the backfill**

Run: `cd v3 && node scripts/backfill-context-id.mjs --apply`
Expected: `Applied M updates.` Verify in the Firebase console (or re-run the dry-run; it should now report `need backfill: 0`).

- [ ] **Step 4: Commit**

```bash
cd v3 && git add scripts/backfill-context-id.mjs
git commit -m "v3(scripts): contextId 백필 러너(dry-run 기본/--apply)"
```

---

## Task 7: Activate eyes/brain split — inject `MARBLO_CONTEXT` for the board orchestrator

> **Ship/run this task ONLY after Task 6's backfill has been applied to the target Firestore.** Before backfill, scoping the board orchestrator to `"board"` would hide its existing (unlabeled) tasks.

**Files:**

- Modify: `v3/electron/orchestrator-manager.ts` (MCP config env ~290-298, launch env merge ~304-308)

- [ ] **Step 1: Import the kind→context helper**

At the top of `v3/electron/orchestrator-manager.ts`, add:

```typescript
import { contextForKind } from "./mcp-server/context.js";
```

- [ ] **Step 2: Inject `MARBLO_CONTEXT` into the MCP server config env**

In the MCP config block (lines 290-298), set `MARBLO_CONTEXT` next to `MARBLO_PROJECT` (only when non-empty, i.e. board kind):

```typescript
if (config.mcpServers?.marblo?.env) {
  config.mcpServers.marblo.env.MARBLO_BRIDGE_PORT = String(bridgePort);
  config.mcpServers.marblo.env.MARBLO_PROJECT = projectId;
  const marbloContext = contextForKind(this.kind);
  if (marbloContext) {
    config.mcpServers.marblo.env.MARBLO_CONTEXT = marbloContext;
  }
  fs.writeFileSync(
    launchConfig.mcpConfigPath,
    JSON.stringify(config, null, 2),
    "utf-8"
  );
}
```

- [ ] **Step 3: Inject `MARBLO_CONTEXT` into the launch env merge**

In the env merge (lines 304-308), add `MARBLO_CONTEXT` for board kind:

```typescript
// Merge env
const marbloContext = contextForKind(this.kind);
const mergedEnv: Record<string, string> = {
  ...(process.env as Record<string, string>),
  ...launchConfig.env,
  MARBLO_PROJECT: projectId,
  ...(marbloContext ? { MARBLO_CONTEXT: marbloContext } : {}),
};
```

- [ ] **Step 4: Verify type-check passes**

Run: `cd v3 && npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 5: Manual verification (board orchestrator scoped, mission unscoped)**

After build, with at least one board task and one mission task in the project:

1. In the board orchestrator session, run the `get_all_tasks` MCP tool → it should return ONLY `contextId="board"` tasks (mission tasks absent). This confirms the board brain is shielded.
2. Run `get_all_tasks` with `all_contexts: true` → returns everything (board + mission), with `ctx=` shown. This confirms the read-only cross-context escape hatch.
3. Mission orchestrator behavior unchanged (it does not set `MARBLO_CONTEXT`, so `get_all_tasks` stays unscoped).

- [ ] **Step 6: Commit**

```bash
cd v3 && git add electron/orchestrator-manager.ts
git commit -m "v3(orch): board 오케에 MARBLO_CONTEXT=board 주입 — 눈/브레인 분리 활성화"
```

---

## Self-Review

**Spec coverage (against `QUICK-LANES-SPEC.md`):**

- §4 눈/브레인 분리 → Tasks 3 (brain filter) + 4-5 (eyes: board still loads all, marks lane tasks) + 7 (activate). ✓
- §5.1 contextId 필드 + 쓰기 값 결정 (create_task/bulk=resolveContextForWrite, dispatcher=missionId) → Task 2. ✓
- §5.3 resolveContext + all_contexts + 주입 지점(orchestrator-manager) → Tasks 1, 3, 7. ✓ (agent-config/Codex allowlist is deferred to Plan 2 — only lane _agents_ need `MARBLO_CONTEXT`; the board orchestrator is wired via orchestrator-manager, confirmed by code.)
- §9 / §11-1 백필 선행 → 필터 활성화 롤아웃 순서 → Task 6 precedes Task 7, with explicit gating note. ✓
- §6 Lanes 탭 + 하니스 선택 + 레인 생성 → **Plan 2** (depends on worktree-per-task). Explicitly out of Plan 1 scope. ✓
- §5.2 QuickLane 컬렉션 → **Plan 2**. ✓

**Placeholder scan:** No TBD/TODO; every code step shows real code; every run step has an exact command + expected output. ✓

**Type consistency:** `resolveContext`/`resolveContextForWrite`/`contextReadFilter`/`contextForKind`/`computeContextIdBackfill` defined in Task 1 and used with identical signatures in Tasks 2, 3, 6, 7. `isLaneTask` defined in Task 4, used in Task 5. `contextId` added to `TaskDoc` (Task 2), `Task` (Task 4), Firestore docs (Tasks 2, 6). ✓

**Known limitation (honest):** `get_all_tasks`/`create_task` handlers are not directly unit-tested — the Firestore mock (`tests/mocks/firebase-firestore.ts`) does not implement `collection`/`query`/`where`/`getDocs`, and the MCP tool handlers are not import-isolated. The plan mitigates this by pushing all decision logic into the pure, fully-tested `context.ts` helpers and verifying the thin Firestore glue via `tsc --noEmit` + manual MCP verification (Task 7 Step 5). Extending the Firestore mock to cover query/where is a reasonable Plan 2 follow-up if handler-level integration tests are wanted.
