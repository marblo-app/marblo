import { useEffect, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import {
  BLOCK,
  BUTTON_GHOST,
  BUTTON_PRIMARY,
  INSET,
  SURFACE,
  SectionLabel,
} from "../common/ui";
import {
  PAUSE_REASON_NOTE_MAX,
  PAUSE_REASON_OPTIONS,
  hasAskedPauseReason,
  markPauseReasonAsked,
  resolveOpenGapDays,
  sanitizePauseNote,
  shouldAskPauseReason,
  type PauseReasonCode,
} from "../../lib/pauseReasonPrompt";
import { isTelemetryEnabled, telemetry } from "../../services/telemetryService";
import { submitPauseReason } from "../../services/pauseReasonService";

/**
 * "왜 멈췄나" — 7일 이상 앱을 안 열었다가 돌아온 순간에 **딱 한 번** 뜨는 단일
 * 문항. 판정 근거·선택지 근거·문면 규율은 전부 `lib/pauseReasonPrompt.ts` 헤더와
 * `locales/ko/retention.ts` 헤더에 있다. 이 파일은 그 판정을 그리기만 한다.
 *
 * ★조건이 여기 흩어지지 않는다: 노출 판정은 `shouldAskPauseReason` 하나뿐이다.
 *
 * ★두 단계인 이유 — 1단계에서 선택지를 고르는 **순간 답이 기록된다**(텔레메트리
 * answered 발신). 2단계의 한 줄 메모는 순수한 덤이라, 사람이 창을 그냥 닫아도
 * 고른 항목은 이미 살아 있다. 한 화면에 넣고 [보내기] 를 요구했으면 고르고 안
 * 누른 사람의 답이 통째로 사라졌을 것이다.
 */
interface PauseReasonPromptProps {
  /** 다른 모달이 화면을 차지하고 있으면 이번 실행에서는 묻지 않는다. */
  blocked?: boolean;
  /** 카드가 떴는지 부모에게 알린다 — 같은 모서리를 쓰는 카드와 겹치지 않게. */
  onVisibilityChange?: (visible: boolean) => void;
}

function safeLocalStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.localStorage;
}

function safeSessionStorage(): Storage | null {
  return typeof window === "undefined" ? null : window.sessionStorage;
}

function appVersion(): string | undefined {
  return typeof __APP_VERSION__ !== "undefined" ? __APP_VERSION__ : undefined;
}

