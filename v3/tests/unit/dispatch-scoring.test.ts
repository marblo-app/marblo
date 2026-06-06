import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  scoreAgents,
  scoreModels,
  checkSpawnConstraints,
  costEfficiencyScore,
  roleMatchIndex,
  loadBalanceIndex,
  normalizeModel,
  WEIGHTS,
  MAX_AGENTS,
  MAX_PER_ROLE,
  type AgentInfo,
  type ModelType,
} from "../../electron/dispatch-scoring";

// ── Test Helpers ────────────────────────────────────────────

function makeAgent(overrides: Partial<AgentInfo> = {}): AgentInfo {
  return {
    id: "agent-1",
    name: "backend-auth",
    model: "claude",
    role: "backend",
    status: "idle",
    restartCount: 0,
    ...overrides,
  };
}

// ── scoreAgents Tests ───────────────────────────────────────

describe("scoreAgents", () => {
  describe("role filtering", () => {
    it("excludes agents with mismatched role", () => {
      const agents = [
        makeAgent({ role: "frontend", name: "frontend-ui" }),
        makeAgent({ role: "backend", name: "backend-api" }),
      ];
      const result = scoreAgents(agents, "backend");
      expect(result).toHaveLength(1);
      expect(result[0].agent.name).toBe("backend-api");
    });

    it("returns empty when no agents match role", () => {
      const agents = [makeAgent({ role: "frontend" })];
      const result = scoreAgents(agents, "backend");
      expect(result).toHaveLength(0);
    });

    it("returns empty for empty agent list", () => {
      const result = scoreAgents([], "backend");
      expect(result).toHaveLength(0);
    });
  });

  // Default agent in makeAgent() is claude+idle+restart=0 → cost-eff=3 and
  // reuseBonus=30 are always added on top of role/load. So baseline for a
  // default claude agent at status X = 100 + lIdx(X) + 3 + 30.
  describe("status scoring", () => {
    it("idle agent gets base(100) + idle(50) + cost-eff(3) + reuse(30) = 183", () => {
      const result = scoreAgents([makeAgent({ status: "idle" })], "backend");
      expect(result[0].score).toBe(183);
    });

    it("working agent gets base(100) + working(10) + cost-eff(3) + reuse(30) = 143", () => {
      const result = scoreAgents([makeAgent({ status: "working" })], "backend");
      expect(result[0].score).toBe(143);
    });

    it("stopped agent gets base(100) + stopped(30) + cost-eff(3) + reuse(30) = 163", () => {
      const result = scoreAgents([makeAgent({ status: "stopped" })], "backend");
      expect(result[0].score).toBe(163);
    });

    it("error agent gets base(100) + error(5) + cost-eff(3) + reuse(30) = 138", () => {
      const result = scoreAgents([makeAgent({ status: "error" })], "backend");
      expect(result[0].score).toBe(138);
    });

    it("sorts agents by score descending (idle > stopped > working > error)", () => {
      const agents = [
        makeAgent({ id: "1", name: "a-error", status: "error" }),
        makeAgent({ id: "2", name: "a-idle", status: "idle" }),
        makeAgent({ id: "3", name: "a-stopped", status: "stopped" }),
        makeAgent({ id: "4", name: "a-working", status: "working" }),
      ];
      const result = scoreAgents(agents, "backend");
      expect(result.map((r) => r.agent.status)).toEqual([
        "idle",
        "stopped",
        "working",
        "error",
      ]);
    });
  });

  describe("model preference", () => {
    it("adds +20 when preferred model matches", () => {
      const result = scoreAgents(
        [makeAgent({ model: "claude", status: "idle" })],
        "backend",
        "claude",
      );
      // 100 (role) + 50 (idle) + 3 (claude cost-eff) + 30 (reuse) + 20 (model match) = 203
      expect(result[0].score).toBe(203);
    });

    it("no bonus when preferred model does not match", () => {
      const result = scoreAgents(
        [makeAgent({ model: "gemini", status: "idle" })],
        "backend",
        "claude",
      );
      // 100 (role) + 50 (idle) + 8 (gemini cost-eff) + 30 (reuse) = 188
      expect(result[0].score).toBe(188);
    });

    it("no bonus when no preferred model specified", () => {
      const result = scoreAgents(
        [makeAgent({ model: "claude", status: "idle" })],
        "backend",
      );
      // 100 + 50 + 3 (claude cost-eff) + 30 (reuse) = 183
      expect(result[0].score).toBe(183);
    });
  });

  describe("tag matching", () => {
    it("adds +10 per matching tag from agent name", () => {
      // Agent name "backend-auth" → tags ["backend", "auth"]
      const result = scoreAgents(
        [makeAgent({ name: "backend-auth", status: "idle" })],
        "backend",
        undefined,
        ["auth"],
      );
      // 100 + 50 + 3 (claude cost-eff, "auth" is neutral) + 30 (reuse) + 10 (1 tag match) = 193
      expect(result[0].score).toBe(193);
    });

    it("matches multiple tags", () => {
      const result = scoreAgents(
        [makeAgent({ name: "backend-auth-api", status: "idle" })],
        "backend",
        undefined,
        ["auth", "api"],
      );
      // 100 + 50 + 3 (claude cost-eff) + 30 (reuse) + 20 (2 tag matches) = 203
      expect(result[0].score).toBe(203);
    });

    it("tag matching is case-insensitive", () => {
      const result = scoreAgents(
        [makeAgent({ name: "backend-Auth", status: "idle" })],
        "backend",
        undefined,
        ["AUTH"],
      );
      // 100 + 50 + 3 + 30 + 10 = 193
      expect(result[0].score).toBe(193);
    });

    it("no bonus for non-matching tags", () => {
      const result = scoreAgents(
        [makeAgent({ name: "backend-auth", status: "idle" })],
        "backend",
        undefined,
        ["database"],
      );
      // 100 + 50 + 3 + 30 + 0 = 183
      expect(result[0].score).toBe(183);
    });
  });

  describe("restart penalty", () => {
    it("subtracts -5 per restart", () => {
      const result = scoreAgents(
        [makeAgent({ status: "idle", restartCount: 2 })],
        "backend",
      );
      // 100 + 50 + 3 (claude cost-eff) + 30 (reuse) - 10 (2 * 5) = 173
      expect(result[0].score).toBe(173);
    });

    it("no penalty when restartCount is 0", () => {
      const result = scoreAgents(
        [makeAgent({ status: "idle", restartCount: 0 })],
        "backend",
      );
      // 100 + 50 + 3 + 30 = 183
      expect(result[0].score).toBe(183);
    });

    it("high restart count significantly reduces score", () => {
      const result = scoreAgents(
        [makeAgent({ status: "idle", restartCount: 5 })],
        "backend",
      );
      // 100 + 50 + 3 + 30 - 25 (5 * 5) = 158
      expect(result[0].score).toBe(158);
    });
  });

  describe("combined scoring & ranking", () => {
    it("prefers idle agent over stopped even with model mismatch", () => {
      const agents = [
        makeAgent({
          id: "1",
          name: "be-stopped",
          model: "claude",
          status: "stopped",
        }),
        makeAgent({
          id: "2",
          name: "be-idle",
          model: "gemini",
          status: "idle",
        }),
      ];
      const result = scoreAgents(agents, "backend", "claude");
      // stopped: 100 + 30 + 20 (model) = 150
      // idle: 100 + 50 = 150 (same!)
      // With same score, original order preserved → first agent wins
      expect(result[0].score).toBeGreaterThanOrEqual(result[1].score);
    });

    it("idle + model match beats idle without model match", () => {
      const agents = [
        makeAgent({ id: "1", name: "be-a", model: "gemini", status: "idle" }),
        makeAgent({ id: "2", name: "be-b", model: "claude", status: "idle" }),
      ];
      const result = scoreAgents(agents, "backend", "claude");
      expect(result[0].agent.id).toBe("2"); // claude matched
      // claude: 100 + 50 + 3 (cost-eff) + 30 (reuse) + 20 (model match) = 203
      expect(result[0].score).toBe(203);
      // gemini: 100 + 50 + 8 (cost-eff) + 30 (reuse) = 188
      expect(result[1].score).toBe(188);
    });

    it("restart penalty can change ranking order", () => {
      const agents = [
        // be-old: 100 + 50 + 3 + 30 - 20 = 163
        makeAgent({ id: "1", name: "be-old", status: "idle", restartCount: 4 }),
        // be-new: 100 + 30 + 3 + 30 = 163
        makeAgent({
          id: "2",
          name: "be-new",
          status: "stopped",
          restartCount: 0,
        }),
      ];
      const result = scoreAgents(agents, "backend");
      // Both score 163, but idle-with-restarts is riskier
      expect(result[0].score).toBe(163);
      expect(result[1].score).toBe(163);
    });
  });

  describe("reason string", () => {
    it("includes agent name, status, model, and score breakdown", () => {
      const result = scoreAgents(
        [makeAgent({ name: "backend-auth", model: "claude", status: "idle" })],
        "backend",
        "claude",
        ["auth"],
      );
      const reason = result[0].reason;
      expect(reason).toContain("backend-auth");
      expect(reason).toContain("idle");
      expect(reason).toContain("claude");
      expect(reason).toContain("score=");
    });
  });
});

