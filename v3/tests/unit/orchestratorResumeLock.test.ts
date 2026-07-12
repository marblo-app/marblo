import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { OrchestratorManager } from "../../electron/orchestrator-manager";

/**
 * Regression tests for the concurrent-`--resume` guard.
 *
 * Root cause (ticket vosmtig9yb7K0M6QJUnw): two LIVE orchestrator instances —
 * e.g. two worktrees in the fleet, which are separate OS processes — that
 * `--resume` the SAME claude session id at once make Claude Code render the
 * second PTY blank. The user's existing conversation appears to vanish. The
 * fix takes an advisory cross-process lock keyed on the resumed session id;
 * liveness is decided primarily by whether the owning PID is still running,
 * with a TTL only as a PID-reuse backstop.
 */
describe("OrchestratorManager concurrent-resume lock", () => {
  let tmpHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  const rootPath = "/proj/marblo-lock";
  const encoded = rootPath.replace(/[^a-zA-Z0-9]/g, "-");
  const SID = "11111111-2222-3333-4444-555555555555";

  function sessionsDir(): string {
    return path.join(tmpHome, ".claude", "projects", encoded);
  }
  function locksPath(): string {
    return path.join(sessionsDir(), "marblo-orch-locks.json");
  }
  function mutexPath(): string {
    return locksPath() + ".lock";
  }
  function readLocks(): Record<
    string,
    { ptySessionId: string; kind: string; pid: number; updatedAt: number }
  > {
    return JSON.parse(fs.readFileSync(locksPath(), "utf-8"));
  }
  function writeLocks(obj: Record<string, unknown>): void {
    fs.writeFileSync(locksPath(), JSON.stringify(obj), "utf-8");
  }

  // Reach the private lock API the way the existing label test reaches
  // private methods — a typed cast, no behavior change.
  type LockApi = {
    acquireResumeLock: (r: string, s: string, p: string) => boolean;
    releaseResumeLock: (r: string, s: string) => void;
  };
  function makeManager(kind = "board"): OrchestratorManager & LockApi {
    const ptyManager = { onDanger: vi.fn(() => vi.fn()) };
    return new OrchestratorManager(
      ptyManager as never,
      {} as never,
      undefined,
      kind,
    ) as OrchestratorManager & LockApi;
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "orch-lock-"));
    fs.mkdirSync(sessionsDir(), { recursive: true });
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("acquires on a free session and writes a lock owned by this process", () => {
    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-1")).toBe(true);
    const lock = readLocks()[SID];
    expect(lock.pid).toBe(process.pid);
    expect(lock.ptySessionId).toBe("pty-1");
    expect(lock.kind).toBe("board");
  });

  it("REFUSES when another live process already holds the session", () => {
    // A foreign pid that the liveness probe reports as alive.
    const FOREIGN = 424242;
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
      if (pid === FOREIGN) return true;
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);
    writeLocks({
      [SID]: {
        ptySessionId: "pty-foreign",
        kind: "board",
        pid: FOREIGN,
        updatedAt: Date.now(),
      },
    });

    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-mine")).toBe(false);
    // The foreign lock is left untouched (not stolen).
    expect(readLocks()[SID].pid).toBe(FOREIGN);
  });

  it("STEALS a lock whose owning process is dead", () => {
    const DEAD = 424243;
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
      if (pid === DEAD)
        throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);
    writeLocks({
      [SID]: {
        ptySessionId: "pty-dead",
        kind: "board",
        pid: DEAD,
        updatedAt: Date.now(),
      },
    });

    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-mine")).toBe(true);
    expect(readLocks()[SID].pid).toBe(process.pid);
  });

  it("STEALS a stale lock (past TTL) even if the owning pid still appears alive", () => {
    const FOREIGN = 424244;
    vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill,
    );
    writeLocks({
      [SID]: {
        ptySessionId: "pty-stale",
        kind: "board",
        pid: FOREIGN,
        // 11 minutes old — beyond the 10-minute TTL backstop.
        updatedAt: Date.now() - 11 * 60 * 1000,
      },
    });

    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-mine")).toBe(true);
    expect(readLocks()[SID].pid).toBe(process.pid);
  });

  it("always lets the SAME process re-acquire its own lock (crash restart)", () => {
    writeLocks({
      [SID]: {
        ptySessionId: "pty-old",
        kind: "board",
        pid: process.pid,
        updatedAt: Date.now(),
      },
    });
    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-new")).toBe(true);
    expect(readLocks()[SID].ptySessionId).toBe("pty-new");
  });

  // ── P3-5: exclusive-lockfile mutex around the RMW ─────────────────────
  it("releases the mutex lockfile after a successful acquire (no leak)", () => {
    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-1")).toBe(true);
    expect(fs.existsSync(mutexPath())).toBe(false);
  });

  it("fails safe to FRESH when a live peer holds the mutex mid-RMW", () => {
    // A fresh mutex file = another process is inside its critical section.
    fs.writeFileSync(mutexPath(), "");
    const mgr = makeManager();
    // Even though the session itself is free, we refuse rather than race the
    // read-modify-write (TOCTOU → double --resume → blank PTY).
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-mine")).toBe(false);
    // No lock was written, and the peer's mutex is left intact.
    expect(fs.existsSync(locksPath())).toBe(false);
    expect(fs.existsSync(mutexPath())).toBe(true);
  });

  it("reclaims a STALE mutex left by a crashed process and proceeds", () => {
    fs.writeFileSync(mutexPath(), "");
    // Backdate the mutex well beyond the 15s staleness backstop.
    const old = new Date(Date.now() - 60 * 1000);
    fs.utimesSync(mutexPath(), old, old);
    const mgr = makeManager();
    expect(mgr.acquireResumeLock(rootPath, SID, "pty-mine")).toBe(true);
    expect(readLocks()[SID].pid).toBe(process.pid);
    // Reclaimed then released — no leak.
    expect(fs.existsSync(mutexPath())).toBe(false);
  });

  it("release removes only a lock we own, never a foreign one", () => {
    const mgr = makeManager();
    // Own lock → released.
    mgr.acquireResumeLock(rootPath, SID, "pty-1");
    mgr.releaseResumeLock(rootPath, SID);
    expect(readLocks()[SID]).toBeUndefined();

    // Foreign lock → left intact.
    writeLocks({
      [SID]: {
        ptySessionId: "pty-foreign",
        kind: "board",
        pid: 999998,
        updatedAt: Date.now(),
      },
    });
    mgr.releaseResumeLock(rootPath, SID);
    expect(readLocks()[SID].pid).toBe(999998);
  });
});
