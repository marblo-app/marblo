---
name: tf-work
description: Claim a task, code per the skill-file rules, and auto-log progress as you go.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Task Work

> Grab one task and code it per the skill file's rules.
> All progress is automatically recorded in Marblo.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/status-change/logging MUST use the **Marblo MCP tools**:
> `get_available_tasks`, `claim_task`, `update_task_status`, `add_activity`,
> `submit_for_review`, `check_feedback`, `get_task_activities`, `get_agent_skill`

---

## Step 1: Select a task

1. Use `get_available_tasks` to see the tasks you can handle.
2. If there are several, show the user options:

   ```
   📋 Workable tasks:
   1. TASK-003: AI summary API (backend, priority: 4) ← recommended (high priority)
   2. TASK-004: URL input screen (frontend, priority: 4)
   3. TASK-008: Docker setup (devops, priority: 2)

   Which task to work on? (number, or '1' to auto-select)
   ```

---

## Step 2: Start the task

1. Use `claim_task` to claim the task.
2. Change to IN_PROGRESS with `update_task_status`.
3. Load the role's skill file with `get_agent_skill`.
4. Check the task's scope field to understand the work area.

```
🔧 Starting work:
   Task: TASK-003 — AI summary API
   Role: backend
   scope: backend/routes/summarize.py, backend/services/ai.py
   Skill rules: FastAPI + async/await, pytest required, HTTPException error handling
```

---

## Step 3: Code + auto-log

Call `add_activity` automatically as you work:

### Logging timing

| Moment           | Example log                                                          |
| ---------------- | -------------------------------------------------------------------- |
| File created     | "created backend/routes/summarize.py — POST /api/summarize endpoint" |
| Major logic done | "Claude API integration done — prompt template + streaming response" |
| Test written     | "test_summarize.py — wrote 3 tests"                                  |
| Test run         | "pytest result: 3/3 pass"                                            |
| Issue occurred   | "⚠️ API timeout — changed 30s → 60s"                                 |
| Decision         | "limited summary length to 500 chars (token saving)"                 |

### Log format

```
[action] [target] — [details]
```

Examples:

- "create backend/routes/summarize.py — POST /api/videos/{id}/summarize"
- "modify backend/models.py — added summary column (Text, nullable)"
- "test 3/3 pass — normal summary, empty captions, long captions cases"

---

## Step 4: Complete + submit for review

1. Check the skill file's completion criteria:
   - Code written?
   - Tests pass?
   - Error handling?
2. Use `check_feedback` to check whether there is PM feedback.
3. Submit the review with `submit_for_review`.

```
✅ Work complete:
   TASK-003: AI summary API → submitted for REVIEW

   Deliverables:
   • backend/routes/summarize.py (new)
   • backend/services/ai.py (new)
   • tests/test_summarize.py (new)
   • backend/models.py (modified — summary column)

   Tests: 3/3 pass
```
