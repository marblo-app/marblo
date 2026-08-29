import { describe, expect, it } from "vitest";
import {
  canViewProjectAgent,
  filterVisibleProjectAgents,
  isProjectOwnerViewer,
  projectAgentQueryScope,
} from "../../src/services/agentVisibility";

describe("agentVisibility", () => {
  it("keeps the project owner's fleet view project-wide", () => {
    const context = {
      projectOwnerId: "owner-1",
      viewerUserId: "owner-1",
      localMachineId: "machine-a",
    };

    expect(isProjectOwnerViewer(context)).toBe(true);
    expect(projectAgentQueryScope(context)).toEqual({ kind: "project" });
    expect(canViewProjectAgent({ machineId: "machine-b" }, context)).toBe(true);
    expect(canViewProjectAgent({ machineId: undefined }, context)).toBe(true);
  });

  it("hides foreign and legacy agent docs from non-owner teammates", () => {
    const context = {
      projectOwnerId: "owner-1",
      viewerUserId: "member-1",
      localMachineId: "machine-a",
    };

    expect(canViewProjectAgent({ machineId: "machine-a" }, context)).toBe(true);
    expect(projectAgentQueryScope(context)).toEqual({
      kind: "machine",
      machineId: "machine-a",
    });
    expect(canViewProjectAgent({ machineId: "machine-b" }, context)).toBe(
      false,
    );
    expect(canViewProjectAgent({ machineId: undefined }, context)).toBe(false);
  });

  it("fails closed for non-owner viewers until local machineId is known", () => {
    const context = {
      projectOwnerId: "owner-1",
      viewerUserId: "member-1",
      localMachineId: null,
    };

    expect(canViewProjectAgent({ machineId: "machine-a" }, context)).toBe(
      false,
    );
    expect(projectAgentQueryScope(context)).toEqual({ kind: "none" });
  });

  it("filters a project agent list without mutating order", () => {
    const agents = [
      { id: "own-1", machineId: "machine-a" },
      { id: "foreign-1", machineId: "machine-b" },
      { id: "legacy-1", machineId: undefined },
      { id: "own-2", machineId: "machine-a" },
    ];

    expect(
      filterVisibleProjectAgents(agents, {
        projectOwnerId: "owner-1",
        viewerUserId: "member-1",
        localMachineId: "machine-a",
      }).map((agent) => agent.id),
    ).toEqual(["own-1", "own-2"]);
  });
});
