/**
 * 학습데이터 기여 동의 카드 — 온보딩 흐름에 자연스럽게 얹히는 1회 옵트인
 * (ticket QFNrT4Z4dG9nGoRYmTlr).
 *
 * 왜 모달이 아닌가: 이건 **선택** 동의다. 전체 화면을 막고 물으면 "닫으려면
 * 답해야 하는" 강요가 되고, 실제로 첫 실행에는 이미 언어 선택 → PIPA 동의 →
 * (심플 모드) 연결/원클릭 모달이 줄지어 있다. 그래서 오른쪽 아래 카드 한 장으로
 * 뜨고, 무시하고 계속 일해도 아무것도 막지 않는다.
 *
 * ── 정직성 규약 ──────────────────────────────────────────────────────
 *  - "기여" 와 "나중에" 는 같은 크기·같은 한 번의 클릭이다. 어느 쪽도 기본값이
 *    아니고, 거부해도 제품 동작은 완전히 동일하다(PIPA 제15조 제3항).
 *  - 카드는 **원문(프롬프트·응답) 기여만** 묻는다. 라우팅 라벨을 포함한 비식별
 *    1차 지표는 이 카드에서 새로 받는 동의가 아니라 이미 동의된 항목이므로,
 *    "무엇이 이미 켜져 있는지" 를 고지만 하고 여기서 켜거나 끄지 않는다
 *    (끄는 곳은 Settings → Privacy 한 곳뿐이다).
 *  - 노출 판정은 순수 함수 `shouldShowTrainingConsentCard` 하나로 수렴한다
 *    (단위테스트 tests/unit/trainingConsent.test.ts).
 *
 * ★심플(BeginnerShell)·어드밴스드(GlobalOverlays→Layout/WorkspaceShell) 양쪽에
 *   같은 컴포넌트가 마운트된다 — 한쪽만 배선되는 드리프트는
 *   tests/unit/trainingConsentSurfaceParity.test.ts 가 막는다.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useTranslation } from "../../lib/i18n";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { useProjectStore } from "../../stores/projectStore";
import type { ConsentFlags } from "../../services/privacyConsentService";
import {
  hasDismissedTrainingPrompt,
  rememberTrainingPromptDismissed,
  shouldShowTrainingConsentCard,
} from "../../services/trainingConsent";
import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

/**
 * 자격을 갖춘 뒤 카드가 뜨기까지의 여유. 연결 직후에는 원클릭 모달·투어 같은
 * 다른 안내가 아직 떠 있을 수 있어서, 그 위에 곧바로 겹쳐 올리지 않는다.
 */
const APPEAR_DELAY_MS = 6000;

