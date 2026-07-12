declare module "@sentry/electron/main" {
  export interface MainInitOptions {
    dsn?: string;
    release?: string;
    environment?: string;
    tracesSampleRate?: number;
    sendDefaultPii?: boolean;
    beforeSend?: (event: unknown) => unknown;
  }

  export function init(opts: MainInitOptions): void;
}

declare module "@sentry/electron/preload" {}
