/**
 * 워크체인 **자동 포착** — 오케가 이미 쓴 문장에서 "다음에 할 일" 을 집어낸다
 * (티켓 lW9iiLGWlO0lVoy4khSM).
 *
 * ## 왜 이 모듈이 존재하는가 — 순환을 끊는다
 * 워크체인은 읽는 쪽(도구 결과 푸터 4곳)이 이미 자동인데, **쓰는 쪽이 오케의
 * 자발적 `add_work_chain_item` 호출**이다. 즉 "잊는 걸 고치는 장치가 안 잊어야
 * 작동한다" 는 순환이다. 그리고 그 순환은 이론이 아니라 **이미 한 번 터졌다**:
 *
 *   2026-08-22, 직전 오케가 사장님께 보고했다 —
 *   "워크체인이 보안규칙 파일을 건드려서, 규칙을 한 번 더 배포해야 합니다.
 *    안 하면 이 기능이 조용히 안 됩니다. **지금 그건 제 머릿속에만 있는 다음
 *    할 일입니다.** 방금 만든 게 정확히 그걸 없애는 기능이고요."
 *   말해놓고 `add_work_chain_item` 을 부르지 않았다. 스킬 §7 규칙("나중에 ~하겠다를
 *   말하는 그 턴에 적는다")은 **그때 이미 있었다.** 다음 날 그 미배포 때문에
 *   Up Next 가 죽어 있었다.
 *
 * ★규칙만으로는 안 됐다는 게 실측이다. 그래서 이 모듈의 전제는 하나다:
 * **"오케가 잘 지키면 된다" 는 해법은 이미 실패했다.**
 *
 * ## 그래서 무엇을 바꾸는가 — 강제하지 않고 대신 적는다
 * 결정적 관찰: 저 실패에서 약속은 **이미 도구를 통과했다.** 오케는 그 문장을
 * 사장님 보고(`escalate_to_owner` / `send_telegram_message`)의 인자로 넘겼다.
 * 우리가 그 인자를 안 읽었을 뿐이다. 그러니 오케에게 *한 번 더 부르라고* 조를
 * 게 아니라, **말하는 행위 자체를 적는 행위로 만든다** — 도구 층이 인자 텍스트를
 * 읽고 항목을 대신 쓴다. 오케가 잊을 게 남지 않는다(순환 종료).
 *
 * ## 정밀도가 재현율보다 먼저다
 * 오탐이 쌓이면 체인이 쓰레기로 덮이고, 그 순간 오케가 푸터를 무시하기 시작한다
 * = 기능 전체 사망. 그래서 이 감지기는 **놓치는 쪽으로 편향**돼 있다
 * (merge-closeout.ts 의 `detectFollowupSignals` 가 "홀드 쪽으로 편향" 된 것과 같은
 * 규율, 부정어 윈도우까지 같은 방식이다). 놓친 약속은 기존 수동 경로
 * (`add_work_chain_item`)로 여전히 적을 수 있다 — 그 경로는 그대로 살아 있다.
 *
 * ## 무엇을 안 잡는가 (의도적)
 *   · **워커 지시문의 명령형** — "적어라 / 골라라 / 확인해라" 는 *수신자*의 할 일이지
 *     오케의 다음 할 일이 아니다. 명령형 어미가 있으면 1인칭 주어가 함께 있을
 *     때만 통과시킨다.
 *   · **현재형 서술** — "게이트를 연다 / 경로를 막는다" 는 PR 이 *한 일*이다.
 *     약속 어미(겠다/해야 합니다/할 예정)만 약속으로 친다.
 *   · **부정** — "재배포 필요 없음 / no need" 는 약속의 반대다.
 *   · **질문** — "이거 해야 하나요?" 는 결정이 아직 없다.
 *
 * 순수 모듈이다. Firestore 도 tools.ts 도 import 하지 않는다(work-chain-core 와
 * 같은 규율 — 렌더러가 그대로 가져다 쓸 수 있어야 한다).
 */
import {
  WORK_CHAIN_WHAT_MAX,
  WORK_CHAIN_WHY_MAX,
  type WorkChainItem,
} from "./work-chain-core.js";

