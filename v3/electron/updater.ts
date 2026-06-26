import { autoUpdater, UpdateInfo } from "electron-updater";
import { BrowserWindow, ipcMain } from "electron";
import { AppUpdater } from "electron-updater";
import type { GithubOptions } from "builder-util-runtime";

export type UpdateStage =
  | "checking"
  | "available"
  | "not-available"
  | "downloading"
  | "downloaded"
  | "error";

export interface UpdateStatus {
  status: UpdateStage;
  info?: UpdateInfo;
  progress?: { percent: number };
  error?: string;
  /** Whether the user is about to be force-restarted (hotfix path). */
  forceInstallInMs?: number;
}

/** Periodic re-check interval — long-running sessions may miss the on-launch
 *  check. 4h is conservative: catches same-day hotfixes without spamming. */
const RECHECK_INTERVAL_MS = 4 * 3600 * 1000;

/** When a hotfix release is detected (channel: "hotfix" or release notes
 *  contain a [HOTFIX] tag), schedule auto-install after this grace window
 *  to give the user time to save work. Default 5 minutes. */
const DEFAULT_HOTFIX_GRACE_MS = 5 * 60 * 1000;

const DEFAULT_UPDATE_FEED_OWNER = "melocream";
// Must match electron-builder.yml's `publish` target. The source repo
// (melocream/marblo) is private, so releases are published to the PUBLIC
// melocream/marblo-releases repo (electron-updater can't anonymously download
// assets from a private repo). Pointing this at "marblo" makes the app poll a
// repo with no public releases → auto-update silently never finds an update.
const DEFAULT_UPDATE_FEED_REPO = "marblo-releases";
const DEFAULT_UPDATE_FEED_CHANNEL = "latest";

function getUpdaterEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function resolveGithubFeedOptions(): GithubOptions {
  const privateFeed = getUpdaterEnv("MARBLO_UPDATER_PRIVATE") === "true";
  const token =
    getUpdaterEnv("MARBLO_UPDATER_TOKEN") ?? getUpdaterEnv("GH_TOKEN");

  return {
    provider: "github",
    owner: getUpdaterEnv("MARBLO_UPDATER_OWNER") ?? DEFAULT_UPDATE_FEED_OWNER,
    repo: getUpdaterEnv("MARBLO_UPDATER_REPO") ?? DEFAULT_UPDATE_FEED_REPO,
    channel:
      getUpdaterEnv("MARBLO_UPDATER_CHANNEL") ?? DEFAULT_UPDATE_FEED_CHANNEL,
    ...(privateFeed ? { private: true, token } : {}),
  };
}

export class Updater {
  private mainWindow: BrowserWindow | null = null;
  private recheckTimer: ReturnType<typeof setInterval> | null = null;
  private hotfixInstallTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    // Manual download by default — gives user control. Hotfix path flips
    // this to true via shouldAutoInstall() check on update-available.
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;
    // Keep runtime update checks pinned to the release repo instead of relying
    // on package.json repository inference, which can drift during repo moves.
    autoUpdater.setFeedURL(resolveGithubFeedOptions());

    this.setupEventHandlers();
    this.setupIPC();
    this.startPeriodicRecheck();
  }

  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /** Check on app start or manually. */
  checkForUpdates(): void {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      this.sendStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  downloadUpdate(): void {
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      this.sendStatus({
        status: "error",
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  quitAndInstall(): void {
    if (this.hotfixInstallTimer) {
      clearTimeout(this.hotfixInstallTimer);
      this.hotfixInstallTimer = null;
    }
    autoUpdater.quitAndInstall();
  }

  /** Cancel a pending hotfix forced install (user clicked "Postpone"). */
  cancelHotfixInstall(): void {
    if (this.hotfixInstallTimer) {
      clearTimeout(this.hotfixInstallTimer);
      this.hotfixInstallTimer = null;
    }
  }

  getAutoUpdater(): AppUpdater {
    return autoUpdater;
  }

  /**
   * Decide whether a given release should bypass the manual download and
   * force-install path. Pure function for testability.
   *
   * Hotfix signals (any one triggers):
   *  - releaseName contains "[HOTFIX]" (case-insensitive)
   *  - releaseNotes contains "[HOTFIX]" (case-insensitive)
   *  - update channel name is "hotfix"
   */
  static isHotfix(info: UpdateInfo): boolean {
    const HOTFIX = /\[HOTFIX\]/i;
    if (info.releaseName && HOTFIX.test(info.releaseName)) return true;
    const notes = info.releaseNotes;
    if (typeof notes === "string" && HOTFIX.test(notes)) return true;
    if (Array.isArray(notes)) {
      for (const n of notes) {
        const text = typeof n === "string" ? n : n?.note ?? "";
        if (HOTFIX.test(text)) return true;
      }
    }
    // electron-updater exposes the resolved channel on the AppUpdater
    // instance after the first check. autoUpdater.channel is a string
    // when set (e.g. "alpha", "beta", "hotfix") or null/undefined.
    const ch = (autoUpdater as unknown as { channel?: string }).channel;
    if (typeof ch === "string" && ch.toLowerCase() === "hotfix") return true;
    return false;
  }

  private startPeriodicRecheck(): void {
    this.recheckTimer = setInterval(() => {
      // Best-effort — errors flow through sendStatus already.
      autoUpdater.checkForUpdates().catch(() => {});
    }, RECHECK_INTERVAL_MS);
  }

  private scheduleHotfixInstall(info: UpdateInfo): void {
    if (this.hotfixInstallTimer) return; // already scheduled
    this.sendStatus({
      status: "downloaded",
      info,
      forceInstallInMs: DEFAULT_HOTFIX_GRACE_MS,
    });
    this.hotfixInstallTimer = setTimeout(() => {
      autoUpdater.quitAndInstall();
    }, DEFAULT_HOTFIX_GRACE_MS);
  }

  private setupEventHandlers(): void {
    autoUpdater.on("checking-for-update", () => {
      this.sendStatus({ status: "checking" });
    });

    autoUpdater.on("update-available", (info: UpdateInfo) => {
      this.sendStatus({ status: "available", info });
      // Hotfix: auto-download. Regular update: wait for user confirm.
      if (Updater.isHotfix(info)) {
        autoUpdater.downloadUpdate().catch((err: unknown) => {
          this.sendStatus({
            status: "error",
            error: err instanceof Error ? err.message : String(err),
          });
        });
      }
    });

    autoUpdater.on("update-not-available", (info: UpdateInfo) => {
      this.sendStatus({ status: "not-available", info });
    });

    autoUpdater.on("download-progress", (progress: { percent: number }) => {
      this.sendStatus({
        status: "downloading",
        progress: { percent: progress.percent },
      });
    });

    autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
      // Hotfix → schedule forced restart. Regular → just notify; the
      // OS-quit-driven install handles it on next quit.
      if (Updater.isHotfix(info)) {
        this.scheduleHotfixInstall(info);
      } else {
        this.sendStatus({ status: "downloaded", info });
      }
    });

    autoUpdater.on("error", (err: Error) => {
      this.sendStatus({ status: "error", error: err.message });
    });
  }

  private setupIPC(): void {
    ipcMain.handle("updater:check", () => {
      this.checkForUpdates();
    });

    ipcMain.handle("updater:download", () => {
      this.downloadUpdate();
    });

    ipcMain.handle("updater:install", () => {
      this.quitAndInstall();
    });

    ipcMain.handle("updater:cancelHotfix", () => {
      this.cancelHotfixInstall();
    });
  }

  private sendStatus(update: UpdateStatus): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send("updater:status", update);
    }
  }
}
