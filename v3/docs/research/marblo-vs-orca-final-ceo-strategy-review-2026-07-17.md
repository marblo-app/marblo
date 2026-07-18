# Marblo vs Orca - Final CEO Strategy Review

- Date: 2026-07-17
- Ticket: `AtauYc1DTQhu2zn0Dq2f` / referenced CEO ticket `TN5CcJirTarUObKTc8cu`
- Frame: gstack `/plan-ceo-review`
- Scope: report only. No code or deployment changes.
- Positioning under review: **Marblo is the control plane for AI-native teams.**

## Inputs Checked

- Local Marblo docs:
  - `v3/docs/CONTROL-PLANE.md`
  - `v3/docs/PRICING-AND-COST-SAFETY-SPEC.md`
  - `v3/docs/RELEASE-3.0.17-NOTES.md`
- Orca research docs found in sibling Marblo worktrees because the requested files were absent from this checkout:
  - `../AkezywnUzmo2PkbB8fTG/v3/docs/research/orca-worktree-ux-benchmark.md`
  - `../Zte3JNPVSTQkzUyHY6Hh/v3/docs/research/orca-vs-marblo-review.md`
  - `../S3b6jx868jWE8brQ3v6Z/v3/docs/marblo-vs-orca-strategy-review-2026-07-17.md`
- Today's merged work:
  - #471 `RELEASE-3.0.17-NOTES`
  - #472 founder survey email campaign dry-run
  - #473 founder survey in-app prompt production-on
  - #474 founder survey beta offer duration clarification
  - #475 worktree hygiene: active/ongoing selectors + archive
  - #476 "view this worktree" from ticket -> file tree + agent focus
  - #477 opt-in Workspace shell: panes + browser + diff-A
  - #478 diff-A default for all users
- External verification, 2026-07-17:
  - GitHub `stablyai/orca`: 20.8k stars, 1.5k forks, MIT, latest `v1.4.144` on Jul 17, 2026.
  - Orca official site/docs: BYO agent/subscription, worktrees, terminal/browser/diff, GitHub/Linear, mobile companion, enterprise/security messaging.

## External Sources

- Orca GitHub: https://github.com/stablyai/orca
- Orca product site: https://www.onorca.dev/
- Orca docs: https://www.onorca.dev/docs
- Orca enterprise page: https://www.onorca.dev/enterprise

## Executive Judgment

**Q1. Is Marblo competitive enough after today's orchestrator-centered UX improvements?**

Judgment: **directionally yes, but not yet sufficient.** Today's UX work materially raises Marblo from "orchestrator board plus scattered IDE surfaces" toward a credible agent workbench:

- #475 reduces the 100+ worktree hygiene problem with active/ongoing defaults and archive state.
- #476 ties a ticket to the physical worktree and agent focus.
- #477 introduces an opt-in pane shell with orchestrator spine, agent dock, browser pane, and diff-A.
- #478 makes diff-A the default and routes inline diff comments back to the orchestrator path.

This validates the CEO thesis **up to the UX-amplification part**: an orchestrator-led flow becomes more valuable when ticket -> worktree -> diff -> agent feedback is one continuous path. The new diff-A default is especially important because it moves Marblo's differentiator from "we track tasks" toward "human review comments can re-enter the agentic loop."

But the thesis is weak if stated as "orchestrator + tickets + visibility is already enough to beat Orca." Orca has already commoditized much of the local ADE layer: per-task worktrees, panes/splits, terminals, browser/design mode, diff review, GitHub/Linear, CLI automation, mobile companion, open-source trust, and enterprise/security messaging. Marblo cannot win by being "Orca plus a board."

The stronger thesis is:

> Marblo can beat Orca for teams if it turns parallel agent output into reviewable, auditable, policy-gated merge decisions.

The control-plane wedge is not just visibility. It is **decision control**:

- per-task provenance bundle
- typed decision log
- PR/CI/merge/deploy event capture
- safe-merge gate
- orchestrator-authored risk summary
- human approval/reject/request-change recorded as an audit event

