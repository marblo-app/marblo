/**
 * @vitest-environment jsdom
 *
 * Electron 부팅 경로가 authDomain iframe 에 묶이지 않는다 (티켓 L1LQjuQhRiW2hIoBkOAs).
 *
 * ★왜 이게 로그인 유지와 관련이 있나
 * initializeAuth 에 popupRedirectResolver 를 주면 @firebase/auth 는 부팅 시
 * AuthImpl.initializeCurrentUser 안에서
 *     if (popupRedirectResolver && this.config.authDomain) { … await tryRedirectSignIn(…) }
 * 를 await 한다(@firebase/auth 10.14.1). tryRedirectSignIn 은 authDomain 의
 * `__/auth/iframe` 을 띄우고 gapi 핸드셰이크를 기다린다. 즉 **localStorage 에
 * 저장된 로그인 세션을 읽는 일이 그 iframe 뒤로 밀린다.** 이 핸드셰이크가
 * Electron 에서 막힌다는 건 이 저장소가 이미 실측한 사실이고(티켓
 * Oq63rrnxMYv6fdeNeani, KVId8CCsu8pXYGhRGtz3), 그 사이 AuthProvider 는 10초
 * 타임아웃에 포기하고 로그인 화면을 그린다.
 *
 * 그래서 여기서는 두 지점을 동작으로 고정한다.
 *  1) Electron 에서는 initializeAuth 옵션에 popupRedirectResolver 가 없다.
 *  2) Electron 에서는 부팅 시 getRedirectResult 를 아예 부르지 않는다.
 * 웹(브라우저, electronAPI 없음)에서는 둘 다 예전 그대로여야 한다.
 */
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { createElement, useContext } from "react";
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

const getRedirectResult = vi.hoisted(() => vi.fn(async () => null));
const initializeAuth = vi.hoisted(() =>
  vi.fn((_app: unknown, _deps?: unknown) => firebaseAuth),
);
const resolverSentinel = vi.hoisted(() => ({
  tag: "browserPopupRedirectResolver",
}));

vi.mock("firebase/auth", () => ({
  initializeAuth,
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
  getRedirectResult,
  signInWithPopup: vi.fn(),
  signInWithRedirect: vi.fn(),
  signInWithCredential: vi.fn(),
  signInWithEmailAndPassword: vi.fn(),
  createUserWithEmailAndPassword: vi.fn(),
  setPersistence: vi.fn(),
  browserLocalPersistence: { tag: "browserLocalPersistence" },
  indexedDBLocalPersistence: { tag: "indexedDBLocalPersistence" },
  inMemoryPersistence: { tag: "inMemoryPersistence" },
  browserPopupRedirectResolver: resolverSentinel,
  signOut: vi.fn(),
  GoogleAuthProvider: vi.fn(),
  GithubAuthProvider: vi.fn(),
}));

vi.mock("firebase/functions", () => ({
  getFunctions: vi.fn(() => ({})),
}));

vi.mock("firebase/firestore", () => ({
  initializeFirestore: vi.fn(() => ({ type: "mock-firestore" })),
  doc: vi.fn(),
  serverTimestamp: vi.fn(),
  setDoc: vi.fn(),
}));

vi.mock("../../src/lib/accountScope", () => ({
  resetAccountScopedState: vi.fn(),
}));

vi.mock("../../src/lib/i18n", () => ({
  t: (key: string) => key,
}));

vi.mock("../../src/services/agentAuthService", () => ({
  clearAgentFirebaseAuth: vi.fn(async () => undefined),
  ensureUserProfile: vi.fn(async () => "unchanged"),
  syncAgentFirebaseAuth: vi.fn(async () => undefined),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    loginAttempt: vi.fn(),
    loginSuccess: vi.fn(),
    loginFailed: vi.fn(),
    logout: vi.fn(),
  },
}));

/** preload 브리지가 살아있는 Electron 렌더러 흉내. */
function installElectronBridge(): void {
  (window as unknown as { electronAPI?: unknown }).electronAPI = {
    auth: { googleLoopback: vi.fn(async () => ({ ok: true, idToken: "t" })) },
  };
}

