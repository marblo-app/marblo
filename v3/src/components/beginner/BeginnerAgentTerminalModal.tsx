import { useEffect } from "react";
import { useTranslation } from "../../lib/i18n";
import type { Agent } from "../../types/agent";
import type { Task } from "../../types/task";
import TerminalView from "../terminal/TerminalView";
import { BEGINNER_ROLE_ICON } from "./beginnerUi";

/**
 * 비기너 에이전트 터미널 — "이 친구가 지금 뭘 치고 있나".
 *
 * 시연에서 사장님이 에이전트를 누르셨는데 아무 일도 없었다. 미니 에이전트
 * 패널(#879)이 상태와 담당 티켓까지는 말해 주지만, 그 다음 질문("그래서 지금
 * 뭐 하는 중인데?")에 답하는 화면이 비기너 셸에 아예 없었다.
 *
 * ★새 터미널을 만들지 않는다. 어드밴스드 에이전트 탭이 쓰는 것과 **같은**
 * `TerminalView`(같은 PTY 세션, 같은 replay/resize/스크롤 규칙)를 그대로 띄운다.
 * 짝짓기 규칙도 `lib/agentTerminal` 하나를 공유한다. 비기너용 터미널을 따로
 * 만들면 두 화면이 다른 걸 보여 주게 되고, 그건 승격했을 때 "아까 보던 거랑
 * 다른데?" 가 된다.
 *
 * ★왜 오른쪽 열이 아니라 모달인가: 에이전트 열은 19rem(≈40컬럼 미만)이라
 * CLI TUI 가 그 폭에서 접힌다. 접힌 TUI 는 "안 열린 것" 보다 나쁘다 — 유저는
 * 그게 고장인지 원래 그런지 모른다. 그래서 넓게 연다.
 *
 * 추상화 수준은 유지한다: 모델명·하네스 버전·세션 id 는 그리지 않고, 입력은
 * 막지 않는다(터미널은 읽는 화면이지만, 막힌 에이전트에게 Enter 한 번 쳐 주는
 * 건 비기너도 할 수 있는 복구다 — 어드밴스드와 같은 PTY 라 그대로 먹는다).
 */
export function BeginnerAgentTerminalModal({
  agent,
  task,
  sessionId,
  onClose,
}: {
  agent: Agent;
  /** 지금 붙어 있는 티켓(없으면 null) — 헤더 한 줄의 "무슨 일에". */
  task: Task | null;
  /** 이 에이전트의 PTY 세션. 못 찾았으면 undefined → 빈 상태를 그린다. */
  sessionId?: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
      onClick={onClose}
    >
      <div
        data-testid="beginner-agent-terminal-modal"
        data-agent-id={agent.id}
        data-session-id={sessionId ?? ""}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="flex h-[min(38rem,calc(100vh-4rem))] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-[#45475a] bg-[#181825] shadow-2xl"
      >
        <div className="flex flex-shrink-0 items-center gap-2 border-b border-[#313244] px-4 py-2.5">
          <span aria-hidden className="text-xs leading-4">
            {BEGINNER_ROLE_ICON[agent.role] ?? "🤖"}
          </span>
          <span className="min-w-0 truncate text-sm font-semibold text-[#cdd6f4]">
            {agent.name}
          </span>
          {/* "무슨 일에 붙어 있나" — 패널의 한 줄과 같은 정보를 여기서도 든다.
              터미널만 덜렁 열면 화면 가득한 로그가 무엇에 대한 것인지 모른다. */}
          <span className="min-w-0 flex-1 truncate text-[11px] text-[#7f849c]">
            {task ? task.title : t("beginner.agents.noTask")}
          </span>
          <button
            type="button"
            data-testid="beginner-agent-terminal-close"
            onClick={onClose}
            className="shrink-0 rounded-md border border-[#45475a] px-2.5 py-1 text-xs text-[#cdd6f4] transition-colors hover:bg-[#313244]"
          >
            {t("beginner.taskDetail.close")}
          </button>
        </div>

        {/* ★`relative` 가 필수다. TerminalView 는 `absolute inset-0` 으로 그려져서
            positioned 조상이 없으면 이 박스를 뚫고 나가 fixed 오버레이(=창 전체)를
            덮는다(원클릭 모달에서 실제로 겪은 자리). */}
        <div className="relative min-h-0 flex-1 bg-[#1e1e2e] p-2">
          {sessionId ? (
            <TerminalView sessionId={sessionId} isActive />
          ) : (
            // 세션을 못 찾는 국면은 둘이다: 방금 스폰돼 아직 안 붙었거나, 앱을
            // 재시작해 재접속 전이거나. 둘 다 유저가 할 일은 같다(기다린다).
            <p
              data-testid="beginner-agent-terminal-empty"
              className="px-2 py-3 text-xs leading-5 text-[#7f849c]"
            >
              {t("beginner.agents.terminalEmpty")}
            </p>
          )}
        </div>

        <p className="flex-shrink-0 border-t border-[#313244] px-4 py-2 text-[11px] leading-4 text-[#585b70]">
          {t("beginner.agents.terminalHint")}
        </p>
      </div>
    </div>
  );
}
