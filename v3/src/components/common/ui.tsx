/**
 * 앱 공용 시각 어휘 한 장 — **부를 이름**.
 *
 * 정본: `docs/design-tokens-and-failure-vocabulary-2026-08-22.md` 의 D2,
 * 근거: `docs/ux-beginner-discipline-audit-2026-08-22.md` §2·§5 의 C1.
 *
 * ★왜 이 파일이 필요한가 — 실측이 답을 이미 줬다.
 * 의미 토큰(`index.css` + `tailwind.config.js`)은 2026-08-22 16:56 에 머지됐다(#1134).
 * 같은 날 17:12 에 `StateBlock` 이 머지됐다(#1135). 3시간 56분 뒤에 머지된
 * `WorkChainPanel`(#1139)은 **StateBlock 은 썼고 토큰은 0번 썼다** — 손으로 친 hex 70개.
 * 차이는 하나뿐이다: `StateBlock` 은 **import 할 이름**이었고, 토큰은
 * "이제부터 이렇게 쓰세요" 라는 **약속**이었다.
 * ★약속은 채택되지 않는다. 컴포넌트는 채택된다. 그래서 약속을 이름으로 바꾼다.
 *
 * ★색을 새로 정하지 않는다. 여기 있는 클래스는 전부 `index.css:6-21` 의 CSS 변수를
 * 가리키고, 그 값은 `beginner/beginnerUi.tsx` 가 쓰던 hex 와 **글자까지 같다**.
 * (대조표는 이 파일을 낳은 PR 본문에 12행 전수로 실려 있다 — 12/12 동일.)
 * 그래서 이 파일이 생기는 것만으로는 화면이 **한 픽셀도** 바뀌지 않는다.
 *
 * ★쓰는 법 — 새 컴포넌트에서 카드 표면·여백·버튼을 직접 그리지 마라.
 *
 *   import { SURFACE, BLOCK, BUTTON_PRIMARY, SectionLabel } from "../common/ui";
 *
 *   <div className={SURFACE}>
 *     <div className={BLOCK}>
 *       <SectionLabel trailing="2/4 완료">지금 하는 일</SectionLabel>
 *     </div>
 *   </div>
 *
 * 여기에 없는 색이 필요하면 이 파일에 이름을 **먼저** 만들고 쓴다. 호출부에서
 * `[#rrggbb]` 를 직접 치는 순간 그 색은 다음 사람이 찾을 수 없는 색이 된다.
 */

/** 패널 표면 — 앱 배경(`--surface-app`) 위에 한 단 뜨는 카드. */
export const SURFACE = "rounded-lg border border-subtle bg-surface-panel";

/** 패널 **안**에 한 단 들어가는 면(입력칸·미니 카드). */
export const INSET = "rounded-md border border-subtle bg-surface-raised";

/** 패널 안 블록의 공통 가로/세로 여백. 모든 섹션이 같은 값을 써야 줄이 맞는다. */
export const BLOCK = "px-4 py-3";

/** 보조 버튼(상단바·재전송 등). 높이 h-7 로 통일 — 상단바 줄맞춤의 기준. */
export const BUTTON_GHOST =
  "inline-flex h-7 shrink-0 items-center gap-1.5 rounded-md border border-default px-2.5 text-xs text-primary transition-colors hover:border-strong hover:bg-surface-hover disabled:cursor-not-allowed disabled:opacity-50";

/**
 * 주 버튼. ★강조색(`--accent`) 하나로 통일한다 — 같은 흐름의 CTA 두 개가 서로 다른
 * 색이면 유저는 둘을 다른 종류의 행동으로 읽는다. 초록(`--success`)은 "끝난
 * 일"(완료·전달됨)의 색으로만 남긴다.
 */
export const BUTTON_PRIMARY =
  "inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md bg-accent px-3.5 py-2 text-sm font-semibold text-on-accent transition-colors hover:bg-accent-hover disabled:cursor-not-allowed disabled:opacity-40";

/**
 * 섹션 눈썹 라벨 — "지금 하는 일 / 일감 흐름 / 일하는 팀 / 대화".
 *
 * 라벨이 헤드라인과 **같은 줄**에 섞이면 둘이 서로 위계를 깎아먹는다. 라벨은 항상
 * 자기 줄에서 작게, 본문은 그 아래에서 크게 — 위계는 크기가 아니라 자리로 만든다.
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
 * 문구의 `**강조**` 를 진짜 `<strong>` 으로 그린다.
 *
 * ★왜 필요한가: 온보딩 카피 몇 줄이 마크다운 문법으로 쓰여 있는데, 그 화면들은
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
      <strong key={key++} className="font-semibold text-primary">
        {m[1]}
      </strong>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
