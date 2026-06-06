/**
 * Pure scoring functions for smart agent dispatch.
 * Extracted from BridgeServer for testability.
 */

import * as fs from "fs";
import * as os from "os";
import * as path from "path";

export type ModelType =
  | "claude"
  | "gemini"
  | "gpt"
  | "antigravity"
  | "local"
  | "custom";
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

// ── Patent claim 9 [식 1] 가중합: 매칭점수 = Σ (w_i × Index_i) ──
//
// 명세서 [식 1]: 매칭점수 = (w1 × 역할매칭지표) + (w2 × 부하균등지표)
//                          + (w3 × 비용효율지표)
//
// 청구항 9 자체는 "1 이상에 기초" 만 요구하지만, [식 1] 표기와 코드를
// 1:1 매핑해 두면 침해 분석/심사관 대응 시 즉시 인용 가능. 실제 가중치는
// hard gate (역할 미매치 = filter out) 와 soft bonus 의 혼합으로
// 운용된다 — `WEIGHTS` 상수로 한 곳에 모아 튜닝/문서화 단일화.
//
// 추가 항 (model preference, tag bonus, restart penalty, reuse bonus) 은
// [식 1] 의 본질에는 영향 없는 보조 신호 — 같은 가중합 패턴으로 합산하지만
// 청구항 9 의 3대 지표와 분리해서 reason 문자열에 별도 표기한다.
export const WEIGHTS = {
  /** w1 — 역할매칭지표는 hard gate 이지만 매칭 시 base score 100 부여 */
  role: 100,
  /** w2 — 부하균등지표 (status: idle 가장 높고 error 가장 낮음) */
  loadBalance: 1,
  /** w3 — 비용효율지표 (모델 단가 + 구독 한도 인지) */
  costEfficiency: 1,
  /** 보조: 사용자가 명시한 선호 모델과 일치 시 */
  modelPreference: 20,
  /** 보조: 에이전트 이름 태그가 task 태그와 일치 시 (per match) */
  tagBonus: 10,
  /** 보조: 재시작 이력 페널티 (per restart) */
  restartPenalty: -5,
  /**
   * 보조: 기존 에이전트 reuse 시 추가 보너스. 새 spawn 의 base score
   * (MODEL_BASE_SCORE 45-50) 보다 reuse 가 항상 우위에 서도록 — Marblo
   * 운용 정책상 기존 에이전트 컨텍스트 재활용이 새 spawn 보다 거의 항상
   * 더 효율적 (PTY 부팅 비용 + 컨텍스트 재구축 비용 회피).
   */
  reuseBonus: 30,
} as const;

// ── Patent 청구항 9 — 3대 지표 계산기 ───────────────────────

/** 역할매칭지표: agent.role === task.role 이면 1, 아니면 0 (hard gate). */
export function roleMatchIndex(agent: AgentInfo, role: string): 0 | 1 {
  return agent.role === role ? 1 : 0;
}

/**
 * 부하균등지표: 현재 에이전트의 작업부하에 반비례.
 * idle (가장 가벼움) > stopped (재시작 가능) > working (mid-task) > error.
 * 명세서 단락 173: "특정 에이전트에 태스크가 과도하게 집중되는 것을 방지".
 */
export function loadBalanceIndex(agent: AgentInfo): number {
  switch (agent.status) {
    case "idle":
      return 50;
    case "stopped":
      return 30;
    case "working":
      return 10;
    case "error":
      return 5;
  }
}

