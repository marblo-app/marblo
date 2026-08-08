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
import { setTelemetryEnabled } from "../../services/telemetryService";
import { useTranslation, t } from "../../lib/i18n";
import type { MessageKey } from "../../locales/ko";
import { PrivacyPolicyPage } from "../legal/PrivacyPolicyPage";

const ROWS: {
  id: keyof ConsentFlags;
  labelKey: MessageKey;
  hintKey: MessageKey;
}[] = [
  {
    id: "firstPartyTelemetry",
    labelKey: "settings.privacy.firstParty.label",
    hintKey: "settings.privacy.firstParty.hint",
  },
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

  // Drive first-party analytics from the persisted user preference.
  useEffect(() => {
    setTelemetryEnabled(consent.firstPartyTelemetry);
  }, [consent.firstPartyTelemetry]);

  const toggle = async (id: keyof ConsentFlags) => {
    if (!user) return;
    setError(null);
    const next = !consent[id];
    // Optimistic UI
    patchLocal({ [id]: next } as Partial<ConsentFlags>);
    if (id === "firstPartyTelemetry") {
      setTelemetryEnabled(next);
    }
    setBusyKey(id);
    const flags: ConsentFlags = {
      firstPartyTelemetry: consent.firstPartyTelemetry,
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
      if (id === "firstPartyTelemetry") {
        setTelemetryEnabled(!next);
      }
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
        <h2 className="text-sm font-semibold text-gray-200">
          {t("settings.privacy.heading")}
        </h2>
        <p className="mt-1 text-xs text-gray-400">
          {t("settings.privacy.optInDescription")}
        </p>
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-800">
        {ROWS.map((row, idx) => (
          <div
            key={row.id}
            className={`flex items-center gap-3 px-4 py-3 ${
              idx > 0 ? "border-t border-gray-700" : ""
            }`}
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm text-gray-200">{t(row.labelKey)}</div>
              <div className="text-[11px] text-gray-500">{t(row.hintKey)}</div>
            </div>
            {/* ★flex-shrink-0 이 없으면 노브가 트랙 밖으로 튀어나온다: 형제
                라벨이 flex-1(basis 0) 이라 좁은 창의 축소분을 이 버튼이 전부
                흡수하는데, 노브는 absolute 고정폭이라 같이 줄지 않는다.
                설정의 다른 토글(SettingsPage)과 동일하게 role=switch 를 쓴다. */}
            <button
              type="button"
              role="switch"
              data-testid={`privacy-toggle-${row.id}`}
              onClick={() => toggle(row.id)}
              disabled={busyKey === row.id}
              aria-checked={consent[row.id]}
              aria-label={t(row.labelKey)}
              className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
                consent[row.id] ? "bg-blue-600" : "bg-gray-600"
              }`}
            >
              {/* ★left-0.5 를 명시한다. 앵커가 없으면 노브의 x 는 abspos 의
                  static position 에서 오는데, 버튼 기본 text-align:center 때문에
                  그 값이 0 이 아니다(실측 4px) — 그 4px 이 translate 에 더해져
                  ON 상태에서 노브가 트랙 오른쪽으로 밀려 나간다. */}
              <span
                className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                  consent[row.id] ? "translate-x-4" : "translate-x-0"
                }`}
              />
            </button>
          </div>
        ))}
      </div>

      <div className="rounded-lg border border-gray-700 bg-gray-900/60 px-4 py-2.5 text-[11px] text-gray-500">
        <span className="text-gray-400">
          {t("settings.privacy.bigquery.label")}
        </span>{" "}
        — {t("settings.privacy.bigquery.body")}
      </div>

      {consent.sentry && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-2.5 text-[11px] text-amber-200">
          {t("settings.privacy.overseas.notice", {
            status: consent.overseasTransfer
              ? t("settings.privacy.overseas.agreed")
              : t("settings.privacy.overseas.required"),
          })}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-2.5 text-[11px] text-red-300">
          {error}
        </div>
      )}

      <div className="flex flex-wrap gap-3 text-xs">
        <button
          type="button"
          onClick={() => setShowPolicy(true)}
          className="text-blue-400 hover:underline"
        >
          {t("settings.privacy.viewPolicy")}
        </button>
        {user && (
          <a
            href={buildDeletionMailto(user.uid)}
            className="text-red-400 hover:underline"
          >
            {t("settings.privacy.requestDeletion")}
          </a>
        )}
      </div>

      {consent.acceptedAt && (
        <p className="text-[10px] text-gray-500">
          {t("settings.privacy.lastUpdated", {
            date: consent.acceptedAt.toLocaleString(),
            version: consent.version,
          })}
        </p>
      )}
    </div>
  );
}
