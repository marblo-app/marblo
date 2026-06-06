/**
 * A task belongs to a "lane" (non-board context) when its contextId is set and
 * is not the reserved "board" default. Used to render a distinguishing marking
 * on the Kanban board so board + lane + mission work is visible together.
 */
export function isLaneTask(contextId: string | undefined): boolean {
  return !!contextId && contextId !== "board";
}
