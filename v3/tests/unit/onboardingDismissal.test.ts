import { describe, it, expect, beforeEach, vi } from "vitest";
import { DISMISSED_KEY } from "../../src/lib/cliSetupGate";
import { ONBOARDING_PROGRESS_KEY } from "../../src/lib/onboardingProgress";

/**
 * The ONE dismissal record — activation barrier F2.
 *
 * "Not now" used to live in two places that never talked to each other: the
 * legacy modal wrote the localStorage flag `marblo.cliSetupGateDismissed`, the
 * Start Here tab wrote `onboardingProgress.dismissed`, and the engine's
 * post-auth branch read ONLY the legacy flag. Nothing in the split shell wrote
 * that flag, so a signed-in user with no folder connected got the onboarding
 * banner back on every restart and the ✕ could never stick.
 *
 * These tests hold the fix: every writer funnels through the store, which
 * persists the record AND keeps the legacy flag (the cold-start seed) in sync
 * in both directions.
 *
 * The store reads localStorage at module-evaluation time, so each test seeds a
 * fresh in-memory storage shim and re-imports with a clean module registry
 * (same pattern as splitWorkspaceStore.test.ts).
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
  const mod = await import("../../src/stores/onboardingProgressStore");
  return { mod, map };
}

/** The persisted record's `dismissed` field, or undefined if never written. */
function persistedDismissed(map: Map<string, string>): boolean | undefined {
  const raw = map.get(ONBOARDING_PROGRESS_KEY);
  return raw ? (JSON.parse(raw).dismissed as boolean) : undefined;
}

describe("onboarding dismissal — single source of truth", () => {
  beforeEach(() => {
    vi.unstubAllGlobals();
  });

  it("is false for a brand-new user", async () => {
    const { mod } = await loadStore();
    expect(mod.isOnboardingDismissed()).toBe(false);
  });

  // Existing users who clicked "나중에" on the legacy modal before the tab
  // existed keep that choice (regression bRABKQX7).
  it("seeds from the legacy flag on a cold start", async () => {
    const { mod } = await loadStore({ [DISMISSED_KEY]: "1" });
    expect(mod.isOnboardingDismissed()).toBe(true);
  });

  // ★ The F2 fix: a shell-surface dismissal has to land on the legacy flag too,
  // because that flag is what the next cold start seeds the record from.
  it("writes BOTH the record and the legacy flag when dismissed", async () => {
    const { mod, map } = await loadStore();
    mod.setOnboardingDismissed(true);

    expect(mod.isOnboardingDismissed()).toBe(true);
    expect(persistedDismissed(map)).toBe(true);
    expect(map.get(DISMISSED_KEY)).toBe("1");
  });

  it("survives a restart — the dismissal is not re-prompted", async () => {
    const first = await loadStore();
    first.mod.setOnboardingDismissed(true);

    // Same storage contents, fresh module registry == relaunching the app.
    const restarted = await loadStore(Object.fromEntries(first.map));
    expect(restarted.mod.isOnboardingDismissed()).toBe(true);
  });

  // The mirror must clear, not write "0": a stale legacy "1" would otherwise
  // outrank the record on the next cold start and resurrect the dismissal.
  it("clears the legacy flag when the user re-enables guidance", async () => {
    const { mod, map } = await loadStore({ [DISMISSED_KEY]: "1" });
    expect(mod.isOnboardingDismissed()).toBe(true);

    mod.setOnboardingDismissed(false);
    expect(mod.isOnboardingDismissed()).toBe(false);
    expect(persistedDismissed(map)).toBe(false);
    expect(map.has(DISMISSED_KEY)).toBe(false);

    const restarted = await loadStore(Object.fromEntries(map));
    expect(restarted.mod.isOnboardingDismissed()).toBe(false);
  });

  // A record that already says `dismissed: true` in memory still has to
  // converge the legacy flag — the transition is a no-op but the mirror isn't.
  it("mirrors even when the in-memory value does not change", async () => {
    const { mod, map } = await loadStore({ [DISMISSED_KEY]: "1" });
    map.delete(DISMISSED_KEY); // legacy flag lost (e.g. an older build's write)
    expect(mod.isOnboardingDismissed()).toBe(true);

    mod.setOnboardingDismissed(true);
    expect(map.get(DISMISSED_KEY)).toBe("1");
  });

  it("exposes the same behaviour through the React store mutator", async () => {
    const { mod, map } = await loadStore();
    mod.useOnboardingProgressStore.getState().setDismissed(true);

    expect(mod.useOnboardingProgressStore.getState().progress.dismissed).toBe(
      true,
    );
    expect(map.get(DISMISSED_KEY)).toBe("1");
  });
});
