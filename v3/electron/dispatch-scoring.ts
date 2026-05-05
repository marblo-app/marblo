/**
 * Pure scoring functions for smart agent dispatch.
 * Extracted from BridgeServer for testability.
 */

export type ModelType = "claude" | "gemini" | "gpt" | "custom";
export type AgentStatus = "idle" | "working" | "error" | "stopped";

export interface AgentInfo {
  id: string;
  name: string;
  model: ModelType;
  role: string;
  status: AgentStatus;
  restartCount: number;
}

export interface ScoredAgent {
  agent: AgentInfo;
  score: number;
  reason: string;
}

// ── Model strengths for heterogeneous scoring ───────────────

export const MODEL_TAG_BONUSES: Record<string, Record<string, number>> = {
  claude: {
    // Strong but not crushing — leave room for Codex/Gemini to win on
    // their own tags. Previously these were 30 across the board which
    // made Claude essentially always-on for any coding-like task.
    architecture: 25,
    "multi-file": 25,
    coding: 25,
    design: 20,
    mcp: 20,
    refactor: 20,
  },
  gemini: {
    "large-context": 30,
    research: 25,
    analysis: 20,
    documentation: 20,
    "fast-response": 15,
  },
  gpt: {
    github: 25,
    "simple-fix": 25,
    "quick-edit": 20,
    "fast-execution": 20,
    test: 15,
    boilerplate: 15,
  },
};

export const MODEL_TAG_PENALTIES: Record<string, Record<string, number>> = {
  gemini: { "multi-file": -10, "complex-edit": -10 },
  gpt: { architecture: -10, "large-refactor": -10 },
};

// Base scores raised for Gemini and GPT so they compete on their own
// tags instead of being shut out by Claude's larger baseline. The
// previous 50/40/35 spread meant a "research" task scored gemini 40+20=60
// vs claude 50+0=50 — a real lead — but a "simple-fix" task scored
// gpt 35+15=50, tied with claude 50, and the iteration order picked
// claude every time.
export const MODEL_BASE_SCORE: Record<string, number> = {
  claude: 50,
  gemini: 45,
  gpt: 45,
  custom: 30,
};

// When the top model wins by less than this many points, treat it as
// effectively tied and round-robin among the close contenders. Keeps
// the model fleet diverse on borderline tasks instead of always
// snapping to Claude.
const TIED_SCORE_BAND = 5;

// ── Model Presets ──────────────────────────────────────────

export type ModelPreset =
  | "claude-only"
  | "recommended"
  | "balanced"
  | "codex-only"
  | "gemini-only";

export const MODEL_PRESETS: Record<
  ModelPreset,
  { label: string; models: ModelType[]; description: string }
> = {
  "claude-only": {
    label: "Claude 100%",
    models: ["claude"],
    description: "All agents use Claude (highest quality)",
  },
  recommended: {
    label: "Marblo Recommended",
    models: ["claude", "claude", "claude", "gemini", "gpt"],
    description: "Claude 60% + Gemini 20% + Codex 20% (cost-optimized)",
  },
  balanced: {
    label: "Balanced",
    models: ["claude", "gemini", "gpt"],
    description: "Equal rotation across all models",
  },
  "codex-only": {
    label: "Codex/GPT 100%",
    models: ["gpt"],
    description: "All agents use OpenAI Codex/GPT",
  },
  "gemini-only": {
    label: "Gemini 100%",
    models: ["gemini"],
    description: "All agents use Google Gemini",
  },
};

export function resolvePreset(preset?: string): ModelType[] {
  if (preset && preset in MODEL_PRESETS) {
    return MODEL_PRESETS[preset as ModelPreset].models;
  }
  return MODEL_PRESETS["recommended"].models;
}

// ── Constraints ─────────────────────────────────────────────

export const MAX_AGENTS = 5;
export const MAX_PER_ROLE = 2;

// ── Scoring: existing agents ────────────────────────────────

