/**
 * Settings → Privacy. PIPA 제22조 의무 — user must be able to change
 * consent at any time, with effects immediate (no delay), no precondition.
 *
 * Each toggle persists immediately to Firestore + reinitializes the
 * matching SDK on the spot. Turning a flag OFF does NOT tear the SDK
 * down (Sentry has no clean shutdown), but the per-call `enabled` gate
 * stops new events; full unload happens at next launch.
 *
 * "데이터 삭제 요청" opens a mailto: to team@marblo.app with a
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
  return `mailto:team@marblo.app?subject=${subject}&body=${body}`;
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
  // 학습데이터 캡처(ticket IqcXHVbT0rXnHloXpV7n). 실제 **수집**이 열려 있는지는
  // 서버만 판정할 수 있으므로(ADMIN_UID 는 서버 env 에만 있다) main 프로세스에
  // 물어본다 — 오늘은 운영자 본인 계정만 수집이 돈다.
  //
  // ★그래도 행은 모두에게 그린다(ticket QFNrT4Z4dG9nGoRYmTlr). 동의와 수집은
  // 다른 일이다: 동의는 사용자가 지금 표명할 수 있어야 하고(PIPA 제22조 —
  // 언제든 변경 가능), 수집은 서버가 순차 개방한다. 켤 수 없는 스위치를 숨기는
  // 것보다, 켤 수 있되 "지금은 아직 수집되지 않는다" 를 상태줄에 정직하게 쓰는
  // 쪽이 낫다 — 숨기면 비운영자는 옵트인할 창구 자체가 없다.
  const [training, setTraining] = useState<TrainingCaptureStatus | null>(null);

  // Drive Sentry to match consent on page mount + every change.
  useEffect(() => {
    maybeInitSentry(consent.sentry).catch(() => {});
  }, [consent.sentry]);

  // Drive first-party analytics from the persisted user preference.
  useEffect(() => {
    setTelemetryEnabled(consent.firstPartyTelemetry);
  }, [consent.firstPartyTelemetry]);

  useEffect(() => {
    let cancelled = false;
    window.electronAPI?.training
      ?.captureStatus()
      .then((status) => {
        if (!cancelled) setTraining(status);
      })
      // 상태를 못 읽으면 행을 그리지 않는다(닫힌 쪽으로 실패).
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

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
      firstPartyTelemetry: !!consent.firstPartyTelemetry,
      sentry: !!consent.sentry,
      ga4: !!consent.ga4,
      mixpanel: !!consent.mixpanel,
      overseasTransfer: !!consent.overseasTransfer,
      trainingDataCapture: !!consent.trainingDataCapture,
      // 설정에서 직접 결정한 사람에게 온보딩 카드를 다시 띄우지 않는다.
      trainingDataPrompted:
        !!consent.trainingDataPrompted || id === "trainingDataCapture",
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
      if (id === "trainingDataCapture") {
        // main 프로세스 게이트를 즉시 다시 읽게 한다 — 10분 주기 재조회를
        // 기다리면 "껐는데 아직 쌓인다"(또는 그 반대)로 보인다.
        const status = await window.electronAPI?.training?.refreshCapture();
        if (status) setTraining(status);
      }
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

      {/* 학습데이터 캡처 — 모두에게 보이는 명시 옵트인(기본 off). 실제 수집이
          도는지는 아래 상태줄이 서버 판정 그대로 말한다. */}
      <div className="rounded-lg border border-purple-500/30 bg-purple-500/5">
        <div className="flex items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-sm text-gray-200">
              {t("settings.privacy.trainingCapture.label")}
            </div>
            <div className="text-[11px] text-gray-500">
              {t("settings.privacy.trainingCapture.hint")}
            </div>
          </div>
          <button
            type="button"
            role="switch"
            data-testid="privacy-toggle-trainingDataCapture"
            onClick={() => toggle("trainingDataCapture")}
            disabled={busyKey === "trainingDataCapture"}
            aria-checked={consent.trainingDataCapture}
            aria-label={t("settings.privacy.trainingCapture.label")}
            className={`relative h-5 w-9 flex-shrink-0 rounded-full transition-colors disabled:opacity-50 ${
              consent.trainingDataCapture ? "bg-purple-600" : "bg-gray-600"
            }`}
          >
            <span
              className={`absolute left-0.5 top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${
                consent.trainingDataCapture ? "translate-x-4" : "translate-x-0"
              }`}
            />
          </button>
        </div>
        <div className="border-t border-purple-500/20 px-4 py-2 text-[11px] text-gray-500">
          {training?.eligible ? (
            <>
              {t("settings.privacy.trainingCapture.status", {
                state: training.enabled
                  ? t("settings.privacy.trainingCapture.on")
                  : t("settings.privacy.trainingCapture.off"),
                spooled: String(training.spooled),
              })}
              {training.disabledReason ? ` — ${training.disabledReason}` : ""}
            </>
          ) : (
            /* 서버가 아직 이 계정의 수집을 열지 않았다(또는 상태를 못 읽었다).
                 동의는 지금 기록되고, 수집은 개방 시점부터 적용된다 — 켜 놓고
                 아무 일도 안 일어나는 이유를 여기서 밝힌다. */
            t("settings.privacy.trainingCapture.phased")
          )}
        </div>
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
