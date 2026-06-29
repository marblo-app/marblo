---
name: tf-ralph
description: Batch-process repetitive work with the Ralph pattern, tracking each item as a ticket.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Ralph — Repetitive Work Automation

> Handle repetitive work alongside Marblo tickets using the Ralph pattern.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task creation/lookup/status-change/logging MUST use the **Marblo MCP tools**:
>
> - Bulk create: `create_tasks_bulk` (create all tickets in a single call)
> - Work: `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`
> - Lookup: `get_all_tasks`, `get_available_tasks`

---

## Usage

Ask the user for the following:

1. **Targets**: which files/components/endpoints to process repeatedly
2. **Work**: what to do to each target (add tests, refactor, improve a11y, etc.)
3. **Project name**: the project name to use on the Marblo tickets

## Workflow

1. Analyze the target files/components and build a list.
2. Use `create_tasks_bulk` to create one ticket per target:
   - title: "[work type] target name" (e.g.: "[Test] /api/users")
   - role: the role matching the work
   - priority: set the same for all
3. Process the tickets one at a time, in order:
   a. `claim_task` → `update_task_status(start_work)`
   b. Do the actual work
   c. Record the result with `add_activity` (e.g.: "wrote 3 pytest tests, 3/3 pass")
   d. Success: `submit_for_review` → `update_task_status(DONE)`
   e. Failure: `update_task_status(FAILED)` + record the failure cause
4. After all tickets are processed, summarize:
   - DONE: N
   - FAILED: N
   - causes of failed items

## Ralph vs Agent Teams

- **Ralph**: repeat the same work across N targets. 1 agent processes sequentially.
- **Agent Teams**: different work in parallel. N agents collaborate.
