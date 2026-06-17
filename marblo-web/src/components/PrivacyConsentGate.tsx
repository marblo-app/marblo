"use client";

import { useEffect, useState } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { getConsent, hasRequiredConsent } from "@/lib/privacyConsent";
import PrivacyConsentModal from "./PrivacyConsentModal";

/**
 * 앱 셸 최상단에 한 번 마운트되는 동의 게이트(v3 PrivacyConsentGate 이식판).
 * 로그인 사용자가 현재 정책의 필수 동의를 갖고 있지 않으면 차단 모달을
 * 띄운다. 이메일 가입 폼은 동의를 즉시 저장하므로 모달이 뜨지 않고,
 * OAuth(구글/깃허브) 가입·동의 전 가입한 기존 사용자만 여기서 잡힌다.
 */
export default function PrivacyConsentGate() {
  const [uid, setUid] = useState<string | null>(null);
  const [needsConsent, setNeedsConsent] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (!user) {
        setUid(null);
        setNeedsConsent(false);
        return;
      }
      setUid(user.uid);
      const consent = await getConsent(user.uid);
      setNeedsConsent(!hasRequiredConsent(consent));
    });
    return () => unsub();
  }, []);

  if (!uid || !needsConsent) return null;
  return (
    <PrivacyConsentModal uid={uid} onDone={() => setNeedsConsent(false)} />
  );
}
