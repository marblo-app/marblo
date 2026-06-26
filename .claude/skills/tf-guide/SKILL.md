---
name: tf-guide
description: Marblo slash command guide — which command to use in each situation. / Marblo 슬래시 명령어 가이드. 상황별 어떤 명령어를 쓸지 안내합니다.
disable-model-invocation: true
allowed-tools: Read
---

# Marblo Slash Command Guide

> Output this guide as-is. Just show the content below with no extra explanation.

---

Output the following to the user as-is:

```
🎯 Marblo Slash Command Guide
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📌 Start a project (step by step)
  /tf-analyze       Analyze requirements — components, roles, dependencies
  /tf-create-tasks  Bulk-create tasks from the analysis (create_tasks_bulk after confirm)
  /tf-spawn-agents  Propose an agent lineup + spawn

📌 Start a project (all at once)
  /tf-plan     Write a PRD + task decomposition plan (Socratic questions → structured)
  /tf-start    Bulk-create tasks from the PRD + spawn agents

🔧 Work in progress
  /tf-work     Claim a task → code + auto-log progress
  /tf-status   Dashboard summary of all task status
  /tf-add      Add a new task to an active project / edit an existing task

⏸️ Pause / resume
  /tf-hold     Pause work + organize status + suggest next action
  /tf-resume   Pick up paused work (auto-restore context)

👀 Review / problem solving
  /tf-review   PM code review — approve/reject
  /tf-feedback Check + reply to PM feedback (two-way communication)
  /tf-fix      Diagnose + recover FAILED/BLOCKED tasks + cancel tasks
  /tf-handoff  Agent failed → take over yourself

🔄 Sync / cleanup
  /tf-sync     Detect mismatch between code state and ticket state + sync
  /tf-done     Project completion — summarize results + archive + retrospective

🔁 Repetitive work
  /tf-ralph    Repeat the same work across N targets (tracked per ticket)

📖 Help
  /tf-guide    Show this guide
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💡 Typical flows:
  Step by step: /tf-analyze → /tf-create-tasks → /tf-spawn-agents → /tf-status → /tf-done
  All at once:  /tf-plan → /tf-start → /tf-status → /tf-review → /tf-done

💡 Situational recommendations:
  • Just starting (step by step) → /tf-analyze
  • Just starting (all at once)  → /tf-plan
  • Where was I                  → /tf-resume
  • Check status                 → /tf-status
  • Reviews piling up            → /tf-review
  • Agent failed                 → /tf-fix
  • Left some feedback           → /tf-feedback
  • Tickets don't match          → /tf-sync
  • Batch repetitive work        → /tf-ralph
  • Project done                 → /tf-done
  • Not sure what to do          → /tf-hold (organize status + suggest next action)
```
