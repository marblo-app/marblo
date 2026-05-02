import { useState, useEffect } from "react";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { Sidebar } from "./sidebar/Sidebar";
import TerminalPanel from "./terminal/TerminalPanel";
import OrchestratorPanel from "./orchestrator/OrchestratorPanel";
import { BoardTab } from "./tabs/BoardTab";
import { CodeTab } from "./tabs/CodeTab";
import { AgentsTab } from "./tabs/AgentsTab";
import { FlowsTab } from "./tabs/FlowsTab";
import { DeployTab } from "./tabs/DeployTab";
import { SettingsPage } from "./settings/SettingsPage";
import { PlanGate } from "./settings/PlanGate";
import { OrchestratorChat } from "./orchestrator/OrchestratorChat";
import { TaskCreateModal } from "./board/TaskCreateModal";
import { HarnessStore } from "./harness/HarnessStore";
import { CoupangDashboard } from "./channels/coupang/CoupangDashboard";
import { SmartStoreDashboard } from "./channels/smartstore/SmartStoreDashboard";
import { useOrchestratorAutoLaunch } from "../hooks/useOrchestratorAutoLaunch";
import { useAgentReconnect } from "../hooks/useAgentReconnect";
import { useSessionRestore } from "../hooks/useSessionRestore";
import { useCostWriter } from "../hooks/useCostWriter";
import { useTerminalStore } from "../stores/terminalStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";

function GatedFlowsTab() {
  return (
    <PlanGate feature="flows">
      <FlowsTab />
    </PlanGate>
  );
}

const tabComponents: Record<TabId, () => JSX.Element> = {
  board: BoardTab,
  code: CodeTab,
  agents: AgentsTab,
  flows: GatedFlowsTab,
  deploy: DeployTab,
  coupang: CoupangDashboard,
  smartstore: SmartStoreDashboard,
  settings: SettingsPage,
};

