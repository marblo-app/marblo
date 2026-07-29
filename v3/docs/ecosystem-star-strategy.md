# Marblo Ecosystem Star Strategy — CEO Review

Reviewed: `marblo-app/marblo` PR #3 (`feat/ecosystem-monorepo-foundation`), ROADMAP.md + README §Ecosystem & Store + seed catalog.
Method: gstack `/plan-ceo-review`, HOLD SCOPE mode. Outside voice: Codex (independent, read-only).
Date: 2026-07-29.

---

## Verdict: **REVISE**

Not GO — the objective function is wrong and the `community` tier promises safety the schema does not enforce.
Not STOP — the scaffolding is cheap, correct, and reusable. The defect is framing, not artifact.

Merge the structure. Change what it is for.

---

## 1. The core finding: the plan mistakes the star engine

There are three distinct star engines in this space, with different physics. All numbers verified via GitHub API on 2026-07-29.

**Engine A — the product IS the repo.**

| Repo                   | Stars      | Created     |
| ---------------------- | ---------- | ----------- |
| anomalyco/opencode     | 190,637    | 2025-04     |
| anthropics/claude-code | 139,444    | 2025-02     |
| openai/codex           | 102,223    | 2025-04     |
| zed-industries/zed     | 87,670     | 2021-02     |
| **stablyai/orca**      | **31,976** | **2026-03** |

Orca is 341 MB, 81 MB of TypeScript, plus Swift and Kotlin mobile clients. The entire ADE is MIT. 32k stars in ~4.5 months. Access requires open-sourcing the product.

**Engine B — harness-neutral content, zero product install.**

| Repo                                    | Stars   | Created |
| --------------------------------------- | ------- | ------- |
| anthropics/skills                       | 164,882 | 2025-09 |
| punkpeye/awesome-mcp-servers            | 91,516  | 2024-11 |
| modelcontextprotocol/servers            | 89,005  | 2024-11 |
| hesreallyhim/awesome-claude-code        | 51,178  | 2025-04 |
| wshobson/agents                         | 38,342  | 2025-07 |
| davila7/claude-code-templates           | 29,962  | 2025-07 |
| VoltAgent/awesome-claude-code-subagents | 23,815  | 2025-07 |

All reached 24k–165k in under a year. All ship the **exact content types PR #3 picked**: skills, agents, MCP servers, workflows, prompt/knowledge packs. None require a vendor app.

**Engine C — vendor store attached to a closed product.**

| Repo                         | Stars  | Forks | Age   | Product repo                |
| ---------------------------- | ------ | ----- | ----- | --------------------------- |
| obsidianmd/obsidian-releases | 20,251 | 7,467 | 6 yrs | (also the download host)    |
| raycast/extensions           | 7,644  | 6,522 | 5 yrs | —                           |
| warpdotdev/workflows         | 833    | 166   | 4 yrs | **warpdotdev/warp: 63,747** |
| logseq/marketplace           | 355    | 450   | 5 yrs | —                           |
| smithery-ai/registry         | 0      | 4     | 7 mo  | —                           |

**PR #3 builds Engine C while naming Engine A as the benchmark.**

Engine C's ceiling, at world-class execution (Raycast, with millions of existing app users), is 7.6k over five years. Warp is the closest structural analogue: the store repo has **833 stars against the product's 63,747** — a 77x gap. Forks exceeding stars at Raycast and Logseq is the signature of a _contribution_ repo, not a star repo: people fork to submit, they don't star to follow.

Engine C is also **derivative** — it is driven by the product's installed base. `marblo-app/marblo` today: **1 star, 0 issues, 4 page views / 1 unique visitor in 14 days.** Warp's store got 833 stars _with_ 63k-star distribution behind it. There is nothing for Marblo's store to derive from yet.

**The good news: Engine B is wide open and Marblo can access it at near-zero incremental cost.** The plan already picked the right nouns. It attached the wrong verb — "install into Marblo" instead of "works right now with the CLI you already have."

---

## 2. Orca positioning is incoherent as written

ROADMAP §2 cites "Orca-style worktree/agent tooling" as the peer to match on stars. The two asks are not comparable:

- **Orca:** "Here is the whole ADE. Read it, fork it, run it."
- **PR #3:** "Here is a registry for an orchestrator you cannot inspect. Please contribute content that makes our closed app more valuable."

