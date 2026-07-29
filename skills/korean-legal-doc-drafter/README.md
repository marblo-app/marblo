# Korean Legal Document Drafter (referenced)

A prompt-only Agent Skill that drafts Korean legal documents by interviewing you: describe the situation, it recommends the right document type, asks two or three questions at a time, then produces the finished text. Coverage is 내용증명, NDAs and partnership/investment/service contracts, employment agreements, 지급명령 신청서, 합의서, 고소장, real-estate lease and sale agreements, 차용증, 위임장, 약관, and privacy policies.

The design decision worth noting: it does not draft from general knowledge. Once a document type is settled, the skill is instructed to read that type's reference guide (`references/doc-NNN.md`) first — each guide carries the branching questions, the mandatory-clause checklist, and the output template.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [openmagi/korean-legal-doc-drafter](https://github.com/openmagi/korean-legal-doc-drafter)
- **Pinned at:** `09addc57285ef53e3f5b78d5a307ec56c64a3708` (no upstream git tags) · **path:** `skills/korean-legal-doc-drafter`

## Why it is listed here

Korean legal document conventions — what a 내용증명 must contain to be worth sending, which clauses a 근로계약서 legally requires — are exactly the kind of local procedural knowledge a global skill catalog does not carry.

**Measured 2026-07-29:** 10 stars · last upstream push 2026-06-24 · Apache-2.0. Small and young; listed on the quality of the reference-guide structure rather than adoption, and we would rather say that than imply traction it does not have. Its README claims 150 document types (the repo description still says 118 — the README is the newer number).

## Installing it standalone

It is a plain `SKILL.md` plus a `references/` directory, so it drops into any harness that reads skills:

```bash
# Claude Code — clone at the pinned commit and copy the skill directory
git clone https://github.com/openmagi/korean-legal-doc-drafter /tmp/kldd \
  && git -C /tmp/kldd checkout 09addc57285ef53e3f5b78d5a307ec56c64a3708 \
  && cp -r /tmp/kldd/skills/korean-legal-doc-drafter ~/.claude/skills/

# Codex — same files, different directory
cp -r /tmp/kldd/skills/korean-legal-doc-drafter ~/.codex/skills/
```

Upstream also ships `install.sh`; read it before running it, as you would with any install script.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read` only — the skill is markdown with no scripts; the one thing it reads is its own bundled reference guides. It requests no network, no shell, and no write access.
- **License:** Apache-2.0 (upstream, verified via the GitHub license API)
- **Legal caveat:** upstream's own `SKILL.md` requires the drafting agent to show a "this is not legal advice, have a professional review it" notice twice — once when recommending a document and again after producing one. That disclaimer is load-bearing. Treat output as a first draft for a lawyer to review.
