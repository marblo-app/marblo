---
name: tf-feedback
description: Check and respond to PM feedback left on the dashboard — a two-way communication channel.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo PM Feedback Check + Reply

> Check and reply to the feedback (comments) the PM left on tasks in the dashboard.
> A two-way communication channel that catches feedback an agent missed during work.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Feedback check/reply MUST use the **Marblo MCP tools**:
> `check_feedback`, `acknowledge_feedback`, `add_activity`, `get_task_activities`, `get_all_tasks`

---

## Step 1: Fetch unread feedback

Use `check_feedback` to fetch the unread feedback the PM left.

### When there is feedback

```
💬 Unread PM feedback: {n}
━━━━━━━━━━━━━━━━━━━━━━━

1. TASK-003: AI summary API (IN_PROGRESS)
   💬 "Can you explain the parser implementation?"
   — 11 minutes ago

2. TASK-005: Main screen (REVIEW)
   💬 "Please check responsiveness. Something gets cut off on mobile."
   — 2 hours ago

Which feedback should we handle first? (number or 'all')
```

### When there is no feedback

```
✅ No unread feedback

💡 When the PM leaves feedback on the dashboard, you can check it here.
```

---

## Step 2: Review feedback in detail + analyze code

For each piece of feedback:

1. Use `get_task_activities` to review the full activity log (get context).
2. Read the task's scope files to understand the current code state.
3. Analyze the PM's question/request:

| Feedback type                                                | Response                                              |
| ------------------------------------------------------------ | ----------------------------------------------------- |
| **Question** ("explain this", "why this way?")               | Analyze the code and write an answer                  |
| **Change request** ("change this", "add this")               | Modify the code and report the result                 |
| **Confirmation request** ("is this right?", "is it tested?") | Verify, then answer with the result                   |
| **Direction** ("do it this way")                             | Confirm the approach + answer with a plan to apply it |

---

## Step 3: Reply + apply

### 3-1. Post a reply

Record a reply to the PM feedback with `add_activity`:

```
add_activity:
  task_id: {task_id}
  message: "💬 PM feedback reply: {detailed answer}"
```

### 3-2. When a code change is needed

1. Modify the code.
2. Record the change with `add_activity`:
   ```
   "💬 PM feedback applied: {file modified} — {what changed}"
   ```

### 3-3. Mark feedback as acknowledged

Use `acknowledge_feedback` to mark the feedback as read.

---

## Step 4: Summarize results

```
💬 Feedback handling complete
━━━━━━━━━━━━━━━━━

  Checked/replied: {n}
  Code changes:    {n}
  Still unread:    {n}

  Reply log:
  • TASK-003: explained the parser implementation structure
  • TASK-005: fixed mobile responsive CSS
```

---

## Auto reminder

This skill is used during other skills as well:

- `/tf-work`: calls `check_feedback` during work → notifies if there is feedback
- `/tf-resume`: calls `check_feedback` on resume → checks feedback that arrived in the meantime
- `/tf-hold`: shows whether there is unread feedback when pausing

**But when the PM sends urgent feedback** → use `/tf-feedback` to check and reply immediately.