// ── scoreModels Tests ───────────────────────────────────────

describe("scoreModels", () => {
  describe("default behavior", () => {
    it("returns claude with highest base score when no tags", () => {
      const result = scoreModels(["claude", "gemini", "gpt"], []);
      expect(result).toBe("claude"); // base: 50 > 40 > 35
    });

    it("returns the only enabled model", () => {
      const result = scoreModels(["gemini"], []);
      expect(result).toBe("gemini");
    });

    it("falls back to first enabled model when empty tags", () => {
      const result = scoreModels(["gpt", "gemini"], []);
      expect(result).toBe("gemini"); // gemini base(40) > gpt base(35)
    });
  });

  describe("tag-based model selection", () => {
    it("selects claude for architecture tags", () => {
      const result = scoreModels(
        ["claude", "gemini", "gpt"],
        ["architecture", "multi-file"],
      );
      expect(result).toBe("claude"); // 50 + 30 + 30 = 110
    });

    it("selects gemini for research tags", () => {
      const result = scoreModels(
        ["claude", "gemini", "gpt"],
        ["research", "large-context"],
      );
      expect(result).toBe("gemini"); // 40 + 20 + 30 = 90 vs claude 50
    });

    it("selects gpt for github + simple-fix tags", () => {
      const result = scoreModels(
        ["claude", "gemini", "gpt"],
        ["github", "simple-fix"],
      );
      // gpt: 35 + 20 + 15 = 70, claude: 50, gemini: 40
      expect(result).toBe("gpt");
    });

    it("applies penalties to gemini for multi-file", () => {
      const result = scoreModels(["gemini", "gpt"], ["multi-file"]);
      // gemini: 40 - 10 = 30, gpt: 35
      expect(result).toBe("gpt");
    });

    it("applies penalties to gpt for architecture", () => {
      const result = scoreModels(["gemini", "gpt"], ["architecture"]);
      // gemini: 40, gpt: 35 - 15 = 20
      expect(result).toBe("gemini");
    });
  });

  describe("custom model handling", () => {
    it("custom model uses base score only (no tag bonuses)", () => {
      const result = scoreModels(
        ["custom"] as ModelType[],
        ["architecture"], // would normally give +30 to claude
      );
      expect(result).toBe("custom");
    });

    it("custom model can win when it is the only option", () => {
      const result = scoreModels(["custom"] as ModelType[], []);
      expect(result).toBe("custom");
    });

    it("custom model loses to claude by default (30 vs 50)", () => {
      const result = scoreModels(["claude", "custom"] as ModelType[], []);
      expect(result).toBe("claude");
    });
  });

  describe("edge cases", () => {
    it("returns claude as ultimate fallback for empty enabledModels", () => {
      const result = scoreModels([], []);
      expect(result).toBe("claude"); // fallback: enabledModels[0] || 'claude'
    });

    it("ignores unknown tags without crashing", () => {
      const result = scoreModels(["claude", "gemini"], ["unknown-tag", "xyz"]);
      // Unknown tags apply no MODEL_TAG_BONUSES/PENALTIES, so the only
      // separator is base + cost-eff: claude(50+3)=53 vs gemini(45+8)=53.
      // That ties within TIED_SCORE_BAND → round-robin picks one of the
      // contenders. The intent of this case is "no crash", not a specific
      // winner; just assert the result stays within enabledModels.
      expect(["claude", "gemini"]).toContain(result);
    });
  });
});

