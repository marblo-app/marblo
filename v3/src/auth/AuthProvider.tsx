import {
  createContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  onAuthStateChanged,
  onIdTokenChanged,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
  signInWithCredential,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  setPersistence,
  browserLocalPersistence,
  browserPopupRedirectResolver,
  signOut,
  GoogleAuthProvider,
  GithubAuthProvider,
  type User,
} from "firebase/auth";
import { doc, serverTimestamp, setDoc } from "firebase/firestore";
import { auth, db, isPackagedLoopbackAuth } from "../lib/firebase";
import { resetAccountScopedState } from "../lib/accountScope";
import { t } from "../lib/i18n";
import {
  clearAgentFirebaseAuth,
  ensureUserProfile,
  syncAgentFirebaseAuth,
} from "../services/agentAuthService";
import telemetry from "../services/telemetryService";

/** Firebase error → coarse code for telemetry. We ship the CODE only
 *  (auth/network-request-failed …), never the message — messages can embed the
 *  email the user typed. See churn analysis §5-2: login failure is the biggest
 *  measurement blind spot, but the reason must stay de-identified. */
function authErrorCode(e: unknown): string {
  const code = (e as { code?: string })?.code;
  return typeof code === "string" && code ? code : "unknown";
}

export interface AuthContextType {
  user: User | null;
  /**
   * Auth has reached a renderer-stable initial state. Consent/privacy gates
   * must wait for this instead of reacting to transient identity changes.
   */
  authSettled: boolean;
  /**
   * The signed-in interactive account. Agent custom-token identities can appear
   * in Firebase Auth transitions, but they must not drive human-only UI such as
   * privacy consent prompts.
   */
  humanUser: User | null;
  humanUserUid: string | null;
  /**
   * True only when Firebase has resolved initial auth state and the current
   * interactive user can supply an ID token for Firestore rules.
   */
  humanAuthReady: boolean;
  getHumanIdToken: (forceRefresh?: boolean) => Promise<string | null>;
  loading: boolean;
  error: string | null;
  loginWithGoogle: (options?: AuthMarketingConsentOptions) => Promise<void>;
  loginWithGithub: () => Promise<void>;
  loginWithEmail: (
    email: string,
    password: string,
    options?: AuthMarketingConsentOptions,
  ) => Promise<void>;
  signupWithEmail: (
    email: string,
    password: string,
    options?: AuthMarketingConsentOptions,
  ) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
}

export interface AuthMarketingConsentOptions {
  marketingEmailConsent?: boolean;
  locale?: string;
}

export const AuthContext = createContext<AuthContextType | null>(null);

const googleProvider = new GoogleAuthProvider();
const githubProvider = new GithubAuthProvider();

// How long to wait for Firebase Auth to report an initial state before we stop
// blocking on it. See regression BAcFpVKbTFX18gs3UEEt (placeholder config makes
// onAuthStateChanged never fire) and Oq63rrnxMYv6fdeNeani (packaged 127.0.0.1
// static-server origin makes IndexedDB persistence init silently hang before any
// network request). In both cases `loading` would otherwise stay true forever.
// 10s is comfortably above a normal cold start.
const AUTH_INIT_TIMEOUT_MS = 10_000;

// Build marker so packaged-app console logs unambiguously identify WHICH auth
// build is running (dev/prod parity + stale-build detection). Bump the suffix
// whenever the Google login flow changes so old bundles are recognizable.
// Ticket XscLxYM75DR9ou52o7Za — the previous "무반응" regression was impossible
// to triage because there was no way to tell whether the packaged app even ran
// the redirect code path or a stale popup build.
const AUTH_BUILD_TAG = "google-login=redirect-v3-idb-heartbeat-fix";

// If signInWithRedirect neither navigates the window away nor rejects within
// this window, its pending-redirect persistence write has silently hung (the
// packaged 127.0.0.1 IndexedDB hang). We surface a visible error instead of a
// dead, silent button. Generous so a slow-but-successful navigation never trips
// it (a real navigation tears down this renderer well before then).
const REDIRECT_NAV_WATCHDOG_MS = 8_000;
const MARKETING_CONSENT_VERSION = "2026-07-22";
const MARKETING_CONSENT_REDIRECT_KEY = "marblo:authMarketingConsentPending";