export function TrainingConsentCard() {
  const { t, locale } = useTranslation();
  const { humanUser, humanUserUid, humanAuthReady } = useAuth();
  const consent = usePrivacyConsentStore((s) => s.consent);
  const hasLoaded = usePrivacyConsentStore((s) => s.hasLoaded);
  const loadedUid = usePrivacyConsentStore((s) => s.loadedUid);
  const needsPrompt = usePrivacyConsentStore((s) => s.needsPrompt);
  const save = usePrivacyConsentStore((s) => s.save);
  const projectCount = useProjectStore((s) => s.projects.length);

  const [dismissed, setDismissed] = useState(false);
  const [ripe, setRipe] = useState(false);
  const [saving, setSaving] = useState(false);
  const [thanks, setThanks] = useState(false);
  const [showPolicy, setShowPolicy] = useState(false);

  // 사람 계정으로 확정된 uid 만 본다 — 부팅 중 잠깐 노출되는 에이전트
  // custom-token 신원이 동의 UI 를 몰면 안 된다(PrivacyConsentGate 와 같은 규칙).
  const uid = humanUser && humanAuthReady ? humanUserUid : null;

  useEffect(() => {
    setDismissed(uid ? hasDismissedTrainingPrompt(uid) : false);
    setThanks(false);
  }, [uid]);

  useEffect(() => {
    setRipe(false);
    const timer = setTimeout(() => setRipe(true), APPEAR_DELAY_MS);
    return () => clearTimeout(timer);
  }, [uid]);

  const eligible = shouldShowTrainingConsentCard({
    uid,
    consentLoaded: hasLoaded && loadedUid === uid,
    needsPolicyPrompt: needsPrompt,
    alreadyOptedIn: !!consent.trainingDataCapture,
    alreadyPrompted: !!consent.trainingDataPrompted,
    dismissedLocally: dismissed,
    hasConnectedProject: projectCount > 0,
  });

  if (!uid || (!eligible && !thanks) || !ripe) return null;

  /**
   * 답을 기록한다. 두 버튼 모두 같은 경로를 타고, 다른 것은 `optIn` 하나다 —
   * 거부도 "명시적으로 아니오" 로 저장한다(다시 묻지 않기 위해).
   */
  const answer = async (optIn: boolean) => {
    if (saving) return;
    setSaving(true);
    // 서버 write 가 실패해도 이 기기에서는 다시 조르지 않는다.
    rememberTrainingPromptDismissed(uid);
    const flags: ConsentFlags = {
      firstPartyTelemetry: !!consent.firstPartyTelemetry,
      sentry: !!consent.sentry,
      ga4: !!consent.ga4,
      mixpanel: !!consent.mixpanel,
      overseasTransfer: !!consent.overseasTransfer,
      trainingDataCapture: optIn,
      trainingDataPrompted: true,
    };
    try {
      await save(uid, flags, consent.locale || locale);
      if (optIn) {
        // main 프로세스 게이트를 즉시 다시 읽게 한다 — 다음 주기(10분)를
        // 기다리면 "켰는데 아무 일도 안 일어난다" 로 보인다.
        try {
          await window.electronAPI?.training?.refreshCapture();
        } catch {
          // 게이트 재조회 실패는 동의 저장과 무관하다 — 다음 주기에 반영된다.
        }
      }
    } catch (err) {
      // Fail-open: 저장 실패로 카드를 붙잡아 두지 않는다. 로컬 억제는 이미
      // 걸렸고, 서버 마커가 없으면 다른 기기에서 한 번 더 물어볼 뿐이다.
      console.warn("[TrainingConsent] save failed:", err);
    } finally {
      setSaving(false);
      if (optIn) {
        setThanks(true);
        setTimeout(() => {
          setThanks(false);
          setDismissed(true);
        }, 2200);
      } else {
        setDismissed(true);
      }
    }
  };

  if (showPolicy) {
    return (
      <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/70 p-4">
        <div className="h-[85vh] w-full max-w-3xl overflow-hidden rounded-lg border border-[#313244] shadow-2xl">
          <PrivacyPolicyPage onClose={() => setShowPolicy(false)} />
        </div>
      </div>
    );
  }

  return (
    <div
      data-testid="training-consent-card"
      className="fixed bottom-4 right-4 z-30 w-[22rem] max-w-[calc(100vw-2rem)] rounded-lg border border-[#313244] bg-[#1e1e2e] shadow-2xl"
    >
      {thanks ? (
        <div className="px-4 py-3 text-xs text-[#a6e3a1]">
          {t("legal.training.thanks")}
        </div>
      ) : (
        <>
          <div className="border-b border-[#313244] px-4 py-3">
            <div className="text-sm font-semibold text-[#cdd6f4]">
              {t("legal.training.heading")}
            </div>
            <p className="mt-1 text-[11px] leading-relaxed text-[#bac2de]">
              {t("legal.training.body")}
            </p>
          </div>

          <div className="space-y-2 px-4 py-3 text-[11px] leading-snug">
            {/* 이미 켜져 있는 것 — 여기서 받는 동의가 아니라 고지다. */}
            <div className="text-[#6c7086]">
              <span className="text-[#89b4fa]">
                {t("legal.training.alreadyOn.label")}
              </span>{" "}
              {t("legal.training.alreadyOn.hint")}
            </div>
            {/* 이번에 묻는 것 — 원문. */}
            <div className="text-[#6c7086]">
              <span className="text-[#cba6f7]">
                {t("legal.training.rawText.label")}
              </span>{" "}
              {t("legal.training.rawText.hint")}
            </div>
            <div className="text-[#6c7086]">
              {t("legal.training.noPressure")}
            </div>
            <button
              type="button"
              onClick={() => setShowPolicy(true)}
              className="text-[#89b4fa] hover:underline"
            >
              {t("legal.training.viewDetails")}
            </button>
          </div>

          {/* 두 버튼은 같은 폭·같은 무게다 — 거부가 기여만큼 쉬워야 한다. */}
          <div className="flex gap-2 border-t border-[#313244] px-4 py-3">
            <button
              type="button"
              data-testid="training-consent-later"
              onClick={() => answer(false)}
              disabled={saving}
              className="flex-1 rounded border border-[#313244] px-3 py-2 text-xs text-[#bac2de] hover:bg-[#262640] disabled:opacity-50"
            >
              {t("legal.training.later")}
            </button>
            <button
              type="button"
              data-testid="training-consent-optin"
              onClick={() => answer(true)}
              disabled={saving}
              className="flex-1 rounded bg-[#cba6f7] px-3 py-2 text-xs font-medium text-[#11111b] hover:bg-[#b48ae8] disabled:opacity-50"
            >
              {saving ? t("legal.training.saving") : t("legal.training.optIn")}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
