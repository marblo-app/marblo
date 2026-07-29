# Changelog

All notable changes to the Marblo ecosystem repo are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/), and the registry manifest schema follows SemVer via its `schema_version`.

## [Unreleased]

### Added

- **Ecosystem monorepo foundation (Phase 0).** Repository structure for a public, community-driven Store.
- `registry/manifest.schema.json` — the `marblo.yaml` manifest schema (`schema_version: 1`) covering skills, MCP servers, agents, workflows, knowledge packs, harnesses, and bundles.
- Governance: `CONTRIBUTING.md`, `SECURITY.md`, `ROADMAP.md`, `LICENSE` (MIT).
- Docs skeleton under `docs/` (getting-started, concepts, harness-store, orchestration, troubleshooting).
- Seed items, one per category:
  - Skill — `code-review` (first-party).
  - MCP servers — `marblo-control` (official) and `github` (verified, manifest-only reference).
  - Agent — `reviewer`.
  - Workflow — `review-and-merge`.
  - Knowledge pack — `curated-llm-resources` (references the awesome-llm-study curation).
