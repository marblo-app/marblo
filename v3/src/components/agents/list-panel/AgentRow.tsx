import { memo } from "react";
import { VENDOR_VISUALS, STATUS_PILL, type AgentRowData } from "./types";
import { useTranslation } from "../../../lib/i18n";
import {
  spawnedModelLabel,
  spawnedModelTitle,
} from "../../../lib/spawnedModelLabel";

interface Props {
  row: AgentRowData;
  // Whether this row is the keyboard-highlighted item in the list. Different
  // from "selected/focused" — pressing Enter on the highlighted row enters
  // the FocusView. We keep the prop name semantic-only; visually it renders
  // the same background as the previous isExpanded state.
  isHighlighted: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
  onKill?: () => void;
  /**
   * 항목 자체를 닫는다 — 에이전트든 셸 터미널이든 이 행이 사라진다. onKill 이
   * "세션만 정지(행은 stopped 로 남음)" 인 것과 갈린다.
   */
  onClose?: () => void;
  isDeleting?: boolean;
  isClosing?: boolean;
}

function AgentRowImpl({
  row,
  isHighlighted,
  onSelect,
  onDoubleClick,
  onKill,
  onClose,
  isDeleting = false,
  isClosing = false,
}: Props) {
  const { t } = useTranslation();
  // Defense-in-depth: row.vendor/status 는 AgentListPanel 에서 normalize 되지만,
  // 미래에 다른 호출 경로가 생기거나 신규 vendor/status 등록이 누락되어도
  // crash 가 아니라 회색 fallback 으로만 표시되도록 진입점에서 가드.
  const vendor = VENDOR_VISUALS[row.vendor] ?? VENDOR_VISUALS.custom;
  const pill = STATUS_PILL[row.status] ?? STATUS_PILL.idle;
  // 구체 모델 스탬프가 있을 때만 배지를 낸다 — 없으면 벤더 모노그램만 남는
  // 기존 표시로 자연스럽게 되돌아간다(구 doc/핀 없는 스폰).
  const modelLabel = spawnedModelLabel(row.spawnedModel);

  return (
    <div
      role="button"
      tabIndex={-1}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        // Per-row fallback when the user has Tab-focused into a specific row.
        // The list-level handler in AgentListPanel handles ↑/↓/Enter/→ from
        // the container; this duplicates Enter/Space for accessibility.
        if (e.key === "Enter" || e.key === " " || e.code === "Space") {
          e.preventDefault();
          onSelect();
        }
      }}
      title={
        row.isAgent ? t("agents.row.agentTitle") : t("agents.row.terminalTitle")
      }
      className={`group relative flex items-center gap-3 px-3 py-2 border-b border-[#313244] cursor-pointer transition-colors ${
        isHighlighted ? "bg-[#313244]" : "hover:bg-[#1e1e2e]/60"
      }`}
      style={{ minHeight: 52 }}
    >
      <span
        aria-hidden
        className="absolute left-0 top-0 bottom-0"
        style={{ width: 3, backgroundColor: vendor.stripeColor }}
      />
      <span
        className="flex items-center justify-center text-[10px] font-mono font-bold text-[#cdd6f4]"
        style={{ minWidth: 24, height: 24 }}
        title={vendor.label}
      >
        {vendor.monogram}
      </span>

      {row.taskId && (
        <span className="text-[11px] font-mono text-[#89b4fa] tabular-nums">
          {row.taskId}
        </span>
      )}

      <span className="flex-1 truncate text-sm text-[#cdd6f4]">
        {row.displayName}
      </span>

      {row.isInputWaiting && (
        <span
          className="shrink-0 rounded bg-[#f9e2af]/10 px-1.5 py-0.5 text-[10px] font-medium text-[#f9e2af]"
          title={t("agents.attention.awaitingTitle")}
        >
          ⏸ {t("agents.attention.awaiting")}
        </span>
      )}

      {modelLabel && (
        <span
          className="max-w-[140px] shrink-0 truncate rounded border border-[#45475a] bg-[#181825] px-1.5 py-0.5 text-[10px] font-mono text-[#a6adc8]"
          title={spawnedModelTitle(modelLabel, vendor.label)}
        >
          {modelLabel}
        </span>
      )}

      <span
        className="flex items-center gap-1 text-[11px] font-medium"
        style={{ color: pill.color }}
      >
        <span
          aria-hidden
          className="inline-block rounded-full"
          style={{ width: 6, height: 6, backgroundColor: pill.color }}
        />
        {pill.label}
      </span>

      <span className="text-[11px] text-[#6c7086] tabular-nums w-14 text-right">
        {row.lastActivityLabel}
      </span>

      {row.isAgent && onKill && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onKill();
          }}
          disabled={isDeleting}
          className="rounded border border-[#f38ba8]/30 bg-[#f38ba8]/10 px-2 py-0.5 text-[10px] font-medium text-[#f38ba8] transition-colors hover:bg-[#f38ba8]/20 disabled:cursor-not-allowed disabled:opacity-50"
          title={
            row.status === "stopped"
              ? t("agents.row.removeStoppedTitle")
              : t("agents.row.killSessionTitle")
          }
        >
          {isDeleting
            ? "…"
            : row.status === "stopped"
              ? t("agents.row.cleanup")
              : t("agents.row.kill")}
        </button>
      )}

      {/* 닫기(X) — 에이전트와 셸 터미널 **둘 다** 받는다. 종전엔 이 자리가
          `row.isAgent` 로 잠겨 있어서 터미널 행은 닫을 수단이 아예 없었다.
          hover/포커스 시 드러나고, 닫는 중에는 계속 보인다(사라지면 눌린 게
          맞는지 알 수 없다). */}
      {onClose && (
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onClose();
          }}
          disabled={isClosing}
          aria-label={t("agents.close.rowAria", { name: row.displayName })}
          title={
            row.isAgent
              ? t("agents.close.rowAgentTitle")
              : t("agents.close.rowTerminalTitle")
          }
          className={`flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-[#6c7086] transition-all hover:bg-[#45475a] hover:text-[#f38ba8] focus-visible:opacity-100 disabled:cursor-not-allowed disabled:opacity-50 ${
            isClosing ? "opacity-100" : "opacity-0 group-hover:opacity-100"
          }`}
        >
          {isClosing ? (
            <span className="text-[10px]">…</span>
          ) : (
            <svg
              width="12"
              height="12"
              viewBox="0 0 12 12"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              aria-hidden
            >
              <path d="M3 3l6 6M9 3l-6 6" />
            </svg>
          )}
        </button>
      )}

      <span
        aria-hidden
        className="text-[10px] text-[#6c7086]"
        style={{ width: 12 }}
      >
        ▶
      </span>
    </div>
  );
}

export const AgentRow = memo(AgentRowImpl);
