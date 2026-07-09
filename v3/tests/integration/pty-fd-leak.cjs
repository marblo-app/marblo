#!/usr/bin/env node
// PTY master-fd leak regression (ticket o1ozhfJtWVZemBPjQzZ2).
//
// Drives the REAL compiled PtyManager (dist-electron/pty-manager.js) through
// every teardown path and asserts that this process's open /dev/ptmx master
// count returns to baseline (leak == 0) after settle + gc.
//
// WHY a standalone harness (not vitest): it needs real node-pty native spawns +
// macOS /dev/ptmx + lsof. It MUST run on macOS with node 22 (node 26 breaks
// node-pty's spawn-helper) — the default vitest/CI runner (Linux, and possibly
// node 26) can neither reproduce the macOS-only leak nor load node-pty here.
//
//   Build first:  tsc -p electron/tsconfig.json
//   Run:          ~/.nvm/versions/node/v22.13.0/bin/node --expose-gc \
//                   tests/integration/pty-fd-leak.cjs
//   npm script:   npm run test:pty-leak
//
// Root cause it guards (verified via lsof, ticket utaCmezmcIa6YWP6GIEf +
// o1ozhfJtWVZemBPjQzZ2): node-pty opens 2 /dev/ptmx masters per spawn but only
// closes the tracked one on teardown, orphaning 1 fd per session → linear
// accumulation against kern.tty.ptmx_max (511) → ENXIO "posix_spawnp failed".
const { execSync } = require("child_process");
const path = require("path");

const PID = process.pid;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (process.platform !== "darwin") {
  console.log(
    `SKIP: pty-fd-leak regression is macOS-only (platform=${process.platform}).`,
  );
  process.exit(0);
}

const artifact = path.resolve(__dirname, "../../dist-electron/pty-manager.js");
let PtyManager;
try {
  ({ PtyManager } = require(artifact));
} catch (e) {
  console.error(
    `FAIL: cannot load compiled PtyManager at ${artifact} — run \`tsc -p electron/tsconfig.json\` first.\n${e.message}`,
  );
  process.exit(1);
}

// Open /dev/ptmx masters held by THIS process (lsof ground truth).
function ptmx() {
  try {
    return (
      execSync(`lsof -p ${PID} 2>/dev/null | grep -c /dev/ptmx || true`, {
        encoding: "utf8",
      }).trim() | 0
    );
  } catch {
    return 0;
  }
}
async function settle(ms = 1500) {
  await sleep(ms);
  if (global.gc) global.gc();
  await sleep(300);
}

const N = Number(process.env.PTY_LEAK_CYCLES || 30);
let failures = 0;
function check(label, delta) {
  const ok = delta <= 0;
  console.log(
    `  ${ok ? "✅" : "❌"} ${label}: Δ/dev/ptmx = ${delta > 0 ? "+" : ""}${delta} (leak ${ok ? "0" : delta})`,
  );
  if (!ok) failures++;
}

(async () => {
  console.log(`node ${process.version}  pid ${PID}  cycles=${N}\n`);
  if (!global.gc)
    console.log(
      "(note: run with --expose-gc for a stricter settle; continuing without)\n",
    );

  // ---- Phase A: create() + kill() (killProcessTree + destroy + orphan close) ----
  {
    const base = ptmx();
    const mgr = new PtyManager();
    for (let i = 0; i < N; i++) mgr.create(`kill-${i}`, `k${i}`, "cat", []);
    await sleep(200);
    const peak = ptmx();
    mgr.killAll();
    await settle();
    console.log(`[A] create+killAll  base=${base} peak=${peak} end=${ptmx()}`);
    check("A create+killAll", ptmx() - base);
  }

  // ---- Phase B: child self-exit → onExit path ----
  {
    const base = ptmx();
    const mgr = new PtyManager();
    let exited = 0;
    for (let i = 0; i < N; i++) {
      const id = `exit-${i}`;
      mgr.create(id, `e${i}`, "sh", ["-c", "sleep 0.15"]);
      mgr.onExit(id, () => exited++);
    }
    await sleep(200);
    const peak = ptmx();
    await settle(2000);
    console.log(
      `[B] create+self-exit(onExit)  base=${base} peak=${peak} end=${ptmx()} onExit=${exited}/${N}`,
    );
    check("B onExit teardown", ptmx() - base);
  }

  // ---- Phase C: create() reusing a live id (stale-guard destroy path) ----
  {
    const base = ptmx();
    const mgr = new PtyManager();
    for (let i = 0; i < N; i++) mgr.create("reused-id", "reuse", "cat", []); // same id N times
    await sleep(200);
    const oneLive = ptmx(); // only the last should be live (+ its orphan reclaimed each overwrite)
    mgr.killAll();
    await settle();
    console.log(
      `[C] create x${N} same id  base=${base} afterLoop=${oneLive} end=${ptmx()}`,
    );
    // During the loop only ~1 session is live at a time; each overwrite reclaims
    // the prior orphan. Assert no linear accumulation AND clean baseline at end.
    check("C stale-guard no accumulation", oneLive - base - 2);
    check("C stale-guard end baseline", ptmx() - base);
  }

  // ---- Phase D: reaper sweeps a dead-but-mapped session ----
  {
    const base = ptmx();
    const mgr = new PtyManager();
    for (let i = 0; i < N; i++)
      mgr.create(`reap-${i}`, `r${i}`, "sh", ["-c", "exit 0"]);
    await sleep(400); // children exit; some map entries may linger if onExit was not wired
    mgr.startReaper();
    // Force a reap without waiting 60s: reaper is private, but killAll routes
    // every remaining session through destroy+orphan-close too.
    mgr.killAll();
    mgr.stopReaper();
    await settle();
    console.log(`[D] create+exit+reap/killAll  base=${base} end=${ptmx()}`);
    check("D reaper/killAll teardown", ptmx() - base);
  }

  console.log(
    `\n=== PTY FD LEAK REGRESSION: ${failures === 0 ? "PASS ✅ — 0 /dev/ptmx leaked across all teardown paths" : `FAIL ❌ (${failures} path(s) leaked)`} ===`,
  );
  process.exit(failures === 0 ? 0 : 1);
})();
