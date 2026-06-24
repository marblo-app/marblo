"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import {
  Apple,
  Monitor,
  Sparkles,
  Download,
  Loader2,
  Lock,
} from "lucide-react";

// 버전 고정 다운로드 링크 — 새 빌드 릴리스 시 이 두 값만 갱신.
const APP_VERSION = "v3.0.0";
const MAC_DMG_URL =
  "https://github.com/melocream/marblo-releases/releases/download/v3.0.0/Marblo-3.0.0-arm64.dmg";

// 소프트(인지) 게이트 상태. 바이너리는 공개 릴리스라 하드 차단이 아니라,
// 미로그인/비선정 사용자에게 다운로드 대신 적절한 다음 행동을 안내한다.
type AccessState = "loading" | "anon" | "pending" | "granted";

export default function DownloadPage() {
  const t = useTranslations("download");
  const locale = useLocale();
  const [state, setState] = useState<AccessState>("loading");

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (u) => {
      if (!active) return;
      if (!u) {
        setState("anon");
        return;
      }
      setState("loading");
      try {
        const functions = getFunctions(app, "us-central1");
        const getAccess = httpsCallable(functions, "getMyFounderAccess");
        const res = await getAccess();
        const hasAccess =
          (res.data as { hasAccess?: boolean })?.hasAccess === true;
        if (active) setState(hasAccess ? "granted" : "pending");
      } catch {
        // 소프트 게이트: 조회 실패 시 다운로드를 노출하지 않는 쪽으로 폴백.
        if (active) setState("pending");
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  return (
    <div className="py-24 px-4">
      <div className="max-w-3xl mx-auto text-center">
        <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          {t("badge")}
        </span>
        <h1 className="text-4xl md:text-5xl font-bold mt-6 whitespace-pre-line">
          {t("title")}
        </h1>

        {state === "loading" && (
          <div className="mt-12 flex justify-center">
            <Loader2 className="w-7 h-7 animate-spin text-indigo-300" />
          </div>
        )}

        {/* ① 미로그인 — 로그인/가입 안내, DMG 숨김 */}
        {state === "anon" && (
          <div className="mt-12 p-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 max-w-md mx-auto">
            <Lock className="w-8 h-8 text-indigo-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">{t("gate_anon_title")}</h2>
            <p className="text-zinc-400 text-sm mt-2 mb-6 leading-relaxed">
              {t("gate_anon_body")}
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center">
              <Link
                href={`/${locale}/auth/login?redirect=${encodeURIComponent(
                  `/${locale}/download`,
                )}`}
                className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition"
              >
                {t("gate_login")}
              </Link>
              <Link
                href={`/${locale}/auth/signup`}
                className="border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-medium transition"
              >
                {t("gate_signup")}
              </Link>
            </div>
          </div>
        )}

        {/* ② 로그인+비선정 — 파운더 신청 안내, DMG 숨김 */}
        {state === "pending" && (
          <div className="mt-12 p-8 rounded-2xl border border-zinc-800 bg-zinc-900/40 max-w-md mx-auto">
            <Sparkles className="w-8 h-8 text-indigo-300 mx-auto mb-4" />
            <h2 className="text-xl font-semibold">{t("gate_pending_title")}</h2>
            <p className="text-zinc-400 text-sm mt-2 mb-6 leading-relaxed">
              {t("gate_pending_body")}
            </p>
            <Link
              href={`/${locale}/founders`}
              className="inline-flex items-center justify-center bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition"
            >
              {t("gate_apply_cta")}
            </Link>
          </div>
        )}

        {/* ③ 선정 — 기존 다운로드 카드 노출 */}
        {state === "granted" && (
          <>
            <p className="text-zinc-400 mt-4 whitespace-pre-line leading-relaxed">
              {t("subtitle")}
            </p>

            <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
              {/* macOS — 다운로드 가능 */}
              <a
                href={MAC_DMG_URL}
                className="group flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-indigo-500/50 bg-indigo-600/10 hover:bg-indigo-600/20 hover:border-indigo-400 transition"
              >
                <Apple className="w-7 h-7 text-zinc-200" />
                <span className="text-sm font-medium text-zinc-100">
                  {t("macos")}
                </span>
                <span className="text-xs text-zinc-400">
                  {t("mac_sub")} · {APP_VERSION}
                </span>
                <span className="mt-1 inline-flex items-center gap-2 bg-indigo-600 group-hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                  <Download className="w-4 h-4" />
                  {t("download_now")}
                </span>
              </a>

              {/* Windows — 준비 중 */}
              <div className="flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-zinc-800 bg-zinc-900/50 opacity-60">
                <Monitor className="w-7 h-7 text-zinc-400" />
                <span className="text-sm font-medium text-zinc-300">
                  {t("windows")}
                </span>
                <span className="text-xs text-zinc-500">{t("preparing")}</span>
              </div>
            </div>

            <div className="mt-12 p-8 rounded-2xl border border-zinc-800 bg-zinc-900/40">
              <h2 className="text-xl font-semibold">{t("notify_title")}</h2>
              <p className="text-zinc-400 text-sm mt-2 mb-6">
                {t("notify_subtitle")}
              </p>
              <div className="flex flex-col sm:flex-row gap-3 justify-center">
                <Link
                  href={`/${locale}/auth/signup`}
                  className="bg-indigo-600 hover:bg-indigo-500 text-white px-6 py-3 rounded-lg font-medium transition"
                >
                  {t("notify_cta")}
                </Link>
                <Link
                  href={`/${locale}/pricing`}
                  className="border border-zinc-700 hover:bg-zinc-800 text-zinc-200 px-6 py-3 rounded-lg font-medium transition"
                >
                  {t("pricing_cta")}
                </Link>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