Today's changes are a good acceleration layer. They are not yet the moat.

**Q2. Can a paid Marblo win against free, high-rule, open-source Orca?**

Judgment: **paid is viable only if Marblo refuses to sell "personal agent IDE" as the paid product.** Against Orca, charging for a solo local worktree IDE is a losing default. Orca is free, MIT, self-hostable, high-velocity, trusted by GitHub visibility, and already markets local-first security and enterprise readiness.

Marblo's paid value must be the part teams cannot cheaply assemble from an OSS workbench:

- hosted team control plane
- shared task/provenance timeline across agents and humans
- safe merge/review cockpit
- org-level policy gates
- PR/CI/deploy/revert tracking
- audit logs and retention
- role-based access and approved-agent rollout
- support, onboarding, incident response, and compliance packet
- optional cloud sync for team visibility while preserving local/BYOK execution

That value can justify paid pricing for teams because it maps to manager/lead/CTO risk: "Can we safely let many agents touch production code and prove who approved what?" It is weaker for individuals, where Orca's free/open-source distribution advantage dominates.

## Where the CEO Thesis Is Right

1. **Orchestrator-centered flow is the right strategic axis.**
   Orca is strongest as an ADE/workbench. Marblo should not abandon that UX baseline, but the strategic center should remain the orchestrator as the actor that tracks state, summarizes risk, routes feedback, and prepares review decisions.

2. **Tickets/visibility are real assets if they become provenance, not just Kanban.**
   A task ID that links spec -> activity -> worktree -> diff -> comment -> PR -> merge SHA is a control-plane primitive. A task card that only shows status is not enough.

3. **Today's UX work amplifies the control plane.**
   #475-#478 reduce friction and make the control plane legible in the working surface. Diff-A default is the most strategic of the set because it creates the opening for structured review feedback.

4. **"Control plane for AI-native teams" is the right paid category.**
   It points at an organizational buyer and a risk/control budget, not at a solo developer's tool budget.

## Where the Thesis Is Weak

1. **Orca is not just a simple solo worktree app anymore.**
   Orca's public positioning includes orchestration, GitHub/Linear, hosted reviews, enterprise/security language, mobile companion, usage tracking, SSH/remote worktrees, and CLI automation. The gap is narrower than "Orca = local worktree, Marblo = team control plane."

2. **Visibility is not a moat.**
   Boards, status chips, agent lists, and diff viewers can be copied. The defensible layer is the structured decision/provenance system around merge and audit.

3. **Marblo still lacks the decisive paid proof.**
   The paid claim needs hard product evidence: REVIEW cockpit, typed decision events, CI/merge capture, audit export, org policy. Without these, pricing rests on aspiration.

4. **Open-source trust is a major adoption weapon.**
   Teams evaluating agent tools care about code privacy, local-first behavior, and inspectability. Orca's MIT/self-hostable status lowers procurement anxiety. Marblo must counter this directly, not hand-wave it.

## Paid vs Open Source: Direct Analysis

### Orca's Structural Advantages

- **Distribution:** free OSS removes purchase friction and spreads through developer sharing.
- **Trust:** MIT/open-source/self-hostable reduces concern around code access.
- **Speed:** public repo plus active releases creates visible momentum.
- **Solo UX:** worktree-first interface is already clean and easy to understand.
- **Narrative:** "ADE for agents" is simple and memorable.

### Marblo's Potential Paid Advantages

- **Team accountability:** every agent output tied to a ticket, human decision, and merge outcome.
- **Manager visibility:** leads can see work in progress without tailing terminals.
- **Safe merge:** review gates and risk summaries reduce production-change anxiety.
- **Audit/compliance:** decision log, retention, export, org policy, approved-agent controls.
- **Hosted collaboration:** shared state across machines/users, not just local panes.
- **Support:** team onboarding, workflow design, security docs, incident help.

### Is That Sufficient?

