import type { PaneKind } from "../stores/paneStore";
import type { RightTabId } from "./splitWorkspaceLayout";

/**
 * What the renderer does with a `browserPane:openUrl` from main: put the URL
 * in a new Web-tab pane, bring that surface to the front, and only then tell
 * main the click was handled.
 *
 * The order matters and is the point of this file. Main arms an ack timeout
 * when it sends the open (`BrowserPaneOpenUrlDelivery`); if no ack lands it
 * falls back to the OS browser and says why. Acking first — or acking when
 * the pane could not be created — converts a visible failure into a silent
 * one: main believes a tab appeared, so it neither retries nor explains, and
 * the user's click simply vanishes. So `ack` runs last, and never runs if
 * creating the pane threw.
 *
 * Surfacing the tab is part of handling the open, not a nicety: before ticket
 * pmpcvaEsswlsOLJDwer6 the renderer created the pane in a store no screen was
 * rendering, which is exactly the "nothing happened" the ack was supposed to
 * rule out.
 */
export interface WebTabOpenDeps {
  addPane: (
    kind: PaneKind,
    opts?: { url?: string; groupId?: string },
  ) => string;
  setActiveTab: (tab: RightTabId) => void;
  ack: (requestId: string) => void;
}

export const WEB_TAB_ID: RightTabId = "browser";

/** Returns the new pane's id. */
export function openLinkInWebTab(
  deps: WebTabOpenDeps,
  payload: { url: string; requestId: string },
): string {
  const paneId = deps.addPane("browser", { url: payload.url });
  deps.setActiveTab(WEB_TAB_ID);
  deps.ack(payload.requestId);
  return paneId;
}
