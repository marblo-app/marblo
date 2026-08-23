export const DEFAULT_PANEL_HEIGHT = 116;
export const MIN_PANEL_HEIGHT = 96;
export const MAX_PANEL_HEIGHT = 320;

export function clampPanelHeight(height: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, height));
}

/** Calculate the height for the bottom-edge resize handle. */
export function panelHeightForPointer(
  startHeight: number,
  startY: number,
  clientY: number,
): number {
  return clampPanelHeight(startHeight + (clientY - startY));
}
