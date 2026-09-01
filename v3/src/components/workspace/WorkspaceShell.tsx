import { useCallback, useEffect, useRef, useState } from "react";
import { t } from "../../lib/i18n";
import { Header } from "../Header";
import { CliSetupHost } from "../onboarding/CliSetupHost";
import { GlobalOverlays } from "../GlobalOverlays";
import { useAppLifecycle } from "../../hooks/useAppLifecycle";
import { useProjectKindSurface } from "../../hooks/useProjectKindSurface";
import { useUiStore } from "../../stores/uiStore";
import { useNavigationStore } from "../../stores/navigationStore";
import { usePaneStore } from "../../stores/paneStore";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { useActivityStreamStore } from "../../stores/activityStreamStore";
import {
  activityPanelWidth,
  isTerminalCollapsed,
  ratioFromPointer,
  ratioWithActivityOpen,
  storedRatioFromDrag,
  NARROW_BREAKPOINT,
  visibleRightTabs,
} from "../../lib/splitWorkspaceLayout";
import { TerminalColumn } from "./TerminalColumn";
import { WorkTabs } from "./WorkTabs";
import { Sidebar } from "../sidebar/Sidebar";
import { ActivityStreamPanel } from "../activity/ActivityStreamPanel";

const devFeatures = (import.meta.env.VITE_DEV_FEATURES || "")
  .split(",")
  .map((s: string) => s.trim());
const canOpenMissionsTab = visibleRightTabs(devFeatures).includes("missions");

/**
 * Observe an element's width via a callback ref. Returns the ref callback to
 * attach, the live element ref (for pointer-geometry reads), and the measured
 * width — seeded wide so nothing renders in its narrow/collapsed form for one
 * frame before the first ResizeObserver callback.
 */
