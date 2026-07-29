<!-- Thanks for contributing to the Marblo ecosystem! -->

## What does this PR add or change?

<!-- Short summary. Link any related Issue. -->

## Store item checklist (if adding/updating a registry item)

- [ ] `marblo.yaml` lives in the category folder at the repo root (`skills/<id>/`, `agents/<id>/`, …) — **not** under `registry/`
- [ ] It validates against `registry/manifest.schema.json`
- [ ] `id` is unique and kebab-case
- [ ] First-party: real files included, in the format the target CLI already reads · Referenced: `source.repository` + a pinned tag/40-hex SHA (never a branch)
- [ ] `permissions` declared — required for `skill` / `agent` / `workflow` / `mcp-server` / `harness`; `[]` is a valid answer meaning "asks for nothing"
- [ ] `compatibility.harnesses` and `license` declared
- [ ] `README.md` next to the manifest, with a **standalone install snippet** if the item works without Marblo (and an honest note if it doesn't)
- [ ] No secrets, model weights, large datasets, or copied third-party code/docs

<!--
Review process, so there are no surprises:

• CI validates the schema, IDs, required permissions and licenses, immutable
  source pins, and GitHub repository reachability (best effort). A maintainer
  still reviews the manifest AND the payload by hand, which takes a few days.

• External items merge as `community` tier = LISTED, NOT INSTALLABLE. They are
  discoverable and linked to their source; the app will not one-click-install them
  until it ships a permission gate. Promotion to `verified` follows a payload review.
  Rationale: SECURITY.md.
-->
