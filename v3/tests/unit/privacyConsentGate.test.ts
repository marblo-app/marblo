/**
 * @vitest-environment jsdom
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import type { User } from "firebase/auth";

const authState = vi.hoisted(() => ({
  value: {
    user: null as User | null,
    authSettled: false,
    humanUser: null as User | null,
    humanUserUid: null as string | null,
    loading: true,
    error: null as string | null,
    loginWithGoogle: vi.fn(),
    loginWithGithub: vi.fn(),
    loginWithEmail: vi.fn(),
    signupWithEmail: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
  },
}));

const consentService = vi.hoisted(() => ({
  CURRENT_POLICY_VERSION: "2026-06-01",
  DEFAULT_CONSENT: {
    firstPartyTelemetry: true,
    sentry: false,
    ga4: false,
    mixpanel: false,
    overseasTransfer: false,
    version: "",
    acceptedAt: null,
    locale: "ko",
  },
  getConsentWithRetry: vi.fn(),
  saveConsent: vi.fn(),
  isConsentCurrent: (consent: { version: string }) =>
    consent.version === "2026-06-01",
  hasAcceptedConsentCached: vi.fn(),
  rememberConsentAccepted: vi.fn(),
  readPendingConsent: vi.fn(),
  clearPendingConsent: vi.fn(),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => authState.value,
}));

vi.mock("../../src/services/privacyConsentService", () => consentService);

vi.mock("../../src/services/marketingConsent", () => ({
  readPendingMarketingOptIn: vi.fn(() => null),
  clearPendingMarketingOptIn: vi.fn(),
}));

vi.mock("../../src/services/marketingConsentService", () => ({
  saveMarketingOptIn: vi.fn(),
}));

vi.mock("../../src/lib/telemetry/sentry", () => ({
  maybeInitSentry: vi.fn(() => Promise.resolve()),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    setTelemetryEnabled: vi.fn(),
  },
  setTelemetryEnabled: vi.fn(),
}));

vi.mock("../../src/components/legal/PrivacyConsentModal", () => ({
  PrivacyConsentModal: () =>
    createElement("div", { "data-testid": "privacy-consent-modal" }),
}));

import { PrivacyConsentGate } from "../../src/components/legal/PrivacyConsentGate";
import { usePrivacyConsentStore } from "../../src/stores/privacyConsentStore";

const HUMAN_UID = "RSALO1rljtWBSZ70MoBiaeFORxr1";
const AGENT_UID = "agent-custom-token-uid";

function makeUser(uid: string, providerId?: string): User {
  return {
    uid,
    email: providerId ? "john.kim@example.com" : null,
    emailVerified: !!providerId,
    providerData: providerId ? [{ providerId }] : [],
  } as unknown as User;
}

function setAuth(overrides: Partial<typeof authState.value>): void {
  authState.value = {
    ...authState.value,
    ...overrides,
  };
}

function resetStore(): void {
  usePrivacyConsentStore.setState({
    consent: consentService.DEFAULT_CONSENT,
    loading: false,
    needsPrompt: true,
    hasLoaded: false,
    loadedUid: null,
    lastReadOutcome: "not_loaded",
    lastReadCode: null,
  });
}

describe("PrivacyConsentGate stable human uid gating", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStore();
    consentService.hasAcceptedConsentCached.mockReturnValue(false);
    consentService.readPendingConsent.mockReturnValue(null);
    setAuth({
      user: null,
      authSettled: false,
      humanUser: null,
      humanUserUid: null,
      loading: true,
    });
  });

  afterEach(() => {
    cleanup();
  });

  it("does not load or prompt before auth settles on a human uid", () => {
    render(createElement(PrivacyConsentGate));

    expect(consentService.getConsentWithRetry).not.toHaveBeenCalled();
    expect(screen.queryByTestId("privacy-consent-modal")).toBeNull();
  });

  it("ignores agent custom-token identity even after auth is settled", () => {
    setAuth({
      user: makeUser(AGENT_UID),
      authSettled: true,
      humanUser: null,
      humanUserUid: null,
      loading: false,
    });

    render(createElement(PrivacyConsentGate));

    expect(consentService.getConsentWithRetry).not.toHaveBeenCalled();
    expect(screen.queryByTestId("privacy-consent-modal")).toBeNull();
  });

  it("loads with the settled Google uid and hides prompt for current consent", async () => {
    const humanUser = makeUser(HUMAN_UID, "google.com");
    consentService.getConsentWithRetry.mockResolvedValue({
      status: "ok",
      consent: {
        ...consentService.DEFAULT_CONSENT,
        firstPartyTelemetry: false,
        version: consentService.CURRENT_POLICY_VERSION,
        acceptedAt: new Date(),
      },
    });
    setAuth({
      user: humanUser,
      authSettled: true,
      humanUser,
      humanUserUid: HUMAN_UID,
      loading: false,
    });

    render(createElement(PrivacyConsentGate));

    await waitFor(() =>
      expect(consentService.getConsentWithRetry).toHaveBeenCalledWith(HUMAN_UID),
    );
    await waitFor(() =>
      expect(usePrivacyConsentStore.getState().needsPrompt).toBe(false),
    );
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(HUMAN_UID);
    expect(screen.queryByTestId("privacy-consent-modal")).toBeNull();
  });

  it("does not render from a stale loaded agent uid while human uid is loading", () => {
    const humanUser = makeUser(HUMAN_UID, "google.com");
    consentService.getConsentWithRetry.mockReturnValue(new Promise(() => {}));
    usePrivacyConsentStore.setState({
      hasLoaded: true,
      loadedUid: AGENT_UID,
      needsPrompt: true,
    });
    setAuth({
      user: humanUser,
      authSettled: true,
      humanUser,
      humanUserUid: HUMAN_UID,
      loading: false,
    });

    render(createElement(PrivacyConsentGate));

    expect(screen.queryByTestId("privacy-consent-modal")).toBeNull();
    expect(usePrivacyConsentStore.getState().loadedUid).toBe(HUMAN_UID);
    expect(usePrivacyConsentStore.getState().hasLoaded).toBe(false);
  });
});
