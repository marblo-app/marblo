---
name: tf-add
description: Add a new task to an active project, or edit an existing one (priority, description, etc.). / 진행 중인 프로젝트에 새 태스크 추가 또는 기존 태스크 수정(우선순위, 설명 등)
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Add / Edit Task

> Add a new task to an active project, or edit an existing one.
> "Add a task", "change the priority", "fix the description" — all of these go through this skill.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task creation/lookup MUST use the **Marblo MCP tools**:
> `create_task`, `create_tasks_bulk`, `get_all_tasks`, `get_available_tasks`
>
> For a new task, set the `project` field to the same project name as the existing tasks.

---

## Steps

1. Use `get_all_tasks` to review the current project's task list.
2. Ask the user what new work to add.
3. Analyze dependencies against existing tasks:
   - Which task must complete first (depends_on)
   - Which tasks overlap in file areas (scope)
4. Create the task with `create_task` or `create_tasks_bulk`.
5. If the new task's dependencies are already satisfied, tell the user it can start right away.

## Example

```
User: "I also want to add a payment feature"
→ Review existing tasks
→ TASK-009: Payment API (backend, depends_on: TASK-001)
→ TASK-010: Payment UI (frontend, depends_on: TASK-009)
→ If TASK-001 is already DONE → TASK-009 is immediately available
```

---

## Editing an existing task

When the user asks to edit an existing task (priority, description, scope, etc.):

1. Use `get_all_tasks` to show the current task list.
2. Confirm the target task with the user.
3. Handle based on what changes:
   - **Priority change**: call the backend API directly with `curl -X PATCH`
   - **Description/scope change**: call the backend API directly with `curl -X PATCH`
   - **Dependency change**: may require recreating the task (delete the old one → create a new one)
4. Record "Edit: [what changed]" with `add_activity`.

```
Example:
  User: "Bump TASK-003 priority to 5"
  → PATCH /api/tasks/{id} body: {"priority": 5}
  → add_activity: "Priority changed: 3 → 5"
```

---

## Notes

- Be careful not to overlap scope with existing tasks
- Adding a dependency on a task that is already IN_PROGRESS can cause a long wait
- Set priority appropriately to fit the existing workflow
- When editing, do not change the `project` field (use the dashboard's Merge feature to merge projects)