function useMeasuredWidth() {
  const elRef = useRef<HTMLDivElement | null>(null);
  const observerRef = useRef<ResizeObserver | null>(null);
  const [width, setWidth] = useState<number>(NARROW_BREAKPOINT * 2);
  const refCb = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect();
    elRef.current = node;
    if (!node) return;
    setWidth(node.getBoundingClientRect().width);
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width;
      if (typeof w === "number") setWidth(w);
    });
    ro.observe(node);
    observerRef.current = ro;
  }, []);
  useEffect(() => () => observerRef.current?.disconnect(), []);
  return { refCb, elRef, width };
}

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

  // assistant kind → 기본 서피스(대화 좌측 + code/위키 + 문서그래프).
  // dev 프로젝트는 훅 내부에서 no-op (현행 불변).
  useProjectKindSurface();

  const pendingSettingsSection = useUiStore((s) => s.pendingSettingsSection);

  const ratio = useSplitWorkspaceStore((s) => s.ratio);
  const setRatio = useSplitWorkspaceStore((s) => s.setRatio);
  const terminalCollapsed = useSplitWorkspaceStore((s) => s.terminalCollapsed);
  const toggleTerminalCollapsed = useSplitWorkspaceStore(
    (s) => s.toggleTerminalCollapsed,
  );
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);
  const fileTreeOpen = useSplitWorkspaceStore((s) => s.fileTreeOpen);
  const toggleFileTree = useSplitWorkspaceStore((s) => s.toggleFileTree);

  // Far-right Activity Stream panel — reuses the shared store (its own header
  // ✕ / ⌘⇧A also toggle it). `open` persists across restarts (see store).
  const activityOpen = useActivityStreamStore((s) => s.open);
  const toggleActivity = useActivityStreamStore((s) => s.toggle);

  // Track the split container width for the narrow-window auto-collapse, and
  // the enclosing work area (split + activity) for the Activity panel's width
  // budget. Callback refs (dis)connect each observer as the node mounts /
  // unmounts, so they survive the folder-pick gate's early returns. Seeded wide
  // to avoid a first-frame collapse flash before the observers report.
  const {
    refCb: bodyRefCb,
    elRef: bodyElRef,
    width: bodyWidth,
  } = useMeasuredWidth();
  const { refCb: workAreaRefCb, width: workAreaWidth } = useMeasuredWidth();

  const collapsed = isTerminalCollapsed(terminalCollapsed, bodyWidth);

  // Activity panel width, or null when the window is too narrow to host it
  // beside the work view (→ slim rail). `open` stays true through an
  // auto-collapse, so widening the window brings the panel straight back.
  const activityWidth = activityOpen ? activityPanelWidth(workAreaWidth) : null;

  // While the panel is docked, re-solve the terminal fraction so the terminal
  // KEEPS its pixel width: the panel's width is recovered from the work view
  // (board), and the terminal yields at most MAX_TERMINAL_YIELD of itself and
  // only when the work view would otherwise be starved. The STORED ratio is
  // untouched — closing the panel restores the user's drag verbatim, so the
  // panel-closed layout is pixel-identical to before.
  const effectiveRatio =
    activityWidth != null
      ? ratioWithActivityOpen(ratio, bodyWidth, activityWidth)
      : ratio;

  // Divider drag → set the left pane fraction, clamped to the legal band. While
  // Activity is docked the pointer fraction is relative to the split area, but
  // the store holds a fraction of the whole work area — convert, or the pane
  // jumps wider the instant the drag ends.
  const onDividerDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      const el = bodyElRef.current;
      if (!el) return;
      const move = (ev: MouseEvent) => {
        const rect = el.getBoundingClientRect();
        const raw = ratioFromPointer(ev.clientX, rect.left, rect.width);
        setRatio(
          activityWidth != null
            ? storedRatioFromDrag(raw, rect.width, activityWidth)
            : raw,
        );
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
    [setRatio, activityWidth, bodyElRef],
  );

  // Deep-link to Settings (e.g. Upgrade modal CTA) → surface the Settings tab.
  // Settings is a real tab now (ticket 0JVQcUxd — as an overlay-only surface
  // nobody found it), so every in-shell entry point routes there. That also
  // keeps SettingsPage to a single mount (the old overlay is gone).
  useEffect(() => {
    if (pendingSettingsSection) setActiveTab("settings");
  }, [pendingSettingsSection, setActiveTab]);

  useEffect(() => {
    const onOpenMissions = () => {
      if (canOpenMissionsTab) setActiveTab("missions");
    };
    window.addEventListener("marblo:open-missions", onOpenMissions);
    return () =>
      window.removeEventListener("marblo:open-missions", onOpenMissions);
  }, [setActiveTab]);

  // Activity Stream jump → surface the matching right tab, or expand the
  // terminal column for an agent jump (agents live in the left column).
  const pendingJump = useNavigationStore((s) => s.pendingJump);
  const consumeJump = useNavigationStore((s) => s.consumeJump);
  const addPane = usePaneStore((s) => s.addPane);

  useEffect(() => {
    const api = window.electronAPI?.browserPane;
    if (!api) return;
    void api.registerOpenTarget(true).catch(() => {});
    const offOpenUrl = api.onOpenUrl(({ url, requestId }) => {
      addPane("browser", { url });
      api.ackOpenUrl(requestId);
    });
    return () => {
      offOpenUrl();
      void api.registerOpenTarget(false).catch(() => {});
    };
  }, [addPane]);

  useEffect(() => {
    if (!pendingJump) return;
    if (pendingJump.type === "task") {
      setActiveTab("board");
      consumeJump();
    } else if (pendingJump.type === "mission") {
      if (canOpenMissionsTab) {
        setActiveTab("missions");
        addPane("missions");
      }
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
    addPane,
    setActiveTab,
    terminalCollapsed,
    toggleTerminalCollapsed,
  ]);

  // Folder-pick gate — identical semantics to Layout: hold while a new window's
  // restore is in flight, then prompt for a folder.
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

  if (isNewWindow && !rootPath) {
    return (
      <div className="flex h-screen flex-col bg-gray-900 text-gray-100">
        <Header onNavigateToSettings={() => setActiveTab("settings")} />
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
      <Header onNavigateToSettings={() => setActiveTab("settings")} />

      {/* Shared global banners/modals/toasts — parity-guarded against
          Layout, see GlobalOverlays. */}
      <GlobalOverlays projectSetup={projectSetup} />

      {/* Onboarding: no modal here. This host runs the CLI setup engine and
          surfaces a non-blocking banner that deep-links to the 시작하기 tab. */}
      <CliSetupHost />

      {/* Body: file-tree rail | file tree | work area, where the work area is
          (split area | activity panel-or-rail). The file tree sits OUTSIDE the
          measured split area so opening/closing it never skews the
          terminal↔tabs ratio math or the narrow-collapse breakpoint; Activity
          sits outside it too, but inside the measured WORK AREA, because its
          width is budgeted against what the board needs. */}
      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {/* Far-left sidebar — files/commands/chat tabs (restored from the
            legacy Layout's <Sidebar>; PR#577 had left this slot as a bare
            <FileTree/>, dropping the tf slash-command guide and team chat).
            isOpen/onToggle are the same fileTreeOpen/toggleFileTree state the
            rest of the shell already persists, so the split ratio math and
            narrow-collapse breakpoint are unaffected. */}
        <Sidebar isOpen={fileTreeOpen} onToggle={toggleFileTree} />

        {/* Work area — measured (workAreaRefCb) so the Activity panel can be
            sized against what is actually left for it. */}
        <div
          ref={workAreaRefCb}
          className="flex min-h-0 min-w-0 flex-1 overflow-hidden"
        >
          {/* Split area — measured (bodyRefCb) for the horizontal divider drag
              + narrow-window auto-collapse. */}
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
                    flexBasis: `${effectiveRatio * 100}%`,
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

          {/* Activity Stream — the shell's fourth region, docked beside the
              work view at a budgeted width (never overlapping it, never wide
              enough to push a board column off-screen). Too narrow a window,
              or panel closed → the slim rail whose button re-opens it. */}
          {activityWidth != null ? (
            <ActivityStreamPanel width={activityWidth} />
          ) : (
            <div className="flex h-full w-8 flex-shrink-0 flex-col items-center border-l border-[#313244] bg-gray-800 py-2">
              <button
                type="button"
                onClick={toggleActivity}
                title={t("workspace.showActivity")}
                aria-label={t("workspace.showActivity")}
                aria-pressed={activityOpen}
                className={`rounded p-1.5 hover:bg-gray-700 hover:text-gray-200 ${
                  activityOpen ? "text-blue-400" : "text-gray-400"
                }`}
              >
                <svg
                  className="h-4 w-4"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </button>
              <div
                className="mt-3 text-[10px] font-semibold uppercase tracking-wider text-gray-500"
                style={{ writingMode: "vertical-rl" }}
              >
                {t("workspace.activity")}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings used to be an overlay here because the shell had no tab for
          it. It has one now (WorkTabs), which is both discoverable and a single
          mount — so the overlay is gone and every entry point routes to the
          tab. */}

      {/* 마블로 모드 탭 안내는 GlobalOverlays 의 졸업 여정 호스트가 5-ticket
          milestone 이후 한 번만 띄운다. */}
    </div>
  );
}