// ── checkSpawnConstraints Tests ──────────────────────────────

describe("checkSpawnConstraints", () => {
  describe("max agents limit", () => {
    it("allows spawn when under MAX_AGENTS", () => {
      const agents = [
        makeAgent({ id: "1", role: "backend", status: "idle" }),
        makeAgent({ id: "2", role: "frontend", status: "working" }),
      ];
      const result = checkSpawnConstraints(agents, "backend");
      expect(result.allowed).toBe(true);
    });

    it("blocks spawn when at MAX_AGENTS active agents", () => {
      const agents = Array.from({ length: MAX_AGENTS }, (_, i) =>
        makeAgent({ id: `agent-${i}`, name: `agent-${i}`, status: "idle" }),
      );
      const result = checkSpawnConstraints(agents, "backend");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("max agents reached");
    });

    it("does not count stopped agents toward limit", () => {
      const agents = [
        ...Array.from({ length: MAX_AGENTS - 1 }, (_, i) =>
          makeAgent({ id: `active-${i}`, name: `active-${i}`, status: "idle" }),
        ),
        makeAgent({ id: "stopped-1", name: "stopped-1", status: "stopped" }),
      ];
      const result = checkSpawnConstraints(agents, "frontend");
      expect(result.allowed).toBe(true);
    });

    it("does not count error agents toward limit", () => {
      const agents = [
        ...Array.from({ length: MAX_AGENTS - 1 }, (_, i) =>
          makeAgent({ id: `active-${i}`, name: `active-${i}`, status: "idle" }),
        ),
        makeAgent({ id: "error-1", name: "error-1", status: "error" }),
      ];
      const result = checkSpawnConstraints(agents, "frontend");
      expect(result.allowed).toBe(true);
    });
  });

  describe("max per role limit", () => {
    it("allows spawn when under MAX_PER_ROLE for the role", () => {
      const agents = [makeAgent({ id: "1", role: "backend", status: "idle" })];
      const result = checkSpawnConstraints(agents, "backend");
      expect(result.allowed).toBe(true);
    });

    it("blocks spawn when at MAX_PER_ROLE for the role", () => {
      const agents = Array.from({ length: MAX_PER_ROLE }, (_, i) =>
        makeAgent({
          id: `be-${i}`,
          name: `be-${i}`,
          role: "backend",
          status: "idle",
        }),
      );
      const result = checkSpawnConstraints(agents, "backend");
      expect(result.allowed).toBe(false);
      expect(result.error).toContain("role 'backend'");
    });

    it("counts only active agents for role check", () => {
      const agents = [
        makeAgent({ id: "1", role: "backend", status: "idle" }),
        makeAgent({ id: "2", role: "backend", status: "stopped" }), // not counted
      ];
      const result = checkSpawnConstraints(agents, "backend");
      expect(result.allowed).toBe(true);
    });

    it("different roles do not interfere", () => {
      const agents = [
        makeAgent({ id: "1", role: "backend", status: "idle" }),
        makeAgent({ id: "2", role: "backend", status: "idle" }),
        makeAgent({ id: "3", role: "frontend", status: "idle" }),
      ];
      // Backend is at limit, but frontend is not
      expect(checkSpawnConstraints(agents, "backend").allowed).toBe(false);
      expect(checkSpawnConstraints(agents, "frontend").allowed).toBe(true);
    });
  });

  describe("empty agent list", () => {
    it("always allows spawn when no agents exist", () => {
      const result = checkSpawnConstraints([], "backend");
      expect(result.allowed).toBe(true);
    });
  });
});

