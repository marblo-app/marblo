# Changelog

All notable changes to the Marblo ecosystem repo are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the registry manifest schema follows SemVer via its `schema_version`.

## [Unreleased]

### Added

- **Ecosystem monorepo foundation (Phase 0).** Repository structure for a public ecosystem of harness-neutral assets.
- **`knowledge/fleet-operations` — the flagship Knowledge Pack.** Production knowledge from running a heterogeneous fleet of agent CLIs: vendor integration shapes and the discriminator that actually decides them, env-swap wiring hazards, per-harness session/resume contracts (version-stamped), why PTY output is the wrong agent-liveness signal in both directions, where cost attribution silently breaks, worktree-per-ticket hygiene, and watchdog false-positive checks. Measured, not inferred.
- **Standalone install snippets on every portable first-party item.** Each asset now documents how to use it with the CLI you already run — Claude Code, Codex — with no Marblo install.
- `agents/reviewer/AGENT.md` — the reviewer as a real, portable subagent definition, so the agent item is genuinely installable standalone rather than manifest-only.
- `SECURITY-ADVISORIES.md` — the revocation record and process. Advisories are public and permanent.
- `registry/manifest.schema.json` — the `marblo.yaml` manifest schema (`schema_version: 1`) covering skills, MCP servers, agents, workflows, knowledge packs, harnesses, and bundles.
- Governance: `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, `LICENSE` (MIT).
- Docs skeleton under `docs/` (getting-started, concepts, harness-store, orchestration, troubleshooting).
- Seed items, one per category:
  - Skill — `code-review` (first-party).
  - MCP servers — `marblo-control` (official, bundled) and `github` (verified, manifest-only reference).
  - Agent — `reviewer`.
  - Workflow — `review-and-merge` (Marblo-specific, and labeled as such).
  - Knowledge packs — `fleet-operations` (flagship) and `curated-llm-resources` (starter pack).

### Changed

- **Reframed the repo around standalone use.** Assets are plain, standards-native files that run in the reader's existing CLI; `marblo.yaml` is additive Store metadata, not a container. Installing Marblo is a one-click upgrade, not a gate.
- **Stated the open/closed boundary explicitly** in `README.md` and `ROADMAP.md` §6: the orchestration engine is the closed, paid product; everything the agents consume is open and portable.
- **`ROADMAP.md` §2** — replaced the "open-source agent IDE" star benchmark, which is not available to a closed-core product by construction, with the harness-neutral content repos that are the actual peer set.
- **`ROADMAP.md` §7** — success signals are now ones that can be read today (traffic uniques, clones, referrers, non-maintainer Issues/PRs). Metrics needing instrumentation name the instrumentation and are explicitly not claimed until it ships.
- **`ROADMAP.md` §5** — Phase 1 split into 1a (honest controls, then two item types end to end) and 1b (the rest).

### Security

- **Schema hardening** (`registry/manifest.schema.json`):
  - `permissions` is now **required** for every executable type (`skill`, `agent`, `workflow`, `mcp-server`, `harness`). An empty array is a valid, meaningful declaration; omission is not, so an undeclared item can no longer render as a harmless one.
  - `source` is now **required** whenever `publisher.tier` is not `official` — previously nothing forced an external item to declare the pinned upstream that CI was supposed to resolve.
  - `source.ref` must now match a version-shaped tag or a 40-hex commit SHA. Moving branches (`main`, `master`, `develop`, `HEAD`) are rejected by pattern.
  - Added `status: active | deprecated | revoked`, the vocabulary for the revocation path.
- **Community tier is listing-only.** Merged community items are discoverable and linked to their source, but not one-click-installable, until the app ships a permission-disclosure gate. Pinning a commit proves provenance; it does not make an unreviewed text payload safe.
- **`CODEOWNERS` now covers `/knowledge/`** — knowledge packs are pure prose loaded into an agent's context, the most prompt-injectable item type in the catalog, and were the only category missing.

### Fixed (documentation accuracy)

- **Removed claims that CI validates submissions.** There is no CI in this repo; validation is Phase 1a. `SECURITY.md`, `CONTRIBUTING.md`, `registry/README.md`, `docs/harness-store/README.md`, and the PR template said or implied otherwise.
- **Corrected a backwards security claim.** `SECURITY.md` said that not vendoring "keeps the upstream's own security patching in force." It does the opposite: pinning freezes a dependency, so upstream fixes do not reach users until the pin moves. Pinning buys reproducibility, not freshness.
- **Corrected where manifests live.** `CONTRIBUTING.md` and `registry/README.md` told contributors to put `marblo.yaml` under `registry/`, where nothing would find it. Manifests live in the category folder at the repo root, next to the item.
- **Labeled `tier` as self-asserted.** It is a string in a file the contributor writes, enforced today only by human review at merge. CI-derived tier is Phase 1a.
- Stated plainly that declared permissions are **disclosure, not enforcement** — Marblo cannot restrict what an installed item does.
