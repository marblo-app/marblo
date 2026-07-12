/**
 * Behavioral proof for the dist-mcp reap fix (ticket cgzUJYRv): a real process
 * tree whose grandchild is DETACHED into its own process group — exactly how
 * Codex spawns `dist-mcp/index.js`. Validates that the ppid tree-walk
 * (collectDescendants) reaches the detached grandchild while a group-scoped
 * `kill(-pgid)` provably would not, and that killing it by positive pid reaps it.
 */
import { describe, it, expect, afterEach } from "vitest";
import { spawn, execFileSync } from "child_process";
import { collectDescendants, readProcTree } from "../../electron/proc-tree";

const isAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code !== "ESRCH";
  }
};
const pgidOf = (pid: number): number =>
  Number(
    execFileSync("ps", ["-o", "pgid=", "-p", String(pid)], {
      encoding: "utf8",
    }).trim(),
  );
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

let rootPid = 0;
let gcPid = 0;

afterEach(() => {
  for (const pid of [gcPid, rootPid]) {
    if (pid > 1 && isAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
  }
  rootPid = gcPid = 0;
});

describe("dist-mcp detached-grandchild reap (Codex topology)", () => {
  it("tree-walk finds a detached grandchild that group-kill would miss, and reaping it by pid works", async () => {
    // root → (spawns) grandchild DETACHED into its own session/group, mimicking
    // the codex CLI spawning its MCP server. root prints the grandchild pid.
    const rootSrc = `
      const { spawn } = require('child_process');
      const gc = spawn('sleep', ['60'], { detached: true, stdio: 'ignore' });
      gc.unref();
      process.stdout.write(String(gc.pid) + '\\n');
      setInterval(() => {}, 1000);
    `;
    const root = spawn(process.execPath, ["-e", rootSrc], {
      stdio: ["ignore", "pipe", "ignore"],
    });
    rootPid = root.pid!;
    gcPid = await new Promise<number>((resolve, reject) => {
      const t = setTimeout(
        () => reject(new Error("root never printed gc pid")),
        5000,
      );
      root.stdout!.once("data", (b) => {
        clearTimeout(t);
        resolve(Number(String(b).trim()));
      });
    });

    // Let the OS settle the new pids into the process table.
    await sleep(200);
    expect(gcPid).toBeGreaterThan(1);
    expect(isAlive(gcPid)).toBe(true);

    // The grandchild is genuinely DETACHED: its process group differs from
    // root's, so `kill(-rootPgid)` (what killProcessTree did before) can't reach it.
    expect(pgidOf(gcPid)).not.toBe(pgidOf(rootPid));

    // The fix: a ppid tree-walk from root sees the detached grandchild anyway.
    const descendants = collectDescendants(readProcTree(), rootPid);
    expect(descendants).toContain(gcPid);

    // Reaping descendants by positive pid actually kills the detached grandchild.
    for (const d of descendants) {
      try {
        process.kill(d, "SIGKILL");
      } catch {
        /* already gone */
      }
    }
    await sleep(200);
    expect(isAlive(gcPid)).toBe(false);
  });
});
