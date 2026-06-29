import { memo } from "react";
import { VENDOR_VISUALS, STATUS_PILL, type AgentRowData } from "./types";
import { useTranslation } from "../../../lib/i18n";

interface Props {
  row: AgentRowData;
  // Whether this row is the keyboard-highlighted item in the list. Different
  // from "selected/focused" — pressing Enter on the highlighted row enters
  // the FocusView. We keep the prop name semantic-only; visually it renders
  // the same background as the previous isExpanded state.
  isHighlighted: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}

function AgentRowImpl({ row, isHighlighted, onSelect, onDoubleClick }: Props) {
  const { t } = useTranslation();
  // Defense-in-depth: row.vendor/status 는 AgentListPanel 에서 normalize 되지만,
  // 미래에 다른 호출 경로가 생기거나 신규 vendor/status 등록이 누락되어도
  // crash 가 아니라 회색 fallback 으로만 표시되도록 진입점에서 가드.
  const vendor = VENDOR_VISUALS[row.vendor] ?? VENDOR_VISUALS.custom;
  const pill = STATUS_PILL[row.status] ?? STATUS_PILL.idle;

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
      className={`relative flex items-center gap-3 px-3 py-2 border-b border-[#313244] cursor-pointer transition-colors ${
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
