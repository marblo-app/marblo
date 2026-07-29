# fluent-korean (referenced)

A Claude Code **output style** — not a `SKILL.md` — that changes how the agent writes Korean in everything it says. Upstream names the specific failure it targets: dropped particles and endings, telegraphic noun strings where a sentence belongs, and vocabulary swapped for a metaphor that means something else in Korean. It optimises for unambiguous meaning over elegant prose.

It ships as two variants: one that keeps Claude Code's coding instructions intact, and one without them.

## Why this one is here despite 8 stars

Because the failure it fixes compounds inside Marblo specifically. When agents hand work to each other in Korean — orchestrator to agent, agent to ticket, ticket back to a person — degraded Korean is not just unpleasant to read: meaning is lost at each hop, and upstream argues it also pollutes the reasoning trace when thinking is enabled. That is a multi-agent problem, and this is the only item we found that addresses it at the output-style layer rather than per-document.

The maintainer states in the repository that they are a Korean-literature major and that the Korean text in the README is human-written. We list that as their claim, not as something we verified.

**Measured 2026-07-29:** 8 stars · last upstream push 2026-07-16 · MIT · `v1.0.0` released 2026-07-10. This is the least-adopted item in the Korea set. We are listing it on the specificity of the problem and the quality of the guideline text, not on traction, and we would rather say that plainly.

## Referenced, not vendored

**No files from this plugin live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a tag.

- **Upstream:** [snflkd/fluent-korean](https://github.com/snflkd/fluent-korean)
- **Pinned at:** tag `v1.0.0` (resolves to `3c1073a629eead3bd3ffc1ec7e47824b21be6d6d`) · **path:** `plugins/fluent-korean`

## Installing it standalone

```bash
# Clone at the pinned tag
git clone --branch v1.0.0 https://github.com/snflkd/fluent-korean /tmp/fluent-korean

# Claude Code — output styles live in ~/.claude/output-styles/
cp /tmp/fluent-korean/plugins/fluent-korean/output-styles/*.md ~/.claude/output-styles/
```

Then select the style with `/output-style`. Upstream also notes the guideline text can be pasted into any other AI as a plain writing instruction — that path needs no install at all.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** none — `permissions: []`, meaning it asks for nothing. It is markdown instruction text with no scripts, no file access, and no network.
- **Compatibility:** declared for `claude-code` only. It is packaged as a Claude Code output-style plugin; the underlying text is portable by copy-paste, but that is not an install path we can declare.
- **License:** MIT (upstream, verified via the GitHub license API)
