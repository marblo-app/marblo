/**
 * When may a renderer tear down the MAIN-PROCESS orchestrator?
 *
 * The orchestrator PTY outlives any single renderer: it drives spawned agents,
 * the telegram relay and pending instructions, and it holds the user's live
 * conversation. useOrchestratorAutoLaunch used to call
 * `orchestratorSession.stop()` from its effect CLEANUP, which fires on every
 * unmount — and in dev the dominant cause of an unmount is a Vite FULL PAGE
 * RELOAD (the renderer defines no `import.meta.hot.accept` handlers, so editing
 * any module escalates to a reload). Editing an unrelated file therefore killed
 * the boss's running orchestrator. That is the "혼자 끊긴다" P0
 * (ticket hIq6m9Q6cHgtAoy3jUcB).
 *
 * The distinction this encodes: a PROJECT SWITCH is a real intent to abandon
 * the old orchestrator (it points at the wrong root now). An UNMOUNT is not —
 * the renderer cannot tell "I am reloading" from "the user is done", so it must
 * not guess. Reclaiming a genuinely orphaned orchestrator is main-process
 * business, because only it knows about window lifetimes.
 */

/** Which teardown path is running. */
export type OrchestratorTeardownPhase =
  /** The effect re-ran with a different project/root key. */
  | "key-change"
  /** The effect is being disposed (unmount, reload, HMR, StrictMode). */
  | "unmount";

export interface OrchestratorTeardownAction {
  /** Kill the main-process orchestrator PTY. */
  stopOrchestrator: boolean;
  /** Reset the renderer-side orchestrator store. */
  clearStore: boolean;
}

/**
 * Identity of an orchestrator binding: project + its FIXED root. Null when the
 * project has no folder bound (nothing to run).
 */
export function orchestratorKey(
  projectId: string | undefined | null,
  fixedRoot: string | null,
): string | null {
  return projectId && fixedRoot ? `${projectId}:${fixedRoot}` : null;
}

export function orchestratorTeardownAction(
  phase: OrchestratorTeardownPhase,
  prevKey: string | null,
  nextKey: string | null,
): OrchestratorTeardownAction {
  if (phase === "unmount") {
    // NEVER stop here. Clearing the renderer store is safe and correct: on
    // remount the auto-connect effect re-launches, and launch() is idempotent
    // (it attaches to the still-running session rather than respawning it).
    return { stopOrchestrator: false, clearStore: true };
  }

  // Genuine switch: we were bound to something, and it is no longer what we
  // want. Includes unbinding the folder entirely (nextKey === null).
  const switched = prevKey !== null && prevKey !== nextKey;
  return { stopOrchestrator: switched, clearStore: switched };
}
