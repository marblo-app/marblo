"use client";

import { useEffect, useState } from "react";
import { useTranslations, useLocale } from "next-intl";
import Link from "next/link";
import { trackAppDownload } from "@/lib/gtag";
import { buildSoftwareApplicationSchema, stringifyJsonLd } from "@/lib/schema";
import {
  Apple,
  Monitor,
  Sparkles,
  Download,
  Bug,
  Info,
} from "lucide-react";

// 버전 고정 다운로드 링크 — 새 빌드 릴리스 시 이 값만 갱신.
// 실제 릴리스 자산 파일명 패턴: Marblo-<ver>-arm64.dmg / Marblo-Setup-<ver>.exe
const APP_VERSION = "v3.0.35";
// 파일명에 쓰는 버전(선행 v 없는 SemVer). APP_VERSION 에서 파생.
const VERSION = APP_VERSION.replace(/^v/, "");
const RELEASE_BASE = `https://github.com/melocream/marblo-releases/releases/download/${APP_VERSION}`;

type MacArch = "universal" | "arm64" | "x64";

// 릴리스는 arm64 DMG 단일 산출이다(universal/x64 자산은 산출되지 않는다).
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

// 카드에 노출하는 칩 라벨은 감지값이 아니라 **실제 자산**을 따른다.
// 자산이 arm64 DMG 단일이므로 항상 "Apple Silicon" 으로 고정한다 —
// 감지값(Intel/Universal)을 그대로 라벨로 쓰면 arm64 DMG 를 "Intel" 로
// 잘못 표기하게 된다. 감지값은 라벨이 아니라 텔레메트리(arch)로만 쓴다.
const MAC_ARCH_LABEL_KEY = "mac_arch_apple";

export default function DownloadPage() {
  const t = useTranslations("download");
  const tBug = useTranslations("bugReport");
  const locale = useLocale();
  // 서버/하이드레이션 일치를 위해 초기값은 universal 키. 마운트 후 클라이언트에서
  // 감지한다 — 현재 세 키 모두 같은 arm64 DMG 로 매핑되므로 링크는 바뀌지 않고,
  // 감지값은 다운로드 텔레메트리(arch)에만 실린다.
  const [macArch, setMacArch] = useState<MacArch>("universal");

  useEffect(() => {
    const id = window.setTimeout(() => setMacArch(detectMacArch()), 0);
    return () => window.clearTimeout(id);
  }, []);

  // SoftwareApplication JSON-LD — same app entity as home (shared @id=APP_ID),
  // carries operatingSystem, downloadUrl, Free/Pro offers, publisher=Organization.
  const softwareSchema = buildSoftwareApplicationSchema(locale);

  return (
    <div className="py-24 px-4">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: stringifyJsonLd(softwareSchema) }}
      />
      <div className="max-w-3xl mx-auto text-center">
        <span className="inline-flex items-center gap-2 bg-indigo-600/15 text-indigo-300 border border-indigo-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          <Sparkles className="w-3.5 h-3.5" />
          {t("badge")}
        </span>
        <h1 className="text-4xl md:text-5xl font-bold mt-6 whitespace-pre-line">
          {t("title")}
        </h1>

        <div className="mt-8 mx-auto max-w-xl text-left p-5 rounded-2xl border border-zinc-800 bg-zinc-900/40">
          <div className="flex items-start gap-3">
            <Info className="w-5 h-5 text-indigo-300 shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold text-zinc-100">
                {t("prereq_title")}
              </p>
              <p className="mt-1.5 text-sm text-zinc-400 leading-relaxed">
                {t("prereq_body")}
              </p>
            </div>
          </div>
        </div>

        <p className="text-zinc-400 mt-4 whitespace-pre-line leading-relaxed">
          {t("subtitle")}
        </p>

        <div className="mt-12 grid grid-cols-1 sm:grid-cols-2 gap-3">
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
              {t(MAC_ARCH_LABEL_KEY)} · {t("mac_sub")} · {APP_VERSION}
            </span>
            <span className="mt-1 inline-flex items-center gap-2 bg-indigo-600 group-hover:bg-indigo-500 text-white px-4 py-2 rounded-lg text-sm font-semibold transition">
              <Download className="w-4 h-4" />
              {t("download_now")}
            </span>
          </a>

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

        <p className="mt-10 text-sm text-zinc-500">
          <Link
            href={`/${locale}/bugs`}
            className="inline-flex items-center gap-1.5 text-zinc-400 hover:text-zinc-200 transition"
          >
            <Bug className="w-4 h-4" />
            {tBug("title")}
          </Link>
        </p>
      </div>
    </div>
  );
}