/**
 * 어느 도구의 어느 인자를 읽었는가. 표면마다 오탐 위험이 달라서 정책이 갈린다
 * (`SURFACE_POLICY`).
 */
export type CaptureSurface =
  /** escalate_to_owner(note) / send_telegram_message(text) — 사장님 보고. ★실패 사례의 자리. */
  | "owner_report"
  /** answer_question(answer) — 오케가 워커에게 "A 끝나면 B" 를 말하는 자리. */
  | "answer"
  /** add_activity(message) — 오케 자신의 진행 메모. */
  | "activity"
  /** dispatch_task(instruction) — ★수신자에게 주는 지시문. 가장 오탐이 쉬운 표면. */
  | "dispatch_instruction";

/** 어떤 층에서 걸렸는가 — 오탐 진단과 소음 실측에 쓴다. */
export type CaptureTier =
  /** 오케가 명시적으로 찍은 마커(`[다음]`, `후속:`). 조건 없이 통과. */
  | "explicit"
  /** 오케 큐를 가리키는 명사("후속 티켓", "다음 할 일"). */
  | "queue"
  /** 약속 어미("~하겠다", "~해야 합니다"). */
  | "commitment";

export interface CapturedPromise {
  /** 체인 항목의 what — 오케가 실제로 쓴 문장. 비어 있을 수 없다. */
  what: string;
  /** 체인 항목의 why — 어디서 어떻게 걸렸는지 + 원문. */
  why: string;
  tier: CaptureTier;
  /** 걸린 마커 문자열들(진단용). */
  signals: string[];
  /** 감지된 원문 문장(잘리기 전). */
  quote: string;
  /** "A 끝나면" 류 선행 힌트가 함께 있었나 — 선행 티켓 추출을 허용할지의 근거. */
  hasDependencyHint: boolean;
  /** 문장에서 뽑은 Firestore 티켓 id 후보(20자 영숫자). 존재 검증은 호출자 몫. */
  taskIdHints: string[];
}

// ── 마커 목록 ────────────────────────────────────────────────────────────
//
// 전부 소문자 비교다(`normalize`). 한국어는 대소문자가 없고 영어만 영향받는다.

/**
 * 명시 마커. 오케가 "이건 다음 할 일이다" 라고 직접 찍은 것이라 조건 없이 통과한다.
 * 줄의 나머지가 곧 항목이 된다.
 */
const EXPLICIT_MARKERS = [
  "[다음]",
  "[next]",
  "다음 할 일:",
  "다음에 할 일:",
  "후속:",
  "후속 작업:",
  "next:",
  "todo:",
  "follow-up:",
] as const;

/**
 * 오케 **자신의 큐**를 가리키는 명사. 이 말이 나왔다는 것 자체가 "보드 밖에 남은
 * 일이 있다" 는 뜻이라, 약속 어미 없이도 통과시킨다.
 */
const QUEUE_MARKERS = [
  "다음 할 일",
  "다음에 할 일",
  "후속 티켓",
  "후속 작업",
  "다음 티켓",
  "남은 일",
  "follow-up ticket",
  "followup ticket",
] as const;

/**
 * 약속 어미·조동사. ★현재형 서술("연다","막는다")과 갈라야 해서 어미 자체를 본다.
 * "해야 합니다" 가 실패 사례의 문장을 잡는 축이다.
 */
/**
 * **의지** 어미 — "열겠다", "올리겠습니다". 1인칭 의지가 어미에 박혀 있어서
 * 위치를 따지지 않아도 약속이다.
 */
const COMMITMENT_VOLITIVE = [
  "겠다",
  "겠습니다",
  "겠어요",
  "겠음",
  "할 것이다",
  "할 예정",
  "i will ",
  "i'll ",
  "we will ",
  "we'll ",
  "i need to ",
  "we need to ",
  "i must ",
  "we must ",
  "still need to ",
] as const;

