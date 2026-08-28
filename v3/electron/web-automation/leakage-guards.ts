import type { BrowserSessionLeakageGuard } from "./types";

export const BROWSER_SESSION_LEAKAGE_GUARDS: BrowserSessionLeakageGuard[] = [
  {
    path: "logs",
    blockedBy:
      "Automation modules expose summaries only; storageState/cookie/header keys are redacted before loggable payloads are built.",
  },
  {
    path: "telemetry",
    blockedBy:
      "No browser-session telemetry payload contains raw URLs, cookies, localStorage, sessionStorage, headers, or response bodies.",
  },
  {
    path: "crash_dumps",
    blockedBy:
      "Sentry main-process beforeSend drops cookie/storage/header-shaped keys and keeps sendDefaultPii=false.",
  },
  {
    path: "agent_prompts",
    blockedBy:
      "Prompt snapshots must pass assertPromptSnapshotIsSafe; storage, hidden DOM, headers, and response bodies are rejected.",
  },
  {
    path: "ipc",
    blockedBy:
      "Renderer IPC can list/delete session summaries but cannot read decrypted storageState.",
  },
  {
    path: "temp_files",
    blockedBy:
      "Session restore passes storageState in memory to Playwright; no plaintext storageState JSON is written.",
  },
];

const SENSITIVE_BROWSER_SESSION_KEY =
  /(cookie|cookies|storageState|localStorage|sessionStorage|authorization|authHeader|setCookie|headers?|responseBody|requestBody|hiddenDom)/i;

export function isBrowserSessionSensitiveKey(key: string): boolean {
  return SENSITIVE_BROWSER_SESSION_KEY.test(key);
}

export function redactBrowserSessionValue(value: unknown, depth = 0): unknown {
  if (depth > 8) return "<TRUNCATED>";
  if (value === null || value === undefined) return value;
  if (
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  ) {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => redactBrowserSessionValue(entry, depth + 1));
  }
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = isBrowserSessionSensitiveKey(key)
        ? "<REDACTED_BROWSER_SESSION>"
        : redactBrowserSessionValue(entry, depth + 1);
    }
    return out;
  }
  return "<UNSUPPORTED>";
}

export function assertPromptSnapshotIsSafe(snapshot: unknown): void {
  const blocked = findSensitiveKey(snapshot);
  if (blocked) {
    throw new Error(
      `Browser automation prompt snapshot contains blocked session field: ${blocked}`,
    );
  }
}

function findSensitiveKey(value: unknown, depth = 0): string | null {
  if (depth > 8 || value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findSensitiveKey(entry, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (typeof value !== "object") return null;
  for (const [key, entry] of Object.entries(value)) {
    if (isBrowserSessionSensitiveKey(key)) return key;
    const found = findSensitiveKey(entry, depth + 1);
    if (found) return found;
  }
  return null;
}
