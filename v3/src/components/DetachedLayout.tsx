import { useEffect, useState } from "react";
import { Header } from "./Header";
import { Sidebar } from "./sidebar/Sidebar";
import { BoardTab } from "./tabs/BoardTab";
import { CodeTab } from "./tabs/CodeTab";
import { TaskCreateModal } from "./board/TaskCreateModal";
import { useSessionRestore } from "../hooks/useSessionRestore";
import { useEditorStore } from "../stores/editorStore";
import { useProjectStore } from "../stores/projectStore";

export type DetachedView = "board" | "code";

/**
 * Detached pop-out window for a single tab (Board / Code).
 *
 * Rendered instead of <Layout> when the renderer boots with `?detached=<view>`
 * (set by main's createDetachedWindow). It deliberately drops the orchestrator
 * PTY, agent list panel, tab bar and activity stream — the whole point of a
 * pop-out is to focus on one panel — and only runs the hooks that panel needs:
 * useSessionRestore (to reconnect to the parent window's project) and a project
 * registration. It does NOT auto-launch the orchestrator or reconnect agents;
 * the original window already owns those, and doing so here would spawn a
 * duplicate orchestrator PTY.
 */
export function DetachedLayout({ view }: { view: DetachedView }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [showCreateTask, setShowCreateTask] = useState(false);

  // Reconnect this window to the project seeded by the parent (per-window
  // restore record set in main's createDetachedWindow).
  const { restoreSettled } = useSessionRestore();
  const rootPath = useEditorStore((s) => s.rootPath);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Scope per-project events to this window (best-effort; older builds may lack
  // the handler).
  useEffect(() => {
    window.electronAPI.window
      .registerProject(currentProject?.id ?? "")
      .catch(() => {});
  }, [currentProject?.id]);

  // Hold until session restore has resolved which project this window reconnects
  // to — otherwise Board/Code would flash empty before the project arrives.
  if (!rootPath && !restoreSettled) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => {}} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
            <p className="mt-3 text-sm text-gray-400">세션 복원 중...</p>
          </div>
        </div>
      </div>
    );
  }

  const TabComponent = view === "code" ? CodeTab : BoardTab;

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
      <Header onNavigateToSettings={() => {}} />

      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar kept for the file tree (Code opens files from it) and the
            project switcher. Orchestrator/create-task entry points still work
            via the local modal below. */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onOpenCreateTask={() => setShowCreateTask(true)}
        />

        <div className="flex flex-1 flex-col overflow-hidden pl-2">
          <div className="flex-1 overflow-auto">
            <TabComponent />
          </div>
        </div>
      </div>

      {showCreateTask && currentProject && (
        <TaskCreateModal
          projectId={currentProject.id}
          onClose={() => setShowCreateTask(false)}
        />
      )}
    </div>
  );
}
