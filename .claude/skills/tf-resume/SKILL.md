---
name: tf-resume
description: Resume a paused project — restore full context, re-review the plan, and pick work back up, all in one stop.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트명]
---

# Marblo Project Resume

> A new session, or coming back days later — fully restore the project and continue.
> Combine ticket status + activity log + PRD + code state to tell you "what to do right now".

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/logging/status-change MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_available_tasks`, `get_task_activities`, `check_feedback`,
> `add_activity`, `submit_for_review`, `claim_task`, `update_task_status`,
> `create_task`, `create_tasks_bulk`

---

## Phase 1: Restore full context

**Read and combine all 5 sources.** Proceed in order.

### 1-1. Read project documents

Find and read these files in order:

1. **PRD** → `docs/PRD.md` (project goals, feature list, tech stack)
2. **Project status doc** → `docs/project_status.md` (status notes the PM wrote, direction memos)
3. **CLAUDE.md** → project root (project-specific rules, conventions)
4. **Auto memory** → `.claude/projects/*/memory/MEMORY.md` (patterns/decisions learned in prior sessions)
5. **User-specified docs** → ask the user:
   ```
   📖 Any additional documents to read?
   (e.g.: docs/NOTES.md, docs/ARCHITECTURE.md, or 'none')
   ```

### 1-2. Fetch full ticket status

Use `get_all_tasks` to fetch all tasks in the project.

```
📍 Project restore: {project_name}
━━━━━━━━━━━━━━━━━━━━━━━━━━━━

  ✅ DONE:        {n}  {task titles}
  🔄 IN_PROGRESS: {n}  {task titles}
  👀 REVIEW:      {n}  {task titles}
  📋 TODO:        {n}  {task titles}
  ❌ FAILED:      {n}  {task titles}
  ━━━━━━━━━━━━━━━
  Progress: {done}/{total} ({percent}%)
```

### 1-3. Check the last work

Use `get_task_activities` on IN_PROGRESS, REVIEW, and recent DONE tasks to see the last activity:

```
📝 Recent activity:
  • TASK-003 (IN_PROGRESS): "routes/summarize.py — POST /api/summarize" — 2 days ago
  • TASK-002 (REVIEW): "pytest 5/5 pass" — 3 days ago
  • TASK-001 (DONE): "DB schema complete" — 4 days ago
```

### 1-4. Check PM feedback

Use `check_feedback` to check PM feedback that arrived in the meantime:

```
💬 Unread PM feedback: {n}
  • TASK-003: "Can you explain the parser implementation?" — 1 day ago
```

### 1-5. Combined context briefing

Combine all gathered info and brief the user:

```
📍 Context restore complete
━━━━━━━━━━━━━━━━━━━

  📄 PRD: {one-line project summary}
  📊 Progress: {done}/{total} ({percent}%)
  📝 Last work: {recent activity summary}
  💬 Unread feedback: {n}
  📖 Memory: {key decisions/patterns summary}

  ⏱️ Last activity date: {last_activity_date}
```

---

## Phase 2: Diagnose the situation + decide the next action

Analyze the current state and present options to the user:

### Case A: Going smoothly (no FAILED/BLOCKED)

```
💡 Current situation: smooth
━━━━━━━━━━━━━━━━━━━━

  What you can do right now:
  1. 📋 Handle {n} REVIEW → /tf-review  (unblocks the next tasks)
  2. 🔧 Continue IN_PROGRESS → start coding right away
  3. 📋 Start a new task from TODO → /tf-work

  How would you like to proceed?
```

### Case B: Problems (FAILED/BLOCKED present)

```
⚠️ Current situation: problems
━━━━━━━━━━━━━━━━━━━━━

  ❌ FAILED: TASK-006 — "port already in use"
  🚫 BLOCKED: TASK-007 — waiting for TASK-006

  Recommendation:
  1. Solve the problem first → /tf-fix
  2. Skip the problem task and work on something else
  3. Cancel the problem task → /tf-fix (delete)
```

### Case C: Plan re-review needed

Suggest a plan re-review in these cases:

- Overall progress is 50%+ but the remaining TODO is unrealistic
- 3+ FAILED tasks
- PM feedback includes a direction change
- The user requests "let's look at the plan again"

```
🔄 Plan re-review recommended
━━━━━━━━━━━━━━━━━

  Progress vs. current PRD:
  • Core feature A: ✅ done
  • Core feature B: 🔄 50% (TASK-003 in progress)
  • Core feature C: 📋 not started (TASK-005, 006, 007)

  Options:
  1. Continue as-is
  2. Revise the plan (add/delete/re-prioritize tasks) → go to Phase 3
  3. Re-plan from scratch → /tf-plan
```

---

## Phase 3: Plan re-review + revision

When the user chose to revise the plan, or the diagnosis requires a re-review.

### 3-1. Map PRD vs. current state

Map the PRD's core feature list to the current tasks:

```
📋 PRD vs. current state:
━━━━━━━━━━━━━━━━━━━━

  Core feature 1: DB schema design
  → TASK-001 ✅ DONE

  Core feature 2: User API + auth
  → TASK-002 ✅ DONE
  → TASK-003 🔄 IN_PROGRESS (50%)

  Core feature 3: AI summary
  → TASK-004 📋 TODO
  → TASK-005 📋 TODO

  Core feature 4: Frontend UI
  → ⚠️ No task! In the PRD but not decomposed into a task

  Tasks not in the PRD:
  → TASK-006: Docker setup (FAILED) — outside PRD scope?
```

### 3-2. Organize existing tasks

For each remaining task, get the user's decision:

```
📋 Re-evaluate remaining tasks:
  1. TASK-004: AI summary API (TODO, priority: 3) → [keep / edit / delete]
  2. TASK-005: Summary prompt (TODO, priority: 3) → [keep / edit / delete]
  3. TASK-006: Docker setup (FAILED)            → [retry / delete]
```

Based on the user's decision:

- **Keep**: leave as-is
- **Edit**: change priority, description, scope (call the PATCH API)
- **Delete**: call `curl -X DELETE http://localhost:8001/api/tasks/{id}`
- **Retry**: `update_task_status` → TODO(retry)

### 3-3. Add new tasks

Features in the PRD without tasks, or newly needed work:

```
📌 Tasks to add:
  NEW-1: Main screen UI (frontend, priority: 4, depends_on: TASK-003)
  NEW-2: Error page (frontend, priority: 2)
  NEW-3: E2E tests (test, priority: 2, depends_on: NEW-1)

  Bulk-create with create_tasks_bulk?
```

**Always bulk-create in a single `create_tasks_bulk` call.** (no individual TaskCreate)

### 3-4. Confirm the revised plan

```
🔄 Plan revision result:
━━━━━━━━━━━━━━━━

  Deleted: 1 (TASK-006)
  Edited:  1 (TASK-004: priority 3→5)
  Added:   3 (NEW-1, NEW-2, NEW-3)
  Kept:    2

  Total remaining tasks: {n}
  Expected order:
  1. TASK-003 (IN_PROGRESS) → continue
  2. TASK-004 (TODO, priority: 5) → next
  3. NEW-1 (TODO, depends_on: TASK-003) → after TASK-003
  ...

  Proceed as-is?
```

---

## Phase 4: Resume work

Once the plan is finalized, start the actual work:

1. Record "▶️ Work resumed — [resume summary]" with `add_activity`
2. Start work by priority:
   - If there is PM feedback → check/reply first (`/tf-feedback`)
   - If there are REVIEWs → handle reviews (unblocks next tasks)
   - If there is IN_PROGRESS → continue coding
   - If only TODO → `claim_task` → start new work
3. Review prior artifacts (code, files) and continue
4. On completion, `submit_for_review`

---

## How new-session context restore works

When you reopen Claude Code, the prior conversation is gone. What this skill restores:

| Source                   | Information restored                                                |
| ------------------------ | ------------------------------------------------------------------- |
| `docs/PRD.md`            | Overall project goals, feature list, tech stack                     |
| `docs/project_status.md` | Status notes the PM wrote, direction memos, priority changes        |
| `CLAUDE.md`              | Project-specific rules, conventions                                 |
| `.claude/.../memory/`    | Patterns, decisions, debugging experience learned in prior sessions |
| User-specified docs      | Architecture docs, notes, extra context                             |
| `get_all_tasks`          | Full project state (what's done, what's left)                       |
| `get_task_activities`    | How far each task got (last work)                                   |
| `check_feedback`         | PM instructions that arrived in the meantime                        |
| scope field              | Which files were being modified                                     |
| depends_on               | Which task unlocks next                                             |

> **Marblo tasks + PRD + memory = the project's complete memory.**
> Even if the conversation resets or the session changes, these three keep the context.
