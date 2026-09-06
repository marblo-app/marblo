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
 *   · ★**조각** — 조사·서술격·화살표로 시작하는 단위는 문장이 아니라 인용 삭제나
 *     줄 나눔이 남긴 부스러기다(§FRAGMENT_HEAD_RE).
 *   · ★**숙고 동사** — "봐야/정해야/생각해야" 는 다음 턴의 판단이지 보드가 끝났다고
 *     말해 줄 수 있는 작업이 아니다(§DELIBERATION_STEMS).
 *   · **청자 지향 발화 / 보고 행위** (티켓 tPNWTYM9k5BGMqfjQHZm, 2026-08-24
 *     오포착 7건) — "보고드리겠습니다 / 확인하겠습니다 / 답장 주시면 ~드리겠습니다"
 *     는 사람·에이전트에게 하는 말이지 오케 자기 큐의 다음 할 일이 아니다.
 *     해법 후보와 기각 근거는 `isSpeechActNotWorkItem` 주석.
 *
 * 순수 모듈이다. Firestore 도 tools.ts 도 import 하지 않는다(work-chain-core 와
 * 같은 규율 — 렌더러가 그대로 가져다 쓸 수 있어야 한다).
 */
import {
  WORK_CHAIN_WHAT_MAX,
  WORK_CHAIN_WHY_MAX,
  type WorkChainItem,
} from "./work-chain-core.js";
// 미션 라벨 정규화·매칭은 새로 만들지 않는다 — work-chain-core 와 같은 규율로
// implicit-mission.ts 의 것을 그대로 쓴다(라벨 키 공간이 갈리면 보드 조인이 깨진다).
import { missionLabelKey, normalizeMissionLabel } from "./implicit-mission.js";

/**
 * 어느 도구의 어느 인자를 읽었는가. 표면마다 오탐 위험이 달라서 정책이 갈린다
 * (`SURFACE_POLICY`).
 */
/**
 * ★넷 다 **오케가 쓴 글**이다 — 그리고 그게 이 모듈의 가장 큰 구멍이었다
 * (티켓 wx9c4NeVtZ1SGcbEISpg): 사장님이 준 미션은 한 건도 안 잡혔다.
 * 사장님 인바운드는 electron 메인이 받아 오케 PTY 로 넣으므로 이 프로세스에
 * 도달할 경로 자체가 없었다. 그 구멍은 **표면을 늘려서가 아니라** 파일 아래쪽
 * "사장님 미션 포착" 절이 메운다 — 문장이 아니라 **행동**을 읽는다.
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
 * ★**약한** 큐 명사 — 큐를 가리키기도 하지만 평범한 논평 명사이기도 하다
 * (티켓 9lT62MMHjLMWd3kIEXt7, 2026-09-05).
 *
 * 실측 원문: "조각이 다 있다는 게 우리 강점이고, 잇는 게 **남은 일**입니다."
 * 이건 큐 항목이 아니라 상황 논평이다. 다른 큐 명사는 큐를 **이름으로** 부르지만
 * ("다음 할 일", "후속 티켓") "남은 일" 은 그냥 남아 있는 무언가를 가리키는
 * 보통명사라 논평문에 자연스럽게 섞인다.
 *
 * ★목록에서 빼지 않고 **실질을 요구**한다 — 빼면 "남은 일은 인덱스를 다시 만드는
 * 것입니다" 같은 진짜 큐 문장까지 같이 죽는다. 무엇이 남았는지가 문장 안에 있으면
 * (목적어 또는 티켓 id) 그대로 통과시키고, 없으면 논평으로 본다.
 */
const WEAK_QUEUE_MARKERS = ["남은 일"] as const;

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
 *
 * ★2026-09-04(티켓 GvgBoZ5ajEKTT7G5rWME) 두 군데를 넓혔다. 앞말이 한글일
 * 것을 요구했더니 "PR**을** 올리겠다"·"디자인 3/8 **을** 재개하겠다"(띄어 쓴
 * 조사)가 목적어 없음으로 판정됐다. 이제 앞말의 종류를 안 따지고, 조사가
 * 한 칸 떨어진 형태도 받는다. 방향은 **재현율 쪽**이라 이 축이 어미 층의
 * 유일한 실질 게이트가 된 지금(§hasCaptureSubstance) 안전한 넓힘이다.
 */
