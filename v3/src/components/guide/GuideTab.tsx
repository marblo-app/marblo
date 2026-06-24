/**
 * Guide tab — onboarding-friendly first-tab cheatsheet for Marblo's
 * required workflow primitives (TaskForce slash commands, Marblo MCP,
 * multi-window, Harness store).
 *
 * Pure content. No backend calls. Designed to be the first thing a new
 * user sees so they understand the building blocks before opening the
 * Board / Code / Agents tabs.
 *
 * i18n: page chrome (title/subtitle/footer) uses `guide.*` keys; the
 * long-form body lives in `guideContent.tsx` as split ko/en blocks, picked
 * by the active locale here. See ../../locales/README.md.
 */
import { useTranslation } from "../../lib/i18n";
import { GUIDE_CONTENT } from "./guideContent";

export function GuideTab() {
  const { t, locale } = useTranslation();
  const { sections } = GUIDE_CONTENT[locale];

  return (
    <div className="h-full w-full overflow-y-auto bg-[#181825] p-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <header className="border-b border-[#313244] pb-4">
          <h1 className="text-xl font-bold text-[#cdd6f4]">
            {t("guide.title")}
          </h1>
          <p className="mt-1 text-sm text-[#6c7086]">{t("guide.subtitle")}</p>
        </header>

        {sections.map((section) => (
          <section
            key={section.title}
            className="rounded-md border border-[#313244] bg-[#1e1e2e] p-4"
          >
            <h2 className="mb-3 text-base font-semibold text-[#cdd6f4]">
              {section.title}
            </h2>
            {section.body}
          </section>
        ))}

        <footer className="border-t border-[#313244] pt-4 text-xs text-[#6c7086]">
          {t("guide.footerPrefix")}
          <code>docs/MVP/project_status.md</code>
          {t("guide.footerSuffix")}
        </footer>
      </div>
    </div>
  );
}
