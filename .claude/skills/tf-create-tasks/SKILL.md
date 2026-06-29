---
name: tf-create-tasks
description: Bulk-create tasks in Marblo MCP from the analysis results.
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo Task Creation

> Create tasks based on the `/tf-analyze` analysis results.
> After getting the user's confirmation, bulk-create them with `create_tasks_bulk`.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> You MUST use **Marblo MCP's `create_tasks_bulk`**.
>
> ```
> ⛔ Wrong way: call Claude Code's TaskCreate individually
> ✅ Right way: call Marblo MCP's create_tasks_bulk once
> ```

---

## Phase 1: Build the task list

Build the tasks based on the prior analysis result (conversation context or `docs/PRD.md`).

### Task card format

```
TASK-001: [title — one line]
  role: backend | frontend | test | devops
  priority: 5(urgent) ~ 1(low)
  depends_on: [TASK-NNN, ...]
  scope: [file paths to modify]
  goal: 1-2 sentence goal (what/why)
  changes: [bullets of functions/behaviors to add/modify]
  acceptance: [verifiable completion criteria]
  notes: [constraints/cautions (optional)]
```

### Decomposition principles

1. **Size**: 1 task = 1-2 hours of work
2. **Unit**: 1 API endpoint = 1 task
3. **Dependencies**: only set depends_on where there is a real ordering
4. **scope**: separate file areas → prevent Git conflicts
5. **Verification**: state completion criteria for each task
6. **Structured body**: no prose. Split into goal/changes/acceptance/notes fields. File paths go only in scope.
7. **Separate progress**: log in-progress work via add_activity, not in the description.

---

## Phase 2: User confirmation

```
📋 Tasks to create: {N}
📦 Project: {project_name}

TASK-001: [title] (backend, priority: 5)
TASK-002: [title] (backend, priority: 4, depends_on: TASK-001)
TASK-003: [title] (frontend, priority: 4)
...

Create these as-is?
```

**Only create after getting the user's confirmation.**

---

## Phase 3: Bulk creation

1. **Confirm project name**: use the same project field for all tasks
2. **Call `create_tasks_bulk`**: create all tasks in a single call
3. **Verify the result**:
   - Confirm dashboard registration with `get_all_tasks`
   - Verify dependency mapping
   - Check that no tasks are missing

---

## Phase 4: Report results

```
✅ Task creation complete
━━━━━━━━━━━━━━━━━━

📦 Project: {project_name}
📋 Tasks created: {N}

  backend:  {n}
  frontend: {n}
  test:     {n}
  devops:   {n}

🔗 Dependency chains:
  TASK-001 → TASK-002 → TASK-004
  TASK-001 → TASK-003 → TASK-005

Ready to start now: {M} (no dependencies)

💡 Next step: deploy agents with `/tf-spawn-agents`.
```