/**
 * **당위** 어미 — "-아/어야 한다". 어간 무관 일반형이어야 한다("해야 합니다" 만
 * 넣었더니 "만들어야 합니다"·"돌려야 한다"·"올려야 함" 이 전부 새 나갔다).
 *
 * ★다만 당위는 의지와 달리 **중의적**이다. "규칙을 한 번 더 배포해야 합니다"(약속)
 * 와 "허용은 목록에 명시적으로 적어야 한다"(설계 규범)가 같은 어미를 쓴다. 실측:
 * 이 저장소 커밋 400건에 그냥 걸었더니 5.5% 가 걸렸고 걸린 것 대부분이 설계
 * 근거문이었다. 그래서 **문장 종결 위치**를 요구한다 — 뒤에 한글이 더 붙으면
 * ("…여야 한다**는 근거**", "…해야 한다**고 본다**") 그건 주장이 아니라 인용된
 * 규범이고, 오케가 스스로에게 부여한 다음 할 일이 아니다.
 */
const COMMITMENT_MODAL = [
  "야 한다",
  "야 합니다",
  "야 된다",
  "야 돼",
  "야 함",
  "야겠",
] as const;

/** 마커 뒤에 한글이 더 있으면 종결이 아니다(종속절·인용절). */
const HANGUL_RE = /[가-힣]/u;

function isSentenceFinal(hay: string, marker: string): boolean {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(marker, from);
    if (i === -1) return false;
    if (!HANGUL_RE.test(hay.slice(i + marker.length))) return true;
    from = i + marker.length;
  }
}

/**
 * 의지 어미 뒤에 바로 붙는 인용·관형 조사. "열**겠다던** 웹 티켓" 은 *남이 그랬다는
 * 회고*지 지금 하는 약속이 아니다(실측: 이 저장소 커밋 본문에서 실제로 걸렸다).
 * 의지 어미는 문장 중간에도 정상적으로 오므로("올리겠습니다 — 그때까지 …")
 * 종결 위치를 요구하는 대신 이 꼬리들만 잘라낸다.
 */
const QUOTATIVE_TAILS = ["던", "고", "는", "며", "니", "지", "면"] as const;

function hasLiveVolitive(hay: string, marker: string): boolean {
  let from = 0;
  for (;;) {
    const i = hay.indexOf(marker, from);
    if (i === -1) return false;
    const next = hay.slice(i + marker.length, i + marker.length + 1);
    if (!QUOTATIVE_TAILS.includes(next as (typeof QUOTATIVE_TAILS)[number]))
      return true;
    from = i + marker.length;
  }
}

/**
 * 목적어 표지(을/를). ★당위 어미의 중의성을 가르는 축이다.
 *
 * 오케의 다음 할 일은 **무언가를 하는 것**이라 목적어가 있다
 * ("규칙**을** 배포해야 합니다", "인덱스**를** 만들어야 합니다"). 반면 설계 규범은
 * 상태 서술이라 목적어가 없다("검사**가** 있어야 한다", "줄**도** 같이 바뀌어야
 * 한다", "시끄럽게 멈춰야 한다"). 실측: 이 축 하나로 커밋 400건의 오탐 대부분이
 * 사라졌고, 실제 약속 문장은 하나도 잃지 않았다.
 */
const OBJECT_MARKER_RE = /[가-힣][을를][\s,)]|[가-힣][을를]$/u;

/**
 * 선행 힌트 — "A 가 끝나면 B". 그 자체로는 약속이 아니지만(조건절일 뿐),
 * ①지시문 표면에서 약속 어미의 **동반 조건**이고 ②선행 티켓 id 추출을 허용한다.
 */
const DEPENDENCY_HINTS = [
  "끝나면",
  "끝난 뒤",
  "끝난 후",
  "머지되면",
  "머지된 뒤",
  "머지 후",
  "머지하면",
  "배포 후",
  "배포되면",
  "배포한 뒤",
  "완료되면",
  "완료된 뒤",
  "done 되면",
  "done 이 되면",
  "그다음",
  "그 다음",
  "이 티켓 뒤에",
  "after that",
  "once merged",
  "once deployed",
] as const;

/**
 * 2인칭 명령형 어미 — **수신자**의 할 일이라는 표식. 1인칭 주어가 함께 있지
 * 않으면 후보에서 탈락시킨다. dispatch 지시문이 통째로 체인에 쏟아지는 걸 막는
 * 단 하나의 축이다.
 */
const DIRECTIVE_ENDINGS = [
  "세요",
  "십시오",
  "해줘",
  "해 줘",
  "말 것",
  "지 마",
  "도록 해",
  "please ",
] as const;

