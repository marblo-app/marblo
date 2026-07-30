---
name: tf-start
description: Create tasks from the PRD and spawn agents to kick off the project. Use after /tf-plan.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# Marblo Project Kickoff

> Run this after `/tf-plan` has finalized the PRD + task plan.
> If there is no PRD, point the user to `/tf-plan` first.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Use **only the Marblo MCP tools**:
>
> - Bulk-create tasks: `create_tasks_bulk` (create all tasks at once in a single call)
> - Create a single task: `create_task`
> - Lookup tasks: `get_all_tasks`, `get_available_tasks`
> - Work tasks: `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`
> - Other: `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies`
>
> **Do not register tasks individually with Claude Code's built-in TaskCreate.** They won't show on the Marblo dashboard.
> **Using `create_tasks_bulk` registers all tasks at once in a single call.**

---

## Pre-flight check

Confirm before starting:

1. **PRD check**: confirm a finalized plan exists in `docs/PRD.md` or the prior conversation

   - If none: guide "Please plan first with `/tf-plan`" and stop
   - If present: read the PRD and extract the task list

2. **Environment check**:

   - Confirm Marblo MCP connection: test with a `get_all_tasks` call
   - Confirm the project directory exists
   - If existing tasks are present, check for conflicts

3. **Final user confirmation**:

   ```
   📋 Tasks to create: {N}
   📦 Project: {project_name}

   TASK-001: [title] (backend, priority: 5)
   TASK-002: [title] (backend, priority: 4, depends_on: TASK-001)
   ...

   Create and start these as-is?
   ```

---

## Phase 1: Confirm project name + bulk-create tasks

### 1-1. Confirm project name

Use the project name stated in the PRD. If none, confirm with the user.
**This project name goes consistently into every task's `project` field.**

### 1-2. Convert task list → `create_tasks_bulk` JSON

Convert the PRD's task plan into **a single `create_tasks_bulk` call**.

Required fields per task:

- `title`: a clear title
- `description`: concrete work + completion criteria
- `role`: backend / frontend / test / devops
- `priority`: 5(urgent) ~ 1(low)
- `depends_on`: dependencies (TASK-NNN format)
- `scope`: file paths to modify (conflict prevention)
- `project`: **the project name locked in Phase 0** (same for all tasks)

### 1-3. Run the bulk creation

**Always call Marblo MCP's `create_tasks_bulk` once to create all tasks at once.**

```
⛔ Wrong way: call Claude Code's TaskCreate 13 times individually
✅ Right way: call Marblo MCP's create_tasks_bulk once
```

### 1-4. Verify the creation result

- Whether all succeeded
- Whether the dependency mapping is correct
- Confirm dashboard registration with `get_all_tasks`

---

## Phase 2: Spawn agents + start work

1. Load each role's skill file with `get_agent_skill`:

   - backend → `skills/backend_agent.md`
   - frontend → `skills/frontend_agent.md`
   - test → `skills/test_agent.md`
   - devops → `skills/devops_agent.md`

2. Use `get_available_tasks` to see tasks that can be handled immediately.

   - tasks with no dependencies, or whose dependencies are already satisfied

3. As Team Leader, spawn the agents:

   - pass each agent its skill file + task info
   - separate file areas by scope → parallel work possible

4. Work loop:

   ```
   for each available task:
     1. claim_task (with agent_id)
     2. update_task_status → IN_PROGRESS
     3. do the actual coding work
     4. add_activity to log progress (file creation, test results, etc.)
     5. submit_for_review
     6. check the next available task
   ```

5. Report during work:

   ```
   🚀 Project kickoff complete
   ━━━━━━━━━━━━━━━━━━━
   Tasks created: {N}
   Ready to start: {M}
   Agents spawned: backend, frontend

   Currently in progress:
   - TASK-001: DB schema design (Backend Agent)

   Waiting:
   - TASK-002: User API (waiting for TASK-001)
   - TASK-003: Main UI (waiting for TASK-002)
   ```

---

## Phase 3: Monitoring

Keep checking while work is in progress:

1. On task completion → the unblocked next task starts automatically
2. When a REVIEW comes up → notify the user
3. When a FAILED occurs → analyze the cause + report to the user
4. Check PM feedback with `check_feedback` along the way

> If the user wants to stop midway, point them to `/tf-hold`.
