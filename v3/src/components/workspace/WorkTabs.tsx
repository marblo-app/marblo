import { useEffect, useState } from "react";
import { t } from "../../lib/i18n";
import { RIGHT_TABS, type RightTabId } from "../../lib/splitWorkspaceLayout";
import { useSplitWorkspaceStore } from "../../stores/splitWorkspaceStore";
import { BoardTab } from "../tabs/BoardTab";
import { CodeTab } from "../tabs/CodeTab";
import { WorktreeTab } from "../tabs/WorktreeTab";
import { WorkHistoryTab } from "../work-history/WorkHistoryTab";

/**
 * The RIGHT work-view pane of the IDE split shell: a fixed tab bar (Board /
 * Code / Worktrees / History) over the active tab's content. The tab
 * components are reused verbatim — no reimplementation.
 *
 * Tabs are lazily mounted on first activation and then KEPT mounted (hidden via
 * display:none) so switching tabs preserves each view's state — scroll
 * position, open code files, Monaco editors (which use automaticLayout and
 * relayout themselves when re-shown). The active tab + open files therefore
 * survive tab switches, and the switch itself is instant with no remount flash.
 */
const TAB_COMPONENTS: Record<RightTabId, () => JSX.Element> = {
  board: BoardTab,
  code: CodeTab,
  worktrees: WorktreeTab,
  history: WorkHistoryTab,
};

const TAB_LABEL_KEY = {
  board: "workspace.tab.board",
  code: "workspace.tab.code",
  worktrees: "workspace.tab.worktrees",
  history: "workspace.tab.history",
} as const satisfies Record<RightTabId, Parameters<typeof t>[0]>;

export function WorkTabs() {
  const activeTab = useSplitWorkspaceStore((s) => s.activeTab);
  const setActiveTab = useSplitWorkspaceStore((s) => s.setActiveTab);

  // Lazy keep-mounted: a tab component is instantiated the first time it
  // becomes active and never unmounted after, so its state persists.
  const [mounted, setMounted] = useState<Set<RightTabId>>(
    () => new Set<RightTabId>([activeTab]),
  );
  useEffect(() => {
    setMounted((prev) =>
      prev.has(activeTab) ? prev : new Set(prev).add(activeTab),
    );
  }, [activeTab]);

  return (
    <div className="flex h-full min-w-0 flex-col overflow-hidden bg-gray-900">
      <div
        role="tablist"
        aria-label={t("workspace.badge")}
        className="flex flex-shrink-0 items-stretch gap-1 border-b border-gray-700 bg-gray-800 px-2"
      >
        {RIGHT_TABS.map((tab) => {
          const isActive = tab === activeTab;
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={isActive}
              onClick={() => setActiveTab(tab)}
              className={`relative -mb-px border-b-2 px-3 py-2 text-xs font-medium transition-colors ${
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
        {RIGHT_TABS.map((tab) => {
          if (!mounted.has(tab)) return null;
          const Comp = TAB_COMPONENTS[tab];
          const isActive = tab === activeTab;
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
