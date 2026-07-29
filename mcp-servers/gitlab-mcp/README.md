# GitLab MCP (referenced)

**Why this one:** the registry already carries GitHub. Teams on GitLab get the same surface here — merge requests, issues, pipelines, files, wiki — from the most actively maintained GitLab MCP server on GitHub, and it points at self-managed instances as well as gitlab.com.

## Referenced, not vendored

**No code from this server lives in this repo.** [`marblo.yaml`](marblo.yaml) points at the upstream repository and pins a released tag, so license, ownership, and maintenance stay with the upstream author.

- **Upstream:** [zereight/gitlab-mcp](https://github.com/zereight/gitlab-mcp)
- **Pinned at:** `v2.1.43` (commit `4a141d1a8597075ccac626ab9bc6d82820d78152`, released 2026-07-26)
- **Measured 2026-07-29 (`gh api`):** 1,851 stars · last push 2026-07-27 · license MIT

`package.json` at the pinned tag reads `@zereight/mcp-gitlab@2.1.43`, so the pinned tree and the published npm package are the same code.

## Installing it standalone

Any MCP client works — this is a plain stdio MCP server, nothing Marblo-specific:

```json
{
  "mcpServers": {
    "gitlab": {
      "command": "npx",
      "args": ["-y", "@zereight/mcp-gitlab@2.1.43"],
      "env": {
        "GITLAB_PERSONAL_ACCESS_TOKEN": "...",
        "GITLAB_API_URL": "https://gitlab.com/api/v4",
        "GITLAB_PERMISSION_MODE": "readonly"
      }
    }
  }
}
```

Upstream's README documents the version as `@latest`; the pin above is deliberate — a dist-tag is not a pin, and the version here is the one that was actually read.

`GITLAB_PERMISSION_MODE` is upstream's own switch and takes `readonly`, `modify` (no delete tools), or `full` (the **default**). Start at `readonly`. Toolsets (`GITLAB_TOOLSETS`), group allowlists (`GITLAB_ALLOWED_GROUPS`), and OAuth mode are documented in upstream's README at the pinned ref.

## No one-click install from the Store

This item carries no `install` block, and that is the schema working rather than an omission: registering an MCP server means a process launches on your machine at the next CLI start, and [`registry/manifest.schema.json`](../../registry/manifest.schema.json) allows that only for `official` and `verified` publishers. `community` items are listed and disclosed — you copy the JSON above yourself.

## Permissions

`network:outbound`, `repository:read`, `repository:write`, `secrets:read` — talks to your GitLab API host; reads and, at the default permission mode, **writes** repository state (merge requests, issues, files); reads `GITLAB_PERSONAL_ACCESS_TOKEN` from the environment.

The write permission is the one to read twice. Out of the box this server can open and merge merge requests and edit issues with your token's full authority. Scope the token, and set `GITLAB_PERMISSION_MODE=readonly` unless you specifically want the agent writing.

Issue and MR text fetched this way is untrusted input landing in the model's context. Treat it as data, not instructions.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `community` — external, listed, **not reviewed by Marblo maintainers**. What was checked is exactly what is written above: the repo exists, the pin resolves, the license is MIT, and the activity numbers are `gh api` readings on 2026-07-29. Nothing here asserts a source audit.
- **License:** MIT (upstream)

Pinning freezes this at one tag: upstream fixes, including security fixes, do not reach you until the pin here moves. Upstream tags releases frequently, so there is a release feed to watch.
