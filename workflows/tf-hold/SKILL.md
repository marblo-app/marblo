---
name: tf-hold
description: Pause work and take stock of the current state — use it when things get confusing or you need to change direction.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo Pause

> Step back from frantic work and organize the situation.
> Stop, assess the status, and decide the next action.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/logging MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_task_activities`, `check_feedback`, `add_activity`

---

## Step 1: Status snapshot

Use `get_all_tasks` to fetch all tasks and organize them by status.

### Output format

```
⏸️  Work paused — status summary
━━━━━━━━━━━━━━━━━━━━━━━━━━━

📊 Overall status:
   ✅ DONE:        {n}
   🔄 IN_PROGRESS: {n}
   👀 REVIEW:      {n}
   📋 TODO:        {n}
   ❌ FAILED:      {n}
   🚫 BLOCKED:     {n}
   ━━━━━━━━━━━━━━━
   Progress: {done}/{total} ({percent}%)

🔄 Work that was in progress:
   • TASK-003: AI summary API
     Last activity: "creating routes/summarize.py" (2 minutes ago)

👀 Awaiting review:
   • TASK-002: User API — needs review

❌ Problems:
   • TASK-006: Docker setup — "port 8001 already in use"
```

---

## Step 2: Inspect in-progress tasks in detail

If there are IN_PROGRESS tasks, use `get_task_activities` to see how far they got.

- Last activity log
- List of created/modified files
- Whether there is PM feedback (`check_feedback`)

---

## Step 3: Suggest the next action

Suggest an appropriate action based on the situation:

| Situation                | Suggestion                                                      |
| ------------------------ | --------------------------------------------------------------- |
| REVIEWs piling up        | "Handle reviews first to unblock the next tasks" → `/tf-review` |
| There are FAILED tasks   | "Solve this problem first" → `/tf-fix`                          |
| Want to change direction | "You can add new tasks or change priorities" → `/tf-add`        |
| Agent is stuck           | "You can take over yourself" → `/tf-handoff`                    |
| All good                 | "Continue on" → `/tf-resume`                                    |

---

## Step 4: Pause note (optional)

If needed, record the reason for pausing on the in-progress task:

```
add_activity: "⏸️ Work paused — [reason]. Progress so far: [details]"
```

> This note helps restore context next time you continue with `/tf-resume`.
