# Contributing to Marblo

Thanks for helping build the Marblo ecosystem. This repo is the **public home** of Marblo's Store: skills, MCP servers, agents, workflows, and knowledge packs you can install into the app.

## What lives here (and what doesn't)

**Here:** first-party skills/agents/workflows/knowledge packs (real files), registry manifests, docs, examples, and the public tooling (`packages/`).

**Not here:** the Marblo product and its core technology (private). Also **not** vendored: third-party code — reference it by manifest (`source.repository` + a pinned `ref`) instead of copying it in. Copying external code drags in its license, its security patches, its ownership, and its maintenance onto us; a pinned manifest keeps all four with the upstream author.

## Adding a Store item

1. Pick a category under `registry/` and author a `marblo.yaml` that validates against [`registry/manifest.schema.json`](registry/manifest.schema.json).
2. **First-party** item → put its real files beside the manifest (e.g. `skills/<id>/SKILL.md`).
   **Referenced** item → set `source.repository` and a `source.ref` that is a **tag or commit SHA**, never a moving branch.
3. Declare `permissions`, `compatibility.harnesses`, and a `license`.
4. Open a PR. CI checks: schema validity, the pinned source resolves, a license is present, and the `id` is unique.

## Knowledge packs, not a warehouse

`knowledge/` is for **Knowledge Packs** — curated conventions, prompt patterns, review rules, and _links_ to vetted resources — not a dump of documents. Do **not** commit model weights, large datasets, copied third-party docs, secrets/API keys, or prompt collections of unclear provenance.

## Style

- One item = one clear job. Write descriptions from the user's side ("Review agent-generated code before merge"), not the system's.
- Keep manifests minimal and honest about `tier` and `permissions`.

## Reporting problems

Security issues → [SECURITY.md](SECURITY.md). Everything else → open an Issue. Broken links, wrong pins, and license gaps are all fair game.
