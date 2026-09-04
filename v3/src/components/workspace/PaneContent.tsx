import { memo } from "react";
import type { Pane } from "../../stores/paneStore";
import { BrowserPane } from "./BrowserPane";

/**
 * Renders a single pane's content.
 *
 * The tree this belongs to backs the Web tab, so a pane is a web page. It
 * used to switch over every pane kind and render Board / Code / Agents / …
 * inside a pane, from when the split tree was meant to replace the whole
 * right-hand tab bar (#477). That shell never landed and nothing ever mounted
 * this component, so no such pane was ever on screen; keeping the switch would
 * only offer duplicates of tabs that already exist next door — and pull the
 * whole app's view layer into the Web tab (ticket pmpcvaEsswlsOLJDwer6).
 */
export const PaneContent = memo(function PaneContent({ pane }: { pane: Pane }) {
  if (pane.kind !== "browser") return null;
  return <BrowserPane paneId={pane.id} url={pane.url ?? "about:blank"} />;
});
