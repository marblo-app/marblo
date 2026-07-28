/**
 * First-run flow (F5) — the two persisted rules that let the language picker
 * and the privacy consent modal run as ONE uninterrupted sequence.
 *
 * The bug this pins: consent used to be derived from a post-sign-in Firestore
 * read, so it landed ~5s after the language picker as a second full-screen
 * overlay, on top of a screen the user had already started clicking. Consent is
 * now collected before sign-in and parked locally until a uid exists.
 *
 * The two invariants that must not rot:
 *   1. A parked answer is scoped to the policy version it was given for —
 *      flushing consent to text the user never saw would be a false record.
 *   2. Existing installs never enter the flow (they'd all be re-asked once,
 *      since their prior consent lives under a uid we can't read pre-sign-in),
 *      but an install interrupted mid-flow does resume.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

// The service reaches Firebase at import time; stub the boot surface only.
import { vi } from "vitest";
vi.mock("../../src/lib/firebase", () => ({ db: {}, auth: {} }));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: null }),
}));

import {
  rememberPendingConsent,
  readPendingConsent,
  clearPendingConsent,
  CURRENT_POLICY_VERSION,
  type ConsentFlags,
} from "../../src/services/privacyConsentService";
import {
  isFirstRunFlowPending,
  markFirstRunFlowStarted,
  markFirstRunFlowFinished,
} from "../../src/lib/firstRunFlow";

/** Minimal localStorage — the vitest env is `node`, which has none. */
class MemoryStorage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  clear(): void {
    this.map.clear();
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

const LOCALE_KEY = "marblo:locale";
const IN_PROGRESS_KEY = "marblo.firstRun.inProgress";
const PENDING_KEY = "marblo:pendingConsent";

const ALLOW_SENTRY: ConsentFlags = {
  firstPartyTelemetry: true,
  sentry: true,
  ga4: false,
  mixpanel: false,
  overseasTransfer: true,
};

let storage: MemoryStorage;

beforeEach(() => {
  storage = new MemoryStorage();
  vi.stubGlobal("localStorage", storage);
  // `hasChosenLocale` reads `window.localStorage` and treats a missing window
  // as "already chosen" (it must never trap a user behind an undismissable
  // modal), so the window stub is what makes the fresh-install case reachable.
  vi.stubGlobal("window", { localStorage: storage });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("pending (pre-sign-in) consent", () => {
  it("round-trips the exact answer the user gave, with the locale they read it in", () => {
    rememberPendingConsent(ALLOW_SENTRY, "en");

    expect(readPendingConsent()).toEqual({
      flags: ALLOW_SENTRY,
      locale: "en",
      version: CURRENT_POLICY_VERSION,
    });
  });

  it("returns null when nothing was parked", () => {
    expect(readPendingConsent()).toBeNull();
  });

  it("preserves an explicit decline rather than folding it into 'no answer'", () => {
    // "나중에" is a real answer (all flags off), not the absence of one — if it
    // read back as null the user would be asked again after sign-in.
    const declined: ConsentFlags = {
      firstPartyTelemetry: true,
      sentry: false,
      ga4: false,
      mixpanel: false,
      overseasTransfer: false,
    };
    rememberPendingConsent(declined, "ko");

    expect(readPendingConsent()?.flags).toEqual(declined);
  });

  it("drops — and clears — an answer given for a superseded policy version", () => {
    storage.setItem(
      PENDING_KEY,
      JSON.stringify({
        flags: ALLOW_SENTRY,
        locale: "ko",
        version: "1999-01-01",
      }),
    );

    expect(readPendingConsent()).toBeNull();
    // Cleared, not merely ignored: leaving it would re-evaluate every launch.
    expect(storage.getItem(PENDING_KEY)).toBeNull();
  });

  it("treats a corrupt record as absent instead of throwing", () => {
    storage.setItem(PENDING_KEY, "{not json");

    expect(() => readPendingConsent()).not.toThrow();
    expect(readPendingConsent()).toBeNull();
  });

  it("clearPendingConsent removes the parked answer", () => {
    rememberPendingConsent(ALLOW_SENTRY, "ko");
    clearPendingConsent();

    expect(readPendingConsent()).toBeNull();
  });
});

describe("isFirstRunFlowPending", () => {
  it("is true on a fresh install (no language ever chosen)", () => {
    expect(isFirstRunFlowPending()).toBe(true);
  });

  it("is false for an existing install — nobody gets re-asked", () => {
    // The regression guard: an already-consented user's record lives under a
    // uid, unreadable before sign-in. Entering the flow would re-ask them all.
    storage.setItem(LOCALE_KEY, "ko");

    expect(isFirstRunFlowPending()).toBe(false);
  });

  it("resumes an install interrupted between the language and consent steps", () => {
    storage.setItem(LOCALE_KEY, "ko"); // step ① persisted its choice
    markFirstRunFlowStarted();

    expect(isFirstRunFlowPending()).toBe(true);
  });

  it("stops resuming once the flow completes", () => {
    storage.setItem(LOCALE_KEY, "ko");
    markFirstRunFlowStarted();
    markFirstRunFlowFinished();

    expect(isFirstRunFlowPending()).toBe(false);
    expect(storage.getItem(IN_PROGRESS_KEY)).toBeNull();
  });
});
