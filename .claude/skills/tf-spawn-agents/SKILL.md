---
name: tf-spawn-agents
description: Review tasks, spawn the right agents, and kick off work.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Agent Spawn

> Review the created tasks and propose a suitable agent lineup.
> After user confirmation, spawn the agents and start work.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> Task lookup/update MUST use the **Marblo MCP tools**:
> `get_all_tasks`, `get_available_tasks`, `claim_task`, `update_task_status`,
> `add_activity`, `submit_for_review`, `get_agent_skill`

---

## Phase 1: Review tasks + propose an agent lineup

1. Use `get_all_tasks` to fetch all the project's tasks
2. Use `get_available_tasks` to see tasks that can start immediately
3. Identify the agents needed per role

### Agent lineup proposal

```
🤖 Agent lineup proposal
━━━━━━━━━━━━━━━━━━━━━

📋 Total tasks: {N} | Ready to start: {M}

Proposed agents:
  1. Backend Agent  — owns TASK-001, TASK-002, TASK-003
  2. Frontend Agent — owns TASK-004, TASK-005
  3. Test Agent     — owns TASK-006 (starts after TASK-003 is done)

Can run in parallel:
  - Backend Agent + Frontend Agent (scopes separated)

Sequential wait:
  - Test Agent → starts after Backend is done

Spawn these as-is?
```

**Only spawn after getting the user's confirmation.**

---

## Phase 2: Spawn agents

1. Use `get_agent_skill` to load each role's skill file:

   - backend → `skills/backend_agent.md`
   - frontend → `skills/frontend_agent.md`
   - test → `skills/test_agent.md`
   - devops → `skills/devops_agent.md`
   - flutter → `skills/flutter_agent.md`

2. Build per-agent work instructions:

   - assigned task list
   - scope (file areas to modify)
   - dependency info
   - skill file content

3. As Team Leader, spawn the agents:
   - pass each agent its skill + task info
   - separate file areas by scope → parallel work

---

## Phase 3: Work loop

```
for each available task:
  1. claim_task (with agent_id)
  2. update_task_status → IN_PROGRESS
  3. do the actual coding work
  4. add_activity to log progress
  5. submit_for_review
  6. check the next available task
```

---

## Phase 4: Progress report

```
🚀 Agent spawn complete
━━━━━━━━━━━━━━━━━━━

Spawned agents: {N}
  - Backend Agent  → working on TASK-001
  - Frontend Agent → working on TASK-004

Currently in progress:
  🔄 TASK-001: DB schema design (Backend Agent)
  🔄 TASK-004: Main UI layout (Frontend Agent)

Waiting:
  📋 TASK-002: User API (waiting for TASK-001)
  📋 TASK-003: Payment API (waiting for TASK-001)
  📋 TASK-006: Integration tests (waiting for TASK-003)

💡 Check progress: `/tf-status`
```

---

## Phase 5: Monitoring

Keep checking while work is in progress:

1. On task completion → the unblocked next task starts automatically
2. When a REVIEW comes up → notify the user
3. When a FAILED occurs → analyze the cause + report
4. Check PM feedback with `check_feedback`

> To stop midway, use `/tf-hold`.
