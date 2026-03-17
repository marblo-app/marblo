"use client";

import { useRef, useState, useCallback, useEffect } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";

import { TERMINAL_WS_URL } from "@/lib/terminal";

/**
 * Hook that manages an xterm.js Terminal instance, WebSocket connection,
 * and FitAddon for automatic resizing.
 *
 * Usage:
 *   const { terminalRef, isConnected, connect, disconnect } = useTerminal();
 *   return <div ref={terminalRef} />;
 */
export function useTerminal() {
  // The DOM element that xterm mounts into.
  const terminalRef = useRef<HTMLDivElement | null>(null);

  // Internal refs — not exposed, but need to survive re-renders.
  const xtermRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const resizeObserverRef = useRef<ResizeObserver | null>(null);

  const [isConnected, setIsConnected] = useState(false);

  // ------------------------------------------------------------------
  // Connect
  // ------------------------------------------------------------------
  const connect = useCallback(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Prevent double-init.
    if (xtermRef.current) return;

    // 1. Create Terminal + addons
    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: "'JetBrains Mono', 'Fira Code', 'Cascadia Code', Menlo, monospace",
      theme: {
        background: "#1e1e2e",
        foreground: "#cdd6f4",
        cursor: "#f5e0dc",
        selectionBackground: "#585b70",
      },
      allowProposedApi: true,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);

    xtermRef.current = term;
    fitAddonRef.current = fitAddon;

    // 2. Mount into the container
    term.open(container);
    fitAddon.fit();

    // 3. WebSocket
    const ws = new WebSocket(TERMINAL_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      // Send initial size so the remote pty matches.
      ws.send(
        JSON.stringify({
          type: "resize",
          cols: term.cols,
          rows: term.rows,
        }),
      );
    };

    ws.onmessage = (event: MessageEvent) => {
      // Data from the server → write to xterm.
      if (typeof event.data === "string") {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
    };

    ws.onerror = () => {
      setIsConnected(false);
    };

    // 4. Terminal data → WebSocket (keystrokes, paste, etc.)
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // 5. Resize handling: FitAddon re-fits when the container size changes,
    //    and we forward the new dimensions over WebSocket.
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });

    const observer = new ResizeObserver(() => {
      // requestAnimationFrame prevents layout thrashing.
      requestAnimationFrame(() => {
        try {
          fitAddon.fit();
        } catch {
          // Container may have been detached.
        }
      });
    });
    observer.observe(container);
    resizeObserverRef.current = observer;
  }, []);

  // ------------------------------------------------------------------
  // Disconnect
  // ------------------------------------------------------------------
  const disconnect = useCallback(() => {
    resizeObserverRef.current?.disconnect();
    resizeObserverRef.current = null;

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }

    if (xtermRef.current) {
      xtermRef.current.dispose();
      xtermRef.current = null;
    }

    fitAddonRef.current = null;
    setIsConnected(false);
  }, []);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      // eslint-disable-next-line react-hooks/exhaustive-deps
      resizeObserverRef.current?.disconnect();
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, []);

  return { terminalRef, isConnected, connect, disconnect };
}