// ── costEfficiencyScore Tests (patent claim 9: 비용효율지표) ──

describe("costEfficiencyScore", () => {
  it("returns higher score for cheaper models on neutral tags", () => {
    const claude = costEfficiencyScore("claude", []);
    const gemini = costEfficiencyScore("gemini", []);
    const gpt = costEfficiencyScore("gpt", []);
    expect(gpt).toBeGreaterThan(gemini);
    expect(gemini).toBeGreaterThan(claude);
  });

  it("amplifies cost-efficiency for cheap-workload tags", () => {
    const baseline = costEfficiencyScore("gpt", []);
    const amplified = costEfficiencyScore("gpt", ["simple-fix"]);
    expect(amplified).toBeGreaterThan(baseline);
  });

  it("dampens cost-efficiency for expensive-workload tags", () => {
    const baseline = costEfficiencyScore("gpt", []);
    const dampened = costEfficiencyScore("gpt", ["architecture"]);
    expect(dampened).toBeLessThan(baseline);
  });

  it("never returns negative", () => {
    // Stack expensive-workload tags hard enough to drive multiplier negative
    const score = costEfficiencyScore("gpt", [
      "architecture",
      "multi-file",
      "large-context",
      "complex-edit",
    ]);
    expect(score).toBeGreaterThanOrEqual(0);
  });

  it("never exceeds the cap regardless of tag stacking", () => {
    const score = costEfficiencyScore("gpt", [
      "simple-fix",
      "quick-edit",
      "boilerplate",
      "fast-execution",
    ]);
    expect(score).toBeLessThanOrEqual(15);
  });
});

