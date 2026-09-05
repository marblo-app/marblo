/**
 * Theme resolution + persistence (ticket qy4VXeWbDTOtlzxxpnzs, Stage 1).
 *
 * Covers only the pure surface of src/lib/theme.ts — no DOM, no store, no
 * GUI. Every case below is written so that reverting the behavior it names
 * makes it fail; the mutation checks are recorded in the PR body.
 */
import { describe, it, expect } from "vitest";
import {
  asThemeChoice,
  resolveTheme,
  readStoredChoice,
  writeStoredChoice,
  hasChosenTheme,
  detectInitialChoice,
  applyTheme,
  DEFAULT_THEME_CHOICE,
  THEME_STORAGE_KEY,
  type ThemeChoice,
  type ThemeStorage,
} from "../../src/lib/theme";

/** In-memory stand-in for localStorage. */
function memStorage(seed: Record<string, string> = {}): ThemeStorage {
  const map = new Map(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => {
      map.set(k, v);
    },
  };
}

/** Storage that throws on every access — the sandboxed/blocked case. */
function hostileStorage(): ThemeStorage {
  return {
    getItem() {
      throw new Error("SecurityError: localStorage is not available");
    },
    setItem() {
      throw new Error("QuotaExceededError");
    },
  };
}

describe("asThemeChoice", () => {
  it("accepts exactly the three known choices", () => {
    expect(asThemeChoice("auto")).toBe("auto");
    expect(asThemeChoice("dark")).toBe("dark");
    expect(asThemeChoice("light")).toBe("light");
  });

  it("rejects anything else, including near-misses and wrong types", () => {
    for (const bad of [
      "Dark",
      "DARK",
      " dark",
      "system",
      "",
      null,
      undefined,
      0,
      1,
      {},
      [],
      true,
    ]) {
      expect(asThemeChoice(bad)).toBeNull();
    }
  });
});

describe("resolveTheme", () => {
  it("honors an explicit choice regardless of the OS", () => {
    expect(resolveTheme("dark", true)).toBe("dark");
    expect(resolveTheme("dark", false)).toBe("dark");
    expect(resolveTheme("light", true)).toBe("light");
    expect(resolveTheme("light", false)).toBe("light");
  });

  it("follows the OS only under auto", () => {
    expect(resolveTheme("auto", true)).toBe("dark");
    expect(resolveTheme("auto", false)).toBe("light");
  });

  it("never returns auto", () => {
    const choices: ThemeChoice[] = ["auto", "dark", "light"];
    for (const c of choices) {
      for (const sys of [true, false]) {
        expect(["dark", "light"]).toContain(resolveTheme(c, sys));
      }
    }
  });

  it("is the only place auto is collapsed — light under a dark OS stays light", () => {
    // Guards the inversion mutation (systemPrefersDark ? light : dark) and
    // the "explicit choice silently deferring to the OS" mutation.
    expect(resolveTheme("light", true)).not.toBe("dark");
    expect(resolveTheme("dark", false)).not.toBe("light");
  });
});

describe("readStoredChoice", () => {
  it("returns the persisted choice", () => {
    const s = memStorage({ [THEME_STORAGE_KEY]: "light" });
    expect(readStoredChoice(s)).toBe("light");
  });

  it("returns null when nothing was ever stored", () => {
    expect(readStoredChoice(memStorage())).toBeNull();
  });

  it("returns null for a corrupt value rather than trusting it", () => {
    expect(readStoredChoice(memStorage({ [THEME_STORAGE_KEY]: "neon" }))).toBe(
      null,
    );
  });

  it("reads the documented key and no other", () => {
    expect(THEME_STORAGE_KEY).toBe("marblo:theme");
    expect(readStoredChoice(memStorage({ theme: "light" }))).toBeNull();
  });

  it("survives storage that throws", () => {
    expect(readStoredChoice(hostileStorage())).toBeNull();
  });

  it("treats absent storage as no choice", () => {
    expect(readStoredChoice(null)).toBeNull();
  });
});

