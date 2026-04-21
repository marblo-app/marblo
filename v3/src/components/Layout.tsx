import { useState, useEffect } from 'react';
import { Header } from './Header';
import { TabBar, type TabId } from './TabBar';
import { Sidebar } from './sidebar/Sidebar';
import TerminalPanel from './terminal/TerminalPanel';
import OrchestratorPanel from './orchestrator/OrchestratorPanel';
import { BoardTab } from './tabs/BoardTab';
import { CodeTab } from './tabs/CodeTab';
import { AgentsTab } from './tabs/AgentsTab';
import { FlowsTab } from './tabs/FlowsTab';
import { DeployTab } from './tabs/DeployTab';
import { SettingsPage } from './settings/SettingsPage';
import { PlanGate } from './settings/PlanGate';
import { OrchestratorChat } from './orchestrator/OrchestratorChat';
import { TaskCreateModal } from './board/TaskCreateModal';
import { useOrchestratorAutoLaunch } from '../hooks/useOrchestratorAutoLaunch';
import { useAgentReconnect } from '../hooks/useAgentReconnect';
import { useSessionRestore } from '../hooks/useSessionRestore';
import { useCostWriter } from '../hooks/useCostWriter';
import { useTerminalStore } from '../stores/terminalStore';
import { useProjectStore } from '../stores/projectStore';

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
  settings: SettingsPage,
};

export function Layout() {
  const [activeTab, setActiveTab] = useState<TabId>('board');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const attachSession = useTerminalStore((s) => s.attachSession);
  const currentProject = useProjectStore((s) => s.currentProject);

  // Sidebar → modal state
  const [showOrchestratorChat, setShowOrchestratorChat] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);

  // Restore last session (rootPath + project) on startup
  useSessionRestore();

  // Auto-launch orchestrator when project is selected
  useOrchestratorAutoLaunch();

  // Auto-reconnect agents on app restart + system wake
  useAgentReconnect();

  // Write cost updates from main process to Firestore (using renderer's auth)
  useCostWriter();

  // Listen for agent:deleted events from bridge server → delete from Firestore
  useEffect(() => {
    window.electronAPI.on('agent:deleted', (data: unknown) => {
      const { agentId } = data as { agentId: string; agentName: string };
      // Delete from Firestore (stop is already done in main process)
      import('../services/agentService').then(({ deleteAgent: fsDelete }) => {
        fsDelete(agentId).catch(() => {});
      });
    });
    return () => { window.electronAPI.off('agent:deleted'); };
  }, []);

  // Listen for agent:spawned events from bridge server → auto-attach terminal tab + chat notification
  useEffect(() => {
    window.electronAPI.orchestratorSession.onAgentSpawned(async (data) => {
      attachSession(data.ptySessionId, `Agent: ${data.name}`);
      // Send chat notification
      if (currentProject) {
        try {
          const { notifyAgentSpawned } = await import('../services/agentNotificationService');
          await notifyAgentSpawned(currentProject.id, data.name, data.role || 'agent');
        } catch {
          // Chat notification is best-effort
        }
      }
    });
    return () => {
      // Cleanup to prevent duplicate listeners on re-mount
      window.electronAPI.off('agent:spawned');
    };
  }, [attachSession, currentProject]);

  const ActiveTabComponent = tabComponents[activeTab];

  return (
    <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
      {/* Header */}
      <Header onNavigateToSettings={() => setActiveTab('settings')} />

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

          {/* Terminal panel */}
          <TerminalPanel />
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
    </div>
  );
}
