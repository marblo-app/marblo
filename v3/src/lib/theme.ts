/**
 * Theme resolution + persistence.
 *
 * Stage 1 of the dark/light migration (ticket qy4VXeWbDTOtlzxxpnzs). This
 * module is the *mechanism*; it is deliberately not wired to any UI yet.
 *
 * Why no toggle in this stage: a scope count over `src/` found 4,884 lines in
 * 298 of 622 files carrying hardcoded colors, against 98 lines in 9 files
 * using the semantic tokens — 1.4% token adoption. Exposing a switch now
 * would repaint 1.4% of the app and leave the rest dark, which is worse than
 * being honestly dark-only. The toggle lands once the screens are tokenized.
 *
 * Shape mirrors `src/lib/i18n.ts` on purpose — same storage idiom, same
 * "has the user actually chosen?" flag, same tolerance for a missing/blocked
 * localStorage. Two preferences that behave the same way should read the same.
 *
 * Persistence: localStorage key `marblo:theme`, one of "auto" | "dark" |
 * "light". Applied to `<html data-theme>`, which `src/index.css` keys off.
 */
import { create } from "zustand";

/** What the user picked. `auto` defers to the OS. */
export type ThemeChoice = "auto" | "dark" | "light";

/** What actually gets painted. `auto` has been collapsed away. */
export type ResolvedTheme = "dark" | "light";

export const THEME_STORAGE_KEY = "marblo:theme";

/**
 * Default for a user who has never chosen.
 *
 * ★Deliberately "dark", not "auto", for Stage 1: token coverage is 1.4%, so
 * resolving to light today would produce a broken screen. Stage 4 (toggle
 * exposure, after the screens are tokenized) flips this to "auto" for fresh
 * installs while writing an explicit "dark" for existing users, so nobody who
 * never asked for a change wakes up to a white app.
 */
export const DEFAULT_THEME_CHOICE: ThemeChoice = "dark";

/** The minimal slice of `Storage` this module needs — keeps it testable. */
export interface ThemeStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Is this a theme choice we know how to honor? */
export function asThemeChoice(value: unknown): ThemeChoice | null {
  return value === "auto" || value === "dark" || value === "light"
    ? value
    : null;
}

/**
 * Collapse a choice plus the OS preference into the theme to paint.
 *
 * Pure — the caller owns "what does the OS say". That is what makes this
 * unit-testable without a DOM.
 */
export function resolveTheme(
  choice: ThemeChoice,
  systemPrefersDark: boolean,
): ResolvedTheme {
  if (choice === "dark") return "dark";
  if (choice === "light") return "light";
  return systemPrefersDark ? "dark" : "light";
}

/** Browser localStorage, or null when there isn't one (SSR, tests, sandbox). */
function defaultStorage(): ThemeStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // Blocked by policy — treat as absent rather than throwing on import.
    return null;
  }
}

/**
 * The persisted choice, or null if absent/unreadable/corrupt.
 *
 * `undefined` storage means "use the browser's"; explicit `null` means "there
 * is no storage", which is how tests exercise the degraded path.
 */
export function readStoredChoice(
  storage: ThemeStorage | null | undefined = undefined,
): ThemeChoice | null {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return null;
  try {
    return asThemeChoice(store.getItem(THEME_STORAGE_KEY));
  } catch {
    return null;
  }
}

/**
 * Persist a choice. Returns whether it actually stuck — a false here means
 * the toggle still works for this session but won't survive a restart, which
 * is a thing the UI may eventually want to say out loud.
 */
export function writeStoredChoice(
  choice: ThemeChoice,
  storage: ThemeStorage | null | undefined = undefined,
): boolean {
  const store = storage === undefined ? defaultStorage() : storage;
  if (!store) return false;
  try {
    store.setItem(THEME_STORAGE_KEY, choice);
    return true;
  } catch {
    return false;
  }
}

/**
 * Has the user ever made an explicit theme choice?
 *
 * False means the current theme is only our default, never the user's word —
 * which is what lets Stage 4 migrate existing users to an explicit "dark"
 * without overwriting anyone's actual preference.
 */
export function hasChosenTheme(
  storage: ThemeStorage | null | undefined = undefined,
): boolean {
  return readStoredChoice(storage) !== null;
}

/** The choice to boot with: the stored one, else the default. */
export function detectInitialChoice(
  storage: ThemeStorage | null | undefined = undefined,
): ThemeChoice {
  return readStoredChoice(storage) ?? DEFAULT_THEME_CHOICE;
}

/**
 * Does the OS want dark right now? Defaults to true (our historical look)
 * when there's nothing to ask.
 */
export function systemPrefersDark(): boolean {
  if (typeof window === "undefined" || !window.matchMedia) return true;
  try {
    return window.matchMedia("(prefers-color-scheme: dark)").matches;
  } catch {
    return true;
  }
}

/**
 * Stamp the resolved theme onto `<html data-theme>`.
 *
 * Also sets `color-scheme` so form controls, scrollbars and the native
 * caret follow — those are painted by the OS, not by our CSS variables, and
 * they are the classic "everything is light except the scrollbar" bug.
 */
export function applyTheme(
  resolved: ResolvedTheme,
  root: HTMLElement | null | undefined = typeof document !== "undefined"
    ? document.documentElement
    : null,
): void {
  if (!root) return;
  root.setAttribute("data-theme", resolved);
  root.style.colorScheme = resolved;
}

interface ThemeState {
  /** What the user picked (may be "auto"). */
  choice: ThemeChoice;
  /** What is painted right now (never "auto"). */
  resolved: ResolvedTheme;
  setChoice: (choice: ThemeChoice) => void;
  /** Re-resolve after the OS preference flips; no-op unless choice is "auto". */
  syncSystem: (prefersDark: boolean) => void;
}

const initialChoice = detectInitialChoice();

export const useThemeStore = create<ThemeState>((set, get) => ({
  choice: initialChoice,
  resolved: resolveTheme(initialChoice, systemPrefersDark()),
  setChoice: (choice) => {
    writeStoredChoice(choice);
    const resolved = resolveTheme(choice, systemPrefersDark());
    applyTheme(resolved);
    set({ choice, resolved });
  },
  syncSystem: (prefersDark) => {
    const resolved = resolveTheme(get().choice, prefersDark);
    if (resolved === get().resolved) return;
    applyTheme(resolved);
    set({ resolved });
  },
}));

/**
 * Paint the stored theme and start following the OS.
 *
 * Call once from the app entry, before first paint. Returns a teardown so a
 * test (or a future re-init) can drop the media-query listener.
 */
export function initTheme(): () => void {
  applyTheme(useThemeStore.getState().resolved);

  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  let mql: MediaQueryList;
  try {
    mql = window.matchMedia("(prefers-color-scheme: dark)");
  } catch {
    return () => {};
  }
  const onChange = (e: MediaQueryListEvent) =>
    useThemeStore.getState().syncSystem(e.matches);
  mql.addEventListener("change", onChange);
  return () => mql.removeEventListener("change", onChange);
}

/** React hook: re-renders on theme change. */
export function useTheme() {
  const choice = useThemeStore((s) => s.choice);
  const resolved = useThemeStore((s) => s.resolved);
  const setChoice = useThemeStore((s) => s.setChoice);
  return { choice, resolved, setChoice };
}
