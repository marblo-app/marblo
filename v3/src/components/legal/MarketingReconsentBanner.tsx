/**
 * 기존 파운더 재동의 배너 — 얇은 1줄 배너(모달 아님).
 *
 * 왜 필요한가: 마케팅 컨택트 백필은 "동의를 만들지 않는다"(백필 직후
 * consentGranted=0 이 정상). 그래서 이미 가입해 쓰고 있는 파운더들은
 * `emailMarketingConsent.status="unknown"` 인 채로 남아 있고, 이들에게 소식을
 * 보내려면 **새로 동의를 받는 수밖에 없다**. 이 배너가 그 수집 창구다
 * (v3/docs/MARKETING_CONTACTS.md "안 A — 다음 로그인 시 배너").
 *
 * ── 규제 불변식 ──────────────────────────────────────────────────────
 *  - 체크박스는 ★기본 unchecked. 배너를 봤다는 사실이나 닫았다는 사실은
 *    동의가 아니다 — 체크 후 저장을 눌러야만 write 가 일어난다.
 *  - 노출 대상은 `status==="unknown"` 인 파운더뿐이다. 이미 동의했거나
 *    (granted) 철회·수신거부한(revoked/unsubscribed) 사람에게는 뜨지 않는다 —
 *    수신거부한 사람에게 다시 조르면 unsubscribe 왕복이 무의미해진다.
 *    판정은 순수 함수 `shouldShowReconsentBanner` 하나로 수렴(단위테스트).
 *  - 동의 write 는 기존 경로 그대로:
 *    `users/{uid}.webPrivacyConsent.marketing=true` → 훅 1b → grantConsent
 *    (`legalBasis=explicit_opt_in`). 새 훅도, 새 grant 경로도 만들지 않는다.
 *
 * 이 배너는 **수동 노출 UI 일 뿐**이다 — 재동의 캠페인 메일을 쏘는 관리자
 * 액션은 이 컴포넌트(및 이 티켓) 범위가 아니다.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import {
  hasDismissedReconsent,
  rememberReconsentDismissed,
  shouldShowReconsentBanner,
  type MarketingConsentStatusView,
} from "../../services/marketingConsent";
import {
  fetchMarketingConsentStatus,
  saveMarketingOptIn,
} from "../../services/marketingConsentService";

export function MarketingReconsentBanner() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const [view, setView] = useState<MarketingConsentStatusView | null>(null);
  const [dismissed, setDismissed] = useState(true);
  const [checked, setChecked] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState(false);

  // uid 가 생기면 한 번만 조회. 실패는 null 로 남고 배너는 뜨지 않는다 —
  // 읽기 실패를 "동의 안 했음" 으로 접지 않는다.
  useEffect(() => {
    if (!user?.uid) {
      setView(null);
      return;
    }
    let alive = true;
    setDismissed(hasDismissedReconsent(user.uid));
    setChecked(false);
    setSaved(false);
    setError(false);
    fetchMarketingConsentStatus().then((v) => {
      if (alive) setView(v);
    });
    return () => {
      alive = false;
    };
  }, [user?.uid]);

  if (!user?.uid) return null;
  if (!shouldShowReconsentBanner({ view, dismissed })) return null;

  const dismiss = () => {
    rememberReconsentDismissed(user.uid);
    setDismissed(true);
  };

  const submit = async () => {
    // 방어: 체크되지 않았으면 절대 write 하지 않는다(버튼도 비활성이지만,
    // 동의 생성 경로는 UI 상태 하나에만 의존시키지 않는다).
    if (!checked || saving) return;
    setSaving(true);
    setError(false);
    try {
      await saveMarketingOptIn(user.uid, locale);
      setSaved(true);
      // 저장에 성공했으면 이 사람은 더 이상 unknown 이 아니다 — 다음 실행에서
      // 서버 상태가 granted 로 오지만, 이번 세션에서도 즉시 닫는다.
      rememberReconsentDismissed(user.uid);
      setTimeout(() => setDismissed(true), 1500);
    } catch (err) {
      console.warn("[MarketingReconsent] save failed:", err);
      setError(true);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex items-center gap-3 border-b border-[#313244] bg-[#181825] px-4 py-2 text-xs text-[#bac2de]">
      {saved ? (
        <span className="text-[#a6e3a1]">
          {t("legal.reconsent.savedNotice")}
        </span>
      ) : (
        <>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
              className="h-3.5 w-3.5 accent-[#a6e3a1]"
            />
            <span className="text-[#cdd6f4]">{t("legal.reconsent.label")}</span>
          </label>
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#6c7086]">
            {t("legal.reconsent.basis")}
          </span>
          {error && (
            <span className="text-[11px] text-[#f38ba8]">
              {t("legal.reconsent.saveFailed")}
            </span>
          )}
          <button
            type="button"
            onClick={submit}
            disabled={!checked || saving}
            className="rounded bg-[#89b4fa] px-2.5 py-1 text-[11px] font-medium text-[#11111b] hover:bg-[#74a0e8] disabled:opacity-40"
          >
            {saving ? t("legal.reconsent.saving") : t("legal.reconsent.submit")}
          </button>
          <button
            type="button"
            onClick={dismiss}
            className="text-[11px] text-[#6c7086] hover:text-[#bac2de]"
          >
            {t("legal.reconsent.dismiss")}
          </button>
        </>
      )}
    </div>
  );
}