**Not yet, but it can be.** The value proposition is strong enough to justify paid team packaging after Marblo ships the review/audit spine. It is not strong enough if the product remains mostly a local IDE shell with an orchestrator panel.

The practical bar:

- A team lead must be able to open one Marblo task and answer: "What changed, why, who reviewed it, what tests/CI passed, what risk remains, and what exactly got merged?"
- That answer must be easier and more reliable in Marblo than in GitHub + Slack + terminal logs + Orca.

## Recommended Positioning

Do not position paid Marblo as:

> A better multi-agent IDE than Orca.

Position it as:

> The review, governance, and safe-merge control plane for teams running many coding agents.

Sharper product promise:

> Marblo turns parallel agent work into auditable merge decisions.

Homepage/product language should make "team decision and audit" first-order:

- "Review every AI-generated change with its task spec, agent trail, diff, tests, and decision history."
- "Route diff feedback back to agents, then approve, reject, or merge with an audit trail."
- "Know which agent changed what, why it changed, who approved it, and where it deployed."

## Pricing and Packaging Recommendation

### Packaging

1. **Free Personal / Open-Core Local**
   - 1 user
   - local projects
   - limited concurrent agents/worktrees
   - basic ticket board
   - local diff/review
   - BYOK/BYO subscription
   - no hosted team audit, no org policy

   Goal: reduce Orca's distribution advantage. This tier is acquisition, not monetization.

2. **Pro Individual**
   - for serious solo builders
   - more projects/agents
   - advanced local orchestrator flows
   - personal history/search
   - priority updates/support

   Keep this modest. Do not rely on this tier to beat Orca.

3. **Team**
   - per-seat pricing
   - hosted shared control plane
   - task provenance bundle
   - REVIEW cockpit
   - typed decision log
   - PR/CI/merge status capture
   - Slack/GitHub/Linear integrations
   - audit export

   This is the main business.

4. **Team Plus / Enterprise**
   - SSO/SAML
   - retention policies
   - approved agent/model policy
   - private deployment / self-host option
   - compliance/security packet
   - onboarding/support/SLA

   This directly counters Orca's OSS trust with enterprise-grade assurance.

### Price Direction

- Keep a **free personal tier**. Without it, Orca owns bottoms-up adoption.
- Keep individual Pro affordable and avoid making it the strategic battleground.
- Charge teams on the control-plane value:
  - Team: per-seat monthly, anchored around engineering collaboration value.
  - Team Plus: minimum team package for audit/compliance/integrations.
  - Enterprise: custom, with self-host/private deployment and support.

The current historical plan shape in `PRICING-AND-COST-SAFETY-SPEC.md` (Free / Pro / Team / Team Plus / Enterprise) is directionally right. The key adjustment is messaging: Pro should not imply "paid because more local agents"; Team should be "paid because safe team adoption of agents."

## Open-Core Strategy

Recommendation: **Yes, use open-core or at least a credible free personal tier.**

Pure closed paid desktop against Orca is structurally disadvantaged. Marblo needs a low-friction adoption path:

- Free local personal tier as default.
- Consider open-sourcing non-sensitive local protocol/client pieces only if it helps trust without giving away the hosted control-plane business.
- Keep hosted team graph, audit retention, org policy, integrations, compliance, and support paid.
- Make exportability strong enough that teams trust Marblo is not a black box.

Open-core can close the distribution gap if Marblo keeps the paid boundary around team state, governance, and hosted coordination.

## Adversarial Cross-Check / Refutation

This section intentionally attacks the optimistic conclusion.

1. **"Control plane" may be a category story, not a product need.**
   Small teams may prefer GitHub PRs and Slack because those already form the decision system. If Marblo does not make the review process obviously faster, "audit" alone may feel like overhead.

2. **Orca can move upmarket.**
   Orca already has enterprise pages, self-hosting claims, GitHub/Linear, audit-trail language, and massive OSS trust. It can add hosted team dashboards faster than Marblo can polish a full ADE.

