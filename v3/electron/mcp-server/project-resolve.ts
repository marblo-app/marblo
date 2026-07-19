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

/* ------------------------------------------------------------------------- *
 * Project lock (governance decision B, ticket IuucvLemDFvbh4UYmL1o)
 * ------------------------------------------------------------------------- *
 *
 * READ/QUERY tools used to take a `project_id` argument and silently drop it:
 * resolveProject() returned the env-injected MARBLO_PROJECT unconditionally, so
 * three different project_id values produced three identical result sets. The
 * orchestrator constitution meanwhile told operators to "pass project_id and
 * verify the returned project field matches" — a guarantee the code never
 * provided. Results happened to be correct only because the default happened to
 * be the current project, not because the argument worked.
 *
 * Decision B: HONOR the argument, but refuse loudly when it names a project
 * other than the one this orchestrator session is bound to. The cross-project
 * lock stays; only the silent ignore goes away. Silently answering for a
 * different project than the caller asked about is the one outcome we never
 * want — it makes the caller believe a check happened when none did.
 */

export type ProjectLockFailure = "mismatch" | "unresolvable";

export type ProjectLockOutcome =
  | { ok: true; projectId: string }
  | { ok: false; reason: ProjectLockFailure; message: string };

export interface ProjectLockInput {
  /** Raw `project_id` argument (may be a Firestore id or a friendly name). */
  explicit?: string;
  /** The bound session project (MARBLO_PROJECT). */
  bound?: string;
  /**
   * When `explicit` is a friendly name, the id it resolved to — or `null` when
   * the lookup found no unambiguous match. `undefined` means no lookup was
   * performed, which we treat as "could not resolve" rather than assuming it
   * matches: an unproven name must never silently fall through to the default.
   */
  nameResolvedTo?: string | null;
  /** Tool name, so the error tells the operator which call was refused. */
  toolName: string;
}

/**
 * Decide whether a `project_id` argument may be honored under the project lock.
 * Pure — the async name lookup happens in the caller and arrives via
 * `nameResolvedTo`, so every branch here is unit-testable without Firestore.
 */
export function checkProjectLock(input: ProjectLockInput): ProjectLockOutcome {
  const bound = (input.bound ?? "").trim();
  const arg = (input.explicit ?? "").trim();

  // No argument → the bound project, exactly as before. This is the overwhelming
  // majority of calls and stays a no-op.
  if (!arg) return { ok: true, projectId: bound };

  // A friendly name is only trustworthy once it resolves to a real id.
  if (!looksLikeFirestoreId(arg)) {
    const resolved = (input.nameResolvedTo ?? "").trim();
    if (!resolved) {
      return {
        ok: false,
        reason: "unresolvable",
        message: unresolvableMessage(arg, bound, input.toolName),
      };
    }
    return lockAgainstBound(resolved, bound, input.toolName, arg);
  }

  return lockAgainstBound(arg, bound, input.toolName);
}

function lockAgainstBound(
  requestedId: string,
  bound: string,
  toolName: string,
  originalName?: string,
): ProjectLockOutcome {
  // No bound project (standalone/CLI use) → nothing to lock against, so an
  // explicit id is the only project context there is. Honor it.
  if (!bound) return { ok: true, projectId: requestedId };
  if (requestedId === bound) return { ok: true, projectId: bound };
  return {
    ok: false,
    reason: "mismatch",
    message: mismatchMessage(requestedId, bound, toolName, originalName),
  };
}

function describeRequested(requestedId: string, originalName?: string): string {
  return originalName ? `"${originalName}" (${requestedId})` : requestedId;
}

function mismatchMessage(
  requestedId: string,
  bound: string,
  toolName: string,
  originalName?: string,
): string {
  return (
    `프로젝트 ${describeRequested(requestedId, originalName)} 는 이 오케 세션` +
    `(프로젝트 ${bound})에서 ${toolName} 로 조회할 수 없습니다.\n` +
    `해야 할 일 — 둘 중 하나를 고르세요:\n` +
    `  1) 해당 프로젝트에 바인딩된 오케스트레이터에서 실행하세요.\n` +
    `  2) 현재 프로젝트(${bound})를 조회할 의도였다면 project_id 를 생략하거나 ` +
    `project_id="${bound}" 로 호출하세요.\n` +
    `(교차 프로젝트 조회는 프로젝트 락으로 거부됩니다. 인자를 무시하고 ` +
    `${bound} 결과를 대신 돌려주지 않습니다.)`
  );
}

function unresolvableMessage(
  requested: string,
  bound: string,
  toolName: string,
): string {
  return (
    `project_id="${requested}" 는 Firestore 프로젝트 ID 가 아니고, 이름으로도 ` +
    `프로젝트를 특정할 수 없습니다 (${toolName}).\n` +
    `해야 할 일 — 정확한 프로젝트 문서 ID 를 넘기거나` +
    (bound
      ? `, 현재 오케 세션 프로젝트(${bound})를 조회할 의도였다면 project_id 를 생략하세요.`
      : ` MARBLO_PROJECT 를 설정하세요 (현재 바인딩된 프로젝트가 없습니다).`) +
    `\n(이름이 확인되지 않은 project_id 는 무시하지 않고 거부합니다.)`
  );
}
