import { createContext, useEffect, useState, type ReactNode } from "react";
import {
  onAuthStateChanged,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
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

    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  const loginWithGoogle = async () => {
    try {
      setError(null);
      await signInWithPopup(auth, googleProvider);
    } catch (e) {
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
