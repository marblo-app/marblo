/**
 * Process-tree utilities for deterministically reaping a PTY child's whole
 * descendant subtree — independent of process GROUPS.
 *
 * Why this exists (see ticket cgzUJYRv / investigation 7KUzlF3F):
 * PtyManager.killProcessTree() reaps by process GROUP (`kill(-pgid)`). That
 * works for Claude agents — the `claude` CLI is the PTY child and its own group
 * leader, and it spawns its marblo MCP server (`dist-mcp/index.js`) in the SAME
 * group. But Codex spawns its MCP servers DETACHED into their own process group
 * (empirically: `ps -o pgid` shows the dist-mcp child with pgid === its own pid,
 * distinct from the codex CLI's group). A group-scoped `kill(-pgid)` therefore
 * NEVER reaches Codex's dist-mcp child, so on teardown it reparents to launchd
 * (ppid === 1) and lingers as an orphan — holding a bridge connection and, over
 * a churning day, piling up (observed: 20+ ppid=1 dist-mcp orphans).
 *
 * A ppid tree-walk captured WHILE the CLI is still alive sees the detached
 * grandchild (it is still a ppid-descendant until its parent dies), so we can
 * SIGTERM/SIGKILL it directly by its positive pid. These helpers are pure so
 * the tree logic is unit-testable without spawning real processes; the thin
 * `ps`-executing wrappers live alongside.
 */

import { execFileSync } from "child_process";

export interface ProcRow {
  pid: number;
  ppid: number;
}

/**
 * Parse `ps -Ao pid=,ppid=` output (two integer columns, header suppressed by
 * the trailing `=`) into {pid, ppid} rows. Whitespace-tolerant; skips any line
 * that doesn't parse to two integers.
 */
export function parsePidPpid(stdout: string): ProcRow[] {
  const rows: ProcRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.trim().match(/^(\d+)\s+(\d+)\b/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]) });
  }
  return rows;
}

/**
 * Collect every transitive descendant pid of `rootPid` from a flat {pid, ppid}
 * table (BFS over the child index). The root itself is NOT included. Cycle- and
 * self-parent-safe via a visited set — a corrupt table (e.g. a pid listed as its
 * own parent) can never loop forever. Order is unspecified; callers signal each.
 */
export function collectDescendants(rows: ProcRow[], rootPid: number): number[] {
  const childrenOf = new Map<number, number[]>();
  for (const { pid, ppid } of rows) {
    if (pid === ppid) continue; // self-parent guard (never a real descendant)
    const list = childrenOf.get(ppid);
    if (list) list.push(pid);
    else childrenOf.set(ppid, [pid]);
  }
  const out: number[] = [];
  const seen = new Set<number>([rootPid]);
  const queue = [...(childrenOf.get(rootPid) ?? [])];
  while (queue.length) {
    const pid = queue.shift()!;
    if (seen.has(pid)) continue;
    seen.add(pid);
    out.push(pid);
    const kids = childrenOf.get(pid);
    if (kids) queue.push(...kids);
  }
  return out;
}

export interface PsEnvRow {
  pid: number;
  ppid: number;
  /** command line WITH appended environment (from `ps -Eww`). */
  rest: string;
}

/**
 * Parse `ps -Eww -o pid=,ppid=,command=` output. macOS/BSD `ps -E` appends the
 * process environment after the command on the same line, so `rest` contains
 * both the argv and `KEY=VALUE` env pairs. First two integer columns are pid and
 * ppid; everything after is `rest`.
 */
export function parsePsEnvRows(stdout: string): PsEnvRow[] {
  const rows: PsEnvRow[] = [];
  for (const line of stdout.split("\n")) {
    const m = line.match(/^\s*(\d+)\s+(\d+)\s+(.*)$/);
    if (!m) continue;
    rows.push({ pid: Number(m[1]), ppid: Number(m[2]), rest: m[3] });
  }
  return rows;
}

/**
 * From parsed `ps -Eww` rows, pick the pids of our OWN orphaned dist-mcp
 * children — the ones safe to SIGKILL. All three conditions are required:
 *  1. `rest` runs `dist-mcp/index.js` (it is a marblo MCP server),
 *  2. it is ORPHANED (ppid === 1 — reparented to launchd because its CLI died);
 *     a live agent's dist-mcp always has a live CLI parent, so ppid === 1 is an
 *     exact orphan signal and can never match a running agent's server,
 *  3. its env carries OUR instance's `MARBLO_BRIDGE_PORT` — so a sibling Electron
 *     instance's (or another user's) MCP servers are never touched.
 *
 * The port is matched with boundaries so `...PORT=6388` never matches `63888`.
 * Returns [] when `ourBridgePort` is falsy (no attribution key → reap nothing).
 */
export function selectOrphanMcpPids(
  rows: PsEnvRow[],
  ourBridgePort: string | undefined,
): number[] {
  if (!ourBridgePort) return [];
  const portRe = new RegExp(
    `(^|\\s)MARBLO_BRIDGE_PORT=${ourBridgePort}(\\s|$)`,
  );
  const out: number[] = [];
  for (const { pid, ppid, rest } of rows) {
    if (ppid !== 1) continue;
    if (!rest.includes("dist-mcp/index.js")) continue;
    if (!portRe.test(rest)) continue;
    out.push(pid);
  }
  return out;
}

/** Snapshot the whole process table as {pid, ppid}. [] on any ps failure. */
export function readProcTree(): ProcRow[] {
  try {
    const out = execFileSync("ps", ["-Ao", "pid=,ppid="], {
      encoding: "utf8",
      maxBuffer: 8 * 1024 * 1024,
    });
    return parsePidPpid(out);
  } catch {
    return [];
  }
}

/**
 * Snapshot the process table WITH environment (`ps -Eww`). macOS/BSD only —
 * that's where the orphan-ptmx leak lives and where `-E` exposes same-uid env.
 * [] elsewhere or on any ps failure.
 */
export function readProcEnvTree(): PsEnvRow[] {
  if (process.platform !== "darwin") return [];
  try {
    const out = execFileSync("ps", ["-Eww", "-o", "pid=,ppid=,command="], {
      encoding: "utf8",
      maxBuffer: 32 * 1024 * 1024,
    });
    return parsePsEnvRows(out);
  } catch {
    return [];
  }
}
