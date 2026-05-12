/**
 * Auto-update banner — surfaces electron-updater status to the user.
 *
 * Three flows:
 *   1. Regular update available → "Download" button (manual control).
 *   2. Update downloaded → "Restart now" button. Auto-installs on next quit
 *      anyway, but giving an explicit restart shortens the upgrade window
 *      for users who keep the app running for days.
 *   3. Hotfix downloaded → forced restart countdown. Banner shows
 *      remaining seconds + "Restart now" / "Postpone" buttons. When the
 *      timer expires, electron-updater main-process side calls
 *      quitAndInstall() regardless — Postpone only delays this session,
 *      hotfix re-fires on next launch.
 *
 * Sits in Layout so it's visible from any tab.
 */
import { useEffect, useState } from "react";

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

// updater API surface lives in src/vite-env.d.ts (ElectronAPI.updater).

export function UpdateBanner() {
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
  // We only render in three cases — checking/not-available/error are silent.
  const isHotfix = hotfixSecondsLeft !== null;
  if (
    status.status !== "available" &&
    status.status !== "downloading" &&
    status.status !== "downloaded"
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

  const version = status.info?.version ?? "";
  const percent = status.progress?.percent
    ? Math.round(status.progress.percent)
    : 0;

  return (
    <div
      className={`flex items-center gap-3 border-b px-4 py-2 text-xs ${
        isHotfix
          ? "border-[#f38ba8]/40 bg-[#f38ba8]/10 text-[#f38ba8]"
          : "border-[#89b4fa]/30 bg-[#89b4fa]/10 text-[#89b4fa]"
      }`}
      role="status"
    >
      <span>
        {isHotfix ? "🚨" : "✨"} v{version}
      </span>

      {status.status === "available" && (
        <>
          <span className="text-[#bac2de]">새 버전 사용 가능</span>
          <button
            onClick={handleDownload}
            className="ml-auto rounded bg-[#89b4fa]/20 px-3 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/30"
          >
            지금 다운로드
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
          >
            나중에
          </button>
        </>
      )}

      {status.status === "downloading" && (
        <span className="ml-auto text-[#bac2de]">
          다운로드 중... {percent}%
        </span>
      )}

      {status.status === "downloaded" && !isHotfix && (
        <>
          <span className="text-[#bac2de]">
            업데이트 준비 완료. 다음 종료 시 자동 적용됩니다.
          </span>
          <button
            onClick={handleInstall}
            className="ml-auto rounded bg-[#89b4fa]/20 px-3 py-1 text-[#89b4fa] hover:bg-[#89b4fa]/30"
          >
            지금 재시작
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
          >
            닫기
          </button>
        </>
      )}

      {status.status === "downloaded" && isHotfix && (
        <>
          <span>
            긴급 업데이트. {hotfixSecondsLeft}초 후 자동 재시작됩니다 — 작업을
            저장하세요.
          </span>
          <button
            onClick={handleInstall}
            className="ml-auto rounded bg-[#f38ba8]/20 px-3 py-1 text-[#f38ba8] hover:bg-[#f38ba8]/30"
          >
            지금 재시작
          </button>
          <button
            onClick={handlePostpone}
            className="rounded px-2 py-1 text-[#6c7086] hover:text-[#cdd6f4]"
            title="다음 실행 시 다시 적용됩니다"
          >
            연기 (다음 실행)
          </button>
        </>
      )}
    </div>
  );
}
