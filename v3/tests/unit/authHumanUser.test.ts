import { describe, expect, it, vi } from "vitest";
import type { User } from "firebase/auth";

vi.mock("firebase/auth", () => ({
  onAuthStateChanged: vi.fn(),
  onIdTokenChanged: vi.fn(),
  getRedirectResult: vi.fn(),
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

// `functions` 는 AuthProvider 가 계정 격리 초크포인트(lib/accountScope)를 통해
// taskStore → taskService → taskOutcomeReporter 를 끌어오면서 필요해졌다
// (티켓 GOiAnCMjqrEPNcmBaiBY). 그쪽은 모듈 로드 시점에 httpsCallable(functions)
// 을 부르므로 mock 에도 자리가 있어야 한다.
vi.mock("../../src/lib/firebase", () => ({
  auth: {},
  db: {},
  functions: {},
  isPackagedLoopbackAuth: false,
}));

vi.mock("../../src/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../src/services/agentAuthService", () => ({
  clearAgentFirebaseAuth: vi.fn(),
  ensureUserProfile: vi.fn(),
  syncAgentFirebaseAuth: vi.fn(),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    loginAttempt: vi.fn(),
    loginSuccess: vi.fn(),
    loginFailed: vi.fn(),
    logout: vi.fn(),
  },
}));

import { isHumanAuthUser } from "../../src/auth/AuthProvider";

function authUser(overrides: Partial<User>): User {
  return {
    uid: "uid-1",
    email: null,
    emailVerified: false,
    providerData: [],
    ...overrides,
  } as User;
}

describe("isHumanAuthUser", () => {
  it("rejects agent custom-token identities without email", () => {
    expect(
      isHumanAuthUser(
        authUser({
          uid: "agent-uid",
          email: null,
          providerData: [{ providerId: "google.com" }] as User["providerData"],
        }),
      ),
    ).toBe(false);
  });

  it("accepts a real Google user with email", () => {
    expect(
      isHumanAuthUser(
        authUser({
          uid: "RSALO1",
          email: "john.kim@example.com",
          providerData: [{ providerId: "google.com" }] as User["providerData"],
        }),
      ),
    ).toBe(true);
  });

  it("accepts an email-bearing user while providerData is hydrating", () => {
    expect(
      isHumanAuthUser(
        authUser({
          uid: "RSALO1",
          email: "john.kim@example.com",
          providerData: [],
        }),
      ),
    ).toBe(true);
  });
});
