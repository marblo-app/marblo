import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { SafeStorage } from "electron";

import {
  BROWSER_AUTOMATION_CHANNEL,
  type BrowserSessionHealth,
  type BrowserSessionHumanActionReason,
  type BrowserSessionRecord,
  type BrowserSessionSummary,
  type BrowserStorageState,
  type SaveBrowserSessionInput,
} from "./types";

const STORE_DIRECTORY = path.join(os.homedir(), ".marblo");
const STORE_FILE = path.join(STORE_DIRECTORY, "browser-sessions.enc.json");
const DEFAULT_SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const MAX_SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const DEFAULT_VERIFICATION_STALE_MS = 24 * 60 * 60 * 1000;
const MAX_CONSECUTIVE_AUTH_FAILURES = 3;

interface EncryptedBrowserSessionStore {
  version: 1;
  accounts: Record<string, Record<string, string>>;
}

export interface BrowserSessionStoreOptions {
  storeFile?: string;
  verificationStaleMs?: number;
}

export interface StoredBrowserSession {
  userId: string;
  siteKey: string;
  record: BrowserSessionRecord;
  health: BrowserSessionHealth;
}

export class BrowserSessionStore {
  private readonly storeFile: string;
  private readonly verificationStaleMs: number;

  constructor(options: BrowserSessionStoreOptions = {}) {
    this.storeFile = options.storeFile ?? STORE_FILE;
    this.verificationStaleMs =
      options.verificationStaleMs ?? DEFAULT_VERIFICATION_STALE_MS;
  }

  saveSession(
    storage: SafeStorage,
    input: SaveBrowserSessionInput,
  ): BrowserSessionSummary {
    assertSafeStorage(storage);
    const now = input.capturedAt ?? Date.now();
    const siteKey = normalizeSiteKey(input.siteKey);
    const origins = normalizeOrigins(input.origins);
    const storageState = validateStorageState(input.storageState);
    const expiresAt = resolveExpiresAt(storageState, now, input.expiresAt);
    const record: BrowserSessionRecord = {
      storageState,
      origins,
      browserChannel: BROWSER_AUTOMATION_CHANNEL,
      profileHint: normalizeOptionalLabel(input.profileHint),
      capturedAt: now,
      lastVerifiedAt: input.lastVerifiedAt ?? now,
      expiresAt,
      consentLabel: normalizeConsentLabel(input.consentLabel),
      consecutiveAuthFailures: 0,
    };

    const store = this.readStore();
    store.accounts[input.userId] = store.accounts[input.userId] ?? {};
    store.accounts[input.userId][siteKey] = storage
      .encryptString(JSON.stringify(record))
      .toString("base64");
    this.writeStore(store);
    return this.toSummary(siteKey, record, now);
  }

  listSessions(
    storage: SafeStorage,
    userId: string,
    now = Date.now(),
  ): BrowserSessionSummary[] {
    assertSafeStorage(storage);
    const account = this.readStore().accounts[userId] ?? {};
    return Object.entries(account)
      .map(([siteKey, encrypted]) => {
        const record = this.decryptRecord(storage, encrypted);
        return record ? this.toSummary(siteKey, record, now) : null;
      })
      .filter((entry): entry is BrowserSessionSummary => entry !== null)
      .sort((a, b) => a.siteKey.localeCompare(b.siteKey));
  }

  deleteSession(_storage: SafeStorage, userId: string, siteKey: string): void {
    const normalized = normalizeSiteKey(siteKey);
    const store = this.readStore();
    if (!store.accounts[userId]?.[normalized]) return;
    delete store.accounts[userId][normalized];
    if (Object.keys(store.accounts[userId]).length === 0) {
      delete store.accounts[userId];
    }
    this.writeStore(store);
  }