/**
 * "-라" 로 끝나는 명령형 꼬리. 한국어 명령형은 어간마다 형태가 갈려서
 * ("적어라 / 골라라 / 대라 / 남겨라") 목록으로는 못 덮는다. 한글 음절 뒤의
 * 종결 "라" 를 통째로 명령형으로 본다 — 놓치는 쪽이 아니라 **거절하는 쪽**으로
 * 기우는 규칙이라 이 모듈의 편향과 방향이 같다.
 */
const DIRECTIVE_TAIL_RE = /[가-힣]라[.!]?\s*$/u;

/**
 * 1인칭 주어/소유격 — 명령형 어미가 있어도 이게 있으면 "내가 할 일" 로 본다.
 *
 * ★단순 부분문자열로 하면 안 된다: "제 " 는 "문제 ", "내 " 는 "안내 " 안에서
 * 걸린다. 한국어는 \b 가 없으므로 **앞이 문두이거나 공백/여는 괄호**임을
 * 명시적으로 요구한다.
 */
const SELF_SUBJECT_RE =
  /(?:^|[\s([{"'“‘])(?:내가|제가|나는|저는|우리가|우리는|내|제|우리)\s/u;

/** 영어 1인칭 — 이쪽은 \b 가 있으므로 그대로 쓴다. */
const SELF_SUBJECT_EN_RE = /\b(?:i|we)\s+(?:will|'ll|need|must|should|am|are)\b/i;

function hasSelfSubject(body: string, hay: string): boolean {
  return SELF_SUBJECT_RE.test(body) || SELF_SUBJECT_EN_RE.test(hay);
}

/**
 * 부정 — 약속의 반대. merge-closeout.ts 와 같은 "마커 뒤 좁은 창" 방식이다.
 * "재배포 필요 없음" 이 약속으로 잡히면 체인이 즉시 신뢰를 잃는다.
 */
const NEGATIONS = [
  "없다",
  "없음",
  "없습니다",
  "없어",
  "아니다",
  "아님",
  "아닙니다",
  "불필요",
  "필요 없",
  "필요없",
  "안 해도",
  "않아도",
  "취소",
  "none",
  "not needed",
  "no need",
  "cancelled",
  "canceled",
] as const;

/**
 * 부정어를 찾는 범위 — 마커 **뒤** 20자. merge-closeout.ts 와 같은 방식(뒤쪽만)이다.
 *
 * ★앞쪽 창도 뒀다가 뺐다: 한국어에서 당위 어미의 부정형("할 필요 없다", "안 해도
 * 된다")은 애초에 이 마커들과 겹치지 않아서 앞쪽 창이 잡을 게 없고, 대신
 * "재배포는 필요 없다고 하니 다시 돌려야 한다" 같은 **살아 있는 약속**을 오히려
 * 죽였다. 뒤쪽 창만 남기면 "다시 만들어야 합니다 — 아니다, 취소" 형태를 잡는다.
 */
const NEGATION_AFTER = 20;

/** 너무 짧으면 항목이 되지 못하고, 너무 길면 문장이 아니라 문단이다. */
const MIN_UNIT_LEN = 8;
const MAX_UNIT_LEN = 400;

/** Firestore 자동 id — 20자 영숫자. 티켓 id 후보 추출용. */
const TASK_ID_RE = /\b[A-Za-z0-9]{20}\b/g;

// ── 표면별 정책 ──────────────────────────────────────────────────────────

export interface SurfacePolicy {
  tiers: readonly CaptureTier[];
  /**
   * commitment 층에 **선행 힌트 동반**을 요구할지. 지시문 표면에서만 true —
   * 명령형 어미 필터를 통과한 서술문 중에서도 "순서에 관한 문장" 만 남기려는
   * 두 번째 체다. 이게 없으면 워커 지시문의 정중한 서술("~해야 합니다")이
   * 전부 걸린다.
   */
  commitmentNeedsDependencyHint: boolean;
  /** 한 번의 호출에서 만들 수 있는 항목 수 상한. 문단 하나가 체인을 덮지 못하게. */
  maxPerCall: number;
}

export const SURFACE_POLICY: Record<CaptureSurface, SurfacePolicy> = {
  // 사장님 보고 — ★2026-08-22 실패의 자리. 오케가 자기 계획을 서술하는 표면이고
  // 명령형이 거의 없다. 세 층 모두 연다.
  owner_report: {
    tiers: ["explicit", "queue", "commitment"],
    commitmentNeedsDependencyHint: false,
    maxPerCall: 3,
  },
  // 워커에게 주는 답변이지만 "A 끝나면 B 는 내가 한다" 가 자주 나온다.
  answer: {
    tiers: ["explicit", "queue", "commitment"],
    commitmentNeedsDependencyHint: false,
    maxPerCall: 2,
  },
  // 오케 자신의 진행 메모.
  activity: {
    tiers: ["explicit", "queue", "commitment"],
    commitmentNeedsDependencyHint: false,
    maxPerCall: 2,
  },
  // ★가장 위험한 표면. 지시문은 통째로 명령형이고 길다(이 티켓 지시문만 2000자).
  // commitment 층에 선행 힌트를 요구해 "순서에 관한 문장" 으로 좁힌다.
  dispatch_instruction: {
    tiers: ["explicit", "queue", "commitment"],
    commitmentNeedsDependencyHint: true,
    maxPerCall: 2,
  },
};

// ── 스캔 ─────────────────────────────────────────────────────────────────

const normalize = (s: string): string => s.toLowerCase();

function hits(hay: string, markers: readonly string[]): string[] {
  return markers.filter((m) => hay.includes(m));
}

/** 마커 주변(앞 24 / 뒤 16)에 부정어가 있는가. 마커의 **모든** 출현을 본다. */
function isNegated(hay: string, marker: string): boolean {
  let from = 0;
  let sawOccurrence = false;
  for (;;) {
    const i = hay.indexOf(marker, from);
    if (i === -1) break;
    sawOccurrence = true;
    const window = hay.slice(
      i + marker.length,
      i + marker.length + NEGATION_AFTER,
    );
    // 하나라도 부정 없이 살아 있으면 그 문장은 살아 있는 약속이다.
    if (!NEGATIONS.some((n) => window.includes(n))) return false;
    from = i + marker.length;
  }
  return sawOccurrence;
}

/**
 * 텍스트를 판정 단위로 쪼갠다. 줄 → 문장. 한국어 종결부호가 없는 줄이 흔해서
 * 줄바꿈을 1차 경계로 쓴다(오케 보고문은 사실상 줄 단위다).
 */
export function splitUnits(text: string): string[] {
  const out: string[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    for (const piece of line.split(/(?<=[.!?。])\s+/)) {
      const unit = piece.trim();
      if (unit) out.push(unit);
    }
  }
  return out;
}

/** 목록 기호·마크다운 장식을 벗긴다 — 항목 제목이 "- ★**…**" 로 시작하지 않게. */
function stripOrnament(s: string): string {
  // 이모지 일부는 이형자 선택자(U+FE0F)가 붙은 **두 코드포인트**라 문자 클래스에
  // 넣으면 낱개로 쪼개진다(no-misleading-character-class). 그래서 교체 그룹으로 뺀다.
  return s
    .replace(/^(?:[\s>*\-–—·•★☆#]|✅|✔️?|⚠️?|📌|🔗|▶)+/u, "")
    .replace(/\*\*/g, "")
    .trim();
}

function clamp(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1)}…`;
}

function extractTaskIdHints(unit: string): string[] {
  const found = unit.match(TASK_ID_RE) ?? [];
  return [...new Set(found)];
}

/**
 * 한 단위(문장)를 판정한다. 통과하면 CapturedPromise, 아니면 null.
 * 순수 — 호출자가 표면 정책을 준다.
 */
export function evaluateUnit(
  unit: string,
  policy: SurfacePolicy,
): CapturedPromise | null {
  const body = stripOrnament(unit);
  if (body.length < MIN_UNIT_LEN || body.length > MAX_UNIT_LEN) return null;
  // 질문은 아직 결정이 아니다.
  if (/[?？]\s*$/.test(body)) return null;

  const hay = normalize(body);
  const dependency = hits(hay, DEPENDENCY_HINTS);
  const hasDependencyHint = dependency.length > 0;
  const selfSubject = hasSelfSubject(body, hay);

  // ① 명시 마커 — 조건 없이 통과하고, 마커 뒤가 항목이 된다.
  if (policy.tiers.includes("explicit")) {
    for (const marker of EXPLICIT_MARKERS) {
      const i = hay.indexOf(marker);
      if (i === -1) continue;
      const rest = stripOrnament(body.slice(i + marker.length));
      const what = rest.length >= MIN_UNIT_LEN ? rest : body;
      return {
        what: clamp(what, WORK_CHAIN_WHAT_MAX),
        why: buildWhy("explicit", [marker], body),
        tier: "explicit",
        signals: [marker],
        quote: body,
        hasDependencyHint,
        taskIdHints: extractTaskIdHints(body),
      };
    }
  }

  // ★명령형 게이트 — 수신자의 할 일은 오케의 다음 할 일이 아니다.
  //   명시 마커 뒤에 두는 이유: 오케가 직접 `[다음]` 을 찍었다면 그건 명령형
  //   문장 안에 있어도 오케의 항목이다.
  const directive =
    hits(hay, DIRECTIVE_ENDINGS).length > 0 || DIRECTIVE_TAIL_RE.test(body);
  if (directive && !selfSubject) return null;

  // ② 큐 명사 — "후속 티켓 / 다음 할 일" 은 보드 밖의 일을 가리킨다. 다만 명사만
  // 으로는 부족하다: "오케가 **다음에 할 일**을 잊는다" 처럼 그 명사를 **설명**
  // 하는 문장이 실제 커밋 제목에 있었고(테스트 코퍼스), 그게 걸리면 체인이
  // 회고문으로 덮인다. 그래서 "누구의 일인지(1인칭)" 나 "언제인지(선행 힌트)" 나
  // "하겠다는 건지(약속 어미)" 중 하나가 함께 있어야 통과시킨다.
  const hasObject = OBJECT_MARKER_RE.test(body);
  const commitmentHits = [
    // 의지 어미 — 인용·관형 꼬리("열겠다던")만 제외한다.
    ...hits(hay, COMMITMENT_VOLITIVE).filter((m) =>
      m.startsWith("i") || m.startsWith("w") || m.startsWith("s")
        ? true
        : hasLiveVolitive(hay, m),
    ),
    // 당위 어미 — 종결 위치 + 목적어 동반. 둘 다 위 주석에 실측 근거가 있다.
    ...(hasObject
      ? hits(hay, COMMITMENT_MODAL).filter((m) => isSentenceFinal(hay, m))
      : []),
  ].filter((m) => !isNegated(hay, m));
  if (policy.tiers.includes("queue")) {
    const queue = hits(hay, QUEUE_MARKERS).filter((m) => !isNegated(hay, m));
    const scoped = selfSubject || hasDependencyHint || commitmentHits.length > 0;
    if (queue.length > 0 && scoped) {
      return {
        what: clamp(body, WORK_CHAIN_WHAT_MAX),
        why: buildWhy("queue", queue, body),
        tier: "queue",
        signals: queue,
        quote: body,
        hasDependencyHint,
        taskIdHints: extractTaskIdHints(body),
      };
    }
  }

  // ③ 약속 어미.
  if (policy.tiers.includes("commitment")) {
    const commitment = commitmentHits;
    if (
      commitment.length > 0 &&
      (!policy.commitmentNeedsDependencyHint || hasDependencyHint)
    ) {
      return {
        what: clamp(body, WORK_CHAIN_WHAT_MAX),
        why: buildWhy("commitment", [...commitment, ...dependency], body),
        tier: "commitment",
        signals: commitment,
        quote: body,
        hasDependencyHint,
        taskIdHints: extractTaskIdHints(body),
      };
    }
  }

  return null;
}

function buildWhy(
  tier: CaptureTier,
  signals: readonly string[],
  quote: string,
): string {
  const label =
    tier === "explicit"
      ? "오케가 명시 마커로 찍음"
      : tier === "queue"
        ? "오케가 자기 큐를 언급함"
        : "오케가 약속 어미로 말함";
  return clamp(
    `${label}(${signals.join(", ")}) — 자동 포착. 원문: "${quote}". ` +
      `틀렸으면 update_work_chain_item(close="dropped", reason=...) 로 닫아라.`,
    WORK_CHAIN_WHY_MAX,
  );
}

/**
 * 표면 하나의 텍스트에서 약속을 뽑는다. 중복 문장은 한 번만, 정책 상한까지.
 * ★절대 throw 하지 않는다(호출자는 fail-open 경로다).
 */
export function detectFollowUpPromises(
  text: string | null | undefined,
  surface: CaptureSurface,
): CapturedPromise[] {
  if (!text || !text.trim()) return [];
  const policy = SURFACE_POLICY[surface];
  const out: CapturedPromise[] = [];
  const seen = new Set<string>();
  for (const unit of splitUnits(text)) {
    if (out.length >= policy.maxPerCall) break;
    const hit = evaluateUnit(unit, policy);
    if (!hit) continue;
    const key = normalizeForCompare(hit.what);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(hit);
  }
  return out;
}

// ── 체인 중복 제거 ───────────────────────────────────────────────────────

/** 비교용 정규화 — 공백·구두점·장식 제거 후 소문자. */
export function normalizeForCompare(s: string): string {
  return s
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .trim();
}

/** 토큰(2-gram) 자카드 — 짧은 한국어 문장에 형태소 분석 없이 쓸 수 있는 근사. */
function similarity(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 1;
  const grams = (s: string): Set<string> => {
    const g = new Set<string>();
    for (let i = 0; i + 2 <= s.length; i++) g.add(s.slice(i, i + 2));
    return g;
  };
  const ga = grams(a);
  const gb = grams(b);
  if (ga.size === 0 || gb.size === 0) return 0;
  let inter = 0;
  for (const g of ga) if (gb.has(g)) inter++;
  return inter / (ga.size + gb.size - inter);
}

/** 이 값 이상이면 "같은 약속" 으로 보고 다시 적지 않는다. */
export const DUPLICATE_SIMILARITY = 0.6;

/**
 * 이미 체인에 있는(=열린) 항목과 겹치는 포착을 걸러낸다. 같은 약속을 두 도구가
 * 각각 잡거나, 같은 문장이 담긴 보고를 두 번 보내도 항목이 늘지 않는다.
 * ★닫힌 항목(done/dropped)은 비교 대상에서 뺀다 — 한 번 dropped 한 약속이
 * 되살아나는 건 맞는 동작이다(오케가 다시 말했다는 뜻이므로).
 */
export function dedupeAgainstChain(
  captured: readonly CapturedPromise[],
  existing: readonly WorkChainItem[],
): CapturedPromise[] {
  const openKeys = existing
    .filter((i) => !i.closed)
    .map((i) => normalizeForCompare(i.what));
  const out: CapturedPromise[] = [];
  for (const c of captured) {
    const key = normalizeForCompare(c.what);
    if (!key) continue;
    const dup =
      openKeys.some((k) => similarity(k, key) >= DUPLICATE_SIMILARITY) ||
      out.some(
        (o) =>
          similarity(normalizeForCompare(o.what), key) >= DUPLICATE_SIMILARITY,
      );
    if (!dup) out.push(c);
  }
  return out;
}

// ── 결과 문장 ────────────────────────────────────────────────────────────

/**
 * 도구 결과에 붙일 한 줄. ★"적었다" 는 사실과 **되돌리는 법**을 같이 준다 —
 * 자동 기록이 틀렸을 때 오케가 즉시 지울 수 없으면 그게 곧 소음이 된다.
 */
export function formatCaptureNote(
  written: ReadonlyArray<{ id: string; what: string }>,
): string {
  if (written.length === 0) return "";
  const lines = written.map((w) => `  · ${w.what} (id=${w.id})`);
  return (
    `📌 워크체인에 자동 기록됨 — 네가 방금 말한 다음 할 일이다. 세션이 바뀌어도 남는다.\n` +
    `${lines.join("\n")}\n` +
    `  (아니면 update_work_chain_item(item_id, close="dropped", reason="...") 로 닫아라. ` +
    `티켓이 생기면 add_task_ids 로 붙여야 보드가 완료를 판정한다.)`
  );
}
