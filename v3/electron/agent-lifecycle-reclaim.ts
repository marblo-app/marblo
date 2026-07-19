/**
 * Pure decision logic for reclaiming GHOST agent docs and stale task worktrees
 * left behind by a previous Electron instance.
 *
 * Background (2026-07-19 incident): the `agents/` Firestore collection grew to
 * 1,057 docs, 28 of which claimed `status: "working"` for a project that only
 * had 4 live agents. Status writes flow through the *renderer* (agentStore's
 * `agent:statusChanged` listener), so when the app quits or crashes there is no
 * writer left to finalize `stopped` — every agent of that instance stays
 * `working` forever. `cleanup_agents` can't recover them either: it only scans
 * the bridge's in-memory AgentManager, and a restarted Electron has an empty
 * map. The accumulated ghosts then caused real damage: watchdog respawn storms
 * over ghost docs (PR #491), 20–26s worktree listings (PR #495), an
 * orchestrator crash on a deleted worktree rootPath, and a board showing 31
 * agents running when 4 were.
 *
 * This module isolates the "may I reclaim THIS doc?" decision so it unit-tests
 * without Firestore / Electron. The gate is deliberately conservative — the
 * hard requirement is that a live agent on ANOTHER machine or ANOTHER Electron
 * instance of the same machine is never touched:
 *
 *   1. Only non-terminal statuses (`working` / `idle`) are candidates.
 *   2. An agent present in THIS instance's AgentManager memory is live — skip.
 *   3. A doc without `machineId` may belong to another machine → untouchable.
 *      (The one-off backlog of unstamped legacy ghosts is a separate manual
 *      cleanup ticket; this policy only guarantees NEW ghosts get reclaimed.)
 *   4. A doc stamped by another machine (`foreign`) → untouchable.
 *   5. An own-machine doc stamped with an `instancePid` is reclaimed only when
 *      that pid is THIS process (ours but not in memory ⇒ ghost) or provably
 *      dead on this machine. A live pid means another Electron instance
 *      (dev + prod run concurrently here) may own it → skip.
 *   6. An own-machine doc with NO `instancePid` (stamped by a pre-instancePid
 *      build) is reclaimed only past a 24h age gate, and never for the
 *      orchestrator role — a long-lived coordinator can be legitimately quiet.
 *
 * Reclaiming NEVER kills a process and NEVER deletes the doc — it only writes
 * `status: "stopped"` (and preserves `currentTaskId`, so a manual ▶ Start still
 * resumes with its task context). If a decision is ever wrong the damage is a
 * mislabeled board row that self-heals on the agent's next status transition,
 * not lost work.
 */

/** Agent doc statuses that represent (claimed) live work — reclaim candidates. */
export function isReclaimableAgentStatus(status: unknown): boolean {
  return status === "working" || status === "idle";
}

/**
 * Age gate for own-machine docs that predate instancePid stamping. Long enough
 * that a live agent of a concurrently running OLD-build instance (which can't
 * stamp a pid) is very unlikely to be misjudged, short enough that transition-
 * era ghosts clear within a day.
 */
export const LEGACY_OWN_DOC_AGE_MS = 24 * 60 * 60 * 1000; // 24h

export interface GhostReclaimInput {
  /** Doc's live status field. */
  status: unknown;
  /** Doc's stamped machine owner, if any. */
  machineId: string | null | undefined;
  /** Doc's stamped Electron process pid, if any (new field). */
  instancePid: number | null | undefined;
  /** Doc's role — `orchestrator` gets extra protection on the legacy path. */
  role?: string | null;
  /**
   * Best-known "last touched" time of the doc in epoch-ms (updatedAt, falling
   * back to createdAt), or null when neither exists. Only used for the legacy
   * (no-instancePid) age gate.
   */
  lastTouchedAtMs: number | null;
  /** This machine's stable machineId (app-state.json). */
  thisMachineId: string;
  /** This Electron main process pid. */
  thisPid: number;
  /** True when the agent id is present in THIS instance's AgentManager map. */
  inMemory: boolean;
  /** Liveness probe for a pid ON THIS MACHINE (process.kill(pid, 0)). */
  isPidAlive: (pid: number) => boolean;
  /** epoch-ms now (injected for deterministic tests). */
  now: number;
  /** Override the legacy age gate; defaults to LEGACY_OWN_DOC_AGE_MS. */
  legacyAgeMs?: number;
}

export interface GhostReclaimDecision {
  reclaim: boolean;
  /** Human-readable rationale, logged on every decision. */
  reason: string;
}

