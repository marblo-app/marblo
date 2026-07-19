import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { Header } from "../Header";
import { UpdateBanner } from "../UpdateBanner";
import { ProjectSetupBanners } from "../onboarding/ProjectSetupBanners";
import { CliSetupGate } from "../onboarding/CliSetupGate";
import { PrivacyConsentGate } from "../legal/PrivacyConsentGate";
import { ChatToastHost } from "../chat/ChatToastHost";
import { BugReportNoticeToast } from "../chat/BugReportNoticeToast";
import { SettingsPage } from "../settings/SettingsPage";
import { UpgradeModal } from "../settings/UpgradeModal";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { usePaneStore } from "../../stores/paneStore";
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceModeStore } from "../../stores/workspaceModeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { LayoutView } from "./LayoutView";
import { OrchestratorSpine } from "./OrchestratorSpine";
import { AgentDock } from "./AgentDock";

/**
 * Unified Workspace shell — the flag-ON experience.
 *
 * Layout: collapsible orchestrator spine (left) · chrome-tab pane area with
 * drag / split / close (center) · collapsible agent dock (bottom) · plus a
 * self-contained browser pane and the diff-A code surface, both reachable as
 * pane kinds. Renders INSTEAD of the legacy <Layout /> when workspace mode is
 * on; the legacy path is completely untouched.
 */
export function WorkspaceShell() {
  const { projectSetup, isNewWindow, restoreSettled, rootPath } =
    useAppLifecycle();
  const { handleSelectDirectory } = projectSetup;

  const layout = usePaneStore((s) => s.layout);
  const addPane = usePaneStore((s) => s.addPane);

  const [spineCollapsed, setSpineCollapsed] = useState(false);
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [showSettings, setShowSettings] = useState(false);

  const disableWorkspaceMode = useWorkspaceModeStore((s) => s.setEnabled);
  const upgradeModal = useUiStore((s) => s.upgradeModal);
  const hideUpgrade = useUiStore((s) => s.hideUpgrade);
  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);

  // Deep-link to Settings (e.g. Upgrade modal CTA) → open the overlay.
  useEffect(() => {
    if (pendingSettingsSection) setShowSettings(true);
  }, [pendingSettingsSection]);

  // Activity Stream jump (task/agent/code) → surface the matching pane.
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "task") addPane("board");
    else if (pendingJump.type === "agent") addPane("agents");
    else if (pendingJump.type === "code") {
      addPane("code");
      consumeJump();
    } else if (pendingJump.type === "worktrees") {
      addPane("worktrees");
      consumeJump();
    }
  }, [pendingJump, consumeJump, addPane]);

  // Folder-pick gate — identical semantics to Layout: hold while a new window's
  // restore is in flight, then prompt for a folder.
  if (isNewWindow && !rootPath && !restoreSettled) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setShowSettings(true)} />
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

  if (isNewWindow && !rootPath) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setShowSettings(true)} />
        <div className="flex flex-1 items-center justify-center">
          <div className="space-y-6 text-center">
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

  return (
    <div className="relative flex h-screen flex-col bg-gray-900 text-gray-100">
      <Header onNavigateToSettings={() => setShowSettings(true)} />
      <UpdateBanner />
      <ProjectSetupBanners {...projectSetup} />

      {/* Workspace-mode chrome: label + exit hatch. Keeps the opt-in reversible
          from inside the shell without needing to open Settings. */}
      <div className="flex items-center gap-2 border-b border-gray-700 bg-gray-800 px-3 py-1 text-[11px] text-gray-400">
        <span className="rounded bg-blue-600/20 px-1.5 py-0.5 font-semibold uppercase tracking-wider text-blue-300">
          {t("workspace.badge")}
        </span>
        <span className="flex-1 truncate">{t("workspace.tagline")}</span>
        <button
          type="button"
          onClick={() => disableWorkspaceMode(false)}
          className="rounded px-2 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        >
          {t("workspace.exit")}
        </button>
      </div>

      {/* Body: spine | (panes over dock) */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <OrchestratorSpine
          collapsed={spineCollapsed}
          onToggle={() => setSpineCollapsed((v) => !v)}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-hidden">
            <LayoutView node={layout} />
          </div>
          <AgentDock
            collapsed={dockCollapsed}
            onToggle={() => setDockCollapsed((v) => !v)}
            onOpenAgent={() => addPane("agents")}
          />
        </div>
      </div>

      {/* Global gates / hosts (parity with Layout). */}
      <CliSetupGate />
      <PrivacyConsentGate />
      <ChatToastHost />
      <BugReportNoticeToast />

      {upgradeModal && (
        <UpgradeModal
          feature={upgradeModal.feature}
          requiredPlan={upgradeModal.requiredPlan}
          onClose={hideUpgrade}
        />
      )}

      {/* Settings as an overlay (no dedicated tab bar in the shell). */}
      {showSettings && (
        <div className="absolute inset-0 z-40 flex flex-col bg-gray-900">
          <div className="flex items-center justify-between border-b border-gray-700 bg-gray-800 px-3 py-2">
            <span className="text-sm font-semibold text-gray-200">
              {t("settings.title")}
            </span>
            <button
              type="button"
              onClick={() => setShowSettings(false)}
              className="rounded px-2 py-1 text-xs text-gray-400 hover:bg-gray-700 hover:text-gray-200"
            >
              ✕
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto">
            <SettingsPage />
          </div>
        </div>
      )}
    </div>
  );
}
