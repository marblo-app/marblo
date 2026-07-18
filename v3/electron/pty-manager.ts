import * as pty from "node-pty";
import fs from "fs";
import os from "os";
import { detectDangerousCommand, type DangerMatch } from "./danger-command";
import { collectDescendants, readProcTree } from "./proc-tree";

/**
 * A pseudo-terminal MASTER fd that node-pty opens at spawn but neither exposes
 * nor closes on teardown — the ORPHAN. See PtyManager's fd-leak notes and
 * captureOrphanMasterFds. Stored as an (fd, rdev) pair so teardown can verify
 * the fd still points to the exact same device before closing it (a bare fd
 * number could be recycled by the OS to something we must not close).
 */
interface OrphanFd {
  fd: number;
  rdev: number;
}

export interface PtySession {
  id: string;
  name: string;
  process: pty.IPty;
  shell: string;
  /**
   * Orphaned pty master fd(s) captured for this session at spawn, closed on
   * teardown (destroyProcess). Empty on non-macOS / when none were detected.
   */
  orphanFds?: OrphanFd[];
}

/** Emitted when a dangerous command is detected on a writeAndSubmit. */
export interface DangerEvent {
  /** PTY session id the write was targeting. */
  sessionId: string;
  /** The text that triggered detection. */
  text: string;
  /** What matched. */
  match: DangerMatch;
  /** Whether the write was blocked (not sent) by the active policy. */
  blocked: boolean;
}

// Output that only appears once an agent CLI has actually accepted a submit
// (started a turn). Used by writeAndSubmit to confirm the Enter keystroke
// registered. Kept harness-agnostic but tuned for Claude Code:
//   - "esc to interrupt" — Claude/Codex/agy busy footer
//   - spinner glyphs ✻✶✳✽✢ — Claude working animation
//   - "↓ N tokens" / "tokens)" — streaming token counter
// Deliberately does NOT include the idle footer (`⏵⏵ auto mode`, `? for
// shortcuts`) which is present even when nothing was submitted.
const SUBMIT_SIGNAL = /esc to interrupt|[✻✶✳✽✢]|↓\s*\d+\s*tokens|tokens\)/i;

/**
 * True when a PTY output chunk shows the CLI is actively working (busy footer /
 * spinner / streaming token counter), NOT the idle footer. Exported so callers
 * that need an "is the orchestrator mid-turn?" signal (e.g. the Telegram poller's
 * un-replied nudge, which waits for a busy→idle transition) can reuse the exact
 * same detection writeAndSubmit uses, instead of duplicating a fragile regex.
 */
