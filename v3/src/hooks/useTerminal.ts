import { useState, useCallback } from 'react';

export interface TerminalSession {
  id: string;
  name: string;
  shell?: string;
}

export function useTerminal() {
  const [sessions, setSessions] = useState<TerminalSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);

  const createSession = useCallback(
    async (name: string, command?: string, args?: string[], cwd?: string) => {
      const id = crypto.randomUUID();
      const result = await window.electronAPI.pty.create({
        id,
        name,
        command,
        args,
        cwd,
      });

      const session: TerminalSession = {
        id: result.id,
        name,
        shell: result.shell,
      };

      setSessions((prev) => [...prev, session]);
      setActiveSessionId(id);
      return id;
    },
    []
  );

  const closeSession = useCallback(
    async (id: string) => {
      window.electronAPI.pty.removeListeners(id);
      await window.electronAPI.pty.kill(id);

      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeSessionId]
  );

  const removeSession = useCallback(
    (id: string) => {
      window.electronAPI.pty.removeListeners(id);
      setSessions((prev) => {
        const next = prev.filter((s) => s.id !== id);
        if (activeSessionId === id) {
          setActiveSessionId(next.length > 0 ? next[next.length - 1].id : null);
        }
        return next;
      });
    },
    [activeSessionId]
  );

  return {
    sessions,
    activeSessionId,
    setActiveSessionId,
    createSession,
    closeSession,
    removeSession,
  };
}
