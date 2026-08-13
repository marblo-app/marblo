/**
 * Privacy policy page. Linked from the consent modal "자세히 보기" and
 * from Settings → Privacy. Matches PIPA 제15조 제2항 동의 항목 + the
 * §15.4 table from the v3.1 launch master plan.
 *
 * This is read-only content. Update CURRENT_POLICY_VERSION in
 * privacyConsentService.ts when this text changes — that re-prompts
 * existing users on next launch.
 *
 * i18n: page chrome uses `legal.*` keys; the long-form policy body lives in
 * `privacyContent.tsx` as split ko/en, picked by the active locale here.
 */
import { useTranslation } from "../../lib/i18n";
import { PRIVACY_CONTENT } from "./privacyContent";

interface PrivacyPolicyPageProps {
  /** Optional close handler — when rendered as a modal sheet. */
  onClose?: () => void;
}

export function PrivacyPolicyPage({ onClose }: PrivacyPolicyPageProps) {
  const { t, locale } = useTranslation();
  const content = PRIVACY_CONTENT[locale];

  return (
    <div className="flex h-full w-full flex-col bg-[#181825] text-[#cdd6f4]">
      <div className="flex items-center justify-between border-b border-[#313244] px-6 py-4">
        <h1 className="text-base font-semibold">{t("legal.privacy.title")}</h1>
        {onClose && (
          <button
            type="button"
            onClick={onClose}
            className="rounded p-1 text-[#6c7086] hover:bg-[#313244] hover:text-[#cdd6f4]"
            aria-label={t("legal.privacy.close")}
          >
            <svg
              className="h-5 w-5"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto px-6 py-6 space-y-5 text-sm">
        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            {t("legal.privacy.summaryHeading")}
          </h2>
          <p className="text-[#bac2de] leading-relaxed">{content.summary}</p>
        </section>

        <section className="rounded border border-[#313244] bg-[#11111b]">
          <table className="w-full text-xs">
            <tbody>
              {content.rows.map((r) => (
                <tr
                  key={r.label}
                  className="border-b border-[#313244] last:border-0"
                >
                  <th className="w-32 px-3 py-2 text-left align-top font-medium text-[#6c7086]">
                    {r.label}
                  </th>
                  <td className="px-3 py-2 text-[#cdd6f4] leading-relaxed">
                    {r.value}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            {t("legal.privacy.measuresHeading")}
          </h2>
          <ul className="list-disc pl-5 text-[#bac2de] space-y-1">
            {content.measures.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          <p className="mt-2 text-[10px] text-[#6c7086]">
            {content.measuresFootnote}
          </p>
        </section>

        <section>
          <h2 className="mb-2 text-xs uppercase tracking-wide text-[#89b4fa]">
            {t("legal.privacy.contactHeading")}
          </h2>
          <p className="text-[#bac2de]">
            {t("legal.privacy.contactPrefix")}
            <a
              href="mailto:team@marblo.app"
              className="text-[#89b4fa] hover:underline"
            >
              team@marblo.app
            </a>
          </p>
        </section>
      </div>
    </div>
  );
}
