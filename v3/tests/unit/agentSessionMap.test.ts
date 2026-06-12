import { beforeEach, describe, expect, it, vi } from "vitest";

// vitest env is `node` — polyfill the bits of window/localStorage the store
// touches so the persistence path is exercised exactly like in the renderer.
class MemoryStorage {
  private data = new Map<string, string>();
  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }
  setItem(key: string, value: string): void {
    this.data.set(key, value);
  }
  removeItem(key: string): void {
    this.data.delete(key);
  }
  clear(): void {
    this.data.clear();
  }
}

const memStorage = new MemoryStorage();
vi.stubGlobal("window", { localStorage: memStorage });

// Import AFTER the stub so the module-load read sees our polyfilled window.
const { useAgentSessionMap, getSessionIdForAgent } =
  await import("../../src/stores/agentSessionMap");

const STORAGE_KEY = "marblo.agentSessionMap.v1";

beforeEach(() => {
  memStorage.clear();
  useAgentSessionMap.getState().clear();
});

describe("agentSessionMap", () => {
  it("stores and retrieves a mapping", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    expect(useAgentSessionMap.getState().get("agent-1")).toBe("pty-aaa");
  });

  it("falls back to deterministic agent-<id> when missing", () => {
    expect(useAgentSessionMap.getState().get("unknown")).toBe("agent-unknown");
    expect(getSessionIdForAgent("unknown")).toBe("agent-unknown");
  });

  it("overwrites an existing mapping", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    useAgentSessionMap.getState().set("agent-1", "pty-bbb");
    expect(useAgentSessionMap.getState().get("agent-1")).toBe("pty-bbb");
  });

  it("remove deletes a mapping and falls back", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    useAgentSessionMap.getState().remove("agent-1");
    expect(useAgentSessionMap.getState().get("agent-1")).toBe("agent-agent-1");
  });

  it("persists to localStorage (survives app restart — B5)", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    const raw = memStorage.getItem(STORAGE_KEY);
    expect(raw).not.toBeNull();
    expect(JSON.parse(raw!)).toEqual({ "agent-1": "pty-aaa" });
  });

  it("clear empties both store and storage", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    useAgentSessionMap.getState().clear();
    expect(useAgentSessionMap.getState().map).toEqual({});
    expect(memStorage.getItem(STORAGE_KEY)).toBe("{}");
  });

  it("no-op when setting the same value (referential stability)", () => {
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    const before = useAgentSessionMap.getState().map;
    useAgentSessionMap.getState().set("agent-1", "pty-aaa");
    const after = useAgentSessionMap.getState().map;
    expect(after).toBe(before);
  });

  it("getSessionIdForAgent returns the registered value", () => {
    useAgentSessionMap.getState().set("agent-2", "pty-zzz");
    expect(getSessionIdForAgent("agent-2")).toBe("pty-zzz");
  });
});
