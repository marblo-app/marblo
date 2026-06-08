/**
 * Eyes/brain context policy (Quick Lanes 눈/브레인 분리).
 *
 * READ vs WRITE defaults are intentionally asymmetric:
 *  - WRITE always labels a task ("board" fallback) so nothing is unlabeled.
 *  - READ only scopes when MARBLO_CONTEXT is explicitly set. Callers that do
 *    NOT set it (mission orchestrator, plain agents, external CLI) stay
 *    unscoped → zero behavior change. Only the board orchestrator sets
 *    MARBLO_CONTEXT="board", so only it becomes context-scoped.
 *
 * Pure module — no firebase import — so it unit-tests in isolation. Env is a
 * parameter (defaults to process.env) so tests never mutate global state.
 */
type Env = Record<string, string | undefined>;

/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env: Env = process.env): string {
  return env.MARBLO_CONTEXT || "";
}

/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env: Env = process.env): string {
  return resolveContext(env) || "board";
}

/** True when a contextId belongs to a Quick Lane, not a mission. */
export function isLaneContextId(contextId: string | undefined): boolean {
  return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}

/**
 * Raw mission context from MARBLO_CONTEXT.
 *
 * Board and lane contexts keep their existing contextId-only behavior. Any
 * other explicit context is a missionId and must also be written to missionId.
 */
export function resolveMissionContextForWrite(
  env: Env = process.env,
): string | null {
  const contextId = resolveContext(env);
  if (!contextId || contextId === "board" || isLaneContextId(contextId)) {
    return null;
  }
  return contextId;
}

/** contextId to filter get_all_tasks by; "" = no context constraint. */
export function contextReadFilter(
  allContexts: boolean,
  env: Env = process.env,
): string {
  return allContexts ? "" : resolveContext(env);
}

/**
 * MARBLO_CONTEXT value to inject for an orchestrator of the given kind.
 *
 * NOTE: OrchestratorManager injects this into the Marblo MCP env while patching
 * MARBLO_BRIDGE_PORT / MARBLO_PROJECT, only when non-empty.
 */
export function contextForKind(kind: string): string {
  return kind === "board" ? "board" : "";
}

/** Compute contextId backfill for tasks missing it. missionId wins, else "board". */
export function computeContextIdBackfill(
  tasks: { id: string; contextId?: string; missionId?: string }[],
): { id: string; contextId: string }[] {
  return tasks
    .filter((t) => !t.contextId)
    .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}
