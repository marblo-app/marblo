import { describe, expect, it } from "vitest";
import { useWorkspaceModeStore } from "../../src/stores/workspaceModeStore";

describe("workspaceModeStore", () => {
  it("defaults to ON (the shell is the default experience)", () => {
    // In the node test env there is no persisted "0", so the flag must be ON.
    expect(useWorkspaceModeStore.getState().enabled).toBe(true);
  });

  it("setEnabled flips the in-memory flag even when persistence is unavailable", () => {
    useWorkspaceModeStore.getState().setEnabled(true);
    expect(useWorkspaceModeStore.getState().enabled).toBe(true);
    useWorkspaceModeStore.getState().setEnabled(false);
    expect(useWorkspaceModeStore.getState().enabled).toBe(false);
  });

  it("toggle inverts the flag", () => {
    useWorkspaceModeStore.getState().setEnabled(false);
    useWorkspaceModeStore.getState().toggle();
    expect(useWorkspaceModeStore.getState().enabled).toBe(true);
    useWorkspaceModeStore.getState().toggle();
    expect(useWorkspaceModeStore.getState().enabled).toBe(false);
  });
});
