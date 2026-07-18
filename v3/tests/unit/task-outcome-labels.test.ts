/**
 * Regression tests for the SLM label "faucet" — the outcome-recording path
 * that was emitting constants instead of labels.
 *
 * Reference: docs/research/routing-slm-data-collection.md §3 (defects A/B/C)
 * and §7.5 (the go/no-go checklist these tests encode).
 *
 * What is real here and what is not: the label logic under test
 * (classifyTaskType, buildTaskOutcome, observeTaskSnapshot, reportTaskOutcome,
 * taskRollups) runs for real, against the in-memory firebase/firestore mock
 * whose transaction + increment semantics match the SDK. Only the outermost
 * boundaries are stubbed — the Cloud Function callable and the Firebase app
 * handles. Hand-faking the reporter itself would prove nothing: the whole bug
 * class here is "the code that writes labels never runs".
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Task } from "../../src/types/task";

/** Captures every payload handed to the logTaskOutcome callable. */
const sentOutcomes: Array<Record<string, unknown>> = [];

vi.mock("../../src/lib/firebase", () => ({
  db: { type: "mock-db" },
  functions: { type: "mock-functions" },
  auth: { currentUser: { uid: "test-uid" } },
}));

vi.mock("firebase/functions", () => ({
  getFunctions: () => ({ type: "mock-functions" }),
  httpsCallable: (_fns: unknown, name: string) => {
    return async (payload: Record<string, unknown>) => {
      if (name === "logTaskOutcome") {
        sentOutcomes.push(
          (payload as { outcome: Record<string, unknown> }).outcome,
        );
      }
      return { data: { inserted: 1 } };
    };
  },
}));

import { classifyTaskType } from "../../src/lib/telemetry/taskType";
import { buildTaskOutcome } from "../../src/lib/telemetry/taskOutcome";
import {
  observeTaskSnapshot,
  resetTaskOutcomeObserver,
} from "../../src/services/taskOutcomeReporter";
import {
  recordTaskCost,
  recordTaskRetry,
  flushTaskRollups,
  __resetTaskRollupsForTest,
} from "../../src/services/taskRollups";
import { setDoc, getDoc, doc, __resetStore } from "../mocks/firebase-firestore";

const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    projectId: "proj-1",
    contextId: "board",
    title: "Add dark mode toggle",
    description: "",
    status: "IN_PROGRESS",
    role: "frontend",
    priority: 3,
    dependsOn: [],
    dependsOnCompleted: true,
    claimedBy: "agent-1",
    claimedAt: new Date("2026-07-18T10:00:00.000Z"),
    scope: ["src/a.ts", "src/b.ts"],
    comment: "",
    prUrl: "",
    hasPmFeedback: false,
    createdAt: new Date("2026-07-18T09:00:00.000Z"),
    updatedAt: NOW,
    ...overrides,
  } as Task;
}

/** Seed the doc the reporter reads back for rollups. */
async function seedTaskDoc(id: string, fields: Record<string, unknown> = {}) {
  await setDoc(doc(null, "tasks", id) as never, {
    projectId: "proj-1",
    ...fields,
  });
}

/** Let queued promise chains in the fire-and-forget reporter settle. */
async function settle() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
  await new Promise((r) => setTimeout(r, 0));
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

beforeEach(() => {
  sentOutcomes.length = 0;
  __resetStore();
  __resetTaskRollupsForTest();
  resetTaskOutcomeObserver();
});

// ── Defect ④ — taskType was hardcoded null ────────────────────────────────
describe("classifyTaskType (defect ④: taskType was hardcoded NULL)", () => {
  it("classifies English intent keywords", () => {
    expect(classifyTaskType({ title: "Fix crash on startup" })).toBe("bug-fix");
    expect(classifyTaskType({ title: "Add dark mode toggle" })).toBe("feature");
    expect(classifyTaskType({ title: "Refactor the auth module" })).toBe(
      "refactor",
    );
    expect(classifyTaskType({ title: "Update README" })).toBe("docs");
    expect(classifyTaskType({ title: "Add e2e test coverage" })).toBe("test");
  });

  it("classifies Korean tickets — the real corpus is mostly Korean", () => {
    expect(classifyTaskType({ title: "로그인 버그 수정" })).toBe("bug-fix");
    expect(classifyTaskType({ title: "결제 기능 추가" })).toBe("feature");
    expect(classifyTaskType({ title: "오케스트레이터 리팩토링" })).toBe(
      "refactor",
    );
    expect(classifyTaskType({ title: "배포 파이프라인 구성" })).toBe("infra");
  });

  it("trusts a conventional-commit prefix over body keywords", () => {
    // Would otherwise classify as "docs" from the body.
    expect(classifyTaskType({ title: "fix(v3): 문서 링크 오타" })).toBe(
      "bug-fix",
    );
    expect(classifyTaskType({ title: "feat: 새 대시보드" })).toBe("feature");
  });

  it("prefers bug-fix when a ticket mentions both a bug and its area", () => {
    // Ordering guarantee: a broken test is a bug-fix, not a test task.
    expect(classifyTaskType({ title: "테스트가 깨짐 — 수정 필요" })).toBe(
      "bug-fix",
    );
  });

  it("returns null rather than guessing on signal-free titles", () => {
    // A wrong label is worse than no label: it silently poisons training.
    expect(classifyTaskType({ title: "TASK-1234" })).toBeNull();
    expect(classifyTaskType({ title: "" })).toBeNull();
    expect(classifyTaskType({})).toBeNull();
  });

  it("falls back to goal/description when the title is an opaque id", () => {
    expect(
      classifyTaskType({ title: "TASK-99", goal: "결제 실패 버그를 고친다" }),
    ).toBe("bug-fix");
  });
});