3. **Diff comment -> orchestrator is not automatically unique.**
   Orca has annotate-AI-diff style loops. Marblo must make comments become structured task decisions and orchestrated follow-up work, not just another "send comment to agent" feature.

4. **Paid support/compliance may not matter early.**
   AI-native teams often start with developer-led tool adoption. If individual developers prefer Orca, Marblo may never reach the budget holder.

5. **Free tier can cannibalize paid if boundary is blurry.**
   If free personal includes enough local control-plane history, users may not upgrade. The Team boundary must be shared audit, org policy, retention, integrations, and admin controls.

6. **Today's UX fixes are necessary but not category-winning.**
   They close a usability gap. They do not yet prove that Marblo can own the merge decision.

Refuted conclusion:

> "Marblo already has enough competitive strength after today's UX work" is too optimistic.

Defensible conclusion:

> "Marblo has a credible path if it ships REVIEW/audit control-plane value quickly and uses free/open-core distribution to avoid losing the developer funnel."

## Risks

1. **Me-too ADE risk:** chasing Orca pane/worktree features without making review/provenance central.
2. **Distribution risk:** paid-only desktop loses bottoms-up adoption.
3. **Trust risk:** closed/hosted product must over-explain code privacy, BYOK, telemetry, and audit storage.
4. **Roadmap risk:** safe-merge/control-plane features are harder than UI polish and require integrations.
5. **Buyer risk:** individual developers choose tools; team leads pay for governance. Marblo must serve both without muddling the product.

## Follow-Up Actions / Ticketable Work

1. **REVIEW Cockpit Lite**
   - Build a task-level read-only review surface: spec, agent activity, worktree diff, test status, risk summary, decision.
   - Acceptance: one REVIEW task is understandable without leaving Marblo.

2. **Typed Decision Log v1**
   - Add structured decisions: approve, request changes, reject, defer.
   - Acceptance: decision events are not activity-string parsing and appear in provenance.

3. **PR/CI/Merge Event Capture**
   - Connect GitHub PR URL, CI state, merge SHA, deploy/revert status to task timeline.
   - Acceptance: provenance bundle reaches actual merge/deploy outcome.

4. **Safe-Merge Gate v1**
   - Define policy checks: tests, unresolved comments, risk summary, required human decision.
   - Acceptance: Marblo can block or warn before merge with explicit reasons.

5. **Team Audit Export**
   - Export task provenance and decisions as CSV/JSON/Markdown.
   - Acceptance: team lead can hand the record to security/compliance or postmortem.

6. **Free Personal Tier Boundary**
   - Product/pricing ticket to define what is free vs paid.
   - Acceptance: free competes with Orca for adoption; paid starts at shared team control plane.

7. **Security/Trust Packet**
   - Document local-first/BYOK behavior, telemetry policy, code storage policy, self-host/private deployment plan.
   - Acceptance: buyer can answer "does Marblo see our code/prompts?" without a call.

8. **Positioning Rewrite**
   - Replace "multi-agent orchestration" lead copy with "auditable merge decisions for agent teams."
   - Acceptance: homepage/pricing/app onboarding make Team value distinct from Orca.

## Final Answer

**Q1:** Marblo is not yet "sufficiently competitive" in the sense of already beating Orca. It is now directionally credible. Today's UX work validates the CEO thesis that orchestrator-led tickets/visibility become much more powerful when connected to worktree switching, hygiene, diff review, and feedback routing. But the durable win is not UX parity. The win is owning the team review/audit/safe-merge decision layer.

**Q2:** Paid Marblo can win only by making the paid unit the team control plane, not the personal worktree IDE. Orca's free OSS distribution and trust advantage are too strong for a closed paid solo tool. A free personal or open-core entry plus paid Team/Enterprise for hosted provenance, safe merge, audit, policy, integrations, support, and compliance is the recommended strategy.

**승부수:** Ship the REVIEW/audit spine before expanding further into generic ADE polish. Make Marblo the place where teams decide whether AI-generated code is safe to merge.
