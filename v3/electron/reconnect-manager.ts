import fs from "fs";
import path from "path";
import os from "os";
import { isSummaryOnlyJsonl } from "./orchestrator-manager";

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
  const encodedPath = rootPath.replace(/\//g, "-");
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
  let labels: Record<string, LabelEntry> = {};
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

  // Collect all Claude session JSONL files
  let sessionFiles: Array<{ id: string; mtime: number }> = [];
  try {
    const files = fs
      .readdirSync(projectDir)
      .filter((f) => f.endsWith(".jsonl"))
      .map((f) => {
        const stat = fs.statSync(path.join(projectDir, f));
        return { id: f.replace(".jsonl", ""), mtime: stat.mtimeMs };
      })
      .sort((a, b) => b.mtime - a.mtime); // most recent first
    sessionFiles = files;
  } catch {
    /* can't read directory */
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
