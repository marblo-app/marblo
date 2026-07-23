import { useCallback, useEffect, useRef, useState } from "react";
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
import { useUiStore } from "../../stores/uiStore";
import { useWorkspaceModeStore } from "../../stores/workspaceModeStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import {
  isTerminalCollapsed,
  ratioFromPointer,
  NARROW_BREAKPOINT,
} from "../../lib/splitWorkspaceLayout";
import { TerminalColumn } from "./TerminalColumn";
import { WorkTabs } from "./WorkTabs";

/**
 * Unified Workspace shell — the flag-ON experience (CEO-confirmed IDE split).
 *
 * Layout: a fixed LEFT terminal column (orchestrator + agents) · a draggable
 * divider · a RIGHT work-view pane (Board / Code / Worktrees / History tabs).
 * The two panes are sibling DOM subtrees, so switching a right tab never
 * disturbs the left terminals — the core UX moat over Orca.
 *
 * The left pane width, active right tab, and terminal-collapse state persist
 * (splitWorkspaceStore). On narrow windows the terminal column auto-collapses
 * to a slim rail. Renders INSTEAD of the legacy <Layout /> when workspace mode
 * is on; the legacy path is completely untouched (flag OFF → pixel-identical).
 */
export function WorkspaceShell() {
  const { projectSetup, isNewWindow, restoreSettled, rootPath } =
    useAppLifecycle();
  const { handleSelectDirectory } = projectSetup;

  const [showSettings, setShowSettings] = useState(false);

  const disableWorkspaceMode = useWorkspaceModeStore((s) => s.setEnabled);
  const upgradeModal = useUiStore((s) => s.upgradeModal);
  const hideUpgrade = useUiStore((s) => s.hideUpgrade);
  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);

  const ratio = useSplitWorkspaceStore((s) => s.ratio);
  const setRatio = useSplitWorkspaceStore((s) => s.setRatio);
  const terminalCollapsed = useSplitWorkspaceStore((s) => s.terminalCollapsed);
  const toggleTerminalCollapsed = useSplitWorkspaceStore(
    (s) => s.toggleTerminalCollapsed,
  );
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);

  // Track the split container width for the narrow-window auto-collapse. A
  // callback ref (dis)connects the observer as the body mounts/unmounts, so it
  // survives the folder-pick gate's early returns. Seed wide to avoid a
  // first-frame collapse flash before the observer reports the real width.
  const bodyElRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [bodyWidth, setBodyWidth] = useState<number>(NARROW_BREAKPOINT * 2);
  const bodyRefCb = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    bodyElRef.current = node;
    if (!node) return;
    setBodyWidth(node.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setBodyWidth(w);
    });
    ro.observe(node);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);

  const collapsed = isTerminalCollapsed(terminalCollapsed, bodyWidth);

  // Divider drag → set the left pane fraction, clamped to the legal band.
  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = bodyElRef.current;
      if (!el) return;
      const move = (ev: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        setRatio(ratioFromPointer(ev.clientX, rect.left, rect.width));
      };
      const up = () => {
        window.removeEventListener("mousemove", move);
        window.removeEventListener("mouseup", up);
        document.body.style.userSelect = "";
      };
      document.body.style.userSelect = "none";
      window.addEventListener("mousemove", move);
      window.addEventListener("mouseup", up);
    },
    [setRatio],
  );

  // Deep-link to Settings (e.g. Upgrade modal CTA) → open the overlay.
  useEffect(() => {
    if (pendingSettingsSection) setShowSettings(true);
  }, [pendingSettingsSection]);

  // Activity Stream jump → surface the matching right tab, or expand the
  // terminal column for an agent jump (agents live in the left column).
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "task") {
      setActiveTab("board");
      consumeJump();
    } else if (pendingJump.type === "code") {
      setActiveTab("code");
      consumeJump();
    } else if (pendingJump.type === "worktrees") {
      setActiveTab("worktrees");
      consumeJump();
    } else if (pendingJump.type === "agent") {
      if (terminalCollapsed) toggleTerminalCollapsed();
      consumeJump();
    }
  }, [
    pendingJump,
    consumeJump,
    setActiveTab,
    terminalCollapsed,
    toggleTerminalCollapsed,
  ]);

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

      {/* Body: terminal column | divider | work tabs. */}
      <div
        ref={bodyRefCb}
        className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
      >
        {collapsed ? (
          <>
            <TerminalColumn
              collapsed
              onToggle={toggleTerminalCollapsed}
              onOpenAgents={() => {
                if (terminalCollapsed) toggleTerminalCollapsed();
              }}
            />
            <div className="min-w-0 flex-1 overflow-hidden">
              <WorkTabs />
            </div>
          </>
        ) : (
          <>
            <div
              className="min-w-0 overflow-hidden"
              style={{
                flexBasis: `${ratio * 100}%`,
                flexGrow: 0,
                flexShrink: 0,
              }}
            >
              <TerminalColumn
                collapsed={false}
                onToggle={toggleTerminalCollapsed}
                onOpenAgents={() => {}}
              />
            </div>

            <div
              onMouseDown={onDividerDown}
              role="separator"
              aria-orientation="vertical"
              aria-label={t("workspace.terminals")}
              className="w-1 flex-shrink-0 cursor-col-resize bg-gray-700 transition-colors hover:bg-blue-600"
            />

            <div className="min-w-0 flex-1 overflow-hidden">
              <WorkTabs />
            </div>
          </>
        )}
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
