import { memo } from "react";
import type { Pane } from "../../stores/paneStore";
import { BoardTab } from "../tabs/BoardTab";
import { CodeTab } from "../tabs/CodeTab";
import { AgentsTab } from "../tabs/AgentsTab";
import { FlowsTab } from "../tabs/FlowsTab";
import { MissionsTab } from "../tabs/MissionsTab";
import { DeployTab } from "../tabs/DeployTab";
import { WorktreeTab } from "../tabs/WorktreeTab";
import { WorkHistoryTab } from "../work-history/WorkHistoryTab";
import { UsagePage } from "../usage/UsagePage";
import { GuideTab } from "../guide/GuideTab";
import { PlanGate } from "../settings/PlanGate";
import { BrowserPane } from "./BrowserPane";
import { DiffSurface } from "./DiffSurface";

/**
 * Renders a single pane's content by kind. Reuses the existing tab components
 * verbatim so the Workspace shell inherits all their behavior; the only
 * shell-specific wiring is the code pane, which injects DiffSurface (diff-A +
 * inline comments) in place of the plain DiffViewer.
 */
export const PaneContent = memo(function PaneContent({ pane }: { pane: Pane }) {
  switch (pane.kind) {
    case "board":
      return <BoardTab />;
    case "code":
      return (
        <CodeTab
          renderDiff={(p) => (
            <DiffSurface
              filePath={p.filePath}
              language={p.language}
              currentContent={p.currentContent}
            />
          )}
        />
      );
    case "agents":
      return <AgentsTab />;
    case "flows":
      return (
        <PlanGate feature="flows">
          <FlowsTab />
        </PlanGate>
      );
    case "missions":
      return <MissionsTab />;
    case "deploy":
      return <DeployTab />;
    case "worktrees":
      return <WorktreeTab />;
    case "history":
      return <WorkHistoryTab />;
    case "usage":
      return <UsagePage />;
    case "guide":
      return <GuideTab />;
    case "browser":
      return <BrowserPane paneId={pane.id} url={pane.url ?? "about:blank"} />;
    default:
      return null;
  }
});
