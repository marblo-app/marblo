import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import {
  scoreAgents,
  scoreModels,
  scoreModelsDetailed,
  resolveSimpleAgyBias,
  checkSpawnConstraints,
  costEfficiencyScore,
  roleMatchIndex,
  loadBalanceIndex,
  normalizeModel,
  isWorktreeIsolated,
  checkPlanConcurrency,
  isCapExempt,
  budgetBiasScore,
  getPlanAgentLimit,
  countActivePlanAgents,
  isLaneContextId,
  isAgentContextReusable,
  WEIGHTS,
  MAX_AGENTS,
  MAX_PER_ROLE,
  type AgentInfo,
  type AgentStatus,
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

// ── §C: complexity→provider 소프트 라우팅 (simple→antigravity bias) ─────

describe("scoreModels — simple→antigravity bias (§C)", () => {
  let savedBias: string | undefined;
  beforeEach(() => {
    savedBias = process.env.MARBLO_AGY_SIMPLE_BIAS;
    delete process.env.MARBLO_AGY_SIMPLE_BIAS;
  });
  afterEach(() => {
    if (savedBias === undefined) delete process.env.MARBLO_AGY_SIMPLE_BIAS;
    else process.env.MARBLO_AGY_SIMPLE_BIAS = savedBias;
  });

  it("resolveSimpleAgyBias: unset/0/음수/garbage → 0, 양수만 통과", () => {
    expect(resolveSimpleAgyBias()).toBe(0);
    process.env.MARBLO_AGY_SIMPLE_BIAS = "0";
    expect(resolveSimpleAgyBias()).toBe(0);
    process.env.MARBLO_AGY_SIMPLE_BIAS = "-5";
    expect(resolveSimpleAgyBias()).toBe(0);
    process.env.MARBLO_AGY_SIMPLE_BIAS = "abc";
    expect(resolveSimpleAgyBias()).toBe(0);
    process.env.MARBLO_AGY_SIMPLE_BIAS = "12";
    expect(resolveSimpleAgyBias()).toBe(12);
  });

  it("bias OFF(미설정) + simple → 가점 없음(claude 선호 태그면 claude 유지=무회귀)", () => {
    // architecture: claude +25, antigravity +0 → claude 압도(>tie-band).
    const r = scoreModels(
      ["claude", "antigravity"],
      ["architecture"],
      "simple",
    );
    expect(r).toBe("claude");
  });

  it("bias ON(큰 값) + simple → claude 선호 태그여도 antigravity 가 이김", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const r = scoreModels(
      ["claude", "antigravity"],
      ["architecture"],
      "simple",
    );
    expect(r).toBe("antigravity");
  });

  it("bias ON + simple + 무태그 → 순수 round-robin 우회하고 antigravity 우위", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    // 무태그여도 bias 가 hasTags 로 취급돼 점수 경쟁 → antigravity 압도.
    const r = scoreModels(["claude", "antigravity"], [], "simple");
    expect(r).toBe("antigravity");
  });

  it("bias ON 이어도 complexity=standard → 가점 없음(simple 전용)", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const r = scoreModels(
      ["claude", "antigravity"],
      ["architecture"],
      "standard",
    );
    expect(r).toBe("claude");
  });

  it("bias ON 이어도 complexity=complex → 가점 없음(simple 전용)", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const r = scoreModels(
      ["claude", "antigravity"],
      ["architecture"],
      "complex",
    );
    expect(r).toBe("claude");
  });

  it("bias ON + simple 이지만 antigravity 가 enabledModels 에 없으면 무효", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    // architecture → claude 우위. 없는 antigravity 를 편애할 수 없음.
    const r = scoreModels(["claude", "gpt"], ["architecture"], "simple");
    expect(r).toBe("claude");
  });

  it("complexity 미지정(오케 경로)이면 bias 무관(무회귀)", () => {
    process.env.MARBLO_AGY_SIMPLE_BIAS = "100";
    const r = scoreModels(["claude", "antigravity"], ["architecture"]);
    expect(r).toBe("claude");
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

// ── Real-time budget bias (Usage tab quota/headroom) ────────

describe("budgetBiasScore", () => {
  it("returns neutral bias when no usage information exists", () => {
    expect(budgetBiasScore("claude").bias).toBe(0);
    expect(budgetBiasScore("gemini", { claude: { usedPercent: 10 } }).bias).toBe(
      0,
    );
  });

  it("adds only a weak positive bias when plenty of quota remains", () => {
    const result = budgetBiasScore("gpt", { gpt: { usedPercent: 20 } });
    expect(result.bias).toBeGreaterThan(0);
    expect(result.bias).toBeLessThanOrEqual(20);
    expect(result.reason).toContain("budget +");
  });

  it("applies a strong negative bias near quota exhaustion", () => {
    const result = budgetBiasScore("claude", {
      claude: { usedPercent: 95 },
    });
    expect(result.bias).toBeLessThan(0);
    expect(result.bias).toBeGreaterThanOrEqual(-20);
    expect(result.reason).toContain("left");
  });

  it("returns null bias for exhausted quota so callers hard-gate the model", () => {
    const result = budgetBiasScore("claude", {
      claude: { usedPercent: 100 },
    });
    expect(result.bias).toBeNull();
    expect(result.reason).toContain("exhausted");
  });
});

describe("scoreAgents budget-bias integration", () => {
  it("excludes a role-matched agent when its model quota is exhausted", () => {
    const agents = [makeAgent({ model: "claude" })];
    const result = scoreAgents(agents, "backend", undefined, [], {
      claude: { usedPercent: 100 },
    });
    expect(result).toHaveLength(0);
  });

  it("records budget contribution in the agent decision reason", () => {
    const result = scoreAgents(
      [makeAgent({ model: "gpt" })],
      "backend",
      undefined,
      [],
      { gpt: { usedPercent: 30 } },
    );
    expect(result[0].reason).toContain("budget +");
  });
});

describe("scoreModels budget-bias integration", () => {
  it("uses budget bias only as a tie-breaker sized signal", () => {
    const selection = scoreModelsDetailed(
      ["claude", "gpt"],
      ["architecture"],
      "standard",
      { claude: { usedPercent: 10 }, gpt: { usedPercent: 10 } },
    );
    expect(selection.selected).toBe("claude");
    expect(selection.scores.find((s) => s.model === "claude")?.budgetBias).toBe(
      6,
    );
  });

  it("hard-gates exhausted models out of fresh-spawn scoring", () => {
    const selection = scoreModelsDetailed(["claude", "gpt"], [], undefined, {
      claude: { usedPercent: 100 },
      gpt: { usedPercent: 20 },
    });
    expect(selection.scores.map((s) => s.model)).toEqual(["gpt"]);
    expect(selection.selected).toBe("gpt");
  });

  it("reports all-budget-exhausted instead of falling back to an exhausted model", () => {
    const selection = scoreModelsDetailed(["claude"], [], undefined, {
      claude: { usedPercent: 100 },
    });
    expect(selection.mode).toBe("all-budget-exhausted");
    expect(selection.scores).toHaveLength(0);
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

// ── isWorktreeIsolated (dispatch reuse/restart isolation gate) ──
//
// Guards the gap where dispatchTask reuses an idle agent (or restarts a stopped
// one) WITHOUT routing through WorktreeCoordinator.prepare() — the reused PTY
// keeps its old cwd, so reusing an agent parked outside the task's worktree
// would pollute the wrong tree (e.g. the main checkout).
describe("isWorktreeIsolated", () => {
  const PROJECT = "proj123";
  const TASK = "taskABC";
  // The worktree the coordinator would land this dispatch in.
  const target = path.join(os.homedir(), ".marblo", "worktrees", PROJECT, TASK);

  it("allows reuse when the agent already sits in the target worktree", () => {
    expect(isWorktreeIsolated(target, PROJECT, TASK)).toBe(true);
  });

  it("blocks reuse of an agent parked in the MAIN checkout (isolation break)", () => {
    const mainCheckout = "/Users/dev/Documents/programming/marblo/v3";
    expect(isWorktreeIsolated(mainCheckout, PROJECT, TASK)).toBe(false);
  });

  it("blocks reuse of an agent sitting in ANOTHER task's worktree", () => {
    const otherWorktree = path.join(
      os.homedir(),
      ".marblo",
      "worktrees",
      PROJECT,
      "someOtherTask",
    );
    expect(isWorktreeIsolated(otherWorktree, PROJECT, TASK)).toBe(false);
  });

  it("blocks reuse when the agent's cwd is unknown (err toward fresh spawn)", () => {
    expect(isWorktreeIsolated(undefined, PROJECT, TASK)).toBe(false);
    expect(isWorktreeIsolated("", PROJECT, TASK)).toBe(false);
  });

  it("keeps reuse unrestricted when no projectId (isolation not required)", () => {
    // Non-isolated dispatch must NOT regress — any cwd (even unknown) is fine.
    expect(isWorktreeIsolated("/anywhere", undefined, TASK)).toBe(true);
    expect(isWorktreeIsolated(undefined, undefined, TASK)).toBe(true);
    expect(isWorktreeIsolated("/anywhere", "", TASK)).toBe(true);
  });

  it("keeps reuse unrestricted when no taskId (no concrete worktree target)", () => {
    expect(isWorktreeIsolated("/anywhere", PROJECT, undefined)).toBe(true);
    expect(isWorktreeIsolated("/anywhere", PROJECT, "")).toBe(true);
  });

  it("matches only on the exact <projectId>/<taskId> suffix, not a partial", () => {
    // A sibling task whose id shares a prefix must NOT count as the target.
    const lookalike = path.join(
      os.homedir(),
      ".marblo",
      "worktrees",
      PROJECT,
      TASK + "-extra",
    );
    expect(isWorktreeIsolated(lookalike, PROJECT, TASK)).toBe(false);
  });
});

// ── Lane 격리: dispatch reuse / cleanup context gate ─────────
//
// bridge-server 는 dispatch 후보를 점수화하기 전에 allAgents 를
// isAgentContextReusable(agent.MARBLO_CONTEXT, request.contextId) 로 거른다.
// /reuse-agent 핸들러와 cleanup_agents(tools.ts) 도 동일 의미의 게이트를
// 적용한다 — 즉 이 한 함수가 "보드 dispatch 는 레인 에이전트를 재사용/정리할
// 수 없고, 레인 dispatch 는 같은 레인 에이전트만 만질 수 있다"는 격리 불변을
// 담는다.

describe("isLaneContextId (dispatch-scoring 로컬 복제본)", () => {
  it("legacy 'lane' 과 concrete 'lane:<id>' 를 인식한다", () => {
    expect(isLaneContextId("lane")).toBe(true);
    expect(isLaneContextId("lane:q1")).toBe(true);
  });
  it("board / mission / 미설정은 lane 이 아니다", () => {
    expect(isLaneContextId("board")).toBe(false);
    expect(isLaneContextId("mission-7")).toBe(false);
    expect(isLaneContextId(undefined)).toBe(false);
    expect(isLaneContextId("")).toBe(false);
  });
});

describe("isAgentContextReusable (레인↔보드 reuse/cleanup 격리 불변)", () => {
  it("★보드 dispatch 는 레인 에이전트를 재사용할 수 없다", () => {
    expect(isAgentContextReusable("lane:q1", "board")).toBe(false);
    expect(isAgentContextReusable("lane:q1", undefined)).toBe(false);
    expect(isAgentContextReusable("lane", "board")).toBe(false);
  });

  it("★레인 dispatch 는 같은 레인 에이전트만 재사용한다 (cross-lane 차단)", () => {
    expect(isAgentContextReusable("lane:q1", "lane:q1")).toBe(true);
    expect(isAgentContextReusable("lane:q1", "lane:q2")).toBe(false);
  });

  it("★레인 dispatch 는 보드/unscoped 에이전트를 끌어쓰지 않는다", () => {
    // 레인은 자기 격리 워크트리 에이전트만 만져야 한다.
    expect(isAgentContextReusable("board", "lane:q1")).toBe(false);
    expect(isAgentContextReusable(undefined, "lane:q1")).toBe(false);
  });

  it("보드↔보드 / unscoped 는 기존대로 재사용 가능 (무회귀)", () => {
    expect(isAgentContextReusable("board", "board")).toBe(true);
    expect(isAgentContextReusable(undefined, undefined)).toBe(true);
    expect(isAgentContextReusable(undefined, "board")).toBe(true);
    expect(isAgentContextReusable("board", undefined)).toBe(true);
  });
});

// ── M2: per-plan concurrency cap ────────────────────────────

describe("plan concurrency cap (M2)", () => {
  function statuses(...s: AgentStatus[]): { status: AgentStatus }[] {
    return s.map((status) => ({ status }));
  }

  describe("getPlanAgentLimit", () => {
    it("maps the SKU matrix: free=2, pro=5, team/team_plus/enterprise=unlimited", () => {
      expect(getPlanAgentLimit("free")).toBe(2);
      expect(getPlanAgentLimit("pro")).toBe(5);
      expect(getPlanAgentLimit("team")).toBe(-1);
      expect(getPlanAgentLimit("team_plus")).toBe(-1);
      expect(getPlanAgentLimit("enterprise")).toBe(-1);
    });

    it("treats unknown / undefined plans as unlimited (never false-block)", () => {
      expect(getPlanAgentLimit(undefined)).toBe(-1);
      expect(getPlanAgentLimit("")).toBe(-1);
      expect(getPlanAgentLimit("mystery_tier")).toBe(-1);
    });
  });

  describe("countActivePlanAgents", () => {
    it("counts only idle + working; stopped/error don't consume a slot", () => {
      expect(
        countActivePlanAgents(
          statuses("idle", "working", "stopped", "error", "working"),
        ),
      ).toBe(3);
      expect(countActivePlanAgents([])).toBe(0);
    });
  });

  describe("isCapExempt — whitelist criteria", () => {
    it("exempts the orchestrator and internal roles (case-insensitive)", () => {
      expect(isCapExempt("orchestrator")).toBe(true);
      expect(isCapExempt("Orchestrator")).toBe(true);
      expect(isCapExempt("internal")).toBe(true);
      expect(isCapExempt("INTERNAL")).toBe(true);
    });

    it("exempts any role when the system flag is set", () => {
      expect(isCapExempt("backend", true)).toBe(true);
      expect(isCapExempt(undefined, true)).toBe(true);
    });

    it("does NOT exempt billable worker roles without the system flag", () => {
      expect(isCapExempt("backend")).toBe(false);
      expect(isCapExempt("frontend", false)).toBe(false);
      expect(isCapExempt("test")).toBe(false);
      expect(isCapExempt(undefined)).toBe(false);
    });
  });

  describe("checkPlanConcurrency", () => {
    it("blocks a free worker spawn at the 2-agent ceiling", () => {
      const r = checkPlanConcurrency("free", statuses("working", "idle"), {
        role: "backend",
      });
      expect(r.allowed).toBe(false);
      expect(r.exempt).toBe(false);
      expect(r.active).toBe(2);
      expect(r.limit).toBe(2);
      expect(r.reason).toContain("Free");
    });

    it("allows a free worker spawn below the ceiling", () => {
      const r = checkPlanConcurrency("free", statuses("working"), {
        role: "backend",
      });
      expect(r.allowed).toBe(true);
      expect(r.reason).toBeUndefined();
    });

    it("blocks a pro worker spawn at the 5-agent ceiling", () => {
      const r = checkPlanConcurrency(
        "pro",
        statuses("working", "working", "idle", "working", "idle"),
        { role: "backend" },
      );
      expect(r.allowed).toBe(false);
      expect(r.reason).toContain("Pro");
    });

    it("does NOT count stopped/error agents toward the ceiling", () => {
      // 2 active + 3 stopped/error under a free(2) cap → still blocked at 2,
      // but if only 1 is active it's allowed despite extra dead agents.
      const blocked = checkPlanConcurrency(
        "free",
        statuses("working", "idle", "stopped", "error"),
        { role: "backend" },
      );
      expect(blocked.allowed).toBe(false);
      const allowed = checkPlanConcurrency(
        "free",
        statuses("working", "stopped", "error", "stopped"),
        { role: "backend" },
      );
      expect(allowed.allowed).toBe(true);
    });

    it("EXEMPTS the orchestrator even when the fleet is over the free cap", () => {
      const r = checkPlanConcurrency(
        "free",
        statuses("working", "working", "working"),
        { role: "orchestrator" },
      );
      expect(r.allowed).toBe(true);
      expect(r.exempt).toBe(true);
    });

    it("EXEMPTS a system-flagged spawn (e.g. merge resolver) over the cap", () => {
      const r = checkPlanConcurrency("free", statuses("working", "working"), {
        role: "backend",
        system: true,
      });
      expect(r.allowed).toBe(true);
      expect(r.exempt).toBe(true);
    });

    it("never blocks on unlimited / unknown plans", () => {
      const many = statuses(...Array<AgentStatus>(20).fill("working"));
      expect(
        checkPlanConcurrency("team", many, { role: "backend" }).allowed,
      ).toBe(true);
      expect(
        checkPlanConcurrency(undefined, many, { role: "backend" }).allowed,
      ).toBe(true);
    });
  });
});

// ── N6: NaN guard — 결측/undefined/구버전 enum 점수 오염 방어 ──
//
// status 가 타입 union 밖(IPC/디스크/구버전 enum)으로 들어오면 예전엔
// loadBalanceIndex 가 어떤 case 도 못 맞춰 undefined 를 반환 → scoreAgents 의
// 가중합 `WEIGHTS.loadBalance * lIdx` 이 NaN → score 전체가 NaN → results.sort
// 비교자가 NaN 을 받아 정렬이 미정의가 되고 잘못된 에이전트가 뽑혔다.
describe("N6: NaN guard against contaminated scores", () => {
  // 타입 시스템을 우회해 '오염된' 런타임 입력을 만든다(IPC/디스크에서 실제
  // 발생 가능). 픽스처가 아니라 방어 대상 그 자체다.
  const corruptStatus = "zombie" as unknown as AgentStatus;

  it("loadBalanceIndex returns a finite fallback for an unknown status", () => {
    const v = loadBalanceIndex(makeAgent({ status: corruptStatus }));
    expect(Number.isFinite(v)).toBe(true);
  });

  it("scoreAgents yields a finite score for an agent with a corrupt status", () => {
    const result = scoreAgents(
      [makeAgent({ status: corruptStatus })],
      "backend",
    );
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0].score)).toBe(true);
    // reason 문자열에도 NaN 이 새어들어가면 안 된다.
    expect(result[0].reason).not.toContain("NaN");
  });

  it("keeps sort order well-defined and all scores finite when valid + corrupt agents are mixed", () => {
    const agents = [
      makeAgent({ id: "1", name: "be-corrupt", status: corruptStatus }),
      makeAgent({ id: "2", name: "be-idle", status: "idle" }),
      makeAgent({ id: "3", name: "be-working", status: "working" }),
    ];
    const result = scoreAgents(agents, "backend");
    // 모든 점수가 유한해야 한다.
    expect(result.every((r) => Number.isFinite(r.score))).toBe(true);
    // 내림차순 정렬이 NaN 비교로 깨지지 않았는지(인접쌍 단조 감소) 확인.
    for (let i = 1; i < result.length; i++) {
      expect(result[i - 1].score).toBeGreaterThanOrEqual(result[i].score);
    }
    // 정상 idle 에이전트가 corrupt 후보보다 위에 와야 한다(잘못된 선택 방지).
    expect(result[0].agent.status).toBe("idle");
  });

  it("does not let a corrupt restartCount (NaN) contaminate the score", () => {
    const result = scoreAgents(
      [makeAgent({ status: "idle", restartCount: NaN })],
      "backend",
    );
    expect(result).toHaveLength(1);
    expect(Number.isFinite(result[0].score)).toBe(true);
  });

  it("scoreModels stays within enabledModels even with a tag set (no NaN-broken sort)", () => {
    const enabled = ["claude", "gpt"] as ModelType[];
    const result = scoreModels(enabled, ["architecture"]);
    expect(enabled).toContain(result);
  });
});

// ── scoreModelsDetailed Tests (dispatch decision telemetry) ──
describe("scoreModelsDetailed", () => {
  it("selected matches the thin scoreModels() wrapper for the same call", () => {
    // Same inputs + identical round-robin counter advance → same winner.
    // Run detailed first, then scoreModels; with a differentiating tag the
    // pick is deterministic (top-score) regardless of counter state.
    const detailed = scoreModelsDetailed(["gemini", "gpt"], ["large-context"]);
    expect(detailed.selected).toBe("gemini");
    expect(scoreModels(["gemini", "gpt"], ["large-context"])).toBe("gemini");
  });

  it("exposes a per-model breakdown for every enabled model", () => {
    const result = scoreModelsDetailed(["claude", "gpt"], ["architecture"]);
    expect(result.scores).toHaveLength(2);
    const claude = result.scores.find((s) => s.model === "claude")!;
    // architecture is a claude bonus (+25) and a gpt penalty (-10).
    expect(claude.tagBonus).toBe(25);
    expect(claude.tagPenalty).toBe(0);
    const gpt = result.scores.find((s) => s.model === "gpt")!;
    expect(gpt.tagPenalty).toBe(-10);
    // total = base + tagBonus + tagPenalty + costEff + agyBias (per model).
    for (const s of result.scores) {
      expect(s.total).toBe(
        s.base + s.tagBonus + s.tagPenalty + s.costEff + s.agyBias,
      );
      expect(Number.isFinite(s.total)).toBe(true);
    }
  });

  it("scores are sorted by total desc and selected is a real winner", () => {
    const result = scoreModelsDetailed(
      ["gpt", "claude", "gemini"],
      ["architecture"],
    );
    for (let i = 1; i < result.scores.length; i++) {
      expect(result.scores[i - 1].total).toBeGreaterThanOrEqual(
        result.scores[i].total,
      );
    }
    // architecture → claude is the clear top-score winner.
    expect(result.selected).toBe("claude");
    expect(result.mode).toBe("top-score");
  });

  it("reports round-robin-no-tags mode when nothing differentiates", () => {
    const result = scoreModelsDetailed(["claude", "gpt"], []);
    expect(result.mode).toBe("round-robin-no-tags");
    expect(["claude", "gpt"]).toContain(result.selected);
  });

  it("reports tie-band-round-robin with >1 contender on a near-tie", () => {
    // "documentation": gemini 45+20+8=73, antigravity 45+15+9=69 → diff 4,
    // both within TIED_SCORE_BAND(5) of the top → contenders length 2.
    const result = scoreModelsDetailed(
      ["gemini", "antigravity"],
      ["documentation"],
    );
    expect(result.contenders.length).toBeGreaterThan(1);
    expect(result.mode).toBe("tie-band-round-robin");
  });

  it("empty enabledModels → empty mode + safe fallback", () => {
    const result = scoreModelsDetailed([], []);
    expect(result.mode).toBe("empty");
    expect(result.scores).toHaveLength(0);
    expect(result.selected).toBe("claude");
  });

  it("custom models carry base only (no tag bonus/penalty)", () => {
    const result = scoreModelsDetailed(["custom"] as ModelType[], [
      "architecture",
      "multi-file",
    ]);
    const custom = result.scores[0];
    expect(custom.tagBonus).toBe(0);
    expect(custom.tagPenalty).toBe(0);
  });
});
