// v3/tests/unit/task-decomposer-cycle.test.ts
//
// Regression coverage for the cycle-safe DAG construction in task-decomposer.
// Before the fix, decompose() could return a cyclic DAG (fall-through branch)
// or return a "fixed" DAG without re-verifying it was acyclic. buildAcyclicDAG
// now GUARANTEES the returned graph is acyclic, or rejects with a clear error.
import { describe, expect, it } from "vitest";
import { buildAcyclicDAG } from "../../electron/orchestrator/task-decomposer";
import {
  DAGGenerator,
  type DAG,
  type DecomposedTask,
} from "../../electron/orchestrator/dag-generator";

function task(title: string, depends_on: string[] = []): DecomposedTask {
  return {
    title,
    description: "",
    changes: [],
    acceptance: [],
    notes: [],
    role: "backend",
    priority: 3,
    depends_on,
    scope: [],
    estimatedHours: 1,
  };
}

const gen = new DAGGenerator();

/** A DAG is valid iff it has no cycles and can be topologically sorted. */
function expectAcyclic(dag: DAG): void {
  expect(gen.detectCycles(dag)).toBeNull();
  expect(() => gen.topologicalSort(dag)).not.toThrow();
}

describe("buildAcyclicDAG — valid (acyclic) input passes through unchanged", () => {
  it("returns the same edges for an already-acyclic graph", () => {
    const tasks = [
      task("A"),
      task("B", ["TASK-001"]),
      task("C", ["TASK-001", "TASK-002"]),
    ];
    const dag = buildAcyclicDAG(tasks, gen);

    expectAcyclic(dag);
    expect(dag.nodes).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
    // No cycle ⇒ nothing is dropped from depends_on.
    expect(tasks[2].depends_on).toEqual(["TASK-001", "TASK-002"]);
    expect(dag.edges).toEqual([
      ["TASK-001", "TASK-002"],
      ["TASK-001", "TASK-003"],
      ["TASK-002", "TASK-003"],
    ]);
  });

  it("accepts an empty task list", () => {
    const dag = buildAcyclicDAG([], gen);
    expect(dag.nodes).toEqual([]);
    expect(dag.edges).toEqual([]);
    expectAcyclic(dag);
  });
});

describe("buildAcyclicDAG — cyclic input is broken into a valid DAG", () => {
  it("breaks a 2-node cycle (A↔B) and returns an acyclic DAG", () => {
    // A depends on B, B depends on A.
    const tasks = [task("A", ["TASK-002"]), task("B", ["TASK-001"])];
    const dag = buildAcyclicDAG(tasks, gen);

    expectAcyclic(dag);
    expect(dag.nodes).toEqual(["TASK-001", "TASK-002"]);
    // Exactly one of the two back-references must have been dropped.
    const remainingDeps =
      tasks[0].depends_on.length + tasks[1].depends_on.length;
    expect(remainingDeps).toBe(1);
  });

  it("breaks a 3-node cycle (A→B→C→A) and returns an acyclic DAG", () => {
    const tasks = [
      task("A", ["TASK-003"]),
      task("B", ["TASK-001"]),
      task("C", ["TASK-002"]),
    ];
    const dag = buildAcyclicDAG(tasks, gen);

    expectAcyclic(dag);
    expect(dag.nodes).toEqual(["TASK-001", "TASK-002", "TASK-003"]);
  });

  it("preserves unrelated valid edges while breaking the cycle", () => {
    // A↔B is a cycle; C→B (C depends on B) is a legitimate edge that survives.
    const tasks = [
      task("A", ["TASK-002"]),
      task("B", ["TASK-001"]),
      task("C", ["TASK-002"]),
    ];
    const dag = buildAcyclicDAG(tasks, gen);

    expectAcyclic(dag);
    // The legitimate dependency C → depends on B must survive.
    expect(tasks[2].depends_on).toEqual(["TASK-002"]);
    expect(dag.edges).toContainEqual(["TASK-002", "TASK-003"]);
  });

  it("handles multiple independent cycles in one pass", () => {
    // Cycle 1: TASK-001 ↔ TASK-002.  Cycle 2: TASK-003 ↔ TASK-004.
    const tasks = [
      task("A", ["TASK-002"]),
      task("B", ["TASK-001"]),
      task("C", ["TASK-004"]),
      task("D", ["TASK-003"]),
    ];
    const dag = buildAcyclicDAG(tasks, gen);
    expectAcyclic(dag);
  });
});

describe("buildAcyclicDAG — rejects when a cycle cannot be broken", () => {
  it("throws when the breaker makes no progress (unbreakable cycle)", () => {
    // Fake generator that reports a degenerate (length-1) cycle which the
    // edge-remover cannot act on → no progress → explicit rejection.
    const unbreakable = {
      buildDAG: () => ({ nodes: ["TASK-001"], edges: [], labels: {} }),
      detectCycles: () => [["TASK-001"]],
    } as unknown as DAGGenerator;

    expect(() => buildAcyclicDAG([task("A")], unbreakable)).toThrow(
      /unbreakable cycle/i,
    );
  });

  it("throws when the graph stays cyclic despite edge removals (budget exhausted)", () => {
    // Fake generator that always reports a breakable-looking cycle but never
    // actually changes the graph → loop hits its budget → loud rejection
    // instead of returning a deadlock-prone DAG or spinning forever.
    const stuck = {
      buildDAG: () => ({
        nodes: ["TASK-001", "TASK-002"],
        edges: [
          ["TASK-001", "TASK-002"],
          ["TASK-002", "TASK-001"],
        ] as [string, string][],
        labels: {},
      }),
      detectCycles: () => [["TASK-001", "TASK-002", "TASK-001"]],
    } as unknown as DAGGenerator;

    expect(() =>
      buildAcyclicDAG(
        [task("A", ["TASK-002"]), task("B", ["TASK-001"])],
        stuck,
      ),
    ).toThrow(/still contains cycles/i);
  });
});
