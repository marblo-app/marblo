# QA Expert (agent · community)

**Why it's here:** test *automation* agents write tests; this one decides which tests are worth having. It cannot edit files — `tools: Read, Grep, Glob, Bash` — so what you get back is a plan and an assessment, which is the honest output for this job.

> **Referenced, not vendored.** The definition lives in [`VoltAgent/awesome-claude-code-subagents`](https://github.com/VoltAgent/awesome-claude-code-subagents), pinned to commit `947b44c`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

The upstream repo is a curated collection; this is one file out of it, not the collection.

```bash
SHA=947b44ca0c58d606b084e9cb1a2389335b49278b
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/VoltAgent/awesome-claude-code-subagents/$SHA/categories/04-quality-security/qa-expert.md" \
  -o ~/.claude/agents/qa-expert.md
```

Ask for it as **`qa-expert`** — VoltAgent does not namespace its frontmatter names, so the invocation name matches the filename.

## Details

- **Upstream:** [`categories/04-quality-security/qa-expert.md`](https://github.com/VoltAgent/awesome-claude-code-subagents/blob/main/categories/04-quality-security/qa-expert.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `947b44ca0c58d606b084e9cb1a2389335b49278b`
- **Permissions:** `filesystem:read`, `shell:exec` — matching its `tools: Read, Grep, Glob, Bash`. It reads and runs, but cannot edit a file — findings come back as a report, not a patch.
- **Requests model:** `sonnet` in its frontmatter.
- **Expects a context manager:** its prompt's first step is to query a *context manager* agent for quality requirements and application details. Nothing breaks without one — it falls back to what you tell it — but the more you state up front, the less generic the output. [`voltagent-context-manager`](../voltagent-context-manager/) is that companion agent.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 23,847 stars · pinned commit 2026-07-10 · not archived.

For executing the plan, pair it with an implementation agent; for the TDD discipline around it, [`wshobson-tdd-orchestrator`](../wshobson-tdd-orchestrator/).
