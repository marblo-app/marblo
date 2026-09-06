import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import { broaderCookieDomains } from "../../../electron/browser-pane-site-data-policy";

/**
 * Ticket nvrzSFU0xJMPuRqr0EeR — destructive confirm modal for clearing ONE
 * site's stored data in a webtab pane. Mirrors LaneDeleteConfirmModal's
 * pattern (window.confirm replacement, cleanup owned by the caller): this
 * component only previews what will be deleted and collects confirm/cancel.
 * `BrowserPane` performs the actual `clearSiteData` IPC call and reload.
 */

const CATEGORY_IDS = [
  "cookies",
  "cache",
  "serviceWorkers",
  "localStorage",
] as const;

export interface ClearSiteDataModalProps {
  host: string;
  loading: boolean;
  previewError: string | null;
  cookies: SiteDataCookiePreview[] | null;
  confirming: boolean;
  confirmError: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}

export function ClearSiteDataModal({
  host,
  loading,
  previewError,
  cookies,
  confirming,
  confirmError,
  onCancel,
  onConfirm,
}: ClearSiteDataModalProps) {
  const { t } = useTranslation();
  // Ticket zYzwb3Q5hKT6o3Nl9aZh: the actual clear now reaches every cookie
  // shown below, including parent-domain ones — so the owner needs to know
  // *before* confirming when that means logging out of more than this host.
  const domainWarning = cookies ? broaderCookieDomains(cookies, host) : [];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !confirming) onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [confirming, onCancel]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="clear-site-data-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50"
      onClick={() => {
        if (!confirming) onCancel();
      }}
    >
      <div
        className="w-[440px] rounded-lg border border-red-500/30 bg-gray-800 p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3
          id="clear-site-data-title"
          className="mb-2 text-sm font-semibold text-red-300"
        >
          {t("workspace.browser.clearSiteData.title", { host })}
        </h3>
        <p className="mb-3 text-sm text-gray-200">
          {t("workspace.browser.clearSiteData.body")}
        </p>

        <div className="mb-3 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-200">
          <p className="mb-1 font-medium">
            {t("workspace.browser.clearSiteData.categoriesHeader")}
          </p>
          <ul className="list-inside list-disc space-y-0.5 text-red-300/90">
            {CATEGORY_IDS.map((id) => (
              <li key={id}>
                {t(`workspace.browser.clearSiteData.category.${id}`)}
              </li>
            ))}
          </ul>
        </div>

        <div
          data-testid="clear-site-data-cookie-preview"
          className="mb-4 max-h-40 overflow-y-auto rounded border border-gray-700 bg-gray-900 px-3 py-2 text-xs text-gray-300"
        >
          {loading && (
            <p className="text-gray-500">
              {t("workspace.browser.clearSiteData.loading")}
            </p>
          )}
          {!loading && previewError && (
            <p className="text-amber-300">{previewError}</p>
          )}
          {!loading && !previewError && cookies && (
            <>
              <p className="mb-1 font-medium text-gray-200">
                {t("workspace.browser.clearSiteData.cookiesHeader", {
                  count: cookies.length,
                })}
              </p>
              {cookies.length === 0 ? (
                <p className="text-gray-500">
                  {t("workspace.browser.clearSiteData.noCookies")}
                </p>
              ) : (
                <ul className="space-y-1">
                  {cookies.map((cookie) => (
                    <li
                      key={`${cookie.domain}:${cookie.name}`}
                      className="flex items-baseline justify-between gap-2 font-mono"
                    >
                      <span className="min-w-0 flex-1 truncate">
                        {cookie.name}
                      </span>
                      <span className="flex-shrink-0 text-gray-500">
                        {cookie.domain}
                      </span>
                      <span className="flex-shrink-0 text-gray-600">
                        {cookie.expiresAt === null
                          ? t("workspace.browser.clearSiteData.sessionCookie")
                          : new Date(
                              cookie.expiresAt * 1000,
                            ).toLocaleDateString()}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>

        {domainWarning.length > 0 && (
          <div
            data-testid="clear-site-data-domain-warning"
            className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200"
          >
            {t("workspace.browser.clearSiteData.domainScopeWarning", {
              domains: domainWarning.join(", "),
            })}
          </div>
        )}

        {confirmError && (
          <p className="mb-3 text-xs text-red-300">{confirmError}</p>
        )}

        <div className="flex justify-end gap-2">
          <button
            autoFocus
            type="button"
            disabled={confirming}
            onClick={onCancel}
            className="rounded px-3 py-1.5 text-sm text-gray-400 hover:text-gray-200 disabled:opacity-40"
          >
            {t("workspace.browser.clearSiteData.cancel")}
          </button>
          <button
            type="button"
            disabled={loading || confirming}
            onClick={onConfirm}
            className="rounded bg-red-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-red-500 disabled:opacity-40"
          >
            {confirming
              ? t("workspace.browser.clearSiteData.confirming")
              : t("workspace.browser.clearSiteData.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
