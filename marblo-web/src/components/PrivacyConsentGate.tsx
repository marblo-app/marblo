"use client";

import { useEffect, useState } from "react";
import { useLocale } from "next-intl";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import {
  getConsentWithRetry,
  hasRequiredConsent,
  hasAcceptedConsentCached,
  rememberConsentAccepted,
  repairCachedWebConsent,
  CURRENT_POLICY_VERSION,
  type ConsentLocale,
} from "@/lib/privacyConsent";
import PrivacyConsentModal from "./PrivacyConsentModal";

/**
 * 앱 셸 최상단에 한 번 마운트되는 동의 게이트(v3 PrivacyConsentGate 이식판).
 * 로그인 사용자가 현재 정책의 필수 동의를 갖고 있지 않으면 차단 모달을
 * 띄운다. 이메일 가입 폼은 동의를 즉시 저장하므로 모달이 뜨지 않고,
 * OAuth(구글/깃허브) 가입·동의 전 가입한 기존 사용자만 여기서 잡힌다.
 *
 * ⚠ 재방문/재로드 재프롬프트 방지: onAuthStateChanged 는 매 로드마다 발화하고,
 * 그 직후 Firestore read 는 일시 실패(네트워크/토큰 미준비)하기 쉽다. read 를
 * "미동의"로 접으면 이미 동의한 유저에게 모달이 다시 뜬다. 그래서 (1) read 를
 * 재시도하고(getConsentWithRetry), (2) read 가 끝내 실패해도 이 기기에서 동의를
 * 저장한 로컬 증빙이 있으면 모달을 억제한다 — 데스크탑 앱 #177 과 동일한 방어.
 */
export default function PrivacyConsentGate() {
  const locale = useLocale() as ConsentLocale;
  const [uid, setUid] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);

  useEffect(() => {
    let active = true;
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUid(null);
        setNeedsConsent(false);
        return;
      }
      setUid(user.uid);
      const result = await getConsentWithRetry(user.uid);
      if (!active) return;

      if (result.status === "ok") {
        const ok = hasRequiredConsent(result.consent);
        // 확정 동의 → 증빙 캐시 갱신(이후 read 실패에도 재프롬프트 안 함).
        if (ok) {
          rememberConsentAccepted(user.uid, CURRENT_POLICY_VERSION);
          setNeedsConsent(false);
          return;
        }

        // 앱이 legacy privacyConsent 를 앱 스키마/버전으로 덮어쓴 경우에도,
        // 이 브라우저에 현재 웹 정책 동의 증빙이 있으면 재프롬프트하지 않는다.
        if (hasAcceptedConsentCached(user.uid, CURRENT_POLICY_VERSION)) {
          setNeedsConsent(false);
          void repairCachedWebConsent(user.uid, locale);
          return;
        }

        setNeedsConsent(true);
        return;
      }

      if (result.status === "missing") {
        if (hasAcceptedConsentCached(user.uid, CURRENT_POLICY_VERSION)) {
          setNeedsConsent(false);
          void repairCachedWebConsent(user.uid, locale);
          return;
        }
        // read 성공 + 레코드 없음 → 진짜 미동의 → 프롬프트.
        setNeedsConsent(true);
        return;
      }

      // status === "error": read 실패로 동의 여부 UNKNOWN. 이 기기에서 이미
      // 동의한 증빙이 있으면 모달 억제, 없으면 PIPA 백스톱으로 표시(가입·결제
      // 단계에서도 게이팅됨). 일시 실패를 "미동의"로 접지 않는 게 핵심.
      setNeedsConsent(
        !hasAcceptedConsentCached(user.uid, CURRENT_POLICY_VERSION)
      );
    });
    return () => {
      active = false;
      unsub();
    };
  }, [locale]);

  if (!uid || !needsConsent) return null;
  return (
    <PrivacyConsentModal uid={uid} onDone={() => setNeedsConsent(false)} />
  );
}
