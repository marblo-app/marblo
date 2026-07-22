import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphUpdater, normalizeOutcome } from "../../electron/graph-updater";
import {
  loadRoutingGraphFile,
  graphBiasForModel,
  type GraphContext,
} from "../../electron/routing-graph";

describe("normalizeOutcome (raw lifecycle → §3 taxonomy)", () => {
  it("maps stale variants to no_activity_stale", () => {
    expect(normalizeOutcome("stale")).toBe("no_activity_stale");
    expect(normalizeOutcome("went_stale")).toBe("no_activity_stale");
  });

  it("classifies crash by hints: fast_fail_config → host spawn_failed", () => {
    expect(
      normalizeOutcome("crashed", { errorCategory: "fast_fail_config" }),
    ).toBe("spawn_failed");
  });

  it("runtime_crash / high restartCount → crash_loop, else crashed", () => {
    expect(
      normalizeOutcome("crashed", { errorCategory: "runtime_crash" }),
    ).toBe("crash_loop");
    expect(normalizeOutcome("crashed", { restartCount: 5 })).toBe("crash_loop");
    expect(normalizeOutcome("crashed", { restartCount: 1 })).toBe("crashed");
    expect(normalizeOutcome("crashed")).toBe("crashed");
  });

  it("passes through success + explicit modes; unknown → null", () => {
    expect(normalizeOutcome("merged")).toBe("merged");
    expect(normalizeOutcome("completed")).toBe("completed");
    expect(normalizeOutcome("blocked")).toBe("blocked");
    expect(normalizeOutcome("dependency_stuck")).toBe("dependency_stuck");
    expect(normalizeOutcome("something_else")).toBeNull();
  });
});

describe("GraphUpdater.recordOutcome (write path)", () => {
  let dir: string;
  let file: string;
  let clock: number;
  const CTX: GraphContext = {
    role: "backend",
    complexity: "complex",
    tags: ["agentic"],
  };

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "graph-updater-"));
    file = path.join(dir, "routing-graph.json");
    clock = Date.parse("2026-07-01T00:00:00Z");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  function updater() {
    return new GraphUpdater({ graphFile: file, now: () => clock });
  }

  it("persists a stale outcome and produces a negative bias for that context", async () => {
    const u = updater();
    for (let i = 0; i < 5; i++) {
      clock += 24 * 60 * 60 * 1000;
      await u.recordOutcome({
        taskId: `T-${i}`,
        agentId: `agy-${i}`,
        model: "antigravity",
        rawOutcome: "stale",
        ctx: CTX,
      });
    }
    const graph = loadRoutingGraphFile(file);
    expect(graphBiasForModel("antigravity", CTX, graph)).toBeLessThan(0);
    // A different model in the same context is untouched.
    expect(graphBiasForModel("claude", CTX, graph)).toBe(0);
  });

  it("is idempotent across a re-delivered (task, agent, mode)", async () => {
    const u = updater();
    await u.recordOutcome({
      taskId: "T1",
      agentId: "a1",
      model: "antigravity",
      rawOutcome: "stale",
      ctx: CTX,
    });
    const once = graphBiasForModel(
      "antigravity",
      CTX,
      loadRoutingGraphFile(file),
    );
    // Same event again (retry / re-read).
    await u.recordOutcome({
      taskId: "T1",
      agentId: "a1",
      model: "antigravity",
      rawOutcome: "stale",
      ctx: CTX,
    });
    const twice = graphBiasForModel(
      "antigravity",
      CTX,
      loadRoutingGraphFile(file),
    );
    expect(twice).toBe(once);
  });

  it("dependency_stuck writes an audit count but 0 routing bias", async () => {
    const u = updater();
    for (let i = 0; i < 6; i++) {
      await u.recordOutcome({
        taskId: `dep-${i}`,
        agentId: `a-${i}`,
        model: "antigravity",
        rawOutcome: "dependency_stuck",
        ctx: CTX,
      });
    }
    const graph = loadRoutingGraphFile(file);
    expect(graphBiasForModel("antigravity", CTX, graph)).toBe(0);
    expect(
      graph.cells["complexity:complex|antigravity"].raw.dependency_stuck,
    ).toBe(6);
  });

  it("backfills missing ctx fields + model from fetchMeta", async () => {
    const u = new GraphUpdater({
      graphFile: file,
      now: () => clock,
      fetchMeta: async () => ({
        role: "backend",
        tags: ["agentic", "autonomous"],
        complexity: "complex",
        model: "agy", // raw alias → normalizeModel → antigravity
      }),
    });
    // Only a partial ctx (taskType) supplied; the rest comes from meta.
    await u.recordOutcome({
      taskId: "T1",
      agentId: "a1",
      rawOutcome: "merged",
      ctx: { taskType: "feature" },
    });
    const graph = loadRoutingGraphFile(file);
    // Cells for role/tags/complexity/taskType under antigravity all exist.
    expect(graph.cells["role:backend|antigravity"]).toBeDefined();
    expect(graph.cells["tag:autonomous|antigravity"]).toBeDefined();
    expect(graph.cells["taskType:feature|antigravity"]).toBeDefined();
    // merged is a positive signal.
    expect(
      graphBiasForModel(
        "antigravity",
        { role: "backend", complexity: "complex", tags: ["agentic"] },
        graph,
      ),
    ).toBeGreaterThan(0);
  });

  it("drops an unattributable outcome (no model) without writing", async () => {
    const u = updater();
    const applied = await u.recordOutcome({
      taskId: "T1",
      rawOutcome: "stale",
      ctx: CTX,
      // no model, no fetchMeta
    });
    expect(applied).toBeNull();
    expect(fs.existsSync(file)).toBe(false);
  });
});