export function PauseReasonPrompt({
  blocked = false,
  onVisibilityChange,
}: PauseReasonPromptProps) {
  const { t } = useTranslation();
  const [visible, setVisible] = useState(false);
  const [gapDays, setGapDays] = useState(0);
  const [answer, setAnswer] = useState<PauseReasonCode | null>(null);
  const [note, setNote] = useState("");
  const [sending, setSending] = useState(false);
  const [noteFailed, setNoteFailed] = useState(false);
  // 공백 계산은 실행당 한 번. 재마운트로 lastOpenedAt 을 다시 밀면 안 된다.
  const resolved = useRef(false);

  useEffect(() => {
    if (resolved.current) return;
    // ★막혀 있는 동안에는 **저장소를 건드리지 않고** 물러난다. 여기서 그냥
    // 판정만 건너뛰면 resolveOpenGapDays 가 lastOpenedAt 을 지금으로 밀어버려
    // 다음 실행의 공백이 0 이 되고, 그 설치에는 질문이 영영 오지 않는다 —
    // 조용히 죽는 종류의 손실이다. 저장을 미루면 공백은 계속 자라고, 창이
    // 비는 다음 기회에 그대로 묻는다(마운트 중 blocked 가 풀려도 재평가된다).
    if (blocked) return;
    resolved.current = true;

    const local = safeLocalStorage();
    const gap = resolveOpenGapDays(local, safeSessionStorage(), Date.now());
    const ask = shouldAskPauseReason({
      gapDays: gap,
      alreadyAsked: hasAskedPauseReason(local),
      telemetryEnabled: isTelemetryEnabled(),
      blocked,
    });
    if (!ask || gap === null) return;

    // 띄운 순간 마커를 찍는다 — 답하든 닫든 두 번 묻지 않겠다는 약속이 문면에
    // 있고, 그 약속은 사용자의 행동이 아니라 노출에 걸려야 지켜진다.
    markPauseReasonAsked(local);
    setGapDays(gap);
    setVisible(true);
    telemetry.pauseReasonPrompt("shown", { gapDays: gap });
  }, [blocked]);

  useEffect(() => {
    onVisibilityChange?.(visible);
  }, [visible, onVisibilityChange]);

  if (!visible) return null;

  const close = () => {
    setVisible(false);
  };

  const handlePick = (reason: PauseReasonCode) => {
    setAnswer(reason);
    telemetry.pauseReasonPrompt("answered", { gapDays, reason });
  };

  const handleDismiss = () => {
    // 선택지를 고른 뒤 닫는 것은 이탈이 아니다 — 그 답은 이미 기록됐다.
    if (!answer) telemetry.pauseReasonPrompt("dismissed", { gapDays });
    close();
  };

  const handleSendNote = async () => {
    if (!answer) return;
    const clean = sanitizePauseNote(note);
    if (!clean) {
      close();
      return;
    }
    setSending(true);
    setNoteFailed(false);
    try {
      await submitPauseReason({
        reason: answer,
        note: clean,
        gapDays,
        ...(appVersion() ? { appVersion: appVersion() } : {}),
      });
      telemetry.pauseReasonPrompt("note", {
        gapDays,
        reason: answer,
        noteLength: clean.length,
        noteDelivered: true,
      });
      close();
    } catch {
      // 한 줄이 못 갔다고 고른 항목까지 잃지 않는다 — 그건 이미 나갔다.
      telemetry.pauseReasonPrompt("note", {
        gapDays,
        reason: answer,
        noteLength: clean.length,
        noteDelivered: false,
      });
      setNoteFailed(true);
    } finally {
      setSending(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-labelledby="pause-reason-title"
      className={`fixed bottom-6 right-6 z-[100] w-[min(24rem,calc(100vw-2rem))] shadow-2xl ${SURFACE}`}
    >
      <div className={BLOCK}>
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <SectionLabel>{t("retention.pauseReason.eyebrow")}</SectionLabel>
            <h3
              id="pause-reason-title"
              className="mt-1 text-sm font-semibold leading-6 text-primary"
            >
              {t("retention.pauseReason.title", { days: gapDays })}
            </h3>
          </div>
          <button
            type="button"
            onClick={handleDismiss}
            aria-label={t("retention.pauseReason.dismiss")}
            className="shrink-0 rounded-md px-1.5 py-1 text-muted transition-colors hover:bg-surface-hover hover:text-primary"
          >
            <svg
              className="h-4 w-4"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* ★안 답할 자유는 선택지보다 **위**에 있다. 아래에 작게 깔면 그건 고지가
            아니라 알리바이다. */}
        <p className="mt-2 text-xs leading-5 text-secondary">
          {t("retention.pauseReason.optOut")}
        </p>

        {answer === null ? (
          <div className="mt-3 space-y-1.5">
            {PAUSE_REASON_OPTIONS.map((option) => (
              <button
                key={option.code}
                type="button"
                onClick={() => handlePick(option.code)}
                className={`block w-full px-3 py-2 text-left text-sm leading-5 text-primary transition-colors hover:bg-surface-hover focus:outline-none focus-visible:border-accent ${INSET}`}
              >
                {t(option.labelKey)}
              </button>
            ))}
          </div>
        ) : (
          <div className="mt-3">
            <label
              className="block text-xs text-secondary"
              htmlFor="pause-reason-note"
            >
              {t("retention.pauseReason.noteLabel")}
            </label>
            <textarea
              id="pause-reason-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={PAUSE_REASON_NOTE_MAX}
              rows={2}
              placeholder={t("retention.pauseReason.notePlaceholder")}
              className={`mt-1.5 w-full resize-none px-3 py-2 text-sm text-primary outline-none transition-colors placeholder:text-muted focus:border-strong ${INSET}`}
            />
            {/* 무엇이 전송되는지 그 자리에서 적는다 — 동의는 설정 화면이 아니라
                입력칸 옆에서 성립한다. */}
            <p className="mt-1.5 text-[11px] leading-4 text-muted">
              {t("retention.pauseReason.noteScope")}
            </p>
            {noteFailed && (
              <p className="mt-1.5 text-[11px] leading-4 text-secondary">
                {t("retention.pauseReason.noteFailed")}
              </p>
            )}
            <div className="mt-3 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={close}
                className={BUTTON_GHOST}
                disabled={sending}
              >
                {t("retention.pauseReason.close")}
              </button>
              <button
                type="button"
                onClick={handleSendNote}
                disabled={sending || sanitizePauseNote(note).length === 0}
                className={BUTTON_PRIMARY}
              >
                {sending
                  ? t("retention.pauseReason.sending")
                  : t("retention.pauseReason.send")}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