// ── Defect ① — success was a constant ─────────────────────────────────────
describe("buildTaskOutcome (defect ①: success was constant TRUE)", () => {
  const base = {
    clientId: "client-1",
    taskId: "task-1",
    task: makeTask(),
    now: NOW,
  };

  it("labels DONE positive and FAILED/BLOCKED negative", () => {
    expect(buildTaskOutcome({ ...base, status: "DONE" }).success).toBe(true);
    expect(buildTaskOutcome({ ...base, status: "FAILED" }).success).toBe(false);
    expect(buildTaskOutcome({ ...base, status: "BLOCKED" }).success).toBe(
      false,
    );
  });

  it("records the terminal status in errorCategory so FAILED and BLOCKED stay separable", () => {
    expect(buildTaskOutcome({ ...base, status: "FAILED" }).errorCategory).toBe(
      "FAILED",
    );
    expect(buildTaskOutcome({ ...base, status: "BLOCKED" }).errorCategory).toBe(
      "BLOCKED",
    );
    // Clean axis: a success carries no error reason.
    expect(buildTaskOutcome({ ...base, status: "DONE" }).errorCategory).toBe(
      null,
    );
  });
});

// ── Defect ② / ③ — cost and retries ───────────────────────────────────────
describe("buildTaskOutcome (defects ②/③: cost and retries)", () => {
  const base = {
    clientId: "client-1",
    taskId: "task-1",
    status: "DONE" as const,
    task: makeTask(),
    now: NOW,
  };

  it("uses per-task rollups, not the agent's lifetime totals", () => {
    const row = buildTaskOutcome({
      ...base,
      rollups: {
        costTotal: 1.25,
        costInputTokens: 4000,
        costOutputTokens: 900,
        retriesCount: 2,
      },
      // The agent doc carries a much larger lifetime total; it must not leak in.
      agent: { detectedModelId: "claude-opus-4-8" },
    });
    expect(row.totalCost).toBe(1.25);
    expect(row.totalInputTokens).toBe(4000);
    expect(row.totalOutputTokens).toBe(900);
    expect(row.retriesCount).toBe(2);
    expect(row.model).toBe("claude-opus-4-8");
  });

  it("reports null cost — never 0 — when nothing was attributed", () => {
    // 0 and "unknown" are different training signals; the old code conflated
    // them, which is how 29/29 rows read as zero-cost.
    const row = buildTaskOutcome(base);
    expect(row.totalCost).toBeNull();
    expect(row.retriesCount).toBe(0);
  });

  it("rejects corrupt counters instead of shipping NaN to BigQuery", () => {
    const row = buildTaskOutcome({
      ...base,
      rollups: { costTotal: NaN, costInputTokens: -5, retriesCount: Infinity },
    });
    expect(row.totalCost).toBeNull();
    expect(row.totalInputTokens).toBeNull();
    expect(row.retriesCount).toBe(0);
  });

  it("prefers the versioned model id over the family enum", () => {
    expect(
      buildTaskOutcome({
        ...base,
        agent: { model: "claude", detectedModelId: "claude-opus-4-8" },
      }).model,
    ).toBe("claude-opus-4-8");
    expect(
      buildTaskOutcome({ ...base, agent: { model: "claude" } }).model,
    ).toBe("claude");
  });

  it("derives duration from claimedAt and tolerates an unclaimed task", () => {
    expect(buildTaskOutcome(base).durationMs).toBe(2 * 60 * 60 * 1000);
    expect(
      buildTaskOutcome({ ...base, task: makeTask({ claimedAt: null }) })
        .durationMs,
    ).toBeNull();
  });
});

