import type { ReactNode } from 'react';
import type { TerminalSession } from '../../hooks/useTerminal';

interface TerminalTabsProps {
  sessions: TerminalSession[];
  activeSessionId: string | null;
  onSelectTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onAddTab: () => void;
  children?: ReactNode;
}

export default function TerminalTabs({
  sessions,
  activeSessionId,
  onSelectTab,
  onCloseTab,
  onAddTab,
  children,
}: TerminalTabsProps) {
  return (
    <div className="flex items-center bg-[#181825] border-b border-[#313244] h-9 select-none">
      <div className="flex items-center overflow-x-auto flex-1 min-w-0">
        {sessions.map((session) => {
          const isActive = session.id === activeSessionId;
          return (
            <div
              key={session.id}
              className={`
                group flex items-center gap-1.5 px-3 h-9 cursor-pointer
                text-sm whitespace-nowrap border-r border-[#313244]
                transition-colors duration-100
                ${
                  isActive
                    ? 'bg-[#1e1e2e] text-[#cdd6f4]'
                    : 'text-[#6c7086] hover:text-[#a6adc8] hover:bg-[#1e1e2e]/50'
                }
              `}
              onClick={() => onSelectTab(session.id)}
            >
              <span className="text-xs opacity-60">&#9654;</span>
              <span className="truncate max-w-[120px]">{session.name}</span>
              <button
                className={`
                  ml-1 rounded p-0.5
                  hover:bg-[#45475a] transition-colors
                  ${isActive ? 'opacity-60 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100'}
                `}
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(session.id);
                }}
                title="Close terminal"
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                >
                  <path d="M3 3l6 6M9 3l-6 6" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
      {children}
      <button
        className="flex items-center justify-center w-9 h-9 text-[#6c7086] hover:text-[#cdd6f4] hover:bg-[#1e1e2e]/50 transition-colors shrink-0"
        onClick={onAddTab}
        title="New terminal"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
        >
          <path d="M7 2v10M2 7h10" />
        </svg>
      </button>
    </div>
  );
}
