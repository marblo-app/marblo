/**
 * End-to-end wiring proof for the KG v1 gap fix (ticket uOIWBbUU): a gh/GitHub
 * merge — captured server-side into `merge_history` (#566), NOT through the app
 * Merge button — must land in the machine-local routing graph as a positive
 * (merged) cell increment.
 *
 * This drives the SAME two units the live path chains, deterministically:
 *   merge_history snapshot
 *     → pickMergeOutcomesToForward   (renderer selection)
 *     → [IPC payload]                (kg:recordMergeOutcome bridge, elided)
 *     → GraphUpdater.recordOutcome    (main fold; ctx recovered via fetchMeta)
 *     → routing-graph.json           (numeric cell increment asserted)
 *
 * A true live probe (real app + real gh merge + Firestore) is a QA step; this is
 * the deterministic stand-in that measures the actual cell math.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { GraphUpdater } from "../../electron/graph-updater";
import {
  loadRoutingGraphFile,
  graphBiasForModel,
  type GraphContext,
} from "../../electron/routing-graph";
import { pickMergeOutcomesToForward } from "../../src/services/mergeHistoryKgForwarder";
import type { MergeHistoryEntry } from "../../src/types/mergeHistory";

describe("gh merge → routing-graph.json (KG v1 wiring)", () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "gh-merge-kg-"));
    file = path.join(dir, "routing-graph.json");
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  // The task was dispatched to claude on a complex backend agentic ticket; its
  // dispatchMeta is what the main-side fetchMeta recovers for a gh merge that
  // carries only a taskId (+ changeType fallback).
  const DISPATCH_META = {
    role: "backend",
    tags: ["agentic"],
    complexity: "complex",
    model: "claude",
  };
  const CTX: GraphContext = {
    role: "backend",
    complexity: "complex",
    tags: ["agentic"],
  };

  function ghMergeDoc(id: string, taskId: string): MergeHistoryEntry {
    return {
      id,
      projectId: "p1",
      taskId,
      repoRoot: "/repo",
      branch: "feat",
      baseRef: "main",
      headSha: `sha-${id}`,
      mode: "auto",
      mergedAt: new Date("2026-07-10T12:00:00Z"),
      changeType: "feature",
      filesChanged: 3,
      linesAdded: 40,
      linesDeleted: 5,
    };
  }

  it("folds a gh merge into a positive merged cell (empty graph → populated)", async () => {
    // Graph starts empty — exactly the bug: every merge went to gh, nothing
    // fed the local graph.
    expect(fs.existsSync(file)).toBe(false);

    const updater = new GraphUpdater({
      graphFile: file,
      fetchMeta: async () => DISPATCH_META, // stands in for tasks/{id}.dispatchMeta
    });

    const forwarded = new Set<string>();
    const [payload] = pickMergeOutcomesToForward(
      [ghMergeDoc("m1", "T-gh-1")],
      forwarded,
    );
    // Renderer selected it and would IPC this to main:
    expect(payload).toMatchObject({ taskId: "T-gh-1", changeType: "feature" });

    // Main folds it (what the kg:recordMergeOutcome handler does):
    const mode = await updater.recordOutcome({
      taskId: payload.taskId,
      rawOutcome: "merged",
      ctx: payload.changeType ? { taskType: payload.changeType } : undefined,
      atMs: payload.mergedAtMs ?? undefined,
    });
    expect(mode).toBe("merged");

    // routing-graph.json now exists and carries a positive cell for claude on
    // this context — the graph is no longer empty.
    expect(fs.existsSync(file)).toBe(true);
    const graph = loadRoutingGraphFile(file);
    const cell = graph.cells["role:backend|claude"];
    expect(cell).toBeDefined();
    expect(cell.raw.merged).toBe(1); // measured increment
    expect(cell.n).toBe(1);
    // taskType fallback cell exists too (de-identified changeType).
    expect(graph.cells["taskType:feature|claude"]).toBeDefined();
    expect(graphBiasForModel("claude", CTX, graph)).toBeGreaterThan(0);
  });

  it("re-forwarding the same gh merge on relaunch does not double-count", async () => {
    const updater = new GraphUpdater({
      graphFile: file,
      fetchMeta: async () => DISPATCH_META,
    });
    const fold = async (p: { taskId: string; changeType: string | null }) =>
      updater.recordOutcome({
        taskId: p.taskId,
        rawOutcome: "merged",
        ctx: p.changeType ? { taskType: p.changeType } : undefined,
      });

    // Session 1: forward + fold.
    const [p1] = pickMergeOutcomesToForward(
      [ghMergeDoc("m1", "T-gh-1")],
      new Set(),
    );
    await fold(p1);
    const after1 = loadRoutingGraphFile(file).cells["role:backend|claude"].n;

    // Session 2 (fresh Set = relaunch): same doc re-delivered by the snapshot.
    const [p2] = pickMergeOutcomesToForward(
      [ghMergeDoc("m1", "T-gh-1")],
      new Set(),
    );
    await fold(p2);
    const after2 = loadRoutingGraphFile(file).cells["role:backend|claude"].n;

    expect(after2).toBe(after1); // graph `seen` guard absorbed the re-delivery
    expect(after2).toBe(1);
  });
});
