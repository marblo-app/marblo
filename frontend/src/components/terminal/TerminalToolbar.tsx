"use client";

interface TerminalToolbarProps {
  isConnected: boolean;
  onClose: () => void;
}

export default function TerminalToolbar({
  isConnected,
  onClose,
}: TerminalToolbarProps) {
  return (
    <div className="flex h-8 flex-shrink-0 items-center justify-between border-t border-gray-700 bg-gray-900 px-3">
      <div className="flex items-center gap-2">
        <div
          className={`h-2 w-2 rounded-full ${
            isConnected ? "bg-green-500" : "bg-red-500"
          }`}
        />
        <span className="text-xs font-medium text-gray-300">Terminal</span>
      </div>

      <button
        onClick={onClose}
        className="flex h-5 w-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-700 hover:text-white"
        aria-label="Close terminal"
      >
        <svg
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 16 16"
          fill="currentColor"
          className="h-3.5 w-3.5"
        >
          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
        </svg>
      </button>
    </div>
  );
}
