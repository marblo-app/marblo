/** Minimal stand-in so the agent path can run outside Electron. */
export class BrowserWindow {
  webContents = { send: () => {} };
  isDestroyed(): boolean {
    return false;
  }
}
export const app = {
  getPath: () => "/tmp",
  getVersion: () => "0.0.0-live",
  isPackaged: false,
  getAppPath: () => "/tmp",
  on: () => {},
};
export const ipcMain = { handle: () => {}, on: () => {} };
export const dialog = {};
export const shell = {};
export const Notification = class {
  show(): void {}
};
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.from(""),
  decryptString: () => "",
};
export default { app, BrowserWindow, ipcMain };
