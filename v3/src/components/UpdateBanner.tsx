/**
 * Auto-update banner — surfaces electron-updater status to the user.
 *
 * Four flows:
 *   1. Regular update available → "Download" button (manual control).
 *   2. Update downloaded → "Restart now" button. Auto-installs on next quit
 *      anyway, but giving an explicit restart shortens the upgrade window
 *      for users who keep the app running for days.
 *   3. Hotfix downloaded → forced restart countdown. Banner shows
 *      remaining seconds + "Restart now" / "Postpone" buttons. When the
 *      timer expires, electron-updater main-process side calls
 *      quitAndInstall() regardless — Postpone only delays this session,
 *      hotfix re-fires on next launch.
 *   4. Download error → error-tone banner with status.error, manual download
 *      (GitHub releases), retry (updater.download), and dismiss. Render-only;
 *      main-process updater is not touched.
 *
 * Sits in Layout so it's visible from any tab.
 */
import { useEffect, useState } from "react";
import { useTranslation } from "../lib/i18n";

interface UpdateStatus {
  status:
    | "checking"
    | "available"
    | "not-available"
    | "downloading"
    | "downloaded"
    | "error";
  info?: { version?: string; releaseName?: string };
  progress?: { percent: number };
  error?: string;
  forceInstallInMs?: number;
}

/** Fallback when auto-update fails — open latest release in the OS browser. */
const MANUAL_DOWNLOAD_URL =
  "https://github.com/melocream/marblo-releases/releases/latest";

// updater API surface lives in src/vite-env.d.ts (ElectronAPI.updater).

export function UpdateBanner() {
  const { t } = useTranslation();
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const [hotfixSecondsLeft, setHotfixSecondsLeft] = useState<number | null>(
    null,
  );
  const [dismissed, setDismissed] = useState(false);

  // Subscribe to status updates.
  useEffect(() => {
    const api = window.electronAPI?.updater;
    if (!api?.onStatus) return;
    api.onStatus((s) => {
      setStatus(s);
      if (s.status === "downloaded" && typeof s.forceInstallInMs === "number") {
        setHotfixSecondsLeft(Math.ceil(s.forceInstallInMs / 1000));
      }
      // Reset dismissed flag when a fresh state arrives — user should
      // see the new status even if they dismissed the previous one.
      setDismissed(false);
    });
    return () => api.offStatus?.();
  }, []);

  // Hotfix countdown tick.
  useEffect(() => {
    if (hotfixSecondsLeft === null || hotfixSecondsLeft <= 0) return;
    const id = setInterval(() => {
      setHotfixSecondsLeft((s) => (s !== null && s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(id);
  }, [hotfixSecondsLeft]);

  if (!status || dismissed) return null;
  // checking / not-available stay silent; error is user-visible.
  const isHotfix = hotfixSecondsLeft !== null;
  const isError = status.status === "error";
  if (
    status.status !== "available" &&
    status.status !== "downloading" &&
    status.status !== "downloaded" &&
    status.status !== "error"
  ) {
    return null;
  }

  const handleDownload = () => window.electronAPI?.updater?.download?.();
  const handleInstall = () => window.electronAPI?.updater?.install?.();
  const handlePostpone = async () => {
    await window.electronAPI?.updater?.cancelHotfix?.();
    setHotfixSecondsLeft(null);
    setDismissed(true);
  };
  // main setWindowOpenHandler routes https _blank → shell.openExternal.
  const handleManualDownload = () => {
    window.open(MANUAL_DOWNLOAD_URL, "_blank", "noopener");
  };

  const version = status.info?.version ?? "";
  const percent = status.progress?.percent
    ? Math.round(status.progress.percent)
    : 0;
  const errorTone = isHotfix || isError;
  const errorMessage =
    status.error?.trim() || t("updater.errorFallback");

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-2 text-xs ${
        errorTone
          ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
          : "border-[#89b4fa]/30 bg-[#89b4fa]/10 text-[#89b4fa]"
      }`}
      role={isError ? "alert" : "status"}
    >
      {!isError && (
        <span>
          {isHotfix ? "🚨" : "✨"} v{version}
        </span>
      )}
      {isError && <span aria-hidden="true">⚠️</span>}

      {status.status === "available" && (
        <>
          <span className="text-[#bac2de]">{t("updater.available")}</span>
          <button
            onClick={handleDownload}
            className="ml-auto rounded bg-[#89b4fa]/20 px-3 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/30"
          >
            {t("updater.download")}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
          >
            {t("updater.later")}
          </button>
        </>
      )}

      {status.status === "downloading" && (
        <span className="ml-auto text-[#bac2de]">
          {t("updater.downloading", { percent })}
        </span>
      )}

      {status.status === "downloaded" && !isHotfix && (
        <>
          <span className="text-[#bac2de]">{t("updater.readyTitle")}</span>
          <button
            onClick={handleInstall}
            className="ml-auto rounded bg-[#89b4fa]/20 px-3 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/30"
          >
            {t("updater.restartNow")}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
          >
            {t("updater.close")}
          </button>
        </>
      )}

      {status.status === "downloaded" && isHotfix && (
        <>
          <span>{t("updater.hotfix", { count: hotfixSecondsLeft ?? 0 })}</span>
          <button
            onClick={handleInstall}
            className="ml-auto rounded bg-[#f38ba8]/20 px-3 py-1 text-[#f38ba8] hover:bg-[#f38ba8]/30"
          >
            {t("updater.restartNow")}
          </button>
          <button
            onClick={handlePostpone}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
            title={t("updater.postponeTitle")}
          >
            {t("updater.postpone")}
          </button>
        </>
      )}

      {status.status === "error" && (
        <>
          <span className="min-w-0 flex-1 truncate text-[#bac2de]" title={errorMessage}>
            {errorMessage}
          </span>
          <button
            onClick={handleManualDownload}
            className="ml-auto shrink-0 rounded bg-[#f38ba8]/20 px-3 py-1 text-[#f38ba8] hover:bg-[#f38ba8]/30"
          >
            {t("updater.manualDownload")}
          </button>
          <button
            onClick={handleDownload}
            className="shrink-0 rounded bg-[#f38ba8]/20 px-3 py-1 text-[#f38ba8] hover:bg-[#f38ba8]/30"
          >
            {t("updater.retry")}
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="shrink-0 rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
          >
            {t("updater.close")}
          </button>
        </>
      )}
    </div>
  );
}
