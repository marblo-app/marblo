/**
 * privacyConsentService — proves a FAILED Firestore read is surfaced as
 * `{status:"error"}`, never silently downgraded to "not consented". That
 * conflation is the macOS sleep/resume re-prompt bug: on wake the first read
 * fails (network down / stale auth token) and an already-consented user gets
 * the modal again.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Importing the service pulls in src/lib/firebase, which boots real Firebase
// (auth/functions/firestore) — stub it so node tests don't touch the network.
// firebase/firestore itself is aliased to the in-memory mock by vitest.config.
vi.mock("../../src/lib/firebase", () => ({
  db: {},
  auth: { currentUser: { uid: "test-uid" } },
}));

vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "test-uid" } }),
}));

import * as firestore from "firebase/firestore";
import { __resetStore } from "../mocks/firebase-firestore";
import {
  getConsent,
  getConsentWithRetry,
  saveConsent,
  isConsentCurrent,
  rememberConsentAccepted,
  hasAcceptedConsentCached,
  CURRENT_POLICY_VERSION,
} from "../../src/services/privacyConsentService";

// In-memory localStorage for the node test env.
function installLocalStorage(): void {
  const map = new Map<string, string>();
  (globalThis as unknown as { localStorage: Storage }).localStorage = {
    getItem: (k: string) => (map.has(k) ? map.get(k)! : null),
    setItem: (k: string, v: string) => void map.set(k, v),
    removeItem: (k: string) => void map.delete(k),
    clear: () => map.clear(),
    key: (i: number) => Array.from(map.keys())[i] ?? null,
    get length() {
      return map.size;
    },
  } as Storage;
}

const UID = "user-123";

function seedConsentDoc(version: string): void {
  // Seed users/<uid>.privacyConsent via the firestore mock's setDoc.
  firestore.setDoc(
    firestore.doc({} as never, "users", UID) as never,
    {
      privacyConsent: {
        sentry: true,
        ga4: false,
        mixpanel: false,
        overseasTransfer: true,
        version,
        acceptedAt: null,
        locale: "ko",
      },
    } as never,
  );
}

beforeEach(() => {
  __resetStore();
  installLocalStorage();
  vi.restoreAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("getConsent — success/missing/error are distinct", () => {
  it("returns ok with the stored consent when a record exists", async () => {
    seedConsentDoc(CURRENT_POLICY_VERSION);
    const result = await getConsent(UID);
    expect(result.status).toBe("ok");
    if (result.status === "ok") {
      expect(result.consent.version).toBe(CURRENT_POLICY_VERSION);
      expect(result.consent.sentry).toBe(true);
      expect(result.consent.overseasTransfer).toBe(true);
    }
  });

  it("returns missing when the user doc does not exist", async () => {
    const result = await getConsent(UID);
    expect(result.status).toBe("missing");
  });

  it("returns missing when the doc exists but has no privacyConsent field", async () => {
    firestore.setDoc(
      firestore.doc({} as never, "users", UID) as never,
      { someOtherField: 1 } as never,
    );
    const result = await getConsent(UID);
    expect(result.status).toBe("missing");
  });

  it("returns error (NOT missing/default) when the read throws", async () => {
    vi.spyOn(firestore, "getDoc").mockRejectedValueOnce(
      Object.assign(new Error("client is offline"), { code: "unavailable" }),
    );
    const result = await getConsent(UID);
    expect(result.status).toBe("error");
    if (result.status === "error") expect(result.code).toBe("unavailable");
  });
});

describe("getConsentWithRetry — retries transient failures", () => {
  it("returns the first non-error result without retrying", async () => {
    seedConsentDoc(CURRENT_POLICY_VERSION);
    const spy = vi.spyOn(firestore, "getDoc");
    const result = await getConsentWithRetry(UID, 3, 0);
    expect(result.status).toBe("ok");
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it("recovers when an early read fails but a later one succeeds", async () => {
    seedConsentDoc(CURRENT_POLICY_VERSION);
    const real = firestore.getDoc;
    const spy = vi
      .spyOn(firestore, "getDoc")
      .mockRejectedValueOnce(
        Object.assign(new Error("offline"), { code: "unavailable" }),
      )
      .mockImplementation((ref: never) => real(ref));
    const result = await getConsentWithRetry(UID, 3, 0);
    expect(result.status).toBe("ok");
    expect(spy.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("returns error after exhausting all attempts", async () => {
    const spy = vi
      .spyOn(firestore, "getDoc")
      .mockRejectedValue(
        Object.assign(new Error("offline"), { code: "unavailable" }),
      );
    const result = await getConsentWithRetry(UID, 3, 0);
    expect(result.status).toBe("error");
    expect(spy).toHaveBeenCalledTimes(3);
  });
});

describe("proof-of-consent cache", () => {
  it("saveConsent arms the version-scoped cache on success", async () => {
    expect(hasAcceptedConsentCached(UID, CURRENT_POLICY_VERSION)).toBe(false);
    await saveConsent(UID, {
      sentry: true,
      ga4: false,
      mixpanel: false,
      overseasTransfer: false,
    });
    expect(hasAcceptedConsentCached(UID, CURRENT_POLICY_VERSION)).toBe(true);
  });

  it("does not arm the cache when the save write fails", async () => {
    vi.spyOn(firestore, "setDoc").mockRejectedValueOnce(
      Object.assign(new Error("denied"), { code: "permission-denied" }),
    );
    await expect(
      saveConsent(UID, {
        sentry: true,
        ga4: false,
        mixpanel: false,
        overseasTransfer: false,
      }),
    ).rejects.toThrow();
    expect(hasAcceptedConsentCached(UID, CURRENT_POLICY_VERSION)).toBe(false);
  });

  it("cache is version-scoped — a different version is not proven", () => {
    rememberConsentAccepted(UID, CURRENT_POLICY_VERSION);
    expect(hasAcceptedConsentCached(UID, CURRENT_POLICY_VERSION)).toBe(true);
    expect(hasAcceptedConsentCached(UID, "some-old-version")).toBe(false);
  });
});

describe("isConsentCurrent", () => {
  it("is true only for the current policy version", () => {
    expect(isConsentCurrent({ version: CURRENT_POLICY_VERSION } as never)).toBe(
      true,
    );
    expect(isConsentCurrent({ version: "" } as never)).toBe(false);
    expect(isConsentCurrent({ version: "2020-01-01" } as never)).toBe(false);
  });
});
