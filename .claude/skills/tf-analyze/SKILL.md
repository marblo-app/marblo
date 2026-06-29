---
name: tf-analyze
description: Analyze requirements and map out components, roles, and dependencies.
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
---

# Marblo Requirements Analysis

> The step where you analyze requirements and understand the structure before writing any code.
> This skill does not create tasks. It only performs analysis.
> When the analysis is done, create tasks with `/tf-create-tasks`.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> All task-related work MUST use the **Marblo MCP tools**.

---

## Phase 1: Gather requirements

Take the user's input (natural language, documents, URLs, etc.) and grasp the essentials.

### Must confirm

1. **Goal**: "What problem does this project/feature solve?"
2. **Users**: "Who uses it?"
3. **Core features**: "What are the 3 must-have features?"
4. **Tech stack**: for an existing project, analyze the codebase; for a new one, recommend a stack
5. **Scope**: MVP vs. full feature set

---

## Phase 2: Codebase analysis (for existing projects)

When adding a feature to an existing project, analyze the codebase first.

1. Understand the **project structure**: review the directory tree with `Glob`
2. Confirm the **tech stack**: package.json, requirements.txt, etc.
3. Understand the **existing patterns**: API routing, DB models, component structure
4. Identify the **impact area**: list the files/modules that need changes

---

## Phase 3: Output the analysis result

```
🔍 Requirements analysis complete
━━━━━━━━━━━━━━━━━━━━

📦 Project: {project_name}
🎯 Goal: {one-line summary}

📐 Component analysis:
  Backend:
    - {component 1}: {description}
    - {component 2}: {description}
  Frontend:
    - {component 1}: {description}

👤 Roles needed:
  - backend: {N} tasks expected
  - frontend: {N} tasks expected
  - test: {N} tasks expected

🔗 Dependency graph:
  Layer 1 (foundation): DB schema, project setup
  Layer 2 (API): core endpoints
  Layer 3 (UI): screen implementation
  Layer 4 (integration): tests, deployment

⚠️ Risks/considerations:
  - {risk 1}
  - {risk 2}

💡 Next step: create tasks with `/tf-create-tasks`.
```

---

## Notes

- Do not write code during the analysis step
- Always ask the user about anything ambiguous
- Difference from `/tf-plan`: `/tf-plan` goes all the way to writing a PRD document; `/tf-analyze` only does a quick analysis
