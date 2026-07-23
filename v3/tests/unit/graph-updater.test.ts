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

  it("logs the drop reason before dropping an unattributable outcome", async () => {
    const drops: string[] = [];
    const u = new GraphUpdater({
      graphFile: file,
      now: () => clock,
      onDrop: (info) => drops.push(`${info.mode}:${info.reason}`),
    });
    // No model → the graph can't attribute the crash → dropped WITH a reason.
    await u.recordOutcome({ taskId: "T1", rawOutcome: "crashed", ctx: CTX });
    expect(drops.length).toBe(1);
    expect(drops[0]).toContain("crash"); // mode is crash_loop/crashed
    expect(drops[0]).toContain("unresolved model");

    // Has a model but no context factor → dropped for the OTHER reason.
    await u.recordOutcome({
      taskId: "T2",
      model: "antigravity",
      rawOutcome: "crashed",
      ctx: {},
    });
    expect(drops.length).toBe(2);
    expect(drops[1]).toContain("no attributable context factor");
  });

  it("folds a negative outcome that has NO taskId (role+model only)", async () => {
    // Gap 1: a crash between tasks arrives with a null taskId. Before the fix
    // the call site skipped it entirely; now role+model is enough to record a
    // negative into the role cell, and agentId still seeds idempotency.
    const u = updater();
    for (let i = 0; i < 5; i++) {
      clock += 24 * 60 * 60 * 1000;
      await u.recordOutcome({
        taskId: null,
        agentId: `agy-crash-${i}`,
        model: "antigravity",
        rawOutcome: "crashed",
        ctx: { role: "backend" },
      });
    }
    const graph = loadRoutingGraphFile(file);
    expect(graph.cells["role:backend|antigravity"]).toBeDefined();
    expect(
      graphBiasForModel("antigravity", { role: "backend" }, graph),
    ).toBeLessThan(0);
  });

  it("is idempotent on (null-taskId, agentId, mode) via the agentId key", async () => {
    const u = updater();
    const ev = {
      taskId: null,
      agentId: "agy-1",
      model: "antigravity" as const,
      rawOutcome: "crashed" as const,
      ctx: { role: "backend" },
    };
    await u.recordOutcome({ ...ev });
    const once = graphBiasForModel(
      "antigravity",
      { role: "backend" },
      loadRoutingGraphFile(file),
    );
    await u.recordOutcome({ ...ev }); // re-delivered
    const twice = graphBiasForModel(
      "antigravity",
      { role: "backend" },
      loadRoutingGraphFile(file),
    );
    expect(twice).toBe(once);
  });

  // gh + app merges both feed the graph via merge_history; the renderer
  // re-forwards every historical merge on each launch. The `seen` guard makes
  // those re-deliveries no-ops — this asserts they also skip the disk write, so
  // backfill re-delivery can't spam N rewrites of an unchanged file every boot.
  // Detect writes via mtime: stamp the file to a distinct past time, then any
  // real save (writeFileSync+rename → mtime≈now) is unambiguously detectable,
  // independent of timer resolution. Spying on the ESM `fs` export isn't
  // possible (namespace is frozen), so we observe the side effect instead.
  const PAST = new Date("2000-01-01T00:00:00Z");
  const stampPast = () => {
    fs.utimesSync(file, PAST, PAST);
    return fs.statSync(file).mtimeMs;
  };

  it("skips the disk write when re-delivering an already-folded merge", async () => {
    const u = updater();
    const merge = {
      taskId: "M1",
      model: "antigravity",
      rawOutcome: "merged" as const,
      ctx: CTX,
    };
    await u.recordOutcome({ ...merge }); // first fold → writes
    const before = fs.readFileSync(file, "utf-8");
    const pastMs = stampPast();

    await u.recordOutcome({ ...merge }); // re-delivered (relaunch backfill)
    await u.recordOutcome({ ...merge }); // and again
    // mtime unchanged → no rewrite; content byte-identical → counted once.
    expect(fs.statSync(file).mtimeMs).toBe(pastMs);
    expect(fs.readFileSync(file, "utf-8")).toBe(before);
  });

  it("still writes a genuinely new merge (skip is idempotency-gated, not blanket)", async () => {
    const u = updater();
    await u.recordOutcome({
      taskId: "M1",
      model: "antigravity",
      rawOutcome: "merged",
      ctx: CTX,
    });
    const pastMs = stampPast();
    await u.recordOutcome({
      taskId: "M2", // different task → not yet seen → must persist
      model: "antigravity",
      rawOutcome: "merged",
      ctx: CTX,
    });
    expect(fs.statSync(file).mtimeMs).toBeGreaterThan(pastMs);
  });
});
