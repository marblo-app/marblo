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
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const reconnectAttemptRef = useRef(0);
  const intentionalCloseRef = useRef(false);

  const MAX_RECONNECT_ATTEMPTS = 10;
  const BASE_RECONNECT_DELAY = 1000; // 1s, doubles each attempt up to 30s

  const [isConnected, setIsConnected] = useState(false);

  // ------------------------------------------------------------------
  // connectWs — (re)connect WebSocket to an existing terminal
  // ------------------------------------------------------------------
  const connectWs = useCallback((term: Terminal) => {
    // Clean up previous ws if any
    if (wsRef.current) {
      wsRef.current.onclose = null;
      wsRef.current.close();
      wsRef.current = null;
    }

    const ws = new WebSocket(TERMINAL_WS_URL);
    wsRef.current = ws;

    ws.onopen = () => {
      setIsConnected(true);
      reconnectAttemptRef.current = 0;
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
      if (typeof event.data === "string") {
        term.write(event.data);
      }
    };

    ws.onclose = () => {
      setIsConnected(false);
      // Auto-reconnect unless intentionally closed
      if (
        !intentionalCloseRef.current &&
        reconnectAttemptRef.current < MAX_RECONNECT_ATTEMPTS
      ) {
        const delay = Math.min(
          BASE_RECONNECT_DELAY * 2 ** reconnectAttemptRef.current,
          30_000,
        );
        reconnectAttemptRef.current += 1;
        term.write(`\r\n\x1b[33m[연결 끊김 — ${delay / 1000}초 후 재연결...]\x1b[0m\r\n`);
        reconnectTimerRef.current = setTimeout(() => {
          if (xtermRef.current) {
            connectWs(xtermRef.current);
          }
        }, delay);
      }
    };

    ws.onerror = () => {
      // onclose will fire after onerror, reconnect handled there
    };

    // Terminal data → WebSocket
    term.onData((data: string) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(data);
      }
    });

    // Resize → WebSocket
    term.onResize(({ cols, rows }) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "resize", cols, rows }));
      }
    });
  }, []);

  // ------------------------------------------------------------------
  // Connect — initialize terminal + first WebSocket connection
  // ------------------------------------------------------------------
  const connect = useCallback(() => {
    const container = terminalRef.current;
    if (!container) return;

    // Prevent double-init.
    if (xtermRef.current) return;

    intentionalCloseRef.current = false;
    reconnectAttemptRef.current = 0;

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

    // 3. Resize observer
    const observer = new ResizeObserver(() => {
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

    // 4. WebSocket connection
    connectWs(term);
  }, [connectWs]);

  // ------------------------------------------------------------------
  // Disconnect
  // ------------------------------------------------------------------
  const disconnect = useCallback(() => {
    intentionalCloseRef.current = true;

    if (reconnectTimerRef.current) {
      clearTimeout(reconnectTimerRef.current);
      reconnectTimerRef.current = null;
    }

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
    reconnectAttemptRef.current = 0;
    setIsConnected(false);
  }, []);

  // ------------------------------------------------------------------
  // Cleanup on unmount
  // ------------------------------------------------------------------
  useEffect(() => {
    return () => {
      intentionalCloseRef.current = true;
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current);
      // eslint-disable-next-line react-hooks/exhaustive-deps
      resizeObserverRef.current?.disconnect();
      wsRef.current?.close();
      xtermRef.current?.dispose();
    };
  }, []);

  return { terminalRef, isConnected, connect, disconnect };
}
