/**
 * Sweep for ORPHANED per-agent marblo MCP servers (`dist-mcp/index.js`).
 *
 * PtyManager.killProcessTree() reaps an agent's MCP child deterministically when
 * the agent is killed EXPLICITLY (stop / restart / reuse / quit). But when an
 * agent's CLI exits on its OWN (task done, crash, or a Codex CLI whose detached
 * MCP child outlives it), the MCP server reparents to launchd (ppid=1) and there
 * is no live pty child left to walk down from — so those orphans accumulate over
 * a churning session (observed: 20+ ppid=1 dist-mcp holding bridge connections).
 *
 * This periodic sweep catches exactly those: a dist-mcp process that is orphaned
 * (ppid === 1) AND carries OUR Electron instance's MARBLO_BRIDGE_PORT in its
 * environment. Both conditions are load-bearing — see selectOrphanMcpPids. A
 * live agent's MCP server always has a live CLI parent (ppid !== 1), so this can
 * never kill a running agent's server; the bridge-port match keeps it from
 * touching a sibling Electron instance's (or another user's) servers.
 */

import { readProcEnvTree, selectOrphanMcpPids } from "./proc-tree";

// How often to sweep. Orphans are harmless individually (they just hold a dead
// bridge connection); the leak is cumulative, so a slow cadence is plenty and
// keeps `ps -Eww` (a full env snapshot) off the hot path.
const SWEEP_INTERVAL_MS = 60_000;

let sweepTimer: NodeJS.Timeout | null = null;

/**
 * Find and SIGKILL our own orphaned dist-mcp children. Returns the pids it
 * killed (for logging/tests). No-op — returns [] — when MARBLO_BRIDGE_PORT is
 * unset (nothing to attribute against) or on a non-darwin platform (readProcEnvTree
 * returns []). Safe to call any number of times.
 */
export function reapOrphanedMcpChildren(): number[] {
  const ourPort = process.env.MARBLO_BRIDGE_PORT;
  if (!ourPort) return [];

  const pids = selectOrphanMcpPids(readProcEnvTree(), ourPort);
  const killed: number[] = [];
  for (const pid of pids) {
    if (!Number.isInteger(pid) || pid <= 1) continue; // never signal a group / init
    try {
      process.kill(pid, "SIGKILL");
      killed.push(pid);
    } catch {
      // ESRCH (already gone) / EPERM (not ours) — nothing to reclaim.
    }
  }
  if (killed.length) {
    console.warn(
      `[McpOrphanReaper] reaped ${killed.length} orphaned dist-mcp child(ren): ${killed.join(", ")}`,
    );
  }
  return killed;
}

/**
 * Start the periodic orphan sweep. Idempotent; the interval is unref'd so it
 * never keeps the event loop (or app shutdown) alive. Runs one immediate sweep
 * so long-lived orphans from a previous run are cleared at startup.
 */
export function startMcpOrphanReaper(): void {
  if (sweepTimer) return;
  reapOrphanedMcpChildren();
  sweepTimer = setInterval(reapOrphanedMcpChildren, SWEEP_INTERVAL_MS);
  sweepTimer.unref?.();
}

export function stopMcpOrphanReaper(): void {
  if (sweepTimer) {
    clearInterval(sweepTimer);
    sweepTimer = null;
  }
}