export function scoreAgents(
  agents: AgentInfo[],
  role: string,
  preferredModel?: ModelType,
  tags: string[] = []
): ScoredAgent[] {
  const results: ScoredAgent[] = [];

  for (const agent of agents) {
    // Role must match — non-negotiable filter
    if (agent.role !== role) continue;

    let score = 100; // base: role matched
    const reasons: string[] = [`role=${role} matched`];

    // Status scoring
    switch (agent.status) {
      case "idle":
        score += 50;
        reasons.push("idle (+50)");
        break;
      case "working":
        score += 10;
        reasons.push("working (+10)");
        break;
      case "stopped":
        score += 30;
        reasons.push("stopped (+30, needs restart)");
        break;
      case "error":
        score += 5;
        reasons.push("error (+5, risky)");
        break;
    }

    // Model preference
    if (preferredModel && agent.model === preferredModel) {
      score += 20;
      reasons.push(`model=${preferredModel} matched (+20)`);
    }

    // Tag matching (extract tags from agent name, e.g. "backend-auth" → ["backend", "auth"])
    const agentTags = agent.name.split("-").map((t) => t.toLowerCase());
    let tagMatches = 0;
    for (const tag of tags) {
      if (agentTags.includes(tag.toLowerCase())) {
        score += 10;
        tagMatches++;
      }
    }
    if (tagMatches > 0) {
      reasons.push(`${tagMatches} tag(s) matched (+${tagMatches * 10})`);
    }

    // Restart penalty
    if (agent.restartCount > 0) {
      const penalty = agent.restartCount * 5;
      score -= penalty;
      reasons.push(`${agent.restartCount} restart(s) (-${penalty})`);
    }

    results.push({
      agent,
      score,
      reason: `${agent.status} ${agent.model} agent '${
        agent.name
      }' (score=${score}: ${reasons.join(", ")})`,
    });
  }

  // Sort descending by score
  results.sort((a, b) => b.score - a.score);
  return results;
}

// ── Scoring: best model for new spawn ───────────────────────

// Round-robin counter for model selection when tags don't differentiate
let modelRoundRobin = 0;

export function scoreModels(
  enabledModels: ModelType[],
  tags: string[]
): ModelType {
  // Score every enabled model first so we can both pick the winner and
  // detect ties / near-ties.
  const scored: { model: ModelType; score: number }[] = [];
  let hasTags = tags.length > 0;

  for (const model of enabledModels) {
    let score = MODEL_BASE_SCORE[model] || 0;

    // Custom models use base score only (no tag bonuses/penalties).
    if (model !== "custom") {
      const bonuses = MODEL_TAG_BONUSES[model] || {};
      for (const tag of tags) {
        if (bonuses[tag]) {
          score += bonuses[tag];
          hasTags = true;
        }
      }
      const penalties = MODEL_TAG_PENALTIES[model] || {};
      for (const tag of tags) {
        if (penalties[tag]) {
          score += penalties[tag];
          hasTags = true;
        }
      }
    }
    scored.push({ model, score });
  }

  if (scored.length === 0) {
    return enabledModels[0] || "claude";
  }

  scored.sort((a, b) => b.score - a.score);
  const topScore = scored[0].score;

  // No tags at all → pure round-robin across enabled models for diversity.
  if (!hasTags && enabledModels.length > 1) {
    const idx = modelRoundRobin % enabledModels.length;
    modelRoundRobin++;
    return enabledModels[idx];
  }

  // Tied / near-tied at the top → round-robin among the contenders so we
  // don't always snap to whichever happened to be listed first. Without
  // this, a `simple-fix` tag that ties Claude and GPT (both at 70 in the
  // updated bonuses) would always pick Claude due to enabledModels order.
  const contenders = scored
    .filter((s) => topScore - s.score <= TIED_SCORE_BAND)
    .map((s) => s.model);
  if (contenders.length > 1) {
    const idx = modelRoundRobin % contenders.length;
    modelRoundRobin++;
    return contenders[idx];
  }

  return scored[0].model;
}

// ── Dispatch constraint checks ──────────────────────────────

export function checkSpawnConstraints(
  agents: AgentInfo[],
  role: string
): { allowed: boolean; error?: string } {
  const activeAgents = agents.filter(
    (a) => a.status !== "stopped" && a.status !== "error"
  );
  if (activeAgents.length >= MAX_AGENTS) {
    return {
      allowed: false,
      error: `Cannot spawn: max agents reached (${activeAgents.length}/${MAX_AGENTS}). Use kill_agent or cleanup_agents first.`,
    };
  }

  const roleAgents = activeAgents.filter((a) => a.role === role);
  if (roleAgents.length >= MAX_PER_ROLE) {
    return {
      allowed: false,
      error: `Cannot spawn: max agents for role '${role}' reached (${roleAgents.length}/${MAX_PER_ROLE}). Use kill_agent to free a slot.`,
    };
  }

  return { allowed: true };
}
