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
import { useTranslation, t } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { PrivacyPolicyPage } from "../legal/PrivacyPolicyPage";

const ROWS: {
  id: keyof ConsentFlags;
  labelKey: MessageKey;
  hintKey: MessageKey;
}[] = [
  {
    id: "sentry",
    labelKey: "settings.privacy.sentry.label",
    hintKey: "settings.privacy.sentry.hint",
  },
];

function buildDeletionMailto(uid: string): string {
  const subject = encodeURIComponent(t("settings.privacy.deletion.subject"));
  const body = encodeURIComponent(t("settings.privacy.deletion.body", { uid }));
  return `mailto:support@marblo.app?subject=${subject}&body=${body}`;
}

export function PrivacySettings() {
  const { t } = useTranslation();
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
      setError(err instanceof Error ? err.message : t("settings.saveFailed"));
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
        <h2 className="text-sm font-semibold text-[#cdd6f4]">
          {t("settings.privacy.heading")}
        </h2>
        <p className="mt-1 text-xs text-[#bac2de]">
          {t("settings.privacy.optInDescription")}
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
              <div className="text-sm text-[#cdd6f4]">{t(row.labelKey)}</div>
              <div className="text-[11px] text-[#6c7086]">{t(row.hintKey)}</div>
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
        <span className="text-[#bac2de]">
          {t("settings.privacy.bigquery.label")}
        </span>{" "}
        — {t("settings.privacy.bigquery.body")}
      </div>

      {consent.sentry && (
        <div className="rounded border border-[#f9e2af]/40 bg-[#f9e2af]/10 px-3 py-2 text-[11px] text-[#f9e2af]">
          {t("settings.privacy.overseas.notice", {
            status: consent.overseasTransfer
              ? t("settings.privacy.overseas.agreed")
              : t("settings.privacy.overseas.required"),
          })}
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
          {t("settings.privacy.viewPolicy")}
        </button>
        {user && (
          <a
            href={buildDeletionMailto(user.uid)}
            className="text-[#f38ba8] hover:underline"
          >
            {t("settings.privacy.requestDeletion")}
          </a>
        )}
      </div>

      {consent.acceptedAt && (
        <p className="text-[10px] text-[#6c7086]">
          {t("settings.privacy.lastUpdated", {
            date: consent.acceptedAt.toLocaleString(),
            version: consent.version,
          })}
        </p>
      )}
    </div>
  );
}
