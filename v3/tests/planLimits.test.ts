import { describe, it, expect } from "vitest";
import type { Agent, AgentStatus } from "../src/types/agent";
import {
  PLAN_LIMITS,
  PLAN_FEATURES,
  TEAM_SEAT_ENTITLEMENTS,
  getPlanLimits,
  getAgentLimit,
  planCanUse,
  countActiveAgents,
  checkAgentSpawn,
  checkProjectCreate,
  ProjectLimitError,
} from "../src/lib/planLimits";
import type { PlanType } from "../src/types/subscription";

// Minimal Agent factory — only `status` matters for these checks.
function agent(status: AgentStatus, id = String(idSeq++)): Agent {
  return {
    id,
    projectId: "p",
    ownerId: "u",
    name: "a",
    model: "claude" as Agent["model"],
    role: "frontend",
    status,
    currentTaskId: null,
    command: "",
    skillFile: "",
    createdAt: new Date(0),
  };
}
let idSeq = 0;

function agents(active: number, inactive = 0): Agent[] {
  return [
    ...Array.from({ length: active }, () => agent("working")),
    ...Array.from({ length: inactive }, () => agent("stopped")),
  ];
}

const ALL_PLANS: PlanType[] = [
  "free",
  "pro",
  "team",
  "team_plus",
  "enterprise",
];

describe("plan limits (single source of truth)", () => {
  it("free = 1 project / 5 agents (fair-use cap)", () => {
    expect(PLAN_LIMITS.free.maxProjects).toBe(1);
    expect(PLAN_LIMITS.free.maxAgents).toBe(5);
  });

  it("pro = unlimited projects & agents (fair use, no Pro+)", () => {
    expect(PLAN_LIMITS.pro.maxProjects).toBe(Infinity);
    expect(PLAN_LIMITS.pro.maxAgents).toBe(Infinity);
  });

  it("team / team_plus / enterprise = unlimited projects & agents", () => {
    for (const plan of ["team", "team_plus", "enterprise"] as const) {
      expect(PLAN_LIMITS[plan].maxProjects).toBe(Infinity);
      expect(PLAN_LIMITS[plan].maxAgents).toBe(Infinity);
    }
  });

  it("getPlanLimits defaults unknown plans to free", () => {
    expect(getPlanLimits("mystery")).toEqual(PLAN_LIMITS.free);
  });

  it("team seat entitlements are explicit but not enforcement code", () => {
    expect(TEAM_SEAT_ENTITLEMENTS.team).toEqual({
      includedSeats: 1,
      viewerConsumesSeat: false,
    });
    expect(TEAM_SEAT_ENTITLEMENTS.team_plus).toEqual({
      includedSeats: 5,
      viewerConsumesSeat: false,
    });
    expect(TEAM_SEAT_ENTITLEMENTS.enterprise).toEqual({
      includedSeats: Infinity,
      viewerConsumesSeat: false,
    });
  });
});

describe("getAgentLimit", () => {
  it("free = 5, all paid tiers = unlimited (-1)", () => {
    expect(getAgentLimit("free")).toBe(5);
    expect(getAgentLimit("pro")).toBe(-1);
    expect(getAgentLimit("team")).toBe(-1);
    expect(getAgentLimit("team_plus")).toBe(-1);
    expect(getAgentLimit("enterprise")).toBe(-1);
  });

  it("unknown plans default to Free (restrictive)", () => {
    expect(getAgentLimit("nope")).toBe(5);
  });
});

describe("countActiveAgents", () => {
  it("counts only idle/working", () => {
    expect(
      countActiveAgents([
        agent("idle"),
        agent("working"),
        agent("error"),
        agent("stopped"),
      ]),
    ).toBe(2);
  });
});

