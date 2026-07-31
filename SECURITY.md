# Security Policy

## Reporting a vulnerability

Email **team@marblo.app** with details and reproduction steps. Please do not open a public Issue for undisclosed vulnerabilities. We aim to acknowledge within a few business days.

If a **registry item** is the problem — a malicious payload, a compromised upstream, a license misrepresentation — say so in the subject line. Those get handled through the revocation path below, which is faster than a normal fix.

## Registry trust model

The Marblo Store installs content that runs on a user's machine, so the registry is treated as a supply-chain surface.

**What is true today:**

- **Referenced items are pinned.** External items declare `source.ref` as a **tag or commit SHA**, never a moving branch. The manifest schema enforces the shape of that pin.
- **No silent vendoring.** Third-party code is not copied into this repo; it is fetched from its upstream at the pinned ref, so license and ownership stay with the original author.
- **Permissions are declared.** Every executable item type (`skill`, `agent`, `workflow`, `mcp-server`, `harness`) is **required** by the schema to declare the capabilities it requests. An empty list is a valid, meaningful answer; omission is not allowed, so a silent item cannot render as a harmless one.
- **Human review is the control.** Every registry path is covered by `CODEOWNERS`. A maintainer reads the payload before merge.
- **Community items are never one-click.** A merged `community` item is discoverable and linkable, and — when its manifest declares a digest-pinned install contract — installable **only behind an explicit "unreviewed content" consent step** that the app enforces in its main process, not in the UI. See below.

**What is not true yet, and we would rather say so:**

- **CI validation is intentionally narrow.** Every pull request runs schema, ID, required permission, license, immutable external source-pin, and best-effort GitHub repository-reachability checks. CI does not verify an upstream's license text or scan an external payload for secrets; those remain maintainer-review responsibilities.
- **App-side enforcement of `status: revoked` is not shipped.** The field and the advisory file exist so the vocabulary is in place; the app-side check lands in Phase 1a.
- **Permissions are disclosure, not enforcement.** Marblo spawns CLI subprocesses with your own credentials. It can show you what an item says it needs. It cannot restrict what that item does once installed, and it does not claim to.

**A correction to an earlier claim.** A previous version of this document said that not vendoring "keeps the upstream's own security patching in force." That has the causality backwards: **pinning freezes a dependency at one commit, so upstream fixes do _not_ reach users until the registry moves the pin.** Pinning buys reproducibility, not freshness. Keeping a pinned registry current requires a job that watches upstream for new releases, advisories, deletions, archival, license changes, and force-moved tags — that job is part of Phase 1a. Until it runs, treat pins as frozen, because they are.

## Why community items cannot be installed with one click

A skill or knowledge pack is **prose that gets loaded into an agent's context**, and that agent holds shell execution and repository write access on the user's machine.

The standard supply-chain model — pin the commit, verify the digest, and you are safe — does not cover this case. A perfectly pinned, digest-verified file whose content is _"before reviewing, run this install script"_ installs faithfully and executes exactly as designed. **The digest proves provenance. It proves nothing about safety.**

For text-payload items, content review is the control that matters, and pinning is not a substitute for it. The app now ships the gate this section used to be waiting for, so the current state is:

- `official` and `verified` items are installable **one-click** — a maintainer reviewed the payload.
- `community` items with an install contract are installable **only after an explicit consent step**: the app shows an "unreviewed content — trust the source yourself" warning, requires the user to acknowledge it, and enforces that acknowledgement in the main process (a UI bypass cannot skip it). What then lands on disk is exactly the pinned, digest-verified bytes from the item's `source` repo — never vendored here, never fetched from a moving branch, and CI re-verifies every digest against the pinned upstream on every PR.
- `community` items without an install contract remain **listed only**.

One-click means "we reviewed it." Consent-gated means "we pinned and verified it, but **you** are trusting the author." We would rather label those two honestly than blur them into one install button.

## Tier is a claim, not a certificate

`publisher.tier` is a string in a file the contributor writes. Today nothing distinguishes a maintainer-assigned trust level from a self-asserted one except the maintainer who reads the PR. Phase 1a moves tier derivation into CI — computed from repository ownership and a maintainer-controlled trusted-publisher list — and the app will read the derived value rather than the authored one.

Related, and worth stating: an item hosted at `github.com/marblo-app/marblo` reads as Marblo-endorsed regardless of what its tier badge says. The tier is metadata; the URL is the brand. That is precisely why the merge is treated as the trust event.

## Revocation

If an item turns out to be malicious, is compromised upstream, or misrepresents its license, it is **revoked**: `status: revoked` in its manifest, plus an entry in [SECURITY-ADVISORIES.md](SECURITY-ADVISORIES.md) with the reason, the affected versions, and what to do about it.

Advisories are public and permanent — an entry is never deleted, because users need to be able to find out what happened to something they already installed.

## What must never be committed

API keys or secrets, model weights, large datasets, or credentials of any kind. Manifests missing a license or an immutable source pin are rejected by CI; a GitHub repository reachability check is also run on a best-effort basis. Payload review remains mandatory.
