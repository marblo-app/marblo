"use client";

import { useState } from "react";
import Header from "@/components/Header";
import KanbanBoard from "@/components/KanbanBoard";
import TerminalPanel from "@/components/terminal/TerminalPanel";
import TaskCreateModal from "@/components/TaskCreateModal";
import ToastContainer from "@/components/ToastContainer";
import { useTasks } from "@/hooks/useTasks";
import { useToast } from "@/hooks/useToast";
import { useLocalStorage } from "@/hooks/useLocalStorage";
import { DEFAULT_TERMINAL_HEIGHT, TERMINAL_STORAGE_KEY } from "@/lib/terminal";
import { Task } from "@/lib/types";

export default function BoardPage() {
  const { toasts, addToast, removeToast } = useToast();
  const { tasks, loading, error, sseConnected, setTasks } = useTasks(addToast);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [terminalOpen, setTerminalOpen] = useState(false);
  const [terminalHeight, setTerminalHeight] = useLocalStorage<number>(
    TERMINAL_STORAGE_KEY,
    DEFAULT_TERMINAL_HEIGHT,
  );

  const handleTaskCreated = (task: Task) => {
    setTasks((prev) => [...prev, task]);
  };

  const handleTaskUpdated = (updated: Task) => {
    setTasks((prev) => prev.map((t) => (t.id === updated.id ? updated : t)));
  };

  const handleTaskDeleted = (taskId: string) => {
    setTasks((prev) => prev.filter((t) => t.id !== taskId));
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
          <p className="text-sm text-gray-400">Loading tasks...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-gray-950">
        <div className="flex flex-col items-center gap-3 text-center">
          <div className="text-4xl">!</div>
          <p className="text-sm text-red-400">Failed to load tasks</p>
          <p className="text-xs text-gray-500">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-2 rounded-lg bg-gray-800 px-4 py-2 text-sm text-white hover:bg-gray-700"
          >
            Retry
          </button>
        </div>
      </div>
    );
  }

  const kanbanHeight = terminalOpen ? `${100 - terminalHeight}vh` : "100vh";
  const columnMaxHeight = terminalOpen
    ? `calc(${100 - terminalHeight}vh - 200px)`
    : "calc(100vh - 200px)";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-gray-950">
      <Header
        tasks={tasks}
        sseConnected={sseConnected}
        onNewTask={() => setShowCreateModal(true)}
        onTerminalToggle={() => setTerminalOpen((prev) => !prev)}
        isTerminalOpen={terminalOpen}
      />
      <KanbanBoard
        tasks={tasks}
        onTaskUpdated={handleTaskUpdated}
        onTaskDeleted={handleTaskDeleted}
        onToast={addToast}
        style={{
          height: kanbanHeight,
          "--column-max-height": columnMaxHeight,
        } as React.CSSProperties}
      />
      <TerminalPanel
        isOpen={terminalOpen}
        height={terminalHeight}
        onResize={setTerminalHeight}
        onClose={() => setTerminalOpen(false)}
      />
      <TaskCreateModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onCreated={handleTaskCreated}
        existingTasks={tasks}
      />
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </div>
  );
}
