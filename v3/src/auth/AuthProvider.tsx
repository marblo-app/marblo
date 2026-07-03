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

// How long to wait for Firebase Auth to report an initial state before we
// assume the config is broken (or the network is dead) and show an error
// screen instead of an infinite spinner. See regression BAcFpVKbTFX18gs3UEEt:
// a placeholder Firebase config makes onAuthStateChanged never fire, so
// `loading` stayed true forever. 10s is comfortably above a normal cold start.
const AUTH_INIT_TIMEOUT_MS = 10_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Flips true if Firebase Auth never reports an initial state within the
  // timeout — the signal that the embedded config is bad or the network is down.
  const [initTimedOut, setInitTimedOut] = useState(false);

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
    // Fail-safe: if the first auth state never arrives (e.g. an invalid embedded
    // Firebase config where onAuthStateChanged silently never fires), surface an
    // error screen rather than spinning forever.
    const timeout = setTimeout(() => {
      setInitTimedOut(true);
    }, AUTH_INIT_TIMEOUT_MS);
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      clearTimeout(timeout);
      setUser(firebaseUser);
      setLoading(false);
    });
    return () => {
      clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  // Config/network failure fallback. Only shown while auth is still unresolved —
  // if a slow initial state eventually arrives, `loading` flips false and the
  // normal app renders (graceful recovery, no forced reload needed).
  if (initTimedOut && loading) {
    return <AuthInitErrorScreen />;
  }

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
      {children}
    </AuthContext.Provider>
  );
}

/**
 * Shown when Firebase Auth never reports an initial state (bad embedded config
 * or dead network) — replaces the otherwise-infinite loading spinner with an
 * actionable message and a retry that reloads the renderer.
 */
function AuthInitErrorScreen() {
  return (
    <div className="flex h-screen items-center justify-center bg-gray-900">
      <div className="max-w-md px-6 text-center">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-red-500/10 text-2xl">
          ⚠️
        </div>
        <h1 className="text-lg font-semibold text-gray-100">
          {t("auth.init.timeout.title")}
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-gray-400">
          {t("auth.init.timeout.message")}
        </p>
        <button
          type="button"
          onClick={() => window.location.reload()}
          className="mt-5 rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-blue-500"
        >
          {t("auth.init.timeout.retry")}
        </button>
      </div>
    </div>
  );
}
