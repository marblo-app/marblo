import { memo } from "react";
import type { Pane } from "../../stores/paneStore";
import { BoardTab } from "../tabs/BoardTab";
import { CodeTab } from "../tabs/CodeTab";
import { AgentFleetTab, AgentsTab } from "../tabs/AgentsTab";
import { FlowsTab } from "../tabs/FlowsTab";
import { MissionsTab } from "../tabs/MissionsTab";
import { DeployTab } from "../tabs/DeployTab";
import { WorktreeTab } from "../tabs/WorktreeTab";
import { WorkHistoryTab } from "../work-history/WorkHistoryTab";
import { UsagePage } from "../usage/UsagePage";
import { GuideTab } from "../guide/GuideTab";
import { PlanGate } from "../settings/PlanGate";
import { BrowserPane } from "./BrowserPane";

/**
 * Renders a single pane's content by kind. Reuses the existing tab components
 * verbatim so the Workspace shell inherits all their behavior. The code pane's
 * diff-A surface (DiffSurface + inline comments) is now CodeTab's default diff
 * for every user, so the shell just renders <CodeTab /> and inherits it — one
 * source of truth shared with the legacy Layout.
 */
export const PaneContent = memo(function PaneContent({ pane }: { pane: Pane }) {
  switch (pane.kind) {
    case "board":
      return <BoardTab />;
    case "code":
      return <CodeTab />;
    case "agents":
      return <AgentsTab />;
    case "fleet":
      return <AgentFleetTab />;
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