const OBJECT_MARKER_RE = /[^\s][을를](?=[\s,)]|$)|[^\s]\s[을를](?=[\s,)]|$)/u;

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
const SELF_SUBJECT_EN_RE =
  /\b(?:i|we)\s+(?:will|'ll|need|must|should|am|are)\b/i;

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

/**
 * 청자 지향 발화 / 보고 행위 — 약속 어미가 있어도 워크체인 항목이 아니다.
 *
 * ## 왜 이 필터인가 (티켓 tPNWTYM9k5BGMqfjQHZm)
 * 2026-08-24 하루에 오포착 7건. 전부 오케가 `send_telegram_message` 또는
 * `answer_question` 본문의 한 문장이 항목이 된 것이다. 후보 세 가지:
 *
 *   (가) 포착 표면을 좁혀 telegram/answer 본문을 안 읽기 — **기각**.
 *       이 모듈이 생긴 자리(2026-08-22 "규칙을 한 번 더 배포해야 합니다")가
 *       정확히 owner_report 다. 끄면 그 실패가 되살아나고, "마지막에 티켓
 *       열겠다" 처럼 사장님께 말한 진짜 약속도 놓친다. 미포착 비용이 더 크다.
 *   (나) 휴리스틱을 좁혀 **보고·제안·메일초안 발화**만 거절 — **채택**.
 *       7건의 공통점은 어미가 아니라 화행이다: 지금 이 턴의 보고/재배정 고지/
 *       청자 조건 제안/공손 제공. 그걸 거절하면 7건이 떨어지고, 작업 사건
 *       조건("배포 끝나면")·자기 큐 약속("열겠다")은 그대로 남는다.
 *   (다) 포착을 제안 상태로 두고 오케가 승인 — **기각**.
 *       자동 포착의 가치가 "오케가 잊을 것을 잡아준다" 인데, 승인을 또 사람이
 *       해야 하면 2026-08-22 순환이 되돌아온다. 오포착 비용은 (나)로 줄이고
 *       남은 미포착은 기존 수동 경로(`add_work_chain_item`)가 받친다.
 *
 * merge_and_close 후속 포착은 이 파일의 텍스트 감지가 아니다
 * (`captureMergeHoldFollowUp`). 여기 필터는 그 경로를 건드리지 않는다.
 *
 * 청자 조건("주시면","고 하시면")과 보고 어미("보고하겠","드리겠")를 가른다.
 * 작업 사건 조건("끝나면","머지되면")은 DEPENDENCY_HINTS 로 남기고 거절하지
 * 않는다 — 그게 좋은 포착과 나쁜 포착의 경계다.
 */
const LISTENER_GATES = [
  "주시면",
  "고 하시면",
  "라고 하시면",
  "다고 하시면",
  "아시면",
  "모르시면",
  "알려주시",
] as const;

/** 보고·고지·공손 제공의 의지 어미. 당위("보고해야 합니다")는 의도적으로 안 넣는다. */
const COMMUNICATIVE_VOLITIVE_STEMS = [
  "보고하겠",
  "보고드리겠",
  "알려드리겠",
  "말씀드리겠",
  "안내하겠",
  "전달하겠",
  "회신하겠",
  "답장하겠",
  "배정하겠",
  "드리겠",
] as const;

function isSpeechActNotWorkItem(
  hay: string,
  opts: { hasObject: boolean; hasDependencyHint: boolean },
): boolean {
  if (LISTENER_GATES.some((g) => hay.includes(g))) return true;
  if (COMMUNICATIVE_VOLITIVE_STEMS.some((s) => hay.includes(s))) return true;
  // "확인하겠습니다" 단독은 이 턴의 호응("제가 확인하겠습니다")이다. 목적어나
  // 선행이 있으면 "로그를 확인하겠다" / "배포 끝나면 설정을 확인하겠다" 처럼
  // 실제 다음 일로 남긴다.
  if (hay.includes("확인하겠") && !opts.hasObject && !opts.hasDependencyHint) {
    return true;
  }
  return false;
}

/**
 * ★입장표명 — "더 말리지 않겠습니다" 류. 2026-08-24 오포착 16건의 한 유형이다
 * (티켓 wx9c4NeVtZ1SGcbEISpg).
 *
 * 의지 어미의 **부정형**은 "안 하겠다" 는 태도 표명이지 할 일이 아니다. 할 일
 * 목록에 "말리지 않기" 를 적을 수는 없다 — 끝났는지 판정할 보드 사실이 없고,
 * 그래서 영원히 열린 채로 남는다. 부정형은 예외 없이 이 성질을 가진다.
 *
 * `NEGATIONS`(마커 뒤 20자 창)로는 이게 안 잡힌다. 부정이 마커 **앞**에
 * 붙기 때문이다("말리**지 않**겠습니다") — 앞쪽 창은 살아 있는 약속을 죽여서
 * 일부러 뺐고(§NEGATION_AFTER), 그 결정은 유효하다. 그래서 창이 아니라
 * **어미의 형태**로 가른다.
 */
const NEGATIVE_VOLITIVE_RE =
  /(?:지\s*않|안\s*하|않으)겠|지\s*않을\s*(?:것|예정)|(?:won't|will not|will never)\s/u;

/**
 * 긍정형 입장표명. ★여기엔 **깨끗한 문법 축이 없다** — 정직하게 밝힌다.
 *
 * 실측 원문(2026-08-24):
 *   · "결정으로 받고 잘 돌게 만드는 쪽으로 **붙겠**습니다."  ← 오포착
 *   · "오늘 세 번 틀렸으니 단정은 **피하겠**습니다."          ← 오포착
 * 그런데 같은 날 **유지된**(=진짜 다음 할 일) 문장도 같은 모양이다:
 *   · "앞서 드린 조언은 **보류하겠**습니다."                   ← 양성
 *   · "계기판이 고쳐진 뒤에 따로 **여쭙겠**습니다."             ← 양성
 * 어미도 같고 목적어 유무도 갈리지 않는다(양성 둘 다 을/를 이 없다).
 * 그래서 목적어를 요구하는 축은 못 쓴다 — 쓰면 양성 둘이 같이 죽고,
 * 기존 회귀("마지막에 X 티켓 열겠다")도 함께 죽는다.
 *
 * 남는 건 **태도 동사의 닫힌 목록**이다. 일반 규칙이 아니라 실측 목록이라는
 * 사실을 여기 적어 둔다 — 새 오포착이 나오면 유형을 보고 늘리되, 이 목록이
 * 길어지기 시작하면 그건 축을 잘못 잡았다는 신호다.
 */
const STANCE_VOLITIVE_STEMS = [
  "말리겠",
  "피하겠",
  "붙겠",
  "따르겠",
  "받아들이겠",
] as const;

/**
 * ★즉시성 — "지금 이 턴에 하는 일" 은 **다음** 할 일이 아니다.
 *
 * 실측 원문: "이어서 보고 머지하겠습니다." · "UTM 규약은 사장님이 바로 쓰실
 * 거라 먼저 보겠습니다." 둘 다 그 턴 안에서 하고 있는 일이라 체인에 적으면
 * 적자마자 끝나 있다(그리고 아무도 안 닫는다).
 *
 * ★선행 힌트가 있으면 거절하지 않는다 — "머지되면 바로 티켓을 열겠습니다" 의
 * '바로' 는 즉시성이 아니라 **사건 뒤의 즉시**이고, 그건 진짜 다음 할 일이다.
 */
const IMMEDIACY_ADVERBS = ["이어서", "먼저", "바로", "곧바로"] as const;

/**
 * ★숙고 동사 — "무엇을 할지 아직 생각한다" 는 할 일이 아니다
 * (티켓 9lT62MMHjLMWd3kIEXt7, 2026-09-05).
 *
 * ## 왜 어미가 아니라 동사인가
 * 이 모듈은 오래 **어미**를 포착 조건으로 썼다("…해야 합니다"). 그런데 한국어는
 * 설명문도 그 어미로 끝난다. 2026-09-05 실측 — open=56 중 절반 이상이 오케
 * 자기 문장의 산문이었고, 살아남은 것들의 원문은 이렇다:
 *
 *   · "가설을 다시 **봐야** 합니다."
 *   · "그만큼 설치 스모크를 제대로 **봐야** 합니다."
 *   · "백필 계획을 함께 세울지도 **정해야** 합니다."
 *
 * 셋 다 목적어가 있고(§OBJECT_MARKER_RE 통과), 종결 위치도 맞고, 부정도 없다.
 * 즉 **지금 켜져 있는 모든 축을 통과한다.** 갈리는 자리는 하나뿐이다 —
 * 동사가 세상을 바꾸지 않는다. 보고·정하고·생각하는 것은 다음 턴의 **판단**이지
 * 보드가 끝났다고 말해 줄 수 있는 **작업**이 아니다. 그래서 영원히 열린 채로
 * 남는다(이 모듈이 두 번 반복해 관측한 실패 모양 그대로다).
 *
 * 대조군 — 같은 어미·같은 목적어인데 남아야 하는 문장들:
 *   · "규칙을 한 번 더 **배포해야** 합니다."(2026-08-22 창립 회귀)
 *   · "광고에 utm 규약을 **실어야** 합니다."
 *   · "인덱스를 다시 **만들어야** 합니다."
 * 전부 상태를 바꾸는 동사고, 보드에 티켓으로 옮길 수 있다.
 *
 * ## 길이로 가르지 않는다
 * ★과거에 "짧은 조각 금지" 로 좁히려다 틀린 자리다(§AUTO_MIN_UNIT_LEN 의 30자
 * 제안). 위 노이즈 셋은 12·20·22자로 길이가 제각각이고, 창립 회귀(26자)보다
 * 긴 것도 있다. 길이는 이 축을 대신하지 못한다.
 *
 * ## 닫힌 목록이라는 사실을 숨기지 않는다
 * §STANCE_VOLITIVE_STEMS 와 같은 규율이다 — 일반 문법 규칙이 아니라 **실측에서
 * 자란 의미 부류(숙고·판단 동사)의 목록**이다. 새 오포착이 나오면 유형을 보고
 * 늘리되, 목록이 길어지기 시작하면 축을 잘못 잡았다는 신호다.
 *
 * ★선행 힌트가 있으면 거절하지 않는다 — "배포 끝나면 로그를 봐야 합니다" 의
 * '보다' 는 사건 뒤에 잡힌 순서 있는 일이고, 그건 진짜 다음 할 일이다
 * (§IMMEDIACY_ADVERBS 와 같은 예외 규율).
 */
/*
 * ★축별 실측 (2026-09-05) — 축을 하나씩 빼고 위 실물 8건과 양성 18건을 다시
 * 돌린 결과다. 재현: 이 파일을 복사해 축 하나를 무력화한 뒤 `evaluateUnit` 을
 * owner_report 정책으로 두 코퍼스에 적용한다.
 *
 *   변형                          실물 노이즈 포착   양성 유지
 *   ─────────────────────────────────────────────────────────
 *   수리 전(세 축 전부 끔)              7/8            18/18
 *   세 축 전부 켬(현재)                 0/8            18/18
 *   − 조각 머리 축만 끔                 4/8            18/18
 *   − 조각 머리를 옛 규칙(을/를)으로      3/8            18/18
 *   − 숙고 동사 축만 끔                 3/8            18/18
 *   − 약한 큐 명사 축만 끔               1/8            18/18
 *
 * 세 축이 4+3+1 = 8 로 정확히 나뉜다 — 겹치지 않고 전부 제 몫이 있다. 그리고
 * **어느 축을 넣어도 양성은 하나도 잃지 않는다**(18/18 이 여섯 줄 내내 같다).
 * 그래서 이 좁힘은 §hasCaptureSubstance 의 2026-09-04 좁힘과 달리 재현율
 * 손실을 대가로 내지 않았다.
 */
const DELIBERATION_STEMS = [
  // 보다 — "봐야/보아야/보겠". 살펴보다·지켜보다·돌아보다도 이 꼬리로 덮인다.
  "봐야",
  "보아야",
  "보겠",
  // 정하다 — "정해야/정하겠". 결정해야·확정해야도 이 꼬리로 덮인다.
  "정해야",
  "정하겠",
  // 생각·판단·고민 — 전부 다음 턴의 판단이지 작업이 아니다.
  "생각해야",
  "생각하겠",
  "판단해야",
  "판단하겠",
  "고민해야",
  "고민하겠",
  "따져야",
] as const;

/**
 * 문장의 약속이 **숙고**인가. 선행 힌트가 있으면(순서가 잡힌 일이면) 아니다.
 */
function isDeliberationNotWorkItem(
  hay: string,
  opts: { hasDependencyHint: boolean },
): boolean {
  if (opts.hasDependencyHint) return false;
  return DELIBERATION_STEMS.some((s) => hay.includes(s));
}

/**
 * ★이미 보드에 넣은 지시를 사장님께 **설명한** 문장 (오포착 유형 c).
 *
 * 실측 원문: "그 문서에 경고 하나를 꼭 넣**으라고 했습니다** — 광고는 …
 * utm 을 실어야 합니다." 뒤 절의 당위만 보면 약속처럼 읽히지만, 앞 절이
 * **이미 지시했다**고 말하고 있다. 그 일은 이미 티켓 안에 있다.
 */
const REPORTED_INSTRUCTION_RE = /(?:라고|다고|으라고)\s*(?:했|시켰|적었)/u;

/**
 * ★금지 + 당위가 한 문장에 있으면 그건 **규범 서술**이지 약속이 아니다.
 *
 * 실측 원문: "'설치 수' 를 그냥 세**면 안 됩니다** — 브라우저·사람당 설치
 * 수를 옆에 봬**야 합니다**." 제품이 어떠해야 하는지를 말한 문장이다.
 * 이미 문서화된 당위 어미의 중의성(§COMMITMENT_MODAL)과 같은 축이고,
 * 종결 위치·목적어로는 안 갈리는 나머지를 여기서 가른다.
 */
const PROHIBITION_RE = /(?:면|하면|으면)\s*안\s*(?:됩니다|된다|돼|되는)/u;

/**
 * ★단위를 통째로 버리는 판정 — **의지 어미든 당위 어미든** 상관없이 항목이
 * 아니다. 유형 c 의 두 문장이 여기서 걸린다(둘 다 당위 어미로 걸렸으므로
 * 의지 어미만 거르는 아래 함수로는 못 막는다).
 *
 * ★명시 마커(`[다음]`)보다는 **뒤**에 놓인다 — 오케가 직접 찍었으면 이긴다.
 */
function isBoardFactNotWorkItem(hay: string): boolean {
  return REPORTED_INSTRUCTION_RE.test(hay) || PROHIBITION_RE.test(hay);
}

/**
 * 의지 어미에만 거는 판정 — 태도 표명과 즉시성. 당위 어미는 건드리지 않는다
 * (당위는 이미 종결 위치·목적어·려면 세 축으로 좁혀져 있다).
 */
function isStanceNotWorkItem(
  hay: string,
  opts: { hasDependencyHint: boolean },
): boolean {
  if (NEGATIVE_VOLITIVE_RE.test(hay)) return true;
  if (STANCE_VOLITIVE_STEMS.some((s) => hay.includes(s))) return true;
  if (
    !opts.hasDependencyHint &&
    IMMEDIACY_ADVERBS.some((a) => hay.includes(a))
  ) {
    return true;
  }
  return false;
}

/**
 * 당위가 "보려면/하려면 … 해야 한다" 형태면 사용자·제품 절차이지 오케의 다음
 * 할 일이 아니다. 실측: "데모를 보려면 매번 Cmd 를 눌러야 한다"(오포착) vs
 * "규칙을 한 번 더 배포해야 합니다"(2026-08-22 실패 사례, 려면 없음).
 *
 * 1인칭이 있으면 "고치려면 제가 규칙을 배포해야 합니다" 처럼 자기 일로 본다.
 */
function isGenericProcedureModal(hay: string, selfSubject: boolean): boolean {
  return !selfSubject && hay.includes("려면");
}

/**
 * ★실질 게이트 — 어미만으로는 항목이 되지 못한다 (티켓 GvgBoZ5ajEKTT7G5rWME, 2026-09-04).
 *
 * ## 실측: 어미 축 하나로 큐가 죽었다
 * 2026-09-04 워크체인 실측 — open=82 / closed=118. 열린 82개의 대부분이 이
 * 모듈이 만든 노이즈였고, 그 항목들의 why 가 **전부** "오케가 약속 어미로
 * 말함(겠습니다 / 야 합니다)" 이었다. 실제 원문:
 *
 *   · "제대로 잡겠습니다."            (wc_uaidlrsha6)
 *   · "이의 있으시면 되돌리겠습니다"  (wc_3rug2mkbom)
 *   · "머지 후 제가 돌리겠습니다."    (wc_3zktut78ax)
 *   · "을 정본으로 남기겠습니다."     ← 인용 삭제가 남긴 부스러기
 *   · "■ 하나 챙겨두겠습니다"
 *
 * 전부 **무엇을 하겠다는 건지가 문장에 없다.** 오케가 사장님께 보고를 할수록
 * 큐가 이런 조각으로 찼고, 200 한도를 넘긴 순간 create_task ·
 * send_telegram_message 가 실패해 **사장님 지시가 아예 기록되지 않았다.**
 * 소음이 기능을 죽인다는 이 모듈의 전제가 실제로 실현된 것이다.
 *
 * ## 축: 의지 어미에도 목적어를 요구한다
 * 당위 어미는 이미 목적어를 요구한다(§OBJECT_MARKER_RE). 의지 어미만 안
 * 요구했고, 위 다섯 건이 전부 그 비대칭으로 샜다. 이제 **같은 축을 건다.**
 *
 * ★이 결정은 §STANCE_VOLITIVE_STEMS 주석이 한 번 기각한 것이다("목적어를
 * 요구하면 양성 둘이 같이 죽는다"). 기각을 뒤집는 근거는 새 실측이다 —
 * 그때 지키려던 양성 둘("조언은 보류하겠습니다" · "따로 여쭙겠습니다")은
 * 지금 큐를 채운 조각들과 같은 종류다: 티켓이 붙지 않고, 닫을 보드 사실이
 * 없고, 영원히 열린 채로 남는다. 재현율 손실은 인정하고 기록해 둔다 —
 * 놓친 약속은 `add_work_chain_item` 이 여전히 받는다.
 *
 * ## 길이 바닥이 30 이 아닌 이유
 * 티켓은 30자를 제안했지만, 이 모듈의 **창립 회귀 문장**이 그보다 짧다:
 * "지금 그건 제 머릿속에만 있는 다음 할 일입니다."(26자, 2026-08-22 실패
 * 사례). 30 으로 잡으면 고치려던 그 실패가 다시 안 잡힌다. 그래서 바닥은
 * 16 — 위 노이즈 5건 중 4건(10·15·14·12자)을 자르고 창립 회귀는 남긴다.
 * 목적어 축이 이미 5건 전부를 자르므로 길이는 이중 안전장치다.
 */
export const AUTO_MIN_UNIT_LEN = 16;

/**
 * ★**조각 머리** — 문장이 아니라 분할 사고다 (티켓 9lT62MMHjLMWd3kIEXt7, 2026-09-05).
 *
 * 인용·코드 삭제(§redactQuotedSpans)나 줄 나눔이 앞부분을 먹으면 조사·서술격
 * 어미가 문두에 남는다. 2026-09-05 워크체인에서 그대로 옮긴 실물:
 *
 *   · "**를** 문자 그대로 읽으면 없는 체크를 기다리다 멈춘다…"
 *   · "**는** 티켓 kqFkuqsy 가 맡고 있고…"
 *   · "**입니다.** 조직 컬렉션이 아직 0건이라…"
 *   · "**→** ①③ 을 지금 검증 티켓으로 띄우겠습니다."
 *
 * 무엇에 대한 약속인지 복원할 길이 없다. 앞말이 사라졌기 때문이다.
 *
 * ★을/를 만 보던 것을 **은/는** 까지 넓힌다. 옛 주석은 "이·가·은·는 은 관형사와
 * 겹쳐 회귀 2건이 죽는다" 고 적었는데, 실제로 겹치는 건 **이·가 뿐**이다
 * ("**이** 작업 뒤로 …", "**이** 티켓이 끝나면 …" — 둘 다 관형사 '이'). 은/는은
 * 한국어에서 문장 첫 낱말이 될 수 없어 오판 위험이 없다. 그래서 넷(을·를·은·는)을
 * 넣고 이·가는 뺀다 — 실측으로 갈린 경계이지 게으름이 아니다.
 *
 * 서술격 머리("입니다", "입니까")와 화살표·구두점 머리도 같은 성질이다. 화살표는
 * §stripOrnament 의 장식 목록에 없어서 여기까지 살아 내려온다.
 */
const FRAGMENT_HEAD_RE =
  /^(?:[을를은는]\s|입니다|입니까|이었습니다|였습니다|[→⇒➔⇨←↔,.;:…)）\]}])/u;