// ── Cost-efficiency table (patent 청구항 9: 비용효율지표) ──────
//
// Patent claim 9 calls out three explicit components of the per-task,
// per-agent matching score:
//   - 역할매칭지표 (role match)
//   - 부하균등지표 (load balance)
//   - 비용효율지표 (cost efficiency)
//
// The first two are encoded inline below (role gate + status-based load).
// This table backs the third: a coarse $/1M-token weight per model that
// `costEfficiencyScore()` converts into a score bonus. Keep the numbers
// roughly proportional to cost-tracker's MODEL_PRICING but bucketed —
// exact pricing changes shouldn't churn dispatch behavior, only relative
// ordering matters.
//
// Higher COST_EFFICIENCY_WEIGHT == cheaper-per-quality model preferred
// when other signals are tied. Custom models default to the median.
// Base values intentionally sit comfortably below COST_EFFICIENCY_MAX so
// the tag amplifier in `costEfficiencyScore` has room to push without
// being clamped on the very first cheap tag.
const COST_EFFICIENCY_WEIGHT: Record<ModelType, number> = {
  // Claude: highest accuracy but expensive (Opus ~$15/$75 per 1M)
  claude: 3,
  // Gemini: mid-tier flash/pro (~$0.15-1.25 input)
  gemini: 8,
  // Codex/GPT: cheapest mainstream (gpt-4.1-nano ~$0.10, mini ~$0.40)
  gpt: 10,
  // Antigravity (agy): Gemini 3.5 Flash backed (similar tier to gemini),
  // free at launch (2026-05-19). Slightly higher cost-efficiency than
  // gemini due to agentic optimizations + free-tier window.
  antigravity: 9,
  // Local (Ollama / LM Studio / llama.cpp etc.): free at point of use, but
  // capability varies wildly with the loaded weights. Treat as median to
  // avoid biasing dispatch toward an unknown model.
  local: 5,
  // Custom: assume mid-tier
  custom: 5,
};

// Cap on how much the cost-efficiency component can move the score.
// Smaller than the role/load components so cost alone never overrides
// role mismatch (role is the gate per claim 9).
const COST_EFFICIENCY_MAX = 15;

/**
 * Cost-efficiency score for the patent claim 9 비용효율지표.
 *
 * Two-tier:
 *   1. Subscription-aware (Claude Max, ChatGPT Plus 등): 사용자가
 *      `~/.marblo/subscription-plans.json` 에 등록한 모델은 한도 내에서
 *      incremental cost = 0 → 비용효율을 MAX 로 부여. 토큰 단가 기반
 *      모델보다 항상 우위.
 *   2. Per-token (default): 기존 `COST_EFFICIENCY_WEIGHT` 테이블 기반,
 *      cheap-workload tags (simple-fix 등) 가 amplify, expensive-workload
 *      tags (architecture 등) 가 dampen.
 *
 * 결과 값: 0 ~ COST_EFFICIENCY_MAX (역할/부하 매칭이 항상 dominant).
 */
export function costEfficiencyScore(model: ModelType, tags: string[]): number {
  // Tier 1: 사용자가 이 모델을 구독제로 등록했으면 cost-eff = MAX.
  // 한도 초과 (overage 모드) 인지는 dispatch 시점에 알 수 없으므로 보수적으로
  // "구독 = 한도 내" 가정. 한도 초과 빈도가 잦으면 사용자가 plan 을 지우면 됨.
  if (hasSubscriptionPlan(model)) {
    return COST_EFFICIENCY_MAX;
  }

  // Tier 2: per-token rate 기반 (기존 동작)
  const base = COST_EFFICIENCY_WEIGHT[model] ?? COST_EFFICIENCY_WEIGHT.custom;
  let multiplier = 1.0;
  for (const tag of tags) {
    if (
      tag === "simple-fix" ||
      tag === "quick-edit" ||
      tag === "boilerplate" ||
      tag === "fast-execution"
    ) {
      multiplier += 0.3;
    } else if (
      tag === "architecture" ||
      tag === "multi-file" ||
      tag === "large-context" ||
      tag === "complex-edit"
    ) {
      multiplier -= 0.3;
    }
  }
  multiplier = Math.max(0, multiplier);
  return Math.min(COST_EFFICIENCY_MAX, Math.round(base * multiplier));
}

// ── Subscription plan loader (cost-tracker 와 동일 파일 공유) ────

interface SubscriptionPlanEntry {
  modelPrefix: string;
  monthlyFlatUsd: number;
  monthlyTokenAllowance?: number;
  overagePerToken?: { inputPer1M: number; outputPer1M: number };
}

const SUBSCRIPTION_PLANS_FILE = path.join(
  os.homedir(),
  ".marblo",
  "subscription-plans.json",
);

let _subPlanCache: SubscriptionPlanEntry[] | null = null;
let _subPlanMtime = 0;

function loadSubscriptionPlans(): SubscriptionPlanEntry[] {
  try {
    if (!fs.existsSync(SUBSCRIPTION_PLANS_FILE)) {
      _subPlanCache = [];
      return [];
    }
    const stat = fs.statSync(SUBSCRIPTION_PLANS_FILE);
    if (_subPlanCache && stat.mtimeMs === _subPlanMtime) return _subPlanCache;
    const raw = fs.readFileSync(SUBSCRIPTION_PLANS_FILE, "utf-8");
    const parsed = JSON.parse(raw) as SubscriptionPlanEntry[];
    _subPlanCache = Array.isArray(parsed) ? parsed : [];
    _subPlanMtime = stat.mtimeMs;
    return _subPlanCache;
  } catch {
    _subPlanCache = [];
    return [];
  }
}

