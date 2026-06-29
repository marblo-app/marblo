---
name: tf-plan
description: Write a project PRD (functional + non-functional + constraints + risks) and break it into 18-22 tasks (with model recommendations). A heavyweight planning step for thinking hard before writing code.
disable-model-invocation: true
allowed-tools: Bash, Read, Glob, Grep, Write, Edit
argument-hint: [프로젝트 설명 또는 아이디어]
---

# Marblo Project Planning

> The step where you think and plan thoroughly before writing a single line of code.
> This skill does not create tasks. It only builds the plan.
> Once the plan is finalized, execute it with `/tf-start`.
>
> **Difference from `/tf-analyze`**: `/tf-analyze` is a quick sketch of components,
> roles, and dependencies (minutes). `/tf-plan` is the heavyweight version that covers
> writing a PRD + decomposing into 18-22 tasks + identifying non-functional
> requirements/constraints/risks (tens of minutes to hours).
>
> **4 phases**: ① 8 required + 5-7 additional Socratic questions → ② PRD (features, NFR,
> constraints, KPIs, system diagram, risks, assumptions) → ③ 18-22 task decomposition
> (with model recommendations) → ④ review checklist.

---

## ⛔ Required rule: Marblo MCP only

> **Never use the Claude Code built-in tools (TaskCreate, TaskList, TaskUpdate, TaskGet).**
> All task-related work MUST use the **Marblo MCP tools**:
> `create_tasks_bulk`, `create_task`, `get_all_tasks`, `get_available_tasks`,
> `claim_task`, `update_task_status`, `add_activity`, `submit_for_review`,
> `check_feedback`, `get_task_activities`, `get_agent_skill`, `get_task_dependencies`
>
> Tasks created with Claude Code's built-in TaskCreate do not show up on the Marblo dashboard.

---

## Phase 0: Lock the project name

**Lock the project name to be used by `/tf-start` first.**

1. Propose or ask the user for a project name:
   ```
   📦 Please decide on a project name.
   e.g.: youtube-insight, todo-app, my-saas
   (lowercase letters + hyphens recommended; this name is used on every task ticket)
   ```
2. After user approval, record this name in the PRD.
3. **Use this project name consistently for all subsequent task creation.**

---

## Phase 1: Brainstorming (Socratic questioning)

Concretize the user's idea. Don't design right away — ask questions first.
Entering design while still ambiguous produces a wrong PRD and wrong tasks.

### Required questions — 8 (do NOT move on until all are answered)

**A. Problem & users**

1. **Core value**: "What problem does this project solve? In one sentence."
2. **Persona pain point**: "How do users solve this problem today? Why is that insufficient?"
3. **User scale**: "Expected number of users at MVP launch? (10? 100? 100,000?)"

**B. Scope & success metrics**

<!-- prettier-ignore-start -->

4. **Core features**: "If you had to pick just 3 must-have features?"
5. **Success metrics**: "What does success look like? 1-3 measurable metrics. (DAU, response time, conversion rate, etc.)"
6. **Scope check**: "Build the MVP first and expand, or go full-feature from the start?"
<!-- prettier-ignore-end -->

**C. Tech & operations**

<!-- prettier-ignore-start -->

7. **Tech preference**: "Do you have a preferred tech stack? Why that choice? (recommend one if none)"
8. **Operating environment**: "Where does it run? (local/Docker/AWS/Vercel...) Budget constraints? Schedule constraints?"
<!-- prettier-ignore-end -->

### Additional questions — 5-7 as needed (only the relevant ones)

- **External dependencies**: "Do you need external API integration?" (auth, payments, social login, LLM, etc.)
- **Data source**: "Where does the data come from?" (user input, external API, crawling, file upload)
- **Competition/differentiation**: "Are there similar services? How are we different?"
- **Regulation & security**: "Do you handle personal/payment/medical data? Subject to regulations like GDPR/PCI-DSS?"
- **Performance SLO**: "Do you have a response-time target? (p50/p95) Concurrent-user target?"
- **Accessibility & i18n**: "Need i18n? What WCAG accessibility level?"
- **In-house operations**: "Who on the team operates it? Where do monitoring/alerts go?"

> **Principle**: don't move to Phase 2 until all 8 required answers are clear. Ask additional
> questions only to the extent ambiguity remains, then stop. If "I don't know" is the answer,
> state the most reasonable assumption and record it in the PRD's **Assumptions** section.

---

## Phase 2: Write the PRD (Product Requirements Document)

Organize the brainstorming results into a structured document.

### PRD template

````markdown
# [Project name] PRD

## One-line summary

[What this project is, in one sentence]

## Core problem

[The problem to solve + how users solve it today + why that is insufficient]

## Target users

