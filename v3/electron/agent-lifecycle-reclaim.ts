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
 * ── 2026-09-04 보강: 에이전트 자신의 heartbeat 축 (티켓 nzkdcE7W6P2uGYqCa3rU) ──
 *
 * 진단(§5.3-a)이 짚은 구멍: 규칙 5 의 `instancePid` 는 **에이전트의 pid 가 아니라
 * 그 에이전트를 띄운 Electron 인스턴스의 pid** 다. 그래서 앱이 안 죽으면 에이전트가
 * 죽어도 pid 는 영원히 살아 있고, 고아 문서는 영원히 회수되지 않는다 — 실측
 * 사례에서 9시간이 그렇게 지나갔다.
 *
 * 그래서 **에이전트 자신이 만드는 시계**를 하나 더 본다: `lastHeartbeatAtMs` 는
 * 그 에이전트의 MCP 툴 호출이 서버에 마지막으로 닿은 시각이다(agent-manager 의
 * `lastMcpCall` 을 Firestore 로 흘려 둔 값). 우리가 에이전트에게 무엇을 보내서
 * 얻는 값이 아니라, 에이전트가 제 스케줄로 하는 일이 남긴 흔적이다.
 *
 * ★이 축은 **회수를 넓히는 방향으로만 한 곳**에서 쓰인다 — 규칙 5 의 "pid 가 살아
 *   있다" 갈래에서, 에이전트 자신의 heartbeat 가 임계(AGENT_HEARTBEAT_STALE_MS)를
 *   넘겨 끊겼을 때만 넘어선다. 그리고 **좁히는 방향으로는 어디서나** 쓰인다:
 *   heartbeat 가 최근이면 어떤 경로로도 회수하지 않는다.
 *
 * ★heartbeat 를 한 번도 못 본 문서(구버전 / 툴콜이 전무한 에이전트)는 판정이
 *   예전과 **완전히 동일**하다. 증거가 없다는 이유로 살아있는 작업을 뺏지 않는다 —
 *   이 모듈에서 가장 비싼 실수는 미회수가 아니라 오회수다.
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

/**
 * 에이전트 자신의 heartbeat 가 이만큼 끊겨야 "살아 있는 다른 Electron 인스턴스"
 * 가드를 넘어설 수 있다.
 *
 * 60분으로 잡은 근거: 워치독의 board-quiet 정상 임계가 45분
 * (agent-stall-policy.STALL_QUIET_NORMAL_MS)이고, heartbeat 는 그보다 훨씬 자주
 * 찍히는 신호다(읽기 전용 툴 호출까지 전부 갱신하므로, 보드가 조용한 장시간 재현
 * 작업 중에도 계속 돈다). 그 위에 여유를 더 얹어, 정상적으로 일하는 에이전트가
 * 이 임계를 넘길 일이 실질적으로 없게 했다. 이 판정은 **작업을 뺏는** 판정이므로
 * 임계가 커서 손해 보는 쪽(늦게 회수)이 작아서 손해 보는 쪽(살아있는 작업 강탈)
 * 보다 훨씬 싸다.
 */
export const AGENT_HEARTBEAT_STALE_MS = 60 * 60 * 1000; // 60m

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
  /**
   * epoch-ms of the agent's OWN last heartbeat — the last time this agent's
   * marblo MCP tool call reached the server. null/undefined = never observed
   * (older doc, or an agent that has not made a single tool call), in which
   * case the decision falls back to exactly the pre-heartbeat behavior.
   *
   * ★This is the agent's own signal, not a display state. The Electron pid is
   * the host's, and `status: "working"` is derived from PTY bytes — both keep
   * saying "alive" for an agent that is producing nothing (2026-09-04 실측:
   * 51분 무커밋 · 지시 미배달인 에이전트가 계속 working 으로 보였다).
   */
  lastHeartbeatAtMs?: number | null;
  /** Override the heartbeat staleness gate; defaults to AGENT_HEARTBEAT_STALE_MS. */
  heartbeatStaleMs?: number;
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
    lastHeartbeatAtMs,
    heartbeatStaleMs = AGENT_HEARTBEAT_STALE_MS,
  } = input;

  // 에이전트 자신의 heartbeat 나이. 관측된 적이 없으면 null — "증거 없음" 이지
  // "죽었다" 가 아니다.
  const heartbeatAgeMs =
    typeof lastHeartbeatAtMs === "number" && Number.isFinite(lastHeartbeatAtMs)
      ? Math.max(0, now - lastHeartbeatAtMs)
      : null;
  const heartbeatFresh =
    heartbeatAgeMs !== null && heartbeatAgeMs < heartbeatStaleMs;
  const heartbeatMins = (): number => Math.round((heartbeatAgeMs ?? 0) / 60000);

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
      // ★진단 §5.3-a. 예전에는 여기서 **무조건** false 였다 — 그래서 앱이 안 죽으면
      // 에이전트가 죽어도 영원히 고아였다. 넘어설 수 있는 유일한 근거는 에이전트
      // 자신의 heartbeat 이고, 그것도 임계를 넘겨 끊겼을 때뿐이다.
      if (heartbeatFresh) {
        return {
          reclaim: false,
          reason: `agent's own heartbeat ${heartbeatMins()}min ago — alive`,
        };
      }
      if (heartbeatAgeMs === null) {
        return {
          reclaim: false,
          reason: `pid ${instancePid} alive — another Electron instance on this machine may own it (no agent heartbeat observed)`,
        };
      }
      return {
        reclaim: true,
        reason: `pid ${instancePid} alive but the agent's own heartbeat stopped ${heartbeatMins()}min ago (gate ${Math.round(
          heartbeatStaleMs / 60000,
        )}min) — agent-level ghost inside a live instance`,
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
  // 레거시 경로에서도 에이전트가 최근에 살아있다고 말했으면 손대지 않는다.
  if (heartbeatFresh) {
    return {
      reclaim: false,
      reason: `agent's own heartbeat ${heartbeatMins()}min ago — alive`,
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
