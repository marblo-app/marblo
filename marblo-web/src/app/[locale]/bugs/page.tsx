"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { onAuthStateChanged, User } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import { Bug, Check, Loader2, Home, AlertCircle } from "lucide-react";

// Firebase callable 에러는 "functions/unauthenticated" 형태의 code 를 담는다.
// 앱 BugReportModal 과 동일한 분기로 사용자 안내 문구를 고른다.
function errorKey(err: unknown): string {
  const code =
    typeof err === "object" && err && "code" in err
      ? String((err as { code?: unknown }).code)
      : "";
  if (code === "functions/unauthenticated") return "errorUnauthenticated";
  if (code === "functions/resource-exhausted") return "errorRateLimited";
  return "errorGeneric";
}

export default function BugsPage() {
  const t = useTranslations("bugReport");
  const locale = useLocale();
  const router = useRouter();

  const [user, setUser] = useState<User | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [description, setDescription] = useState("");
  const [repro, setRepro] = useState("");
  const [expected, setExpected] = useState("");

  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 인증 가드 — 미로그인이면 로그인으로 리다이렉트(admin/download/checkout 과 동일 패턴).
  // submitBugReport 는 context.auth 필수라 프론트에서 먼저 막아 unauthenticated 를 회피한다.
  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (u) => {
      setAuthLoading(false);
      if (!u) {
        router.push(
          `/${locale}/auth/login?redirect=${encodeURIComponent(
            `/${locale}/bugs`
          )}`
        );
      } else {
        setUser(u);
      }
    });
    return () => unsub();
  }, [locale, router]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!description.trim()) {
      setError(t("required"));
      return;
    }
    if (!user) {
      setError(t("errorUnauthenticated"));
      return;
    }

    // 폼의 재현 단계·기대 결과를 하나의 description 으로 합친다 — 백엔드에는
    // 단일 description 필드만 있으므로(별도 필드 없음) 고정 마커로 구획한다.
    let composed = description.trim();
    if (repro.trim()) {
      composed += `\n\n[재현 단계 / Steps to reproduce]\n${repro.trim()}`;
    }
    if (expected.trim()) {
      composed += `\n\n[기대 결과 / Expected result]\n${expected.trim()}`;
    }

    // submitBugReport(백엔드, 무변경)은 서버에서 uid·email·createdAt 을 각인하고
    // description·platform·context.{route,recentLogs,agentSnapshot} 만 영속화한다.
    // 폼에서는 PII(이름·이메일)를 받지 않는다 — 이메일은 백엔드가 인증 토큰에서 취득.
    // 웹 출처(source)·URL·userAgent 는 백엔드가 저장하는 필드(platform·context.route·
    // context.recentLogs)로 매핑해 어드민 트리아지(admin/page.tsx)에 그대로 노출한다.
    const url = typeof window !== "undefined" ? window.location.href : "";
    const userAgent =
      typeof navigator !== "undefined" ? navigator.userAgent : "";
    const payload = {
      description: composed,
      platform: "web",
      context: {
        source: "web",
        url,
        userAgent,
        route: url,
        recentLogs: `source: web\nuserAgent: ${userAgent}`,
      },
    };

    setSubmitting(true);
    setError(null);
    try {
      const fn = httpsCallable(
        getFunctions(app, "us-central1"),
        "submitBugReport"
      );
      await fn(payload);
      setSuccess(true);
    } catch (err) {
      setError(t(errorKey(err) as Parameters<typeof t>[0]));
    } finally {
      setSubmitting(false);
    }
  };

  const resetForm = () => {
    setDescription("");
    setRepro("");
    setExpected("");
    setSuccess(false);
    setError(null);
  };

  // 인증 판정 대기 — 폼 노출 전 스피너만.
  if (authLoading) {
    return (
      <div className="py-24 px-4 flex justify-center">
        <Loader2 className="w-8 h-8 animate-spin text-zinc-400" />
      </div>
    );
  }

  // 리다이렉트 진행 중 — 아무것도 렌더하지 않는다.
  if (!user) return null;

  return (
    <div className="py-16 px-4">
      <div className="max-w-lg mx-auto">
        <div className="flex items-center gap-3 mb-2">
          <Bug className="w-7 h-7 text-indigo-400" />
          <h1 className="text-2xl font-bold">{t("title")}</h1>
        </div>
        <p className="text-sm text-zinc-400 leading-relaxed mb-8">
          {t("subtitle")}
        </p>

        {success ? (
          <div className="bg-zinc-900 border border-zinc-800 rounded-2xl p-8 text-center space-y-4">
            <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-green-500/15">
              <Check className="w-7 h-7 text-green-400" />
            </div>
            <h2 className="text-lg font-semibold">{t("successTitle")}</h2>
            <p className="text-sm text-zinc-400">{t("successBody")}</p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <button
                onClick={resetForm}
                className="inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white px-5 py-2.5 rounded-lg text-sm font-medium transition"
              >
                <Bug className="w-4 h-4" />
                {t("submitAnother")}
              </button>
              <Link
                href={`/${locale}`}
                className="inline-flex items-center justify-center gap-2 border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-5 py-2.5 rounded-lg text-sm font-medium transition"
              >
                <Home className="w-4 h-4" />
                {t("backHome")}
              </Link>
            </div>
          </div>
        ) : (
          <form
            onSubmit={handleSubmit}
            className="bg-zinc-900 border border-zinc-800 rounded-2xl p-6 space-y-5"
          >
            {error && (
              <div className="flex items-start gap-2 rounded-lg border border-red-900/50 bg-red-950/30 px-3 py-2.5 text-sm text-red-400">
                <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <div>
              <label
                htmlFor="bug-description"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                {t("descriptionLabel")} <span className="text-red-400">*</span>
              </label>
              <textarea
                id="bug-description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={5}
                maxLength={5000}
                autoFocus
                className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                placeholder={t("descriptionPlaceholder")}
              />
            </div>

            <div>
              <label
                htmlFor="bug-repro"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                {t("reproLabel")}
              </label>
              <textarea
                id="bug-repro"
                value={repro}
                onChange={(e) => setRepro(e.target.value)}
                rows={3}
                maxLength={5000}
                className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                placeholder={t("reproPlaceholder")}
              />
            </div>

            <div>
              <label
                htmlFor="bug-expected"
                className="mb-1.5 block text-sm font-medium text-zinc-300"
              >
                {t("expectedLabel")}
              </label>
              <textarea
                id="bug-expected"
                value={expected}
                onChange={(e) => setExpected(e.target.value)}
                rows={2}
                maxLength={5000}
                className="w-full resize-none rounded-lg border border-zinc-700 bg-zinc-950 px-3 py-2 text-sm text-zinc-100 placeholder-zinc-600 focus:border-indigo-500 focus:outline-none"
                placeholder={t("expectedPlaceholder")}
              />
            </div>

            {/* 개인정보 미수집 안내 — 폼에서 이름·이메일을 받지 않음. */}
            <p className="text-xs text-zinc-500 leading-relaxed">
              {t("privacyNote")}
            </p>

            <button
              type="submit"
              disabled={submitting}
              className="w-full inline-flex items-center justify-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white px-5 py-3 rounded-lg text-sm font-semibold transition"
            >
              {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
              {submitting ? t("submitting") : t("submit")}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
