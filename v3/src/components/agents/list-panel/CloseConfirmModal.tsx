import { useEffect, useRef } from "react";
import { useTranslation } from "../../../lib/i18n";

interface Props {
  /** 닫으려는 에이전트 이름 — 경고문에 그대로 박는다. */
  name: string;
  onConfirm: () => void;
  onCancel: () => void;
  busy?: boolean;
}

/**
 * 작업 중(working) 에이전트를 닫을 때의 손실 경고. `window.confirm` 대신 인앱
 * 모달인 이유는 두 가지다 — Electron 의 native confirm 은 렌더러를 통째로 막아
 * 그동안 PTY 출력이 밀리고, 무엇보다 테스트에서 "무엇이 경고됐는지" 를 볼 수 없다.
 */
export function CloseConfirmModal({ name, onConfirm, onCancel, busy }: Props) {
  const { t } = useTranslation();
  const cancelRef = useRef<HTMLButtonElement | null>(null);

  // 파괴적 동작이라 기본 포커스는 취소 쪽. Enter 연타로 지나가 버리는 사고를 막는다.
  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onCancel();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onCancel]);

  return (
    <div
      className="absolute inset-0 z-30 flex items-center justify-center bg-[#11111b]/80 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={t("agents.close.confirmTitle")}
    >
      <div className="w-full max-w-sm rounded-lg border border-[#f38ba8]/40 bg-[#181825] p-4 shadow-xl">
        <div className="text-sm font-medium text-[#cdd6f4]">
          {t("agents.close.confirmTitle")}
        </div>
        <p className="mt-2 text-[12px] leading-relaxed text-[#bac2de]">
          {t("agents.close.confirmBody", { name })}
        </p>
        <p className="mt-1 text-[11px] text-[#f38ba8]">
          {t("agents.close.confirmWarning")}
        </p>
        <div className="mt-4 flex items-center justify-end gap-2">
          <button
            type="button"
            ref={cancelRef}
            onClick={onCancel}
            disabled={busy}
            className="rounded border border-[#45475a] px-3 py-1 text-[11px] text-[#cdd6f4] transition-colors hover:bg-[#313244] disabled:opacity-50"
          >
            {t("agents.close.cancel")}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={busy}
            className="rounded border border-[#f38ba8]/50 bg-[#f38ba8]/15 px-3 py-1 text-[11px] font-medium text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/25 disabled:opacity-50"
          >
            {busy ? "…" : t("agents.close.confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
