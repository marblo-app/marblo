/**
 * First-launch language picker.
 *
 * Shown once, the very first time the app boots before the user has ever
 * made an explicit language choice (see `hasChosenLocale()` in lib/i18n).
 * The detected locale (Korean for ko-* browsers, English otherwise) is
 * pre-selected; the user confirms with Continue, which persists the choice
 * via `setLocale` so this modal never reappears.
 *
 * Visual language mirrors SettingsPage's LanguageSection (same flag icons,
 * same `settings.language.*` labels, same selected/blue styling) so the
 * two pickers feel like one component.
 */
import { useState } from "react";
import { useTranslation, type Locale } from "../../lib/i18n";

interface LanguageFirstRunProps {
  /** Called after the user confirms a language. */
  onComplete: () => void;
}

const OPTIONS: {
  id: Locale;
  labelKey: "settings.language.korean" | "settings.language.english";
  flag: string;
}[] = [
  { id: "ko", labelKey: "settings.language.korean", flag: "🇰🇷" },
  { id: "en", labelKey: "settings.language.english", flag: "🇺🇸" },
];

export function LanguageFirstRun({ onComplete }: LanguageFirstRunProps) {
  const { t, locale, setLocale } = useTranslation();
  // Pre-select the detected locale (the store's current value is the
  // navigator-derived guess before any explicit choice).
  const [selected, setSelected] = useState<Locale>(locale);

  const handleContinue = () => {
    setLocale(selected); // persists to localStorage → modal won't show again
    onComplete();
  };

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={t("onboarding.langFirstRun.title")}
    >
      <div className="w-full max-w-sm rounded-xl border border-gray-700 bg-gray-800 p-6 shadow-2xl">
        <h2 className="mb-1 text-lg font-semibold text-gray-100">
          {t("onboarding.langFirstRun.title")}
        </h2>
        <p className="mb-5 text-sm text-gray-400">
          {t("onboarding.langFirstRun.subtitle")}
        </p>

        <div className="space-y-2">
          {OPTIONS.map((opt) => (
            <button
              key={opt.id}
              type="button"
              onClick={() => setSelected(opt.id)}
              className={`w-full flex items-center gap-3 rounded-lg border px-4 py-3 text-left transition-colors ${
                selected === opt.id
                  ? "border-blue-500 bg-blue-500/10"
                  : "border-gray-700 hover:border-gray-600 hover:bg-gray-700/50"
              }`}
            >
              <span className="text-xl">{opt.flag}</span>
              <div className="flex-1">
                <span
                  className={`text-sm font-medium ${
                    selected === opt.id ? "text-blue-400" : "text-gray-200"
                  }`}
                >
                  {t(opt.labelKey)}
                </span>
                <p className="text-xs text-gray-500">{opt.id.toUpperCase()}</p>
              </div>
              {selected === opt.id && (
                <svg
                  className="h-5 w-5 text-blue-400"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={handleContinue}
          className="mt-6 w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          {t("onboarding.langFirstRun.continue")}
        </button>
      </div>
    </div>
  );
}
