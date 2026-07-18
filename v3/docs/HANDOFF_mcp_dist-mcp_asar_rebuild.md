# HANDOFF — Marblo MCP dead in packaged app (`-32000`) · fix staged · needs rebuild

**To:** build/release agent
**From:** diagnosis session · 2026-07-08
**Verdict:** ✅ **Rebuild required.** Source fix already applied (uncommitted in `v3/electron/agent-config.ts`). Your job: review → commit → `npm run build:mac` → verify → ship.
**Repo:** `~/Documents/programming/Marblo/v3` · branch `main` @ `970a41c` · fix is an **uncommitted working-tree change**.

---

## TL;DR

Packaged Marblo.app generates a per-agent MCP config whose `marblo` server points at
`app.asar/dist-mcp/index.js`, but `dist-mcp` is shipped **outside** the asar
(`Resources/dist-mcp`). Result: `MODULE_NOT_FOUND` → `MCP error -32000: Connection closed`.
No user-side config can fix it (`--strict-mcp-config`). One-line resolver fix, already staged.

## Symptom (repro)

1. Launch the **packaged** `/Applications/Marblo.app` (NOT dev mode).
2. Spawn any agent → Claude Code runs `/mcp` → `marblo` = **Failed to reconnect: -32000**.
3. Log at `~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-marblo/*.jsonl`:
   ```
   Error: Cannot find module '/Applications/Marblo.app/Contents/Resources/app.asar/dist-mcp/index.js'
   code: 'MODULE_NOT_FOUND'  · Node.js v20.18.3
   MCP error -32000: Connection closed
   ```

## Root cause (verified)

| | Location | Exists? |
|---|---|---|
| **Shipped** (electron-builder.yml `extraResources: from dist-mcp → to dist-mcp`) | `Resources/dist-mcp/index.js` | ✅ yes (5,879 B) |
| **Resolved** (`agent-config.ts` `getMCPServerPath` → `path.resolve(__dirname,"..","dist-mcp")`) | `Resources/app.asar/dist-mcp/index.js` | ❌ no |

- asar contents = `dist`, `dist-electron`, `node_modules`, `skills` — **no `dist-mcp`** (correct; it's an extraResource).
- Packaged `__dirname` = `…/app.asar/dist-electron`, so `../dist-mcp` lands **inside** the asar → missing → crash.
- Dev mode is unaffected (`__dirname` = `v3/dist-electron` → `v3/dist-mcp/index.js` exists). That's why the Jul 5 dev configs worked and the Jul 7 packaged build regressed.
- `--strict-mcp-config` on the spawned `claude` process ⇒ `~/.claude/.mcp.json` and all user config are ignored. **Only an app rebuild fixes prod.**

## Fix — ALREADY STAGED (review, don't rewrite)

`v3/electron/agent-config.ts`, `getMCPServerPath()`:

```ts
function getMCPServerPath(): string {
  if (__dirname.includes("app.asar")) {
    return path.join(process.resourcesPath, "dist-mcp", "index.js");
  }
  return path.resolve(__dirname, "..", "dist-mcp", "index.js");
}
```

- Dev path unchanged; packaged path → `Resources/dist-mcp/index.js` (the real location).
- Mirrors the existing `process.resourcesPath` convention already used in the same file for `bundled-harness/skills` (line ~863).
- `npx tsc -p electron/tsconfig.json --noEmit` → **passes** (0 errors).

## What you need to do

1. `cd ~/Documents/programming/Marblo/v3`
2. `git checkout -b fix/mcp-dist-mcp-asar-path` (fix is currently uncommitted on `main`).
3. Review the diff (`git diff electron/agent-config.ts`) → commit.
4. Rebuild + repackage: `npm run build:mac` (runs `build:electron` → `electron-builder --mac`).
5. Install the new `.app`, relaunch, spawn an agent, run `/mcp`.
6. **Pass criteria:**
   - `/mcp` shows `marblo` connected.
   - Generated config `$TMPDIR/marblo-agent-configs/claude-mcp-*.json` → `marblo.args[0]` ends with `Resources/dist-mcp/index.js` (no `app.asar/dist-mcp`).
   - `add_activity` / `submit_for_review` tool calls succeed.

## Recommended follow-up (optional, same PR)

Add a fail-fast guard where the agent config is generated: if `getMCPServerPath()`
doesn't exist on disk, throw/log a clear error at generation time instead of leaking
a downstream `-32000`. Prevents silent recurrence if the packaging layout changes again.

## Notes

- No TaskForce ticket filed — the TaskForce MCP itself is the outage subject (can't create a ticket while it's down). File retroactively post-rebuild.
- Full technical write-up: `v3/docs/BUGREPORT_mcp_dist-mcp_asar_path.md`.
