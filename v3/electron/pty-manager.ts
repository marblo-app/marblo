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
        `[PtyManager] Failed to spawn shell="${shell}" cwd="${cwd || os.homedir()}":`,
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
   * Writing `text + '\r'` in one chunk gets paste-buffered by Claude Code
   * (and other Ink-based CLIs): the trailing CR is folded into the message
   * body instead of submitting it. Splitting into two writes with a small
   * gap makes the CR register as a separate keystroke.
   */
  writeAndSubmit(id: string, text: string, delayMs = 150): void {
    const session = this.sessions.get(id);
    if (!session) return;
    session.process.write(text);
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
