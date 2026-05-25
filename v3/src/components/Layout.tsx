import { useState, useEffect, useRef } from "react";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { Sidebar } from "./sidebar/Sidebar";
import { AgentListPanel } from "./agents/list-panel/AgentListPanel";
import OrchestratorPanel from "./orchestrator/OrchestratorPanel";
import { BoardTab } from "./tabs/BoardTab";
import { CodeTab } from "./tabs/CodeTab";
import { AgentsTab } from "./tabs/AgentsTab";
import { FlowsTab } from "./tabs/FlowsTab";
import { MissionsTab } from "./tabs/MissionsTab";
import { DeployTab } from "./tabs/DeployTab";
import { SettingsPage } from "./settings/SettingsPage";
import { PlanGate } from "./settings/PlanGate";
import { OrchestratorChat } from "./orchestrator/OrchestratorChat";
import { TaskCreateModal } from "./board/TaskCreateModal";
import { HarnessStore } from "./harness/HarnessStore";
import { GuideTab } from "./guide/GuideTab";
import { ActivityStreamPanel } from "./activity/ActivityStreamPanel";
import { PrivacyConsentGate } from "./legal/PrivacyConsentGate";
import { UpdateBanner } from "./UpdateBanner";
import { useOrchestratorAutoLaunch } from "../hooks/useOrchestratorAutoLaunch";
import { useAgentReconnect } from "../hooks/useAgentReconnect";
import { useSessionRestore } from "../hooks/useSessionRestore";
import { useCostWriter } from "../hooks/useCostWriter";
import { usePresenceHeartbeat } from "../hooks/usePresenceHeartbeat";
import { useTerminalStore } from "../stores/terminalStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useActivityStreamStore } from "../stores/activityStreamStore";
import { useNavigationStore } from "../stores/navigationStore";

function GatedFlowsTab() {
  return (
    <PlanGate feature="flows">
      <FlowsTab />
    </PlanGate>
  );
}

function HarnessTabPanel() {
  // HarnessStore renders inline (without modal overlay) when onClose is undefined.
  return <HarnessStore />;
}

const tabComponents: Record<TabId, () => JSX.Element> = {
  guide: GuideTab,
  board: BoardTab,
  missions: MissionsTab,
  code: CodeTab,
  agents: AgentsTab,
  flows: GatedFlowsTab,
  deploy: DeployTab,
  harness: HarnessTabPanel,
  settings: SettingsPage,
};

