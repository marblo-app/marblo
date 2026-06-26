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
