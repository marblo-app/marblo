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

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
    const unsubscribe = onAuthStateChanged(auth, (firebaseUser) => {
      setUser(firebaseUser);
      setLoading(false);
    });
    return unsubscribe;
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
      {children}
    </AuthContext.Provider>
  );
}
