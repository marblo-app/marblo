---
name: tf-done
description: Wrap up a project — summarize results, archive DONE tasks, and run a retrospective. / 프로젝트 완료 정리. 결과 요약 + DONE 태스크 아카이브 + 회고를 진행합니다.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
argument-hint: [프로젝트명]
---

# Marblo Project Completion

> Use this when all tasks are DONE, or when you want to wrap up the project.
> Summarize the results, archive completed tasks, and do a brief retrospective.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/logging MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_task_activities`, `add_activity`

---

## Step 1: Final project status check

Use `get_all_tasks` to fetch all tasks in the project.

### Completion check

```
📊 Project: {project_name} — final status
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE:        {n}
  🔄 IN_PROGRESS: {n}
  👀 REVIEW:      {n}
  📋 TODO:        {n}
  ❌ FAILED:      {n}

  Completion rate: {done}/{total} ({percent}%)
```

### When there are incomplete tasks

- REVIEW → "Handle reviews first → `/tf-review`"
- IN_PROGRESS → "There's work in progress. Finish it or `/tf-hold`"
- FAILED → "There are failed tasks → `/tf-fix` or cancel"
- TODO → "There are tasks not yet started. Continue or cancel?"

Options for the user:

1. Cancel the incomplete tasks and wrap up the project
2. Go back and handle the remaining work

---

## Step 2: Summarize project results

### Organize deliverables

Based on each task's scope and activity log, list the generated files:

```
📦 Project deliverables
━━━━━━━━━━━━━━━━

  Files created:
  • backend/routes/users.py (TASK-001)
  • backend/routes/summarize.py (TASK-003)
  • frontend/components/UrlInput.tsx (TASK-004)
  • tests/test_users.py (TASK-001)
  • ...

  Total files: {n} (new {n} + modified {n})
```

### Project timeline

```
📅 Timeline
━━━━━━━━━━

  Started:  {first_task_claimed_at}
  Finished: {last_task_done_at}
  Duration: {duration}

  Per task:
  • TASK-001: DB schema — 15 min
  • TASK-002: User API — 32 min
  • ...
```

---

## Step 3: Retrospective (optional)

Offer the user a brief retrospective:

```
💬 Project retrospective
━━━━━━━━━━━━━━━

  ✅ What went well:
  • [tasks the agents handled smoothly]
  • [where dependency management worked well]

  ⚠️ What to improve:
  • [causes of FAILED tasks]
  • [where skill files need fixing]
  • [task decomposition that was too large or too small]

  💡 Apply to the next project:
  • [rules to add to skill files]
  • [task decomposition improvements]
```

---

## Step 4: Archive

After user confirmation, archive the DONE tasks:

```
Archive this project's completed tasks?
Archiving hides them from the dashboard and moves them to "{project}:archived".
```

On approval:

- Call `POST /api/tasks/archive?project={project_name}` (use curl)
- Result: `"{n} tasks archived"`

```
🎉 Project complete!
━━━━━━━━━━━━━━━━

  Project: {project_name}
  Completed tasks: {n} → archived
  Deliverables: {n} files

  Great work!
```
