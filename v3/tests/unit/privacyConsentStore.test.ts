/**
 * privacyConsentStore.load — the guard that fixes the sleep/resume re-prompt.
 *
 * Core invariant: a transient read failure must NEVER flip needsPrompt to true.
 * The modal may only appear for a genuinely missing record or a stale version.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

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
  });
});

describe("load — ok results are authoritative", () => {
  it("current-version consent → needsPrompt false + cache re-armed", async () => {
    const consent = currentConsent();
    getConsentWithRetry.mockResolvedValue({ status: "ok", consent });

    await usePrivacyConsentStore.getState().load(UID);

    const s = usePrivacyConsentStore.getState();
    expect(s.needsPrompt).toBe(false);
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

    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(true);
  });
});

describe("load — missing means genuinely not consented", () => {
  it("missing → needsPrompt true", async () => {
    usePrivacyConsentStore.setState({ needsPrompt: false });
    getConsentWithRetry.mockResolvedValue({ status: "missing" });

    await usePrivacyConsentStore.getState().load(UID);

    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(true);
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
    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(false);
  });

  it("error + no cache + unknown user (needsPrompt true) → held at true (fail-safe)", async () => {
    usePrivacyConsentStore.setState({ needsPrompt: true });
    hasAcceptedConsentCached.mockReturnValue(false);
    getConsentWithRetry.mockResolvedValue({ status: "error", code: null });

    await usePrivacyConsentStore.getState().load(UID);

    // Never fabricates consent: an unknown user with a failed read is not
    // silently suppressed.
    expect(usePrivacyConsentStore.getState().needsPrompt).toBe(true);
  });

  it("error never throws out of load()", async () => {
    getConsentWithRetry.mockResolvedValue({ status: "error", code: null });
    await expect(
      usePrivacyConsentStore.getState().load(UID),
    ).resolves.toBeUndefined();
  });
});