/** 이 단위는 문장이 아니라 조각인가. `stripOrnament` 를 거친 body 를 받는다. */
export function isFragmentHead(body: string): boolean {
  return FRAGMENT_HEAD_RE.test(body);
}

/**
 * ★`redactQuotedSpans` 가 코드/인용 구간을 지운 자리에 조사만 덩그러니 남았나
 * (티켓 WLC9OjIJ8lbCAuz6WlNG 실측: "다만 `P95`의 근거를 나눠야 합니다." →
 * redact 후 "다만  의 근거를 나눠야 합니다." — 지워진 구간 앞뒤 공백이 겹쳐
 * 2칸 이상이 되고, 그 뒤에 그 구간이 걸어 두려던 조사만 남는다).
 *
 * 이건 조각 머리(§FRAGMENT_HEAD_RE)가 못 잡는다 — 조각이 문장 **첫머리**가
 * 아니라 **중간**에서 생겼기 때문이다. 지워진 것이 무엇에 대한 조사인지
 * 이 문장만으로는 복원할 수 없으므로, 문장 전체를 신뢰하지 않는다(fail-closed).
 * 기존 테스트 코퍼스(양성·음성 전부)를 grep 해 이 패턴이 하나도 없음을
 * 확인했다 — 정상 문장에는 이 공백 폭이 나타나지 않는다.
 */
