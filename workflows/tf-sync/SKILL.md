---
name: tf-sync
description: Sync the current code state with Marblo tickets — catch missed updates and bring tickets up to date.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo Ticket Sync

> When an agent coded without updating its tickets,
> reconcile the actual code state with the ticket state.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/status-change/logging MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `update_task_status`, `add_activity`, `submit_for_review`, `claim_task`

---

## When to use

- An agent wrote code but didn't `add_activity` or `submit_for_review`
- You coded directly but forgot to update the ticket
- The session was cut off midway so the ticket state doesn't match reality
- You want to check "do the tickets match the actual progress right now?"

---

## Step 1: Collect the current state

Check two things at once:

### 1-1. Marblo ticket status

Use `get_all_tasks` to fetch all tasks.
Organize each task's status, scope (file paths), and last activity.

### 1-2. Actual code state

Check whether the files listed in each task's scope actually exist:

- Does the file exist?
- Was it modified recently? (`git diff`, `git log`)
- Is there a test file?

---

## Step 2: Detect mismatches

Compare ticket state vs. actual code to find mismatches:

### Detection patterns

```
🔍 Mismatch detection result:
━━━━━━━━━━━━━━━━━━

⚠️ Code exists but ticket is TODO:
   TASK-003: AI summary API
   → backend/routes/summarize.py already exists (87 lines)
   → tests/test_summarize.py already exists (3 tests)
   → Recommend: update to IN_PROGRESS or REVIEW

⚠️ Ticket is IN_PROGRESS but no activity log:
   TASK-004: URL input screen
   → Last activity: none
   → frontend/components/UrlInput.tsx exists (42 lines)
   → Recommend: record current state with add_activity

⚠️ Ticket is IN_PROGRESS but code is complete:
   TASK-002: User API
   → backend/routes/users.py exists + tests pass
   → Recommend: submit_for_review

✅ OK:
   TASK-001: DB schema — DONE, models.py exists
   TASK-005: Insight card — TODO, no file (not started yet)
```

---

## Step 3: Run the sync

Show the mismatch list to the user and handle them one at a time:

### 3-1. Present options for each mismatch

```
TASK-003: AI summary API (current: TODO → code already exists)

  1. Update to REVIEW (code complete)
  2. Update to IN_PROGRESS (still in progress)
  3. Add an activity log only (keep status)
  4. Skip

  How would you like to proceed?
```

### 3-2. Execute per choice

- **Update to REVIEW:**

  1. `update_task_status` → IN_PROGRESS (can't go straight from TODO to REVIEW)
  2. `add_activity`: "Sync: code already complete — [file list]"
  3. `submit_for_review`

- **Update to IN_PROGRESS:**

  1. `claim_task` (if TODO)
  2. `update_task_status` → IN_PROGRESS
  3. `add_activity`: "Sync: work in progress — [current state]"

- **Add activity log only:**
  1. `add_activity`: "Sync: confirmed [file] exists, [current state summary]"

---

## Step 4: Summarize the sync result

```
🔄 Sync complete
━━━━━━━━━━━━━

  Updated:        3
  Skipped:        1
  Already OK:     4

  Current state:
  ✅ DONE:        2
  👀 REVIEW:      2  ← needs review!
  🔄 IN_PROGRESS: 1
  📋 TODO:        3

  💡 Next: handle 2 REVIEW with /tf-review
```

---

## Auto-detection criteria

| Ticket state | Code state                     | Verdict                         |
| ------------ | ------------------------------ | ------------------------------- |
| TODO         | no file                        | ✅ OK                           |
| TODO         | file exists                    | ⚠️ missed — needs update        |
| IN_PROGRESS  | file exists + has activity log | ✅ OK                           |
| IN_PROGRESS  | file exists + no activity log  | ⚠️ missing log                  |
| IN_PROGRESS  | file exists + tests pass       | ⚠️ needs REVIEW submission      |
| REVIEW       | file exists                    | ✅ OK                           |
| DONE         | file exists                    | ✅ OK                           |
| DONE         | no file                        | ⚠️ code deleted? needs checking |