export function Layout() {
  // Mission tab 을 default 로 승격 (명세 §6) — 미션 진행이 메인 사용 경로.
  const [activeTab, setActiveTab] = useState<TabId>("missions");
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

  // When the user switches projects in this window, clean up window-local UI
  // state that was tied to the previous project. Backend agents and PTYs are
  // intentionally left alive — other windows or AgentManager may still own
  // them, and the new window is meant to operate independently.
  const closeAllFiles = useEditorStore((s) => s.closeAllFiles);
  const detachAllSessions = useTerminalStore((s) => s.detachAllSessions);
  const prevProjectIdRef = useRef<string | null>(null);
  useEffect(() => {
    const newId = currentProject?.id ?? null;
    const prevId = prevProjectIdRef.current;
    if (prevId !== null && prevId !== newId) {
      closeAllFiles();
      detachAllSessions().catch(() => {});
      // Orchestrator self-cleans via useOrchestratorAutoLaunch's key change.
    }
    prevProjectIdRef.current = newId;
  }, [currentProject?.id, closeAllFiles, detachAllSessions]);

  // Sidebar → modal state
  const [showOrchestratorChat, setShowOrchestratorChat] = useState(false);
  const [showCreateTask, setShowCreateTask] = useState(false);
  const [showHarnessStore, setShowHarnessStore] = useState(false);

  // Global keyboard shortcuts:
  //   Cmd/Ctrl+Shift+H — Harness store
  //   Cmd/Ctrl+Shift+A — Activity Stream side panel
  // Plus a custom event so future Sidebar/Header buttons can trigger Harness.
  const toggleActivityStream = useActivityStreamStore((s) => s.toggle);

  // When Activity Stream requests a jump (task / agent), switch to the right
  // tab. The destination tab consumes the latched target on mount via
  // useNavigationStore.consumeJump() and applies its own selection.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "task") setActiveTab("board");
    else if (pendingJump.type === "agent") setActiveTab("agents");
  }, [pendingJump]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || !e.shiftKey) return;
      const key = e.key.toLowerCase();
      if (key === "h") {
        e.preventDefault();
        setShowHarnessStore(true);
      } else if (key === "a") {
        e.preventDefault();
        toggleActivityStream();
      }
    };
    const onOpenHarness = () => setShowHarnessStore(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("marblo:open-harness", onOpenHarness);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("marblo:open-harness", onOpenHarness);
    };
  }, [toggleActivityStream]);

  // Restore last session (rootPath + project) on startup
  const { isNewWindow } = useSessionRestore();
  const rootPath = useEditorStore((s) => s.rootPath);

  // Auto-launch orchestrator when project is selected
  useOrchestratorAutoLaunch();

  // Auto-reconnect agents on app restart + system wake
  useAgentReconnect();

  // Write cost updates from main process to Firestore (using renderer's auth)
  useCostWriter();

  // Refresh user presence heartbeat every 30s so teammates can see who is
  // online. Drives the activity badge on task cards (claimant offline →
  // instructions queue rather than silently failing).
  usePresenceHeartbeat();

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

  // Listen for agent:spawned events from bridge server → auto-attach terminal tab,
  // upsert Firestore doc (covers Flow-runner / direct-bridge spawn paths that
  // bypass MCP-side Firestore writes), and send chat notification.
  useEffect(() => {
    window.electronAPI.orchestratorSession.onAgentSpawned(async (data) => {
      attachSession(data.ptySessionId, `Agent: ${data.name}`);

      // Fleet 그리드 셀이 agentId 만 갖고 PTY 미러를 구독할 수 있도록 매핑
      // 등록. AgentsTab.handleLaunch 가 직접 띄운 경우는 거기서 set 하지만,
      // 브릿지/플로우/MCP 경로로 들어온 spawn 은 이 핸들러가 유일한 fan-in
      // 지점이라 여기서 set 해야 한다.
      const { useAgentSessionMap } = await import("../stores/agentSessionMap");
      useAgentSessionMap.getState().set(data.agentId, data.ptySessionId);

      // Idempotent Firestore upsert — converges with MCP-side setDoc on the
      // same agentId. merge:true so concurrent writers don't overwrite each
      // other's fields.
      if (currentProject) {
        try {
          const { doc, setDoc, serverTimestamp } = await import(
            "firebase/firestore"
          );
          const { db } = await import("../lib/firebase");
          await setDoc(
            doc(db, "agents", data.agentId),
            {
              projectId: currentProject.id,
              ownerId: "orchestrator",
              name: data.name,
              model: data.model,
              role: data.role || "agent",
              status: "working",
              currentTaskId: null,
              command: data.model,
              skillFile: "",
              createdAt: serverTimestamp(),
            },
            { merge: true }
          );
        } catch (err) {
          console.warn(
            "[Layout] Firestore agent upsert failed (non-fatal):",
            err
          );
        }
      }

      // Chat notification — best-effort.
      if (currentProject) {
        try {
          const { notifyAgentSpawned } = await import(
            "../services/agentNotificationService"
          );
          await notifyAgentSpawned(
            currentProject.id,
            data.name,
            data.role || "agent"
          );
        } catch {
          // best-effort
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

      {/* Auto-update banner — silent when no update; sticky when one
          is available / downloading / downloaded. Hotfix releases show
          a forced-restart countdown. */}
      <UpdateBanner />

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

          {/* Orchestrator panel — between tab content and agent list */}
          <OrchestratorPanel />

          {/* Agent List panel — replaces the old TerminalPanel.
              P3 hybrid rows for ambient monitoring; double-click a row to
              jump to the full AgentsTab. DIAG: toggle via VITE_DISABLE_TERMINAL_PANEL=1. */}
          {import.meta.env.VITE_DISABLE_TERMINAL_PANEL !== "1" && (
            <AgentListPanel
              onJumpToAgent={() => setActiveTab("agents")}
              onSpawnClick={() => setActiveTab("agents")}
            />
          )}
        </div>

        {/* Activity Stream — right-side collapsible panel (⌘⇧A toggles).
            Lives outside the content column so it spans full body height
            and doesn't squeeze the orchestrator/terminal stacks. */}
        <ActivityStreamPanel />
      </div>

      {/* PIPA consent — auto-shows on first launch / policy version bump */}
      <PrivacyConsentGate />

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
