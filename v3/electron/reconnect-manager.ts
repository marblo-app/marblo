import fs from "fs";
import path from "path";
import os from "os";
import { isSummaryOnlyJsonl } from "./orchestrator-manager";
import { encodeClaudeProjectDir } from "./claude-paths";

export interface ReconnectCandidate {
  agentId: string;
  agentName: string;
  sessionId: string | null;
  label: string | null;
}

interface LabelEntry {
  label: string;
  agentId?: string;
  createdAt: number;
}

/**
 * Find Claude sessions that match agents.
 *
 * Strategy:
 * 1. Check marblo-labels.json for agent-specific session mappings
 * 2. If no label match, scan Claude session files to find the most recent one
 *    whose JSONL contains the agent name (best-effort heuristic)
 */
export function findReconnectCandidates(
  agents: Array<{ id: string; name: string; role: string }>,
  rootPath: string,
): ReconnectCandidate[] {
  const encodedPath = encodeClaudeProjectDir(rootPath);
  const projectDir = path.join(
    os.homedir(),
    ".claude",
    "projects",
    encodedPath,
  );
  const labelsPath = path.join(projectDir, "marblo-labels.json");

  // Load labels, then drop entries pointing at summary-only stub JSONLs.
  // Claude writes those when a session aborts before any real turn (e.g.,
  // model 404) and `--resume <stub_id>` exits 1 with "No conversation
  // found". listSessions in orchestrator-manager already filters these
  // for the orchestrator path; agent reconnect reads the labels file
  // directly, so we must repeat the filter here. Without it the most
  // recent label by createdAt — often a stub created right before app
  // exit — wins over the real session sharing the same agent name.
  const labels: Record<string, LabelEntry> = {};
  try {
    const raw = JSON.parse(fs.readFileSync(labelsPath, "utf-8")) as Record<
      string,
      LabelEntry
    >;
    for (const [sid, info] of Object.entries(raw)) {
      const jsonlPath = path.join(projectDir, `${sid}.jsonl`);
      if (!fs.existsSync(jsonlPath)) continue;
      if (isSummaryOnlyJsonl(jsonlPath)) continue;
      labels[sid] = info;
    }
  } catch {
    /* no labels file */
  }

  // Track which sessions are already claimed
  const claimedSessions = new Set<string>();

  return agents.map((agent) => {
    // 1. Try label match by agentId
    const labelMatch = Object.entries(labels)
      .filter(([sid]) => !claimedSessions.has(sid))
      .find(([, info]) => info.agentId === agent.id);

    if (labelMatch) {
      claimedSessions.add(labelMatch[0]);
      return {
        agentId: agent.id,
        agentName: agent.name,
        sessionId: labelMatch[0],
        label: labelMatch[1].label,
      };
    }

    // 2. Try label match by agent name in label text
    const nameMatch = Object.entries(labels)
      .filter(([sid]) => !claimedSessions.has(sid))
      .sort(([, a], [, b]) => b.createdAt - a.createdAt)
      .find(([, info]) => info.label.includes(agent.name));

    if (nameMatch) {
      claimedSessions.add(nameMatch[0]);
      return {
        agentId: agent.id,
        agentName: agent.name,
        sessionId: nameMatch[0],
        label: nameMatch[1].label,
      };
    }

    // 3. No match found
    return {
      agentId: agent.id,
      agentName: agent.name,
      sessionId: null,
      label: null,
    };
  });
}

/**
 * Decide a Claude agent's cold-boot resume target on `agent:reconnect`.
 *
 * Returns a concrete session UUID to `--resume`, or `null` to skip (the agent
 * is reported as `no-session`, marked stopped, and waits for a manual ▶ Start).
 *
 * Policy (phantom-agents-on-launch fix): resume ONLY when this machine has an
 * agent-SPECIFIC match —
 *   - `labelSessionId`: a marblo-labels.json entry for this exact agent, or
 *   - `nameScopedSessionId`: a name/id-scoped scan of ~/.claude/projects.
 *
 * The previous behaviour also had an "adopt the most-recent *unclaimed*
 * session" fallback for labelless agents. That fallback is intentionally gone.
 * The `agents/` Firestore collection carries no machine/session identity, so a
 * second machine signed into the same account (e.g. Windows + macOS as the
 * same user) rehydrates the *whole* project's agent docs — including stale
 * zombies left by the other machine. With the blind fallback, every one of
 * those labelless docs grabbed an arbitrary local JSONL and launched a real
 * CLI process — the "83 phantom agents attached on launch" bug. Requiring an
 * agent-specific match means a machine only ever resumes agents it actually
 * has a session for; foreign/finished docs fall through to the skip path
 * instead of being resurrected.
 */