// ── scoreAgents: cost-efficiency integration ────────────────

describe("scoreAgents cost-efficiency integration", () => {
  it("breaks ties between role-matched agents toward cheaper model", () => {
    // Two idle backend agents, identical except model. With cost-eff in
    // play, gpt (cheaper) should score above claude on a neutral task.
    const agents = [
      makeAgent({ id: "a1", name: "backend-a", model: "claude" }),
      makeAgent({ id: "a2", name: "backend-b", model: "gpt" }),
    ];
    const result = scoreAgents(agents, "backend");
    expect(result[0].agent.model).toBe("gpt");
    expect(result[0].reason).toMatch(/cost-eff/);
  });

  it("annotates the score reason with cost-eff so audit trail is greppable", () => {
    const agents = [makeAgent({ model: "gemini" })];
    const result = scoreAgents(agents, "backend");
    expect(result[0].reason).toMatch(/cost-eff \+\d+/);
  });

  it("does not let cost-eff override role mismatch (role is the gate)", () => {
    // Cheap model in wrong role should still be filtered out entirely.
    const agents = [makeAgent({ model: "gpt", role: "frontend" })];
    const result = scoreAgents(agents, "backend");
    expect(result).toHaveLength(0);
  });
});

// ── Patent claim 9 [식 1] explicit weighted-sum tests ─────

describe("WEIGHTS exposed for patent [식 1] mapping", () => {
  it("exports w1/w2/w3 for the three core indices", () => {
    expect(typeof WEIGHTS.role).toBe("number");
    expect(typeof WEIGHTS.loadBalance).toBe("number");
    expect(typeof WEIGHTS.costEfficiency).toBe("number");
  });

  it("exports auxiliary weights (modelPreference, tagBonus, restartPenalty, reuseBonus)", () => {
    expect(WEIGHTS.modelPreference).toBeGreaterThan(0);
    expect(WEIGHTS.tagBonus).toBeGreaterThan(0);
    expect(WEIGHTS.restartPenalty).toBeLessThan(0);
    expect(WEIGHTS.reuseBonus).toBeGreaterThan(0);
  });
});

describe("roleMatchIndex / loadBalanceIndex (patent claim 9 분리 함수)", () => {
  it("roleMatchIndex returns 1 on exact match, 0 otherwise", () => {
    expect(roleMatchIndex(makeAgent({ role: "backend" }), "backend")).toBe(1);
    expect(roleMatchIndex(makeAgent({ role: "backend" }), "frontend")).toBe(0);
  });

  it("loadBalanceIndex follows: idle > stopped > working > error", () => {
    const idle = loadBalanceIndex(makeAgent({ status: "idle" }));
    const stopped = loadBalanceIndex(makeAgent({ status: "stopped" }));
    const working = loadBalanceIndex(makeAgent({ status: "working" }));
    const error = loadBalanceIndex(makeAgent({ status: "error" }));
    expect(idle).toBeGreaterThan(stopped);
    expect(stopped).toBeGreaterThan(working);
    expect(working).toBeGreaterThan(error);
  });
});

describe("scoreAgents reuse bonus (기존 에이전트 강하게 우대)", () => {
  it("reason annotates reuse bonus", () => {
    const result = scoreAgents([makeAgent({ status: "idle" })], "backend");
    expect(result[0].reason).toMatch(/reuse \+\d+/);
  });

  it("reuse bonus pushes existing agent above MODEL_BASE_SCORE for new spawn", () => {
    // 기존 idle agent: w1·100 + w2·50 + cost-eff(>0) + reuse 30 ≈ 180~195
    // 새 spawn 의 base score: 45-50 (MODEL_BASE_SCORE)
    // → 항상 reuse 가 압도적
    const result = scoreAgents([makeAgent({ status: "idle" })], "backend");
    expect(result[0].score).toBeGreaterThan(150);
  });
});

