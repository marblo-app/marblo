"use client";

import { useEffect, useRef } from "react";
import { useTerminal } from "@/hooks/useTerminal";
import TerminalToolbar from "./TerminalToolbar";
import ResizableDivider from "./ResizableDivider";

interface TerminalPanelProps {
  isOpen: boolean;
  height: number; // percent of viewport
  onClose: () => void;
  onResize: (h: number) => void;
}

export default function TerminalPanel({
  isOpen,
  height,
  onClose,
  onResize,
}: TerminalPanelProps) {
  const { terminalRef, isConnected, connect, disconnect } = useTerminal();

  // Track previous isOpen value to detect transitions.
  const prevOpenRef = useRef(false);

  useEffect(() => {
    const wasOpen = prevOpenRef.current;
    prevOpenRef.current = isOpen;

    if (isOpen && !wasOpen) {
      // Panel just opened -- connect after a tick so the container is mounted.
      const timer = setTimeout(() => {
        connect();
      }, 0);
      return () => clearTimeout(timer);
    }

    if (!isOpen && wasOpen) {
      // Panel just closed -- disconnect.
      disconnect();
    }
  }, [isOpen, connect, disconnect]);

  if (!isOpen) return null;

  return (
    <div
      className="flex flex-shrink-0 flex-col"
      style={{ height: `${height}vh` }}
    >
      <ResizableDivider onResize={onResize} />
      <TerminalToolbar isConnected={isConnected} onClose={onClose} />
      <div
        ref={terminalRef}
        className="min-h-0 flex-1 bg-black px-1 py-1"
      />
    </div>
  );
}