const REDACTED_PARTICLE_RE = /\s{2,}[의과와은는이가을를](?:\s|$)/u;

/** 인용·코드 구간을 지운 자리에 조사만 덩그러니 남은 문장인가. */
export function hasDanglingRedactionGap(body: string): boolean {
  return REDACTED_PARTICLE_RE.test(body);
}

/**
 * 자동 포착이 **근거 없이** 항목을 만들 수 있는 최소 실질.
 *
 * 문장 안에 티켓 id 가 있으면(=근거가 붙는다) 길이·목적어를 안 따진다 —
 * 근거가 붙은 항목은 보드가 닫아 주므로 영원히 열려 있지 않는다.
 * `requireObject` 는 의지/당위 어미 층에서만 true(큐 명사 층은 "다음 할 일"
 * 자체가 목적어 자리라 요구하면 창립 회귀가 죽는다).
 */
export function hasCaptureSubstance(
  body: string,
  opts: {
    hasObject: boolean;
    hasTaskIdHint: boolean;
    requireObject: boolean;
  },
): boolean {
  // ★조각은 티켓 id 보다 **먼저** 본다. 옛 순서는 id 가 실린 조각을 그대로
  //   통과시켰다 — 실측 "를 문자 그대로 읽으면 …" 이 그 구멍으로 들어왔다.
  //   근거가 붙어도 무엇에 대한 약속인지 없으면 사람이 읽을 수 없다.
  if (isFragmentHead(body)) return false;
  // ★같은 이유로 중간 조각(redaction gap)도 티켓 id 보다 먼저 본다 — 지워진
  //   구간이 무엇이었는지 모르는 채로 티켓 id 하나만 보고 통과시키면, "다만
  //   `PR#1234`의 근거를…" 같은 문장도 id 만 보고 살아남는다.
  if (hasDanglingRedactionGap(body)) return false;
  if (opts.hasTaskIdHint) return true;
  // ★어미 층은 **목적어**가 실질이다. 길이 바닥을 함께 걸면 실측 양성이 죽는다
  //   ("규칙을 배포해야 합니다." 12자). 목적어가 있으면 무엇에 대한 약속인지
  //   문장 안에 있고, 그게 이 게이트가 요구하는 전부다.
  if (opts.requireObject) return opts.hasObject;
  // 큐 명사 층은 목적어를 요구할 수 없으므로("… 다음 할 일입니다") 길이로만
  // 조각을 자른다.
  return body.length >= AUTO_MIN_UNIT_LEN;
}

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