/**
 * 사용자가 이 모델을 구독제로 등록했는지 확인. 모델 ID 가 plan 의
 * modelPrefix 로 시작하면 매치. cost-tracker 의 findPricing 과 동일 파일을
 * 읽으므로 두 모듈이 같은 view 를 공유.
 *
 * Note: ModelType ("claude" / "gemini" / "gpt") 는 dispatch 단계에서만
 * 알 수 있는 거친 카테고리 — 사용자가 등록한 prefix (예: "claude-opus") 가
 * 어떤 ModelType 에 속하는지는 prefix 의 첫 토큰으로 매칭.
 */
function hasSubscriptionPlan(model: ModelType): boolean {
  const plans = loadSubscriptionPlans();
  if (plans.length === 0) return false;
  // modelPrefix 의 첫 토큰을 ModelType 으로 매핑
  // "claude-opus" → "claude", "gpt-5" → "gpt", "gemini-2.5" → "gemini"
  const modelTokenMap: Record<string, ModelType> = {
    claude: "claude",
    gemini: "gemini",
    gpt: "gpt",
    o3: "gpt",
    o4: "gpt",
    antigravity: "antigravity",
    agy: "antigravity",
  };
  for (const p of plans) {
    const firstToken = p.modelPrefix.split(/[-_.]/)[0].toLowerCase();
    if (modelTokenMap[firstToken] === model) return true;
  }
  return false;
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
  antigravity: {
    // Antigravity (agy) is purpose-built for multi-step autonomous flows
    // with sub-agents. Strong on agentic / autonomous tags, secondary on
    // research/documentation (shared with Gemini, weaker bonus since
    // Gemini is the established research workhorse).
    agentic: 30,
    "multi-agent": 25,
    autonomous: 25,
    research: 15,
    documentation: 15,
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
  // Antigravity: same base as Gemini/GPT — proves itself via tag bonuses
  // for agentic workloads rather than being shoo-in for everything.
  antigravity: 45,
  // Local: capability varies with the loaded weights, so we anchor below
  // the hosted-model tier. User can override via custom command + tags.
  local: 35,
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
  | "antigravity-only";

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
    models: ["claude", "claude", "claude", "antigravity", "gpt"],
    description: "Claude 60% + Antigravity 20% + Codex 20% (cost-optimized)",
  },
  balanced: {
    label: "Balanced",
    models: ["claude", "antigravity", "gpt"],
    description: "Equal rotation across Claude / Antigravity / Codex",
  },
  "codex-only": {
    label: "Codex 100%",
    models: ["gpt"],
    description: "All agents use OpenAI Codex (model id 'gpt')",
  },
  "antigravity-only": {
    label: "Antigravity 100%",
    models: ["antigravity"],
    description: "All agents use Google Antigravity (agy)",
  },
};

export function resolvePreset(preset?: string): ModelType[] {
  if (preset && preset in MODEL_PRESETS) {
    return MODEL_PRESETS[preset as ModelPreset].models;
  }
  return MODEL_PRESETS["recommended"].models;
}

// ── Model alias normalization ───────────────────────────────
//
// The user-facing / orchestrator-facing name for OpenAI's CLI is "Codex"
// (the binary is literally `codex`); there is NO "gpt" CLI. Internally we
// still key everything off the ModelType `"gpt"`, so callers that say
// "codex" (the natural word a user/orchestrator uses) must be folded onto
// "gpt" before any spawn/score logic runs. Same idea for agy → antigravity.
// Folding aliases at the spawn chokepoint (bridge-server) is why an
// explicit "코덱스 스폰해줘" no longer silently mis-routes.
const MODEL_ALIASES: Record<string, ModelType> = {
  claude: "claude",
  codex: "gpt", // ← the important one: Codex CLI == ModelType "gpt"
  gpt: "gpt",
  gemini: "gemini", // retained for back-compat with existing gemini agents
  antigravity: "antigravity",
  agy: "antigravity",
  local: "local",
  custom: "custom",
};