// ── Per-task rollups accumulate for real ──────────────────────────────────
describe("taskRollups", () => {
  it("accumulates buffered cost deltas into one atomic increment", async () => {
    await seedTaskDoc("task-1");
    recordTaskCost("task-1", { cost: 0.5, inputTokens: 100, outputTokens: 20 });
    recordTaskCost("task-1", { cost: 0.25, inputTokens: 50, outputTokens: 10 });
    await flushTaskRollups("task-1");

    const snap = await getDoc(doc(null, "tasks", "task-1") as never);
    expect(snap.data()).toMatchObject({
      costTotal: 0.75,
      costInputTokens: 150,
      costOutputTokens: 30,
    });
  });

  it("does not double-count across successive flushes", async () => {
    await seedTaskDoc("task-1");
    recordTaskCost("task-1", { cost: 1 });
    await flushTaskRollups("task-1");
    await flushTaskRollups("task-1"); // buffer already drained
    recordTaskCost("task-1", { cost: 2 });
    await flushTaskRollups("task-1");

    const snap = await getDoc(doc(null, "tasks", "task-1") as never);
    expect((snap.data() as { costTotal: number }).costTotal).toBe(3);
  });

  it("increments the retry counter per restart", async () => {
    await seedTaskDoc("task-1");
    await recordTaskRetry("task-1");
    await recordTaskRetry("task-1");

    const snap = await getDoc(doc(null, "tasks", "task-1") as never);
    expect((snap.data() as { retriesCount: number }).retriesCount).toBe(2);
  });

  it("survives a missing task doc without throwing", async () => {
    recordTaskCost("ghost-task", { cost: 1 });
    await expect(flushTaskRollups("ghost-task")).resolves.toBeUndefined();
    await expect(recordTaskRetry("ghost-task")).resolves.toBeUndefined();
  });
});

// ── The choke point: transitions, backfill, dedup ─────────────────────────
describe("observeTaskSnapshot (the MCP-path gap)", () => {
  it("reports nothing on the first snapshot — no historical backfill", async () => {
    await seedTaskDoc("task-1");
    // Every task in a mature project is already terminal on subscribe. If the
    // first snapshot reported, upgrading would flood BigQuery with retroactive
    // rows carrying no cost.
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();
    expect(sentOutcomes).toHaveLength(0);
  });

  it("reports on an observed transition into a terminal status", async () => {
    await seedTaskDoc("task-1", { costTotal: 2.5, retriesCount: 1 });
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();

    expect(sentOutcomes).toHaveLength(1);
    expect(sentOutcomes[0]).toMatchObject({
      taskId: "task-1",
      success: true,
      taskType: "feature",
      totalCost: 2.5,
      retriesCount: 1,
      role: "frontend",
      scopeFileCount: 2,
    });
  });

  it("reports FAILED as a negative label — the class that did not exist", async () => {
    await seedTaskDoc("task-1");
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "FAILED" })]);
    await settle();

    expect(sentOutcomes).toHaveLength(1);
    expect(sentOutcomes[0]).toMatchObject({
      success: false,
      errorCategory: "FAILED",
    });
  });

  it("ignores non-terminal transitions", async () => {
    await seedTaskDoc("task-1");
    observeTaskSnapshot([makeTask({ status: "TODO" })]);
    observeTaskSnapshot([makeTask({ status: "CLAIMED" })]);
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "REVIEW" })]);
    await settle();
    expect(sentOutcomes).toHaveLength(0);
  });

  it("emits once when the same terminal status is re-observed", async () => {
    await seedTaskDoc("task-1");
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();
    // A later snapshot (e.g. triggered by the marker write itself) must not
    // duplicate the row.
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();
    expect(sentOutcomes).toHaveLength(1);
  });

  it("dedups across concurrent observers via the Firestore claim", async () => {
    await seedTaskDoc("task-1");
    // Two windows subscribed to the same project both see the transition.
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    resetTaskOutcomeObserver();
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);

    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();
    resetTaskOutcomeObserver();
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();

    expect(sentOutcomes).toHaveLength(1);
  });

  it("still records the final outcome after a BLOCKED detour", async () => {
    await seedTaskDoc("task-1");
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "BLOCKED" })]);
    await settle();
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();

    // Two rows, and the latest is authoritative — the documented read rule.
    expect(sentOutcomes).toHaveLength(2);
    expect(sentOutcomes[0]).toMatchObject({
      success: false,
      errorCategory: "BLOCKED",
    });
    expect(sentOutcomes[1]).toMatchObject({
      success: true,
      errorCategory: null,
    });
  });

  it("flushes buffered cost before building the row", async () => {
    await seedTaskDoc("task-1");
    observeTaskSnapshot([makeTask({ status: "IN_PROGRESS" })]);
    // Delta arrives moments before completion — inside the 15s buffer window.
    recordTaskCost("task-1", { cost: 0.4, inputTokens: 10, outputTokens: 5 });
    observeTaskSnapshot([makeTask({ status: "DONE" })]);
    await settle();

    expect(sentOutcomes).toHaveLength(1);
    // Would be null if the reporter read the doc before flushing.
    expect(sentOutcomes[0]).toMatchObject({ totalCost: 0.4 });
  });
});
