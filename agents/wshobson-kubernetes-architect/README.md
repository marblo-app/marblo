# Kubernetes Architect (agent · community)

**Why it's here:** "we'll figure out the cluster later" is how platform debt starts. This agent is scoped to the decisions that are painful to revisit once workloads are running: tenancy model, delivery mechanism, mesh or no mesh.

> **Referenced, not vendored.** The definition lives in [`wshobson/agents`](https://github.com/wshobson/agents), pinned to commit `c4b82b0`.
>
> **Tier `community` = listed, not installable** in the Marblo Store — [why](../../SECURITY.md#why-community-items-cannot-be-installed-with-one-click).

## Install it standalone (no Marblo required)

One subagent definition — YAML frontmatter plus a prompt, the format Claude Code already reads.

```bash
SHA=c4b82b0ad771190355eb8e204b1329732a18449a
mkdir -p ~/.claude/agents && curl -sL \
  "https://raw.githubusercontent.com/wshobson/agents/$SHA/plugins/kubernetes-operations/agents/kubernetes-architect.md" \
  -o ~/.claude/agents/kubernetes-architect.md
```

Scope it to one repo instead by writing to `.claude/agents/` inside it.

**Invoke it by the frontmatter name, not the filename:** this one registers as **`kubernetes-operations-kubernetes-architect`**. Upstream namespaces its agents per plugin; edit the `name:` line if you would rather type less.

## Details

- **Upstream:** [`plugins/kubernetes-operations/agents/kubernetes-architect.md`](https://github.com/wshobson/agents/blob/main/plugins/kubernetes-operations/agents/kubernetes-architect.md) · **Manifest:** [`marblo.yaml`](marblo.yaml)
- **Pinned to:** `c4b82b0ad771190355eb8e204b1329732a18449a`
- **Permissions:** `repository:read`, `filesystem:read`, `filesystem:write`, `shell:exec`, `network:outbound` — declared wide **because the frontmatter carries no `tools:` line**, which in Claude Code means the agent inherits the session's entire tool set, web tools included. Narrow it yourself by adding a `tools:` line after install; compare [`voltagent-qa-expert`](../voltagent-qa-expert/), whose upstream does pin one.
- **Requests model:** `opus` in its frontmatter. Change that line if your fleet routes on cost.
- **Not only managed clusters:** the prompt covers kubeadm, kops, kubespray, bare-metal, and air-gapped installs, so it is usable outside the three-hyperscaler happy path.
- **License:** MIT.
- **Measured at pin (2026-07-30):** 38,358 stars · pinned commit 2026-07-18 · repo last push 2026-07-22 · not archived.

Upstream also ships this same file inside its `cicd-automation` and `cloud-infrastructure` plugins — installing more than one of those gives you three namespaced copies of the same prompt.
