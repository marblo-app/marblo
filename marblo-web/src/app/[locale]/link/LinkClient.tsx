"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import Link from "next/link";
import { httpsCallable, getFunctions } from "firebase/functions";
import app from "@/lib/firebase";
import {
  buildLinkInstallPayload,
  readFirstTouch,
  readGaClientId,
  type LinkInstallPayload,
} from "@/lib/attribution";
import { CheckCircle2, BookOpen, Rocket, ShieldCheck } from "lucide-react";

/**
 * 설치 환영 + **익명 어트리뷰션 링크백** 페이지.
 *
 * 앱은 최초 실행에서 이 URL 을 기본 브라우저로 연다(`?i=<익명 설치 ID>`).
 * 그 브라우저는 보통 다운로드했던 브라우저이므로 여기서 `_ga` 쿠키의 GA4
 * client_id 를 읽어 설치 ID 와 묶어 보고한다. 이게 Firebase uid 없이 웹 유입
 * (국가·채널)과 앱 설치를 잇는 유일한 결정론적 다리다.
 *
 * ★보내는 값은 전부 익명이다: 설치 ID(UUID), GA4 client_id, first-touch utm,
 *   referrer 호스트, 랜딩 경로, 플랫폼, 앱 버전. 이메일·uid·IP 는 보내지 않는다.
 * ★링크백이 실패해도 페이지는 정상 동작한다 — 이건 환영 페이지가 본체고
 *   보고는 부수효과다.
 */
type LinkState =
  | "idle"
  | "sending"
  | "linked"
  | "already"
  | "skipped"
  | "failed";

export default function LinkClient() {
  const t = useTranslations("installLink");
  const locale = useLocale();
  const [state, setState] = useState<LinkState>("idle");
  // React 18 StrictMode 는 effect 를 두 번 돌린다 — 중복 전송 방지.
  const sent = useRef(false);

  useEffect(() => {
    if (sent.current) return;
    sent.current = true;

    // 전송·상태전이는 전부 이 비동기 함수 안에서 한다 — effect 본문에서 곧장
    // setState 하면 연쇄 렌더가 되고 린트도 막는다(react-hooks/set-state-in-effect).
    const run = async () => {
      const params = new URLSearchParams(window.location.search);
      const payload: LinkInstallPayload | null = buildLinkInstallPayload({
        installId: params.get("i"),
        gaClientId: readGaClientId(),
        firstTouch: readFirstTouch(),
        platform: params.get("p") ?? "",
        appVersion: params.get("v") ?? "",
        // `c` = 앱의 빌드 채널(dev/prod). 개발 재실행을 실유입과 나누는 표식이다.
        // 구버전 앱은 안 보내고, 그때는 null 로 접힌다.
        buildChannel: params.get("c"),
      });

      // 설치 ID 가 없거나 형식이 아니면(사람이 URL 을 직접 연 경우) 아무것도 안 한다.
      if (!payload) {
        setState("skipped");
        return;
      }

      setState("sending");
      const fns = getFunctions(app, "us-central1");
      const call = httpsCallable<
        LinkInstallPayload,
        { ok: boolean; alreadyLinked: boolean }
      >(fns, "linkInstallAttribution");
      try {
        const r = await call(payload);
        setState(r.data?.alreadyLinked ? "already" : "linked");
      } catch {
        // 링크백 실패는 사용자에게 그대로 알리되 페이지는 그대로 쓸 수 있다.
        setState("failed");
      }
    };
    void run();
  }, []);

  return (
    <div className="py-24 px-4">
      <div className="max-w-2xl mx-auto text-center">
        <span className="inline-flex items-center gap-2 bg-emerald-600/15 text-emerald-300 border border-emerald-500/40 px-3 py-1 rounded-full text-xs font-semibold uppercase tracking-wider">
          <CheckCircle2 className="w-3.5 h-3.5" />
          {t("badge")}
        </span>

        <h1 className="text-3xl md:text-4xl font-bold mt-6 whitespace-pre-line">
          {t("title")}
        </h1>
        <p className="text-zinc-400 mt-4 whitespace-pre-line leading-relaxed">
          {t("subtitle")}
        </p>

        <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-3 text-left">
          <Link
            href={`/${locale}/guide`}
            className="group flex flex-col gap-2 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-indigo-500/60 transition"
          >
            <BookOpen className="w-5 h-5 text-indigo-300" />
            <span className="text-sm font-semibold text-zinc-100">
              {t("guide_title")}
            </span>
            <span className="text-xs text-zinc-400 leading-relaxed">
              {t("guide_body")}
            </span>
          </Link>
          <Link
            href={`/${locale}/download`}
            className="group flex flex-col gap-2 p-5 rounded-xl border border-zinc-800 bg-zinc-900/40 hover:border-indigo-500/60 transition"
          >
            <Rocket className="w-5 h-5 text-indigo-300" />
            <span className="text-sm font-semibold text-zinc-100">
              {t("prereq_title")}
            </span>
            <span className="text-xs text-zinc-400 leading-relaxed">
              {t("prereq_body")}
            </span>
          </Link>
        </div>

        {/* 무엇을 보냈는지 숨기지 않는다 — 실패도 그대로 말한다. */}
        <p className="mt-8 inline-flex items-start gap-2 text-xs text-zinc-500 text-left">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            {state === "failed"
              ? t("status_failed")
              : state === "skipped"
              ? t("status_skipped")
              : t("privacy_note")}
          </span>
        </p>
      </div>
    </div>
  );
}