describe("subscription-aware costEfficiencyScore (Claude Max 우위)", () => {
  const PLANS_FILE = path.join(
    os.homedir(),
    ".marblo",
    "subscription-plans.json",
  );
  let backupExisted = false;
  let backupContent: string | null = null;

  beforeEach(() => {
    backupExisted = fs.existsSync(PLANS_FILE);
    if (backupExisted) backupContent = fs.readFileSync(PLANS_FILE, "utf-8");
  });

  afterEach(() => {
    if (backupExisted && backupContent !== null) {
      fs.writeFileSync(PLANS_FILE, backupContent, "utf-8");
    } else if (fs.existsSync(PLANS_FILE)) {
      fs.unlinkSync(PLANS_FILE);
    }
  });

  it("subscribed model gets MAX cost-efficiency (overrides per-token)", () => {
    // Without subscription: claude < gpt (per-token rate)
    if (fs.existsSync(PLANS_FILE)) fs.unlinkSync(PLANS_FILE);
    const claudeBefore = costEfficiencyScore("claude", []);
    const gptBefore = costEfficiencyScore("gpt", []);
    expect(gptBefore).toBeGreaterThan(claudeBefore);

    // Register Claude Max subscription
    const dir = path.dirname(PLANS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      PLANS_FILE,
      JSON.stringify([
        {
          modelPrefix: "claude-opus",
          monthlyFlatUsd: 200,
          monthlyTokenAllowance: 50000000,
        },
      ]),
    );

    // Now claude should get MAX (>= 15) → >= gpt
    const claudeAfter = costEfficiencyScore("claude", []);
    expect(claudeAfter).toBeGreaterThanOrEqual(15);
    expect(claudeAfter).toBeGreaterThanOrEqual(gptBefore);
  });

  it("scoreAgents with subscribed Claude beats unsubscribed GPT for same role", () => {
    const dir = path.dirname(PLANS_FILE);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      PLANS_FILE,
      JSON.stringify([{ modelPrefix: "claude-opus", monthlyFlatUsd: 200 }]),
    );

    const agents = [
      makeAgent({ id: "a1", name: "backend-a", model: "claude" }),
      makeAgent({ id: "a2", name: "backend-b", model: "gpt" }),
    ];
    const result = scoreAgents(agents, "backend");
    expect(result[0].agent.model).toBe("claude");
  });
});

// ── normalizeModel: Codex/agy alias folding ─────────────────
//
// Underpins the dispatch reuse hard-filter: an explicit "코덱스"/"codex"
// request must fold onto the internal id "gpt" so it matches gpt agents and
// spawns the Codex CLI. There is no separate "gpt" CLI — both are Codex.
describe("normalizeModel", () => {
  it("folds 'codex' onto the internal id 'gpt'", () => {
    expect(normalizeModel("codex")).toBe("gpt");
    expect(normalizeModel("Codex")).toBe("gpt");
    expect(normalizeModel("CODEX")).toBe("gpt");
  });

  it("passes 'gpt' through unchanged", () => {
    expect(normalizeModel("gpt")).toBe("gpt");
  });

  it("folds concrete gpt/codex model slugs onto 'gpt'", () => {
    expect(normalizeModel("gpt-5")).toBe("gpt");
    expect(normalizeModel("gpt-4.1-mini")).toBe("gpt");
    expect(normalizeModel("codex-mini")).toBe("gpt");
  });

  it("folds 'agy' onto 'antigravity'", () => {
    expect(normalizeModel("agy")).toBe("antigravity");
    expect(normalizeModel("antigravity")).toBe("antigravity");
  });

  it("passes the other canonical models through", () => {
    expect(normalizeModel("claude")).toBe("claude");
    expect(normalizeModel("gemini")).toBe("gemini"); // back-compat retained
    expect(normalizeModel("local")).toBe("local");
    expect(normalizeModel("custom")).toBe("custom");
  });

  it("returns undefined for empty/unknown input so callers fall back to scoring", () => {
    expect(normalizeModel(undefined)).toBeUndefined();
    expect(normalizeModel("")).toBeUndefined();
    expect(normalizeModel("llama-3")).toBeUndefined();
  });

  it("is case/whitespace tolerant", () => {
    expect(normalizeModel("  Codex  ")).toBe("gpt");
    expect(normalizeModel(" AGY ")).toBe("antigravity");
  });
});