// ── ★인용부·코드블록 제외 (티켓 wx9c4NeVtZ1SGcbEISpg) ────────────────────
//
// 2026-08-24 오포착 16건 중 한 유형이 **따옴표 안 제품 문구**였다: 오케가
// 사장님께 UI 카피를 인용한 문장("터미널 열고 git init 을 진행하겠습니다")이
// 통째로 체인 항목이 됐다. #1176 이 화행으로 좁혔지만 인용부는 그대로 샜다 —
// 화행 필터는 *오케가 한 말*의 종류를 가르는 축이라 *오케가 한 말이 아닌 것*을
// 못 가른다.
//
// ★규칙은 하나다: **따옴표·코드블록 안은 오케가 지금 하는 약속이 아니다.**
// 제품 카피든, 사장님 말씀 재인용이든, 남의 로그든, 인용 안의 "~하겠습니다" 는
// 인용된 화자의 것이지 오케의 다음 할 일이 아니다.
//
// 인용 **내용만** 지우고 문장의 나머지는 남긴다 — 문장을 통째로 버리면
// `"좋다"고 하시면 … 발송하겠습니다` 처럼 인용을 품은 **진짜** 문장의 판정
// 근거(여기선 청자 조건 "고 하시면")까지 사라진다.

/** 코드 펜스(```) — 닫히지 않은 펜스는 끝까지 코드로 본다. */
const CODE_FENCE_RE = /```[\s\S]*?(?:```|$)/g;
/** 인라인 코드(`…`) — 줄을 넘지 않는다. */
const INLINE_CODE_RE = /`[^`\n]*`/g;
/** 곧은/둥근 큰따옴표, 한국어 인용부호. 줄을 넘는 쌍은 인용이 아니라 오식이다. */
const DOUBLE_QUOTE_RE = /"[^"\n]*"|“[^”\n]*”|「[^」\n]*」|『[^』\n]*』/g;
/**
 * 작은따옴표는 **한글을 담은 쌍만** 인용으로 본다. 영어 아포스트로피
 * (don't / it's / i'll)가 짝을 이뤄 문장 중간을 삼키는 사고를 막는 축이다.
 * 이 보수성 때문에 한글 없는 인용은 안 지워지지만, 그 실패 방향은 **포착을
 * 놓치는 쪽이 아니라 남기는 쪽**이라 기존 필터가 다시 받는다.
 */
const SINGLE_QUOTE_RE = /'[^'\n]*'/g;

/**
 * ★닫히지 않은 여는 따옴표는 **줄 끝까지** 인용으로 본다.
 *
 * 실측 근거(2026-08-24 오포착 원문 5번): `"터미널 열고 git init 을 진행하겠습니다.`
 * — 오케가 붙여넣다가 닫는 따옴표를 빠뜨렸다. 짝만 지우면 이 한 건이 그대로
 * 샌다. 코드 펜스에서 이미 쓰는 규율(닫히지 않은 펜스는 끝까지 코드)과 같다.
 *
 * 대가: 인치 기호 같은 홀따옴표가 줄 나머지를 삼켜 포착을 **놓칠** 수 있다.
 * 방향이 안전한 쪽이라 감수한다(놓친 건 add_work_chain_item 이 받는다).
 */
