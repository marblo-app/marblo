import { useState, type ReactNode } from "react";
import { ChevronDown } from "lucide-react";

/**
 * 커넥터 연결 가이드 접힘/열림 패널 — Slack(#939 / iFsU8z)·Telegram 과 동일한
 * 토글 chrome. 채널별 단계 본문만 children 으로 넘긴다(중복 구현 금지).
 */
export interface ConnectorGuidePanelProps {
  /** 접힌 상태에서 보이는 토글 라벨 (i18n 문자열). */
  toggleLabel: string;
  /** 펼쳤을 때 본문 (단계 목록 등). */
  children: ReactNode;
  /** 기본 접힘. 테스트에서 초기 열림이 필요할 때만 true. */
  defaultOpen?: boolean;
}

export function ConnectorGuidePanel({
  toggleLabel,
  children,
  defaultOpen = false,
}: ConnectorGuidePanelProps) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className="mt-3 rounded border border-[#313244] bg-[#1e1e2e]">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-[#bac2de] hover:bg-[#313244]/60"
      >
        <span>{toggleLabel}</span>
        <ChevronDown
          className={`h-4 w-4 text-[#6c7086] transition-transform ${
            open ? "rotate-180" : ""
          }`}
        />
      </button>
      {open && (
        <div className="space-y-3 border-t border-[#313244] px-3 py-3 text-[11px] leading-5 text-[#bac2de]">
          {children}
        </div>
      )}
    </div>
  );
}

/** 2열 반응형 단계 목록 — Slack/Telegram/GitHub 가이드 공통. */
export function ConnectorGuideSteps({ children }: { children: ReactNode }) {
  return <ol className="grid gap-2 md:grid-cols-2">{children}</ol>;
}

export function ConnectorGuideStep({ children }: { children: ReactNode }) {
  return (
    <li className="rounded border border-[#313244] bg-[#181825] px-3 py-2">
      {children}
    </li>
  );
}
