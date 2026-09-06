"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import {
  signInWithEmailAndPassword,
  signInWithPopup,
  GoogleAuthProvider,
} from "firebase/auth";
import { auth } from "@/lib/firebase";
import { sanitizeRedirect } from "@/lib/sanitizeRedirect";
import { isPlausibleEmail } from "@/lib/orgOnboarding";
import { localeHref } from "@/i18n/routing";
import { mapAuthError, type AuthErrorKey } from "@/lib/authErrors";
import { LoginFormView } from "./LoginFormView";

export default function LoginPage() {
  const t = useTranslations("auth");
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirect(
    searchParams.get("redirect"),
    localeHref(locale),
  );
  // 초대 흐름(#1338 (f))의 프리필 — 이메일 겉모양일 때만 초기값으로 쓴다.
  // 표시가 아니라 입력 초기값이라 위조 파라미터가 화면 문구를 바꾸지는 못한다.
  const emailParam = searchParams.get("email");
  const [email, setEmail] = useState(
    emailParam && isPlausibleEmail(emailParam) ? emailParam : "",
  );
  const [password, setPassword] = useState("");
  // ★에러는 문자열이 아니라 **i18n 키**로만 들고 있는다. Firebase 원문이
  // 화면까지 흘러갈 경로 자체를 없앤다(src/lib/authErrors.ts 참고).
  const [errorKey, setErrorKey] = useState<AuthErrorKey | null>(null);
  // ★제출 진행 상태(감사 #1495 P1-4). 성공 시에는 내리지 않는다 —
  //   `router.push` 는 즉시 화면을 바꾸지 않으므로, 여기서 busy 를 풀면
  //   이동 대기 중에 버튼이 다시 살아나 두 번째 로그인이 나간다.
  const [busy, setBusy] = useState(false);

  const run = async (attempt: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    setErrorKey(null);
    try {
      await attempt();
      router.push(redirect);
    } catch (err: unknown) {
      setErrorKey(mapAuthError(err));
      setBusy(false);
    }
  };

  return (
    <LoginFormView
      copy={{
        title: t("login"),
        google: t("loginWithGoogle"),
        or: t("or"),
        email: t("email"),
        password: t("password"),
        submit: t("login"),
        submitting: t("submitting"),
        noAccount: t("noAccount"),
        error: errorKey ? t(errorKey) : null,
      }}
      email={email}
      password={password}
      busy={busy}
      onEmailChange={setEmail}
      onPasswordChange={setPassword}
      onSubmit={() =>
        void run(() => signInWithEmailAndPassword(auth, email, password))
      }
      onGoogle={() =>
        void run(() => signInWithPopup(auth, new GoogleAuthProvider()))
      }
      signupSlot={
        /* redirect·프리필을 가입 쪽에도 관통 — 초대 흐름(#1338 (f))이 여기서 끊기지 않게 */
        <Link
          href={localeHref(
            locale,
            `/auth/signup?redirect=${encodeURIComponent(redirect)}${
              email && isPlausibleEmail(email)
                ? `&email=${encodeURIComponent(email)}`
                : ""
            }`,
          )}
          className="text-indigo-400 hover:underline"
        >
          {t("signupLink")}
        </Link>
      }
    />
  );
}
