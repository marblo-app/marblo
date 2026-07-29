# hwpx-plugins (referenced)

A plugin bundle that connects an agent to the [`python-hwpx`](https://github.com/airmang/python-hwpx) engine for Hangul `.hwpx` (OWPML) work. The agent's primary path is a **stateful MCP workflow** — `start_workflow` → `get_workflow` / `continue_workflow` → `approve_workflow_decision` — so multi-step document edits run under server-enforced state and an approval gate, with primitive tools kept as an escape hatch. Upstream's `SKILL.md` names 가정통신문, 공문, 양식 작성, mail-merge (상장·수료증), 신구대조표, and line-spacing/margin/page-number edits as targets.

The repo ships plugin variants for `claude`, `codex`, `hermes`, and `openclaw`.

## How this differs from [`hwpx-editing`](../hwpx-editing/)

Both edit `.hwpx`. They are different bets on how.

- **`hwpx-editing`** is _rules plus standalone scripts_: it teaches the model the HWPML constraints and hands it Python tools it invokes directly. Self-contained, nothing to install beyond Python.
- **`hwpx-plugins`** is _a library behind a workflow server_: the document manipulation lives in the `python-hwpx` PyPI package, and the agent drives it through MCP with approval steps rather than editing XML itself.

If you want the model to understand HWPX, take the first. If you want the model to not touch HWPX and call a tested library instead, take this one. See also [`kordoc`](../../mcp-servers/kordoc/), which converts and parses Korean documents rather than editing them in place.

## On "official"

The GitHub description says "Official onboarding skill for HWPX document automation." That means **first-party to the `python-hwpx` project** — same author. It does **not** mean Hancom. Upstream's own `NOTICE` states the project is "an independent, unofficial implementation and is not affiliated with, endorsed by, or sponsored by Hancom Inc.", and that HWPX is Hancom's specified and trademarked format. We repeat that here so the word "official" in the listing cannot be read the other way.

## Referenced, not vendored

**No files from this plugin live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a tag.

- **Upstream:** [airmang/hwpx-plugins](https://github.com/airmang/hwpx-plugins)
- **Pinned at:** tag `v1.0.0` (resolves to `26f7fb8c926803fa5631e7a0d118d47dd226334e`)

## Why it is listed here

**Measured 2026-07-29:** 19 stars · last upstream push 2026-07-29 · Apache-2.0 · `v1.0.0` released 2026-07-28, with 5+ prior tags. Low stars, but the maintenance signals are unusually complete for a young repo: a real release history, `CONTRIBUTING.md`, `SECURITY.md`, `NOTICE`, a `tests/` directory, and 19 QA/validation scripts including e2e harnesses. The engine underneath is published on PyPI, which is a maintenance commitment a skill repo alone does not make.

## Installing it standalone

Upstream distributes it as a plugin marketplace, so the host's own plugin command is the supported path:

```bash
# Claude Code
claude plugin marketplace add airmang/hwpx-plugins
claude plugin install hwpx-plugin@hwpx
```

Note this installs from upstream's default branch, **not** from the `v1.0.0` commit this manifest pins — the plugin CLI has no ref argument. If the pin matters to you, clone at the tag and install from the local checkout. Restart the host session afterwards; upstream states new skills and MCP tools only load in a fresh session.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read`, `filesystem:write` (it edits your documents), `shell:exec` (Python scripts and the MCP launcher run as subprocesses), `network:outbound` (installation resolves `python-hwpx` and `python-hwpx-automation` from PyPI into a plugin venv). Document editing itself is local.
- **License:** Apache-2.0 (upstream, verified via the GitHub license API)
- **Optional Hancom dependency:** upstream performs editing in pure Python, but uses Hancom 오라클 for final visual verification when available. That step needs a Hangul installation; without it you lose visual review, not editing.
