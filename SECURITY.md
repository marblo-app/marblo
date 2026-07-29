# Security Policy

## Reporting a vulnerability

Email **team@marblo.app** with details and reproduction steps. Please do not open a public Issue for undisclosed vulnerabilities. We aim to acknowledge within a few business days.

## Registry trust model

The Marblo Store installs code that runs on a contributor's machine, so the registry is treated as a supply-chain surface.

- **Referenced items are pinned.** External items declare `source.ref` as a **tag or commit SHA**, never a moving branch — so what the Store installs is exactly what was reviewed.
- **No silent vendoring.** Third-party code is not copied into this repo; it is fetched from its upstream at the pinned ref, keeping the upstream's own security patching in force.
- **Permissions are declared.** Each manifest lists the capabilities it requests (`repository:write`, `network:outbound`, `shell:exec`, `secrets:read`, …). The app surfaces these before install.
- **Tiers signal review.** `official` = maintained by Marblo; `verified` = external but reviewed and pinned; `community` = external and unreviewed — install with the same caution you would any third-party tool.

## What must never be committed

API keys or secrets, model weights, large datasets, or credentials of any kind. CI rejects manifests missing a license or pointing at an unreachable/unpinned source.