export function isBusySignal(data: string): boolean {
  return SUBMIT_SIGNAL.test(data);
}

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  private writeAndSubmitQueues: Map<string, Promise<boolean>> = new Map();

  // --- PTY master-fd leak guard ---
  // node-pty (1.1.0) opens TWO /dev/ptmx master devices per spawn on macOS: the
  // one it tracks (`proc.fd`, wrapped by its read stream) and a SECOND it never
  // exposes on the JS API (opened via `new tty.ReadStream(term.fd)` in
  // unixTerminal.js). `.kill()` only signals the child and closes nothing;
  // `.destroy()` closes the read stream's tracked fd — but NEITHER closes that
  // second, orphaned master. So both `.kill()` and `.destroy()` leak exactly one
  // /dev/ptmx per teardown (empirically confirmed via lsof; see ticket
  // o1ozhfJtWVZemBPjQzZ2). Leaked masters accumulate against macOS
  // `kern.tty.ptmx_max` (default 511); once exhausted, openpty() returns ENXIO
  // and EVERY subsequent agent/terminal spawn dies with a cryptic
  // "posix_spawnp failed". The fix: capture that orphan fd at spawn
  // (captureOrphanMasterFds) and `fs.closeSync()` it on every teardown path
  // (destroyProcess → releaseOrphanMasterFds), in addition to `.destroy()`ing
  // the tracked fd and sweeping dead-but-mapped sessions.
  private reaperTimer: ReturnType<typeof setInterval> | null = null;
  private static readonly REAP_INTERVAL_MS = 60_000;

  // --- Dangerous-command safety guard (MVP-P0-1) ---
  // Every writeAndSubmit is screened by detectDangerousCommand. Matches are
  // logged and broadcast to listeners. By default nothing is blocked (warn-only)
  // to preserve existing behavior; an operator can flip blocking on for the
  // non-isolated paths (e.g. the orchestrator, which drives the main checkout).
  private dangerListeners: Array<(e: DangerEvent) => void> = [];
  private blockDangerous = false;
  // Per-session block opt-in (P3-3). The global `blockDangerous` flag would
  // block EVERY writeAndSubmit — including worker dispatch instructions that
  // merely MENTION a dangerous command in their task text — which is a
  // regression for the worktree-isolated workers the danger module deliberately
  // leaves in warn-only mode. Instead the non-isolated orchestrator PTY opts its
  // own session into blocking (see setBlockDangerousForSession), so high-severity
  // commands aimed at the main checkout are actually dropped, not just logged.
  private blockDangerousSessions: Set<string> = new Set();

  /**
   * Subscribe to dangerous-command detections. Returns an unsubscribe fn.
   * Multiple subscribers are supported (orchestrator + future UI/IPC).
   */
  onDanger(listener: (e: DangerEvent) => void): () => void {
    this.dangerListeners.push(listener);
    return () => {
      this.dangerListeners = this.dangerListeners.filter((l) => l !== listener);
    };
  }

  /**
   * Policy flag: when true, a detected high-severity command is BLOCKED
   * (the write is dropped, never reaching the PTY). Medium-severity is always
   * warn-only. Defaults to false (warn-only for everything).
   */
  setBlockDangerous(block: boolean): void {
    this.blockDangerous = block;
  }

  /**
   * Per-session variant of the block policy (P3-3). When enabled for a session
   * id, a detected high-severity command targeting THAT session is BLOCKED even
   * while the global policy stays warn-only. Used by the orchestrator (which
   * drives the non-isolated main checkout) to enforce blocking on just its own
   * PTY without affecting worktree-isolated workers. Cleared automatically on
   * session teardown (kill / stale-replace); safe to call before the session
   * exists (the id is matched at write time).
   */
  setBlockDangerousForSession(sessionId: string, block: boolean): void {
    if (block) {
      this.blockDangerousSessions.add(sessionId);
    } else {
      this.blockDangerousSessions.delete(sessionId);
    }
  }

  private emitDanger(e: DangerEvent): void {
    for (const l of this.dangerListeners) {
      try {
        l(e);
      } catch (err) {
        console.error(
          `[PtyManager] danger listener threw: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  create(
    id: string,
    name: string,
    command?: string,
    args?: string[],
    cwd?: string,
    env?: Record<string, string>,
  ): PtySession {
    const shell =
      command ||
      (os.platform() === "win32"
        ? "powershell.exe"
        : process.env.SHELL || "/bin/zsh");
    const shellArgs = args || [];

    // fd-leak guard: PTY ids are deterministic and reused verbatim on
    // restart/relaunch/reuse. If a LIVE session still occupies this id (a
    // caller that skipped kill(), or an old process racing the new spawn),
    // release its master fd BEFORE we overwrite the map slot — otherwise the
    // old node-pty is dereferenced with its fd still open and leaks until quit.
    // Also frees a slot in the pty pool before we allocate a new one.
    const stale = this.sessions.get(id);
    if (stale) {
      console.warn(
        `[PtyManager] create() reusing live id "${id}" — destroying stale PTY first (fd-leak guard)`,
      );
      // Take down the stale child's whole process SUBTREE, not just the direct
      // child. destroyProcess() only .destroy()s node-pty — which SIGHUPs the
      // direct child and releases the master fd — but never reaches DETACHED
      // grandchildren (Codex's out-of-group marblo MCP `dist-mcp/index.js`, the
      // bun-wrapped Telegram poller). Without a group/subtree signal those
      // reparent to launchd and pile up as orphans (MCP -32000 / getUpdates 409),
      // exactly the leak kill() already guards against. A caller re-create()ing a
      // live deterministic id (e.g. `agent-<id>`) without an intervening kill()
      // hits this path, so mirror kill(): subtree-signal first, then release fd.
      this.killProcessTree(stale.process.pid);
      this.destroyProcess(stale.process, stale.orphanFds);
      this.sessions.delete(id);
    }

    // Snapshot our open pty-master fds BEFORE spawning so we can attribute the
    // orphan fd node-pty is about to leak (see captureOrphanMasterFds). Taken
    // immediately before pty.spawn (a synchronous native call) so nothing else
    // can open an fd in between — the diff is exact.
    const beforeFds = this.snapshotCharDevFds();

    let proc: pty.IPty;
    try {
      proc = pty.spawn(shell, shellArgs, {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: cwd || os.homedir(),
        env: env || (process.env as Record<string, string>),
      });
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      const msg = err instanceof Error ? err.message : String(err);
      // macOS caps live pty masters at kern.tty.ptmx_max (default 511). When
      // exhausted, openpty() returns ENXIO and node-pty surfaces it as the
      // opaque "posix_spawnp failed". This is almost always our own leaked
      // masters — sweep dead sessions now so a retry can succeed, and throw a
      // cause the caller/log can actually act on instead of a spawn riddle.
      if (
        code === "ENXIO" ||
        /ENXIO|posix_spawnp failed|openpty|out of pty|Device not configured/i.test(
          msg,
        )
      ) {
        console.error(
          `[PtyManager] PTY pool exhausted spawning "${shell}" (${
            code || "spawn error"
          }) — running reaper to reclaim leaked fds`,
        );
        this.reap();
        const e: NodeJS.ErrnoException = new Error(
          `PTY exhausted: the OS pseudo-terminal pool is full (likely leaked terminal sessions). Reclaimed dead sessions — retry. Original: ${msg}`,
        );
        e.code = code || "ENXIO";
        throw e;
      }
      console.error(
        `[PtyManager] Failed to spawn shell="${shell}" cwd="${
          cwd || os.homedir()
        }":`,
        err,
      );
      throw err;
    }

    const session: PtySession = {
      id,
      name,
      process: proc,
      shell,
      // Capture the orphan master fd node-pty just leaked (macOS only) so every
      // teardown path can reclaim it. Runs synchronously right after spawn while
      // the orphan is freshly open and unambiguously attributable to this call.
      orphanFds: this.captureOrphanMasterFds(beforeFds, proc),
    };
    this.sessions.set(id, session);
    return session;
  }

  write(id: string, data: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.write(data);
    }
  }

  /**
   * Write text and submit it as a discrete Enter keystroke.
   *
   * Writing `text + '\r'` in one chunk gets paste-buffered by Ink-based
   * CLIs (Claude Code, Gemini, Codex): the trailing CR gets folded into
   * the message body instead of submitting it.
   *
   * Two strategies:
   *   - `bracketedPaste: true` (default) — wrap text in ESC[200~ / ESC[201~
   *     paste markers so the TUI knows the text is a paste (no execution
   *     mid-text), then send `\r` after a delay so it registers as a
   *     separate keystroke that submits. Required for Gemini, which has
   *     a longer paste-buffer flush than Claude/Codex — without paste
   *     markers, the 150ms delay isn't enough and the CR gets buffered
   *     into the multi-line input. Most modern TUIs (Ink, Bubble Tea,
   *     ratatui) honor bracketed paste.
   *   - `bracketedPaste: false` — for CLIs that echo the escape bytes
   *     literally instead of interpreting them. Used for `custom` model
   *     agents where we can't assume terminal support.
   */
  writeAndSubmit(
    id: string,
    text: string,
    delayMs = 150,
    bracketedPaste = true,
  ): Promise<boolean> {
    const session = this.sessions.get(id);
    if (!session) return Promise.resolve(false);

    // Safety guard: screen the payload for dangerous commands before it reaches
    // the PTY. Warn always; block high-severity only when policy is enabled.
    const match = detectDangerousCommand(text);
    if (match.matched) {
      const blocked =
        match.severity === "high" &&
        (this.blockDangerous || this.blockDangerousSessions.has(id));
      console.warn(
        `[PtyManager] dangerous command detected (${match.severity}: ${
          match.pattern
        }) for ${id}${blocked ? " — BLOCKED" : ""}`,
      );
      this.emitDanger({ sessionId: id, text, match, blocked });
      if (blocked) return Promise.resolve(false);
    }

    const previous = this.writeAndSubmitQueues.get(id) ?? Promise.resolve(true);
    const next = previous
      .catch(() => {
        // Keep later writes moving even if an earlier queued submit failed.
        return false;
      })
      .then(() =>
        this.performWriteAndSubmit(id, session, text, delayMs, bracketedPaste),
      );

    const guarded = next
      .catch((err: unknown) => {
        console.error(
          `[PtyManager] writeAndSubmit failed for ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        return false;
      })
      .finally(() => {
        if (this.writeAndSubmitQueues.get(id) === guarded) {
          this.writeAndSubmitQueues.delete(id);
        }
      });
    this.writeAndSubmitQueues.set(id, guarded);
    return guarded;
  }

  private async performWriteAndSubmit(
    id: string,
    session: PtySession,
    text: string,
    delayMs: number,
    bracketedPaste: boolean,
  ): Promise<boolean> {
    if (this.sessions.get(id) !== session) return false;

    if (bracketedPaste) {
      session.process.write(`\x1b[200~${text}\x1b[201~`);
    } else {
      session.process.write(text);
    }

    // The trailing CR must register as a DISCRETE submit keystroke. A single
    // fixed gap is a timing race: under load (busy Electron main loop, many
    // agents streaming PTY output) the CR can get folded into the paste
    // buffer as a newline, leaving the message sitting in the composer
    // unsubmitted — the user then has to press Enter manually. So instead of
    // trusting one gap, send the CR, watch the PTY for a submit signal, and
    // resend the CR if the agent didn't react.
    await this.sleep(delayMs);
    return this.submitWithRetry(id, session, 0);
  }

  // Max number of CR (Enter) keystrokes to send before giving up.
  private static readonly SUBMIT_MAX_ATTEMPTS = 3;
  // How long to watch PTY output for a submit signal after each CR.
  private static readonly SUBMIT_VERIFY_MS = 600;

  /**
   * Send a CR to the session, then verify the agent actually started a turn.
   * Resends (up to SUBMIT_MAX_ATTEMPTS) if no submit signal is observed.
   * A redundant CR landing on an already-submitted/empty composer is a
   * no-op for the TUIs we drive, so over-sending is safe.
   */
  private submitWithRetry(
    id: string,
    session: PtySession,
    attempt: number,
  ): Promise<boolean> {
    if (this.sessions.get(id) !== session) return Promise.resolve(false);

    return new Promise((resolve) => {
      let reacted = false;
      const disposable = session.process.onData((chunk: string) => {
        if (SUBMIT_SIGNAL.test(chunk)) reacted = true;
      });

      session.process.write("\r");

      setTimeout(() => {
        disposable.dispose();
        if (reacted) {
          if (attempt > 0) {
            console.log(
              `[PtyManager] submit confirmed for ${id} after ${attempt} retr${
                attempt === 1 ? "y" : "ies"
              }`,
            );
          }
          resolve(true);
          return;
        }
        if (this.sessions.get(id) !== session) {
          resolve(false);
          return;
        }
        if (attempt + 1 < PtyManager.SUBMIT_MAX_ATTEMPTS) {
          console.warn(
            `[PtyManager] Enter not registered for ${id} (attempt ${
              attempt + 1
            }/${PtyManager.SUBMIT_MAX_ATTEMPTS}) — resending CR`,
          );
          void this.submitWithRetry(id, session, attempt + 1).then(resolve);
        } else {
          console.error(
            `[PtyManager] Enter still not registered for ${id} after ${PtyManager.SUBMIT_MAX_ATTEMPTS} attempts — message may be sitting unsubmitted in the composer`,
          );
          // The text payload was already written to the PTY. Reporting false
          // here would make at-least-once callers redeliver the same text into
          // the composer, creating duplicate inbound messages. Treat this as a
          // write delivery and let TelegramPoller's unanswered-reply nudge flag
          // a stuck orchestrator turn if no send_telegram_message follows.
          resolve(true);
        }
      }, PtyManager.SUBMIT_VERIFY_MS);
    });
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => {
      setTimeout(resolve, ms);
    });
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.resize(cols, rows);
    }
  }

  // Grace before SIGKILL-sweeping a killed PTY's process group. Sized to the
  // Telegram channel poller's own ~2s self-shutdown budget (server.ts force-
  // exits 2s after SIGTERM) so a clean graceful exit — which releases the
  // getUpdates long-poll slot — wins the race before we force-kill any
  // straggler in the group.
  private static readonly TREE_KILL_ESCALATE_MS = 2500;

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      // Take down the whole PTY SUBTREE (child + grandchildren), not just the
      // single child pid that node-pty's own .kill() signals. See
      // killProcessTree — this is what stops an orchestrator's Telegram poller
      // from orphaning across a stop/restart and 409-blocking the next one.
      this.killProcessTree(session.process.pid);
      // Release the MASTER FDs. node-pty's own .kill() ONLY sends a signal — it
      // never closes any fd — so we call .destroy() (via destroyProcess), which
      // closes the read stream (proc.fd) and, in destroyProcess, closes the
      // orphan master fd too. destroy() also SIGHUPs the direct child once the
      // socket closes, so the child signal is covered.
      this.destroyProcess(session.process, session.orphanFds);
      this.sessions.delete(id);
      this.blockDangerousSessions.delete(id);
    }
  }

  /**
   * Release a node-pty's OS resources — critically the pseudo-terminal MASTER
   * fd. node-pty 1.1.0's `.kill()` only signals the child; `.destroy()` is the
   * sole method that closes the read stream (freeing the fd) and disposes the
   * write stream. The `IPty` public type doesn't declare `destroy()` (it lives
   * on the concrete UnixTerminal), so we reach it through a guarded cast and
   * fall back to `.kill()` if it's ever absent. Idempotent and error-swallowing:
   * destroying an already-dead/closed pty is a harmless no-op.
   */
  private destroyProcess(proc: pty.IPty, orphanFds?: OrphanFd[]): void {
    try {
      const destroy = (proc as unknown as { destroy?: () => void }).destroy;
      if (typeof destroy === "function") {
        destroy.call(proc);
      } else {
        proc.kill();
      }
    } catch {
      // Already dead / socket already closed — fd release is idempotent.
    }
    // node-pty's `.destroy()` closes the master fd it TRACKS (`proc.fd`, wrapped
    // by its read stream) but NOT the SECOND /dev/ptmx master it opens at spawn
    // and never exposes (the "orphan" — see captureOrphanMasterFds). That orphan
    // is what actually leaks against macOS `kern.tty.ptmx_max` on every teardown
    // (verified: .kill() and .destroy() both leave exactly 1 orphan per session).
    // Close it here, on every teardown path. Outside the try above and self-
    // guarded so a destroy() throw can't skip it and a double teardown is a no-op.
    this.releaseOrphanMasterFds(orphanFds);
  }

  // On macOS a device number packs major in the high 8 bits: major = rdev >> 24.
  // Bit ops in JS coerce to int32; a pty master's rdev (major 15 → ~2.5e8) fits,
  // but use integer division to stay safe if the packing ever widens.
  private static deviceMajor(rdev: number): number {
    return Math.floor(rdev / 0x1000000) & 0xff;
  }

  /**
   * Snapshot this process's currently-open CHARACTER-device fds as an fd→rdev
   * map. Cheap: one readdir of /dev/fd plus an fstat per fd. Used to diff the
   * open-fd set across a pty.spawn so the newly-appearing pty master(s) can be
   * attributed to a specific session. macOS-only — the orphan-fd leak is a macOS
   * /dev/ptmx behavior, and gating here makes the whole mechanism a no-op on
   * other platforms (returns an empty map, so nothing is ever captured/closed).
   */
  private snapshotCharDevFds(): Map<number, number> {
    const snap = new Map<number, number>();
    if (process.platform !== "darwin") return snap;
    let names: string[];
    try {
      names = fs.readdirSync("/dev/fd");
    } catch {
      return snap;
    }
    for (const name of names) {
      const fd = Number(name);
      if (!Number.isInteger(fd)) continue;
      try {
        const st = fs.fstatSync(fd);
        if (st.isCharacterDevice()) snap.set(fd, st.rdev);
      } catch {
        // fd closed between readdir and fstat (e.g. /dev/fd's own dir handle).
      }
    }
    return snap;
  }

  /**
   * Identify the orphaned pty MASTER fd(s) a spawn just leaked: character-device
   * fds that (a) share `proc.fd`'s device MAJOR (so we never touch an unrelated
   * char device like /dev/null), and (b) are NEW relative to `before` — absent,
   * or present but with a DIFFERENT rdev (an fd number the OS recycled into a
   * fresh pty device across the spawn). `proc.fd` itself is excluded: node-pty
   * tracks and closes it via `.destroy()`. Comparing the (fd, rdev) pair rather
   * than the bare fd number is what makes recycled fd numbers attributable.
   *
   * The major is read from `proc.fd` at capture time (self-calibrating — no
   * hardcoded device number), so it survives node-pty patch bumps. `fd` and
   * `destroy` are not on node-pty's public `IPty` type (they live on the
   * concrete UnixTerminal), so both are reached through guarded casts.
   */
  private captureOrphanMasterFds(
    before: Map<number, number>,
    proc: pty.IPty,
  ): OrphanFd[] {
    if (process.platform !== "darwin") return [];
    const procFd = (proc as unknown as { fd?: number }).fd;
    if (typeof procFd !== "number" || !Number.isInteger(procFd)) return [];
    let masterMajor: number;
    try {
      masterMajor = PtyManager.deviceMajor(fs.fstatSync(procFd).rdev);
    } catch {
      return [];
    }
    const orphans: OrphanFd[] = [];
    for (const [fd, rdev] of this.snapshotCharDevFds()) {
      if (fd === procFd) continue;
      if (PtyManager.deviceMajor(rdev) !== masterMajor) continue;
      if (before.get(fd) === rdev) continue; // unchanged device → pre-existing
      orphans.push({ fd, rdev });
    }
    return orphans;
  }

  /**
   * Close the orphan master fd(s) captured for a session, reclaiming the
   * /dev/ptmx slot node-pty leaks per teardown. Self-guarding and idempotent:
   * each fd is re-fstat'd and closed ONLY while it is still the exact same
   * character device (rdev match) captured at spawn — so an fd number the OS has
   * since recycled is never wrongly closed — and the list is emptied after, so a
   * second teardown (kill() then a late onExit, or the reaper) is a harmless
   * no-op. Errors (EBADF on an already-closed fd) are swallowed.
   */
  private releaseOrphanMasterFds(orphanFds?: OrphanFd[]): void {
    if (!orphanFds || orphanFds.length === 0) return;
    for (const { fd, rdev } of orphanFds) {
      try {
        const st = fs.fstatSync(fd);
        if (st.isCharacterDevice() && st.rdev === rdev) {
          fs.closeSync(fd);
        }
      } catch {
        // EBADF (already closed) or fd recycled into a non-matching device —
        // nothing of ours to reclaim.
      }
    }
    orphanFds.length = 0;
  }

  /**
   * Terminate the ENTIRE process group of a PTY child — the child plus every
   * descendant it spawned — instead of the lone child pid.
   *
   * Why: node-pty spawns each PTY via forkpty(), which setsid()s the child into
   * a fresh session, making it its own process-GROUP leader (pgid === pid).
   * Every process the child then spawns (an agent/orchestrator's MCP servers,
   * e.g. the Telegram channel poller `bun server.ts`) inherits that group.
   * node-pty's own `.kill()` runs `process.kill(pid, 'SIGHUP')` — a single
   * POSITIVE pid — so it signals only the child; reaping the grandchildren is
   * left to the kernel's fragile "controlling-process exit → SIGHUP the
   * foreground process group" propagation. When that misses (the poller sits
   * behind the `bun run` wrapper chain), the poller lives on as an orphan and
   * keeps holding Telegram's single-consumer getUpdates slot, so the next
   * orchestrator's poller gets 409 Conflict and inbound silently dies.
   * Signalling the GROUP (a NEGATIVE pid) takes the whole subtree down
   * deterministically with the orchestrator.
   *
   * Group kill alone is NOT enough (ticket cgzUJYRv): Codex spawns its marblo
   * MCP server (`dist-mcp/index.js`) DETACHED into its OWN process group, so a
   * `kill(-pgid)` scoped to the PTY child's group never reaches it — it survives
   * teardown, reparents to launchd (ppid=1), and piles up as an orphan. So we
   * ALSO walk the ppid subtree (captured here, while the CLI is still alive and
   * the detached grandchild is still a ppid-descendant) and signal each pid
   * DIRECTLY by its positive pid. In-group pids get signalled twice — harmless
   * (idempotent, ESRCH-safe); the point is the out-of-group ones.
   *
   * Scope (critical): pgid === pid means `-pid` targets ONLY this PTY's own
   * subtree. The Electron main process and every OTHER agent/orchestrator PTY
   * live in different process groups (each its own setsid session), so they are
   * untouched. The positive-pid signals are likewise confined to descendants of
   * THIS pty child. The `pid > 1` / integer guard is load-bearing: `process.kill(-0)`
   * would signal the CALLER's entire group (Electron + all agents) and `-1`
   * would broadcast system-wide — never allow either.
   */
  private killProcessTree(pid: number | undefined): void {
    if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 1) return;

    // Snapshot the ppid subtree NOW, before any signal — once the CLI dies its
    // detached MCP grandchild reparents to launchd and is no longer reachable by
    // walking down from `pid`. win32 has no process groups / ps -Ao; skip there.
    const descendants =
      process.platform === "win32"
        ? []
        : collectDescendants(readProcTree(), pid).filter(
            (d) => Number.isInteger(d) && d > 1,
          );

    // Graceful first: SIGTERM the group so the Telegram poller runs its own
    // shutdown (release the getUpdates long-poll, remove its pidfile) — this is
    // what keeps the handoff window short enough for the new poller to self-heal.
    try {
      process.kill(-pid, "SIGTERM");
    } catch {
      // ESRCH (group already gone) / EPERM — nothing left to signal.
    }
    for (const d of descendants) {
      try {
        process.kill(d, "SIGTERM");
      } catch {
        // Already gone / not ours — nothing to signal.
      }
    }

    // Escalate: SIGKILL anything still alive in the group AND any straggling
    // descendant (e.g. Codex's detached dist-mcp) after the poller's graceful-
    // exit budget. Same scoping; unref so a pending sweep never keeps the event
    // loop (or app shutdown) alive.
    const sweep = setTimeout(() => {
      try {
        process.kill(-pid, "SIGKILL");
      } catch {
        // Group already reaped — expected on the happy path.
      }
      for (const d of descendants) {
        try {
          process.kill(d, "SIGKILL");
        } catch {
          // Descendant already reaped — expected on the happy path.
        }
      }
    }, PtyManager.TREE_KILL_ESCALATE_MS);
    sweep.unref?.();
  }

  listSessions(): { id: string; name: string }[] {
    return Array.from(this.sessions.values()).map((s) => ({
      id: s.id,
      name: s.name,
    }));
  }

  onData(id: string, callback: (data: string) => void): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.onData(callback);
    }
  }

  onExit(id: string, callback: (exitCode: number) => void): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.onExit(({ exitCode }) => {
        // PTY ids are deterministic (`agent-<id>`) and reused verbatim on
        // restart, so a killed OLD process can fire its onExit AFTER a fresh
        // session has already claimed the same id. Evict the map entry only
        // when THIS exact session still occupies the id — comparing by id
        // string alone would delete the replacement, orphaning its live
        // process and silently dropping every subsequent write()/writeAndSubmit().
        if (this.sessions.get(id) === session) {
          this.sessions.delete(id);
        }
        // The child is gone. node-pty MAY release the master fd via its own
        // exit→socket-destroy timeout, but that path is best-effort on macOS
        // ("sometimes the socket never gets closed"). Force it: destroy() this
        // exact (possibly-stale) session so its master fds can't outlive the
        // child. Safe even when the id was already reclaimed by a new session —
        // we destroy the captured OLD `session` object, never the replacement.
        this.destroyProcess(session.process, session.orphanFds);
        callback(exitCode);
      });
    }
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }

  /**
   * Start a periodic sweep that destroys sessions whose child process has died
   * but whose map entry (and thus master fd) lingered — e.g. an onExit that
   * never fired because the read stream stayed paused. Belt-and-suspenders on
   * top of the explicit destroy() in kill()/onExit(); idempotent, so calling it
   * once at app startup is enough. The interval is unref'd so it never keeps the
   * event loop (or app shutdown) alive.
   */
  startReaper(): void {
    if (this.reaperTimer) return;
    this.reaperTimer = setInterval(
      () => this.reap(),
      PtyManager.REAP_INTERVAL_MS,
    );
    this.reaperTimer.unref?.();
  }

  stopReaper(): void {
    if (this.reaperTimer) {
      clearInterval(this.reaperTimer);
      this.reaperTimer = null;
    }
  }

  /**
   * Sweep sessions whose child pid is confirmed dead (process.kill(pid, 0)
   * throws ESRCH) and release their leaked master fd. Conservative: only ESRCH
   * (definitely gone) triggers a destroy — EPERM or a pid the OS has since
   * recycled reads as "alive" and is left untouched, so we never wrongfully
   * destroy a live session. Also invoked synchronously when create() hits an
   * exhausted pty pool, to reclaim slots before failing.
   */
  private reap(): void {
    for (const [id, session] of this.sessions) {
      const pid = session.process.pid;
      if (typeof pid !== "number" || !Number.isInteger(pid)) continue;
      let dead = false;
      try {
        process.kill(pid, 0); // probe only — throws ESRCH if the pid is gone
      } catch (err) {
        dead = (err as NodeJS.ErrnoException)?.code === "ESRCH";
      }
      if (dead) {
        console.warn(
          `[PtyManager] reaper: session "${id}" child pid ${pid} is dead — releasing leaked PTY fd`,
        );
        this.destroyProcess(session.process, session.orphanFds);
        this.sessions.delete(id);
      }
    }
  }
}
