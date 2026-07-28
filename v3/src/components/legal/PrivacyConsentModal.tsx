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
 * because Sentry is US-hosted and PIPA requires a separate national-export
 * consent on top of the per-service flag.
 *
 * Note: GA4/Mixpanel are intentionally NOT offered here. This Electron app
 * sends nothing to them (GA4 has no measurement id wired + zero call sites;
 * Mixpanel has no code). Asking consent for data we never send would be a
 * false disclosure. The marketing website uses GA4 separately under its own
 * cookie consent — see PrivacyPolicyPage. The ga4/mixpanel flags remain in
 * the consent schema (always false) for forward-compat.
 */
import { useEffect, useState, type ReactNode } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePrivacyConsentStore } from "../../stores/privacyConsentStore";
import { useTranslation } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import type { ConsentFlags } from "../../services/privacyConsentService";
import { PrivacyPolicyPage } from "./PrivacyPolicyPage";

type CheckboxId = "sentry" | "ga4" | "mixpanel" | "overseasTransfer";

const ROWS: {
  id: CheckboxId;
  labelKey: MessageKey;
  hintKey: MessageKey;
  /** Whether this is the "별도 동의" national-export box (rendered separately). */
  separate?: boolean;
}[] = [
  {
    id: "sentry",
    labelKey: "legal.consent.sentry.label",
    hintKey: "legal.consent.sentry.hint",
  },
  {
    id: "overseasTransfer",
    labelKey: "legal.consent.overseas.label",
    hintKey: "legal.consent.overseas.hint",
    separate: true,
  },
];

/** Render a translated string with inline <b>…</b> emphasis as JSX. */
function renderRich(text: string): ReactNode[] {
  return text.split(/(<b>.*?<\/b>)/g).map((part, i) => {
    const m = part.match(/^<b>(.*?)<\/b>$/);
    return m ? <b key={i}>{m[1]}</b> : <span key={i}>{part}</span>;
  });
}

interface PrivacyConsentModalProps {
  /** Called after the user clicks 허용/나중에 — host can hide the modal. */
  onComplete?: () => void;
  /**
   * Where the answer is persisted. Defaults to the signed-in path (Firestore,
   * keyed by uid). The first-run flow runs this modal *before* sign-in — there
   * is no uid yet — so it injects a handler that parks the answer locally and
   * lets PrivacyConsentGate flush it once a uid exists.
   */
  onSubmit?: (flags: ConsentFlags, locale: string) => Promise<void> | void;
}

export function PrivacyConsentModal({
  onComplete,
  onSubmit,
}: PrivacyConsentModalProps) {
  const { t, locale } = useTranslation();
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
    if (!flags.sentry && flags.overseasTransfer) {
      setFlags((f) => ({ ...f, overseasTransfer: false }));
    }
  }, [flags.sentry, flags.overseasTransfer]);

  /**
   * Persist one answer and close. `onSubmit` wins when the host injected one
   * (pre-sign-in first-run flow); otherwise this is the signed-in Firestore
   * write. The record carries the locale the user actually read the policy in
   * — this modal now runs right after the language picker, so that is known.
   */
  const submit = async (answer: ConsentFlags) => {
    if (!onSubmit && !user) return;
    setSubmitting(true);
    try {
      if (onSubmit) await onSubmit(answer, locale);
      else if (user) await save(user.uid, answer, locale);
    } catch (err) {
      // Fail-open: Firestore write 실패해도 모달은 닫는다. store.save 가
      // local state 까지 안 채웠다면 다음 부팅 때 다시 묻힐 뿐 — 사용자
      // 진입을 영구 차단하지 않는다. 권한 규칙·네트워크 단절·디플로이 지연
      // 등 일시적 사유로 onboarding 이 막히는 P1 버그 가드.
      console.warn("[PrivacyConsent] save failed, closing modal anyway:", err);
      setError(
        err instanceof Error ? err.message : t("legal.consent.saveFailed"),
      );
    } finally {
      setSubmitting(false);
      onComplete?.();
    }
  };

  const allow = async () => {
    // Hard guard: if Sentry is on, overseasTransfer must also be on.
    if (flags.sentry && !flags.overseasTransfer) {
      setError(t("legal.consent.overseasRequired"));
      return;
    }
    await submit({ firstPartyTelemetry: true, ...flags });
  };

  // "나중에" = explicit decline. Save zero flags so we don't re-prompt
  // on every launch (only when policy version bumps).
  const later = async () =>
    submit({
      firstPartyTelemetry: true,
      sentry: false,
      ga4: false,
      mixpanel: false,
      overseasTransfer: false,
    });

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
            {t("legal.consent.heading")}
          </h2>
          <p className="mt-1 text-xs text-[#bac2de] leading-relaxed">
            {renderRich(t("legal.consent.body"))}
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
                className="mt-0.5 h-4 w-4 accent-[#89b4fa] disabled:opacity-50"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-[#cdd6f4]">{t(row.labelKey)}</div>
                <div className="text-[11px] text-[#6c7086] leading-snug">
                  {t(row.hintKey)}
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
                <div className="text-sm text-[#f9e2af]">{t(row.labelKey)}</div>
                <div className="text-[11px] text-[#6c7086] leading-snug">
                  {t(row.hintKey)}
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
            {t("legal.consent.viewDetails")}
          </button>
        </div>

        <div className="flex gap-2 border-t border-[#313244] px-6 py-3">
          <button
            type="button"
            onClick={later}
            disabled={submitting}
            className="flex-1 rounded border border-[#313244] px-4 py-2 text-sm text-[#bac2de] hover:bg-[#262640] disabled:opacity-50"
          >
            {t("legal.consent.later")}
          </button>
          <button
            type="button"
            onClick={allow}
            disabled={submitting}
            className="flex-1 rounded bg-[#89b4fa] px-4 py-2 text-sm font-medium text-[#11111b] hover:bg-[#74a0e8] disabled:opacity-50"
          >
            {submitting ? t("legal.consent.saving") : t("legal.consent.allow")}
          </button>
        </div>
      </div>
    </div>
  );
}
