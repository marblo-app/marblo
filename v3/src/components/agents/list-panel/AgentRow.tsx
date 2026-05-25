import { memo } from "react";
import { VENDOR_VISUALS, STATUS_PILL, type AgentRowData } from "./types";

interface Props {
  row: AgentRowData;
  isExpanded: boolean;
  onSelect: () => void;
  onDoubleClick: () => void;
}

function AgentRowImpl({ row, isExpanded, onSelect, onDoubleClick }: Props) {
  const vendor = VENDOR_VISUALS[row.vendor];
  const pill = STATUS_PILL[row.status];

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onDoubleClick={onDoubleClick}
      onKeyDown={(e) => {
        // Enter / Space / → → 같은 의미: focus 모드로 진입 (단일 affordance).
        // 별도 "drill-out" 단축키는 두지 않음 — 더블클릭만으로 충분.
        if (
          e.key === "Enter" ||
          e.key === " " ||
          e.code === "Space" ||
          e.key === "ArrowRight"
        ) {
          e.preventDefault();
          onSelect();
        }
      }}
      title={
        row.isAgent
          ? "Click / Enter / →: focus this agent · Double-click: open Agents tab"
          : "Click / Enter: open terminal"
      }
      className={`relative flex items-center gap-3 px-3 py-2 border-b border-[#313244] cursor-pointer transition-colors ${
        isExpanded ? "bg-[#313244]" : "hover:bg-[#1e1e2e]/60"
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
        className={`text-[10px] text-[#6c7086] transition-transform duration-150 ${
          isExpanded ? "rotate-90" : ""
        }`}
        style={{ width: 12 }}
      >
        ▶
      </span>
    </div>
  );
}

export const AgentRow = memo(AgentRowImpl);
