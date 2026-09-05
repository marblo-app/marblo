import { usePaneStore } from "../../stores/paneStore";
import { LayoutView } from "./LayoutView";
import { AgentBrowserActivityBar } from "./AgentBrowserActivityBar";

/**
 * The Web tab — the app's own browser, hosting the pane tree from
 * `paneStore`. Each pane is a WebContentsView floated over this rectangle by
 * main (see `BrowserPane`), so several sites can sit side by side in tabs and
 * splits, the way browser tabs do.
 *
 * Why this file exists: the whole pane surface
 * (LayoutView → PaneGroup → PaneContent → BrowserPane) shipped with the
 * opt-in Workspace shell in #477 and was then never mounted by anything —
 * nothing in the repo imported `LayoutView`. Main would route a clicked link
 * to `browserPane:openUrl`, the renderer would `addPane("browser", …)`, the
 * renderer would ack it, and no tab ever appeared, because no screen was
 * rendering that store (ticket pmpcvaEsswlsOLJDwer6).
 */
export function BrowserTab() {
  const layout = usePaneStore((s) => s.layout);
  return (
    <div className="flex h-full min-h-0 min-w-0 flex-col">
      <AgentBrowserActivityBar />
      <LayoutView node={layout} />
    </div>
  );
}
