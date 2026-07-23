import { describe, it, expect, beforeEach, vi } from "vitest";
import {
  MIN_RATIO,
  MAX_RATIO,
  DEFAULT_RATIO,
  MIN_V_RATIO,
  MAX_V_RATIO,
  DEFAULT_V_RATIO,
} from "../../src/lib/splitWorkspaceLayout";

/**
 * The store reads localStorage at module-evaluation time, so each test seeds a
 * fresh in-memory storage shim, stubs the globals, then dynamically imports the
 * store with a clean module registry.
 */
function makeStorageShim(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    map,
    storage: {
      getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
      setItem: (k: string, v: string) => {
        map.set(k, String(v));
      },
      removeItem: (k: string) => {
        map.delete(k);
      },
      clear: () => map.clear(),
    },
  };
}

async function loadStore(seed?: Record<string, string>) {
  const { map, storage } = makeStorageShim(seed);
  vi.resetModules();
  vi.stubGlobal("window", {} as unknown as Window);
  vi.stubGlobal("localStorage", storage);
  const mod = await import("../../src/stores/splitWorkspaceStore");
  return { store: mod.useSplitWorkspaceStore, map };
}

describe("splitWorkspaceStore", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("initialises from defaults when storage is empty", async () => {
    const { store } = await loadStore();
    const s = store.getState();
    expect(s.ratio).toBe(DEFAULT_RATIO);
    expect(s.verticalRatio).toBe(DEFAULT_V_RATIO);
    expect(s.activeTab).toBe("board");
    expect(s.terminalCollapsed).toBe(false);
    expect(s.fileTreeOpen).toBe(false);
  });

  it("hydrates persisted values on load", async () => {
    const { store } = await loadStore({
      "marblo.workspaceSplit.ratio": "0.55",
      "marblo.workspaceSplit.verticalRatio": "0.65",
      "marblo.workspaceSplit.activeTab": "code",
      "marblo.workspaceSplit.terminalCollapsed": "1",
      "marblo.workspaceSplit.fileTreeOpen": "1",
    });
    const s = store.getState();
    expect(s.ratio).toBe(0.55);
    expect(s.verticalRatio).toBe(0.65);
    expect(s.activeTab).toBe("code");
    expect(s.terminalCollapsed).toBe(true);
    expect(s.fileTreeOpen).toBe(true);
  });

  it("ignores an out-of-range / garbage persisted ratio", async () => {
    const { store } = await loadStore({
      "marblo.workspaceSplit.ratio": "9",
      "marblo.workspaceSplit.activeTab": "bogus",
    });
    const s = store.getState();
    expect(s.ratio).toBe(MAX_RATIO);
    expect(s.activeTab).toBe("board");
  });

  it("setRatio clamps and persists", async () => {
    const { store, map } = await loadStore();
    store.getState().setRatio(0.99);
    expect(store.getState().ratio).toBe(MAX_RATIO);
    expect(map.get("marblo.workspaceSplit.ratio")).toBe(String(MAX_RATIO));

    store.getState().setRatio(0.01);
    expect(store.getState().ratio).toBe(MIN_RATIO);
  });

  it("setActiveTab persists the selection", async () => {
    const { store, map } = await loadStore();
    store.getState().setActiveTab("worktrees");
    expect(store.getState().activeTab).toBe("worktrees");
    expect(map.get("marblo.workspaceSplit.activeTab")).toBe("worktrees");
  });

  it("toggleTerminalCollapsed flips and persists", async () => {
    const { store, map } = await loadStore();
    expect(store.getState().terminalCollapsed).toBe(false);
    store.getState().toggleTerminalCollapsed();
    expect(store.getState().terminalCollapsed).toBe(true);
    expect(map.get("marblo.workspaceSplit.terminalCollapsed")).toBe("1");
    store.getState().toggleTerminalCollapsed();
    expect(store.getState().terminalCollapsed).toBe(false);
    expect(map.get("marblo.workspaceSplit.terminalCollapsed")).toBe("0");
  });

  it("setVerticalRatio clamps and persists", async () => {
    const { store, map } = await loadStore();
    store.getState().setVerticalRatio(0.99);
    expect(store.getState().verticalRatio).toBe(MAX_V_RATIO);
    expect(map.get("marblo.workspaceSplit.verticalRatio")).toBe(
      String(MAX_V_RATIO),
    );

    store.getState().setVerticalRatio(0.01);
    expect(store.getState().verticalRatio).toBe(MIN_V_RATIO);
  });

  it("ignores an out-of-range persisted verticalRatio", async () => {
    const { store } = await loadStore({
      "marblo.workspaceSplit.verticalRatio": "7",
    });
    expect(store.getState().verticalRatio).toBe(MAX_V_RATIO);
  });

  it("toggleFileTree flips and persists (default closed)", async () => {
    const { store, map } = await loadStore();
    expect(store.getState().fileTreeOpen).toBe(false);
    store.getState().toggleFileTree();
    expect(store.getState().fileTreeOpen).toBe(true);
    expect(map.get("marblo.workspaceSplit.fileTreeOpen")).toBe("1");
    store.getState().toggleFileTree();
    expect(store.getState().fileTreeOpen).toBe(false);
    expect(map.get("marblo.workspaceSplit.fileTreeOpen")).toBe("0");
  });
});