export function isHumanAuthUser(
  firebaseUser: User | null,
): firebaseUser is User {
  if (!firebaseUser) return false;
  if (firebaseUser.uid === "test-user-bypass") return true;

  const email = firebaseUser.email?.trim();
  if (!email) return false;

  const providerIds = firebaseUser.providerData
    .map((provider) => provider.providerId)
    .filter(Boolean);

  if (
    providerIds.some((providerId) =>
      ["google.com", "github.com", "password", "phone"].includes(providerId),
    )
  ) {
    return true;
  }

  // Firebase may not have hydrated providerData yet, but an email-bearing
  // account is still the interactive user. Agent custom-token identities have no
  // email and are rejected above, so they never drive human-only consent state.
  return true;
}

function rememberMarketingConsentForRedirect(
  options?: AuthMarketingConsentOptions,
): void {
  try {
    if (options?.marketingEmailConsent) {
      localStorage.setItem(
        MARKETING_CONSENT_REDIRECT_KEY,
        JSON.stringify({ locale: options.locale ?? "ko" }),
      );
    } else {
      localStorage.removeItem(MARKETING_CONSENT_REDIRECT_KEY);
    }
  } catch {
    // Best-effort only. Loopback/email paths do not need this.
  }
}

function consumeMarketingConsentFromRedirect():
  | AuthMarketingConsentOptions
  | undefined {
  try {
    const raw = localStorage.getItem(MARKETING_CONSENT_REDIRECT_KEY);
    localStorage.removeItem(MARKETING_CONSENT_REDIRECT_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { locale?: unknown };
    return {
      marketingEmailConsent: true,
      locale: typeof parsed.locale === "string" ? parsed.locale : "ko",
    };
  } catch {
    return undefined;
  }
}

async function syncAgentFirebaseAuthForUser(
  firebaseUser: User,
  source: string,
  forceRefreshIdToken = false,
): Promise<void> {
  await syncAgentFirebaseAuth(firebaseUser, { forceRefreshIdToken });
  console.info(`[auth] agent Firebase auth synced (${source})`);
}

async function grantMarketingConsentForUser(
  firebaseUser: User,
  method: string,
  options?: AuthMarketingConsentOptions,
): Promise<void> {
  if (!options?.marketingEmailConsent) return;

  try {
    await setDoc(
      doc(db, "users", firebaseUser.uid),
      {
        webPrivacyConsent: {
          marketing: true,
          version: MARKETING_CONSENT_VERSION,
          acceptedAt: serverTimestamp(),
          locale: options.locale ?? "ko",
        },
      },
      { merge: true },
    );
    telemetry.marketingConsentGranted("auth_screen", method);
  } catch (e) {
    const code = (e as { code?: string })?.code ?? "unknown";
    console.warn(`[auth] marketing consent grant failed code=${code}`);
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [firebaseAuthReady, setFirebaseAuthReady] = useState(false);
  // Flips true if Firebase Auth doesn't report an initial state within the
  // timeout. Rather than a dead-end error screen, we fall back to the normal
  // (signed-out) login screen and surface this as a thin banner — a new user is
  // simply not signed in yet, and the login flow makes its own network calls
  // that work independently of the stalled persistence init.
  const [initDegraded, setInitDegraded] = useState(false);

  // 마지막으로 채택한 신원. `undefined` = 아직 한 번도 채택 안 함(초기 mount).
  const lastIdentityRef = useRef<string | null | undefined>(undefined);

  /**
   * 신원 채택의 **단일 초크포인트** — 티켓 GOiAnCMjqrEPNcmBaiBY (P0 계정 격리).
   *
   * uid 가 실제로 바뀔 때(로그아웃 → null 포함) 계정 귀속 렌더러 상태를 **먼저,
   * 동기적으로** 버리고 나서 새 신원을 공개한다. 순서가 핵심이다: `setUser` 를
   * 먼저 하면 그 렌더 프레임이 "새 계정 + 옛 계정 데이터" 로 그려지고, 그게 바로
   * datagadapida 화면에 john.kim 프로젝트가 보인 그 상태다. React 이펙트로
   * 지우는 것으로는 늦다 — 이펙트는 렌더 **뒤에** 돈다.
   *
   * uid 가 그대로면(토큰 갱신, 프로필 필드 변경 등) 아무것도 버리지 않는다.
   *
   * ★setUser 를 직접 부르지 말고 항상 이 함수를 거칠 것. 여기를 우회하는 경로가
   *   하나라도 생기면 그 경로가 곧 격리 구멍이다.
   */
  const adoptIdentity = useCallback((nextUser: User | null) => {
    const nextUid = nextUser?.uid ?? null;
    if (lastIdentityRef.current !== nextUid) {
      lastIdentityRef.current = nextUid;
      resetAccountScopedState(nextUid);
    }
    setUser(nextUser);
  }, []);

  const recoverAdoptedUserProfile = useCallback(
    (firebaseUser: User | null, source: string) => {
      if (!firebaseUser) return;
      ensureUserProfile(firebaseUser)
        .then((result) => {
          if (result === "unchanged") return;
          console.info(`[auth] adopted user profile ${result} (${source})`);
        })
        .catch((e: unknown) => {
          console.warn(`[auth] adopted user profile repair failed (${source})`, e);
        });
    },
    [],
  );

  useEffect(() => {
    // Test hatch — main process 가 MARBLO_TEST_BYPASS_AUTH=1 로 launch 된
    // 경우 Firebase Auth 를 건너뛰고 mock user 로 통과. Playwright e2e 에서
    // 로그인 게이트 우회용. preload 만 process.env 접근 가능하므로 renderer
    // 임의 우회 불가 (보안).
    if (window.electronAPI?.testMode?.bypassAuth) {
      adoptIdentity({
        uid: "test-user-bypass",
        email: "test@marblo.dev",
        displayName: "Test User",
        photoURL: null,
        emailVerified: true,
        isAnonymous: false,
        providerData: [],
      } as unknown as User);
      setFirebaseAuthReady(true);
      setLoading(false);
      return;
    }
    // One-line boot marker: proves which auth build is live and what authDomain
    // the redirect handler URL will be built from (empty authDomain silently
    // breaks signInWithRedirect). Grep the packaged console for "[auth]".
    console.info(
      `[auth] AuthProvider init (${AUTH_BUILD_TAG}, authDomain=${
        import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || "<undefined>"
      })`,
    );

    // `settled` guards against the multiple resolution paths below racing each
    // other (timeout vs. onAuthStateChanged vs. authStateReady).
    let settled = false;

    // Fail-safe: if the first auth state never arrives within the timeout (bad
    // embedded config, or the packaged-app IndexedDB persistence hang), stop
    // blocking. We do NOT show a dead-end error — instead we clear `loading` so
    // the signed-out login screen renders, and flag `initDegraded` for a banner.
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      setInitDegraded(true);
      setFirebaseAuthReady(false);
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (settled) {
        // A late-arriving real state after the degraded fallback: adopt it and
        // drop the banner so recovery is seamless.
        setInitDegraded(false);
        adoptIdentity(firebaseUser);
        recoverAdoptedUserProfile(firebaseUser, "late auth state");
        setFirebaseAuthReady(true);
        setLoading(false);
        return;
      }
      settled = true;
      clearTimeout(timeout);
      adoptIdentity(firebaseUser);
      recoverAdoptedUserProfile(firebaseUser, "auth state");
      setFirebaseAuthReady(true);
      setLoading(false);
    });

    // Belt-and-suspenders alongside onAuthStateChanged: authStateReady() resolves
    // once the initial auth state is determined. Awaiting it in parallel clears
    // `loading` even if the onAuthStateChanged callback is delayed.
    auth
      .authStateReady()
      .then(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        adoptIdentity(auth.currentUser);
        recoverAdoptedUserProfile(auth.currentUser, "authStateReady");
        setFirebaseAuthReady(true);
        setLoading(false);
      })
      .catch(() => {
        // Ignore — the timeout fallback still covers a stuck init.
      });

    // getRedirectResult 는 authDomain iframe(…/__/auth/iframe)을 로드한다. 패키징
    // (loopback) 모드에선 이 iframe 이 127.0.0.1 top origin 에서 hang 하여 이후
    // signInWithCredential 을 auth/network-request-failed 로 막는다 (티켓
    // KVId8CCsu8pXYGhRGtz3). loopback 은 redirect 를 쓰지 않으므로 이 호출 자체가
    // 불필요하다 → 패키징에선 스킵하고 dev/웹에서만 pending redirect 를 회수한다.
    // 패키징에서 loading 은 onAuthStateChanged/authStateReady/timeout 이 해제한다.
    if (!isPackagedLoopbackAuth) {
      getRedirectResult(auth)
        .then(async (result) => {
          if (!result) {
            console.info("[auth] getRedirectResult: no pending redirect");
            return;
          }
          console.info("[auth] getRedirectResult: signed in via redirect");
          telemetry.loginSuccess("google");
          await grantMarketingConsentForUser(
            result.user,
            "google",
            consumeMarketingConsentFromRedirect(),
          );
          settled = true;
          clearTimeout(timeout);
          setError(null);
          setInitDegraded(false);
          adoptIdentity(result.user);
          setFirebaseAuthReady(true);
          setLoading(false);
          syncAgentFirebaseAuthForUser(
            result.user,
            "redirect result",
            true,
          ).catch((e: unknown) => {
            console.error("[auth] agent Firebase auth sync failed", e);
          });
        })
        .catch((e: unknown) => {
          const code = (e as { code?: string })?.code ?? "?";
          console.error(`[auth] getRedirectResult: error code=${code}`, e);
          telemetry.loginFailed("google", authErrorCode(e));
          settled = true;
          clearTimeout(timeout);
          setError(e instanceof Error ? e.message : t("auth.error.google"));
          setFirebaseAuthReady(true);
          setLoading(false);
        });
    } else {
      console.info(
        "[auth] getRedirectResult: skipped (packaged loopback — no authDomain iframe)",
      );
    }

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
    // adoptIdentity/recoverAdoptedUserProfile 는 useCallback([]) 으로 안정 참조 —
    // 재실행을 유발하지 않는다.
  }, [adoptIdentity, recoverAdoptedUserProfile]);

  useEffect(() => {
    if (window.electronAPI?.testMode?.bypassAuth) return;

    const unsubscribe = onIdTokenChanged(auth, (firebaseUser) => {
      if (!firebaseUser) {
        clearAgentFirebaseAuth().catch((e: unknown) => {
          console.warn("[auth] agent Firebase auth clear failed", e);
        });
        return;
      }

      syncAgentFirebaseAuthForUser(firebaseUser, "id-token observer").catch(
        (e: unknown) => {
          console.error("[auth] agent Firebase auth sync failed", e);
        },
      );
    });

    return unsubscribe;
  }, []);

  // Packaged app (B안, ticket QvaYPAjAW822I0IDiwwZ): the app is served from the
  // custom 127.0.0.1 static-server origin where signInWithRedirect silently
  // hangs (storage partitioning — it never starts the top-level navigation). We
  // instead run a system-browser loopback OAuth flow in the main process (RFC
  // 8252 + PKCE), get back a Google id_token, and finish here with
  // signInWithCredential. onAuthStateChanged then picks up the signed-in user.
  const loginWithGoogleLoopback = async (
    options?: AuthMarketingConsentOptions,
  ) => {
    console.info(`[auth] loginWithGoogle: loopback path (${AUTH_BUILD_TAG})`);
    // Pre-check the client id for a precise, actionable error. Main also guards
    // and returns its own message, but this catches the common misconfiguration
    // before we even open the browser.
    if (!import.meta.env.VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID) {
      console.error(
        "[auth] loginWithGoogle: VITE_GOOGLE_DESKTOP_OAUTH_CLIENT_ID is empty",
      );
      setError(t("auth.error.googleClientMissing"));
      return;
    }
    try {
      const result = await window.electronAPI!.auth.googleLoopback();
      if (!result.ok || !result.idToken) {
        console.error(
          `[auth] loginWithGoogle: loopback failed — ${result.error ?? "unknown"}`,
        );
        telemetry.loginFailed("google", "loopback/no-token");
        setError(result.error || t("auth.error.google"));
        return;
      }
      console.info(
        "[auth] loginWithGoogle: loopback tokens received → signInWithCredential",
      );
      const credential = GoogleAuthProvider.credential(
        result.idToken,
        result.accessToken,
      );
      // Timing marker (ticket kjqOupLBNbkL1MOziadX): the packaged-app failure was
      // signInWithCredential hanging ~30s then throwing auth/network-request-failed
      // because the SDK's heartbeat header prep read a hung IndexedDB on the
      // 127.0.0.1 origin (fixed in lib/firebase.ts by neutralizing IndexedDB).
      // A sub-second elapsed here is the proof the fix took; a ~30000ms elapsed
      // followed by network-request-failed means the guard did not apply.
      const t0 = Date.now();
      const credentialResult = await signInWithCredential(auth, credential);
      console.info(
        `[auth] loginWithGoogle: loopback signInWithCredential ok (${
          Date.now() - t0
        }ms)`,
      );
      telemetry.loginSuccess("google");
      await grantMarketingConsentForUser(
        credentialResult.user,
        "google",
        options,
      );
      await syncAgentFirebaseAuthForUser(
        credentialResult.user,
        "google loopback",
        true,
      );
    } catch (e) {
      const code = (e as { code?: string })?.code ?? "?";
      const message = e instanceof Error ? e.message : String(e);
      console.error(
        `[auth] loginWithGoogle: loopback caught code=${code} message=${message}`,
        e,
      );
      telemetry.loginFailed("google", authErrorCode(e));
      setError(e instanceof Error ? e.message : t("auth.error.google"));
    }
  };

  const loginWithGoogle = async (options?: AuthMarketingConsentOptions) => {
    // The single entry point for both Google paths (loopback + web redirect) —
    // record the attempt once here so login_attempt↔success/failed reconcile.
    telemetry.loginAttempt("google");
    // Prefer the system-browser loopback OAuth whenever the Electron IPC bridge
    // is present — in BOTH the packaged app AND Vite dev (inside Electron).
    // Previously dev was gated onto the in-window signInWithRedirect flow, but
    // that flow silently fails in Electron/Chromium: it round-trips through the
    // Firebase auth handler and returns with NO credential and NO error, never
    // reaching the Google account chooser (third-party storage partitioning —
    // verified via CDP network/console trace). The loopback flow is origin-
    // independent and already the proven path for packaged. Web (no electronAPI)
    // still falls through to the redirect flow below.
    if (typeof window.electronAPI?.auth?.googleLoopback === "function") {
      setError(null);
      return loginWithGoogleLoopback(options);
    }

    const authDomain = import.meta.env.VITE_FIREBASE_AUTH_DOMAIN;
    console.info(
      `[auth] loginWithGoogle: enter (${AUTH_BUILD_TAG}, authDomain=${
        authDomain || "<undefined>"
      })`,
    );
    setError(null);

    // A missing authDomain means the Firebase redirect handler URL can't be
    // built and signInWithRedirect fails obscurely — surface it plainly rather
    // than as a dead button.
    if (!authDomain) {
      console.error(
        "[auth] loginWithGoogle: VITE_FIREBASE_AUTH_DOMAIN is empty",
      );
      telemetry.loginFailed("google", "no-auth-domain");
      setError(t("auth.error.google"));
      return;
    }

    // Whether the window actually navigated away for the redirect. On a normal
    // success the renderer is torn down before this matters; it only stays true-
    // gating the watchdog when navigation never happens.
    let navigated = false;

    try {
      rememberMarketingConsentForRedirect(options);
      // Force a redirect-capable, reliably-writable persistence BEFORE
      // navigating. On the packaged 127.0.0.1 origin IndexedDB can be left in a
      // hung state (ticket Oq63rrnxMYv6fdeNeani); if signInWithRedirect's
      // pending-state write lands on that hung store it never navigates and
      // never throws → the silent dead button we are fixing. localStorage is
      // reliable here. Race a timeout so a hung setPersistence can't itself
      // wedge the flow — we proceed regardless.
      await Promise.race([
        setPersistence(auth, browserLocalPersistence),
        new Promise<void>((resolve) => setTimeout(resolve, 3_000)),
      ]);
      console.info(
        "[auth] loginWithGoogle: persistence set → signInWithRedirect",
      );

      // Watchdog: a real redirect navigates this window away within a second or
      // two. If it neither navigates nor rejects, the pending-redirect write
      // hung — convert that silent no-op into a visible, actionable error.
      const hangTimer = setTimeout(() => {
        if (navigated) return;
        console.error(
          "[auth] loginWithGoogle: no navigation within " +
            `${REDIRECT_NAV_WATCHDOG_MS}ms — redirect appears stuck`,
        );
        telemetry.loginFailed("google", "redirect-stuck");
        setError(t("auth.error.google"));
      }, REDIRECT_NAV_WATCHDOG_MS);

      await signInWithRedirect(
        auth,
        googleProvider,
        browserPopupRedirectResolver,
      );
      // Reached only if the promise resolves before the window unloads.
      navigated = true;
      clearTimeout(hangTimer);
      console.info(
        "[auth] loginWithGoogle: signInWithRedirect resolved (navigating)",
      );
    } catch (e) {
      rememberMarketingConsentForRedirect(undefined);
      navigated = true;
      const code = (e as { code?: string })?.code ?? "?";
      console.error(`[auth] loginWithGoogle: caught code=${code}`, e);
      telemetry.loginFailed("google", authErrorCode(e));
      setError(e instanceof Error ? e.message : t("auth.error.google"));
    }
  };

  const loginWithGithub = async () => {
    telemetry.loginAttempt("github");
    try {
      setError(null);
      const credentialResult = await signInWithPopup(auth, githubProvider);
      telemetry.loginSuccess("github");
      await syncAgentFirebaseAuthForUser(
        credentialResult.user,
        "github popup",
        true,
      );
    } catch (e) {
      telemetry.loginFailed("github", authErrorCode(e));
      setError(e instanceof Error ? e.message : t("auth.error.github"));
    }
  };

  const loginWithEmail = async (
    email: string,
    password: string,
    options?: AuthMarketingConsentOptions,
  ) => {
    telemetry.loginAttempt("email");
    try {
      setError(null);
      const credentialResult = await signInWithEmailAndPassword(
        auth,
        email,
        password,
      );
      telemetry.loginSuccess("email");
      await grantMarketingConsentForUser(
        credentialResult.user,
        "email",
        options,
      );
      await syncAgentFirebaseAuthForUser(
        credentialResult.user,
        "email login",
        true,
      );
    } catch (e) {
      telemetry.loginFailed("email", authErrorCode(e));
      setError(e instanceof Error ? e.message : t("auth.error.email"));
    }
  };

  const signupWithEmail = async (
    email: string,
    password: string,
    options?: AuthMarketingConsentOptions,
  ) => {
    telemetry.loginAttempt("signup");
    try {
      setError(null);
      const credentialResult = await createUserWithEmailAndPassword(
        auth,
        email,
        password,
      );
      telemetry.loginSuccess("signup", true);
      await grantMarketingConsentForUser(
        credentialResult.user,
        "signup",
        options,
      );
      await syncAgentFirebaseAuthForUser(
        credentialResult.user,
        "email signup",
        true,
      );
    } catch (e) {
      telemetry.loginFailed("signup", authErrorCode(e));
      setError(e instanceof Error ? e.message : t("auth.error.signup"));
    }
  };

  const logout = async () => {
    try {
      setError(null);
      await signOut(auth);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.error.logout"));
    }
  };

  const clearError = () => setError(null);
  const authSettled = !loading;
  const humanUser = authSettled && isHumanAuthUser(user) ? user : null;
  const humanAuthReady = !!humanUser && firebaseAuthReady;
  const getHumanIdToken = useCallback(
    async (forceRefresh = false): Promise<string | null> => {
      await auth.authStateReady();
      const candidate = auth.currentUser ?? user;
      if (!isHumanAuthUser(candidate)) return null;
      return candidate.getIdToken(forceRefresh);
    },
    [user],
  );

  return (
    <AuthContext.Provider
      value={{
        user,
        authSettled,
        humanUser,
        humanUserUid: humanUser?.uid ?? null,
        humanAuthReady,
        getHumanIdToken,
        loading,
        error,
        loginWithGoogle,
        loginWithGithub,
        loginWithEmail,
        signupWithEmail,
        logout,
        clearError,
      }}
    >
      {initDegraded && !user && <AuthInitDegradedBanner />}
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Thin non-blocking banner shown when Firebase Auth's initial state took too
 * long to resolve (e.g. the packaged-app IndexedDB persistence hang, ticket
 * Oq63rrnxMYv6fdeNeani). Unlike the old dead-end error screen, the login screen
 * still renders underneath so a new user can sign in — login makes its own
 * network requests and works regardless of the stalled persistence init.
 */
function AuthInitDegradedBanner() {
  return (
    <div
      role="status"
      className="fixed inset-x-0 top-0 z-50 flex items-center justify-center gap-2 bg-amber-500/10 px-4 py-2 text-center text-xs text-amber-200 backdrop-blur-sm"
    >
      <span aria-hidden="true">⚠️</span>
      <span>{t("auth.init.degraded.banner")}</span>
    </div>
  );
}
