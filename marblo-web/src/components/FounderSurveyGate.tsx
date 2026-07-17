"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { httpsCallable, getFunctions } from "firebase/functions";
import { auth } from "@/lib/firebase";
import app from "@/lib/firebase";
import {
  isFounderSurveyPromptOpen,
  shouldShowFounderSurveyPrompt,
  recordFounderSurveyPromptDismissed,
} from "@/lib/founderSurveyPrompt";
import FounderSurveyPromptModal from "./FounderSurveyPromptModal";

/**
 * 앱 셸 최상단에 한 번 마운트되는 파운더 설문 넛지 게이트(PrivacyConsentGate 패턴).
 * 로그인한 "선정 파운더 중 아직 설문 미회신"인 사용자에게만 "설문 회신 시 Pro
 * 최대 3개월" 안내 팝업을 띄운다.
 *
 * 노출 판정은 getMyFounderAccess({hasAccess, feedbackSubmitted}) + localStorage
 * dismiss 정책(founderSurveyPrompt.ts)이 담당한다. 심사·지급은 기존 백엔드
 * (submitFounderFeedback → reviewFounderFeedback)가 그대로 처리 — 이 게이트는
 * 노출/유도만 담당한다.
 *
 * ★기본 OFF: NEXT_PUBLIC_FOUNDER_SURVEY_PROMPT_OPEN=true 인 환경에서만 동작.
 * 실사용자 대량 노출/지급 flip 은 사장님 승인 대기.
 */
export default function FounderSurveyGate() {
  const [uid, setUid] = useState<string | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    // 플래그가 꺼져 있으면 콜러블 호출조차 하지 않는다(불필요한 요청 방지).
    if (!isFounderSurveyPromptOpen()) return;

    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!active) return;
      if (!user) {
        setUid(null);
        setShow(false);
        return;
      }
      setUid(user.uid);
      try {
        const functions = getFunctions(app, "us-central1");
        const getAccess = httpsCallable(functions, "getMyFounderAccess");
        const res = await getAccess();
        const data = res.data as {
          hasAccess?: boolean;
          feedbackSubmitted?: boolean;
        };
        if (!active) return;
        setShow(
          shouldShowFounderSurveyPrompt({
            hasAccess: data?.hasAccess === true,
            feedbackSubmitted: data?.feedbackSubmitted === true,
            uid: user.uid,
            now: Date.now(),
          })
        );
      } catch {
        // 조회 실패 → 넛지하지 않는 쪽으로 폴백(파운더가 아닐 수도, 일시 오류일
        // 수도 있음). 지급성 오퍼라 오탐 노출보다 미노출이 안전하다.
        if (active) setShow(false);
      }
    });
    return () => {
      active = false;
      unsub();
    };
  }, []);

  const handleDismiss = () => {
    if (uid) recordFounderSurveyPromptDismissed(uid, Date.now());
    setShow(false);
  };

  if (!uid || !show) return null;
  return <FounderSurveyPromptModal onDismiss={handleDismiss} />;
}
