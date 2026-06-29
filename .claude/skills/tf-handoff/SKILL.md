---
name: tf-handoff
description: Take over a task an agent failed and finish it yourself.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Manual Handoff

> Take over a task an agent couldn't handle and finish it yourself.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/status-change/logging MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_task_activities`, `update_task_status`, `claim_task`,
> `add_activity`, `submit_for_review`, `get_agent_skill`

---

## Steps

1. Use `get_all_tasks` to find FAILED, BLOCKED, or stale IN_PROGRESS tasks.
2. Check the target task's status:
   - FAILED → revert to TODO(retry) with `update_task_status` → claim again
   - BLOCKED → identify the blocking cause → resolve, then proceed
   - IN_PROGRESS (stale) → an agent stalled. Check how far it got from the activity log
3. Use `get_task_activities` to see how far the agent worked.
4. Use `get_agent_skill` to load the skill file for that role.
5. Review the code the agent left and continue:
   - If files already exist, continue on top of them
   - If a test failed, fix it
   - Fill in the missing parts
6. During work, record "Manual handoff: [what you did]" with `add_activity`.
7. When done, `submit_for_review` or mark DONE directly.

## Handoff criteria

- An agent FAILED the same task 3+ times → doing it yourself is faster
- Work that requires environment setup (API keys, external service integration)
- Complex work where the agent needs to modify files outside its scope
