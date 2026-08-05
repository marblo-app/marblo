import { useState, useEffect, useRef } from "react";
import { t } from "../lib/i18n";
import { Header } from "./Header";
import { TabBar, type TabId } from "./TabBar";
import { Sidebar } from "./sidebar/Sidebar";
import { AgentListPanel } from "./agents/list-panel/AgentListPanel";
import OrchestratorPanel from "./orchestrator/OrchestratorPanel";
import { BoardTab } from "./tabs/BoardTab";
import { LanesTab } from "./lanes/LanesTab";
import { CodeTab } from "./tabs/CodeTab";
import { AgentsTab } from "./tabs/AgentsTab";
import { UsagePage } from "./usage/UsagePage";
import { FlowsTab } from "./tabs/FlowsTab";
import { MissionsTab } from "./tabs/MissionsTab";
import { DeployTab } from "./tabs/DeployTab";
import { WorktreeTab } from "./tabs/WorktreeTab";
import { WorkHistoryTab } from "./work-history/WorkHistoryTab";
import { SettingsPage } from "./settings/SettingsPage";
import { PlanGate } from "./settings/PlanGate";
import { OrchestratorChat } from "./orchestrator/OrchestratorChat";
import { TaskCreateModal } from "./board/TaskCreateModal";
import { HarnessStore } from "./harness/HarnessStore";
import { StoreTab } from "./store/StoreTab";
import { GuideTab } from "./guide/GuideTab";
import { ActivityStreamPanel } from "./activity/ActivityStreamPanel";
import { CliSetupGate } from "./onboarding/CliSetupGate";
import { GlobalOverlays } from "./GlobalOverlays";
import { useProjectSetup } from "../hooks/useProjectSetup";
import { useOrchestratorAutoLaunch } from "../hooks/useOrchestratorAutoLaunch";
import { useAgentReconnect } from "../hooks/useAgentReconnect";
import { useAgentSessionMapSync } from "../hooks/useAgentSessionMapSync";
import { useTerminalRestore } from "../hooks/useTerminalRestore";
import { useSessionRestore } from "../hooks/useSessionRestore";
import { useActiveWorktreeSync } from "../hooks/useActiveWorktreeSync";
import { useCostWriter } from "../hooks/useCostWriter";
import { usePresenceHeartbeat } from "../hooks/usePresenceHeartbeat";
import { useTerminalStore } from "../stores/terminalStore";
import { useProjectStore } from "../stores/projectStore";
import { useEditorStore } from "../stores/editorStore";
import { useActivityStreamStore } from "../stores/activityStreamStore";
import { useNavigationStore } from "../stores/navigationStore";
import { useUiStore } from "../stores/uiStore";
import { DEMO_CONNECT_PENDING_KEY } from "./onboarding/DemoMode";

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
  lanes: LanesTab,
  missions: MissionsTab,
  code: CodeTab,
  agents: AgentsTab,
  usage: UsagePage,
  flows: GatedFlowsTab,
  deploy: DeployTab,
  worktrees: WorktreeTab,
  history: WorkHistoryTab,
  store: StoreTab,
  harness: HarnessTabPanel,
  settings: SettingsPage,
};

const HAS_LAUNCHED_KEY = "marblo.hasLaunched";

