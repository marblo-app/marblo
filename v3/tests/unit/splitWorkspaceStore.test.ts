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
    // Empty storage == a brand-new user with onboarding untouched, so the
    // shell opens on the 시작하기 tab (ticket ZdgQMxW7).
    expect(s.activeTab).toBe("startHere");
    expect(s.terminalCollapsed).toBe(false);
    // The cold-open shape is the three-way split, so the tree starts OPEN.
    expect(s.fileTreeOpen).toBe(true);
  });

  describe("onboarding landing", () => {
    it("opens the board once onboarding is finished", async () => {
      const { store } = await loadStore({
        "marblo.onboarding.progress": JSON.stringify({
          done: ["install", "auth", "prd", "git", "firstTicket"],
        }),
      });
      expect(store.getState().activeTab).toBe("board");
    });

    // Regression bRABKQX7 — a user who clicked "나중에" on the legacy modal
    // must not be dragged back into onboarding after the upgrade.
    it("honors the legacy dismissal flag", async () => {
      const { store } = await loadStore({
        "marblo.cliSetupGateDismissed": "1",
      });
      expect(store.getState().activeTab).toBe("board");
    });

    it("never overrides an explicit tab choice", async () => {
      const { store } = await loadStore({
        "marblo.workspaceSplit.activeTab": "code",
      });
      // Onboarding is untouched here, yet the persisted choice still wins.
      expect(store.getState().activeTab).toBe("code");
    });

    it("graduates a persisted startHere to board once onboarding is finished", async () => {
      const { store } = await loadStore({
        "marblo.workspaceSplit.activeTab": "startHere",
        "marblo.onboarding.progress": JSON.stringify({
          done: ["install", "auth", "prd", "git", "firstTicket"],
        }),
      });
      expect(store.getState().activeTab).toBe("board");
    });

    it("keeps a persisted startHere while onboarding is still unfinished", async () => {
      const { store } = await loadStore({
        "marblo.workspaceSplit.activeTab": "startHere",
      });
      expect(store.getState().activeTab).toBe("startHere");
    });
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
      // Onboarding already finished, so the garbage tab falls back to board
      // rather than the first-run landing.
      "marblo.onboarding.progress": JSON.stringify({
        done: ["install", "auth", "prd", "git", "firstTicket"],
      }),
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

  it("toggleFileTree flips and persists (default open)", async () => {
    const { store, map } = await loadStore();
    expect(store.getState().fileTreeOpen).toBe(true);
    store.getState().toggleFileTree();
    expect(store.getState().fileTreeOpen).toBe(false);
    expect(map.get("marblo.workspaceSplit.fileTreeOpen")).toBe("0");
    store.getState().toggleFileTree();
    expect(store.getState().fileTreeOpen).toBe(true);
    expect(map.get("marblo.workspaceSplit.fileTreeOpen")).toBe("1");
  });

  // A user who closed the tree keeps it closed across the default flip.
  it("honours a persisted '0' as a deliberate opt-out", async () => {
    const { store } = await loadStore({
      "marblo.workspaceSplit.fileTreeOpen": "0",
    });
    expect(store.getState().fileTreeOpen).toBe(false);
  });
});