export function resolveClaudeColdBootResumeId(
  labelSessionId: string | null,
  nameScopedSessionId: string | null,
): string | null {
  return labelSessionId ?? nameScopedSessionId ?? null;
}

/**
 * Machine ownership of an `agents/` Firestore doc, relative to this machine.
 *
 * The `agents/` collection is shared across every machine signed into the same
 * account (e.g. Windows + macOS as the same user). #231 stopped phantom Claude
 * *launches*; this layer adds an explicit owner so boot-restore and reap are
 * machine-scoped and non-destructive.
 *
 *  - `own`     — `machineId` matches this machine. Eligible to relaunch/reap.
 *  - `foreign` — `machineId` belongs to another machine. Read-only: never
 *                launch, never mutate (it may back a *live* agent over there).
 *  - `legacy`  — no `machineId` (doc predates this field, or was created by a
 *                writer that didn't stamp). Treated as possibly-foreign →
 *                safe default is to NOT launch and NOT mutate. Once this machine
 *                actually launches it (▶ Start), the status callback stamps the
 *                doc and it becomes `own` on the next boot (self-healing).
 */
export type MachineOwnership = "own" | "foreign" | "legacy";

export function classifyMachineOwnership(
  docMachineId: string | null | undefined,
  thisMachineId: string,
): MachineOwnership {
  if (!docMachineId) return "legacy";
  return docMachineId === thisMachineId ? "own" : "foreign";
}

/**
 * Boot-restore launch gate for shared-account multi-machine safety.
 *
 * Only agents this machine OWNS may be relaunched on boot. `foreign` and
 * `legacy` docs fall through to a non-destructive skip — the core fix for
 * "83 phantom agents attached on launch": a second machine on the same account
 * must not resurrect the other machine's agent docs.
 */
export function isLaunchEligibleOnThisMachine(
  docMachineId: string | null | undefined,
  thisMachineId: string,
): boolean {
  return classifyMachineOwnership(docMachineId, thisMachineId) === "own";
}

/**
 * Skip reason returned for docs this machine does NOT own (foreign/legacy).
 *
 * Intentionally NOT "no-session": the renderer (useAgentReconnect) marks
 * "no-session" agents `status: "stopped"` in Firestore. Doing that to a
 * *foreign* doc would destructively rewrite a live agent's status on the
 * other machine — exactly the cross-machine damage this ticket must avoid.
 * "no-session" stays reserved for THIS machine's own zombies (the reap path);
 * any other reason (including this one) routes to the renderer's no-op branch,
 * leaving the shared doc untouched.
 */
export const FOREIGN_MACHINE_SKIP_REASON = "foreign-machine" as const;

/**
 * Result of resolving the cwd `agent:reconnect` (cold boot) should use for a
 * single agent — for BOTH the Claude session lookup (label file / name-scoped
 * scan live under `~/.claude/projects/<encode(cwd)>`) and the actual CLI
 * relaunch.
 *
 * ★Root cause (uvyCqzJ3tRP3VYVSon7K, "claude 만 전멸"): `agent:reconnect` used
 * to pass the single project-level `rootPath` for every agent, regardless of
 * where that agent actually ran. Task agents run in a per-task worktree
 * (`<worktreesRoot>/<projectId>/<taskId>`, same convention as
 * `worktreeCoordinator.prepare()` and `getUnsurfacedGitFacts`) — a DIFFERENT
 * directory from the project root. Claude's session store is keyed by the
 * literal cwd path, so looking it up under the wrong directory always misses,
 * every time, independent of whether the worktree was ever cleaned up. Codex/
 * Gemini sessions are keyed by agentId alone (an isolated per-agent home), so
 * they never depended on cwd being right — which is why they came back and
 * Claude did not: the two harnesses were never on the same resume contract.
 *
 * When `currentTaskId` is set and the worktree is gone (legitimate cleanup —
 * e.g. `merge_and_close`), there is genuinely nothing to resume: that's
 * `worktreeMissing: true`, a correct skip, not a bug.
 */
export interface ReconnectCwdResolution {
  /** cwd to use for both resume-id lookup and the relaunch. */
  cwd: string;
  /** true when this agent is task-scoped (had a `currentTaskId`). */
  isTaskScoped: boolean;
  /** true when a task worktree was expected but is no longer on disk. */
  worktreeMissing: boolean;
}

/**
 * Pure decision: given the project rootPath, this agent's expected task
 * worktree path (or null when it has no `currentTaskId`), and whether that
 * worktree currently exists on disk, pick the cwd `agent:reconnect` should
 * search/relaunch in.
 */
