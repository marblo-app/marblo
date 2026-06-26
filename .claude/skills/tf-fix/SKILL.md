---
name: tf-fix
description: Diagnose and recover FAILED/BLOCKED tasks, or cancel/delete unneeded ones. / FAILED/BLOCKED 태스크 진단 + 복구, 또는 불필요한 태스크 취소/삭제
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Task Recovery

> Diagnose and recover tasks in FAILED or BLOCKED state.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/status-change/logging MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_task_activities`, `update_task_status`, `add_activity`

---

## Steps

1. Use `get_all_tasks` to find FAILED / BLOCKED tasks.
2. For each problem task:
   a. Use `get_task_activities` to review the activity log (find the failure cause).
   b. Classify the cause:
   - **Environment issue**: API key not set, Docker not running, package not installed
   - **Code issue**: bug in agent-written code, failing test
   - **Dependency issue**: a prerequisite task is not yet done
   - **Skill issue**: the skill file's rules were ambiguous, so the agent misread them
3. Propose and apply a fix matching the cause:
   - Environment issue → fix the config, then revert to TODO(retry) with `update_task_status`
   - Code issue → fix it directly and retry, or add feedback
   - Dependency → handle the prerequisite task first
   - Skill → propose a fix to the skill file's rules
4. After recovery, record the change with `add_activity`.

## Common FAILED causes

- API key missing from the `.env` file
- Docker container is down
- Package version conflict
- Agent failed trying to modify a file outside its scope

---

## Cancel / delete a task

When the user says "I don't need this task", "cancel it", etc.:

1. Use `get_all_tasks` to confirm the target task.
2. Confirm with the user:

   ```
   ❌ Delete target:
     TASK-007: Payment integration (current: TODO)

     Other tasks that depend on this: TASK-010, TASK-011
     → These tasks may be affected too.

     Really delete?
   ```

3. On approval, call `curl -X DELETE http://localhost:8001/api/tasks/{id}`
4. Record "TASK-007 deleted — check dependencies" on the related tasks with `add_activity`.

### FAILED → cancel

For FAILED tasks that are hard to recover, delete them:

- Failed 3+ retries
- A feature no longer needed
- The scope has changed completely
