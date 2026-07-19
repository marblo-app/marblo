/**
 * Governance decision B (ticket IuucvLemDFvbh4UYmL1o) — project_id must be
 * honored, and a cross-project value must be refused loudly rather than
 * silently answered for the bound project.
 *
 * Before this, resolveProject() ignored the argument entirely: three different
 * project_id values returned three identical result sets, and the orchestrator
 * constitution's "verify the returned project matches" step was checking a
 * guarantee the code never made.
 */
import { describe, it, expect } from "vitest";
import { checkProjectLock } from "../../electron/mcp-server/project-resolve";

const BOUND = "GFB8JnJrrX6AgahqmGB3xx"; // bound session project
const OTHER = "AbcdefGhijklmno1234567"; // a different project

describe("checkProjectLock — the argument is actually used", () => {
  it("honors an explicit id equal to the bound project", () => {
    expect(
      checkProjectLock({
        explicit: BOUND,
        bound: BOUND,
        toolName: "get_all_tasks",
      }),
    ).toEqual({ ok: true, projectId: BOUND });
  });

  it("REFUSES a different project instead of silently returning the bound one", () => {
    const out = checkProjectLock({
      explicit: OTHER,
      bound: BOUND,
      toolName: "get_all_tasks",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toBe("mismatch");
    // The old bug: a mismatch produced BOUND's data with no signal at all.
    expect(out).not.toHaveProperty("projectId");
  });

  it("falls back to the bound project only when no argument is given", () => {
    expect(checkProjectLock({ bound: BOUND, toolName: "get_flows" })).toEqual({
      ok: true,
      projectId: BOUND,
    });
    expect(
      checkProjectLock({ explicit: "  ", bound: BOUND, toolName: "get_flows" }),
    ).toEqual({ ok: true, projectId: BOUND });
  });

  it("trims before comparing so whitespace is not a false mismatch", () => {
    expect(
      checkProjectLock({
        explicit: `  ${BOUND} `,
        bound: BOUND,
        toolName: "search_tasks",
      }),
    ).toEqual({ ok: true, projectId: BOUND });
  });
});

describe("checkProjectLock — friendly names", () => {
  it("accepts a name that resolves to the bound project", () => {
    expect(
      checkProjectLock({
        explicit: "마블로",
        bound: BOUND,
        nameResolvedTo: BOUND,
        toolName: "search_tasks",
      }),
    ).toEqual({ ok: true, projectId: BOUND });
  });

  it("refuses a name that resolves to a different project", () => {
    const out = checkProjectLock({
      explicit: "stockai-platform",
      bound: BOUND,
      nameResolvedTo: OTHER,
      toolName: "search_tasks",
    });
    expect(out.ok).toBe(false);
    if (out.ok) throw new Error("unreachable");
    expect(out.reason).toBe("mismatch");
    // Names both what was asked for and what it resolved to.
    expect(out.message).toContain("stockai-platform");
    expect(out.message).toContain(OTHER);
  });

  it("refuses an unresolvable name rather than falling through to the default", () => {
    for (const nameResolvedTo of [null, undefined, ""]) {
      const out = checkProjectLock({
        explicit: "typo-project",
        bound: BOUND,
        nameResolvedTo,
        toolName: "get_all_tasks",
      });
      expect(out.ok).toBe(false);
      if (out.ok) throw new Error("unreachable");
      expect(out.reason).toBe("unresolvable");
    }
  });
});

describe("checkProjectLock — unbound sessions", () => {
  it("honors an explicit id when there is no bound project to lock against", () => {
    expect(
      checkProjectLock({ explicit: OTHER, bound: "", toolName: "get_flows" }),
    ).toEqual({ ok: true, projectId: OTHER });
  });

  it("returns an empty project when neither side supplies one", () => {
    expect(checkProjectLock({ bound: "", toolName: "get_flows" })).toEqual({
      ok: true,
      projectId: "",
    });
  });
});

describe("refusal messages are actionable", () => {
  const out = checkProjectLock({
    explicit: OTHER,
    bound: BOUND,
    toolName: "get_all_tasks",
  });

  it("names the requested project, the session project, and the tool", () => {
    if (out.ok) throw new Error("expected a refusal");
    expect(out.message).toContain(OTHER);
    expect(out.message).toContain(BOUND);
    expect(out.message).toContain("get_all_tasks");
  });

  it("tells the operator what to do next, not just what failed", () => {
    if (out.ok) throw new Error("expected a refusal");
    expect(out.message).toContain("해야 할 일");
    expect(out.message).toMatch(/오케스트레이터에서 실행/);
    expect(out.message).toMatch(/project_id 를 생략/);
  });
});
