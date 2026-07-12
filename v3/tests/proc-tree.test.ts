import { describe, it, expect } from "vitest";
import {
  parsePidPpid,
  collectDescendants,
  parsePsEnvRows,
  selectOrphanMcpPids,
} from "../electron/proc-tree";

describe("parsePidPpid", () => {
  it("parses two-column ps output, tolerating leading whitespace", () => {
    const out = ["  100   1", "200 100", "300   200", "garbage line", ""].join(
      "\n",
    );
    expect(parsePidPpid(out)).toEqual([
      { pid: 100, ppid: 1 },
      { pid: 200, ppid: 100 },
      { pid: 300, ppid: 200 },
    ]);
  });
});

describe("collectDescendants", () => {
  const rows = [
    { pid: 100, ppid: 1 }, // electron main
    { pid: 200, ppid: 100 }, // claude CLI (pty child)
    { pid: 210, ppid: 200 }, // claude's dist-mcp (same group)
    { pid: 300, ppid: 100 }, // node codex (pty child)
    { pid: 310, ppid: 300 }, // codex binary
    { pid: 320, ppid: 310 }, // codex's dist-mcp (DETACHED into own pgid)
    { pid: 400, ppid: 1 }, // unrelated orphan
  ];

  it("returns every transitive descendant, excluding the root", () => {
    expect(collectDescendants(rows, 200).sort()).toEqual([210]);
    // Codex: the detached dist-mcp (320) is still a ppid-descendant while alive,
    // so a group-independent tree-walk reaches it — the core of the fix.
    expect(collectDescendants(rows, 300).sort()).toEqual([310, 320]);
  });

  it("returns [] for a leaf / unknown pid", () => {
    expect(collectDescendants(rows, 320)).toEqual([]);
    expect(collectDescendants(rows, 99999)).toEqual([]);
  });

  it("does not loop on a self-parented or cyclic table", () => {
    const cyclic = [
      { pid: 500, ppid: 500 }, // self-parent
      { pid: 600, ppid: 700 },
      { pid: 700, ppid: 600 }, // 2-cycle
    ];
    expect(collectDescendants(cyclic, 500)).toEqual([]);
    // 600↔700 cycle: each is the other's child; walk terminates via visited set.
    expect(collectDescendants(cyclic, 600).sort()).toEqual([700]);
  });
});

describe("parsePsEnvRows", () => {
  it("splits pid, ppid, and the command+env remainder", () => {
    const line =
      "11772     1 /path/Electron /path/dist-mcp/index.js ELECTRON_RUN_AS_NODE=1 MARBLO_BRIDGE_PORT=63888 MARBLO_AGENT_ID=abc";
    expect(parsePsEnvRows(line)).toEqual([
      {
        pid: 11772,
        ppid: 1,
        rest: "/path/Electron /path/dist-mcp/index.js ELECTRON_RUN_AS_NODE=1 MARBLO_BRIDGE_PORT=63888 MARBLO_AGENT_ID=abc",
      },
    ]);
  });
});

describe("selectOrphanMcpPids", () => {
  const rows = parsePsEnvRows(
    [
      // (1) our orphaned dist-mcp — ppid=1, our port → REAP
      "11772 1 /Electron /v3/dist-mcp/index.js ELECTRON_RUN_AS_NODE=1 MARBLO_BRIDGE_PORT=63888 MARBLO_AGENT_ID=a",
      // (2) LIVE dist-mcp — parented to its CLI (ppid!=1) → keep
      "10820 10797 /Electron /v3/dist-mcp/index.js MARBLO_BRIDGE_PORT=63888 MARBLO_AGENT_ID=b",
      // (3) a SIBLING Electron instance's orphan — different port → keep
      "22222 1 /Electron /v3/dist-mcp/index.js MARBLO_BRIDGE_PORT=51111 MARBLO_AGENT_ID=c",
      // (4) unrelated orphaned process → keep
      "33333 1 /usr/bin/some-daemon --serve",
      // (5) prefix-collision guard: PORT=638888 must NOT match 63888
      "44444 1 /Electron /v3/dist-mcp/index.js MARBLO_BRIDGE_PORT=638888",
    ].join("\n"),
  );

  it("reaps only our own orphaned dist-mcp children", () => {
    expect(selectOrphanMcpPids(rows, "63888")).toEqual([11772]);
  });

  it("reaps nothing when we have no bridge port (no attribution key)", () => {
    expect(selectOrphanMcpPids(rows, undefined)).toEqual([]);
    expect(selectOrphanMcpPids(rows, "")).toEqual([]);
  });
});
