/**
 * Pure project-id resolution for create_task / create_tasks_bulk (W7).
 *
 * The board filters tasks by `projectId`, so a task written under the wrong
 * project id becomes a "ghost" — present in get_all_tasks(role) but invisible on
 * the user's board. The old resolveProject() ALWAYS returned the env-injected
 * DEFAULT_PROJECT first and silently dropped any explicit `project_id`, so an
 * orchestrator bound to project A could not create a task in project B, and a
 * friendly name like "마블로" was ignored — the task landed in A (GFB8…) and the
 * user never saw it. (Confirmed today: project_id='마블로' still created under
 * GFB8….)
 *
 * This module isolates the id-selection decision so it can be unit-tested
 * without Firestore. It does NOT do existence validation (that needs an async
 * Firestore read) — the caller layers validation on top. Selection rules:
 *
 *   1. An explicit project_id that looks like a Firestore document id WINS over
 *      the default — this is what lets a cross-project create actually land in
 *      the requested project (the core W7 fix).
 *   2. An explicit project_id that is a human-readable name (e.g. "마블로",
 *      "stockai-platform") cannot be trusted as a doc id. It is surfaced as
 *      `friendlyName` so the caller can try to resolve it to a real id; if that
 *      fails we fall back to the default and WARN loudly instead of silently
 *      misfiling.
 *   3. No explicit id → the default project.
 */

/** Firestore auto-ids are 20-char alphanumerics; accept ≥15 to be lenient. */
export const FIRESTORE_ID_RE = /^[A-Za-z0-9]{15,}$/;

export function looksLikeFirestoreId(value: string | undefined): boolean {
  return !!value && FIRESTORE_ID_RE.test(value);
}

export type ProjectIdSource = "explicit" | "default" | "none";

export interface ProjectSelection {
  /** The chosen project id, or "" when none could be determined. */
  projectId: string;
  /** Where the id came from. */
  source: ProjectIdSource;
  /** A non-id explicit argument (human-readable name) the caller should try to
   * resolve to a real id before falling back to `projectId`. undefined when the
   * explicit arg was itself a valid id or absent. */
  friendlyName?: string;
  /** Operator-facing warning when an explicit arg was NOT honored verbatim. */
  warning?: string;
}

/**
 * Decide which project id a create call should use.
 *
 * @param explicit       the raw `project_id` argument (may be a name or id)
 * @param defaultProject the env-injected MARBLO_PROJECT (Firestore doc id)
 */
export function selectProjectId(
  explicit: string | undefined,
  defaultProject: string | undefined,
): ProjectSelection {
  const def = (defaultProject ?? "").trim();
  const arg = (explicit ?? "").trim();

  // (1) Explicit valid Firestore id wins — even over a set default. This is the
  // cross-project create path the old code dropped.
  if (looksLikeFirestoreId(arg)) {
    return { projectId: arg, source: "explicit" };
  }

  // (2) Explicit but not an id → a friendly name. Keep the default as the
  // fallback landing spot, but tell the caller to try resolving the name first
  // and warn that it wasn't used verbatim.
  if (arg) {
    return {
      projectId: def,
      source: def ? "default" : "none",
      friendlyName: arg,
      warning:
        `project_id="${arg}" is not a Firestore document id; ` +
        (def
          ? `attempting name resolution, else falling back to the bound project (${def}).`
          : `and no bound project is set — the task cannot be filed.`),
    };
  }

  // (3) No explicit id → default.
  if (def) return { projectId: def, source: "default" };
  return { projectId: "", source: "none" };
}
