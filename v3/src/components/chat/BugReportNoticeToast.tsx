/**
 * BugReportNoticeToast — one-time, dismissible in-app notice that tells
 * existing users about the new 🐛 "Report a bug" button in the top bar
 * (added in PR #284). Shown once per install after an update; a localStorage
 * flag (`marblo:bugReportNoticeSeen`) keeps it from ever re-appearing —
 * same one-shot-flag idea as PrivacyConsent's `needsPrompt`.
 *
 * Non-blocking by design: it reuses ChatToastHost's top-center toast look
 * (fixed banner, backdrop blur, slide/fade, X to dismiss) rather than a
 * modal, so it never gates the app. It waits until the PIPA consent prompt
 * (if any) is resolved so the two first-run surfaces don't overlap.
 *
 * NOTE: this references the 🐛 button by copy only — it compiles and behaves
 * correctly even in a build where PR #284's button isn't present yet. It is
 * meaningful only once shipped alongside/after that button.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, X } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { BugReportModal } from "../settings/BugReportModal";

const STORAGE_KEY = "marblo:bugReportNoticeSeen";
// Slight delay so the notice doesn't slam in during the login → main-UI
// transition; long auto-dismiss because it's informational, not urgent.
const SHOW_DELAY_MS = 900;
const AUTO_DISMISS_MS = 12000;
const EXIT_DURATION_MS = 200;

function hasSeenNotice(): boolean {
  if (typeof window === "undefined") return true;
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    // localStorage unavailable (sandboxed) — treat as seen so we never nag.
    return true;
  }
}

function rememberSeen(): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, "1");
  } catch {
    // Non-persistent — the notice still won't reappear this session (state).
  }
}

export function BugReportNoticeToast() {
  const { t } = useTranslation();
  // Don't overlap the PIPA consent modal — wait until it's resolved.
  const privacyPrompting = usePrivacyConsentStore((s) => s.needsPrompt);

  const [visible, setVisible] = useState(false);
  const [isLeaving, setIsLeaving] = useState(false);
  const [showModal, setShowModal] = useState(false);

  useEffect(() => {
    if (privacyPrompting || hasSeenNotice()) return;
    const showTimer = window.setTimeout(() => {
      // Mark seen the moment we show it: a single exposure counts, even if
      // the user closes the app without explicitly dismissing.
      rememberSeen();
      setVisible(true);
    }, SHOW_DELAY_MS);
    return () => window.clearTimeout(showTimer);
  }, [privacyPrompting]);

  const dismiss = () => {
    setIsLeaving(true);
    window.setTimeout(() => setVisible(false), EXIT_DURATION_MS);
  };

  // Auto-dismiss after a while so it never lingers.
  useEffect(() => {
    if (!visible) return;
    const autoTimer = window.setTimeout(dismiss, AUTO_DISMISS_MS);
    return () => window.clearTimeout(autoTimer);
  }, [visible]);

  const openReport = () => {
    setVisible(false);
    setShowModal(true);
  };

  if (typeof document === "undefined") return null;

  return (
    <>
      {visible &&
        createPortal(
          <div className="pointer-events-none fixed left-0 right-0 top-4 z-[1000] flex justify-center px-4">
            <div
              role="status"
              aria-live="polite"
              className={`pointer-events-auto flex w-full max-w-md items-start gap-3 rounded-lg border border-gray-700 bg-gray-900/95 px-4 py-3 text-left shadow-2xl shadow-black/30 backdrop-blur transition-all duration-200 ${
                isLeaving
                  ? "-translate-y-2 opacity-0"
                  : "translate-y-0 opacity-100"
              }`}
            >
              <span className="mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
                <Bug className="h-4 w-4" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="block text-sm font-semibold text-gray-100">
                  {t("bugReport.notice.title")}
                </p>
                <p className="mt-0.5 block text-sm leading-5 text-gray-300">
                  {t("bugReport.notice.body")}
                </p>
                <button
                  type="button"
                  onClick={openReport}
                  className="mt-2 text-sm font-medium text-blue-400 hover:text-blue-300"
                >
                  {t("bugReport.notice.cta")}
                </button>
              </div>
              <button
                type="button"
                aria-label={t("bugReport.notice.dismiss")}
                onClick={dismiss}
                className="mt-0.5 flex-shrink-0 text-gray-500 hover:text-gray-300"
              >
                <X className="h-4 w-4" aria-hidden="true" />
              </button>
            </div>
          </div>,
          document.body,
        )}
      {showModal && <BugReportModal onClose={() => setShowModal(false)} />}
    </>
  );
}
