import { describe, it, expect } from "vitest";
import { OwnerRegistry } from "../../electron/owner-registry";

/**
 * Multi-window ownership rules for PTYs and orchestrators
 * (ticket hIq6m9Q6cHgtAoy3jUcB).
 *
 * Before this, main.ts tracked both as `Map<key, number>` — ONE owner. Two
 * consequences, both live bugs:
 *
 *  1. Registering a second window STOLE the stream. Opening the same project
 *     in another window silently blanked the first window's terminal, and
 *     since ownership also routed stop()/status, the dispossessed window could
 *     no longer recover its own orchestrator.
 *  2. Closing ANY owning window tore the resource down, because "this window
 *     owned it" and "no window owns it" were indistinguishable.
 *
 * `removeWindow` returning only the keys that lost their LAST owner is what
 * makes "close one window, the other keeps streaming" expressible at all.
 */
describe("OwnerRegistry", () => {
  const WIN_A = 1;
  const WIN_B = 2;
  const PTY = "orch-orchestrator-proj-1-123";

  it("registers additively — a second window does not evict the first", () => {
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);
    registry.add(PTY, WIN_B);

    expect(registry.has(PTY, WIN_A)).toBe(true);
    expect(registry.has(PTY, WIN_B)).toBe(true);
    expect(registry.ownersOf(PTY)?.size).toBe(2);
  });

  it("is idempotent — re-registering the same window changes nothing", () => {
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);
    registry.add(PTY, WIN_A);

    expect(registry.ownersOf(PTY)?.size).toBe(1);
  });

  it("KEEPS the resource alive when one of two windows closes", () => {
    // The headline guarantee: window A closes, window B still has it open, so
    // the PTY must NOT be reported as orphaned — and B must still be an owner,
    // i.e. still receiving output.
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);
    registry.add(PTY, WIN_B);

    const orphaned = registry.removeWindow(WIN_A);

    expect(orphaned).toEqual([]); // nothing to tear down
    expect(registry.has(PTY, WIN_A)).toBe(false); // closed window unsubscribed
    expect(registry.has(PTY, WIN_B)).toBe(true); // survivor still streaming
    expect(registry.isOwned(PTY)).toBe(true);
  });

  it("reports the resource as orphaned only when the LAST window closes", () => {
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);
    registry.add(PTY, WIN_B);

    expect(registry.removeWindow(WIN_A)).toEqual([]);
    expect(registry.removeWindow(WIN_B)).toEqual([PTY]);
    expect(registry.isOwned(PTY)).toBe(false);
  });

  it("does not report keys the closing window never owned", () => {
    const registry = new OwnerRegistry<string>();
    registry.add("pty-a", WIN_A);
    registry.add("pty-b", WIN_B);

    // Closing A must not orphan B's PTY — that would kill an unrelated
    // window's terminal.
    expect(registry.removeWindow(WIN_A)).toEqual(["pty-a"]);
    expect(registry.isOwned("pty-b")).toBe(true);
  });

  it("handles a window that owns several resources", () => {
    const registry = new OwnerRegistry<string>();
    registry.add("pty-a", WIN_A);
    registry.add("pty-b", WIN_A);
    registry.add("pty-b", WIN_B); // shared with B

    const orphaned = registry.removeWindow(WIN_A);

    expect(orphaned).toEqual(["pty-a"]); // only the one A held alone
    expect(registry.has("pty-b", WIN_B)).toBe(true);
  });

  it("closing an unknown window is a no-op", () => {
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);

    expect(registry.removeWindow(999)).toEqual([]);
    expect(registry.has(PTY, WIN_A)).toBe(true);
  });

  it("keysOwnedBy lists what a window holds", () => {
    const registry = new OwnerRegistry<string>();
    registry.add("proj-1", WIN_A);
    registry.add("proj-2", WIN_A);
    registry.add("proj-3", WIN_B);

    expect(registry.keysOwnedBy(WIN_A).sort()).toEqual(["proj-1", "proj-2"]);
    expect(registry.keysOwnedBy(WIN_B)).toEqual(["proj-3"]);
  });

  it("delete() drops the key outright (resource actually died / was stopped)", () => {
    const registry = new OwnerRegistry<string>();
    registry.add(PTY, WIN_A);
    registry.add(PTY, WIN_B);

    registry.delete(PTY);

    expect(registry.ownersOf(PTY)).toBeUndefined();
    expect(registry.isOwned(PTY)).toBe(false);
  });

  it("untracked and fully-orphaned keys are distinguishable from owned ones", () => {
    // main.ts's isPtyCallerOwner treats both as "permissive" — this pins the
    // predicate it relies on.
    const registry = new OwnerRegistry<string>();
    expect(registry.isOwned("never-seen")).toBe(false);

    registry.add(PTY, WIN_A);
    registry.removeWindow(WIN_A);
    expect(registry.isOwned(PTY)).toBe(false);
    expect(registry.has(PTY, WIN_A)).toBe(false);
  });
});
