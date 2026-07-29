---
name: Add an item to the Marblo Store
about: Propose a skill, MCP server, agent, workflow, or knowledge pack for the ecosystem
title: "[Store] Add <item name>"
labels: ["store", "community"]
---

## What is it?

<!-- One or two sentences: what it does and who it's for. -->

## Does it work without Marblo?

<!--
The bar for a first-party asset is that it is useful to someone who never installs
the app. If yours needs Marblo, that's fine — say so and we'll label it honestly.
-->

- [ ] Yes — it's a standards-native file (drops into `~/.claude/skills/`, `~/.codex/skills/`, `~/.claude/agents/`, or any MCP client)
- [ ] No — it needs Marblo. Why: <!-- ... -->

## Category

<!-- skill / mcp-server / agent / workflow / knowledge-pack / bundle -->

## First-party or referenced?

- [ ] First-party (I will contribute the actual files)
- [ ] Referenced (external — link the upstream repo and a **pinned tag / 40-hex SHA**, never a branch)

Upstream (if referenced): <!-- repo URL + tag/SHA -->

## Compatibility & permissions

- Harnesses: <!-- claude-code / codex / gemini-cli / grok / any -->
- Permissions it needs: <!-- repository:read, network:outbound, ... — required for skill/agent/workflow/mcp-server/harness. `[]` (asks for nothing) is a valid answer. -->
- License: <!-- SPDX id -->

<!--
Before you invest time, two things worth knowing (see CONTRIBUTING.md):

• CI validates the manifest schema, required metadata, immutable source pins,
  and GitHub repository reachability (best effort). A maintainer also reviews
  the manifest and payload by hand, so expect a few days.

• External items merge as `community` tier = LISTED, NOT INSTALLABLE. They're
  discoverable and linked to their source, but the app won't one-click-install
  them until it ships a permission gate. Rationale: SECURITY.md.

External code is referenced by manifest, never copied in.
-->
