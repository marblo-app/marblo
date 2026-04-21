import { useState, useCallback, useEffect, useRef } from 'react';
import { FileTree } from './FileTree';
import { CommandPanel } from './CommandPanel';
import { ProjectChat } from '../chat/ProjectChat';
import { useChatStore } from '../../stores/chatStore';

type SidebarPanel = 'files' | 'commands' | 'chat';

interface SidebarProps {
  isOpen: boolean;
  onToggle: () => void;
  onOpenOrchestrator?: () => void;
  onOpenCreateTask?: () => void;
}

const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 240;

export function Sidebar({ isOpen, onToggle, onOpenOrchestrator, onOpenCreateTask }: SidebarProps) {
  const [width, setWidth] = useState(DEFAULT_WIDTH);
  const [activePanel, setActivePanel] = useState<SidebarPanel>('files');
  const isResizing = useRef(false);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const unreadCount = useChatStore((s) => s.unreadCount);

  const startResize = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  useEffect(() => {
    function handleMouseMove(e: MouseEvent) {
      if (!isResizing.current) return;
      const newWidth = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, e.clientX));
      setWidth(newWidth);
    }

    function handleMouseUp() {
      if (isResizing.current) {
        isResizing.current = false;
        document.body.style.cursor = '';
        document.body.style.userSelect = '';
      }
    }

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, []);

  if (!isOpen) {
    return (
      <button
        onClick={onToggle}
        className="flex h-full w-10 flex-col items-center border-r border-gray-700 bg-gray-800 pt-2 hover:bg-gray-750"
        title="사이드바 열기"
      >
        <svg className="h-5 w-5 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
        </svg>
      </button>
    );
  }

  return (
    <div
      ref={sidebarRef}
      className="relative flex h-full flex-shrink-0 border-r border-gray-700 bg-gray-800"
      style={{ width }}
    >
      {/* Sidebar content */}
      <div className="flex flex-1 flex-col overflow-hidden">
        {/* Header with tabs */}
        <div className="flex items-center border-b border-gray-700">
          <button
            onClick={() => setActivePanel('files')}
            className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activePanel === 'files'
                ? 'border-b-2 border-blue-500 text-gray-200'
                : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            파일
          </button>
          <button
            onClick={() => setActivePanel('commands')}
            className={`flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activePanel === 'commands'
                ? 'border-b-2 border-blue-500 text-gray-200'
                : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            명령어
          </button>
          <button
            onClick={() => { setActivePanel('chat'); useChatStore.getState().resetUnread(); }}
            className={`relative flex-1 px-3 py-2 text-xs font-semibold uppercase tracking-wider transition-colors ${
              activePanel === 'chat'
                ? 'border-b-2 border-blue-500 text-gray-200'
                : 'text-gray-500 hover:text-gray-400'
            }`}
          >
            채팅
            {unreadCount > 0 && activePanel !== 'chat' && (
              <span className="absolute -top-0.5 right-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>
          <button
            onClick={onToggle}
            className="rounded p-0.5 mx-1 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            title="사이드바 닫기"
          >
            <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
            </svg>
          </button>
        </div>

        {/* Panel content */}
        {activePanel === 'files' ? (
          <FileTree />
        ) : activePanel === 'commands' ? (
          <CommandPanel
            onOpenOrchestrator={onOpenOrchestrator}
            onOpenCreateTask={onOpenCreateTask}
          />
        ) : (
          <ProjectChat />
        )}
      </div>

      {/* Resize handle */}
      <div
        onMouseDown={startResize}
        className="absolute right-0 top-0 z-10 h-full w-1 cursor-col-resize hover:bg-blue-500"
      />
    </div>
  );
}
