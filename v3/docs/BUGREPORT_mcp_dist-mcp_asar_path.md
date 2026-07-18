# Bug Report: Marblo MCP fails to connect in packaged app (`-32000 Connection closed`)

**Date:** 2026-07-08
**Severity:** High — Marblo MCP (TaskForce tools) is completely unusable in the packaged `.app`
**Status:** Root cause found · fix applied to source · **rebuild required**

---

## Symptom

In Claude Code (and any agent launched by the packaged Marblo app), the `marblo`
MCP server fails to connect. `/mcp` shows:

```
Failed to reconnect to marblo: -32000
```

MCP log (`~/Library/Caches/claude-cli-nodejs/<project>/mcp-logs-marblo/*.jsonl`):

```
Server stderr: node:internal/modules/cjs/loader:1235
Error: Cannot find module '/Applications/Marblo.app/Contents/Resources/app.asar/dist-mcp/index.js'
  code: 'MODULE_NOT_FOUND'
Node.js v20.18.3
Connection failed: MCP error -32000: Connection closed
```

## Root cause

Path/packaging mismatch between how `dist-mcp` is **shipped** and how its path is
**resolved** at runtime.

1. **Shipped as an extraResource (outside the asar).** `electron-builder.yml`:
   ```yaml
   extraResources:
     - from: "dist-mcp"
       to: "dist-mcp"        # => /Applications/Marblo.app/Contents/Resources/dist-mcp/
       filter: ["**/*"]
   ```
   Verified present: `Resources/dist-mcp/index.js` (5,879 bytes). The asar itself
   contains only `dist`, `dist-electron`, `node_modules`, `skills` — **no `dist-mcp`**.

2. **Resolved as if inside the asar.** `electron/agent-config.ts` → `getMCPServerPath()`:
   ```ts
   return path.resolve(__dirname, "..", "dist-mcp", "index.js");
   ```
   - **Dev** (`npm run dev`): `__dirname = v3/dist-electron` → `v3/dist-mcp/index.js` ✅
   - **Packaged**: `__dirname = Resources/app.asar/dist-electron` → resolves to
     `Resources/app.asar/dist-mcp/index.js` ❌ (does not exist → `MODULE_NOT_FOUND`).

The generated per-agent config
(`$TMPDIR/marblo-agent-configs/claude-mcp-*.json`) therefore contains a broken
`args` path, and because Marblo launches Claude with `--strict-mcp-config`, no
user-side config (`~/.claude/.mcp.json`, `~/.claude.json`) can override it.

### Why it started on Jul 7–8
The Jul 5 configs pointed at the **dev** electron + `v3/dist-mcp/index.js` (worked).
After switching to the packaged app (`Marblo.app`, asar rebuilt Jul 7 18:42), the
resolver produced the in-asar path and began crashing. The app-side generator regressed;
nothing in the user's environment changed.

## Fix (applied)

`electron/agent-config.ts` — resolve against `process.resourcesPath` when packaged,
mirroring the existing `bundled-harness/skills` convention in the same file:

```ts
function getMCPServerPath(): string {
  if (__dirname.includes("app.asar")) {
    return path.join(process.resourcesPath, "dist-mcp", "index.js");
  }
  return path.resolve(__dirname, "..", "dist-mcp", "index.js");
}
```

- Dev path unchanged.
- Packaged path → `Resources/dist-mcp/index.js` (the real extraResource location).
- `npx tsc -p electron/tsconfig.json --noEmit` passes.

## Verification / rebuild

1. Rebuild + repackage: `npm run build:mac` (→ `electron-builder --mac`).
2. Install the new `.app`, relaunch, spawn an agent, run `/mcp` → `marblo` connected.
3. Confirm generated config `args` now points at `Resources/dist-mcp/index.js`.

## Immediate workaround (no rebuild)

Run Marblo in **dev mode** from `v3/` (`npm run dev`) — the resolver picks the
working `v3/dist-mcp/index.js` path, so `marblo` MCP connects normally.

## Notes

- Consider a startup assertion: if `getMCPServerPath()` does not exist on disk,
  log a clear error at agent-config generation time instead of surfacing only as a
  downstream `-32000`.
- No TaskForce ticket was filed for this fix because the TaskForce MCP itself is the
  subject of the outage (chicken-and-egg). File one retroactively after the rebuild.
