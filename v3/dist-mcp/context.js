/** Read-scope context. "" means "do not filter by context" (unscoped). */
export function resolveContext(env = process.env) {
    return env.MARBLO_CONTEXT || "";
}
/** Write label for a new task's contextId. Always concrete ("board" fallback). */
export function resolveContextForWrite(env = process.env) {
    return resolveContext(env) || "board";
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