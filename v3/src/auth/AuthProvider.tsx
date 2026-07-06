import { createContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  getRedirectResult,
  signInWithPopup,
  signInWithRedirect,
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
import { auth } from "../lib/firebase";
import { t } from "../lib/i18n";

export interface AuthContextType {
  user: User | null;
  loading: boolean;
  error: string | null;
  loginWithGoogle: () => Promise<void>;
  loginWithGithub: () => Promise<void>;
  loginWithEmail: (email: string, password: string) => Promise<void>;
  signupWithEmail: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  clearError: () => void;
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
const AUTH_BUILD_TAG = "google-login=redirect-v2";

// If signInWithRedirect neither navigates the window away nor rejects within
// this window, its pending-redirect persistence write has silently hung (the
// packaged 127.0.0.1 IndexedDB hang). We surface a visible error instead of a
// dead, silent button. Generous so a slow-but-successful navigation never trips
// it (a real navigation tears down this renderer well before then).
const REDIRECT_NAV_WATCHDOG_MS = 8_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flips true if Firebase Auth doesn't report an initial state within the
  // timeout. Rather than a dead-end error screen, we fall back to the normal
  // (signed-out) login screen and surface this as a thin banner — a new user is
  // simply not signed in yet, and the login flow makes its own network calls
  // that work independently of the stalled persistence init.
  const [initDegraded, setInitDegraded] = useState(false);

  useEffect(() => {
    // Test hatch — main process 가 MARBLO_TEST_BYPASS_AUTH=1 로 launch 된
    // 경우 Firebase Auth 를 건너뛰고 mock user 로 통과. Playwright e2e 에서
    // 로그인 게이트 우회용. preload 만 process.env 접근 가능하므로 renderer
    // 임의 우회 불가 (보안).
    if (window.electronAPI?.testMode?.bypassAuth) {
      setUser({
        uid: "test-user-bypass",
        email: "test@marblo.dev",
        displayName: "Test User",
        photoURL: null,
        emailVerified: true,
        isAnonymous: false,
        providerData: [],
      } as unknown as User);
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
      setLoading(false);
    }, AUTH_INIT_TIMEOUT_MS);

    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      if (settled) {
        // A late-arriving real state after the degraded fallback: adopt it and
        // drop the banner so recovery is seamless.
        setInitDegraded(false);
        setUser(firebaseUser);
        setLoading(false);
        return;
      }
      settled = true;
      clearTimeout(timeout);
      setUser(firebaseUser);
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
        setUser(auth.currentUser);
        setLoading(false);
      })
      .catch(() => {
        // Ignore — the timeout fallback still covers a stuck init.
      });

    getRedirectResult(auth)
      .then((result) => {
        if (!result) {
          console.info("[auth] getRedirectResult: no pending redirect");
          return;
        }
        console.info("[auth] getRedirectResult: signed in via redirect");
        settled = true;
        clearTimeout(timeout);
        setError(null);
        setInitDegraded(false);
        setUser(result.user);
        setLoading(false);
      })
      .catch((e) => {
        const code = (e as { code?: string })?.code ?? "?";
        console.error(`[auth] getRedirectResult: error code=${code}`, e);
        settled = true;
        clearTimeout(timeout);
        setError(e instanceof Error ? e.message : t("auth.error.google"));
        setLoading(false);
      });

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const loginWithGoogle = async () => {
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
      setError(t("auth.error.google"));
      return;
    }

    // Whether the window actually navigated away for the redirect. On a normal
    // success the renderer is torn down before this matters; it only stays true-
    // gating the watchdog when navigation never happens.
    let navigated = false;

    try {
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
      navigated = true;
      const code = (e as { code?: string })?.code ?? "?";
      console.error(`[auth] loginWithGoogle: caught code=${code}`, e);
      setError(e instanceof Error ? e.message : t("auth.error.google"));
    }
  };

  const loginWithGithub = async () => {
    try {
      setError(null);
      await signInWithPopup(auth, githubProvider);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.error.github"));
    }
  };

  const loginWithEmail = async (email: string, password: string) => {
    try {
      setError(null);
      await signInWithEmailAndPassword(auth, email, password);
    } catch (e) {
      setError(e instanceof Error ? e.message : t("auth.error.email"));
    }
  };

  const signupWithEmail = async (email: string, password: string) => {
    try {
      setError(null);
      await createUserWithEmailAndPassword(auth, email, password);
    } catch (e) {
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

  return (
    <AuthContext.Provider
      value={{
        user,
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
