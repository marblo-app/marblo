/**
 * @vitest-environment jsdom
 */

import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement } from "react";
import type { User } from "firebase/auth";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type AuthStateCallback = (user: User | null) => void;

const authCallbacks = vi.hoisted(() => ({
  authStateChanged: null as AuthStateCallback | null,
  idTokenChanged: null as AuthStateCallback | null,
}));

const firebaseAuth = vi.hoisted(() => ({
  currentUser: null as User | null,
  authStateReady: vi.fn(() => new Promise<void>(() => undefined)),
}));

const ensureUserProfile = vi.hoisted(() => vi.fn(async () => "created"));
const syncAgentFirebaseAuth = vi.hoisted(() => vi.fn(async () => undefined));
const clearAgentFirebaseAuth = vi.hoisted(() => vi.fn(async () => undefined));

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(
    (_auth: unknown, callback: AuthStateCallback): (() => void) => {
      authCallbacks.authStateChanged = callback;
      return () => {
        authCallbacks.authStateChanged = null;
      };
    },
  ),
  onIdTokenChanged: vi.fn(
    (_auth: unknown, callback: AuthStateCallback): (() => void) => {
      authCallbacks.idTokenChanged = callback;
      return () => {
        authCallbacks.idTokenChanged = null;
      };
    },
  ),
  getRedirectResult: vi.fn(async () => null),
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  setPersistence: vi.fn(),
  browserLocalPersistence: {},
  browserPopupRedirectResolver: {},
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  GithubAuthProvider: vi.fn(),
}));

vi.mock("firebase/firestore", () => ({
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock("../../src/lib/firebase", () => ({
  auth: firebaseAuth,
  db: {},
  functions: {},
  isPackagedLoopbackAuth: false,
}));

vi.mock("../../src/lib/accountScope", () => ({
  resetAccountScopedState: vi.fn(),
}));

vi.mock("../../src/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../src/services/agentAuthService", () => ({
  clearAgentFirebaseAuth,
  ensureUserProfile,
  syncAgentFirebaseAuth,
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    loginAttempt: vi.fn(),
    loginSuccess: vi.fn(),
    loginFailed: vi.fn(),
    logout: vi.fn(),
  },
}));

function authUser(overrides: Partial<User> = {}): User {
  return {
    uid: "u1",
    email: "ada@example.com",
    displayName: "Ada",
    photoURL: null,
    emailVerified: true,
    isAnonymous: false,
    providerData: [],
    getIdToken: vi.fn(async () => "id-token"),
    ...overrides,
  } as unknown as User;
}

beforeEach(() => {
  authCallbacks.authStateChanged = null;
  authCallbacks.idTokenChanged = null;
  firebaseAuth.currentUser = null;
  firebaseAuth.authStateReady.mockClear();
  ensureUserProfile.mockClear();
  syncAgentFirebaseAuth.mockClear();
  clearAgentFirebaseAuth.mockClear();
});

afterEach(() => {
  cleanup();
});

describe("AuthProvider persisted-session profile recovery", () => {
  it("repairs users/{uid} when the initial Firebase Auth state adopts a persisted user", async () => {
    const { AuthProvider } = await import("../../src/auth/AuthProvider");
    const user = authUser();

    render(createElement(AuthProvider, null, createElement("div")));
    await act(async () => {
      authCallbacks.authStateChanged?.(user);
    });

    await waitFor(() => {
      expect(ensureUserProfile).toHaveBeenCalledWith(user);
    });
    expect(syncAgentFirebaseAuth).not.toHaveBeenCalled();
  });
});