export function Layout() {
  // 기본 탭: Board. 생애 최초 실행만 Guide 를 띄워 온보딩 유도.
  const [activeTab, setActiveTab] = useState<TabId>(() => {
    if (typeof window === "undefined") return "board";
    try {
      if (!localStorage.getItem(HAS_LAUNCHED_KEY)) {
        localStorage.setItem(HAS_LAUNCHED_KEY, "1");
        return "guide";
      }
    } catch {
      // localStorage 접근 실패(프라이빗 모드 등) — Board 로 안전 폴백
    }
    return "board";
  });
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

  // Pre-auth 데모(Demo Mode P3, ticket qQLGS3NW)의 CTA 이어받기: 미인증 데모에서
  // "이제 내 계정을 연결해 실제로 실행하기" 를 누른 사용자는 이 플래그를 남긴다.
  // 로그인 성공 후 처음 Layout 이 뜨는 지금, 플래그를 소비하고 연결 마법사의
  // 기존 진입점(`marblo:open-cli-setup`)을 그대로 디스패치해 CliSetupGate 위저드를
  // 연다 — 위저드는 재구현하지 않고 이벤트만 재사용. 자식(CliSetupGate)의 리스너
  // 등록 이후 실행되도록 setTimeout(0) 으로 커밋 다음 틱에 발화한다.
  useEffect(() => {
    let pending = false;
    try {
      pending = localStorage.getItem(DEMO_CONNECT_PENDING_KEY) === "1";
      if (pending) localStorage.removeItem(DEMO_CONNECT_PENDING_KEY);
    } catch {
      /* 프라이빗 모드 — 플래그 없으면 첫-실행 위저드가 자연히 뜬다 */
    }
    if (!pending) return;
    const h = setTimeout(() => {
      window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
    }, 0);
    return () => clearTimeout(h);
  }, []);

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
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "task") setActiveTab("board");
    else if (pendingJump.type === "agent") setActiveTab("agents");
    else if (pendingJump.type === "code") {
      // Sidebar file click → bring the Code tab forward. Nothing downstream
      // consumes this jump (the editor reads openFiles directly), so clear it
      // here to avoid leaving a stale latch.
      setActiveTab("code");
      consumeJump();
    } else if (pendingJump.type === "worktrees") {
      // Same shape as "code": nothing downstream consumes it, so clear here.
      setActiveTab("worktrees");
      consumeJump();
    }
  }, [pendingJump, consumeJump]);

  // Settings-section routing (uiStore). The global upgrade modal itself now
  // lives in <GlobalOverlays/>; this only handles its CTA's deep link, which
  // requests the Billing section and switches us to the Settings tab (the
  // SettingsPage then selects the Billing sub-tab and clears the latch).
  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);
  useEffect(() => {
    if (pendingSettingsSection) setActiveTab("settings");
  }, [pendingSettingsSection]);
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
  const { isNewWindow, restoreSettled } = useSessionRestore();
  const rootPath = useEditorStore((s) => s.rootPath);

  // Keep worktreeViewStore.activeWorktreeId reconciled with rootPath (the
  // strangler seam for the "activeWorktree" concept — see useActiveWorktreeSync).
  useActiveWorktreeSync();

  // Auto-launch orchestrator when project is selected
  useOrchestratorAutoLaunch();

  // Auto-reconnect agents on app restart + system wake
  useAgentReconnect();

  // agentSessionMap 을 sessions × agents 에서 reactively 동기화.
  // reconnect / spawn / 다른 윈도우 attach 경로 어디서 누락돼도, agent name
  // suffix 매칭으로 자동 등록되어 그리드 MiniTerminal 이 즉시 살아남.
  useAgentSessionMapSync();

  // 사용자 spawn 터미널을 프로젝트 단위로 영속화 → 재시작 시 같은 이름 /
  // cwd 로 재spawn. 셸 PTY 는 resume 이 없어 히스토리는 손실, 탭 구성만 복원.
  useTerminalRestore();

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

  // Bridge the main-process login-screen backstop to the CLI setup gate: when
  // agent-manager detects an agent booting into a login prompt (unauthenticated
  // claude/codex), it sends agent:needsAuth — open the gate so the user gets
  // the install/login guidance instead of a silently dead agent.
  useEffect(() => {
    window.electronAPI.on("agent:needsAuth", () => {
      window.dispatchEvent(new CustomEvent("marblo:open-cli-setup"));
    });
    return () => {
      window.electronAPI.off("agent:needsAuth");
    };
  }, []);

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
          const { doc, setDoc, serverTimestamp } =
            await import("firebase/firestore");
          const { db } = await import("../lib/firebase");
          await setDoc(
            doc(db, "agents", data.agentId),
            {
              projectId: currentProject.id,
              ownerId: "orchestrator",
              name: data.name,
              model: data.model,
              // 구체 모델(model@effort)은 값이 있을 때만 실는다 — undefined 를
              // 쓰면 merge 로 기존 스탬프를 지우게 된다. 없으면 UI 가 벤더로
              // graceful fallback.
              ...(data.spawnedModel ? { spawnedModel: data.spawnedModel } : {}),
              role: data.role || "agent",
              status: "working",
              currentTaskId: null,
              // Map model → CLI binary. Historically this stored `data.model`
              // verbatim, which happens to match the binary for claude/gemini
              // but collides with macOS /usr/sbin/gpt (GUID Partition Table
              // utility) for the "gpt" model — the agent process then exits
              // immediately with "gpt: illegal option -- c". Match the table
              // in v3/electron/main.ts getDefaultCommand().
              command:
                data.model === "gpt"
                  ? "codex"
                  : data.model === "antigravity"
                    ? "agy"
                    : data.model,
              skillFile: "",
              createdAt: serverTimestamp(),
            },
            { merge: true },
          );
        } catch (err) {
          console.warn(
            "[Layout] Firestore agent upsert failed (non-fatal):",
            err,
          );
        }
      }

      // 에이전트 라이프사이클 이벤트는 우측 ActivityStreamPanel 로만
      // 전달한다 — 팀 채팅(messages) 은 사람 간 대화용으로 분리.
    });
    return () => {
      // Cleanup to prevent duplicate listeners on re-mount
      window.electronAPI.off("agent:spawned");
    };
  }, [attachSession, currentProject]);

  const ActiveTabComponent = tabComponents[activeTab];

  // Project setup flow (folder pick → zero-click auto-register / inline create).
  // Hosted here at the always-present Layout so the board / agents no-project
  // CTAs work in any UI state — collapsed sidebar, or the commands/chat panels
  // where FileTree (the old listener host) isn't mounted. The board / agents
  // empty states dispatch `marblo:select-folder`; this single listener handles
  // every trigger, so there's no duplicate-listener drift.
  const projectSetup = useProjectSetup();
  const { handleSelectDirectory } = projectSetup;
  useEffect(() => {
    const onSelectFolder = () => void handleSelectDirectory();
    window.addEventListener("marblo:select-folder", onSelectFolder);
    return () =>
      window.removeEventListener("marblo:select-folder", onSelectFolder);
  }, [handleSelectDirectory]);

  // New window, restore still in flight: hold off the folder picker until we
  // know whether this is a fresh new window or one reconnecting after a
  // sleep/wake renderer reload — otherwise a woken window flashes the picker
  // before its project comes back.
  if (isNewWindow && !rootPath && !restoreSettled) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setActiveTab("settings")} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="mx-auto h-8 w-8 animate-spin rounded-full border-2 border-gray-600 border-t-blue-500" />
            <p className="mt-3 text-sm text-gray-400">
              {t("common.restoringSession")}
            </p>
          </div>
        </div>
      </div>
    );
  }

  // New window: show folder picker prompt. Reuses the same unified flow as
  // every other "Open Folder" trigger (useProjectSetup.handleSelectDirectory)
  // so picking a folder here auto-registers a project (named after the folder)
  // and boots the orchestrator in one click — no re-prompt, no name-confirm
  // step. Once handleSelectDirectory sets rootPath, this branch stops matching
  // and the full Layout (with any fallback banner) takes over on re-render.
  if (isNewWindow && !rootPath) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setActiveTab("settings")} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center space-y-6">
            <div className="text-6xl">M</div>
            <h1 className="text-2xl font-bold text-gray-100">Marblo</h1>
            <p className="text-gray-400">{t("common.selectFolderPrompt")}</p>
            <button
              onClick={() => void handleSelectDirectory()}
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

      {/* Shared global banners/modals/toasts — parity-guarded against
          WorkspaceShell, see GlobalOverlays. */}
      <GlobalOverlays projectSetup={projectSetup} />

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
          <TabBar
            activeTab={activeTab}
            onTabChange={setActiveTab}
            onPopOut={(view) => {
              window.electronAPI.window.popOutTab(view).catch(() => {
                /* older builds without the handler — best-effort */
              });
            }}
          />

          {/* Tab content */}
          <div className="flex-1 overflow-auto">
            <ActiveTabComponent />
          </div>

          {/* Orchestrator panel — board PTY. Mission PTY 는 Missions 탭 안 상단에
              별도 inline 으로 표시 (Layout 안 건드림). */}
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

      {/* CLI setup gate — orchestrator-first: stays quiet on the empty board
          (auto-installs in the background) and surfaces at orchestrator-launch
          time when Claude auth is needed, or when a spawn is blocked. An
          already-set-up user never sees it. */}
      <CliSetupGate />

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
