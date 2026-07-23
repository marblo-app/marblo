// Hand-written minimal surface for the bits of @sentry/electron we actually
// use. This *shadows* the package's own types, so anything not declared here
// is invisible to the compiler — if you reach for a new SDK option, add it
// here first (that gap is how the missing `ipcMode` went unnoticed while
// every init silently threw at runtime; see electron/sentry-main.ts).
declare module "@sentry/electron/main" {
  /** How the main process receives events from renderers. */
  export enum IPCMode {
    Classic = 1,
    Protocol = 2,
    Both = 3,
  }

  export interface MainInitOptions {
    dsn?: string;
    release?: string;
    environment?: string;
    tracesSampleRate?: number;
    sendDefaultPii?: boolean;
    beforeSend?: (event: unknown) => unknown;
    /**
     * Defaults to `Both`, which registers a privileged protocol scheme and so
     * REQUIRES init before the Electron 'ready' event. Our init is
     * consent-driven (always post-ready), so we must pass `Classic`.
     */
    ipcMode?: IPCMode;
  }

  export function init(opts: MainInitOptions): void;
}

declare module "@sentry/electron/preload" {}
