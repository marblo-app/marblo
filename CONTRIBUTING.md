# Contributing to Marblo

Thanks for helping build the Marblo ecosystem. This repo is the public home of harness-neutral assets — skills, agents, workflows, MCP manifests, and knowledge packs — that work in the agent CLI you already run, and that the Marblo app can also install for you.

**The bar for a first-party asset:** it has to be useful to someone who never installs Marblo. If an item only makes sense inside the app, say so in its README rather than implying portability it does not have.

## What lives here (and what doesn't)

**Here:** first-party skills/agents/workflows/knowledge packs (real files), registry manifests, docs, examples, and public tooling (`packages/`).

**Not here:** the Marblo product and its orchestration engine (private — see [ROADMAP.md](ROADMAP.md) §6). Also **not** vendored: third-party code — reference it by manifest (`source.repository` + a pinned `ref`) instead of copying it in. Copying external code drags its license, its ownership, and its maintenance onto us; a pinned manifest keeps all three with the upstream author.

## Adding a Store item

1. **Create a folder under the category directory at the repo root** — `skills/`, `agents/`, `workflows/`, `mcp-servers/`, or `knowledge/` — named after your item's `id`. The `registry/` directory holds the schema and docs, **not** manifests; a `marblo.yaml` placed there will not be found.
2. Author a `marblo.yaml` in that folder that validates against [`registry/manifest.schema.json`](registry/manifest.schema.json).
3. **First-party** item → put its real files beside the manifest (e.g. `skills/<id>/SKILL.md`), in the format the target CLI already reads.
   **Referenced** item → set `source.repository` and a `source.ref` that is a **release tag or a 40-character commit SHA**, never a moving branch. The schema rejects `main`, `master`, `develop`, and `HEAD` by pattern; if your tag does not fit the version-tag shape, pin the SHA.
4. Declare `permissions` (**required** for `skill`, `agent`, `workflow`, `mcp-server`, `harness` — an empty list is a valid answer meaning "asks for nothing"), `compatibility.harnesses`, and a `license`.
5. Add a short `README.md` next to the manifest, including a **standalone install snippet** if the item works without Marblo.
6. Run `npm install && npm run gen:catalog` at the repo root, and commit the `README.md` change it makes. The catalog table in the root README is generated from every manifest — **do not hand-edit it**, and do not hand-write your row either. CI regenerates the table and fails the PR if what you committed differs.
7. Open a PR.

### What happens to your PR

Every pull request runs the registry validator. It checks the manifest schema, unique kebab-case IDs, required permissions and licenses, immutable external source pins, and GitHub source reachability on a best-effort basis. A maintainer still reviews each manifest and its payload by hand; automated validation is a gate, not a trust decision.

A second job regenerates the root README's catalog block from the manifests and fails if it drifted — that is what step 6 above prevents. If it fails, run `npm run gen:catalog` and commit the result; there is nothing to fix by hand.

**External items merge as `community` tier, which means listed, not installable.** They are discoverable and linked to their source, but the app will not one-click-install them until it ships a permission gate. This is deliberate — [SECURITY.md](SECURITY.md) explains why a pinned commit does not make an unreviewed text payload safe. Promotion to `verified` follows a maintainer review of the payload itself.

We would rather tell you this up front than have you discover it after the merge.

## Knowledge packs, not a warehouse

`knowledge/` is for **Knowledge Packs** — operational knowledge, curated conventions, review rules, and _links_ to vetted resources — not a dump of documents.

The best pack is one that could only be written by someone who did the thing. [`fleet-operations`](knowledge/fleet-operations/) is the model: measured findings from running the system in production, including the hypotheses that turned out to be wrong. **Measured, not inferred**, and version-stamped when it describes a CLI contract that will drift.

Do **not** commit model weights, large datasets, copied third-party docs, secrets/API keys, or prompt collections of unclear provenance.

## Style

- One item = one clear job. Write descriptions from the user's side ("Review agent-generated code before merge"), not the system's.
- Keep manifests minimal and honest about `tier` and `permissions`. Over-declaring permissions is not "safe" — it trains people to ignore the disclosure.
- If your item does something the docs here claim it does not, fix the docs in the same PR.

## Reporting problems

Security issues → [SECURITY.md](SECURITY.md). Something already merged that turned out to be unsafe → the revocation path in [SECURITY-ADVISORIES.md](SECURITY-ADVISORIES.md). Everything else → open an Issue. Broken links, wrong pins, license gaps, and docs that overstate what exists are all fair game — the last one especially.
