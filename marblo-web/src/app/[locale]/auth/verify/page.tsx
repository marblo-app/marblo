"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useSearchParams } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, type User } from "firebase/auth";
import { CheckCircle2, Loader2, MailCheck } from "lucide-react";
import { auth } from "@/lib/firebase";
import { sanitizeRedirect } from "@/lib/sanitizeRedirect";
import { refreshEmailVerified } from "@/lib/emailVerification";
import EmailVerificationActions from "@/components/EmailVerificationActions";
import { localeHref } from "@/i18n/routing";

/**
 * Email verification hub. Two ways in:
 *   1. Straight after email/password signup — we already fired the first mail,
 *      this page explains what to do and offers a resend.
 *   2. As the `continueUrl` Firebase returns the user to after they click the
 *      link — here we re-read the account and mint a fresh ID token so the
 *      `email_verified` claim the founder-survey callable checks is actually
 *      true, then hand them a Continue button.
 *
 * Google accounts arrive already verified and land straight in the success
 * state, so linking here from anywhere is safe.
 */
export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<CenteredSpinner />}>
      <VerifyEmailContent />
    </Suspense>
  );
}

function CenteredSpinner() {
  return (
    <div className="min-h-screen flex items-center justify-center">
      <Loader2 className="w-6 h-6 animate-spin text-indigo-300" />
    </div>
  );
}

type Phase = "loading" | "signedOut" | "unverified" | "verified";

function VerifyEmailContent() {
  const t = useTranslations("emailVerify");
  const locale = useLocale();
  const searchParams = useSearchParams();
  const redirect = sanitizeRedirect(searchParams.get("redirect"), localeHref(locale));
  // Signup hands off with ?sent=1 so we don't double-fire the first email.
  const alreadySent = searchParams.get("sent") === "1";

  const [phase, setPhase] = useState<Phase>("loading");
  const [user, setUser] = useState<User | null>(null);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!u) {
        setUser(null);
        setPhase("signedOut");
        return;
      }
      setUser(u);
      // The cached auth state predates the click on the email link, so the
      // local `emailVerified` flag is stale on exactly the arrival we care
      // about most. Ask the server before deciding what to render.
      try {
        const verified = await refreshEmailVerified(u);
        setPhase(verified ? "verified" : "unverified");
      } catch {
        setPhase(u.emailVerified ? "verified" : "unverified");
      }
    });
    return () => unsub();
  }, []);

  const handleVerified = useCallback(() => setPhase("verified"), []);

  if (phase === "loading") return <CenteredSpinner />;

  if (phase === "signedOut") {
    return (
      <Shell>
        <h1 className="text-2xl font-bold">{t("signed_out_title")}</h1>
        <p className="text-zinc-300 mt-3 leading-relaxed">
          {t("signed_out_body")}
        </p>
        <Link
          href={localeHref(locale, `/auth/login?redirect=${encodeURIComponent(
            localeHref(locale, "/auth/verify")
          )}`)}
          className="inline-flex items-center justify-center mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl text-sm font-semibold transition"
        >
          {t("login")}
        </Link>
      </Shell>
    );
  }

  if (phase === "verified") {
    return (
      <Shell>
        <CheckCircle2 className="w-11 h-11 text-emerald-300 mb-4" />
        <h1 className="text-2xl font-bold text-emerald-100">
          {t("verified_title")}
        </h1>
        <p className="text-emerald-200/80 mt-3 leading-relaxed">
          {t("verified_body")}
        </p>
        <Link
          href={redirect}
          className="inline-flex items-center justify-center mt-6 bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-xl text-sm font-semibold transition"
        >
          {t("continue")}
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <MailCheck className="w-11 h-11 text-indigo-300 mb-4" />
      <h1 className="text-2xl font-bold">{t("title")}</h1>
      <p className="text-zinc-300 mt-3 leading-relaxed">
        {alreadySent
          ? t("sent_to", { email: user?.email ?? "" })
          : t("not_sent_yet", { email: user?.email ?? "" })}
      </p>
      <p className="text-zinc-400 text-sm mt-3 leading-relaxed">{t("body")}</p>
      {user && (
        <EmailVerificationActions
          className="mt-6"
          user={user}
          locale={locale}
          redirect={redirect}
          onVerified={handleVerified}
        />
      )}
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="py-24 px-4">
      <div className="max-w-md mx-auto bg-zinc-900 border border-zinc-800 rounded-2xl p-8">
        {children}
      </div>
    </div>
  );
}