function removeElectronBridge(): void {
  delete (window as unknown as { electronAPI?: unknown }).electronAPI;
}

beforeEach(() => {
  vi.resetModules();
  authCallbacks.authStateChanged = null;
  authCallbacks.idTokenChanged = null;
  firebaseAuth.currentUser = null;
  getRedirectResult.mockClear();
  initializeAuth.mockClear();
  removeElectronBridge();
  vi.stubEnv("VITE_FIREBASE_API_KEY", "test-api-key");
  vi.stubEnv("VITE_FIREBASE_AUTH_DOMAIN", "marblo-test.firebaseapp.com");
});

afterEach(() => {
  cleanup();
  removeElectronBridge();
  vi.unstubAllEnvs();
});

/** initializeAuth 에 실제로 넘어간 옵션 객체. */
async function initializeAuthDeps(): Promise<Record<string, unknown>> {
  await import("../../src/lib/firebase");
  expect(initializeAuth).toHaveBeenCalledTimes(1);
  return initializeAuth.mock.calls[0][1] as Record<string, unknown>;
}

describe("initializeAuth 옵션 — 부팅이 authDomain iframe 을 기다리지 않는다", () => {
  it("Electron(loopback 브리지 있음)에서는 popupRedirectResolver 를 달지 않는다", async () => {
    installElectronBridge();
    const deps = await initializeAuthDeps();
    expect(deps).not.toHaveProperty("popupRedirectResolver");
  });

  it("웹(브리지 없음)에서는 기존대로 popupRedirectResolver 를 단다", async () => {
    const deps = await initializeAuthDeps();
    expect(deps.popupRedirectResolver).toBe(resolverSentinel);
  });

  it("persistence 순서는 어느 쪽에서도 localStorage 우선 그대로다", async () => {
    installElectronBridge();
    const deps = await initializeAuthDeps();
    expect(
      (deps.persistence as Array<{ tag: string }>).map((p) => p.tag),
    ).toEqual([
      "browserLocalPersistence",
      "indexedDBLocalPersistence",
      "inMemoryPersistence",
    ]);
  });
});

describe("AuthProvider 부팅 — getRedirectResult 호출 여부", () => {
  async function renderProvider(): Promise<void> {
    vi.doMock("../../src/lib/firebase", () => ({
      auth: firebaseAuth,
      db: {},
      functions: {},
      isPackagedLoopbackAuth: false,
    }));
    const { AuthProvider } = await import("../../src/auth/AuthProvider");
    await act(async () => {
      render(createElement(AuthProvider, null, createElement("div")));
    });
  }

  it("Electron 에서는 authDomain iframe 을 띄우는 getRedirectResult 를 아예 부르지 않는다", async () => {
    installElectronBridge();
    await renderProvider();
    // 부팅 직후 상태가 도착해도(=저장된 세션 채택) redirect 회수는 없어야 한다.
    await act(async () => {
      authCallbacks.authStateChanged?.(null);
    });
    expect(getRedirectResult).not.toHaveBeenCalled();
  });

  it("저장된 유효 세션의 첫 auth 상태를 받으면 로그인 화면 대기 대신 즉시 채택한다", async () => {
    installElectronBridge();
    vi.doMock("../../src/lib/firebase", () => ({
      auth: firebaseAuth,
      db: {},
      functions: {},
    }));
    const { AuthContext, AuthProvider } = await import(
      "../../src/auth/AuthProvider"
    );
    function Probe() {
      const value = useContext(AuthContext);
      return createElement(
        "output",
        null,
        value?.loading ? "loading" : value?.user?.uid ?? "signed-out",
      );
    }
    const view = render(createElement(AuthProvider, null, createElement(Probe)));

    await act(async () => {
      authCallbacks.authStateChanged?.({
        uid: "persisted-user",
        email: "person@example.test",
        providerData: [],
      } as unknown as User);
    });

    expect(view.getByText("persisted-user")).toBeTruthy();
    expect(getRedirectResult).not.toHaveBeenCalled();
  });

  it("웹에서는 pending redirect 회수를 위해 여전히 부른다", async () => {
    await renderProvider();
    await waitFor(() => {
      expect(getRedirectResult).toHaveBeenCalledTimes(1);
    });
  });
});
