/**
 * Lightweight i18n — no external dep.
 *
 * Why not react-i18next or next-intl: this is an Electron renderer, not
 * Next.js, and we only need ~50 string keys for the launch window
 * (P0-5). A 200-line module beats pulling in a 50 KB library + provider
 * boilerplate.
 *
 * Pattern:
 *   const { t, locale, setLocale } = useTranslation();
 *   <h1>{t("settings.title")}</h1>
 *
 * Persistence: localStorage key `marblo:locale`. Switch is instant —
 * the zustand store fires re-renders for every subscriber.
 */
import { create } from "zustand";
import { ko, type MessageKey } from "../locales/ko";
import { en } from "../locales/en";

export type Locale = "ko" | "en";

const STORAGE_KEY = "marblo:locale";

const MESSAGES: Record<Locale, Record<MessageKey, string>> = {
  ko,
  en,
};

/** 저장된 값 / navigator 언어가 우리가 아는 로케일인가. */
function asLocale(value: unknown): Locale | null {
  return value === "ko" || value === "en" ? value : null;
}

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "ko";
  try {
    const saved = asLocale(window.localStorage.getItem(STORAGE_KEY));
    if (saved) return saved;
  } catch {
    // localStorage unavailable (e.g. sandboxed) — fall through
  }
  // Browser language fallback. Anything starting with "ko" is Korean,
  // everything else defaults to English for international visitors.
  const nav = (
    typeof navigator !== "undefined" ? navigator.language : ""
  ).toLowerCase();
  if (nav.startsWith("ko")) return "ko";
  return "en";
}

/**
 * Has the user ever made an explicit language choice? True once `setLocale`
 * has persisted to localStorage. When false, `detectInitialLocale` only
 * *guessed* from `navigator.language` (no write), so the first-run language
 * modal should appear. Absence of STORAGE_KEY == not yet chosen.
 */
export function hasChosenLocale(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return asLocale(window.localStorage.getItem(STORAGE_KEY)) !== null;
  } catch {
    // localStorage unavailable (e.g. sandboxed) — treat as chosen so we
    // never trap the user behind a modal we can't dismiss persistently.
    return true;
  }
}

interface LocaleState {
  locale: Locale;
  setLocale: (locale: Locale) => void;
}

export const useLocaleStore = create<LocaleState>((set) => ({
  locale: detectInitialLocale(),
  setLocale: (locale) => {
    try {
      window.localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore — non-persistent toggle still works for this session
    }
    // Mirror to <html lang> so screen readers + Tailwind locale variants
    // both pick up the change without a remount.
    if (typeof document !== "undefined") {
      document.documentElement.lang = locale;
    }
    set({ locale });
  },
}));

/**
 * Format a translation. Supports `{name}` placeholders.
 *   t("agents.dashboard.cleanupConfirm", { count: 5 })
 */
function format(template: string, vars?: Record<string, string | number>) {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`,
  );
}

/**
 * Pure translator — usable outside React (e.g. in stores / services /
 * console alerts). Reads the current locale from the store.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>,
): string {
  const locale = useLocaleStore.getState().locale;
  const table = MESSAGES[locale];
  const raw = table[key] ?? key;
  return format(raw, vars);
}

/**
 * React hook variant. Components using this re-render on locale change.
 */
export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const translate = (
    key: MessageKey,
    vars?: Record<string, string | number>,
  ): string => {
    const table = MESSAGES[locale];
    const raw = table[key] ?? key;
    return format(raw, vars);
  };
  return { t: translate, locale, setLocale };
}

/**
 * Type alias for `useTranslation().t`.
 *
 * Pure helpers outside React can accept this instead of widening translation
 * calls to `(key: string) => string`, which would let misspelled keys compile.
 */
export type TFunction = ReturnType<typeof useTranslation>["t"];