export function Layout() {
  const [activeTab, setActiveTab] = useState<TabId>("board");
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const attachSession = useTerminalStore((s) => s.attachSession);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Register this window's current project with main so per-project events
  // (agent:spawned, agent:statusChanged, etc.) are scoped to this window in
  // multi-window mode. Empty string clears the registration.
  useEffect(() => {
    window.electronAPI.window
      .registerProject(currentProject?.id ?? "")
      .catch(() => {
        /* main may not have the handler in older builds — best-effort */
      });
  }, [currentProject?.id]);

  // Sidebar → modal state
  const [showOrchestratorChat, setShowOrchestratorChat] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showHarnessStore, setShowHarnessStore] = useState(false);

  // Open Harness store via global keyboard shortcut (Cmd/Ctrl+Shift+H)
  // and via custom event so future Sidebar/Header buttons can trigger it.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "h"
      ) {
        e.preventDefault();
        setShowHarnessStore(true);
      }
    };
    const onOpenHarness = () => setShowHarnessStore(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("marblo:open-harness", onOpenHarness);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("marblo:open-harness", onOpenHarness);
    };
  }, []);

  // Restore last session (rootPath + project) on startup
  const { isNewWindow } = useSessionRestore();
  const rootPath = useEditorStore((s) => s.rootPath);

  // Auto-launch orchestrator when project is selected
  useOrchestratorAutoLaunch();

  // Auto-reconnect agents on app restart + system wake
  useAgentReconnect();

  // Write cost updates from main process to Firestore (using renderer's auth)
  useCostWriter();

  // Listen for terminal:new from menu → create a new terminal tab
  const createSession = useTerminalStore((s) => s.createSession);
  useEffect(() => {
    let counter = 0;
    window.electronAPI.on("terminal:new", () => {
      counter++;
      createSession(`Terminal ${counter}`);
    });
    return () => {
      window.electronAPI.off("terminal:new");
    };
  }, [createSession]);

  // Listen for agent:deleted events from bridge server → delete from Firestore
  useEffect(() => {
    window.electronAPI.on("agent:deleted", (data: unknown) => {
      const { agentId } = data as { agentId: string; agentName: string };
      // Delete from Firestore (stop is already done in main process)
      import("../services/agentService").then(({ deleteAgent: fsDelete }) => {
        fsDelete(agentId).catch(() => {});
      });
    });
    return () => {
      window.electronAPI.off("agent:deleted");
    };
  }, []);

  // Listen for agent:spawned events from bridge server → auto-attach terminal tab + chat notification
  useEffect(() => {
    window.electronAPI.orchestratorSession.onAgentSpawned(async (data) => {
      attachSession(data.ptySessionId, `Agent: ${data.name}`);
      // Send chat notification
      if (currentProject) {
        try {
          const { notifyAgentSpawned } =
            await import("../services/agentNotificationService");
          await notifyAgentSpawned(
            currentProject.id,
            data.name,
            data.role || "agent",
          );
        } catch {
          // Chat notification is best-effort
        }
      }
    });
    return () => {
      // Cleanup to prevent duplicate listeners on re-mount
      window.electronAPI.off("agent:spawned");
    };
  }, [attachSession, currentProject]);

  const ActiveTabComponent = tabComponents[activeTab];
  const setRootPath = useEditorStore((s) => s.setRootPath);
  const findByFolderPath = useProjectStore((s) => s.findByFolderPath);
  const setCurrentProject = useProjectStore((s) => s.setCurrentProject);

  // New window: show folder picker prompt
  if (isNewWindow && !rootPath) {
    const handleSelectFolder = async () => {
      const dir = await window.electronAPI.fs.selectDirectory();
      if (!dir) return;
      setRootPath(dir);
      const existing = findByFolderPath(dir);
      if (existing) setCurrentProject(existing);
    };

    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setActiveTab("settings")} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-6">
            <div className="text-6xl">M</div>
            <h1 className="text-2xl font-bold text-gray-100">Marblo</h1>
            <p className="text-gray-400">프로젝트 폴더를 선택하여 시작하세요</p>
            <button
              onClick={handleSelectFolder}
              className="rounded-lg bg-blue-600 px-6 py-3 text-sm font-medium text-white transition-colors hover:bg-blue-500"
            >
              Open Folder
            </button>
          </div>
        </div>
      </div>
    );
  }

  // DIAG: VITE_DIAG_MINIMAL=1 renders only OrchestratorPanel (no Sidebar,
  // Header, TabBar, tab content). Tests if Marblo's React tree complexity
  // is causing typing input delay. If INP drops dramatically in minimal
  // mode, the heavy tree is the culprit.
  if (import.meta.env.VITE_DIAG_MINIMAL === "1") {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <div className="p-2 text-xs text-yellow-400">
          [DIAG] Minimal Layout — only OrchestratorPanel
        </div>
        <div className="flex-1 overflow-hidden">
          <OrchestratorPanel />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <Header onNavigateToSettings={() => setActiveTab("settings")} />

      {/* Main body */}
      <div className="flex flex-1 overflow-hidden">
        {/* Sidebar */}
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen(!sidebarOpen)}
          onOpenOrchestrator={() => setShowOrchestratorChat(true)}
          onOpenCreateTask={() => setShowCreateTask(true)}
        />

        {/* Content area */}
        <div className="flex flex-1 flex-col overflow-hidden pl-2">
          {/* Tab bar */}
          <TabBar activeTab={activeTab} onTabChange={setActiveTab} />

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            <ActiveTabComponent />
          </div>

          {/* Orchestrator panel — between tab content and terminal */}
          <OrchestratorPanel />

          {/* Terminal panel — DIAG: toggle via VITE_DISABLE_TERMINAL_PANEL=1 */}
          {import.meta.env.VITE_DISABLE_TERMINAL_PANEL !== "1" && (
            <TerminalPanel />
          )}
        </div>
      </div>

      {/* Modals triggered from CommandPanel */}
      {showOrchestratorChat && (
        <OrchestratorChat onClose={() => setShowOrchestratorChat(false)} />
      )}
      {showCreateTask && currentProject && (
        <TaskCreateModal
          projectId={currentProject.id}
          onClose={() => setShowCreateTask(false)}
        />
      )}
      {showHarnessStore && (
        <HarnessStore onClose={() => setShowHarnessStore(false)} />
      )}
    </div>
  );
}