export function resolveReconnectCwd(
  rootPath: string,
  taskWorktreePath: string | null,
  taskWorktreeExists: boolean,
): ReconnectCwdResolution {
  if (!taskWorktreePath) {
    return { cwd: rootPath, isTaskScoped: false, worktreeMissing: false };
  }
  if (taskWorktreeExists) {
    return {
      cwd: taskWorktreePath,
      isTaskScoped: true,
      worktreeMissing: false,
    };
  }
  // Worktree is gone — nothing to resume into. Fall back to rootPath only so
  // callers still have a valid cwd string to pass around; the worktreeMissing
  // flag is what actually drives the skip decision upstream.
  return { cwd: rootPath, isTaskScoped: true, worktreeMissing: true };
}

/**
 * Classify why a claude/grok agent has no resumable session on cold boot, now
 * that cwd resolution itself is no longer the confound (see
 * `resolveReconnectCwd`). Two genuinely different situations were previously
 * both silently collapsed into one "no-session" skip:
 *
 *  - `worktree-missing` — case (나) from the ticket: the task worktree was
 *    cleaned up (e.g. by `merge_and_close`). Nothing could have been resumed.
 *    This is correct behavior, not a defect.
 *  - `session-not-found` — the worktree (or project root) exists, but no
 *    label/name-scoped Claude session was found in it. Worth a closer look:
 *    the agent may simply have never produced a first turn, but this is also
 *    the shape a genuine resume-path regression would take.
 */
export type ReconnectNoSessionReason = "worktree-missing" | "session-not-found";

export function classifyNoSessionReason(
  worktreeMissing: boolean,
): ReconnectNoSessionReason {
  return worktreeMissing ? "worktree-missing" : "session-not-found";
}

/** One agent's cold-boot reconnect skip, for the orchestrator-facing summary. */
export interface ReconnectSkip {
  name: string;
  model: string;
  category: "worktree-missing" | "session-not-found" | "launch-failed";
  /** launch-failed only — the caught error's message. */
  detail?: string;
}

export interface ReconnectSkipSummary {
  /** Empty string when `skips` is empty — caller should not send anything. */
  message: string;
  /** Deterministic, order-independent fingerprint of the failing set — used
   * upstream to suppress re-sending an unchanged summary on every cold boot
   * (see the throttle in main.ts's `agent:reconnect`). */
  signature: string;
}

/**
 * Build the orchestrator-facing cold-boot reconnect summary — NOT one line
 * per agent, and NOT the same volume for every skip category (오케 리뷰,
 * uvyCqzJ3tRP3VYVSon7K PR #1488).
 *
 * `worktree-missing` is case (나) — expected cleanup (e.g. `merge_and_close`),
 * not a failure. A day with several worktrees cleaned up would otherwise
 * dump one line per agent into the orchestrator PTY, which teaches it (and
 * the human watching it) to tune out reconnect notices entirely — "그게
 * 매번 오케 PTY 로 쏟아지면 사장님이 그 알림을 무시하기 시작한다". It
 * collapses to a single count line instead.
 *
 * `session-not-found` and `launch-failed` are the categories worth a closer
 * look (case 가 candidates), so they stay itemized by name.
 */
export function summarizeReconnectSkips(
  skips: ReconnectSkip[],
): ReconnectSkipSummary {
  if (skips.length === 0) return { message: "", signature: "" };

  const worktreeMissing = skips.filter(
    (s) => s.category === "worktree-missing",
  );
  const concerning = skips.filter((s) => s.category !== "worktree-missing");

  const lines: string[] = [];
  if (worktreeMissing.length > 0) {
    lines.push(
      `🧹 워크트리 정리됨 ${worktreeMissing.length}건 (정상 — 재개 대상 없음, ▶ Start 로 재기동 가능)`,
    );
  }
  if (concerning.length > 0) {
    const byCategory = new Map<string, string[]>();
    for (const s of concerning) {
      const label = s.detail
        ? `${s.name}(${s.model}: ${s.detail})`
        : `${s.name}(${s.model})`;
      const list = byCategory.get(s.category) ?? [];
      list.push(label);
      byCategory.set(s.category, list);
    }
    for (const [category, names] of byCategory) {
      lines.push(`⚠️ ${category} ${names.length}건: ${names.join(", ")}`);
    }
  }

  // Order-independent (sorted) so the same failing set always yields the
  // same signature regardless of iteration order — required for the
  // upstream throttle to actually recognize "unchanged".
  const signature = skips
    .map((s) => `${s.name}:${s.category}`)
    .sort()
    .join("|");

  return { message: lines.join("\n"), signature };
}
