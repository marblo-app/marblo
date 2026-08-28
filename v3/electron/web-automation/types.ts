export const BROWSER_AUTOMATION_CHANNEL = "chrome" as const;

export type BrowserAutomationStatus =
  | "READY"
  | "RUNNING"
  | "NEEDS_BROWSER_INSTALL"
  | "NEEDS_HUMAN_AUTH"
  | "WAITING_FOR_HUMAN"
  | "RESUMING"
  | "EXPIRED_DISABLED";

export type BrowserSessionHumanActionReason =
  | "CHROME_NOT_INSTALLED"
  | "NO_STORED_SESSION"
  | "SESSION_EXPIRED"
  | "SESSION_VERIFICATION_STALE"
  | "AUTH_GATE_DETECTED"
  | "MFA_REQUIRED"
  | "CAPTCHA_REQUIRED"
  | "CONSECUTIVE_AUTH_FAILURES";

export interface BrowserSessionCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

export interface BrowserSessionStorageEntry {
  name: string;
  value: string;
}

export interface BrowserSessionOriginState {
  origin: string;
  localStorage: BrowserSessionStorageEntry[];
}

export interface BrowserStorageState {
  cookies: BrowserSessionCookie[];
  origins: BrowserSessionOriginState[];
}

export interface BrowserSessionRecord {
  storageState: BrowserStorageState;
  origins: string[];
  browserChannel: typeof BROWSER_AUTOMATION_CHANNEL;
  profileHint?: string;
  capturedAt: number;
  lastVerifiedAt?: number;
  expiresAt: number;
  consentLabel: string;
  consecutiveAuthFailures: number;
  disabledAt?: number;
  disabledReason?: BrowserSessionHumanActionReason;
}

export interface BrowserSessionSummary {
  connected: boolean;
  siteKey: string;
  origins: string[];
  browserChannel: typeof BROWSER_AUTOMATION_CHANNEL;
  profileHint?: string;
  capturedAt: number;
  lastVerifiedAt?: number;
  expiresAt: number;
  consentLabel: string;
  status: BrowserAutomationStatus;
  humanActionReason?: BrowserSessionHumanActionReason;
  cookieCount: number;
  localStorageOriginCount: number;
}

export interface SaveBrowserSessionInput {
  userId: string;
  siteKey: string;
  origins: string[];
  storageState: BrowserStorageState;
  consentLabel: string;
  profileHint?: string;
  capturedAt?: number;
  lastVerifiedAt?: number;
  expiresAt?: number;
}

export interface BrowserSessionHealth {
  status: "READY" | "NEEDS_HUMAN_AUTH" | "EXPIRED_DISABLED";
  humanActionReason?: BrowserSessionHumanActionReason;
}

export interface BrowserSessionLeakageGuard {
  path: string;
  blockedBy: string;
}
