"use client";

import { useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { addDoc, collection, serverTimestamp } from "firebase/firestore";
import { ArrowRight, CheckCircle2 } from "lucide-react";
import { db } from "@/lib/firebase";
import { trackGenerateLead } from "@/lib/gtag";

const COLLECTION = "betatester50_waitlist";
const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

type Status = "idle" | "submitting" | "success" | "error";
type Locale = "ko" | "en" | "ja";
type Source = "home" | "promo_bar" | "foundation50_page";

interface Props {
  source: Source;
  layout?: "stacked" | "inline-compact";
  onSuccess?: () => void;
}

export default function BetaTester50SignupForm({
  source,
  layout = "stacked",
  onSuccess,
}: Props) {
  const t = useTranslations("betatester50");
  const locale = useLocale() as Locale;

  const [email, setEmail] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    const cleaned = email.trim().toLowerCase();
    if (!EMAIL_RE.test(cleaned) || cleaned.length > 254) {
      setErrorMsg(t("error_invalid_email"));
      setStatus("error");
      return;
    }
    if (!ageConfirmed) {
      setErrorMsg(t("error_age_required"));
      setStatus("error");
      return;
    }
    if (!agreed) {
      setErrorMsg(t("error_consent_required"));
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMsg(null);

    try {
      await addDoc(collection(db, COLLECTION), {
        email: cleaned,
        locale,
        source,
        agreed: true,
        agreedAt: serverTimestamp(),
        createdAt: serverTimestamp(),
      });
      // GA4 generate_lead — waitlist 문서 쓰기 성공 직후에만 발화.
      // ⚠️ 이메일 등 PII 미포함 — source/locale 같은 비식별 값만.
      trackGenerateLead({ source, locale });
      setStatus("success");
      onSuccess?.();
    } catch {
      setErrorMsg(t("error_network"));
      setStatus("error");
    }
  }

  const isSubmitting = status === "submitting";
  const isSuccess = status === "success";

  if (isSuccess) {
    return (
      <div className="flex items-start gap-3 bg-emerald-500/10 border border-emerald-500/40 rounded-2xl p-5">
        <CheckCircle2 className="w-6 h-6 text-emerald-300 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-emerald-100 font-semibold text-lg">
            {t("success_title")}
          </p>
          <p className="text-emerald-200/80 text-sm mt-1 leading-relaxed">
            {t("success_body")}
          </p>
        </div>
      </div>
    );
  }

  const compact = layout === "inline-compact";

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <div
        className={
          compact
            ? "flex flex-col sm:flex-row gap-2"
            : "flex flex-col sm:flex-row gap-3"
        }
      >
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          required
          disabled={isSubmitting}
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (status === "error") setStatus("idle");
          }}
          placeholder={t("email_placeholder")}
          aria-label={t("email_placeholder")}
          className={
            compact
              ? "flex-1 bg-zinc-950/70 border border-indigo-400/40 focus:border-indigo-300 rounded-md px-3 py-1.5 text-sm text-white placeholder-zinc-400 focus:outline-none disabled:opacity-50"
              : "flex-1 bg-zinc-950/70 border border-zinc-700 rounded-xl px-5 py-4 text-base text-white placeholder-zinc-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/60 focus:border-indigo-500 disabled:opacity-50"
          }
        />
        <button
          type="submit"
          disabled={isSubmitting}
          className={
            compact
              ? "inline-flex items-center justify-center gap-1 bg-white text-indigo-700 hover:bg-indigo-50 disabled:bg-zinc-300 disabled:text-zinc-500 disabled:cursor-not-allowed transition px-3 py-1.5 rounded-md text-sm font-semibold shrink-0"
              : "inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:bg-zinc-700 disabled:text-zinc-400 disabled:cursor-not-allowed text-white px-7 py-4 rounded-xl text-base font-semibold transition shadow-lg shadow-indigo-600/30"
          }
        >
          {isSubmitting ? t("cta_submitting") : t("cta_apply")}
          {!isSubmitting && (
            <ArrowRight className={compact ? "w-3.5 h-3.5" : "w-4 h-4"} />
          )}
        </button>
      </div>

      <label
        className={
          compact
            ? "flex items-start gap-2 text-xs text-indigo-100/90 cursor-pointer select-none"
            : "flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none"
        }
      >
        <input
          type="checkbox"
          checked={ageConfirmed}
          onChange={(e) => {
            setAgeConfirmed(e.target.checked);
            if (status === "error") setStatus("idle");
          }}
          disabled={isSubmitting}
          className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
        />
        <span className="leading-snug">{t("age_confirm_label")}</span>
      </label>

      <label
        className={
          compact
            ? "flex items-start gap-2 text-xs text-indigo-100/90 cursor-pointer select-none"
            : "flex items-start gap-2 text-sm text-zinc-300 cursor-pointer select-none"
        }
      >
        <input
          type="checkbox"
          checked={agreed}
          onChange={(e) => {
            setAgreed(e.target.checked);
            if (status === "error") setStatus("idle");
          }}
          disabled={isSubmitting}
          className="mt-0.5 w-4 h-4 rounded border-zinc-600 bg-zinc-900 text-indigo-500 focus:ring-indigo-500/40"
        />
        <span className="leading-snug">
          {t("consent_label")}{" "}
          <Link
            href={`/${locale}/legal/privacy`}
            target="_blank"
            className="text-indigo-300 hover:text-indigo-200 underline"
          >
            {t("consent_privacy_view")}
          </Link>
        </span>
      </label>

      {errorMsg && (
        <p
          className={
            compact ? "text-xs text-amber-300" : "text-sm text-red-300"
          }
        >
          {errorMsg}
        </p>
      )}
    </form>
  );
}
