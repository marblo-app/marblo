---
name: tf-review
description: Review REVIEW-status tasks as PM, check code quality, then approve or reject.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep
---

# Marblo PM Review

> Review the REVIEW tasks agents submitted.
> Check code quality and approve (DONE) or reject (revert to TODO).

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/status-change MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `update_task_status`, `add_activity`, `get_task_activities`

---

## Step 1: Fetch tasks awaiting review

Filter `get_all_tasks` to only REVIEW status.

```
👀 Awaiting review: {n}
━━━━━━━━━━━━━

1. TASK-002: User API (backend)
   Submitted: 30 min ago | Owner: backend-agent

2. TASK-004: URL input screen (frontend)
   Submitted: 15 min ago | Owner: frontend-agent
```

---

## Step 2: Review each task

For each task, check the following:

### 2-1. Check the activity log

Use `get_task_activities` to understand what the agent did.

### 2-2. Check the code

Read and review the files listed in the task's scope field.

### 2-3. Review checklist

```
□ Feature completeness: are all requirements from the task description implemented?
□ Code quality: did it follow the skill file's rules (framework, patterns)?
□ Tests included: is there test code and does it pass?
□ Error handling: are exceptional cases handled properly?
□ Scope compliance: did it avoid modifying files outside scope?
□ Security: no vulnerabilities like SQL injection, XSS?
```

### 2-4. Verdict

Show the review result to the user:

```
📝 TASK-002: User API review result
━━━━━━━━━━━━━━━━━━━━━━━━━

✅ Feature completeness: signup, login, profile lookup — OK
✅ Code quality: FastAPI + Pydantic v2 — OK
✅ Tests: 5/5 pass — OK
⚠️ Error handling: no password validation
✅ Scope compliance: OK

Verdict: approve or reject?
```

---

## Step 3: Approve / reject

### Approve

- `update_task_status` → DONE
- If it unblocks any tasks, let the user know:
  ```
  ✅ TASK-002 approved → DONE
  🔓 TASK-004, TASK-005 are now workable
  ```

### Reject

- `update_task_status` → TODO (include a feedback comment)
- Record a concrete change request with `add_activity`:
  ```
  ❌ TASK-002 rejected → TODO
  Feedback: "Add password validation (8+ chars, include special char).
            Make error messages user-friendly too."
  ```

---

## After review

After handling all REVIEWs, show the status:

```
📊 Review complete:
   Approved: {n}
   Rejected: {n}

   Newly available tasks: {list}
   Next action: /tf-work or re-run the agents
```
