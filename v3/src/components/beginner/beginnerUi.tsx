/**
 * 비기너 셸 공용 시각 토큰 — 이 화면의 "디자인 시스템 한 장".
 *
 * 비기너 셸은 여러 컴포넌트(연결 게이트·첫 요청·라이브·미니 보드·미니 팀뷰)가
 * 세로로 이어 붙는 화면이라, 각 파일이 자기 여백·자기 회색을 들면 곧바로 성기고
 * 크루드해 보인다. 실제로 그랬다: 카드마다 패딩이 달랐고, 미니 보드/미니 팀뷰만
 * 어드밴스드 보드의 tailwind `gray-*`(푸른 회색)를 물려받아 셸의 카타푸친
 * 팔레트(#181825 계열, 보랏빛 회색) 위에서 색이 튀었다.
 *
 * 그래서 색·간격·마이크로 라벨을 여기 한 곳에 모은다. 팔레트는 새로 만들지
 * 않는다 — 오케 대화창(`OrchestratorPanel`)이 이미 쓰는 값 그대로다. 이 화면의
 * 8할을 그 대화창이 차지하므로, 나머지가 거기에 맞춰야 한 화면으로 읽힌다.
 */

/** 패널 표면 — 셸 배경(#11111b) 위에 한 단 뜨는 카드. */
export const SURFACE = "rounded-lg border border-[#313244] bg-[#181825]";

/** 패널 **안**에 한 단 들어가는 면(입력칸·미니 카드). */
export const INSET = "rounded-md border border-[#313244] bg-[#1e1e2e]";

/** 패널 안 블록의 공통 가로/세로 여백. 모든 섹션이 같은 값을 써야 줄이 맞는다. */
export const BLOCK = "px-4 py-3";

/** 보조 버튼(상단바·재전송 등). 높이 h-7 로 통일 — 상단바 줄맞춤의 기준. */
export const BUTTON_GHOST =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-[#45475a] px-2.5 text-xs text-[#cdd6f4] transition-colors hover:border-[#585b70] hover:bg-[#313244] disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 주 버튼. ★파랑(#89b4fa)으로 통일한다 — 폴더 게이트는 파랑, 첫 요청 보내기는
 * 초록이라 같은 흐름의 CTA 두 개가 서로 다른 색이었다. 초록은 이 화면에서 "끝난
 * 일"(완료·전달됨)의 색으로만 남긴다.
 */
export const BUTTON_PRIMARY =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-[#89b4fa] px-3.5 py-2 text-sm font-semibold text-[#1e1e2e] transition-colors hover:bg-[#74c7ec] disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 역할 아이콘 — 미니 보드 카드(`TaskCard compact`)가 쓰는 것과 **같은** 그림이다.
 *
 * 비기너 화면에서 "누구" 는 모델명도 에이전트 id 도 아니고 역할이다. 보드 카드와
 * 에이전트 패널이 같은 티켓을 가리킬 때 아이콘이 다르면 같은 것으로 안 읽힌다.
 */
export const BEGINNER_ROLE_ICON: Record<string, string> = {
  backend: "⚙️",
  frontend: "🎨",
  test: "🧪",
  devops: "🚀",
};

/**
 * 섹션 눈썹 라벨 — "지금 하는 일 / 일감 흐름 / 일하는 팀 / 대화".
 *
 * 예전엔 이 라벨이 헤드라인과 **같은 줄**에 flex-wrap 으로 섞여 있어서 둘이
 * 서로 위계를 깎아먹었다. 라벨은 항상 자기 줄에서 작게, 본문은 그 아래에서
 * 크게 — 위계는 크기가 아니라 자리로 만든다.
 */
export function SectionLabel({
  children,
  trailing,
  className = "",
}: {
  children: React.ReactNode;
  /** 오른쪽 끝에 붙는 보조 수치(예: "2/4 완료"). */
  trailing?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#6c7086]">
        {children}
      </span>
      {trailing !== undefined && trailing !== null && (
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-[#7f849c]">
          {trailing}
        </span>
      )}
    </div>
  );
}
