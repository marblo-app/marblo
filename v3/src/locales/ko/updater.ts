/**
 * Korean — `updater.*` namespace (components/UpdateBanner auto-update banner).
 *
 * Covers four visible flows: update available, downloaded (graceful),
 * hotfix (forced-restart countdown), and download error (retry / manual).
 * Version strings and percentages are data — interpolated via
 * {version}/{percent}/{count} placeholders.
 */
export const updater = {
  "updater.available": "새 버전 사용 가능",
  "updater.download": "지금 다운로드",
  "updater.later": "나중에",
  "updater.downloading": "다운로드 중... {percent}%",
  "updater.readyTitle": "업데이트 준비 완료. 다음 종료 시 자동 적용됩니다.",
  "updater.restartNow": "지금 재시작",
  "updater.close": "닫기",
  "updater.hotfix":
    "긴급 업데이트. {count}초 후 자동 재시작됩니다 — 작업을 저장하세요.",
  "updater.postpone": "연기 (다음 실행)",
  "updater.postponeTitle": "다음 실행 시 다시 적용됩니다",
  "updater.errorFallback": "업데이트 다운로드에 실패했습니다.",
  "updater.manualDownload": "수동 다운로드",
  "updater.retry": "재시도",
};