- **Primary persona**: [e.g.: solo founder in their 30s, sales-team PM]
- **Expected scale**: [N users at MVP launch, M after 6 months]
- **Usage context**: [when/where/why they use this]

## Success metrics (KPI)

| Metric           | Target         | Measurement |
| ---------------- | -------------- | ----------- |
| [e.g.: DAU]      | [e.g.: 100]    | [tool]      |
| [e.g.: p95 resp] | [e.g.: ≤500ms] | [APM]       |
| [e.g.: conv.]    | [e.g.: 5%]     | [Analytics] |

## Tech stack

- Backend: [e.g.: FastAPI + PostgreSQL]
- Frontend: [e.g.: Next.js 14 + Tailwind CSS]
- AI/API: [e.g.: Claude API, YouTube Data API]
- Infra: [e.g.: Docker Compose, Vercel, AWS Fargate]

## System diagram

```text
[Show core components + data flow as an ASCII or Mermaid block]

Example (ASCII):
  ┌────────┐   HTTPS    ┌──────────┐   SQL    ┌──────────┐
  │ Browser├───────────►│  FastAPI ├─────────►│ Postgres │
  └────────┘            └────┬─────┘          └──────────┘
                             │ HTTP
                             ▼
                       ┌──────────┐
                       │ Claude API│
                       └──────────┘
```
````

## Core features (MVP)

1. [Feature 1] — [one-line description]
2. [Feature 2] — [one-line description]
3. [Feature 3] — [one-line description]

## Screen list

| Screen | Path  | Key elements                 |
| ------ | ----- | ---------------------------- |
| [name] | /path | [inputs, buttons, data, ...] |

## API endpoints

| Method | Path     | Description | Auth   |
| ------ | -------- | ----------- | ------ |
| POST   | /api/xxx | [desc]      | JWT    |
| GET    | /api/xxx | [desc]      | public |

## DB tables

| Table | Key columns        | Relations |
| ----- | ------------------ | --------- |
| users | id, email, name    | —         |
| posts | id, user_id, title | → users   |

## Non-functional requirements (NFR)

- **Performance**: [e.g.: p50 ≤200ms, p95 ≤500ms / 100 req/s concurrent]
- **Availability**: [e.g.: 99.5% (MVP), 99.9% (1.0)]
- **Security**: [e.g.: HTTPS-only, bcrypt, OWASP Top 10 check]
- **Data/regulation**: [e.g.: personal data GDPR/PIPA, payments PCI-DSS, medical HIPAA]
- **Accessibility**: [e.g.: WCAG 2.1 AA / keyboard navigation]
- **i18n**: [e.g.: ko, en — i18n-ready or ko-only]
- **Observability**: [e.g.: structured logs, Sentry, p95 alerts]

## Constraints

- **Budget**: [e.g.: within $100/month infra cost]
- **Schedule**: [e.g.: MVP 4 weeks, β 8 weeks]
- **Team**: [e.g.: 1 full-stack / Backend 2 + Frontend 1]
- **External dependencies**: [e.g.: Stripe not supported in Korea → use Toss]
- **Technical constraints**: [e.g.: OAuth integration with existing system required]

## Risks

| Risk       | Impact | Prob. | Mitigation                     |
| ---------- | ------ | ----- | ------------------------------ |
| [tech]     | High   | Med   | [PoC, identify backup library] |
| [schedule] | Med    | High  | [define scope-cut trigger]     |
| [external] | High   | Low   | [confirm SLA, fallback path]   |

## Assumptions

> Record the items that were "I don't know" in Phase 1 and the reasonable guesses.
> A broken assumption triggers a PRD re-review.

