# Problem-first Marblo demo

This document designs the next public demo around the question reviewers actually
left us with: not "what is Marblo?", but "why is this materially better than a
single coding agent?"

The answer should be shown as recoverable failure modes, not feature lists. The
demo starts with work going wrong in ways we have actually hit or documented, then
shows how Marblo changes the operating model: isolated worktrees, dependency-aware
dispatch, review gates, safe merge, live replanning, and an audit timeline that
lets a human prove what happened afterwards.

## Non-negotiables

- Do not claim Marblo is faster than a single agent from telemetry alone. The hard
  parts note explicitly says fleet performance is not measured enough to claim.
- Do not fake model output, merge conflicts, or audit rows. Every scene below must
  be reproducible in a local demo repo.
- Spend most of the time on problem and resolution scenes. The board is only the
  display surface; the product is the set of refusals, boundaries, and traces that
  keep parallel agent work from losing data.
- Show the human control point. Marblo should not auto-approve risky work; it should
  make the review and merge decision visible and safer.

## Demo thesis

Claude Code alone is excellent for one focused stream of work. The gap appears
when one developer tries to run several streams against one repository at the same
time.

Marblo is the operating layer for that moment:

1. It splits work into explicit tickets with owners, status, scope, and activity.
2. It runs independent work in parallel without sharing one fragile checkout.
3. It serializes or replans dependent work instead of pretending every task is
   parallel.
4. It funnels output through REVIEW and safe merge instead of equating "agent said
   done" with finished.
5. It leaves an audit trail of who did what, what was held, and why.

## Scenario A: Claude Code alone vs Marblo

### The job

Build a small "usage insights" feature in a demo repository:

- backend: add a usage summary endpoint
- frontend: add a daily usage chart
- docs: update a release note and screenshot checklist
- tests: cover zero-filled days and telemetry-off intervals

Use a tiny repo where these files are intentionally close enough to collide:

```text
src/api/usage.ts
src/components/UsageChart.tsx
src/types/usage.ts
docs/release-notes.md
tests/usage-summary.test.ts
```

### Act 1: One agent, one checkout

Goal: make the audience feel the coordination cost before Marblo appears.

Storyboard:

1. Start in a single terminal with Claude Code in one repo checkout.
2. Ask it to implement the whole feature.
3. While it is working, introduce a second manual or agent session in the same
   checkout to "quickly fix the chart copy" or "switch to main and inspect tests."
4. Show why the workspace is now fragile:
   - one branch and one working tree are shared by all sessions;
   - uncommitted edits can be overwritten, stashed, or mixed with unrelated work;
   - the operator must remember which files belong to which subtask;
   - review is one large diff with hidden discarded attempts.
5. Do not manufacture data loss. If Git blocks the checkout, say that this is the
   benign version of the same problem: the shared checkout has become a lock.

Narration:

> Claude Code is not failing here. The operating model is failing. A single agent
> can do one stream very well, but a single checkout can only hold one branch, one
> index, and one working directory. Once we try to run several streams, every
> "quick" action becomes a coordination risk.

Evidence to capture:

- `git status --short` showing unrelated files mixed together.
- A large diff where backend, frontend, docs, and tests are interleaved.
- Optional safe reproduction: two branches edit the same line in
  `src/types/usage.ts`, then one session cannot switch branches without resolving
  or stashing.

### Act 2: Same job in Marblo

Goal: show the same work shape, but with control surfaces.

Storyboard:

1. Give the orchestrator one product request.
2. Marblo creates four tickets with explicit roles and dependencies:
   - backend usage endpoint
   - frontend chart, depends on backend type contract
   - tests for zero-fill and telemetry-off labels
   - docs/release note
3. Spawn agents. Backend, docs, and tests can start when independent. Frontend waits
   until the backend contract is stable.
4. Open Lanes/Worktrees:
   - each active agent has its own worktree and branch;
   - dirty state is local to that agent;
   - one failed experiment can be deleted without touching other work.
5. Open Board/Activity:
   - each ticket records what the agent attempted, changed, and verified;
   - PM feedback lands on the ticket instead of disappearing into a chat scroll.
6. Move completed work to REVIEW, inspect focused diffs, then merge only accepted
   work.

Narration:

> The visible board is not the moat. The useful part is that the board is true:
> every card maps to an isolated worktree, a bounded diff, a review decision, and a
> trace of why the system did what it did.

Evidence to capture:

- Board with four tickets and dependency arrows/status.
- Worktree tab with separate branches per ticket.
- Activity timeline showing claim, implementation summary, verification, PM
  feedback, and review submission.
- Diff for one ticket that is small enough to review.

### Comparison frame

Use this table as the voiceover frame, not as a static feature grid.

| Moment | Claude Code alone | Marblo team |
| --- | --- | --- |
| Split work | Human keeps the plan in their head or chat | Tickets carry scope, owner, status, and dependencies |
| Parallelism | More sessions share one checkout unless manually isolated | Each risky stream gets a separate worktree and branch |
| Collision | Git state, uncommitted edits, and branch switches become shared risk | Dirty state and failed experiments are isolated per agent |
| Review | One combined diff, often after the fact | REVIEW contains focused diffs with ticket context |
| Merge | Human runs Git commands and must know safe cases | Safe merge refuses dirty/diverged cases before changing main |
| Closeout | "Merged" is easy to confuse with "done" | Hold signals keep follow-up work visible after merge |
| Provenance | Terminal scroll and memory | Activity plus audit timeline shows who did what and why |

## Scenario B: 5-agent end-to-end

### The job

