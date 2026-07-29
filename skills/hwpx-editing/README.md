# HWPX Editing Skill (referenced)

Agents corrupt `.hwpx` files. HWPX is a zipped XML format with structural rules that a model editing XML by pattern-match will quietly violate, producing a file Hangul refuses to open. This skill is the rules that prevent that, packaged with Python tools that actually run: `inspect_hwpx.py`, `verify.py`, `audit_layout.py`, `audit_typography.py`, `data_to_hwpx_table.py`, `hwpx_to_markdown.py`, `hwpx_to_docx.py`, `tables_to_xlsx.py`, and a `selftest.py`.

LLM 에이전트가 한글(.hwpx) 파일을 깨뜨리지 않고 편집하도록 하는, 검증된 HWPML 편집 규칙 + 파이썬 도구 스킬.

## How this differs from [`kordoc`](../../mcp-servers/kordoc/)

Both touch Korean documents; they solve different halves. kordoc is an MCP server that **converts and parses** many formats. This is a skill that teaches **safe in-place editing** of one format, and verifies the result. Install both if you edit HWPX; install kordoc alone if you only need to read documents.

## Referenced, not vendored

**No files from this skill live in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a commit.

- **Upstream:** [kangdacool/hwpx-editing-skill](https://github.com/kangdacool/hwpx-editing-skill)
- **Pinned at:** `d0f565c322ff45b3a5c7bf3e4aa21d3a15db9e99` (no upstream git tags) · **path:** `skills/hwpx-editing`

## Why it is listed here

**Measured 2026-07-29:** 7 stars · last upstream push 2026-07-27 · MIT. This is the least-adopted item in the Korea set and we are not going to dress that up. It is listed because the failure it addresses is specific, real, and unaddressed elsewhere in this registry, and because the repo carries the maintenance signals a young project usually lacks — `CONTRIBUTING.md`, `SECURITY.md`, `AGENTS.md`, a code of conduct, and a self-test.

## Installing it standalone

```bash
# Claude Code — clone at the pinned commit, copy the skill directory
git clone https://github.com/kangdacool/hwpx-editing-skill /tmp/hwpx-skill \
  && git -C /tmp/hwpx-skill checkout d0f565c322ff45b3a5c7bf3e4aa21d3a15db9e99 \
  && cp -r /tmp/hwpx-skill/skills/hwpx-editing ~/.claude/skills/

# Codex / Gemini CLI — same files, their skills directory
cp -r /tmp/hwpx-skill/skills/hwpx-editing ~/.codex/skills/
```

Upstream ships `install.sh` and `install.ps1` too; read them before running, as with any install script. The Python tools need a local Python; upstream's README at the pinned commit is authoritative for versions and dependencies.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` (external, payload **not** reviewed — listing only, not one-click-installable)
- **Permissions:** `filesystem:read`, `filesystem:write` (it edits your documents in place), `shell:exec` (the bundled Python scripts run as subprocesses). This is the broadest permission set of the Korea items — it is a skill that runs code against your files. Read the disclosure before you install it.
- **License:** MIT (upstream, verified via the GitHub license API)