The second reads to an open-source audience as unpaid channel development. Orca did not earn 32k stars by having a good folder structure; it earned them by giving away 81 MB of product. Marblo cannot win that comparison by construction and should stop inviting it.

**Correct differentiation — fight on the axis where the closed core is a feature, not a liability:**

> **Orca gives you a better cockpit. Marblo gives you the flight controller.**
>
> Orca is where one developer drives a fleet. Marblo is where a fleet drives itself and a team can prove what it did — live orchestration, worktree-per-ticket isolation, cost attribution per agent and model, and an append-only record of every merge decision.
>
> Keep your IDE. Marblo is the layer on top.

And state the open/closed boundary out loud in the README rather than leaving it to be discovered:

> The orchestration engine is our product, and it is closed. Everything the agents _consume_ — skills, tools, workflows, knowledge — is open, portable, and works whether or not you ever install Marblo.

Developers forgive a closed core. They punish a closed core that presents itself as an open ecosystem. Naming the line is what separates the two.

---

## 3. The seed content cannot pull a star

`skills/code-review/SKILL.md` is a well-written 32-line generic review prompt. It competes directly against anthropics/skills (164,882 stars) and half a dozen 20k+ awesome lists that already carry twenty code-review prompts. Nobody stars a generic prompt in 2026.

`knowledge/curated-llm-resources` is 12 curated links — **all 12 verified resolving 200**, so the PR's verification claim holds, and the pack is honest work. It is also substitutable by any of a dozen existing 20k-star lists, and it points at `melocream/awesome-llm-study`, which has 1 star. The repo's most differentiated _slot_ is filled with its least differentiated _content_.

**What Marblo has that no one else on GitHub has:** operational knowledge of running a heterogeneous agent fleet in production. Verified, hard-won, and currently sitting in a private notes directory:

- Which vendor subscriptions open an Anthropic-compatible endpoint versus which need a native harness — and the finding that "the vendor ships its own CLI" is _not_ the discriminator.
- Per-harness session/resume contracts, and which flag combinations kill the process outright.
- Why a spawned agent reports "working" forever (status derived from PTY byte flow).
- Where cost attribution actually breaks when adding a harness (the spawn kickoff trigger, not the parser).
- Worktree-per-ticket hygiene, merge close-out discipline, watchdog false-positive signatures.

Nobody else has run six-plus agent CLIs in parallel against real tickets for months. That is a Knowledge Pack with no substitute, it is already written down internally, and it is the kind of artifact that gets posted to Hacker News. The `knowledge/` category the plan already created is exactly the right home for it.

---

## 4. Top risks

### R1 — CRITICAL: the `community` tier's security story is not enforced by the schema

SECURITY.md states: _"Permissions are declared. Each manifest lists the capabilities it requests… The app surfaces these before install."_

Verified against `registry/manifest.schema.json`:

```
required: [schema_version, id, name, type, version, description, publisher, license]
```

- **`permissions` is optional.** A `community` manifest declaring zero permissions passes validation. The seed's own knowledge pack omits it.
- **`source` is only conditionally required for `bundle`.** Nothing forces a non-`official` item to declare `source.repository` + `source.ref`. CONTRIBUTING.md promises _"CI checks: schema validity, the pinned source resolves"_ — with `source` absent, there is nothing to resolve and the schema will not catch it.
- **No CI exists yet** (Phase 1). Today every one of those guarantees is manual.

Compounding this: **an item at `github.com/marblo-app/marblo` reads as Marblo-endorsed regardless of a `tier: community` badge.** The tier is a string in a YAML file; the URL is the brand. Raycast solves this with mandatory human review of _every_ extension before merge — 6,522 forks against 7,644 stars is the visible cost of that review load. PR #3 inverts it: merge first as `community`, review later. The merge _is_ the trust event.

**Mitigation:**

1. Make `permissions` required for every item whose `type` can execute (`skill`, `agent`, `workflow`, `mcp-server`, `harness`).
2. Add a schema rule: `publisher.tier != official` ⟹ `source` required, `source.ref` matching a tag/SHA pattern, never a branch.
3. Until Phase 1 ships with a permission prompt and sandboxing, accept community submissions as **listings, not installs** — discoverable, execution disabled by default.
4. Require human review before merge for any executable item, regardless of tier.

### R2 — HIGH: no revocation path