  getSessionForAutomation(
    storage: SafeStorage,
    userId: string,
    siteKey: string,
    now = Date.now(),
  ):
    | { ok: true; session: StoredBrowserSession }
    | {
        ok: false;
        status: "NEEDS_HUMAN_AUTH" | "EXPIRED_DISABLED";
        humanActionReason: BrowserSessionHumanActionReason;
        summary?: BrowserSessionSummary;
      } {
    assertSafeStorage(storage);
    const normalized = normalizeSiteKey(siteKey);
    const encrypted = this.readStore().accounts[userId]?.[normalized];
    if (!encrypted) {
      return {
        ok: false,
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: "NO_STORED_SESSION",
      };
    }
    const record = this.decryptRecord(storage, encrypted);
    if (!record) {
      return {
        ok: false,
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: "NO_STORED_SESSION",
      };
    }
    const health = this.assessHealth(record, now);
    if (health.status !== "READY") {
      return {
        ok: false,
        status: health.status,
        humanActionReason: health.humanActionReason ?? "SESSION_EXPIRED",
        summary: this.toSummary(normalized, record, now),
      };
    }
    return {
      ok: true,
      session: { userId, siteKey: normalized, record, health },
    };
  }

  markVerified(
    storage: SafeStorage,
    userId: string,
    siteKey: string,
    verifiedAt = Date.now(),
  ): BrowserSessionSummary | null {
    return this.updateRecord(storage, userId, siteKey, (record) => ({
      ...record,
      lastVerifiedAt: verifiedAt,
      consecutiveAuthFailures: 0,
      disabledAt: undefined,
      disabledReason: undefined,
    }));
  }

  recordAuthFailure(
    storage: SafeStorage,
    userId: string,
    siteKey: string,
    reason: BrowserSessionHumanActionReason,
    failedAt = Date.now(),
  ): BrowserSessionSummary | null {
    return this.updateRecord(storage, userId, siteKey, (record) => {
      const failures = record.consecutiveAuthFailures + 1;
      return {
        ...record,
        consecutiveAuthFailures: failures,
        disabledAt:
          failures >= MAX_CONSECUTIVE_AUTH_FAILURES ? failedAt : undefined,
        disabledReason:
          failures >= MAX_CONSECUTIVE_AUTH_FAILURES
            ? "CONSECUTIVE_AUTH_FAILURES"
            : reason,
      };
    });
  }

  assessHealth(
    record: BrowserSessionRecord,
    now = Date.now(),
  ): BrowserSessionHealth {
    if (
      record.disabledAt ||
      record.disabledReason === "CONSECUTIVE_AUTH_FAILURES"
    ) {
      return {
        status: "EXPIRED_DISABLED",
        humanActionReason: record.disabledReason ?? "CONSECUTIVE_AUTH_FAILURES",
      };
    }
    if (record.expiresAt <= now) {
      return {
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: "SESSION_EXPIRED",
      };
    }
    if (record.consecutiveAuthFailures > 0 && record.disabledReason) {
      return {
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: record.disabledReason,
      };
    }
    if (
      record.lastVerifiedAt !== undefined &&
      now - record.lastVerifiedAt > this.verificationStaleMs
    ) {
      return {
        status: "NEEDS_HUMAN_AUTH",
        humanActionReason: "SESSION_VERIFICATION_STALE",
      };
    }
    return { status: "READY" };
  }

  private updateRecord(
    storage: SafeStorage,
    userId: string,
    siteKey: string,
    updater: (record: BrowserSessionRecord) => BrowserSessionRecord,
  ): BrowserSessionSummary | null {
    assertSafeStorage(storage);
    const normalized = normalizeSiteKey(siteKey);
    const store = this.readStore();
    const encrypted = store.accounts[userId]?.[normalized];
    if (!encrypted) return null;
    const record = this.decryptRecord(storage, encrypted);
    if (!record) return null;
    const next = updater(record);
    store.accounts[userId][normalized] = storage
      .encryptString(JSON.stringify(next))
      .toString("base64");
    this.writeStore(store);
    return this.toSummary(normalized, next, Date.now());
  }

