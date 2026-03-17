/** WebSocket URL for the terminal backend (ttyd or similar) */
export const TERMINAL_WS_URL =
  process.env.NEXT_PUBLIC_TERMINAL_WS_URL || "ws://localhost:7681/ws";

/** Default terminal panel height as a percentage of the viewport */
export const DEFAULT_TERMINAL_HEIGHT = 30;

/** Minimum terminal panel height (percent) */
export const MIN_TERMINAL_HEIGHT = 15;

/** Maximum terminal panel height (percent) */
export const MAX_TERMINAL_HEIGHT = 60;

/** localStorage key for persisting terminal panel height */
export const TERMINAL_STORAGE_KEY = "taskforce:terminal-height";
