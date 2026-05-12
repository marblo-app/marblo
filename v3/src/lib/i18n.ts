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

function detectInitialLocale(): Locale {
  if (typeof window === "undefined") return "ko";
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved === "ko" || saved === "en") return saved;
  } catch {
    // localStorage unavailable (e.g. sandboxed) — fall through
  }
  // Browser language fallback. Anything starting with "ko" is Korean,
  // everything else defaults to English for international visitors.
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.toLowerCase().startsWith("ko") ? "ko" : "en";
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
    Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
  );
}

/**
 * Pure translator — usable outside React (e.g. in stores / services /
 * console alerts). Reads the current locale from the store.
 */
export function t(
  key: MessageKey,
  vars?: Record<string, string | number>
): string {
  const locale = useLocaleStore.getState().locale;
  const table = MESSAGES[locale];
  const raw = table[key] ?? MESSAGES.ko[key] ?? key;
  return format(raw, vars);
}

/**
 * React hook variant. Components using this re-render on locale change.
 */
export function useTranslation() {
  const locale = useLocaleStore((s) => s.locale);
  const setLocale = useLocaleStore((s) => s.setLocale);
  const table = MESSAGES[locale];
  const translate = (
    key: MessageKey,
    vars?: Record<string, string | number>
  ): string => {
    const raw = table[key] ?? MESSAGES.ko[key] ?? key;
    return format(raw, vars);
  };
  return { t: translate, locale, setLocale };
}
