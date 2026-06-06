/**
 * Settings → Privacy. PIPA 제22조 의무 — user must be able to change
 * consent at any time, with effects immediate (no delay), no precondition.
 *
 * Each toggle persists immediately to Firestore + reinitializes the
 * matching SDK on the spot. Turning a flag OFF does NOT tear the SDK
 * down (Sentry has no clean shutdown), but the per-call `enabled` gate
 * stops new events; full unload happens at next launch.
 *
 * "데이터 삭제 요청" opens a mailto: to support@marblo.app with a
 * pre-filled template, per master plan §15.5. Real deletion runs through
 * support — Sentry has a separate deletion API that requires human action.
 * 30-day response SLA per PIPA 제36조.
 *
 * Note: GA4/Mixpanel toggles are intentionally removed — the app sends
 * nothing to them. (The website uses GA4 separately under its own consent.)
 * The flags stay in the consent schema (always false) for forward-compat.
 */
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import type { ConsentFlags } from "../../services/privacyConsentService";
import { maybeInitSentry } from "../../lib/telemetry/sentry";
import { PrivacyPolicyPage } from "../legal/PrivacyPolicyPage";

const ROWS: { id: keyof ConsentFlags; label: string; hint: string }[] = [
  {
    id: "sentry",
    label: "익명 크래시 리포트 (Sentry)",
    hint: "스택 트레이스에서 PII 자동 마스킹.",
  },
];

function buildDeletionMailto(uid: string): string {
  const subject = encodeURIComponent("[Marblo] 텔레메트리 데이터 삭제 요청");
  const body = encodeURIComponent(
    `안녕하세요.\n\n` +
      `아래 사용자의 텔레메트리 데이터 삭제를 요청합니다 (PIPA 제36조).\n\n` +
      `사용자 UID: ${uid}\n\n` +
      `대상 서비스:\n` +
      `[ ] Sentry (크래시 리포트)\n\n` +
      `30일 이내 응답 부탁드립니다.\n`,
  );
  return `mailto:support@marblo.app?subject=${subject}&body=${body}`;
}

export function PrivacySettings() {
  const { user } = useAuth();
  const consent = usePrivacyConsentStore((s) => s.consent);
  const save = usePrivacyConsentStore((s) => s.save);
  const patchLocal = usePrivacyConsentStore((s) => s.patchLocal);
  const [busyKey, setBusyKey] = useState<keyof ConsentFlags | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showPolicy, setShowPolicy] = useState(false);

  // Drive Sentry to match consent on page mount + every change.
  useEffect(() => {
    maybeInitSentry(consent.sentry).catch(() => {});
  }, [consent.sentry]);

  const toggle = async (id: keyof ConsentFlags) => {
    if (!user) return;
    setError(null);
    const next = !consent[id];
    // Optimistic UI
    patchLocal({ [id]: next } as Partial<ConsentFlags>);
    setBusyKey(id);
    const flags: ConsentFlags = {
      sentry: consent.sentry,
      ga4: consent.ga4,
      mixpanel: consent.mixpanel,
      overseasTransfer: consent.overseasTransfer,
      [id]: next,
    } as ConsentFlags;
    // If user turns Sentry ON, they need overseasTransfer too (US-hosted).
    if (flags.sentry && !flags.overseasTransfer) {
      flags.overseasTransfer = true;
      patchLocal({ overseasTransfer: true });
    }
    if (!flags.sentry) {
      flags.overseasTransfer = false;
      patchLocal({ overseasTransfer: false });
    }
    try {
      await save(user.uid, flags, consent.locale || "ko");
    } catch (err) {
      // Roll back optimistic UI on failure
      patchLocal({ [id]: !next } as Partial<ConsentFlags>);
      setError(err instanceof Error ? err.message : "저장 실패");
    } finally {
      setBusyKey(null);
    }
  };

  if (showPolicy) {
    return (
      <div className="h-full">
        <PrivacyPolicyPage onClose={() => setShowPolicy(false)} />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-sm font-semibold text-[#cdd6f4]">Privacy</h2>
        <p className="mt-1 text-xs text-[#bac2de]">
          외부 제3자(Sentry) 송신은 옵트인입니다. 거부해도 마블로 모든 기능은
          정상 작동합니다.
        </p>
      </div>

      <div className="rounded border border-[#313244] bg-[#181825]">
        {ROWS.map((row, idx) => (
          <div
            key={row.id}
            className={`flex items-center gap-3 px-3 py-3 ${
              idx > 0 ? "border-t border-[#313244]" : ""
            }`}
          >
            <div className="flex-1 min-w-0">
              <div className="text-sm text-[#cdd6f4]">{row.label}</div>
              <div className="text-[11px] text-[#6c7086]">{row.hint}</div>
            </div>
            <button
              type="button"
              onClick={() => toggle(row.id)}
              disabled={busyKey === row.id}
              aria-pressed={consent[row.id]}
              className={`relative h-5 w-9 rounded-full transition-colors disabled:opacity-50 ${
                consent[row.id] ? "bg-[#89b4fa]" : "bg-[#45475a]"
              }`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  consent[row.id] ? "translate-x-4" : "translate-x-0.5"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded border border-[#313244] bg-[#11111b] px-3 py-2 text-[11px] text-[#6c7086]">
        <span className="text-[#bac2de]">자체 운영 품질 지표 (BigQuery)</span> —
        식별정보를 제거한 비식별 데이터(익명 설치 ID, 토큰/비용/이벤트 종류)만
        우리 GCP에 수집됩니다. 계정 UID·코드·입력 텍스트는 포함되지 않으며,
        제3자에게 제공되지 않습니다.
      </div>

      {consent.sentry && (
        <div className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-2 text-[11px] text-[#f9e2af]">
          국외 이전 동의: {consent.overseasTransfer ? "✓ 동의함" : "필요"} —
          Sentry는 미국에서 처리됩니다 (PIPA 제15조 제2항).
        </div>
      )}

      {error && (
        <div className="rounded border border-[#f38ba8]/40 bg-[#f38ba8]/10 px-3 py-2 text-[11px] text-[#f38ba8]">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          onClick={() => setShowPolicy(true)}
          className="text-[#89b4fa] hover:underline"
        >
          처리방침 보기
        </button>
        {user && (
          <a
            href={buildDeletionMailto(user.uid)}
            className="text-[#f38ba8] hover:underline"
          >
            데이터 삭제 요청 (PIPA 제36조)
          </a>
        )}
      </div>

      {consent.acceptedAt && (
        <p className="text-[10px] text-[#6c7086]">
          마지막 동의 갱신: {consent.acceptedAt.toLocaleString()} (정책 버전{" "}
          {consent.version})
        </p>
      )}
    </div>
  );
}
