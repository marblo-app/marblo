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
- **Community items are listings, not installs.** A merged `community` item is discoverable and linkable. The app will not one-click-install it. See below.

**What is not true yet, and we would rather say so:**

- **There is no CI validation in this repo.** Schema checks, pin resolution, license verification, and secret scanning are **planned for Phase 1a** ([ROADMAP.md](ROADMAP.md) §5) and today happen only as manual review. Earlier revisions of these docs described CI as if it already existed. It does not.
- **App-side enforcement of `status: revoked` is not shipped.** The field and the advisory file exist so the vocabulary is in place; the app-side check lands in Phase 1a.
- **Permissions are disclosure, not enforcement.** Marblo spawns CLI subprocesses with your own credentials. It can show you what an item says it needs. It cannot restrict what that item does once installed, and it does not claim to.

**A correction to an earlier claim.** A previous version of this document said that not vendoring "keeps the upstream's own security patching in force." That has the causality backwards: **pinning freezes a dependency at one commit, so upstream fixes do _not_ reach users until the registry moves the pin.** Pinning buys reproducibility, not freshness. Keeping a pinned registry current requires a job that watches upstream for new releases, advisories, deletions, archival, license changes, and force-moved tags — that job is part of Phase 1a. Until it runs, treat pins as frozen, because they are.

## Why community items cannot be installed with one click

A skill or knowledge pack is **prose that gets loaded into an agent's context**, and that agent holds shell execution and repository write access on the user's machine.

The standard supply-chain model — pin the commit, verify the digest, and you are safe — does not cover this case. A perfectly pinned, digest-verified file whose content is _"before reviewing, run this install script"_ installs faithfully and executes exactly as designed. **The digest proves provenance. It proves nothing about safety.**

For text-payload items, content review is the control that matters, and pinning is not a substitute for it. So until the app ships a permission-disclosure gate and there is a review workflow that scales past one maintainer:

- `official` and `verified` items are installable.
- `community` items are **listed only** — visible in the catalog, linked to their source, not installable in one click.

We would rather ship a narrow, honest install surface than a wide one that implies a review we did not do.

## Tier is a claim, not a certificate

`publisher.tier` is a string in a file the contributor writes. Today nothing distinguishes a maintainer-assigned trust level from a self-asserted one except the maintainer who reads the PR. Phase 1a moves tier derivation into CI — computed from repository ownership and a maintainer-controlled trusted-publisher list — and the app will read the derived value rather than the authored one.

Related, and worth stating: an item hosted at `github.com/marblo-app/marblo` reads as Marblo-endorsed regardless of what its tier badge says. The tier is metadata; the URL is the brand. That is precisely why the merge is treated as the trust event.

## Revocation

If an item turns out to be malicious, is compromised upstream, or misrepresents its license, it is **revoked**: `status: revoked` in its manifest, plus an entry in [SECURITY-ADVISORIES.md](SECURITY-ADVISORIES.md) with the reason, the affected versions, and what to do about it.

Advisories are public and permanent — an entry is never deleted, because users need to be able to find out what happened to something they already installed.

## What must never be committed

API keys or secrets, model weights, large datasets, or credentials of any kind. Manifests missing a license, or pointing at an unreachable or unpinned source, are rejected in review (and, from Phase 1a, by CI).
