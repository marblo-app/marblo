import { describe, expect, it } from "vitest";
import {
  formatClaimOwnershipError,
  getClaimOwnershipError,
  shouldReleaseClaimForStoppedAgent,
} from "../../electron/mcp-server/task-ownership";

describe("task ownership guard", () => {
  it("allows the claiming agent to update its own claimed task", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-a",
      }),
    ).toBeNull();
  });

  it("rejects a different agent with the explicit ownership error", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-b",
      }),
    ).toBe(
      "Task is claimed by agent agent-a; only the claiming agent can update it",
    );
    expect(formatClaimOwnershipError("agent-a")).toBe(
      "Task is claimed by agent agent-a; only the claiming agent can update it",
    );
  });

  it("lets force=true bypass the ownership guard", () => {
    expect(
      getClaimOwnershipError({
        claimedBy: "agent-a",
        actorAgentId: "agent-b",
        force: true,
      }),
    ).toBeNull();
  });
});

describe("stopped-agent claim release guard", () => {
  it("releases only tasks claimed by the stopped agent", () => {
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: "dead-agent",
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(true);
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: "live-agent",
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(false);
    expect(
      shouldReleaseClaimForStoppedAgent({
        claimedBy: null,
        stoppedAgentId: "dead-agent",
      }),
    ).toBe(false);
  });
});
