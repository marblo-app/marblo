import * as pty from "node-pty";
import os from "os";

export interface PtySession {
  id: string;
  name: string;
  process: pty.IPty;
  shell: string;
}

export class PtyManager {
  private sessions: Map<string, PtySession> = new Map();

  create(
    id: string,
    name: string,
    command?: string,
    args?: string[],
    cwd?: string,
    env?: Record<string, string>
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
        err
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
    bracketedPaste = true
  ): void {
    const session = this.sessions.get(id);
    if (!session) return;
    if (bracketedPaste) {
      session.process.write(`\x1b[200~${text}\x1b[201~`);
    } else {
      session.process.write(text);
    }
    setTimeout(() => {
      const s = this.sessions.get(id);
      if (s) s.process.write("\r");
    }, delayMs);
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
        this.sessions.delete(id);
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
