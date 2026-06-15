import * as pty from "node-pty";
import os from "os";
import { detectDangerousCommand, type DangerMatch } from "./danger-command";

export interface PtySession {
  id: string;
  name: string;
  process: pty.IPty;
  shell: string;
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

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();
  private writeAndSubmitQueues: Map<string, Promise<void>> = new Map();

  // --- Dangerous-command safety guard (MVP-P0-1) ---
  // Every writeAndSubmit is screened by detectDangerousCommand. Matches are
  // logged and broadcast to listeners. By default nothing is blocked (warn-only)
  // to preserve existing behavior; an operator can flip blocking on for the
  // non-isolated paths (e.g. the orchestrator, which drives the main checkout).
  private dangerListeners: Array<(e: DangerEvent) => void> = [];
  private blockDangerous = false;

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
      console.error(
        `[PtyManager] Failed to spawn shell="${shell}" cwd="${
          cwd || os.homedir()
        }":`,
        err,
      );
      throw err;
    }

    const session: PtySession = { id, name, process: proc, shell };
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
  ): void {
    const session = this.sessions.get(id);
    if (!session) return;

    // Safety guard: screen the payload for dangerous commands before it reaches
    // the PTY. Warn always; block high-severity only when policy is enabled.
    const match = detectDangerousCommand(text);
    if (match.matched) {
      const blocked = this.blockDangerous && match.severity === "high";
      console.warn(
        `[PtyManager] dangerous command detected (${match.severity}: ${
          match.pattern
        }) for ${id}${blocked ? " — BLOCKED" : ""}`,
      );
      this.emitDanger({ sessionId: id, text, match, blocked });
      if (blocked) return;
    }

    const previous = this.writeAndSubmitQueues.get(id) ?? Promise.resolve();
    const next = previous
      .catch(() => {
        // Keep later writes moving even if an earlier queued submit failed.
      })
      .then(() =>
        this.performWriteAndSubmit(id, session, text, delayMs, bracketedPaste),
      );

    this.writeAndSubmitQueues.set(id, next);
    void next
      .catch((err: unknown) => {
        console.error(
          `[PtyManager] writeAndSubmit failed for ${id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      })
      .finally(() => {
        if (this.writeAndSubmitQueues.get(id) === next) {
          this.writeAndSubmitQueues.delete(id);
        }
      });
  }

  private async performWriteAndSubmit(
    id: string,
    session: PtySession,
    text: string,
    delayMs: number,
    bracketedPaste: boolean,
  ): Promise<void> {
    if (this.sessions.get(id) !== session) return;

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
    await this.submitWithRetry(id, session, 0);
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
  ): Promise<void> {
    if (this.sessions.get(id) !== session) return Promise.resolve();

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
          resolve();
          return;
        }
        if (this.sessions.get(id) !== session) {
          resolve();
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
          resolve();
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

  kill(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.process.kill();
      this.sessions.delete(id);
    }
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
        callback(exitCode);
      });
    }
  }

  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}
