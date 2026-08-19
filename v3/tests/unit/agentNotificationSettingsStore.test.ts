// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";

const STORAGE_KEY = "marblo.agentInputWait.popupsEnabled";

function installStorage(seed: Record<string, string> = {}) {
  const map = new Map<string, string>(Object.entries(seed));
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        map.set(key, String(value));
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  });
  return map;
}

async function loadStore(seed: Record<string, string> = {}) {
  const map = installStorage(seed);
  vi.resetModules();
  const mod = await import("../../src/stores/agentNotificationSettingsStore");
  return { map, mod };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("agentNotificationSettingsStore", () => {
  it("defaults input-wait popups to off", async () => {
    const { mod } = await loadStore();
    expect(mod.resolveAgentInputWaitPopupsEnabled()).toBe(false);
    expect(
      mod.useAgentNotificationSettingsStore.getState().inputWaitPopupsEnabled,
    ).toBe(false);
  });

  it("restores the explicit opt-in", async () => {
    const { mod } = await loadStore({ [STORAGE_KEY]: "1" });
    expect(mod.resolveAgentInputWaitPopupsEnabled()).toBe(true);
    expect(
      mod.useAgentNotificationSettingsStore.getState().inputWaitPopupsEnabled,
    ).toBe(true);
  });

  it("persists opt-in and removes the key on opt-out", async () => {
    const { map, mod } = await loadStore();
    const store = mod.useAgentNotificationSettingsStore.getState();

    store.setInputWaitPopupsEnabled(true);
    expect(map.get(STORAGE_KEY)).toBe("1");
    expect(
      mod.useAgentNotificationSettingsStore.getState().inputWaitPopupsEnabled,
    ).toBe(true);

    mod.useAgentNotificationSettingsStore
      .getState()
      .setInputWaitPopupsEnabled(false);
    expect(map.has(STORAGE_KEY)).toBe(false);
    expect(
      mod.useAgentNotificationSettingsStore.getState().inputWaitPopupsEnabled,
    ).toBe(false);
  });

  it("fails closed when storage throws", async () => {
    Object.defineProperty(window, "localStorage", {
      configurable: true,
      value: {
        getItem: () => {
          throw new Error("storage disabled");
        },
        setItem: () => {
          throw new Error("storage disabled");
        },
        removeItem: () => {
          throw new Error("storage disabled");
        },
      },
    });
    vi.resetModules();
    const mod = await import("../../src/stores/agentNotificationSettingsStore");
    expect(mod.resolveAgentInputWaitPopupsEnabled()).toBe(false);
    mod.useAgentNotificationSettingsStore
      .getState()
      .setInputWaitPopupsEnabled(true);
    expect(
      mod.useAgentNotificationSettingsStore.getState().inputWaitPopupsEnabled,
    ).toBe(true);
  });
});
