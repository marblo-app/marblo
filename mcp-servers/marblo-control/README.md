# Marblo Control MCP

The MCP server an orchestrator uses to run the board: create and dispatch tickets, spawn and track agents, and record decisions.

## This one is not standalone

**It ships inside the Marblo app** and talks to the app's board. There is nothing here to install separately, and no upstream to fetch — this manifest exists so the item appears in the Store catalog with its permissions declared like everything else.

If you are looking for portable assets, start with the [skills](../../skills/), [agents](../../agents/), and [knowledge packs](../../knowledge/) — those work with or without Marblo.

## Details

- **Manifest:** [`marblo.yaml`](marblo.yaml) · **Tier:** `official` (bundled with the app)
- **Permissions:** `repository:read`, `network:outbound`
- **License:** MIT
