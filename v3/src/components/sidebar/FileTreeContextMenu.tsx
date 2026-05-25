import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  shortcut?: string;
  onClick?: () => void;
  disabled?: boolean;
  danger?: boolean;
  separator?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function FileTreeContextMenu({ x, y, items, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Defer attaching the click listener so the same click that opened the menu
    // doesn't immediately close it.
    const timer = setTimeout(() => {
      document.addEventListener("mousedown", handleClickOutside);
    }, 0);
    document.addEventListener("keydown", handleEscape);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("mousedown", handleClickOutside);
      document.removeEventListener("keydown", handleEscape);
    };
  }, [onClose]);

  // Clamp menu inside viewport
  const menuWidth = 220;
  const menuHeight = items.length * 28 + 8;
  const left = Math.min(x, window.innerWidth - menuWidth - 8);
  const top = Math.min(y, window.innerHeight - menuHeight - 8);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[220px] rounded border border-gray-700 bg-gray-800 py-1 shadow-2xl"
      style={{ left, top }}
    >
      {items.map((item, idx) => {
        if (item.separator) {
          return <div key={idx} className="my-1 border-t border-gray-700" />;
        }
        return (
          <button
            key={idx}
            disabled={item.disabled}
            onClick={() => {
              if (item.disabled) return;
              item.onClick?.();
              onClose();
            }}
            className={`flex w-full items-center justify-between px-3 py-1 text-left text-[13px] ${
              item.disabled
                ? "cursor-not-allowed text-gray-600"
                : item.danger
                ? "text-red-400 hover:bg-red-500/20"
                : "text-gray-200 hover:bg-blue-600 hover:text-white"
            }`}
          >
            <span>{item.label}</span>
            {item.shortcut && (
              <span className="ml-4 text-[11px] text-gray-500">
                {item.shortcut}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
