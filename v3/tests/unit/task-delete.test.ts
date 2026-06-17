// v3/tests/unit/task-delete.test.ts
import { describe, expect, it } from "vitest";
import {
  evaluateDeleteGuards,
  type DeleteGuardInput,
} from "../../electron/mcp-server/task-delete";

function base(overrides: Partial<DeleteGuardInput> = {}): DeleteGuardInput {
  return {
    task: {
      id: "t1",
      title: "do thing",
      status: "TODO",
      claimedBy: null,
      deleted: false,
    },
    mode: "soft",
    confirm: true,
    requesterAgentId: "agent-self",
    dependentCount: 0,
    force: false,
    ...overrides,
  };
}

describe("evaluateDeleteGuards", () => {
  it("allows a confirmed soft-delete of an unclaimed, dependency-free task", () => {
    expect(evaluateDeleteGuards(base()).error).toBeUndefined();
  });

  it("allows a confirmed hard-delete under the same conditions", () => {
    expect(evaluateDeleteGuards(base({ mode: "hard" })).error).toBeUndefined();
  });

  describe("confirm guard (mis-deletion protection)", () => {
    it("refuses to delete without confirm=true", () => {
      const r = evaluateDeleteGuards(base({ confirm: false }));
      expect(r.error).toMatch(/confirm=true/);
    });

    it("the hard-delete refusal warns it is permanent", () => {
      const r = evaluateDeleteGuards(base({ confirm: false, mode: "hard" }));
      expect(r.error).toMatch(/permanently/);
    });
  });

  describe("idempotency", () => {
    it("refuses to soft-delete an already soft-deleted task", () => {
      const r = evaluateDeleteGuards(
        base({ task: { ...base().task, deleted: true } }),
      );
      expect(r.error).toMatch(/already soft-deleted/);
    });

    it("allows hard-delete of an already soft-deleted task (permanent purge)", () => {
      const r = evaluateDeleteGuards(
        base({ mode: "hard", task: { ...base().task, deleted: true } }),
      );
      expect(r.error).toBeUndefined();
    });
  });

  describe("ownership guard", () => {
    it("blocks deleting a task actively claimed by another agent", () => {
      const r = evaluateDeleteGuards(
        base({
          task: {
            ...base().task,
            status: "IN_PROGRESS",
            claimedBy: "agent-other",
          },
        }),
      );
      expect(r.error).toMatch(/actively claimed by 'agent-other'/);
    });

    it("allows deleting one's own claimed task", () => {
      const r = evaluateDeleteGuards(
        base({
          task: {
            ...base().task,
            status: "IN_PROGRESS",
            claimedBy: "agent-self",
          },
        }),
      );
      expect(r.error).toBeUndefined();
    });

    it("does not block when another agent's claim is no longer active (e.g. DONE/REVIEW)", () => {
      const r = evaluateDeleteGuards(
        base({
          task: { ...base().task, status: "REVIEW", claimedBy: "agent-other" },
        }),
      );
      expect(r.error).toBeUndefined();
    });

    it("force=true overrides the ownership guard", () => {
      const r = evaluateDeleteGuards(
        base({
          force: true,
          task: {
            ...base().task,
            status: "IN_PROGRESS",
            claimedBy: "agent-other",
          },
        }),
      );
      expect(r.error).toBeUndefined();
    });
  });

  describe("dependent guard (orphan protection)", () => {
    it("blocks deleting a task with unfinished dependents", () => {
      const r = evaluateDeleteGuards(base({ dependentCount: 2 }));
      expect(r.error).toMatch(/2 unfinished dependent/);
    });

    it("force=true overrides the dependent guard", () => {
      const r = evaluateDeleteGuards(base({ dependentCount: 2, force: true }));
      expect(r.error).toBeUndefined();
    });
  });

  it("confirm guard fires before ownership/dependent guards", () => {
    // No confirm AND a foreign claim AND dependents — confirm wins the message.
    const r = evaluateDeleteGuards(
      base({
        confirm: false,
        dependentCount: 3,
        task: {
          ...base().task,
          status: "IN_PROGRESS",
          claimedBy: "agent-other",
        },
      }),
    );
    expect(r.error).toMatch(/confirm=true/);
  });
});