const DANGLING_QUOTE_RE = /["“][^\n]*$/gm;

/**
 * 인용·코드 구간을 지운다. 지운 자리는 공백 한 칸 — 지운 흔적이 낱말을 붙여
 * 없던 마커를 만들지 않게 한다.
 *
 * ★`detectFollowUpPromises` 가 **쪼개기 전에** 부른다(코드 펜스는 여러 줄이라
 * 줄 단위로는 못 지운다). `evaluateUnit` 을 직접 부르는 쪽은 이미 지워진
 * 텍스트를 준다고 가정한다.
 */
export function redactQuotedSpans(text: string): string {
  return (
    text
      .replace(CODE_FENCE_RE, " ")
      .replace(INLINE_CODE_RE, " ")
      .replace(DOUBLE_QUOTE_RE, " ")
      .replace(SINGLE_QUOTE_RE, (m) => (HANGUL_RE.test(m) ? " " : m))
      // 짝을 먼저 지웠으므로 여기 남은 따옴표는 짝이 없는 것뿐이다.
      .replace(DANGLING_QUOTE_RE, " ")
  );
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
    .replace(/^(?:[\s>*\-–—·•★☆#■□▪▫◆◇]|✅|✔️?|⚠️?|📌|🔗|▶)+/u, "")
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
  // ★조각은 **어느 층에서도** 문장이 아니다 — 명시 마커보다 앞에 둔다.
  //   앞말이 사라진 단위는 오케가 무엇을 찍었는지 복원할 수 없고, 명시 마커가
  //   그 안에 있어도 항목 제목이 조각인 건 그대로다(§FRAGMENT_HEAD_RE).
  if (isFragmentHead(body)) return null;

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
  // ★이미 보드에 있는 일을 설명한 문장 / 규범 서술은 어미 종류와 무관하게
  //   항목이 아니다. 명시 마커 뒤이므로 오케가 직접 찍은 것은 이미 통과했다.
  if (isBoardFactNotWorkItem(hay)) return null;

  const hasObject = OBJECT_MARKER_RE.test(body);
  // ★숙고 동사는 어미 층 **전체**를 막는다 — 의지("정하겠습니다")든 당위
  //   ("봐야 합니다")든 같은 성질이라 한쪽만 막으면 나머지로 샌다.
  if (isDeliberationNotWorkItem(hay, { hasDependencyHint })) return null;
  const speechAct =
    isSpeechActNotWorkItem(hay, {
      hasObject,
      hasDependencyHint,
    }) || isStanceNotWorkItem(hay, { hasDependencyHint });
  const procedureModal = isGenericProcedureModal(hay, selfSubject);
  const commitmentHits = [
    // 의지 어미 — 인용·관형 꼬리("열겠다던")만 제외한다.
    ...(speechAct
      ? []
      : hits(hay, COMMITMENT_VOLITIVE).filter((m) =>
          m.startsWith("i") || m.startsWith("w") || m.startsWith("s")
            ? true
            : hasLiveVolitive(hay, m),
        )),
    // 당위 어미 — 종결 위치 + 목적어 동반. 둘 다 위 주석에 실측 근거가 있다.
    // "보려면 ~해야 한다" 는 사용자 절차라 당위 히트만 버린다(의지 어미는 남김).
    ...(hasObject && !procedureModal
      ? hits(hay, COMMITMENT_MODAL).filter((m) => isSentenceFinal(hay, m))
      : []),
  ].filter((m) => !isNegated(hay, m));
  const taskIdHints = extractTaskIdHints(body);
  const hasTaskIdHint = taskIdHints.length > 0;
  if (policy.tiers.includes("queue")) {
    // ★약한 큐 명사("남은 일")는 무엇이 남았는지가 문장 안에 있을 때만 큐다.
    //   없으면 논평문이다(§WEAK_QUEUE_MARKERS 의 2026-09-05 실측).
    const queue = hits(hay, QUEUE_MARKERS).filter(
      (m) =>
        !isNegated(hay, m) &&
        (!(WEAK_QUEUE_MARKERS as readonly string[]).includes(m) ||
          hasObject ||
          hasTaskIdHint),
    );
    const scoped =
      selfSubject || hasDependencyHint || commitmentHits.length > 0;
    // ★큐 층은 목적어를 요구하지 않는다 — "다음 할 일" 명사 자체가 그 자리다.
    const substantial = hasCaptureSubstance(body, {
      hasObject,
      hasTaskIdHint,
      requireObject: false,
    });
    if (queue.length > 0 && scoped && substantial) {
      return {
        what: clamp(body, WORK_CHAIN_WHAT_MAX),
        why: buildWhy("queue", queue, body),
        tier: "queue",
        signals: queue,
        quote: body,
        hasDependencyHint,
        taskIdHints,
      };
    }
  }

  // ③ 약속 어미.
  if (policy.tiers.includes("commitment")) {
    const commitment = commitmentHits;
    // ★어미만으로는 못 통과한다 — 무엇을 하겠다는 건지가 문장에 있어야 한다
    //   (§AUTO_MIN_UNIT_LEN 의 2026-09-04 실측).
    const substantial = hasCaptureSubstance(body, {
      hasObject,
      hasTaskIdHint,
      requireObject: true,
    });
    if (
      commitment.length > 0 &&
      substantial &&
      (!policy.commitmentNeedsDependencyHint || hasDependencyHint)
    ) {
      return {
        what: clamp(body, WORK_CHAIN_WHAT_MAX),
        why: buildWhy("commitment", [...commitment, ...dependency], body),
        tier: "commitment",
        signals: commitment,
        quote: body,
        hasDependencyHint,
        taskIdHints,
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
  // ★인용부·코드블록을 먼저 지운다 — 인용 안의 약속 어미는 인용된 화자의 것이다.
  for (const unit of splitUnits(redactQuotedSpans(text))) {
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
 * 정규화된 두 what 이 같은 약속인가. ★쓰기 트랜잭션 안(work-chain.ts
 * `findOpenDuplicate`)과 감지 직후(`dedupeAgainstChain`)가 **같은 함수**를
 * 써야 한다 — 판정을 두 벌 두면 트랜잭션 안팎이 어긋나 중복이 다시 샌다.
 */
export function isDuplicateWhat(a: string, b: string): boolean {
  return similarity(a, b) >= DUPLICATE_SIMILARITY;
}

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
      openKeys.some((k) => isDuplicateWhat(k, key)) ||
      out.some((o) => isDuplicateWhat(normalizeForCompare(o.what), key));
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

// ══ ★사장님 미션 포착 (티켓 wx9c4NeVtZ1SGcbEISpg) ═══════════════════════════
//
// ## 문제
// 위의 감지기는 **오케가 쓴 문장**만 읽는다(표면 넷이 전부 오케 글이다).
// 사장님이 던진 미션은 체인에 한 건도 안 남는다 — 2026-08-24 실측: 사장님이 준
// 미션 5건(광고 집행 · 통합뷰 · 어드민 재설계 · 기업 AX · 마블로비서) 자동 포착
// **0건**, 전부 오케가 손으로 넣었다. 같은 날 오케 자기 문장에서는 오포착 16건.
//
// ## ★왜 문법 분류로 가지 않는가 (훅 A/B/C 비교)
//   (A) 새 표면 `owner_directive` — 인바운드 본문을 위 감지기로 분류. **기각.**
//       같은 날 오케 문장 16건 오포착을 낸 바로 그 장치를, 훨씬 자유로운 텍스트
//       (사장님 구어체, 한 통에 여러 가닥, 질문과 지시가 섞임)에 겨누는 일이다.
//       질의 실패가 재현될 뿐 아니라 **더 나쁘다**: 오케 약속은 오케가 닫을 수
//       있지만 잘못 잡은 사장님 항목은 임의로 못 닫는다(아래 닫기 규칙).
//   (B) ★**행동 = 증거.** 사장님 메시지 직후 오케가 티켓을 만들면 그 티켓이
//       미션이다. **채택.** 근거는 실측이다 — 그날 사장님이 준 미션은 예외 없이
//       전부 `create_task` 로 이어졌고, 질문("봇은 거를 수 있나?")은 티켓을
//       만들지 않았다. 즉 **행동은 문장보다 정확한 신호이고, 이미 존재한다.**
//       결정적으로 이 훅은 사장님 한국어를 **한 글자도 분류하지 않는다** —
//       항목 제목은 오케가 이미 쓴 `mission_label` 또는 티켓 제목에서 온다.
//       16건 오포착을 낸 실패 양식이 구조적으로 재현될 수 없다.
//   (C) 섞기 — 행동이 있으면 확정, 문장만 있으면 **후보**. **기각.**
//       후보 항목은 곧 소음이고, 소음이 쌓이면 오케가 체인을 무시한다(이 모듈
//       전체의 전제). "질문을 미션으로 쌓으면 체인이 다시 쓰레기가 된다."
//
// ★단, (C)의 절반만 가져온다 — **거부권**이다. 행동이 있어도 사장님 메시지가
// 통째로 질문이면 잡지 않는다. 이건 "미션인가?" 를 맞히는 분류가 아니라
// "이건 확실히 미션이 아니다" 만 거르는 **뺄셈**이라 방향이 안전하다(틀리면
// 포착을 놓칠 뿐이고, 놓친 건 add_work_chain_item 이 받는다).
//
// ## ★(B)의 약점과, 그래도 (C)로 안 가는 이유
// (B)는 **티켓이 안 생기는 미션을 못 잡는다.** 사장님이 "이건 나중에 생각해
// 보자" 라고만 하시면 행동이 없다. 이건 진짜 한계다 — 숨기지 않는다.
// 그런데도 문장 분류 후보(C)를 안 붙이는 근거는 셋이다:
//   ① 실측이 5/5 다. 2026-08-24 사장님 미션 5건 전부 create_task 로 갔다.
//      (C)가 벌어야 할 몫이 아직 관측된 적이 없다.
//   ② ★사장님 원문은 모바일 음성입력이라 오타·비문이 많다("짐행/규성/븜석/
//      늨김"). **어휘·어미 매칭에 기대는 규칙은 여기서 구조적으로 깨진다.**
//      같은 날 훨씬 정제된 오케 문장에서도 16건이 오포착됐다.
//   ③ 오포착 비용이 비대칭이다. 오케 약속은 오케가 닫을 수 있지만, 잘못 잡힌
//      사장님 항목은 아래 닫기 규칙 때문에 **임의로 못 닫는다.**
// 그래서 (B)+거부권으로 간다. 놓친 미션은 수동 경로가 받고, 관측이 쌓여
// "티켓 없는 미션" 이 실제로 반복되면 그때 (C)를 근거와 함께 붙인다.
//
// ## ★판정축은 create_task 다 — mission_label 이 아니다
// 실측(2026-08-24): 미션 5건 중 **2건(기업 AX·마블로비서)이 mission_label
// 없이 티켓만** 생겼다. 라벨은 오케가 "묶을 만하다" 고 느낄 때만 붙었고 그
// 느낌은 미션의 크기와 무관했다 — 그날 가장 큰 미션(기업 AX)에 라벨이 없다.
// 라벨을 판정축으로 잡았으면 5건 중 2건을 놓쳤다. 라벨은 **있으면 묶는
// 보조**로만 쓴다(아래 groupKey).
//
// ## 한 통에 여러 가닥이면 어떻게 갈리나
// ★실측 정정: 티켓 본문은 "광고 돌리자 + 봇 거르자 + 어드민 재설계가 한 통에
// 왔다" 고 적었으나 **사실이 아니다** — 별개 메시지였다. 한 통에 여러 가닥인
// 진짜 사례는 기업 AX(감사로그 + 코스트 + 조직관리자)와 마블로비서(위키 가이드
// + 채널 연결 가이드 + 역할별 서브에이전트 + 탭)다.
// 갈라진다 — 다만 **우리가 문장을 쪼개서**가 아니라 오케가 이미 쪼갠 결과를
// 따라서다. "광고 돌리자 + 봇 거르자 + 어드민 재설계" 한 통은 오케가 세 묶음의
// 티켓으로 만든다. 여기서는 그 티켓들을 `mission_label` 로 묶어 **라벨당 항목
// 하나**를 만든다. 라벨이 없는 티켓들은 그 메시지의 무라벨 묶음 하나가 된다.
// ★사장님 한 줄을 그대로 항목으로 밭지 않는다는 규칙이 이 자리에서 지켜진다.

/** 사장님 인바운드 한 건 — `owner-inbound.ts` 저널의 판정에 필요한 부분만. */
export interface OwnerInboundEvidence {
  channel: string;
  from: string;
  /** 인바운드 본문 원문. ★분류하지 않는다 — 거부권 판정과 why 인용에만 쓴다. */
  text: string;
  /** 오케 PTY 로 전달된 시각(epoch ms). */
  at: number;
}

/** 방금 생긴 티켓 — 행동 증거. */
export interface CreatedTaskFact {
  id: string;
  title: string;
  /** 암묵 미션 라벨(있으면). 같은 라벨의 티켓들은 한 미션이다. */
  missionLabel?: string;
}

export interface CapturedOwnerMission {
  /** 이 메시지 안에서의 묶음 키 — 미션 라벨 키, 라벨이 없으면 "". */
  groupKey: string;
  what: string;
  why: string;
  missionLabel?: string;
  /** 이 묶음의 근거 티켓. ★보드가 완료를 판정하게 하는 축이다. */
  taskIds: string[];
}

/** 포착하지 않는 이유. null 이면 포착한다. 진단·로그용으로 문자열을 돌려준다. */
export type OwnerMissionVeto =
  /** 본문에 판정할 글자가 없다(이모지·구두점뿐). */
  | "empty"
  /** 슬래시 명령(/start 등) — 봇 조작이지 지시가 아니다. */
  | "command"
  /** 순수 수긍·인사("ㅇㅋ", "고마워") — 뒤에 생긴 티켓은 오케 자기 일이다. */
  | "acknowledgement"
  /** ★전부 질문 — 지시가 아니라 물음이다. */
  | "all_questions";

/**
 * 수긍·인사만으로 된 메시지. **정확히 이 토큰들일 때만** 걸린다(부분 일치가
 * 아니다) — "고마워, 그리고 광고 돌리자" 는 미션이다.
 */
const ACKNOWLEDGEMENTS = new Set([
  "ㅇㅋ",
  "ㅇㅇ",
  "ㅎㅇ",
  "ㄱㅅ",
  "오케",
  "오케이",
  "ok",
  "okay",
  "네",
  "넵",
  "응",
  "굿",
  "good",
  "고마워",
  "고맙습니다",
  "감사",
  "감사해",
  "감사합니다",
  "수고",
  "수고했어",
  "수고했습니다",
  "알겠어",
  "알겠습니다",
  "확인",
  "확인했어",
  "thanks",
  "thx",
  "nice",
]);

/**
 * 물음표 없는 의문문은 서술문과 구별이 안 된다. 그래서 **오해의 여지가 없는
 * 공손 의문 어미만** 넣는다. 나머지는 물음표에 의존한다 — 거부권은 놓치는
 * 쪽으로 기울어야 안전하다(놓치면 포착될 뿐이고, 과하면 미션을 잃는다).
 */
const INTERROGATIVE_TAILS = [
  "나요",
  "까요",
  "가요",
  "습니까",
  "ㅂ니까",
] as const;

function isInterrogativeUnit(unit: string): boolean {
  const s = stripOrnament(unit);
  if (!s) return true; // 판정할 게 없는 단위는 질문 여부를 뒤집지 않는다
  if (/[?？]\s*$/.test(s)) return true;
  return INTERROGATIVE_TAILS.some((t) => s.endsWith(t));
}

/** 글자만 남긴 비교용 정규화 — 수긍 토큰 대조에 쓴다. */
function acknowledgementKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}\p{Emoji_Presentation}]+/gu, "")
    .trim();
}

/**
 * ★거부권. "미션인가" 를 맞히지 않는다 — "확실히 미션이 아닌 것" 만 거른다.
 * null 이면 통과(행동 증거가 판정한다).
 */
export function ownerMissionVeto(text: string): OwnerMissionVeto | null {
  const trimmed = (text ?? "").trim();
  if (!trimmed) return "empty";
  if (trimmed.startsWith("/")) return "command";
  const key = acknowledgementKey(trimmed);
  if (!key) return "empty";
  if (ACKNOWLEDGEMENTS.has(key)) return "acknowledgement";
  const units = splitUnits(redactQuotedSpans(trimmed));
  if (units.length === 0) return "empty";
  if (units.every(isInterrogativeUnit)) return "all_questions";
  return null;
}

/** why 에 싣는 사장님 원문 인용 길이. 전문은 텔레그램에 남아 있다. */
const OWNER_QUOTE_MAX = 220;

/**
 * 사장님 메시지 + 그 직후 생긴 티켓 → 미션 항목들. **순수**다 — 창(window)
 * 판정과 중복 소비는 호출자(work-chain.ts)의 몫이다.
 *
 * ★항목 제목은 사장님 문장이 아니라 오케가 쓴 `mission_label`/티켓 제목에서
 * 온다. 사장님 한국어를 파싱하는 코드는 이 함수 안에 한 줄도 없다.
 */
export function buildOwnerMissions(
  evidence: OwnerInboundEvidence,
  tasks: readonly CreatedTaskFact[],
): CapturedOwnerMission[] {
  if (tasks.length === 0) return [];
  if (ownerMissionVeto(evidence.text)) return [];

  const groups = new Map<
    string,
    { label?: string; ids: string[]; titles: string[] }
  >();
  for (const task of tasks) {
    if (!task.id) continue;
    const label = normalizeMissionLabel(task.missionLabel ?? null);
    const groupKey = label ? missionLabelKey(label) : "";
    const bucket = groups.get(groupKey) ?? {
      ...(label ? { label } : {}),
      ids: [],
      titles: [],
    };
    if (!bucket.ids.includes(task.id)) bucket.ids.push(task.id);
    if (task.title?.trim()) bucket.titles.push(task.title.trim());
    groups.set(groupKey, bucket);
  }

  const quote = clamp(
    evidence.text.trim().replace(/\s+/g, " "),
    OWNER_QUOTE_MAX,
  );
  const out: CapturedOwnerMission[] = [];
  for (const [groupKey, bucket] of groups) {
    const head = bucket.label
      ? `사장님 미션: ${bucket.label}`
      : `사장님 지시: ${bucket.titles[0] ?? bucket.ids[0]}`;
    const extra =
      !bucket.label && bucket.titles.length > 1
        ? ` 외 ${bucket.titles.length - 1}건`
        : "";
    out.push({
      groupKey,
      what: clamp(`${head}${extra}`, WORK_CHAIN_WHAT_MAX),
      why: clamp(
        `사장님이 ${evidence.channel} 로 지시했고 오케가 곧바로 티켓 ${bucket.ids.length}건으로 옮겼다 — ` +
          `그 **행동**이 근거다(문장 분류가 아니다). 원문: "${quote}". ` +
          `완료는 티켓의 보드 상태가 판정한다. 사장님 항목이라 자기보고로 닫을 수 없다 — ` +
          `물리셨으면 close="dropped" 에 사장님 말씀을 근거로 적어라.`,
        WORK_CHAIN_WHY_MAX,
      ),
      ...(bucket.label ? { missionLabel: bucket.label } : {}),
      taskIds: bucket.ids,
    });
  }
  return out;
}

/** 사장님 미션이 적혔다는 도구 결과 한 줄. */
export function formatOwnerMissionNote(
  written: ReadonlyArray<{ id: string; what: string; taskIds: string[] }>,
  attached: ReadonlyArray<{ id: string; what: string; taskIds: string[] }> = [],
): string {
  const lines: string[] = [];
  for (const w of written) {
    lines.push(`  · ${w.what} (id=${w.id}, 근거 티켓 ${w.taskIds.join(", ")})`);
  }
  for (const a of attached) {
    lines.push(
      `  · ${a.what} (id=${a.id}) ← 근거 티켓 추가: ${a.taskIds.join(", ")}`,
    );
  }
  if (lines.length === 0) return "";
  return (
    `📌 사장님 미션을 워크체인에 기록했다 — 방금 온 사장님 메시지 직후 티켓이 생겼다(행동=증거).\n` +
    `${lines.join("\n")}\n` +
    `  (사장님 항목은 자기보고로 닫히지 않는다. 티켓이 보드에서 DONE 이 되면 닫힌다. ` +
    `사장님이 물리셨으면 update_work_chain_item(item_id, close="dropped", reason="사장님 말씀 ...") 로 닫아라.)`
  );
}

// ══ ★기존 노이즈 일괄 정리 (티켓 GvgBoZ5ajEKTT7G5rWME) ═════════════════════
//
// 위의 게이트는 **앞으로** 생길 노이즈를 막는다. 이미 쌓인 것은 안 없어진다 —
// 2026-09-04 실측으로 열린 82개의 대부분이 그 노이즈였고, 그것 때문에 한도가
// 차서 사장님 지시가 기록되지 못했다. 그래서 "오늘의 규칙으로 다시 판정한다"
// 는 한 가지 기준으로 일괄 정리한다.
//
// ★판정 기준을 새로 만들지 않는다. 새 기준을 만들면 그 기준의 오탐을 아무도
// 검증하지 못한다. 대신 **지금 켜져 있는 감지기에 원문을 다시 넣어 본다** —
// 오늘 규칙으로 안 잡힐 문장이면 그건 옛 규칙이 만든 노이즈다.
//
// ★절대 건드리지 않는 것(순서대로 먼저 걸린다):
//   · source !== "auto"  — 사장님 지시(owner)와 오케가 손으로 적은 항목(manual).
//   · 이미 닫힌 항목.
//   · 티켓/미션/선행이 하나라도 붙은 항목 — 근거가 있으면 보드가 판정한다.
// 판단이 애매하면 남긴다. 남는 쪽의 비용은 한 줄 더 보이는 것이고, 지우는
// 쪽의 비용은 사장님이 시킨 일이 사라지는 것이다.

/** 정리 대상 한 건 — 무엇을, 왜 지우는지. 목록으로 남긴다. */
export interface NoisePruneEntry {
  id: string;
  what: string;
  /** 왜 노이즈로 판정했나 — 활동로그에 그대로 적는다. */
  reason: string;
  sourceTool?: string;
  createdAt: number;
}

export interface NoisePrunePlan {
  /** 닫을 항목. */
  prune: NoisePruneEntry[];
  /** 훑은 열린 항목 수. */
  scannedOpen: number;
  /** 보호돼서 손대지 않은 열린 항목 수(owner/manual/근거 있음). */
  kept: number;
}

/**
 * 자동 포착 노이즈 정리 계획. **순수** — 읽기만 하고 아무것도 안 바꾼다.
 * 호출자가 dry-run 으로 목록을 먼저 보여 준 다음 실제로 닫는다.
 *
 * 두 가지를 노이즈로 본다:
 *   ① **오늘 규칙으로 다시 안 잡히는 것** — 옛 규칙(어미만 보던 규칙)의 산물.
 *   ② **같은 문장이 여러 번 열려 있는 것** — 가장 오래된 하나만 남기고 닫는다
 *      (2026-09-04 3중 등록 실측).
 */
export function planAutoNoisePrune(
  items: readonly WorkChainItem[],
): NoisePrunePlan {
  // 보관(archived)된 이력은 활성 큐가 아니다(#1400) — 정리 대상이 아니다.
  const open = items.filter((i) => !i.closed && !i.archived);
  const prune: NoisePruneEntry[] = [];
  const pruned = new Set<string>();

  const protectedItem = (i: WorkChainItem): boolean =>
    i.source !== "auto" ||
    i.taskIds.length > 0 ||
    Boolean(i.missionLabel) ||
    i.afterTaskIds.length > 0 ||
    i.afterItemIds.length > 0;

  // ① 오늘 규칙으로 재판정. 항목의 what 은 원문 문장 그대로 저장돼 있다
  //    (`evaluateUnit` 이 body 를 그대로 what 으로 쓴다).
  for (const i of open) {
    if (protectedItem(i)) continue;
    // 가장 관대한 표면으로 본다 — 여기서도 안 잡히면 어느 표면에서도 아니다.
    if (detectFollowUpPromises(i.what, "owner_report").length > 0) continue;
    prune.push({
      id: i.id,
      what: i.what,
      reason:
        "자동 포착 노이즈 — 오늘의 포착 규칙(목적어·조각 머리·숙고 동사 게이트)으로 " +
        "다시 판정하면 항목이 되지 못하는 문장이다. 근거 티켓도 붙지 않아 완료를 " +
        "판정할 방법이 없다.",
      ...(i.sourceTool ? { sourceTool: i.sourceTool } : {}),
      createdAt: i.createdAt,
    });
    pruned.add(i.id);
  }

  // ② 남은 것 중 같은 문장 중복 — 가장 오래된 하나만 남긴다.
  const survivors = open
    .filter((i) => !pruned.has(i.id) && !protectedItem(i))
    .sort((a, b) => a.createdAt - b.createdAt);
  const keys: Array<{ key: string; id: string }> = [];
  for (const i of survivors) {
    const key = normalizeForCompare(i.what);
    if (!key) continue;
    const first = keys.find((k) => isDuplicateWhat(k.key, key));
    if (first) {
      prune.push({
        id: i.id,
        what: i.what,
        reason: `자동 포착 중복 — 같은 약속이 ${first.id} 로 이미 열려 있다(그쪽을 남긴다).`,
        ...(i.sourceTool ? { sourceTool: i.sourceTool } : {}),
        createdAt: i.createdAt,
      });
      pruned.add(i.id);
      continue;
    }
    keys.push({ key, id: i.id });
  }

  return {
    prune,
    scannedOpen: open.length,
    kept: open.length - prune.length,
  };
}

/** 정리 결과를 오케가 읽을 목록으로. dry-run 과 실제 실행이 같은 문장을 쓴다. */
export function formatNoisePrunePlan(
  plan: NoisePrunePlan,
  applied: boolean,
): string {
  if (plan.prune.length === 0) {
    return (
      `자동 포착 노이즈 없음 — 열린 항목 ${plan.scannedOpen}개가 모두 ` +
      `오늘의 규칙을 통과하거나 보호 대상(사장님 지시 / 근거 티켓 있음)이다.`
    );
  }
  const lines = plan.prune.map(
    (e) =>
      `  · ${e.id} — "${e.what}"${e.sourceTool ? ` [${e.sourceTool}]` : ""}\n` +
      `      ${e.reason}`,
  );
  return (
    `${applied ? "정리 완료" : "정리 예정(dry-run — 아무것도 바꾸지 않았다)"}: ` +
    `열린 ${plan.scannedOpen}개 중 ${plan.prune.length}개를 close="dropped" 로 닫는다. ` +
    `보호돼 남는 항목 ${plan.kept}개(사장님 지시 source=owner · 수동 항목 · 근거 티켓이 붙은 항목).\n` +
    `${lines.join("\n")}`
  );
}