Installs pin a tag or SHA, which is correct. But nothing in the plan describes what happens when a merged item turns out to be malicious, or when an upstream repo is compromised after review. There is no `revoked` state in the schema, no advisory feed, and no app-side check on launch. npm and Raycast both have this because both learned it the hard way.

**Mitigation:** add a `status: active | deprecated | revoked` field plus a `SECURITY-ADVISORIES.md` the app polls; on launch, warn or disable installed items that have been revoked.

### R3 — HIGH: sequencing is backwards

Phase 1 (app consumes the registry) is unbuilt. `docs/harness-store/README.md` admits it: _"Until the in-app UI ships, items can be installed manually from their folder."_ So the repo is being optimized for contributor throughput — CODEOWNERS, issue template, PR template, tier promotion policy — before it has readers. That governance is genuinely cheap and worth keeping, but it is not what is blocking. A store with no installer, 1 star, and 1 unique visitor in 14 days needs _readers and content_, not contribution flow.

**Mitigation:** ship the installer and 5–10 genuinely useful first-party assets before opening community submissions.

### R4 — MEDIUM: "Store installs per item" is unmeasurable as designed

ROADMAP §7 lists it as a success signal. No telemetry design exists for it, and Marblo's telemetry is BigQuery-based and privacy-gated. Measuring per-item installs requires app-side instrumentation that is nowhere in scope. A success metric that cannot be read is a metric that will be replaced by star count — which is the proxy trap this whole review is about.

**Mitigation:** either scope the instrumentation into Phase 1 or drop the signal and pick one that is observable today (repo traffic uniques, clone count, standalone-asset installs via a documented one-liner).

### R5 — MEDIUM: license metadata is unverified

MIT on the registry does not relicense external code, and manifest-only referencing is the correct conservative structure — the plan got that right. Two gaps remain: `license` is a free-form string with no SPDX validation, so `license: MIT` is never checked against upstream's actual license; and copyleft items (AGPL MCP servers exist in the wild) create obligations that depend on how the app bundles or launches them.

**Mitigation:** validate `license` against an SPDX identifier list in CI, cross-check it against the upstream repo's declared license, display it before install, and write a one-paragraph copyleft policy into CONTRIBUTING.md.

---

## 5. The two levers that actually pull

### Lever 1 — "Runs without Marblo" (the big one)

Every first-party asset ships as a plain, standards-native artifact:

- `SKILL.md` that drops straight into `~/.claude/skills/`
- MCP manifests that work in any MCP client
- Agent definitions in the formats Claude Code and Codex already read

`marblo.yaml` becomes **additive Store metadata, not a container.** The README's first section becomes a 30-second copy-paste that works with the reader's existing CLI, with "and it installs in one click in Marblo" as the follow-on, not the gate.

This is the difference between the 833-star lane and the 30,000-star lane. Cost: a README rewrite plus a per-item install snippet. The seed items are _already_ plain markdown skills and standard MCP manifests — `skills/code-review/SKILL.md` works today if you drop it in `~/.claude/skills/`, and nothing in the repo tells anyone that.

It also helps the product. Everyone who installs a standalone asset is a qualified lead who already has the multi-agent problem.

### Lever 2 — The Fleet Operations Knowledge Pack (the non-substitutable asset)

Publish what running a heterogeneous fleet actually taught: the vendor-subscription compatibility matrix (which CLIs open Anthropic-compatible endpoints, which need a native harness, with the env vars), per-harness session and resume contracts, cost-attribution wiring, worktree-per-ticket hygiene, and the failure signatures with their real root causes.

No competitor can clone this, because it is a byproduct of months of production fleet operation rather than a writing exercise. It is already documented internally. Pair it with the lecture material for a "how to actually run a fleet" curriculum.

Everything else in the roadmap — bundles, CLI, SDK, community moderation tooling — is downstream of these two and should wait.

---

## 6. Cross-model check

Codex reviewed the same strategy independently, read-only, with no access to this analysis.

**Agreement (high confidence):** star engine misidentified; Orca positioning incoherent; developers do penalize thin-public-shell-over-closed-core; `community` tier is a supply-chain incident waiting to happen; sequencing backwards; the fix is "make the repo useful without Marblo installed."

Codex's exact framing: _"Orca got stars because the product is the repo. Marblo is proposing to open the packaging around a closed product… That is not a peer strategy. It is a vendor catalog strategy."_ And: _"The likely outcome is closer to Warp workflows / Logseq marketplace than Orca."_