describe("checkAgentSpawn", () => {
  it("free allows up to 5 then blocks (fair-use)", () => {
    expect(checkAgentSpawn("free", agents(4)).allowed).toBe(true);
    const blocked = checkAgentSpawn("free", agents(5));
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(5);
    expect(blocked.reason).toContain("무제한"); // pro upsell = unlimited
  });

  it("pro is unlimited (never blocks)", () => {
    expect(checkAgentSpawn("pro", agents(50)).allowed).toBe(true);
  });

  it("team is unlimited", () => {
    expect(checkAgentSpawn("team", agents(100)).allowed).toBe(true);
  });

  it("inactive agents do not consume slots", () => {
    expect(checkAgentSpawn("free", agents(4, 20)).allowed).toBe(true);
    expect(checkAgentSpawn("free", agents(5, 20)).allowed).toBe(false);
  });
});

describe("checkProjectCreate", () => {
  it("free allows the first project, blocks the second", () => {
    expect(checkProjectCreate("free", 0).allowed).toBe(true);
    const blocked = checkProjectCreate("free", 1);
    expect(blocked.allowed).toBe(false);
    expect(blocked.limit).toBe(1);
    expect(blocked.current).toBe(1);
    expect(blocked.reason).toBeTruthy();
  });

  it("pro / team allow unlimited projects", () => {
    expect(checkProjectCreate("pro", 100).allowed).toBe(true);
    expect(checkProjectCreate("team", 999).allowed).toBe(true);
  });

  it("unknown plans default to Free (restrictive)", () => {
    expect(checkProjectCreate("mystery", 0).allowed).toBe(true);
    expect(checkProjectCreate("mystery", 5).allowed).toBe(false);
  });
});

describe("ProjectLimitError", () => {
  it("carries the check and a message", () => {
    const check = checkProjectCreate("free", 1);
    const err = new ProjectLimitError(check);
    expect(err.name).toBe("ProjectLimitError");
    expect(err.check).toBe(check);
    expect(err.message).toBe(check.reason);
    expect(err instanceof Error).toBe(true);
  });
});

describe("PLAN_FEATURES (feature matrix single source)", () => {
  it("every tier can use the core surfaces + agents + activity_timeline", () => {
    for (const plan of ALL_PLANS) {
      for (const f of [
        "board",
        "terminal",
        "editor",
        "agents",
        "activity_timeline",
      ]) {
        expect(planCanUse(plan, f)).toBe(true);
      }
    }
  });

  it("free excludes paid features", () => {
    for (const f of [
      "flows",
      "missions",
      "orchestrator",
      "unlimited_projects",
      "team_members",
      "audit_logs",
    ]) {
      expect(planCanUse("free", f)).toBe(false);
    }
  });

  it("unlimited_projects unlocked from pro up (matches maxProjects)", () => {
    expect(planCanUse("free", "unlimited_projects")).toBe(false);
    for (const plan of ["pro", "team", "team_plus", "enterprise"] as const) {
      expect(planCanUse(plan, "unlimited_projects")).toBe(true);
    }
  });

  it("audit_logs (timeline retention/export) is Team Plus+ only", () => {
    expect(planCanUse("free", "audit_logs")).toBe(false);
    expect(planCanUse("pro", "audit_logs")).toBe(false);
    expect(planCanUse("team", "audit_logs")).toBe(false);
    expect(planCanUse("team_plus", "audit_logs")).toBe(true);
    expect(planCanUse("enterprise", "audit_logs")).toBe(true);
  });

  it("PLAN_FEATURES ↔ PlanLimits booleans stay consistent", () => {
    for (const plan of ALL_PLANS) {
      expect(PLAN_FEATURES[plan].has("flows")).toBe(
        PLAN_LIMITS[plan].hasFlowEditor,
      );
      expect(PLAN_FEATURES[plan].has("unlimited_projects")).toBe(
        PLAN_LIMITS[plan].maxProjects === Infinity,
      );
    }
  });

  it("unknown plans fall back to the Free feature set", () => {
    expect(planCanUse("mystery", "agents")).toBe(true);
    expect(planCanUse("mystery", "flows")).toBe(false);
  });
});
