/**
 * BugReportNoticeToast — one-time, dismissible first-run notice that welcomes
 * new beta users and points them at the in-app bug reporter. Shown once, then
 * never again: a localStorage flag (`marblo:betaBugReportNoticeSeen`) guards
 * re-exposure — same one-shot idea as PrivacyConsent's `needsPrompt`.
 *
 * A NEW storage key (vs. the old post-update discovery notice) is intentional:
 * the copy has changed to a beta-onboarding context, so users who dismissed the
 * old "new 🐛 button" notice should still see this beta welcome exactly once.
 *
 * Non-blocking by design: it renders as a bottom-center popup card whose
 * backdrop is click-through (`pointer-events-none` on the wrapper, re-enabled
 * only on the card), so it never gates the app — no dark overlay, no modal
 * trap. It waits until the PIPA consent prompt (if any) is resolved so the two
 * first-run surfaces don't overlap. Unlike a fleeting toast it does NOT
 * auto-dismiss: this is a one-time welcome we want the user to actually read,
 * so it persists until they act (CTA) or close it (X).
 *
 * CTA reuses the existing BugReportModal / submitBugReport path — no new
 * backend. It complements (does not replace) the Header 🐛 button and the
 * Settings bug-report tab; this popup is just the first-run hand-hold.
 */
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Bug, X } from "lucide-react";
import { useTranslation } from "../../lib/i18n";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { BugReportModal } from "../settings/BugReportModal";

const STORAGE_KEY = "marblo:betaBugReportNoticeSeen";
// Slight delay so the notice doesn't slam in during the login → main-UI
// transition. No auto-dismiss: a one-time beta welcome should stay until read.
const SHOW_DELAY_MS = 900;
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

  const openReport = () => {
    setVisible(false);
    setShowModal(true);
  };

  if (typeof document === "undefined") return null;

  return (
    <>
      {visible &&
        createPortal(
          <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[1000] flex justify-center px-4">
            <div
              role="status"
              aria-live="polite"
              className={`pointer-events-auto relative flex w-full max-w-lg items-start gap-3.5 overflow-hidden rounded-xl border border-blue-500/40 bg-gray-900/95 px-5 py-4 text-left shadow-2xl shadow-blue-950/40 ring-1 ring-blue-500/10 backdrop-blur transition-all duration-200 ${
                isLeaving
                  ? "translate-y-3 opacity-0"
                  : "translate-y-0 opacity-100"
              }`}
            >
              {/* Accent rail — extra visual weight vs. a plain toast. */}
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-blue-400 to-blue-600"
              />
              <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-blue-500/15 text-blue-300">
                <Bug className="h-5 w-5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="inline-flex items-center rounded-full bg-blue-500/20 px-2 py-0.5 text-[11px] font-bold uppercase tracking-wide text-blue-300">
                    {t("bugReport.notice.badge")}
                  </span>
                  <p className="block text-sm font-semibold text-gray-100">
                    {t("bugReport.notice.title")}
                  </p>
                </div>
                <p className="mt-1.5 block text-sm leading-5 text-gray-300">
                  {t("bugReport.notice.body")}
                </p>
                <button
                  type="button"
                  onClick={openReport}
                  className="mt-3 inline-flex items-center gap-1.5 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-medium text-white transition-colors hover:bg-blue-500"
                >
                  <Bug className="h-4 w-4" aria-hidden="true" />
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
