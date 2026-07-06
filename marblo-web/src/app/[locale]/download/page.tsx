"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import { trackAppDownload } from "@/lib/gtag";
import {
  Apple,
  Monitor,
  Sparkles,
  Download,
  Loader2,
  Lock,
  Bug,
} from "lucide-react";

// 버전 고정 다운로드 링크 — 새 빌드 릴리스 시 이 값만 갱신.
// 실제 릴리스 자산 파일명 패턴: Marblo-<ver>-arm64.dmg / Marblo-Setup-<ver>.exe
const APP_VERSION = "v3.0.2";
// 파일명에 쓰는 버전(선행 v 없는 SemVer). APP_VERSION 에서 파생.
const VERSION = APP_VERSION.replace(/^v/, "");
const RELEASE_BASE = `https://github.com/melocream/marblo-releases/releases/download/${APP_VERSION}`;

type MacArch = "universal" | "arm64" | "x64";

// v3.0.2 릴리스는 arm64 DMG 단일 산출이다(universal 빌드는 깨져서 미산출됨).
// 따라서 세 아키 키 모두 실체인 arm64 DMG(Apple Silicon 대상)로 매핑한다.
// per-arch/universal 자산이 다시 산출되면 이 맵만 바꾸면 된다.
const MAC_DMG_URLS: Record<MacArch, string> = {
  universal: `${RELEASE_BASE}/Marblo-${VERSION}-arm64.dmg`,
  arm64: `${RELEASE_BASE}/Marblo-${VERSION}-arm64.dmg`,
  x64: `${RELEASE_BASE}/Marblo-${VERSION}-arm64.dmg`,
};

// Windows 인스톨러(NSIS). 실제 자산 파일명: Marblo-Setup-<ver>.exe
const WIN_EXE_URL = `${RELEASE_BASE}/Marblo-Setup-${VERSION}.exe`;

// 브라우저에서 macOS 칩(Intel vs Apple Silicon)을 베스트에포트로 감지한다.
// UA 문자열은 Apple Silicon 에서도 "Intel Mac OS X" 로 보고하므로 신뢰 불가 →
// WebGL 렌더러 문자열로 판별("Apple" 계열 = arm64, Intel/AMD/NVIDIA = x64).
// 감지 실패 시 universal 키로 폴백한다(현재 세 키 모두 arm64 DMG 로 매핑되어 동일).
function detectMacArch(): MacArch {
  if (typeof navigator === "undefined" || typeof document === "undefined") {
    return "universal";
  }
  try {
    const canvas = document.createElement("canvas");
    const gl = (canvas.getContext("webgl") ||
      canvas.getContext("experimental-webgl")) as WebGLRenderingContext | null;
    if (gl) {
      const dbg = gl.getExtension("WEBGL_debug_renderer_info");
      if (dbg) {
        const renderer = String(
          gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) || ""
        );
        if (/apple/i.test(renderer)) return "arm64";
        if (/intel|amd|radeon|nvidia|geforce/i.test(renderer)) return "x64";
      }
    }
  } catch {
    // WebGL 차단/미지원 → universal 폴백
  }
  return "universal";
}

// 감지된 아키에 대응하는 칩 라벨 i18n 키.
const MAC_ARCH_LABEL_KEY: Record<MacArch, string> = {
  universal: "mac_arch_universal",
  arm64: "mac_arch_apple",
  x64: "mac_arch_intel",
};

// 소프트(인지) 게이트 상태. 바이너리는 공개 릴리스라 하드 차단이 아니라,
// 미로그인/비선정 사용자에게 다운로드 대신 적절한 다음 행동을 안내한다.
type AccessState = "loading" | "anon" | "pending" | "granted";

export default function DownloadPage() {
  const t = useTranslations("download");
  const tBug = useTranslations("bugReport");
  const locale = useLocale();
  const [state, setState] = useState<AccessState>("loading");
  // 서버/하이드레이션 일치를 위해 초기값은 universal 키. 마운트 후 클라이언트에서
  // 감지해 칩 라벨만 정밀화한다 — 현재 세 키 모두 같은 arm64 DMG 로 매핑된다.
  const [macArch, setMacArch] = useState<MacArch>("universal");

  useEffect(() => {
    setMacArch(detectMacArch());
  }, []);

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
                  `/${locale}/download`
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
              {/* macOS — 다운로드 가능 (arm64 단일 산출, Apple Silicon 대상) */}
              <a
                href={MAC_DMG_URLS[macArch]}
                onClick={() =>
                  trackAppDownload({
                    os: "mac",
                    arch: macArch,
                    appVersion: APP_VERSION,
                  })
                }
                className="group flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-indigo-500/50 bg-indigo-600/10 hover:bg-indigo-600/20 hover:border-indigo-400 transition"
              >
                <Apple className="w-7 h-7 text-zinc-200" />
                <span className="text-sm font-medium text-zinc-100">
                  {t("macos")}
                </span>
                <span className="text-xs text-zinc-400">
                  {t(MAC_ARCH_LABEL_KEY[macArch])} · {t("mac_sub")} ·{" "}
                  {APP_VERSION}
                </span>
                <span className="mt-1 inline-flex items-center gap-2 bg-indigo-600 group-hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                  <Download className="w-4 h-4" />
                  {t("download_now")}
                </span>
              </a>

              {/* Windows — 다운로드 가능 (NSIS 인스톨러) */}
              <a
                href={WIN_EXE_URL}
                onClick={() =>
                  trackAppDownload({ os: "win", appVersion: APP_VERSION })
                }
                className="group flex flex-col items-center justify-center gap-3 p-6 rounded-xl border border-indigo-500/50 bg-indigo-600/10 hover:bg-indigo-600/20 hover:border-indigo-400 transition"
              >
                <Monitor className="w-7 h-7 text-zinc-200" />
                <span className="text-sm font-medium text-zinc-100">
                  {t("windows")}
                </span>
                <span className="text-xs text-zinc-400">{APP_VERSION}</span>
                <span className="mt-1 inline-flex items-center gap-2 bg-indigo-600 group-hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
                  <Download className="w-4 h-4" />
                  {t("download_now")}
                </span>
              </a>
            </div>
          </>
        )}

        {/* 버그 신고 안내 — 모든 상태(미로그인/대기/선정)에서 노출. 웹이라 릴리스 없이 즉시 도달. */}
        {state !== "loading" && (
          <p className="mt-10 text-sm text-zinc-500">
            <Link
              href={`/${locale}/bugs`}
              className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition"
            >
              <Bug className="w-4 h-4" />
              {tBug("title")}
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
