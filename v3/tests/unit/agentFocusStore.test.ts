import { beforeEach, describe, expect, it } from "vitest";
import { useAgentFocusStore } from "../../src/stores/agentFocusStore";

beforeEach(() => {
  useAgentFocusStore.getState().clear();
});

describe("agentFocusStore", () => {
  it("setFocusedAgent persists across getState reads (cross-component drill-in)", () => {
    useAgentFocusStore.getState().setFocusedAgent("agent-123");
    expect(useAgentFocusStore.getState().focusedAgentId).toBe("agent-123");
  });

  it("clear() returns to null (close FocusView)", () => {
    useAgentFocusStore.getState().setFocusedAgent("a");
    useAgentFocusStore.getState().clear();
    expect(useAgentFocusStore.getState().focusedAgentId).toBeNull();
  });

  it("setFocusedAgent(null) is equivalent to clear()", () => {
    useAgentFocusStore.getState().setFocusedAgent("a");
    useAgentFocusStore.getState().setFocusedAgent(null);
    expect(useAgentFocusStore.getState().focusedAgentId).toBeNull();
  });
});