**Divergence — worth the founder's attention:** Codex concludes _"The current PR is premature… it creates the appearance of an ecosystem before there is distribution, trust, or demand,"_ i.e. closer to STOP.

I land on REVISE instead. PR #3 is 866 lines of docs and manifests with no runtime surface; the registry schema, the no-vendoring rule, and the pinned-source discipline are correct work that will be needed under any strategy. Discarding it buys nothing and costs the structure. The failure is the objective function and the community-execute promise — both fixable in the same PR. The one place Codex's stronger position should win outright is the `community` tier: do not open executable community submissions now.

Codex also floats open-core as the only way to genuinely contest Orca's category. That is a founder-level call well outside this review's scope, but it is the honest strategic frame and it should not be dismissed silently.

---

## 7. Concrete revisions to PR #3

| #   | Change                                                                                                            | File                                       | Effort |
| --- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------ | ------ |
| 1   | Drop Orca-parity as the star benchmark; replace §2's peer set with the Engine B content repos                     | ROADMAP.md §2                              | S      |
| 2   | Reframe the north star: assets run standalone in Claude Code / Codex; Marblo install is the upgrade, not the gate | ROADMAP.md §1, README §Ecosystem           | S      |
| 3   | Add a standalone install snippet to every first-party item                                                        | `skills/`, `agents/`, `workflows/` READMEs | S      |
| 4   | State the open/closed boundary explicitly in the README                                                           | README.md                                  | S      |
| 5   | Require `permissions` for all executable types; require `source` when `tier != official`                          | `registry/manifest.schema.json`            | S      |
| 6   | Add `status: active \| deprecated \| revoked` + advisory file                                                     | schema + `SECURITY-ADVISORIES.md`          | S      |
| 7   | Community tier = listing only until Phase 1 ships permissions + review                                            | CONTRIBUTING.md, SECURITY.md, ROADMAP §4   | S      |
| 8   | Replace the generic code-review skill as the flagship with the Fleet Operations Knowledge Pack                    | `knowledge/`                               | M      |
| 9   | Make ROADMAP §7's success signals observable, or replace them                                                     | ROADMAP.md §7                              | S      |
| 10  | Validate `license` against SPDX in CI; add a copyleft policy paragraph                                            | CONTRIBUTING.md + Phase 1 CI               | S      |

Items 1–7 and 9–10 are documentation and schema edits — one focused pass. Item 8 is the real work and the real payoff.

---

## 8. NOT in scope / deferred

- **Open-core (open-sourcing part of the orchestrator).** Raised by Codex as the only route to genuine Orca-category parity. Founder-level decision, outside a plan review.
- **Bundles, `marblo-cli`, `extension-sdk`** (ROADMAP Phase 2). Downstream of Levers 1 and 2; premature until the registry has readers.
- **Splitting into `marblo-skills` / `marblo-mcp`** (Phase 3). Correctly deferred by the plan already.
- **Store UI design review.** Belongs in `/plan-design-review` once Phase 1 has a surface.
- **Registry scale/performance.** At single-digit items this is not a real concern for years.

## 9. What already exists and should be kept

- `registry/manifest.schema.json` — sound structure; needs the two conditional-requirement rules from R1, not a rewrite.
- The **no-vendoring / pinned-manifest** rule — correct, and correctly reasoned in CONTRIBUTING.md. Keep verbatim under any strategy.
- Tier vocabulary (`official` / `verified` / `community`) — right model, wrong enforcement timing.
- Governance scaffolding (CODEOWNERS, issue and PR templates, SECURITY.md) — cheap, correct, keep.
- The 12 curated links in the knowledge pack — verified resolving, honest work; demote from flagship, do not delete.

## 10. Dream-state delta

```
  TODAY                          PR #3 AS WRITTEN              12-MONTH IDEAL
  1 star, 1 unique/14d     -->   Engine C vendor catalog  -->  Engine B content repo
  no installer                   ceiling ~800-7k / 4-5 yr      that also feeds the Store
  generic seed content           unenforced trust model        non-substitutable fleet-ops
                                                               knowledge + real installs
```

PR #3 as written moves toward the Warp-workflows outcome: 833 stars in four years, with less distribution behind it than Warp had. With Levers 1 and 2 applied, the same files and the same repo point at the lane where seven comparable repos reached 24k–165k stars in under a year.
