import { beforeEach, describe, expect, it, vi } from "vitest";

// localStorage 만 있으면 동작. jsdom 없이 stub.
const storage: Record<string, string> = {};
vi.stubGlobal("window", {
  localStorage: {
    getItem: (k: string) => storage[k] ?? null,
    setItem: (k: string, v: string) => {
      storage[k] = v;
    },
    removeItem: (k: string) => {
      delete storage[k];
    },
  },
});

const {
  readPersistedTerminals,
  addPersistedTerminal,
  removePersistedTerminal,
} = await import("../../src/lib/terminalPersist");

beforeEach(() => {
  for (const k of Object.keys(storage)) delete storage[k];
});

describe("terminalPersist", () => {
  it("readPersistedTerminals returns [] for empty project", () => {
    expect(readPersistedTerminals("p1")).toEqual([]);
  });

  it("add then read returns the entry", () => {
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/tmp" });
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "Terminal 1", cwd: "/tmp" },
    ]);
  });

  it("add dedups by name (same name → no duplicate push)", () => {
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/tmp" });
    addPersistedTerminal("p1", { name: "Terminal 1", cwd: "/different" });
    expect(readPersistedTerminals("p1")).toEqual([
      { name: "Terminal 1", cwd: "/tmp" },
    ]);
  });

  it("remove by name takes the entry out", () => {
    addPersistedTerminal("p1", { name: "Terminal 1" });
    addPersistedTerminal("p1", { name: "Terminal 2" });
    removePersistedTerminal("p1", "Terminal 1");
    expect(readPersistedTerminals("p1")).toEqual([{ name: "Terminal 2" }]);
  });

  it("projects are isolated by projectId in the storage key", () => {
    addPersistedTerminal("p1", { name: "T1" });
    addPersistedTerminal("p2", { name: "T2" });
    expect(readPersistedTerminals("p1")).toEqual([{ name: "T1" }]);
    expect(readPersistedTerminals("p2")).toEqual([{ name: "T2" }]);
  });

  it("malformed JSON is treated as empty (graceful)", () => {
    storage["marblo:v3:terminals:p1"] = "not json {{";
    expect(readPersistedTerminals("p1")).toEqual([]);
  });

  it("empty projectId is a no-op (no write, no error)", () => {
    addPersistedTerminal("", { name: "ghost" });
    expect(readPersistedTerminals("")).toEqual([]);
    expect(Object.keys(storage)).toEqual([]);
  });
});
