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
      <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted">
        {children}
      </span>
      {trailing !== undefined && trailing !== null && (
        <span className="ml-auto shrink-0 text-[11px] tabular-nums text-muted">
          {trailing}
        </span>
      )}
    </div>
  );
}

/** `**강조**` 를 찾는 유일한 패턴. 비탐욕 — 한 문장에 둘 이상 있어도 각각 잡힌다. */
const BOLD = /\*\*(.+?)\*\*/g;

/**
 * 온보딩 문구의 `**강조**` 를 진짜 `<strong>` 으로 그린다.
 *
 * ★왜 필요한가: 온보딩 카피 몇 줄이 마크다운 문법으로 쓰여 있는데, 이 화면들은
 * 문자열을 그냥 텍스트 노드로 꽂는다. 그래서 사장님 프리뷰 테스트에서 첫 화면이
 * "Connect \*\*either\*\* Claude or Codex" 로 보였다 — 신규 유저가 보는 **첫 문장**에
 * 별표가 그대로 노출된 것이다.
 *
 * 고치는 방향이 둘이었다: (a) 문구에서 `**` 를 지워 평문으로, (b) 강조를 살려
 * 렌더. (b) 를 고른 이유는 그 자리의 강조가 장식이 아니라 **문장의 요지**라서다 —
 * "either(둘 중 하나만)", "same account(로그인한 것과 같은 계정)" 는 각각 그
 * 화면에서 유저가 가장 자주 틀리는 지점이고, 굵게가 사라지면 문장이 평평해진다.
 *
 * 마크다운 파서를 들이지 않는다. 이 화면들이 쓰는 문법은 볼드 하나뿐이라,
 * 파서·sanitizer 를 붙이는 건 그 한 줄을 위해 XSS 표면과 번들을 함께 들이는
 * 일이다. 여기서는 문자열을 **쪼개서** React 노드로 돌려주므로 dangerouslySet~
 * 이 등장하지 않는다 — 문구에 무엇이 들어 있든 텍스트로만 그려진다.
 *
 * 짝이 안 맞는 `**` 는 건드리지 않고 그대로 둔다(삼켜서 감추는 것보다 눈에 띄는
 * 편이 낫다 — 문구를 고쳐야 한다는 신호다).
 */
export function emphasize(text: string): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  let last = 0;
  let key = 0;
  // 모듈 스코프 정규식이라 lastIndex 를 매번 되감는다(g 플래그의 함정).
  BOLD.lastIndex = 0;
  for (let m = BOLD.exec(text); m !== null; m = BOLD.exec(text)) {
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <strong key={key++} className="font-semibold text-[#cdd6f4]">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
