import { describe, expect, it } from "vitest";
import { computeSessionMapUpdates } from "../../src/lib/sessionMapMatch";

describe("computeSessionMapUpdates", () => {
  it("matches agent.name suffix in agent session label", () => {
    const updates = computeSessionMapUpdates(
      [{ id: "a1", name: "backend-1" }],
      [
        { id: "pty-xyz", name: "🟣 backend-1", isAgent: true },
        { id: "pty-shell", name: "Terminal 1", isAgent: false },
      ],
      {},
    );
    expect(updates).toEqual([["a1", "pty-xyz"]]);
  });

  it("ignores non-agent sessions (shell terminals)", () => {
    const updates = computeSessionMapUpdates(
      [{ id: "a1", name: "Terminal 1" }],
      [{ id: "pty-shell", name: "Terminal 1", isAgent: false }],
      {},
    );
    expect(updates).toEqual([]);
  });

  it("skips already-mapped pairs (idempotent on stable input)", () => {
    const updates = computeSessionMapUpdates(
      [{ id: "a1", name: "backend-1" }],
      [{ id: "pty-xyz", name: "🟣 backend-1", isAgent: true }],
      { a1: "pty-xyz" },
    );
    expect(updates).toEqual([]);
  });

  it("re-maps when sessionId changes (reconnect after restart)", () => {
    const updates = computeSessionMapUpdates(
      [{ id: "a1", name: "backend-1" }],
      [{ id: "pty-NEW", name: "🟣 backend-1", isAgent: true }],
      { a1: "pty-OLD" },
    );
    expect(updates).toEqual([["a1", "pty-NEW"]]);
  });

  it("returns nothing when agent has no matching session yet", () => {
    const updates = computeSessionMapUpdates(
      [{ id: "a1", name: "backend-1" }],
      [{ id: "pty-other", name: "🟣 other-agent", isAgent: true }],
      {},
    );
    expect(updates).toEqual([]);
  });

  it("matches multiple agents in one pass, agnostic to vendor icon prefix", () => {
    const updates = computeSessionMapUpdates(
      [
        { id: "a1", name: "backend-1" },
        { id: "a2", name: "frontend-1" },
        { id: "a3", name: "qa-1" },
      ],
      [
        { id: "p1", name: "Agent: backend-1", isAgent: true },
        { id: "p2", name: "🔵 frontend-1", isAgent: true },
        { id: "p3", name: "🟢 qa-1", isAgent: true },
      ],
      {},
    );
    expect(updates).toEqual([
      ["a1", "p1"],
      ["a2", "p2"],
      ["a3", "p3"],
    ]);
  });
});
