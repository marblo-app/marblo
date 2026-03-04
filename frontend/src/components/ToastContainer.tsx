"use client";

import { Toast, ToastType } from "@/hooks/useToast";

interface ToastContainerProps {
  toasts: Toast[];
  onRemove: (id: string) => void;
}

const BORDER_COLORS: Record<ToastType, string> = {
  info: "border-l-blue-500",
  success: "border-l-green-500",
  warning: "border-l-yellow-500",
};

const ICON: Record<ToastType, string> = {
  info: "i",
  success: "\u2713",
  warning: "!",
};

const ICON_COLORS: Record<ToastType, string> = {
  info: "text-blue-400",
  success: "text-green-400",
  warning: "text-yellow-400",
};

export default function ToastContainer({ toasts, onRemove }: ToastContainerProps) {
  if (toasts.length === 0) return null;

  return (
    <div className="fixed right-4 top-4 z-50 flex flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-3 rounded-lg border-l-4 ${BORDER_COLORS[toast.type]} bg-gray-900/95 px-4 py-3 shadow-lg backdrop-blur-sm animate-slide-in-right`}
          style={{ minWidth: 280, maxWidth: 400 }}
        >
          <span className={`mt-0.5 text-sm font-bold ${ICON_COLORS[toast.type]}`}>
            {ICON[toast.type]}
          </span>
          <p className="flex-1 text-sm text-gray-200">{toast.message}</p>
          <button
            onClick={() => onRemove(toast.id)}
            className="ml-2 text-gray-500 hover:text-gray-300"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
