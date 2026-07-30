# Debugger (agent · community)

**Why it's here:** it is the shortest agent definition in this batch, and that is the point: a tight loop that resists the failure mode of patching the symptom. Cheap to run, easy to read end to end before you trust it.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/debugging-toolkit/agents/debugger.md" \
  -o ~/.claude/agents/debugger.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`debugging-toolkit-debugger`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/debugging-toolkit/agents/debugger.md`](https://github.com/wshobson/agents/blob/main/plugins/debugging-toolkit/agents/debugger.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `sonnet` in its frontmatter. Change that line if your fleet routes on cost.
- **Model tier `sonnet`** — one of the few in this registry that pins a mid tier rather than `opus` or `inherit`, which fits how often a debugger gets invoked.
- **Ships in five plugins upstream** (`debugging-toolkit`, `error-debugging`, `error-diagnostics`, `incident-response`, `unit-testing`); this manifest pins the `debugging-toolkit` copy.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

For log-side investigation across services rather than a single failing test, see [`wshobson-error-detective`](../wshobson-error-detective/).
