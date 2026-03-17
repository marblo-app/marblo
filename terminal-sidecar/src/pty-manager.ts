import * as pty from "node-pty";
import os from "node:os";

export interface PtySession {
  id: string;
  pty: pty.IPty;
  createdAt: Date;
}

const sessions = new Map<string, PtySession>();

/**
 * Determine the default shell for the current platform.
 */
function getDefaultShell(): string {
  if (os.platform() === "win32") {
    return "powershell.exe";
  }
  return process.env.SHELL || "/bin/zsh";
}

/**
 * Create a new PTY session and track it by ID.
 */
export function createSession(
  id: string,
  cols: number = 80,
  rows: number = 24,
  cwd?: string,
): PtySession {
  if (sessions.has(id)) {
    throw new Error(`Session ${id} already exists`);
  }

  const shell = getDefaultShell();
  const ptyProcess = pty.spawn(shell, [], {
    name: "xterm-256color",
    cols,
    rows,
    cwd: cwd || process.env.HOME || "/",
    env: {
      ...process.env,
      TERM: "xterm-256color",
      COLORTERM: "truecolor",
    } as Record<string, string>,
  });

  const session: PtySession = {
    id,
    pty: ptyProcess,
    createdAt: new Date(),
  };

  sessions.set(id, session);
  console.log(
    `[pty-manager] Session created: ${id} (shell=${shell}, pid=${ptyProcess.pid})`,
  );
  return session;
}

/**
 * Get an existing session by ID.
 */
export function getSession(id: string): PtySession | undefined {
  return sessions.get(id);
}

/**
 * Resize an existing PTY session.
 */
export function resizeSession(
  id: string,
  cols: number,
  rows: number,
): boolean {
  const session = sessions.get(id);
  if (!session) {
    return false;
  }
  session.pty.resize(cols, rows);
  console.log(`[pty-manager] Session resized: ${id} (${cols}x${rows})`);
  return true;
}

/**
 * Destroy a PTY session and remove it from tracking.
 */
export function destroySession(id: string): boolean {
  const session = sessions.get(id);
  if (!session) {
    return false;
  }

  try {
    session.pty.kill();
  } catch (err) {
    console.warn(`[pty-manager] Error killing session ${id}:`, err);
  }

  sessions.delete(id);
  console.log(`[pty-manager] Session destroyed: ${id}`);
  return true;
}

/**
 * Destroy all active sessions (used during shutdown).
 */
export function destroyAllSessions(): void {
  for (const [id] of sessions) {
    destroySession(id);
  }
}

/**
 * Return the count of active sessions.
 */
export function getSessionCount(): number {
  return sessions.size;
}
