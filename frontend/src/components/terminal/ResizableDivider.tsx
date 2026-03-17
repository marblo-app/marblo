"use client";

import { useCallback, useRef } from "react";
import { MIN_TERMINAL_HEIGHT, MAX_TERMINAL_HEIGHT } from "@/lib/terminal";

interface ResizableDividerProps {
  onResize: (heightPercent: number) => void;
}

export default function ResizableDivider({ onResize }: ResizableDividerProps) {
  const draggingRef = useRef(false);

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      draggingRef.current = true;

      const handleMouseMove = (moveEvent: MouseEvent) => {
        if (!draggingRef.current) return;

        const windowHeight = window.innerHeight;
        const mouseY = moveEvent.clientY;

        // The terminal panel grows from the bottom, so its height percent
        // is the remaining space below the mouse position.
        const heightPercent = ((windowHeight - mouseY) / windowHeight) * 100;

        // Clamp to allowed range.
        const clamped = Math.min(
          MAX_TERMINAL_HEIGHT,
          Math.max(MIN_TERMINAL_HEIGHT, heightPercent),
        );

        onResize(clamped);
      };

      const handleMouseUp = () => {
        draggingRef.current = false;
        document.removeEventListener("mousemove", handleMouseMove);
        document.removeEventListener("mouseup", handleMouseUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      };

      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);

      // Prevent text selection and set cursor while dragging.
      document.body.style.cursor = "row-resize";
      document.body.style.userSelect = "none";
    },
    [onResize],
  );

  return (
    <div
      onMouseDown={handleMouseDown}
      className="h-1 flex-shrink-0 cursor-row-resize bg-gray-700 transition-colors hover:bg-blue-500"
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize terminal panel"
    />
  );
}