  private toSummary(
    siteKey: string,
    record: BrowserSessionRecord,
    now: number,
  ): BrowserSessionSummary {
    const health = this.assessHealth(record, now);
    return {
      connected: true,
      siteKey,
      origins: record.origins,
      browserChannel: record.browserChannel,
      profileHint: record.profileHint,
      capturedAt: record.capturedAt,
      lastVerifiedAt: record.lastVerifiedAt,
      expiresAt: record.expiresAt,
      consentLabel: record.consentLabel,
      status: health.status,
      humanActionReason: health.humanActionReason,
      cookieCount: record.storageState.cookies.length,
      localStorageOriginCount: record.storageState.origins.length,
    };
  }

  private decryptRecord(
    storage: SafeStorage,
    encrypted: string,
  ): BrowserSessionRecord | null {
    try {
      const plain = storage.decryptString(Buffer.from(encrypted, "base64"));
      return parseRecord(JSON.parse(plain));
    } catch {
      return null;
    }
  }

  private readStore(): EncryptedBrowserSessionStore {
    try {
      const parsed: unknown = JSON.parse(
        fs.readFileSync(this.storeFile, "utf8"),
      );
      if (!parsed || typeof parsed !== "object") return emptyStore();
      const accounts = (parsed as { accounts?: unknown }).accounts;
      if (
        !accounts ||
        typeof accounts !== "object" ||
        Array.isArray(accounts)
      ) {
        return emptyStore();
      }
      const normalized: Record<string, Record<string, string>> = {};
      for (const [userId, sites] of Object.entries(accounts)) {
        if (!sites || typeof sites !== "object" || Array.isArray(sites))
          continue;
        normalized[userId] = {};
        for (const [siteKey, encrypted] of Object.entries(sites)) {
          if (typeof encrypted === "string")
            normalized[userId][siteKey] = encrypted;
        }
      }
      return { version: 1, accounts: normalized };
    } catch {
      return emptyStore();
    }
  }

  private writeStore(store: EncryptedBrowserSessionStore): void {
    fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });
    fs.writeFileSync(this.storeFile, JSON.stringify(store), {
      encoding: "utf8",
      mode: 0o600,
    });
    try {
      fs.chmodSync(this.storeFile, 0o600);
    } catch {
      // Windows may reject chmod; encryption is still the primary invariant.
    }
  }
}

export const browserSessionStore = new BrowserSessionStore();

function emptyStore(): EncryptedBrowserSessionStore {
  return { version: 1, accounts: {} };
}

function assertSafeStorage(storage: SafeStorage): void {
  if (!storage.isEncryptionAvailable()) {
    throw new Error(
      "OS 키체인을 사용할 수 없어 브라우저 로그인 세션을 저장할 수 없습니다. Chrome 로그인 세션은 평문으로 저장하지 않습니다.",
    );
  }
}

export function normalizeSiteKey(siteKey: string): string {
  const normalized = siteKey.trim().toLowerCase();
  if (!/^[a-z0-9.-]{1,253}$/.test(normalized) || normalized.includes("..")) {
    throw new Error("유효하지 않은 브라우저 세션 siteKey 입니다.");
  }
  return normalized;
}

export function deriveSiteKeyFromOrigins(origins: string[]): string {
  const [first] = normalizeOrigins(origins);
  const host = new URL(first).hostname.toLowerCase();
  const labels = host.split(".").filter(Boolean);
  if (labels.length <= 2) return host;
  return labels.slice(-2).join(".");
}

export function normalizeOrigins(origins: string[]): string[] {
  const unique = new Set<string>();
  for (const raw of origins) {
    const url = new URL(raw);
    if (url.protocol !== "https:" && url.protocol !== "http:") {
      throw new Error("브라우저 세션 origin 은 http/https 만 허용합니다.");
    }
    unique.add(url.origin);
  }
  if (unique.size === 0) {
    throw new Error("브라우저 세션 origin 이 필요합니다.");
  }
  return [...unique].sort();
}

