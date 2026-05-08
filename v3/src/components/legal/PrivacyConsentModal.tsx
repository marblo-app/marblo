/**
 * Privacy consent modal — final onboarding step (PIPA 제15조 옵트인 정설).
 *
 * Behavior, per master plan §15.3:
 *  - Default: every checkbox OFF.
 *  - "허용" persists whatever the user checked.
 *  - "나중에" persists with all flags false (consent recorded as declined).
 *  - "자세히 보기" opens PrivacyPolicyPage as an inline overlay.
 *  - Re-shown when CURRENT_POLICY_VERSION bumps (text changed → re-prompt).
 *
 * The modal also captures a single `overseasTransfer` checkbox — required
 * because Sentry/GA4/Mixpanel are all US-hosted and PIPA requires a
 * separate national-export consent on top of the per-service flag.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

type CheckboxId = "sentry" | "ga4" | "mixpanel" | "overseasTransfer";

const ROWS: {
  id: CheckboxId;
  label: string;
  hint: string;
  /** Whether this is the "별도 동의" national-export box (rendered separately). */
  separate?: boolean;
}[] = [
  {
    id: "sentry",
    label: "크래시 리포트 보내기 (Sentry, 미국 호스팅)",
    hint: "스택 트레이스에서 파일 경로·환경변수·BYOK 키는 자동 마스킹.",
  },
  {
    id: "ga4",
    label: "사용 분석 보내기 (GA4, 미국 호스팅)",
    hint: "익명 클릭/페이지 이동만. IP는 익명화 후 송신.",
  },
  {
    id: "mixpanel",
    label: "제품 funnel 분석 (Mixpanel, 미국 호스팅) — Q4 활성화",
    hint: "현재는 비활성. 미리 동의해두면 활성화 시점에 자동 적용.",
  },
  {
    id: "overseasTransfer",
    label: "국외 이전 별도 동의 (PIPA 제15조 제2항)",
    hint: "위 서비스 모두 미국 서버에 데이터를 처리합니다. 위 항목 중 하나라도 켜려면 이 동의가 필수입니다.",
    separate: true,
  },
];

interface PrivacyConsentModalProps {
  /** Called after the user clicks 허용/나중에 — host can hide the modal. */
  onComplete?: () => void;
}

export function PrivacyConsentModal({ onComplete }: PrivacyConsentModalProps) {
  const { user } = useAuth();
  const save = usePrivacyConsentStore((s) => s.save);

  const [flags, setFlags] = useState<Record<CheckboxId, boolean>>({
    sentry: false,
    ga4: false,
    mixpanel: false,
    overseasTransfer: false,
  });
  const [showPolicy, setShowPolicy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Auto-uncheck export when nothing else is on; auto-check it when user
  // turns on a service flag (overseas transfer is implied by enabling any
  // of them — but we still show it explicitly so consent is informed).
  useEffect(() => {
    const anyOn = flags.sentry || flags.ga4 || flags.mixpanel;
    if (!anyOn && flags.overseasTransfer) {
      setFlags((f) => ({ ...f, overseasTransfer: false }));
    }
  }, [flags.sentry, flags.ga4, flags.mixpanel, flags.overseasTransfer]);

  const allow = async () => {
    if (!user) return;
    // Hard guard: if any service is on, overseasTransfer must also be on.
    const anyOn = flags.sentry || flags.ga4 || flags.mixpanel;
    if (anyOn && !flags.overseasTransfer) {
      setError(
        "Sentry/GA4/Mixpanel은 미국 호스팅이라 국외 이전 동의가 필수입니다."
      );
      return;
    }
    setSubmitting(true);
    try {
      await save(user.uid, flags, "ko");
      onComplete?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setSubmitting(false);
    }
  };

  const later = async () => {
    if (!user) return;
    setSubmitting(true);
    try {
      // "나중에" = explicit decline. Save zero flags so we don't re-prompt
      // on every launch (only when policy version bumps).
      await save(
        user.uid,
        { sentry: false, ga4: false, mixpanel: false, overseasTransfer: false },
        "ko"
      );
      onComplete?.();
    } finally {
      setSubmitting(false);
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-md rounded-lg border border-[#313244] bg-[#1e1e2e] shadow-2xl">
        <div className="border-b border-[#313244] px-6 py-4">
          <h2 className="text-base font-semibold text-[#cdd6f4]">
            마블로를 더 안정적으로 만들도록 도와주세요
          </h2>
          <p className="mt-1 text-xs text-[#bac2de] leading-relaxed">
            익명 크래시 리포트와 사용 분석을 보내주시면 마블로가 빠르게
            개선됩니다.{" "}
            <b>코드 내용 · BYOK 키 · 사용자 입력은 절대 보내지 않습니다.</b>{" "}
            거부해도 모든 기능은 동일하게 작동합니다.
          </p>
        </div>

        <div className="px-6 py-4 space-y-3">
          {ROWS.filter((r) => !r.separate).map((row) => (
            <label
              key={row.id}
              className="flex cursor-pointer gap-3 rounded p-2 hover:bg-[#262640]"
            >
              <input
                type="checkbox"
                checked={flags[row.id]}
                onChange={(e) =>
                  setFlags((f) => ({ ...f, [row.id]: e.target.checked }))
                }
                disabled={row.id === "mixpanel"}
                className="mt-0.5 h-4 w-4 accent-[#89b4fa] disabled:opacity-50"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#cdd6f4]">{row.label}</div>
                <div className="text-[11px] text-[#6c7086] leading-snug">
                  {row.hint}
                </div>
              </div>
            </label>
          ))}

          <div className="my-3 border-t border-[#313244]" />

          {ROWS.filter((r) => r.separate).map((row) => (
            <label
              key={row.id}
              className="flex cursor-pointer gap-3 rounded p-2 hover:bg-[#262640]"
            >
              <input
                type="checkbox"
                checked={flags[row.id]}
                onChange={(e) =>
                  setFlags((f) => ({ ...f, [row.id]: e.target.checked }))
                }
                className="mt-0.5 h-4 w-4 accent-[#f9e2af]"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#f9e2af]">{row.label}</div>
                <div className="text-[11px] text-[#6c7086] leading-snug">
                  {row.hint}
                </div>
              </div>
            </label>
          ))}

          {error && (
            <div className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-3 py-2 text-[11px] text-[#f38ba8]">
              {error}
            </div>
          )}

          <button
            type="button"
            onClick={() => setShowPolicy(true)}
            className="text-[11px] text-[#89b4fa] hover:underline"
          >
            자세히 보기 (수집 항목 · 기간 · 거부 효과)
          </button>
        </div>

        <div className="flex gap-2 border-t border-[#313244] px-6 py-3">
          <button
            type="button"
            onClick={later}
            disabled={submitting}
            className="flex-1 rounded border border-[#313244] px-4 py-2 text-sm text-[#bac2de] hover:bg-[#262640] disabled:opacity-50"
          >
            나중에
          </button>
          <button
            type="button"
            onClick={allow}
            disabled={submitting}
            className="flex-1 rounded bg-[#89b4fa] px-4 py-2 text-sm font-medium text-[#11111b] hover:bg-[#74a0e8] disabled:opacity-50"
          >
            {submitting ? "저장 중..." : "허용"}
          </button>
        </div>
      </div>
    </div>
  );
}