Launch a small feature slice called "Project health pulse":

- backend agent: aggregate task status, stale worktrees, and review queue counts
- frontend agent: add the dashboard panel
- test agent: add unit and Playwright coverage
- docs agent: update operator docs and release note
- merge/review agent: inspect diffs, resolve conflicts, and prepare integration

### Opening problem scene

Start with the failure, before showing Marblo.

Create a deliberately messy five-stream plan in a local demo repo:

1. Backend and frontend both edit `src/types/projectHealth.ts`.
2. Frontend starts before backend finalizes the response shape.
3. Test agent assumes the first frontend label, while PM feedback changes it.
4. Docs agent marks the feature shipped after the PR merges.
5. Merge agent finds a clean squash possible, but a follow-up migration/backfill
   still has not run.

Narration:

> Five agents do not automatically mean a five-times faster project. Without an
> operating layer, they create five ways for the project to become ambiguous:
> conflicting shared types, stale assumptions, merged-but-not-done tickets, hidden
> replanning, and no durable record of why the final state is safe.

### Resolution sequence

1. Worktree isolation appears first.
   - Backend and frontend edit their own branches.
   - A shared type conflict is contained outside `main`.
   - The resolver can compare two branches without a dirty human checkout.

2. Agent dependency appears second.
   - Frontend depends on the backend response contract.
   - Tests depend on the frontend label or stable accessible name.
   - Docs can run in parallel because it only references the user-visible behavior.

3. Live replanning appears third.
   - PM feedback changes the telemetry-off copy.
   - Marblo records the feedback on the frontend/test tickets.
   - The test ticket is reopened or adjusted instead of silently drifting.

4. Safe merge appears fourth.
   - Merge refuses if main is dirty.
   - Merge distinguishes conflict from "could not start safely."
   - Squash lands only after review, keeping main clean.

5. Merged-is-not-done appears last.
   - The PR is merged, but a release checklist/backfill/approval remains.
   - The ticket stays REVIEW or creates a follow-up instead of auto-closing.
   - The audit timeline proves the hold was intentional.

### Storyboard

| Time | Screen | What happens | Point |
| --- | --- | --- | --- |
| 0:00 | Terminal + Git status | Show mixed edits in one checkout from a naive five-agent attempt | Parallel agents without isolation create shared-state risk |
| 0:45 | Marblo Board | One natural-language request becomes five bounded tickets | The plan becomes operational, not conversational |
| 1:30 | Dependency graph | Frontend/test wait on backend contract while docs starts | Parallel where possible, serial where necessary |
| 2:15 | Lanes | Agents work in separate rows with attached terminals | The operator can inspect live work without stealing context |
| 3:00 | Worktrees | Backend/frontend have separate branches; conflict is contained | Main remains clean while agents disagree |
| 3:45 | Activity | PM feedback changes copy; affected tickets record it | Replanning is visible and attached to work |
| 4:30 | Review diff | A focused diff is reviewed against one ticket | Human approval remains the gate |
| 5:15 | Safe merge | Dirty/diverged/conflict cases are refused or routed | Merge safety is a set of refusals, not a button |
| 6:00 | Audit timeline | Show merged event plus held follow-up | Merged and done are different facts |
| 6:45 | Closing board | Accepted tickets in DONE, follow-up still visible | The system preserves outstanding work instead of hiding it |

## First deliverable: README/docs problem-first section

The README should point readers to the demo thesis before the architecture diagram:

> If Marblo looks like "just a board for agents", start here. The demo begins with
> the failure modes: shared checkouts lose or mix work, five agents create
> dependency and merge ambiguity, and a merged PR can still leave work unfinished.
> Then it shows the Marblo surfaces that answer those failures: worktree isolation,
> agent dependencies, live replanning, review gates, safe merge, and the AI audit
> timeline.

## Asciinema/GIF script seed

This is a later production asset, but the commands below keep the demo honest.
Use a throwaway demo repo, not the real app repo.

```bash
# setup
git init marblo-demo-conflict
cd marblo-demo-conflict
mkdir -p src/api src/components src/types docs tests
printf 'export interface UsagePoint { date: string; count: number };\n' > src/types/usage.ts
printf 'export function summary() { return [] }\n' > src/api/usage.ts
printf 'export function UsageChart() { return null }\n' > src/components/UsageChart.tsx
printf '# Release notes\n' > docs/release-notes.md
printf 'test.todo("usage summary")\n' > tests/usage-summary.test.ts
git add .
git commit -m "seed usage demo"

# naive shared-checkout collision
git switch -c agent-backend
printf 'export interface UsagePoint { date: string; count: number; source: "api" }\n' > src/types/usage.ts
git diff -- src/types/usage.ts

# second stream wants a different contract in the same checkout
git switch -c agent-frontend main
printf 'export interface UsagePoint { date: string; total: number; label: string }\n' > src/types/usage.ts
git diff -- src/types/usage.ts
```

For the Marblo side, record the same feature request through the app and capture:

- ticket creation and dependencies;
- separate worktree paths/branches;
- one PM feedback entry;
- one REVIEW diff;
- one safe merge or refused merge;
- one follow-up that remains visible after merge.

## Claims checklist

Use this before recording or publishing.

- [ ] Every shown failure was reproduced locally.
- [ ] Any rejected merge is a real refusal path, not a staged alert.
- [ ] Any "done" ticket has a visible review/acceptance path.
- [ ] Any "not done after merge" ticket has a concrete remaining action.
- [ ] The script avoids unsupported claims about measured speed or model quality.
- [ ] The closing line is about controllable parallelism, not generic productivity.

