/**
 * Guide tab — the "what is this and where do I do it" reference for the app.
 *
 * Pure content. No backend calls. Deliberately NOT the setup surface: the
 * 시작하기 (Start here) tab owns install / sign-in / folder / first ticket with
 * live probe state, and this page links to it rather than repeating the steps
 * (see the scope note atop guideContent.tsx).
 *
 * The body is long enough that a reader who came for one answer should not have
 * to scroll for it, so the sections are anchored and a jump bar sits under the
 * header.
 *
 * i18n: page chrome (title/subtitle/nav/footer) uses `guide.*` keys; the
 * long-form body lives in `guideContent.tsx` as split ko/en blocks, picked by
 * the active locale here. See ../../locales/README.md.
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

          <nav
            aria-label={t("guide.jumpLabel")}
            className="mt-3 flex flex-wrap gap-1.5"
          >
            {sections.map((section) => (
              <a
                key={section.id}
                href={`#guide-${section.id}`}
                className="rounded-full border border-[#313244] px-2.5 py-1 text-xs text-[#a6adc8] transition-colors hover:border-[#89b4fa]/50 hover:text-[#cdd6f4]"
              >
                {section.title}
              </a>
            ))}
          </nav>
        </header>

        {sections.map((section) => (
          <section
            key={section.id}
            id={`guide-${section.id}`}
            className="scroll-mt-4 rounded-md border border-[#313244] bg-[#1e1e2e] p-4"
          >
            <h2 className="mb-3 text-base font-semibold text-[#cdd6f4]">
              {section.title}
            </h2>
            {section.body}
          </section>
        ))}

        <footer className="border-t border-[#313244] pt-4 text-xs leading-relaxed text-[#6c7086]">
          {t("guide.footer")}
        </footer>
      </div>
    </div>
  );
}