export function evaluateGhostReclaim(
  input: GhostReclaimInput,
): GhostReclaimDecision {
  const {
    status,
    machineId,
    instancePid,
    role,
    lastTouchedAtMs,
    thisMachineId,
    thisPid,
    inMemory,
    isPidAlive,
    now,
    legacyAgeMs = LEGACY_OWN_DOC_AGE_MS,
  } = input;

  if (!isReclaimableAgentStatus(status)) {
    return { reclaim: false, reason: `status ${String(status)} already final` };
  }

  if (inMemory) {
    return { reclaim: false, reason: "live in this instance's AgentManager" };
  }

  if (!machineId) {
    return {
      reclaim: false,
      reason: "unstamped (legacy) doc — possibly another machine's, untouchable",
    };
  }

  if (machineId !== thisMachineId) {
    return { reclaim: false, reason: "owned by another machine (foreign)" };
  }

  if (typeof instancePid === "number") {
    if (instancePid === thisPid) {
      return {
        reclaim: true,
        reason: "stamped by THIS instance but absent from memory — ghost",
      };
    }
    if (isPidAlive(instancePid)) {
      return {
        reclaim: false,
        reason: `pid ${instancePid} alive — another Electron instance on this machine may own it`,
      };
    }
    return {
      reclaim: true,
      reason: `stamped by dead instance (pid ${instancePid}) — ghost`,
    };
  }

  // Own-machine doc without an instancePid: stamped by a pre-instancePid build.
  // Conservative transition-era path only.
  if (role === "orchestrator") {
    return {
      reclaim: false,
      reason: "legacy own doc but orchestrator role — never auto-reclaimed",
    };
  }
  if (lastTouchedAtMs === null) {
    return {
      reclaim: false,
      reason: "legacy own doc with no timestamp — cannot prove staleness",
    };
  }
  const ageMs = now - lastTouchedAtMs;
  if (ageMs < legacyAgeMs) {
    return {
      reclaim: false,
      reason: `legacy own doc touched ${Math.round(ageMs / 60000)}min ago (< ${Math.round(
        legacyAgeMs / 3600000,
      )}h gate)`,
    };
  }
  return {
    reclaim: true,
    reason: `legacy own doc untouched for ${Math.round(ageMs / 3600000)}h — ghost`,
  };
}

// ── Worktree terminal-task sweep helpers ───────────────────────────────────

/**
 * Parse a worktree path of the canonical layout
 * `<worktreesRoot>/<projectId>/<taskId>` (WorktreeCoordinator.prepare's
 * convention) into its ids. Returns null for anything else — a path outside
 * the root, extra nesting, or the root itself — so the sweep can only ever
 * act on trees Marblo itself created.
 */
export function parseWorktreeTaskPath(
  worktreesRoot: string,
  worktreePath: string,
  sep: string,
): { projectId: string; taskId: string } | null {
  const root = worktreesRoot.endsWith(sep)
    ? worktreesRoot.slice(0, -sep.length)
    : worktreesRoot;
  if (!worktreePath.startsWith(root + sep)) return null;
  const rel = worktreePath.slice(root.length + sep.length);
  const parts = rel.split(sep).filter(Boolean);
  if (parts.length !== 2) return null;
  const [projectId, taskId] = parts;
  if (!projectId || !taskId) return null;
  return { projectId, taskId };
}

/**
 * Derive the main repo root from a linked worktree's `.git` FILE content:
 *   `gitdir: /path/to/repo/.git/worktrees/<name>`
 * → `/path/to/repo`. Returns null when the content isn't that shape (bare
 * repos, submodule gitdirs, corrupt files) — the sweep skips such trees.
 */
export function deriveRepoRootFromGitFile(content: string): string | null {
  const m = /^gitdir:\s*(.+)\s*$/m.exec(content);
  if (!m) return null;
  const gitdir = m[1].trim();
  // Expect <repoRoot>/.git/worktrees/<name>
  const marker = "/.git/worktrees/";
  const idx = gitdir.lastIndexOf(marker);
  if (idx <= 0) return null;
  return gitdir.slice(0, idx);
}

/** Task statuses whose worktree is eligible for the safety-gated sweep reap. */
export function isWorktreeSweepEligibleTaskStatus(status: unknown): boolean {
  return status === "DONE" || status === "FAILED";
}

// ── Accumulation visibility (fix 4) ────────────────────────────────────────

/** Default alert thresholds. agents/ was at 1,057 docs and worktrees at 696
 * when this shipped — the point is to never silently get there again. */
export const ACCUMULATION_THRESHOLDS = {
  agentDocs: 500,
  worktrees: 100,
} as const;

/** Re-alert at most once per this window so the user isn't nagged. */
export const ACCUMULATION_ALERT_DEDUPE_MS = 24 * 60 * 60 * 1000; // 24h

export interface AccumulationCounts {
  /** Total docs in `agents/`, or null when the count could not be read. */
  agentDocs: number | null;
  /** Task worktree directories under worktreesRoot, or null when unreadable. */
  worktrees: number | null;
}

export interface AccumulationAlertDecision {
  alert: boolean;
  /** User-facing message when alerting, else null. */
  message: string | null;
}

export function evaluateAccumulationAlert(input: {
  counts: AccumulationCounts;
  /** epoch-ms of the last alert shown, or null if never. */
  lastAlertAtMs: number | null;
  now: number;
  thresholds?: { agentDocs: number; worktrees: number };
  dedupeMs?: number;
}): AccumulationAlertDecision {
  const {
    counts,
    lastAlertAtMs,
    now,
    thresholds = ACCUMULATION_THRESHOLDS,
    dedupeMs = ACCUMULATION_ALERT_DEDUPE_MS,
  } = input;

  const over: string[] = [];
  if (counts.agentDocs !== null && counts.agentDocs > thresholds.agentDocs) {
    over.push(
      `에이전트 문서 ${counts.agentDocs}개 (임계치 ${thresholds.agentDocs})`,
    );
  }
  if (counts.worktrees !== null && counts.worktrees > thresholds.worktrees) {
    over.push(`워크트리 ${counts.worktrees}개 (임계치 ${thresholds.worktrees})`);
  }
  if (over.length === 0) return { alert: false, message: null };

  if (lastAlertAtMs !== null && now - lastAlertAtMs < dedupeMs) {
    return { alert: false, message: null };
  }

  return {
    alert: true,
    message: `리소스 누적 경고: ${over.join(
      ", ",
    )}. 정리하지 않으면 조회 성능 저하·워치독 오판의 원인이 됩니다.`,
  };
}
