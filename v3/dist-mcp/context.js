/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env = process.env) {
    return env.MARBLO_CONTEXT || "";
}
/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env = process.env) {
    return resolveContext(env) || "board";
}
/** True when a contextId belongs to a Quick Lane, not a mission. */
export function isLaneContextId(contextId) {
    return contextId === "lane" || (!!contextId && contextId.startsWith("lane:"));
}
/**
 * Raw mission context from MARBLO_CONTEXT.
 *
 * Board and lane contexts keep their existing contextId-only behavior. Any
 * other explicit context is a missionId and must also be written to missionId.
 */
export function resolveMissionContextForWrite(env = process.env) {
    const contextId = resolveContext(env);
    if (!contextId || contextId === "board" || isLaneContextId(contextId)) {
        return null;
    }
    return contextId;
}
/** contextId to filter get_all_tasks by; "" = no context constraint. */
export function contextReadFilter(allContexts, env = process.env) {
    return allContexts ? "" : resolveContext(env);
}
/**
 * MARBLO_CONTEXT value to inject for an orchestrator of the given kind.
 *
 * NOTE: OrchestratorManager injects this into the Marblo MCP env while patching
 * MARBLO_BRIDGE_PORT / MARBLO_PROJECT, only when non-empty.
 */
export function contextForKind(kind) {
    return kind === "board" ? "board" : "";
}
/** Compute contextId backfill for tasks missing it. missionId wins, else "board". */
export function computeContextIdBackfill(tasks) {
    return tasks
        .filter((t) => !t.contextId)
        .map((t) => ({ id: t.id, contextId: t.missionId ?? "board" }));
}
//# sourceMappingURL=context.js.map