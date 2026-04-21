import { autoUpdater, UpdateInfo } from 'electron-updater';
import { BrowserWindow, ipcMain } from 'electron';
import { AppUpdater } from 'electron-updater';

export interface UpdateStatus {
  status: 'checking' | 'available' | 'not-available' | 'downloading' | 'downloaded' | 'error';
  info?: UpdateInfo;
  progress?: { percent: number };
  error?: string;
}

export class Updater {
  private mainWindow: BrowserWindow | null = null;

  constructor() {
    // Do not auto-download — let user decide
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    this.setupEventHandlers();
    this.setupIPC();
  }

  /**
   * Set the main window for sending update status events.
   */
  setMainWindow(win: BrowserWindow): void {
    this.mainWindow = win;
  }

  /**
   * Check for updates. Call on app start or manually.
   */
  checkForUpdates(): void {
    autoUpdater.checkForUpdates().catch((err: unknown) => {
      this.sendStatus({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Download the available update.
   */
  downloadUpdate(): void {
    autoUpdater.downloadUpdate().catch((err: unknown) => {
      this.sendStatus({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  /**
   * Quit and install the downloaded update.
   */
  quitAndInstall(): void {
    autoUpdater.quitAndInstall();
  }

  /**
   * Get the underlying autoUpdater instance for advanced config.
   */
  getAutoUpdater(): AppUpdater {
    return autoUpdater;
  }

  private setupEventHandlers(): void {
    autoUpdater.on('checking-for-update', () => {
      this.sendStatus({ status: 'checking' });
    });

    autoUpdater.on('update-available', (info: UpdateInfo) => {
      this.sendStatus({ status: 'available', info });
    });

    autoUpdater.on('update-not-available', (info: UpdateInfo) => {
      this.sendStatus({ status: 'not-available', info });
    });

    autoUpdater.on('download-progress', (progress: { percent: number }) => {
      this.sendStatus({
        status: 'downloading',
        progress: { percent: progress.percent },
      });
    });

    autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
      this.sendStatus({ status: 'downloaded', info });
    });

    autoUpdater.on('error', (err: Error) => {
      this.sendStatus({ status: 'error', error: err.message });
    });
  }

  private setupIPC(): void {
    ipcMain.handle('updater:check', () => {
      this.checkForUpdates();
    });

    ipcMain.handle('updater:download', () => {
      this.downloadUpdate();
    });

    ipcMain.handle('updater:install', () => {
      this.quitAndInstall();
    });
  }

  private sendStatus(update: UpdateStatus): void {
    if (this.mainWindow && !this.mainWindow.isDestroyed()) {
      this.mainWindow.webContents.send('updater:status', update);
    }
  }
}
