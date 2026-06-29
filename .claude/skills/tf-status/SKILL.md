---
name: tf-status
description: Summarize project task progress as a dashboard.
allowed-tools: Bash, Read
---

# Marblo Status Check

> Quickly grasp the status from the terminal, without the dashboard.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup MUST use **Marblo MCP's `get_all_tasks` and `check_feedback`**.

---

## Lookup order

1. Use `get_all_tasks` to fetch all tasks (apply the project filter)
2. Classify and count by status
3. Use `check_feedback` to check unread PM feedback
4. If there are FAILED/BLOCKED tasks, show the cause from the activity log

## Output format

```
📊 Project: {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE          {n}  ██████████░░  {percent}%
  🔄 IN_PROGRESS   {n}  {task titles}
  👀 REVIEW        {n}  {task titles} ← needs review!
  📋 TODO          {n}
  ❌ FAILED        {n}  {cause summary}
  🚫 BLOCKED       {n}

  ━━━━━━━━━━━━━━━
  Progress: {done}/{total} ({percent}%)
  Estimated remaining tasks: {remaining}

⚠️ Needs attention:
  • FAILED: TASK-006 — "port already in use"
  • Unread feedback: PM comment on TASK-003

💡 Next actions:
  • /tf-review — handle {n} REVIEW
  • /tf-fix — recover {n} FAILED
```

## Situational extra guidance

| Situation                 | Guidance                                                |
| ------------------------- | ------------------------------------------------------- |
| All tasks DONE            | "🎉 Project complete! Great work."                      |
| 3+ REVIEW                 | "Reviews are piling up. Handle them with `/tf-review`." |
| There are FAILED          | "There are problem tasks. Check them with `/tf-fix`."   |
| Only TODO, no IN_PROGRESS | "Work hasn't started yet. Start with `/tf-start`."      |