function normalizeConsentLabel(label: string): string {
  const normalized = label.trim();
  if (!normalized)
    throw new Error("브라우저 세션 저장 동의 문구가 필요합니다.");
  return normalized.slice(0, 200);
}

function normalizeOptionalLabel(label: string | undefined): string | undefined {
  const normalized = label?.trim();
  return normalized ? normalized.slice(0, 120) : undefined;
}

function validateStorageState(value: BrowserStorageState): BrowserStorageState {
  if (
    !value ||
    !Array.isArray(value.cookies) ||
    !Array.isArray(value.origins)
  ) {
    throw new Error("유효하지 않은 Playwright storageState 입니다.");
  }
  return {
    cookies: value.cookies.map((cookie) => ({
      name: requireString(cookie.name, "cookie.name"),
      value: requireString(cookie.value, "cookie.value"),
      domain: requireString(cookie.domain, "cookie.domain"),
      path: requireString(cookie.path, "cookie.path"),
      expires: requireNumber(cookie.expires, "cookie.expires"),
      httpOnly:
        typeof cookie.httpOnly === "boolean" ? cookie.httpOnly : undefined,
      secure: typeof cookie.secure === "boolean" ? cookie.secure : undefined,
      sameSite: cookie.sameSite,
    })),
    origins: value.origins.map((origin) => ({
      origin: new URL(origin.origin).origin,
      localStorage: origin.localStorage.map((entry) => ({
        name: requireString(entry.name, "localStorage.name"),
        value: requireString(entry.value, "localStorage.value"),
      })),
    })),
  };
}

function requireString(value: string, name: string): string {
  if (typeof value !== "string")
    throw new Error(`${name} 값이 올바르지 않습니다.`);
  return value;
}

function requireNumber(value: number, name: string): number {
  if (!Number.isFinite(value))
    throw new Error(`${name} 값이 올바르지 않습니다.`);
  return value;
}

function resolveExpiresAt(
  storageState: BrowserStorageState,
  capturedAt: number,
  requestedExpiresAt?: number,
): number {
  const max = capturedAt + MAX_SESSION_TTL_MS;
  const cookieExpiresAt = storageState.cookies
    .map((cookie) => cookie.expires)
    .filter((expires) => expires > 0)
    .map((expires) => expires * 1000)
    .sort((a, b) => a - b)[0];
  const requested =
    requestedExpiresAt ??
    cookieExpiresAt ??
    capturedAt + DEFAULT_SESSION_TTL_MS;
  const expiresAt = Math.min(requested, max);
  if (!Number.isFinite(expiresAt) || expiresAt <= capturedAt) {
    throw new Error("브라우저 세션 만료시각은 저장 시각 이후여야 합니다.");
  }
  return expiresAt;
}

function parseRecord(value: unknown): BrowserSessionRecord | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<BrowserSessionRecord>;
  if (raw.browserChannel !== BROWSER_AUTOMATION_CHANNEL) return null;
  if (
    !Array.isArray(raw.origins) ||
    typeof raw.capturedAt !== "number" ||
    typeof raw.expiresAt !== "number" ||
    typeof raw.consentLabel !== "string" ||
    !raw.storageState
  ) {
    return null;
  }
  return {
    storageState: validateStorageState(raw.storageState),
    origins: normalizeOrigins(raw.origins),
    browserChannel: BROWSER_AUTOMATION_CHANNEL,
    profileHint: normalizeOptionalLabel(raw.profileHint),
    capturedAt: raw.capturedAt,
    lastVerifiedAt:
      typeof raw.lastVerifiedAt === "number" ? raw.lastVerifiedAt : undefined,
    expiresAt: raw.expiresAt,
    consentLabel: raw.consentLabel,
    consecutiveAuthFailures:
      typeof raw.consecutiveAuthFailures === "number"
        ? raw.consecutiveAuthFailures
        : 0,
    disabledAt: typeof raw.disabledAt === "number" ? raw.disabledAt : undefined,
    disabledReason: raw.disabledReason,
  };
}
