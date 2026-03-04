"use client";

import { useState, useCallback, useRef } from "react";

export type ToastType = "info" | "success" | "warning";

export interface Toast {
  id: string;
  message: string;
  type: ToastType;
}

const MAX_TOASTS = 5;

export function useToast() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const counterRef = useRef(0);

  const removeToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback(
    (message: string, type: ToastType = "info") => {
      const id = `toast-${++counterRef.current}-${Date.now()}`;
      setToasts((prev) => {
        const next = [...prev, { id, message, type }];
        // Keep only the latest MAX_TOASTS
        if (next.length > MAX_TOASTS) {
          return next.slice(next.length - MAX_TOASTS);
        }
        return next;
      });

      // Auto-remove after 4 seconds
      setTimeout(() => {
        removeToast(id);
      }, 4000);
    },
    [removeToast],
  );

  return { toasts, addToast, removeToast };
}
