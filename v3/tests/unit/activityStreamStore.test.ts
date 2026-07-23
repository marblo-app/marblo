import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * The store reads localStorage at module-evaluation time, so each test seeds a
 * fresh in-memory storage shim, stubs the globals, then dynamically imports the
 * store with a clean module registry. Mirrors splitWorkspaceStore.test.ts.
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
  const mod = await import("../../src/stores/activityStreamStore");
  return { store: mod.useActivityStreamStore, map };
}

const OPEN_KEY = "marblo.activityStream.open";

describe("activityStreamStore open persistence", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("defaults open when nothing is persisted", async () => {
    const { store } = await loadStore();
    expect(store.getState().open).toBe(true);
  });

  it("stays open unless an explicit '0' is stored", async () => {
    const open = await loadStore({ [OPEN_KEY]: "1" });
    expect(open.store.getState().open).toBe(true);

    const closed = await loadStore({ [OPEN_KEY]: "0" });
    expect(closed.store.getState().open).toBe(false);
  });

  it("toggle flips and persists", async () => {
    const { store, map } = await loadStore();
    store.getState().toggle();
    expect(store.getState().open).toBe(false);
    expect(map.get(OPEN_KEY)).toBe("0");
    store.getState().toggle();
    expect(store.getState().open).toBe(true);
    expect(map.get(OPEN_KEY)).toBe("1");
  });

  it("setOpen persists the explicit value", async () => {
    const { store, map } = await loadStore();
    store.getState().setOpen(false);
    expect(store.getState().open).toBe(false);
    expect(map.get(OPEN_KEY)).toBe("0");
  });

  it("filter / viewMode stay in-memory (not persisted)", async () => {
    const { store, map } = await loadStore();
    store.getState().setFilter("error");
    store.getState().setViewMode("macro");
    expect(store.getState().filter).toBe("error");
    expect(store.getState().viewMode).toBe("macro");
    // Only the open flag is mirrored to storage.
    expect([...map.keys()]).not.toContain("marblo.activityStream.filter");
  });
});
