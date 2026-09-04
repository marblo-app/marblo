import { useEffect, useMemo, useState } from "react";
import { t } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import {
  visibleRightTabs,
  type RightTabId,
} from "../../lib/splitWorkspaceLayout";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { BoardTab } from "../tabs/BoardTab";
import { CodeTab } from "../tabs/CodeTab";
import { WorktreeTab } from "../tabs/WorktreeTab";
import { WorkHistoryTab } from "../work-history/WorkHistoryTab";
import { LanesTab } from "../lanes/LanesTab";
import { GuideTab } from "../guide/GuideTab";
import { UsagePage } from "../usage/UsagePage";
import { HarnessStore } from "../harness/HarnessStore";
import { StoreTab } from "../store/StoreTab";
import { MissionsTab } from "../tabs/MissionsTab";
import { DeployTab } from "../tabs/DeployTab";
import { FlowsTab } from "../tabs/FlowsTab";
import { AgentFleetTab, AgentsTab } from "../tabs/AgentsTab";
import { ProjectTab } from "../project/ProjectTab";
import { SettingsPage } from "../settings/SettingsPage";
import { StartHereTab } from "../onboarding/StartHereTab";
import { BrowserTab } from "./BrowserTab";
import { PlanGate } from "../settings/PlanGate";

/**
 * The RIGHT work-view pane of the IDE split shell: a fixed tab bar over the
 * active tab's content. Every tab component is reused verbatim from the legacy
 * Layout — no reimplementation. Terminals + agents live in the LEFT column, so
 * there is no `agents` tab here; `settings` is a shell overlay, not a tab.
 *
 * Tabs are lazily mounted on first activation and then KEPT mounted (hidden via
 * display:none) so switching tabs preserves each view's state — scroll
 * position, open code files, Monaco editors (which use automaticLayout and
 * relayout themselves when re-shown). The active tab + open files therefore
 * survive tab switches, and the switch itself is instant with no remount flash.
 */

// Harness renders inline (no modal overlay) when onClose is undefined — mirrors
// Layout.HarnessTabPanel.
function HarnessTabPanel() {
  return <HarnessStore />;
}

// Flows is plan-gated exactly as in Layout.GatedFlowsTab.
function GatedFlowsTab() {
  return (
    <PlanGate feature="flows">
      <FlowsTab />
    </PlanGate>
  );
}

const TAB_COMPONENTS: Record<RightTabId, () => JSX.Element> = {
  startHere: StartHereTab,
  board: BoardTab,
  agents: AgentsTab,
  fleet: AgentFleetTab,
  // People side of the project: members, roles, invites, and per-member
  // workload. Shares TeamManagement with Settings → Team rather than
  // reimplementing the invite/role UI.
  project: ProjectTab,
  // Settings is ALSO reachable from the Header gear (which opens the shell's
  // full-screen overlay). It gets a tab too because with the overlay as the
  // only entry point users never found it (ticket 0JVQcUxd).
  settings: SettingsPage,
  code: CodeTab,
  browser: BrowserTab,
  worktrees: WorktreeTab,
  history: WorkHistoryTab,
  lanes: LanesTab,
  guide: GuideTab,
  usage: UsagePage,
  store: StoreTab,
  harness: HarnessTabPanel,
  missions: MissionsTab,
  flows: GatedFlowsTab,
  deploy: DeployTab,
};

const TAB_LABEL_KEY: Record<RightTabId, MessageKey> = {
  startHere: "workspace.tab.startHere",
  board: "workspace.tab.board",
  agents: "workspace.tab.agents",
  fleet: "workspace.tab.fleet",
  project: "workspace.tab.project",
  settings: "workspace.tab.settings",
  code: "workspace.tab.code",
  browser: "workspace.tab.browser",
  worktrees: "workspace.tab.worktrees",
  history: "workspace.tab.history",
  lanes: "workspace.tab.lanes",
  guide: "workspace.tab.guide",
  usage: "workspace.tab.usage",
  store: "workspace.tab.store",
  harness: "workspace.tab.harness",
  missions: "workspace.tab.missions",
  flows: "workspace.tab.flows",
  deploy: "workspace.tab.deploy",
};

// Same feature-flag mechanism as TabBar — dev-only tabs (missions/flows/deploy)
// appear only when VITE_DEV_FEATURES lists their id. Computed once at module
// load; import.meta.env is static per build.
const devFeatures = (import.meta.env.VITE_DEV_FEATURES || "")
  .split(",")
  .map((s: string) => s.trim());

export function WorkTabs() {
  const activeTab = useSplitWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);

  const tabs = useMemo(() => visibleRightTabs(devFeatures), []);

  // A persisted activeTab can point at a now-hidden dev tab (VITE_DEV_FEATURES
  // changed between builds) — fall back to board so the pane never renders blank
  // with no highlighted tab.
  const effectiveTab: RightTabId = tabs.includes(activeTab)
    ? activeTab
    : "board";

  // Lazy keep-mounted: a tab component is instantiated the first time it
  // becomes active and never unmounted after, so its state persists.
  const [mounted, setMounted] = useState<Set<RightTabId>>(
    () => new Set<RightTabId>([effectiveTab]),
  );
  useEffect(() => {
    setMounted((prev) =>
      prev.has(effectiveTab) ? prev : new Set(prev).add(effectiveTab),
    );
  }, [effectiveTab]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-gray-900">
      <div
        role="tablist"
        aria-label={t("workspace.badge")}
        className="flex flex-shrink-0 items-stretch gap-1 overflow-x-auto border-b border-gray-700 bg-gray-800 px-2"
      >
        {tabs.map((tab) => {
          const isActive = tab === effectiveTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              // 마블로 모드 첫 진입 코치마크 앵커(MarbloModeTour). 없는 탭 id 는
              // 투어 스텝이 안 가리키므로 붙여도 무해하다.
              data-coach={`workspace-tab-${tab}`}
              onClick={() => setActiveTab(tab)}
              className={`relative -mb-px whitespace-nowrap border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
                isActive
                  ? "border-blue-500 text-gray-100"
                  : "border-transparent text-gray-400 hover:text-gray-200"
              }`}
            >
              {t(TAB_LABEL_KEY[tab])}
            </button>
          );
        })}
      </div>

      {/* Content: every mounted tab stays in the tree; inactive ones are
          display:none so state (scroll, open files, editors) is preserved. */}
      <div className="relative min-h-0 flex-1">
        {tabs.map((tab) => {
          if (!mounted.has(tab)) return null;
          const Comp = TAB_COMPONENTS[tab];
          const isActive = tab === effectiveTab;
          return (
            <div
              key={tab}
              className="absolute inset-0 overflow-auto"
              style={{ display: isActive ? undefined : "none" }}
            >
              <Comp />
            </div>
          );
        })}
      </div>
    </div>
  );
}