- [Assumption 1 + what happens if it's wrong]
- [Assumption 2]

## NOT in scope

- [Thing 1 excluded from MVP]
- [Thing 2 excluded from MVP]

```

### PRD writing rules

- **Be specific**: "user management" ✗ → "email+password login, profile editing" ✓
- **Be measurable**: "fast" ✗ → "API response within p95 500ms" ✓
- **State exclusions**: writing down what you won't do prevents scope creep
- **State assumptions**: pin "I don't know" areas as assumptions — verifiable later

---

## Phase 3: Task decomposition

Decompose the PRD into Marblo tasks.

### Decomposition principles

1. **Size**: 1 task = 1-2 hours of work. Split if larger, merge if smaller.
2. **Unit**: 1 API endpoint = 1 task is a good baseline.
3. **Dependencies**: only set depends_on where there is a real ordering. Independent ones run in parallel.
4. **scope**: pre-assign the files each task modifies → prevent Git conflicts.
5. **Verification**: state "completion criteria" for each task (tests pass, API response confirmed, etc.).

### Decomposition order (dependency graph)

```

Layer 1: Foundation (no dependencies)
├── DB schema/model design
├── Project initial setup
└── Independent utilities

Layer 2: Core API (depends on Layer 1)
├── API endpoint A
├── API endpoint B
└── Auth/permissions

Layer 3: Frontend (depends on Layer 2)
├── Screen A
├── Screen B
└── Shared components

Layer 4: Integration (depends on Layers 2, 3)
├── Integration tests
├── E2E tests
└── Docker/deployment

```

### Task card format

Organize each task in this format:

```

TASK-001: [title]
role: backend | frontend | test | devops
model: opus | sonnet | haiku # ← model recommendation (see guide below)
priority: 5(urgent) ~ 1(low)
depends_on: [TASK-NNN, ...]
scope: [file paths to modify]
completion criteria: [what "done" looks like — measurable]
expected deliverables: [list of files to create/modify]

```

### Model recommendation guide

Match the model to task complexity to optimize cost and speed.

| Complexity | Model | Suitable tasks                                                  |
| ------ | ------- | --------------------------------------------------------------- |
| High   | **opus**   | Architecture design, DB schema + migrations, complex algorithms, AI prompt engineering, security/auth implementation |
| Medium | **sonnet** | General API endpoints, business logic, React screens, integration tests, Docker/CI pipelines |
| Low    | **haiku**  | Simple CRUD, static UI components, docs/comments, env-var cleanup, small fixes |

> **Principle**: when in doubt, go one level up. opus costs more than sonnet, but it's cheaper than rework.

---

### Per-category task decomposition templates

Each category provides 18-22 standard tasks. Drop or merge some to fit your project's
characteristics. **Don't cut the lower bound of 18 too easily** — tests, observability, and docs
are always needed later.

#### A. SaaS web app (18-22 tasks)

```

=== Layer 1: Foundation ===
TASK-001: Project initial setup (devops, sonnet, p:5) — repo, lint, formatter, basic CI skeleton
TASK-002: DB schema design + migrations (backend, opus, p:5) — ERD, indexes, constraints
TASK-003: Env vars/secret management (devops, haiku, p:5) — .env.example, secrets policy

=== Layer 2: Auth & core API ===
TASK-004: Auth system (backend, opus, p:5, deps:002) — JWT/session, bcrypt, refresh
TASK-005: User profile API (backend, sonnet, p:4, deps:004) — GET/PATCH /me
TASK-006: Core domain API #1 (backend, sonnet, p:4, deps:002) — CRUD 1
TASK-007: Core domain API #2 (backend, sonnet, p:4, deps:002) — CRUD 2
TASK-008: Authorization/RBAC middleware (backend, opus, p:4, deps:004) — per-role guards

=== Layer 3: Payments & external integration ===
TASK-009: Payment integration (backend, opus, p:3, deps:004) — webhook, idempotency
TASK-010: Email/notification system (backend, sonnet, p:3, deps:004) — transactional mail

=== Layer 4: Frontend ===
TASK-011: Design system/shared components (frontend, sonnet, p:4, deps:001)
TASK-012: Login/signup UI (frontend, sonnet, p:4, deps:004)
TASK-013: Dashboard screen (frontend, sonnet, p:3, deps:006)
TASK-014: Core feature screen #1 (frontend, sonnet, p:3, deps:007)
TASK-015: Settings/profile screen (frontend, haiku, p:2, deps:005)
TASK-016: Payment/subscription management screen (frontend, sonnet, p:3, deps:009)

=== Layer 5: Quality & operations ===
TASK-017: Unit tests (test, sonnet, p:2, deps:008) — core API/business logic
TASK-018: E2E tests (test, sonnet, p:2, deps:014) — golden path
TASK-019: Observability (devops, sonnet, p:2, deps:008) — logs/metrics/Sentry
TASK-020: Docker + CI/CD (devops, sonnet, p:2, deps:017)
TASK-021: README/ops docs (devops, haiku, p:1, deps:020)
TASK-022: Security review (test, opus, p:2, deps:020) — OWASP checklist

```

#### B. Data pipeline (18-20 tasks)

```

=== Layer 1: Foundation ===
TASK-001: Project setup + environment (devops, sonnet, p:5)
TASK-002: Data model/schema (backend, opus, p:5) — raw / staged / mart
TASK-003: Secret/external credential management (devops, haiku, p:5)

=== Layer 2: Ingestion ===
TASK-004: Data source #1 connector (backend, sonnet, p:5, deps:003)
TASK-005: Data source #2 connector (backend, sonnet, p:5, deps:003)
TASK-006: Ingestion scheduler (devops, sonnet, p:4, deps:004) — cron / Airflow / Cloud Scheduler
TASK-007: rate-limit/retry/idempotency (backend, opus, p:4, deps:004) — retry/dedup

=== Layer 3: Transform & AI ===
TASK-008: Data cleaning/validation (backend, sonnet, p:4, deps:002) — Pydantic/Pandera
TASK-009: Data transform ETL (backend, sonnet, p:4, deps:008)
TASK-010: AI analysis/summary module (backend, opus, p:4, deps:009) — prompts, result validation
TASK-011: Result storage/cache (backend, sonnet, p:3, deps:010)

=== Layer 4: Output & observability ===
TASK-012: REST API for querying results (backend, sonnet, p:3, deps:011)
TASK-013: Dashboard UI (frontend, sonnet, p:3, deps:012)
TASK-014: Download/Export (CSV/JSON) (backend, haiku, p:2, deps:012)
TASK-015: Data quality monitoring (devops, sonnet, p:3, deps:008) — null/drift alerts

=== Layer 5: Quality & operations ===
TASK-016: Unit tests (test, sonnet, p:2, deps:010)
TASK-017: Integration tests (test, sonnet, p:2, deps:013)
TASK-018: Cost monitoring (devops, sonnet, p:2, deps:010) — AI/storage cost alerts
TASK-019: Docker + CI/CD (devops, sonnet, p:2, deps:016)
TASK-020: Ops docs/runbook (devops, haiku, p:1, deps:019)

```

#### C. Chrome extension/bot (18-20 tasks)

```

=== Layer 1: Foundation ===
TASK-001: Project setup + manifest v3 (devops, sonnet, p:5)
TASK-002: Build pipeline (vite/webpack) (devops, sonnet, p:5)
TASK-003: Secret/API key storage policy (backend, opus, p:5) — chrome.storage / safeStorage

=== Layer 2: Core logic ===
TASK-004: Core domain module (backend, opus, p:5, deps:001)
TASK-005: External API client (backend, sonnet, p:4, deps:003)
TASK-006: rate-limit/retry/cache (backend, sonnet, p:4, deps:005)
TASK-007: Background service worker (backend, opus, p:4, deps:004)
TASK-008: content script + page messaging (backend, sonnet, p:4, deps:007)

=== Layer 3: UI ===
TASK-009: Shared UI components (frontend, haiku, p:3, deps:002)
TASK-010: Popup UI (frontend, sonnet, p:4, deps:004)
TASK-011: Options/settings page (frontend, sonnet, p:3, deps:010)
TASK-012: Side panel/overlay (frontend, sonnet, p:3, deps:008)
TASK-013: First-run onboarding (frontend, haiku, p:2, deps:010)

=== Layer 4: Permissions & security ===
TASK-014: Permission request/verification flow (backend, opus, p:3, deps:007) — least-privilege
TASK-015: User consent/telemetry (backend, sonnet, p:2, deps:014)

=== Layer 5: Quality & operations ===
TASK-016: Unit tests (test, sonnet, p:2, deps:004)
TASK-017: Integration/E2E tests (test, sonnet, p:2, deps:012) — Playwright + extension load
TASK-018: Store listing assets (devops, haiku, p:2, deps:017) — screenshots, description, policy
TASK-019: CI auto build/packaging (devops, sonnet, p:2, deps:002)
TASK-020: User docs/FAQ (devops, haiku, p:1, deps:018)

```

> **Cases where task count shrinks**: no real operations (personal side project),
> no external payments/auth, single screen, etc. Even so, **don't drop tests/CI/docs**.

---

## Phase 4: Review + finalize

Show the plan to the user and get confirmation.

### Review checklist

**PRD completeness**
- [ ] Are all core features covered by tasks?
- [ ] Are the success metrics (KPI) measurable?
- [ ] Are the non-functional requirements (performance/security/regulation/accessibility/observability) stated?
- [ ] Are the constraints (budget/schedule/external dependencies) stated?
- [ ] Are risks + mitigations identified?
- [ ] Are assumptions stated, with a clear plan for when they break?
- [ ] Are the NOT-in-scope items clear?
- [ ] Does the system diagram show the core data flow?

**Task decomposition completeness**
- [ ] Is the task count within the proper range (18-22)? (state the reason if it deviates)
- [ ] Is the dependency order correct? (no circular dependencies?)
- [ ] Do task scopes not overlap?
- [ ] Are task sizes appropriate? (not too large/small? 1-2 hours each?)
- [ ] Does each task have a model recommendation (opus/sonnet/haiku)?
- [ ] Are test / CI/CD / docs tasks not missing?
- [ ] Are the completion criteria measurable?

### After finalizing

1. Save the PRD file in the project: `docs/PRD.md`
2. Tell the user:
   > "The plan is finalized. Run `/tf-start` to create tasks and have agents begin work."

> **Important**: do NOT run `create_tasks_bulk` at this step. Only build the plan.
> **Important**: the PRD MUST include the project name. `/tf-start` creates tasks under this name.
```
