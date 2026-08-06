/**
 * privacyConsentStore.load — the guard that fixes the sleep/resume re-prompt.
 *
 * Core invariant: a transient read failure must NEVER flip needsPrompt to true.
 * The modal may only appear for a genuinely missing record or a stale version.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Stub Firebase boot so importing the real service (for isConsentCurrent /
// DEFAULT_CONSENT / CURRENT_POLICY_VERSION) doesn't touch the network.
vi.mock("../../src/lib/firebase", () => ({
  db: {},
  auth: { currentUser: { uid: "test-uid" } },
}));
vi.mock("firebase/auth", () => ({
  getAuth: () => ({ currentUser: { uid: "test-uid" } }),
}));

// Keep the pure helpers real; stub the I/O + cache surface the store calls.
// vi.hoisted so the spies exist before the hoisted vi.mock factory runs.
const {
  getConsentWithRetry,
  hasAcceptedConsentCached,
  rememberConsentAccepted,
  saveConsent,
} = vi.hoisted(() => ({
  getConsentWithRetry: vi.fn(),
  hasAcceptedConsentCached: vi.fn(),
  rememberConsentAccepted: vi.fn(),
  saveConsent: vi.fn(),
}));

vi.mock("../../src/services/privacyConsentService", async (orig) => {
  const actual =
    await orig<typeof import("../../src/services/privacyConsentService")>();
  return {
    ...actual,
    getConsentWithRetry,
    hasAcceptedConsentCached,
    rememberConsentAccepted,
    saveConsent,
  };
});

import { usePrivacyConsentStore } from "../../src/stores/privacyConsentStore";
import {
  DEFAULT_CONSENT,
  CURRENT_POLICY_VERSION,
  type PrivacyConsent,
} from "../../src/services/privacyConsentService";

const UID = "user-123";

function currentConsent(): PrivacyConsent {
  return {
    firstPartyTelemetry: true,
    sentry: true,
    ga4: false,
    mixpanel: false,
    overseasTransfer: true,
    version: CURRENT_POLICY_VERSION,
    acceptedAt: new Date(),
    locale: "ko",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  hasAcceptedConsentCached.mockReturnValue(false);
  // Reset store to its constructed defaults.
  usePrivacyConsentStore.setState({
    consent: DEFAULT_CONSENT,
    loading: false,
    needsPrompt: true,
    hasLoaded: false,
    loadedUid: null,
    lastReadOutcome: "not_loaded",
    lastReadCode: null,
    lastReadSource: null,
    lastReadAttempts: null,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("hasLoaded — modal must not surface before the first resolution", () => {
  it("starts false (cold start / post-wake renderer reload)", () => {
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(false);
  });

  it("is false while load() is in flight, true once it resolves", async () => {
    let resolveRead: (r: {
      status: "ok";
      consent: PrivacyConsent;
    }) => void = () => {};
    getConsentWithRetry.mockReturnValue(
      new Promise((res) => {
        resolveRead = res;
      }),
    );

    const done = usePrivacyConsentStore.getState().load(UID);
    // In-flight: the read (and its retry/backoff window) has not resolved, so
    // the Gate must still see hasLoaded=false and keep the modal hidden even
    // though needsPrompt defaults to true.
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(false);
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(UID);

    resolveRead({ status: "ok", consent: currentConsent() });
    await done;
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(true);
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(UID);
  });

  it("clears a previous uid's loaded state while the next uid is loading", async () => {
    let resolveRead: (r: {
      status: "ok";
      consent: PrivacyConsent;
    }) => void = () => {};
    usePrivacyConsentStore.setState({
      hasLoaded: true,
      loadedUid: "agent-transient",
      needsPrompt: true,
    });
    getConsentWithRetry.mockReturnValue(
      new Promise((res) => {
        resolveRead = res;
      }),
    );

    const done = usePrivacyConsentStore.getState().load(UID);

    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(false);
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(UID);

    resolveRead({ status: "ok", consent: currentConsent() });
    await done;
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(true);
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(UID);
    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(false);
  });

  it.each([
    ["ok", { status: "ok", consent: currentConsent() }],
    ["missing", { status: "missing" }],
  ] as const)("is true after a %s resolution", async (_label, result) => {
    getConsentWithRetry.mockResolvedValue(result);
    await usePrivacyConsentStore.getState().load(UID);
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(true);
  });

  it("stays unresolved after a transient error with no local proof", async () => {
    getConsentWithRetry.mockResolvedValue({ status: "error", code: null });

    await usePrivacyConsentStore.getState().load(UID);

    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(false);
    expect(usePrivacyConsentStore.getState().loading).toBe(true);
    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(false);
  });
});

describe("load — ok results are authoritative", () => {
  it("current-version consent → needsPrompt false + cache re-armed", async () => {
    const consent = currentConsent();
    getConsentWithRetry.mockResolvedValue({ status: "ok", consent });

    await usePrivacyConsentStore.getState().load(UID);

    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(false);
    expect(s.lastReadOutcome).toBe("ok");
    expect(s.lastReadCode).toBeNull();
    expect(s.consent.version).toBe(CURRENT_POLICY_VERSION);
    expect(rememberConsentAccepted).toHaveBeenCalledWith(
      UID,
      CURRENT_POLICY_VERSION,
    );
  });

  it("stale-version consent → needsPrompt true", async () => {
    getConsentWithRetry.mockResolvedValue({
      status: "ok",
      consent: { ...currentConsent(), version: "2020-01-01" },
    });

    await usePrivacyConsentStore.getState().load(UID);

    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(true);
    expect(s.lastReadOutcome).toBe("ok");
    expect(s.consent.version).toBe("2020-01-01");
  });
});

describe("load — missing means genuinely not consented", () => {
  it("missing → needsPrompt true", async () => {
    usePrivacyConsentStore.setState({ needsPrompt: false });
    getConsentWithRetry.mockResolvedValue({ status: "missing" });

    await usePrivacyConsentStore.getState().load(UID);

    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(true);
    expect(s.lastReadOutcome).toBe("missing");
    expect(s.lastReadCode).toBeNull();
  });
});

describe("load — transient failure must not surface the modal", () => {
  it("error + already-consented (needsPrompt false) → stays false", async () => {
    // Simulate the sleep/resume case: user accepted earlier this session.
    usePrivacyConsentStore.setState({
      consent: currentConsent(),
      needsPrompt: false,
    });
    getConsentWithRetry.mockResolvedValue({
      status: "error",
      code: "unavailable",
    });

    await usePrivacyConsentStore.getState().load(UID);

    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(false);
    expect(s.lastReadOutcome).toBe("error");
    expect(s.lastReadCode).toBe("unavailable");
    // Consent state preserved, NOT downgraded to DEFAULT.
    expect(s.consent.version).toBe(CURRENT_POLICY_VERSION);
  });

  it("error + local proof-of-consent cache → forces needsPrompt false", async () => {
    // Fresh gate (default needsPrompt true), read fails, but the cache proves
    // this uid already accepted the current version on this device.
    usePrivacyConsentStore.setState({ needsPrompt: true });
    hasAcceptedConsentCached.mockReturnValue(true);
    getConsentWithRetry.mockResolvedValue({
      status: "error",
      code: "unauthenticated",
    });

    await usePrivacyConsentStore.getState().load(UID);

    expect(hasAcceptedConsentCached).toHaveBeenCalledWith(
      UID,
      CURRENT_POLICY_VERSION,
    );
    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(false);
    expect(s.lastReadOutcome).toBe("error");
    expect(s.lastReadCode).toBe("unauthenticated");
  });

  it("error + no cache + unknown user → stays loading with no prompt", async () => {
    usePrivacyConsentStore.setState({ needsPrompt: true });
    hasAcceptedConsentCached.mockReturnValue(false);
    getConsentWithRetry.mockResolvedValue({ status: "error", code: null });

    await usePrivacyConsentStore.getState().load(UID);

    // Never fabricates "missing": a failed read is unresolved, so the Gate
    // keeps showing loading/null instead of the blocking modal.
    const s = usePrivacyConsentStore.getState();
    expect(s.loading).toBe(true);
    expect(s.hasLoaded).toBe(false);
    expect(s.needsPrompt).toBe(false);
    expect(s.lastReadOutcome).toBe("error");
  });

  it("logs a single diagnostic line with read outcome and version comparison", async () => {
    const info = vi.spyOn(console, "info").mockImplementation(() => {});
    getConsentWithRetry.mockResolvedValue({
      status: "ok",
      consent: { ...currentConsent(), version: "2020-01-01" },
    });

    await usePrivacyConsentStore.getState().load(UID);

    expect(info).toHaveBeenCalledWith(
      "[PrivacyConsentStore] load outcome",
      expect.objectContaining({
        readOutcome: "ok",
        storedVersion: "2020-01-01",
        currentVersion: CURRENT_POLICY_VERSION,
        versionCurrent: false,
        readSource: null,
        attempts: null,
        needsPrompt: true,
      }),
    );
  });

  it("error never throws out of load()", async () => {
    getConsentWithRetry.mockResolvedValue({ status: "error", code: null });
    await expect(
      usePrivacyConsentStore.getState().load(UID),
    ).resolves.toBeUndefined();
  });
});
