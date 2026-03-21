"use client";

import { Task, TaskStatus } from "@/lib/types";

interface HeaderProps {
  tasks: Task[];
  sseConnected: boolean;
  onNewTask: () => void;
  onTerminalToggle?: () => void;
  isTerminalOpen?: boolean;
}

export default function Header({ tasks, sseConnected, onNewTask, onTerminalToggle, isTerminalOpen }: HeaderProps) {
  const totalTasks = tasks.length;
  const doneTasks = tasks.filter((t) => t.status === TaskStatus.DONE).length;
  const inProgressTasks = tasks.filter(
    (t) => t.status === TaskStatus.IN_PROGRESS,
  ).length;
  const completionRate =
    totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0;

  return (
    <header className="border-b border-gray-800 bg-gray-950 px-6 py-4">
      <div className="mx-auto flex max-w-screen-2xl items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-xl font-bold text-white">
            Marblo<span className="text-blue-400">.ai</span>
          </h1>
          <div className="flex items-center gap-1.5">
            <div
              className={`h-2 w-2 rounded-full ${
                sseConnected ? "bg-green-500" : "bg-red-500"
              }`}
            />
            <span className="text-xs text-gray-500">
              {sseConnected ? "Live" : "Disconnected"}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex items-center gap-4 text-sm">
            <div className="text-gray-400">
              Total: <span className="font-medium text-white">{totalTasks}</span>
            </div>
            <div className="text-gray-400">
              Active:{" "}
              <span className="font-medium text-yellow-400">
                {inProgressTasks}
              </span>
            </div>
            <div className="text-gray-400">
              Done:{" "}
              <span className="font-medium text-green-400">{doneTasks}</span>
            </div>
            <div className="text-gray-400">
              Rate:{" "}
              <span className="font-medium text-blue-400">
                {completionRate}%
              </span>
            </div>
          </div>

          {onTerminalToggle && (
            <button
              onClick={onTerminalToggle}
              className={`rounded-lg px-3 py-2 text-sm font-mono font-medium transition-colors ${
                isTerminalOpen
                  ? "bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-800 hover:text-white"
              }`}
              title="Toggle Terminal"
            >
              {">_"}
            </button>
          )}
          <button
            onClick={onNewTask}
            className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
          >
            + New Task
          </button>
        </div>
      </div>
    </header>
  );
}