/**
 * Fold a free-form model string (e.g. "codex", "GPT", "agy") onto a canonical
 * ModelType. Returns undefined for unknown input so callers can fall back to
 * tag scoring instead of silently defaulting to a wrong model.
 */
export function normalizeModel(model?: string): ModelType | undefined {
  if (!model) return undefined;
  const key = model.trim().toLowerCase();
  if (MODEL_ALIASES[key]) return MODEL_ALIASES[key];
  // "gpt-5", "gpt-4.1" 등 구체 모델 슬러그도 Codex(gpt)로 접는다.
  if (key.startsWith("gpt") || key.startsWith("codex")) return "gpt";
  return undefined;
}

// ── Constraints ─────────────────────────────────────────────

export const MAX_AGENTS = 5;
export const MAX_PER_ROLE = 2;

// ── Scoring: existing agents ────────────────────────────────

export function scoreAgents(
  agents: AgentInfo[],
  role: string,
  preferredModel?: ModelType,
  tags: string[] = [],
): ScoredAgent[] {
  const results: ScoredAgent[] = [];

  for (const agent of agents) {
    // Patent 청구항 9 [식 1]: 매칭점수 = (w1 × 역할매칭) + (w2 × 부하균등)
    //                                 + (w3 × 비용효율) + 보조 신호.
    // 역할 미매치는 hard gate (지표 = 0 → score = 0 → 사실상 filter out).
    const rIdx = roleMatchIndex(agent, role);
    if (rIdx === 0) continue;

    const lIdx = loadBalanceIndex(agent);
    const cIdx = costEfficiencyScore(agent.model, tags);

    // Core: w1·역할 + w2·부하균등 + w3·비용효율 (특허 [식 1])
    let score =
      WEIGHTS.role * rIdx +
      WEIGHTS.loadBalance * lIdx +
      WEIGHTS.costEfficiency * cIdx;

    const reasons: string[] = [
      `role=${role} (w1·${WEIGHTS.role}=${WEIGHTS.role * rIdx})`,
      `load=${agent.status} (w2·${lIdx}=${WEIGHTS.loadBalance * lIdx})`,
    ];
    if (cIdx > 0) {
      reasons.push(`cost-eff +${WEIGHTS.costEfficiency * cIdx}`);
    }

    // Reuse bonus — 기존 에이전트 재활용은 PTY 부팅/컨텍스트 재구축 비용을
    // 회피하므로 새 spawn (MODEL_BASE_SCORE 45-50) 보다 거의 항상 우위에
    // 서야 함. WEIGHTS.reuseBonus 가 그 격차를 명시적으로 보장.
    score += WEIGHTS.reuseBonus;
    reasons.push(`reuse +${WEIGHTS.reuseBonus}`);

    // 보조 1: 사용자가 명시한 선호 모델
    if (preferredModel && agent.model === preferredModel) {
      score += WEIGHTS.modelPreference;
      reasons.push(
        `model=${preferredModel} matched (+${WEIGHTS.modelPreference})`,
      );
    }

    // 보조 2: 에이전트 이름 태그가 task 태그와 일치 (예: "backend-auth")
    const agentTags = agent.name.split("-").map((t) => t.toLowerCase());
    let tagMatches = 0;
    for (const tag of tags) {
      if (agentTags.includes(tag.toLowerCase())) {
        score += WEIGHTS.tagBonus;
        tagMatches++;
      }
    }
    if (tagMatches > 0) {
      reasons.push(
        `${tagMatches} tag(s) matched (+${tagMatches * WEIGHTS.tagBonus})`,
      );
    }

    // 보조 3: 재시작 페널티 (음수 가중치)
    if (agent.restartCount > 0) {
      const penalty = agent.restartCount * WEIGHTS.restartPenalty;
      score += penalty; // restartPenalty 자체가 음수
      reasons.push(`${agent.restartCount} restart(s) (${penalty})`);
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
  tags: string[],
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
    // Cost-efficiency component (patent claim 9: 비용효율지표). Adds a
    // small per-model bonus so cheaper models break ties on tasks where
    // expensive-model strengths don't apply. Same function as scoreAgents
    // for consistency between reuse and fresh-spawn paths.
    score += costEfficiencyScore(model, tags);
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
  role: string,
): { allowed: boolean; error?: string } {
  const activeAgents = agents.filter(
    (a) => a.status !== "stopped" && a.status !== "error",
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
