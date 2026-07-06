import { useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { useTranslation } from "../lib/i18n";

export function LoginPage() {
  const { t } = useTranslation();
  const {
    loginWithGoogle,
    loginWithEmail,
    signupWithEmail,
    error,
    clearError,
  } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSignup, setIsSignup] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSignup) {
      await signupWithEmail(email, password);
    } else {
      await loginWithEmail(email, password);
    }
  };

  const toggleMode = () => {
    clearError();
    setIsSignup((prev) => !prev);
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-50">
      <div className="w-full max-w-md rounded-2xl bg-white p-8 shadow-lg">
        {/* Header */}
        <div className="mb-8 text-center">
          <h1 className="text-3xl font-bold text-gray-900">Marblo</h1>
          <p className="mt-2 text-sm text-gray-500">
            {isSignup
              ? t("onboarding.login.signupSubtitle")
              : t("onboarding.login.loginSubtitle")}
          </p>
        </div>

        {/* Error */}
        {error && (
          <div className="mb-4 rounded-lg bg-red-50 p-3 text-sm text-red-600">
            {error}
          </div>
        )}

        {/* Social Login */}
        <div className="space-y-3">
          <button
            type="button"
            onClick={loginWithGoogle}
            className="flex w-full items-center justify-center gap-3 rounded-lg border border-gray-300 bg-white px-4 py-2.5 text-sm font-medium text-gray-700 transition hover:bg-gray-50"
          >
            <svg className="h-5 w-5" viewBox="0 0 24 24">
              <path
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                fill="#4285F4"
              />
              <path
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                fill="#34A853"
              />
              <path
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                fill="#FBBC05"
              />
              <path
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                fill="#EA4335"
              />
            </svg>
            {t("onboarding.login.google")}
          </button>
          {/* GitHub 로그인은 GitHub OAuth 미설정으로 숨김 (marblo-web #291 과 동일).
              설정 시 이 버튼과 useAuth().loginWithGithub 를 다시 노출. */}
        </div>

        {/* Divider */}
        <div className="my-6 flex items-center">
          <div className="flex-1 border-t border-gray-300" />
          <span className="mx-4 text-xs text-gray-400">
            {t("onboarding.login.or")}
          </span>
          <div className="flex-1 border-t border-gray-300" />
        </div>

        {/* Email Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="email"
              className="block text-sm font-medium text-gray-700"
            >
              {t("onboarding.login.email")}
            </label>
            <input
              id="email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="you@example.com"
            />
          </div>
          <div>
            <label
              htmlFor="password"
              className="block text-sm font-medium text-gray-700"
            >
              {t("onboarding.login.password")}
            </label>
            <input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="••••••••"
            />
          </div>
          <button
            type="submit"
            className="w-full rounded-lg bg-blue-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
          >
            {isSignup
              ? t("onboarding.login.signupButton")
              : t("onboarding.login.loginButton")}
          </button>
        </form>

        {/* Toggle signup/login */}
        <p className="mt-6 text-center text-sm text-gray-500">
          {isSignup
            ? t("onboarding.login.haveAccount")
            : t("onboarding.login.noAccount")}{" "}
          <button
            type="button"
            onClick={toggleMode}
            className="font-medium text-blue-600 hover:text-blue-500"
          >
            {isSignup
              ? t("onboarding.login.loginButton")
              : t("onboarding.login.signupButton")}
          </button>
        </p>
      </div>
    </div>
  );
}
