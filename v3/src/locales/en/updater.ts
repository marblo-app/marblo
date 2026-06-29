/**
 * English — `updater.*` namespace. Typed against the ko counterpart so key
 * drift is a compile-time error.
 */
import type { updater as koUpdater } from "../ko/updater";

export const updater: Record<keyof typeof koUpdater, string> = {
  "updater.available": "A new version is available",
  "updater.download": "Download now",
  "updater.later": "Later",
  "updater.downloading": "Downloading... {percent}%",
  "updater.readyTitle": "Update ready. It installs automatically on next quit.",
  "updater.restartNow": "Restart now",
  "updater.close": "Close",
  "updater.hotfix":
    "Critical update. Restarting automatically in {count}s — save your work.",
  "updater.postpone": "Postpone (next launch)",
  "updater.postponeTitle": "Will re-apply on next launch",
};
