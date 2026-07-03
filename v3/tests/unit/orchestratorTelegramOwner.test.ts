import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { OrchestratorManager } from "../../electron/orchestrator-manager";

/**
 * Regression tests for the Telegram single-owner gating.
 *
 * Root cause (ticket 4OWJYEv7MtQwog0U0YVZ): a project can have TWO live
 * orchestrators at once — the resident board orchestrator (kind="board") and
 * an on-demand mission orchestrator (kind="mission") — and BOTH used to inject
 * `--channels plugin:telegram` unconditionally. Claude then spawns a getUpdates
 * poller per orchestrator, and Telegram's single-consumer getUpdates makes the
 * two pollers evict each other with HTTP 409 → continuous disconnection even in
 * steady state.
 *
 * The fix: exactly ONE orchestrator per project owns Telegram, decided via a
 * per-project owner lock. Ownership identity is the orchestrator's stable
 * sessionId (board vs mission differ), so two DIFFERENT instances in the SAME
 * OS process (same pid) still can't both own it — unlike the resume lock, which
 * lets the same pid re-attach. Liveness is pure PID-liveness (NO TTL): the
 * telegram owner is long-lived (hours), so a TTL would wrongly reclaim it from a
 * still-running board.
 */
describe("OrchestratorManager Telegram single-owner lock", () => {
  let tmpHome: string;
  let homedirSpy: ReturnType<typeof vi.spyOn>;
  const rootPath = "/proj/marblo-tg-owner";
  const encoded = rootPath.replace(/[^a-zA-Z0-9]/g, "-");
  const PROJECT = "proj-1";
  const BOARD_OWNER = `orchestrator-${PROJECT}`;
  const MISSION_OWNER = `orchestrator-mission-${PROJECT}`;

  function sessionsDir(): string {
    return path.join(tmpHome, ".claude", "projects", encoded);
  }
  function ownersPath(): string {
    return path.join(sessionsDir(), "marblo-telegram-owner.json");
  }
  function readOwners(): Record<
    string,
    {
      ownerId: string;
      ptySessionId: string;
      kind: string;
      pid: number;
      updatedAt: number;
    }
  > {
    return JSON.parse(fs.readFileSync(ownersPath(), "utf-8"));
  }
  function writeOwners(obj: Record<string, unknown>): void {
    fs.writeFileSync(ownersPath(), JSON.stringify(obj), "utf-8");
  }

  type OwnerApi = {
    acquireTelegramOwner: (
      r: string,
      projectId: string,
      ownerId: string,
      pty: string,
    ) => boolean;
    releaseTelegramOwner: (
      r: string,
      projectId: string,
      ownerId: string,
    ) => void;
    isTelegramOwnerLive: (r: string, projectId: string) => boolean;
  };
  function makeManager(kind = "board"): OrchestratorManager & OwnerApi {
    const ptyManager = { onDanger: vi.fn(() => vi.fn()) };
    return new OrchestratorManager(
      ptyManager as never,
      {} as never,
      undefined,
      kind,
    ) as OrchestratorManager & OwnerApi;
  }

  beforeEach(() => {
    tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "orch-tg-owner-"));
    fs.mkdirSync(sessionsDir(), { recursive: true });
    homedirSpy = vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    homedirSpy.mockRestore();
    fs.rmSync(tmpHome, { recursive: true, force: true });
  });

  it("board acquires on a free project and writes an owner lock", () => {
    const board = makeManager("board");
    expect(
      board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-board"),
    ).toBe(true);
    const lock = readOwners()[PROJECT];
    expect(lock.ownerId).toBe(BOARD_OWNER);
    expect(lock.kind).toBe("board");
    expect(lock.pid).toBe(process.pid);
  });

  it("REFUSES a mission (same process, different owner) while the board holds it — the 409 fix", () => {
    const board = makeManager("board");
    const mission = makeManager("mission");
    expect(
      board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-board"),
    ).toBe(true);
    // The mission runs in the SAME process (same pid) but is a different
    // instance — it must NOT also grab telegram (would spawn a 2nd poller).
    expect(
      mission.acquireTelegramOwner(
        rootPath,
        PROJECT,
        MISSION_OWNER,
        "pty-mission",
      ),
    ).toBe(false);
    // Board's lock is left untouched.
    expect(readOwners()[PROJECT].ownerId).toBe(BOARD_OWNER);
  });

  it("lets a mission take over after the board releases (handover / board-absent case)", () => {
    const board = makeManager("board");
    const mission = makeManager("mission");
    board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-board");
    board.releaseTelegramOwner(rootPath, PROJECT, BOARD_OWNER);
    expect(readOwners()[PROJECT]).toBeUndefined();
    expect(
      mission.acquireTelegramOwner(
        rootPath,
        PROJECT,
        MISSION_OWNER,
        "pty-mission",
      ),
    ).toBe(true);
    expect(readOwners()[PROJECT].ownerId).toBe(MISSION_OWNER);
  });

  it("always lets the SAME owner re-acquire its own lock (crash auto-restart)", () => {
    const board = makeManager("board");
    board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-old");
    // Crash restart: same ownerId, new pty id — must succeed and repoint.
    expect(
      board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-new"),
    ).toBe(true);
    expect(readOwners()[PROJECT].ptySessionId).toBe("pty-new");
  });

  it("STEALS an owner lock whose owning process is dead (cross-process fleet)", () => {
    const DEAD = 424243;
    vi.spyOn(process, "kill").mockImplementation((() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);
    writeOwners({
      [PROJECT]: {
        ownerId: "orchestrator-other-proc",
        ptySessionId: "pty-dead",
        kind: "board",
        pid: DEAD,
        updatedAt: Date.now(),
      },
    });
    const board = makeManager("board");
    expect(
      board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-mine"),
    ).toBe(true);
    expect(readOwners()[PROJECT].pid).toBe(process.pid);
  });

  it("REFUSES when a DIFFERENT live process (another Electron/fleet) owns it", () => {
    const FOREIGN = 424242;
    vi.spyOn(process, "kill").mockImplementation(((pid: number) => {
      if (pid === FOREIGN) return true;
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);
    writeOwners({
      [PROJECT]: {
        ownerId: "orchestrator-other-proc",
        ptySessionId: "pty-foreign",
        kind: "board",
        pid: FOREIGN,
        updatedAt: Date.now(),
      },
    });
    const board = makeManager("board");
    expect(
      board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-mine"),
    ).toBe(false);
    expect(readOwners()[PROJECT].pid).toBe(FOREIGN);
  });

  it("does NOT reclaim a still-live owner just because the lock is old (no TTL staleness)", () => {
    // A long-lived board: lock written hours ago, pid still alive.
    vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill,
    );
    writeOwners({
      [PROJECT]: {
        ownerId: BOARD_OWNER,
        ptySessionId: "pty-board",
        kind: "board",
        pid: 999997,
        updatedAt: Date.now() - 6 * 60 * 60 * 1000, // 6 hours old
      },
    });
    const mission = makeManager("mission");
    expect(
      mission.acquireTelegramOwner(
        rootPath,
        PROJECT,
        MISSION_OWNER,
        "pty-mission",
      ),
    ).toBe(false);
  });

  it("release removes only a lock we own, never a foreign one", () => {
    const board = makeManager("board");
    board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-board");
    // Wrong ownerId → no-op.
    board.releaseTelegramOwner(rootPath, PROJECT, MISSION_OWNER);
    expect(readOwners()[PROJECT]?.ownerId).toBe(BOARD_OWNER);
    // Correct ownerId → removed.
    board.releaseTelegramOwner(rootPath, PROJECT, BOARD_OWNER);
    expect(readOwners()[PROJECT]).toBeUndefined();
  });

  it("isTelegramOwnerLive reflects a live pid and a free/dead project", () => {
    const board = makeManager("board");
    expect(board.isTelegramOwnerLive(rootPath, PROJECT)).toBe(false); // free
    vi.spyOn(process, "kill").mockImplementation(
      (() => true) as typeof process.kill,
    );
    board.acquireTelegramOwner(rootPath, PROJECT, BOARD_OWNER, "pty-board");
    expect(board.isTelegramOwnerLive(rootPath, PROJECT)).toBe(true);
    vi.restoreAllMocks();
    vi.spyOn(os, "homedir").mockReturnValue(tmpHome);
    // Now pid probes dead → not live.
    vi.spyOn(process, "kill").mockImplementation((() => {
      throw Object.assign(new Error("ESRCH"), { code: "ESRCH" });
    }) as typeof process.kill);
    expect(board.isTelegramOwnerLive(rootPath, PROJECT)).toBe(false);
  });
});