describe("writeStoredChoice", () => {
  it("round-trips every choice through storage", () => {
    const choices: ThemeChoice[] = ["auto", "dark", "light"];
    for (const c of choices) {
      const s = memStorage();
      expect(writeStoredChoice(c, s)).toBe(true);
      expect(readStoredChoice(s)).toBe(c);
    }
  });

  it("overwrites a previous choice", () => {
    const s = memStorage({ [THEME_STORAGE_KEY]: "dark" });
    writeStoredChoice("light", s);
    expect(readStoredChoice(s)).toBe("light");
  });

  it("reports failure instead of throwing when storage is blocked", () => {
    expect(writeStoredChoice("light", hostileStorage())).toBe(false);
    expect(writeStoredChoice("light", null)).toBe(false);
  });
});

describe("hasChosenTheme", () => {
  it("is false until a valid choice is persisted", () => {
    const s = memStorage();
    expect(hasChosenTheme(s)).toBe(false);
    writeStoredChoice("auto", s);
    expect(hasChosenTheme(s)).toBe(true);
  });

  it("stays false for a corrupt value — a garbled key is not a decision", () => {
    expect(hasChosenTheme(memStorage({ [THEME_STORAGE_KEY]: "puce" }))).toBe(
      false,
    );
  });

  it("is false, not true, when storage is unavailable", () => {
    // Differs from i18n's hasChosenLocale, which returns true to avoid
    // trapping the user behind an undismissable first-run modal. Theme has
    // no such modal, and Stage 4's migration must not mistake "cannot read"
    // for "user already chose" — that would skip pinning existing users to
    // dark and flip them to auto behind their back.
    expect(hasChosenTheme(hostileStorage())).toBe(false);
    expect(hasChosenTheme(null)).toBe(false);
  });
});

describe("detectInitialChoice", () => {
  it("prefers the stored choice", () => {
    expect(
      detectInitialChoice(memStorage({ [THEME_STORAGE_KEY]: "light" })),
    ).toBe("light");
    expect(
      detectInitialChoice(memStorage({ [THEME_STORAGE_KEY]: "auto" })),
    ).toBe("auto");
  });

  it("falls back to the default when nothing is stored or readable", () => {
    expect(detectInitialChoice(memStorage())).toBe(DEFAULT_THEME_CHOICE);
    expect(detectInitialChoice(hostileStorage())).toBe(DEFAULT_THEME_CHOICE);
    expect(detectInitialChoice(null)).toBe(DEFAULT_THEME_CHOICE);
  });

  it("★defaults to dark in Stage 1, not auto", () => {
    // Token coverage is 1.4%; resolving to light for an unconfigured user
    // would ship a broken screen. Stage 4 flips this deliberately — when it
    // does, this assertion is the thing that must be consciously updated.
    expect(DEFAULT_THEME_CHOICE).toBe("dark");
    expect(resolveTheme(detectInitialChoice(memStorage()), false)).toBe("dark");
  });
});

describe("applyTheme", () => {
  /** Minimal element stand-in — the node test env has no DOM. */
  function fakeRoot() {
    const attrs: Record<string, string> = {};
    const style: Record<string, string> = {};
    return {
      attrs,
      style,
      el: {
        setAttribute: (k: string, v: string) => {
          attrs[k] = v;
        },
        style,
      } as unknown as HTMLElement,
    };
  }

  it("stamps data-theme with the resolved theme", () => {
    const r = fakeRoot();
    applyTheme("light", r.el);
    expect(r.attrs["data-theme"]).toBe("light");
    applyTheme("dark", r.el);
    expect(r.attrs["data-theme"]).toBe("dark");
  });

  it("also sets color-scheme so OS-painted chrome follows", () => {
    // Scrollbars, form controls and the caret are painted by the OS, not by
    // our CSS variables. Without this the light app keeps dark scrollbars.
    const r = fakeRoot();
    applyTheme("light", r.el);
    expect(r.style.colorScheme).toBe("light");
  });

  it("is a no-op without a root instead of throwing", () => {
    expect(() => applyTheme("light", null)).not.toThrow();
  });
});
