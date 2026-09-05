/**
 * 컴포저 판정 — **주입 직전에 화면을 보고, 오염돼 있으면 쓰지 않는다.**
 * (티켓 RtyOMpOArfI7a5JNSzsg / #1160 의 S2·S5 후속)
 *
 * ── 무엇을 고치나 ────────────────────────────────────────────────────────
 * #1160 이 실측한 답 전달 유실 3경로 중 S3(제출 오판)만 고쳐졌다. 남은 둘은
 * 관측으로는 못 고친다 — **쓰기 전에 막아야** 한다:
 *
 *   S2  컴포저에 초안이 물려 있으면 답이 초안 **뒤에 이어붙어** 한 덩어리로
 *       제출된다. 실측 페이로드: `"아직 쓰는 중인 초안입니다[답변 도착] question_id=…"`.
 *       답 원문은 영영 도착하지 않는다.
 *   S5  확인 다이얼로그([y/n]) 앞이면 답의 **첫 글자가 선택으로 소비**되고
 *       나머지만 제출된다. 게다가 그 선택은 되돌릴 수 없다.
 *
 * ── ★왜 "비우고 쓴다" 가 아닌가 (기각안 B/C) ─────────────────────────────
 * 컴포저를 Ctrl-U 로 비우거나, CR 만 보내 남의 초안을 대신 제출하는 안은 기각됐다.
 * 근거는 취향이 아니라 우리 코드에 있다 — `pty-manager.ts` 의
 * `"Enter still not registered … message may be sitting unsubmitted in the composer"`.
 * 즉 **워커 컴포저에 초안이 남는 가장 흔한 출처가 우리 자신**(전달에 실패한 이전
 * 메시지)이다. 비우면 유실을 고치겠다고 유실을 하나 더 만든다. 대신 제출하는 것도
 * 안 된다 — 쓰다 만 텍스트를 작성자 의사 없이 발송하는 것이고, 오케 PTY 면
 * 사장님이 타이핑하시던 문장이 나간다.
 *
 * 그래서 채택안은 (D): **지우지 말고, 쓰기 전에 확인하고, 안 되면 안 쓴다.**
 *
 * ── 두 갈래 증거 ─────────────────────────────────────────────────────────
 * 한쪽만으로는 못 읽는다. 그래서 둘을 합친다.
 *
 *   출력측(화면) — `transcript-lines.classifyComposerRaw`. 부트 게이트가 쓰는
 *     바로 그 줄 분류기다(새로 만들지 않았다). 빈 프롬프트 화살표·자리표시자·
 *     내용이 든 프롬프트·확인 다이얼로그를 실측 바이트 기준으로 가른다.
 *   입력측(우리가 아는 것) — PTY 로 들어간 **가시 문자**. `PtyManager` 는 사람이
 *     터미널 탭에 친 키까지 전부 지나가므로, "글자가 들어갔고 그 뒤 CR 이 없다" 를
 *     안다. 화면을 못 읽는 하네스에서 유일한 증거다.
 *
 * 합치는 규칙은 하나다 — **화면이 그 입력 이후를 그렸으면 화면을 믿는다.**
 * (사람이 치다가 Esc/Ctrl-U 로 지운 경우가 여기로 구제된다.)
 *
 * ── ★CR 을 쓰면 입력측 표시를 지운다 (일부러) ────────────────────────────
 * "제출이 확인될 때만 지운다" 로 하면 평범한 셸 PTY(제출 신호가 영영 안 나오는)가
 * 첫 메시지 뒤로 영구히 `occupied` 로 굳는다. 제출 이후의 진실은 **화면**이
 * 말하게 두고(초안이 남았으면 `❯ 우리가 쓴 글` 이 계속 보인다), 입력측은 "쳤는데
 * 엔터를 안 눌렀다" 만 책임진다. 두 증거가 이렇게 겹치지 않아야 어느 쪽도 안 굳는다.
 *
 * ── 모르면 모른다고 한다 ─────────────────────────────────────────────────
 * 판단 근거가 없으면 `indeterminate` 다. 그때는 **지금처럼 쓰되** 전달을 확신하지
 * 않는다 — #1157·#1160 이 세운 3분기 규율 그대로. 모르는 하네스에 대고 "안전을
 * 위해" 전달을 멈추면 이 게이트가 유실의 새 원인이 된다.
 *
 * I/O·Electron 의존 없음 — `tests/unit/composer-gate.test.ts` 가 실측 PTY 녹화
 * (`tests/fixtures/pty`)를 그대로 먹여 검증한다.
 */
import { stripAnsi } from "./ansi";
import { classifyComposerRaw, type ComposerLineKind } from "./transcript-lines";

/** 주입 직전 컴포저의 상태. */
export type ComposerState =
  | "empty"
  | "occupied"
  | "awaiting-choice"
  | "indeterminate";

/** 쓰지 않기로 했을 때 발신자에게 돌려줄 **기계 판독** 사유. */
export type ComposerRefusal = "composer-occupied" | "awaiting-choice";

/**
 * ★컴포저가 점유된 **사유** (티켓 nMpBzIMJmkSFqrrZfSKz).
 *
 * `occupied` 는 "쓰면 안 된다" 만 말하고 **왜** 는 말하지 않았다. 그래서 안내문이
 * 하나뿐이었고, 그 하나가 전부 사람 탓이었다 — "터미널 입력창에 제출되지 않은
 * 글이 남아 있습니다. 그 줄을 제출하거나 지우면 풀립니다."
 *
 * 실측(2026-09-05, `~/.marblo/telegram-route-health.jsonl`)에서 그 안내가 틀렸다.
 * 09:03~09:07 동안 `verdict=held-inject-refused, hold={refusal:"pty-refused",
 * composer:"occupied"}` 로 heldMs 가 29s→209s 로 자랐고 attempts 는 10→65 였는데,
 * 사람은 키보드 앞에 없었고 오케가 턴을 돌고 있었다. 09:07:06 에 그대로 전달됐다
 * (유실 아님). 사장님은 **존재하지 않는 초안**을 찾으셨다.
 *
 * 사유는 서로 다른 행동을 요구한다:
 *
 *   human-draft       사람이 친 미제출 초안. 그 사람이 제출하거나 지워야 풀린다 —
 *                     ★우리는 지우지도 대신 제출하지도 않는다(그 규율은 이 타입이
 *                     생겨도 그대로다).
 *   orchestrator-busy 오케가 턴을 처리 중이라 우리 차례가 아직 안 왔다. **사람이
 *                     할 일이 없다.** 턴이 끝나면 저절로 풀린다.
 *   self-injected     ★우리가 쓴 글이 미제출로 컴포저에 남았다(자기교착).
 *                     `submitWithRetry` 가 CR 예산을 다 쓰고도 제출 신호를 못 보면
 *                     본문이 그대로 남고, 화면이 그것을 계속 그리므로 이후 모든
 *                     주입이 영구히 거부된다. **우리 글이니 우리가 치운다.**
 *   awaiting-choice   확인 다이얼로그 앞. 사람이 답해야 풀린다.
 *   unknown           ★못 가른다. 이때 사람 탓으로 단정하지 않는다 — 틀린 지목은
 *                     없는 초안을 찾게 만들고, 그것이 이 티켓의 원래 증상이다.
 */
export type OccupancyCause =
  | "human-draft"
  | "orchestrator-busy"
  | "self-injected"
  | "awaiting-choice"
  | "unknown";

/**
 * 우리가 마지막으로 이 세션에 쓴 글의 제출 결말 — `SubmitOutcome` 중
 * 자기교착 판정에 필요한 부분만 좁혀 받는다(pty-manager 를 import 하지 않기
 * 위해서다. 이 모듈은 I/O·Electron 의존이 없어야 한다).
 */
export type SelfWriteOutcome = "confirmed" | "unconfirmed" | "indeterminate";

/**
 * PTY 로 들어간 바이트가 **누구 것인가**.
 *
 *   human    사람이 터미널 탭에 친 키(`PtyManager.write`). 남의 초안이다 —
 *            지우지도 대신 제출하지도 않는다.
 *   injected 우리가 넣은 본문/CR(`PtyManager.performWriteAndSubmit`). 우리 글이다.
 *
 * 기본값을 `human` 으로 둔 이유: 출처를 안 넘긴 호출부는 전부 사람 키 경로이고,
 * 무엇보다 **틀렸을 때 안전한 쪽**이 human 이다(우리 글로 잘못 부르면 남의 초안에
 * 손을 대게 된다).
 */
export type InputOrigin = "human" | "injected";

/**
 * 점유 사유를 가르는 데 실제로 쓰는 **관측 사실**. 하나하나가 코드 어딘가에서
 * 실측으로 나오는 값이고, 추측은 들어 있지 않다.
 */
export interface OccupancyEvidence {
  /** 지금 판정. `occupied`/`awaiting-choice` 가 아니면 사유는 없다. */
  state: ComposerState;
  /**
   * 마지막 busy 신호(스피너·`esc to interrupt`·토큰 카운터) 이후 경과 ms.
   * 신호를 한 번도 못 봤으면 null. `PtyManager.lastBusySignalAt` 에서 온다 —
   * `writeAndSubmit` 이 제출 확인에 쓰는 **바로 그** 신호다(중복 정의 없음).
   */
  msSinceBusySignal: number | null;
  /**
   * 사람이 터미널 탭에 친 가시 문자가 들어갔고 그 뒤 CR 이 없었던 시각.
   * 없으면 null. 입력측 증거라 낡지 않는다.
   */
  humanDraftSince: number | null;
  /** 우리가 마지막으로 본문을 써 넣은 시각. 없으면 null. */
  selfWriteAt: number | null;
  /** 그 write 의 제출 결말. 아직 안 끝났거나 없으면 null. */
  selfWriteOutcome: SelfWriteOutcome | null;
  /** 그 write 이후 사람이 이 세션에 가시 문자를 넣었는가. */
  humanInputSinceSelfWrite: boolean;
  now: number;
}

/**
 * ★busy 신호가 이만큼 안에 있었으면 "오케가 턴을 돌고 있다" 로 본다.
 *
 * 근거는 이 저장소가 이미 정한 값이다 — 텔레그램 폴러의 미응답 넛지가 쓰는
 * 조용한 창(`DEFAULT_NUDGE_IDLE_DEBOUNCE_MS = 6000`)이 "이 정도 조용하면 턴이
 * 끝난 것" 의 정본이다. 같은 축에 두 개의 다른 답을 두지 않는다. 클로드/코덱스는
 * 작업 중 매 프레임 스피너를 다시 그리므로 실사용에서 이 창은 넉넉하다.
 */
const BUSY_RECENCY_MS = 6_000;

/**
 * ★우리가 쓴 글로 귀속할 수 있는 시한.
 *
 * 시한이 없으면 몇 시간 뒤 사람이 새로 친 초안까지 "우리 글" 로 오인하고, 그건
 * 남의 초안에 손대지 않는 규율을 깨는 정확히 그 사고다. 오케 턴은 길어야 수분
 * 단위이므로(실측 최장 보류 ~4분) 그 한참 바깥인 15분으로 잡는다 — 자기교착을
 * 놓치기보다 남의 초안을 건드리는 쪽이 훨씬 비싼 실수다.
 */
const SELF_WRITE_ATTRIBUTION_MS = 15 * 60_000;

/**
 * 사유 판정. **순서가 곧 근거의 강도**다 — 입력측 실측(사람이 친 키)이 가장
 * 세고, 화면만 남은 경우가 가장 약하다.
 */
export function classifyOccupancy(
  ev: OccupancyEvidence,
): OccupancyCause | null {
  if (ev.state === "awaiting-choice") return "awaiting-choice";
  if (ev.state !== "occupied") return null;

  // (1) 사람이 친 가시 문자가 들어갔고 그 뒤 CR 이 없다 — 우리가 아는 가장 강한
  //     증거이고, 유일하게 "누가 썼는지" 를 직접 말해 준다.
  if (ev.humanDraftSince !== null) return "human-draft";

  // (2) 오케가 턴을 돌고 있다. 이때 컴포저에 남은 글은 **차례를 기다리는** 글이지
  //     방치된 글이 아니다 — 턴이 끝나면 소비된다. 그러니 치우려 들어도 안 되고
  //     (큐에 든 메시지를 지우는 셈이다) 사람에게 시킬 일도 없다.
  //     ★self-injected 보다 먼저 본다: 둘 다 우리 글일 수 있지만, 오케가 도는
  //     동안은 자기교착이 아니라 정상 대기다.
  if (
    ev.msSinceBusySignal !== null &&
    ev.msSinceBusySignal <= BUSY_RECENCY_MS
  ) {
    return "orchestrator-busy";
  }

  // (3) 오케는 조용한데 우리가 쓴 글이 미제출로 남아 있다 = 자기교착.
  //     `unconfirmed` 로 한정한다 — `confirmed` 는 제출됐다는 양성 증거이고,
  //     `indeterminate` 는 우리 CR 의 반응인지 남의 턴인지 모른다는 뜻이라
  //     둘 다 "우리 글이 남았다" 의 근거가 못 된다(모르면 건드리지 않는다).
  if (
    ev.selfWriteAt !== null &&
    ev.selfWriteOutcome === "unconfirmed" &&
    !ev.humanInputSinceSelfWrite &&
    ev.now - ev.selfWriteAt <= SELF_WRITE_ATTRIBUTION_MS
  ) {
    return "self-injected";
  }

  // (4) 화면에 글자가 보이는데 누구 글인지 말할 근거가 없다. ★사람 탓으로
  //     단정하지 않는다.
  return "unknown";
}

export interface ComposerVerdict {
  state: ComposerState;
  /**
   * 지금 써도 되는가. `empty` 와 `indeterminate` 가 true 다 —
   * 후자는 "모르니 종전대로 쓴다"(전달을 확신하진 않는다).
   */
  writable: boolean;
  /** writable 이면 null. */
  refusal: ComposerRefusal | null;
  /** 사람이 읽을 한 줄 근거(한국어). 오케에게 그대로 돌아간다. */
  reason: string;
}

/** 줄바꿈 없이 쌓이는 전면 TUI 리페인트 꼬리의 상한. 컴포저는 늘 끝에 있다. */
const PENDING_TAIL_MAX_CHARS = 4_096;

/**
 * ★화면 증거의 유효기간 — 이만큼의 **가시 출력**이 새 증거 없이 지나가면 그
 * 관측은 더 이상 "지금 화면" 이 아니다(→ `indeterminate`).
 *
 * 왜 필요한가: 우리는 마지막 양성 증거를 붙들고 있는데, TUI 는 화면을 통째로
 * 다시 그린다. 다이얼로그가 답해져 사라져도 그 자리에 **다른 증거가 곧바로
 * 오지 않을 수** 있고(코덱스는 바뀐 영역만 칠한다), 그러면 오래전 다이얼로그
 * 관측 하나가 그 세션에 대한 모든 전달을 영원히 막는다 — 유실을 고치겠다고
 * 유실을 만드는 바로 그 모양이다.
 *
 * 같은 문제를 `agent-input-wait.looksLikeFirstRunDialog` 는 호출부가 1024자
 * 롤링 창(`dialogBuffer`)을 넘겨 푼다 — "TUI 는 전체를 다시 그리므로 낡은
 * 다이얼로그는 짧은 창에서 저절로 밀려난다". 여기서도 같은 규율을 쓰되 창은
 * 화면 한 판(≈4K)으로 잡는다. 클로드는 매 프레임 컴포저까지 다시 그리므로
 * 실사용에선 증거가 계속 갱신되고, 이 시한은 "다른 화면으로 넘어갔다" 는
 * 경우에만 걸린다.
 *
 * ★입력측 증거(우리가 아는 미제출 키 입력)에는 시한이 없다 — 화면에서 온 것이
 * 아니라 낡을 수가 없다. 그래서 이 완화가 초안 보호를 약화시키지 않는다.
 */
const OBSERVATION_STALE_CHARS = 4_096;

/**
 * ★"지금 컴포저에 글자가 있다" 는 주장의 **실시간** 유효기간
 * (티켓 nMpBzIMJmkSFqrrZfSKz — 27분 494회 교착의 직접 원인).
 *
 * 위 `OBSERVATION_STALE_CHARS` 는 유효기간을 **흘러간 PTY 출력 문자 수**로
 * 잰다. 그 계량기에는 치명적인 사각이 하나 있다 — **관측 대상이 계량기를
 * 굴린다.** 오케가 조용하면 출력이 0이므로 `charsSinceObs` 가 영원히 늘지
 * 않고, 그러면 낡은 관측이 영원히 "지금 화면" 으로 남는다.
 *
 * 실측(`~/.marblo/telegram-route-health.jsonl`, 2026-09-05):
 *
 *   12:03:05  HELD upd=96862774 attempts=16   composer=occupied  idleSec=303
 *   12:15:05  HELD upd=96862774 attempts=237  composer=occupied  idleSec=1023
 *   12:28:05  HELD upd=96862774 attempts=476  composer=occupied  idleSec=1803
 *   12:29:05  HELD upd=96862774 attempts=494  composer=occupied  idleSec=0   ← 오케가 깨어남
 *   12:30:05  delivered=96862775
 *
 * `idleSec` 이 303→1803 으로 단조 증가했다 = 27분 내내 오케는 **완전히 조용**
 * 했다("오케가 바빠서 밀렸다" 가 아니다). 같은 구간 `submit.unconfirmed = 0`
 * 이라 우리가 남긴 미제출 글도 없었다. 사장님은 초안을 찾지 못하셨다. 그런데도
 * 494회가 전부 `composer-occupied` 로 거부됐고, **출력이 다시 흐른 바로 그
 * 표본에서** 풀렸다. 즉 막고 있던 것은 초안이 아니라 **낡은 관측 한 프레임**이다.
 *
 * 그리고 이 래치를 풀 수 있는 유일한 사건(새 출력)은, 막힌 그 메시지가 배달돼
 * 오케가 턴을 시작해야 생긴다. 지연이 아니라 **자기잠금**이다. 사장님이 보신
 * "마블로를 키니까 들어오네" 가 이 잠금의 증상이다 — 창을 켜면 TUI 가 화면을
 * 다시 그리고, 그 출력이 관측을 갱신해 잠금이 풀린다. 포커스가 전달을 좌우한
 * 것이 아니라 포커스가 **출력**을 만들어 준 것뿐이라, 원인을 고치면 같이 없어진다.
 *
 * 그래서 시계로도 잰다. 45초는 "그 사이 화면이 바뀌었을 수 있다" 의 하한이 아니라
 * **"이 값을 근거로 전달을 계속 막아도 되는 최대치"** 로 잡은 값이다 — 만료되면
 * `indeterminate` 로 떨어지고, 이 파일이 원래 선언한 3분기 규율("모르면 종전대로
 * 쓰되 전달을 확신하지 않는다")이 그대로 적용된다.
 *
 * ★무엇에 적용하고 무엇에 적용하지 않는가 (비대칭은 의도한 것이다):
 *
 *   적용함  화면이 말한 `text`("초안이 **있다**")와, 출처가 `injected` 인 입력측
 *           표시(우리 글). 둘 다 **존재 주장**이라 우리가 못 보는 사이 사라질 수
 *           있고, 틀렸을 때의 대가가 이 티켓의 27분 교착이다.
 *   적용 안 함  `empty`(부재 주장 — 낡아도 안전한 방향이다),
 *           `dialog`(틀리면 되돌릴 수 없는 선택이 소비된다 — #1160 S5),
 *           출처가 `human` 인 입력측 표시(남의 초안은 시간이 지난다고 사라지지
 *           않는다). 뒤의 둘은 대신 **무한히 조용할 수 없게** 폴러가 사유를 실어
 *           사장님께 알린다(telegram-poller 의 보류 통지).
 */
const OCCUPANCY_CLAIM_STALE_MS = 45_000;

interface SessionState {
  /** 화면이 마지막으로 말해 준 컴포저 증거. */
  obsKind: ComposerLineKind | null;
  obsAt: number;
  /** 그 증거 이후 흘러간 가시 출력 문자 수. 시한(위 상수)의 계량기. */
  charsSinceObs: number;
  /** 가시 문자가 들어갔고 그 뒤 CR 이 없었던 시각. 없으면 null. */
  inputAt: number | null;
  /**
   * ★그 `inputAt` 을 세운 입력이 **누구 것인가** (티켓 nMpBzIMJmkSFqrrZfSKz).
   * `PtyManager.write`(사람이 터미널 탭에 친 키)와 `performWriteAndSubmit`
   * (우리 주입)이 같은 `noteInput` 으로 들어오므로, 출처를 달아 두지 않으면
   * "남의 초안" 과 "우리 글" 이 구분되지 않는다 — 그게 이 티켓의 증상이다.
   */
  inputOrigin: InputOrigin | null;
  /** 우리가 마지막으로 본문을 써 넣은 시각. 없으면 null. */
  selfWriteAt: number | null;
  /** 그 write 의 제출 결말(`noteSelfWriteOutcome` 로 들어온다). */
  selfWriteOutcome: SelfWriteOutcome | null;
  /** 그 write 이후 사람이 가시 문자를 넣었는가. 넣었으면 더는 "우리 글" 이 아니다. */
  humanInputSinceSelfWrite: boolean;
  /** 마지막 `\n` 뒤의 원시 꼬리(한 줄이 여러 청크에 걸쳐 온다). */
  pendingRaw: string;
  /** 마지막으로 알린 writable — 전이(막힘→풀림)를 알아채는 데 쓴다. */
  lastWritable: boolean;
}

function freshSession(): SessionState {
  return {
    obsKind: null,
    obsAt: 0,
    charsSinceObs: 0,
    inputAt: null,
    inputOrigin: null,
    selfWriteAt: null,
    selfWriteOutcome: null,
    humanInputSinceSelfWrite: false,
    pendingRaw: "",
    lastWritable: true,
  };
}

const VERDICTS: Record<ComposerState, Omit<ComposerVerdict, "state">> = {
  empty: {
    writable: true,
    refusal: null,
    reason: "빈 프롬프트를 확인했다 — 그대로 쓴다",
  },
  indeterminate: {
    writable: true,
    refusal: null,
    reason:
      "컴포저 상태를 읽을 수 없는 하네스다 — 종전대로 쓰되 전달을 확신하지 않는다",
  },
  occupied: {
    writable: false,
    refusal: "composer-occupied",
    reason:
      "컴포저에 미제출 텍스트가 있다 — 뒤에 이어붙이면 한 덩어리로 제출돼 원문이 영영 도착하지 않는다. " +
      "지우지도 대신 제출하지도 않는다(남의 초안이다). 컴포저가 비면 자동으로 재시도한다",
  },
  "awaiting-choice": {
    writable: false,
    refusal: "awaiting-choice",
    reason:
      "확인 다이얼로그 앞이다 — 지금 쓰면 첫 글자가 선택으로 소비되고 그 선택은 되돌릴 수 없다. " +
      "다이얼로그가 닫히면 자동으로 재시도한다",
  },
};

export function verdictFor(state: ComposerState): ComposerVerdict {
  return { state, ...VERDICTS[state] };
}

export interface ComposerTrackerOptions {
  now?: () => number;
}

/** 점유 사유 판정에 필요한, 이 클래스 **밖**에서 오는 신호. */
export interface OccupancySignals {
  /** 마지막 busy 신호 이후 경과 ms. 신호를 본 적 없으면 null. */
  msSinceBusySignal: number | null;
}

/**
 * 세션별 컴포저 상태 추적기. `PtyManager` 가 출력·입력을 그대로 흘려 넣고,
 * 주입 직전에 `verdict()` 를 묻는다.
 */
export class ComposerTracker {
  private readonly now: () => number;
  private sessions: Map<string, SessionState> = new Map();
  private freeListeners: Array<(sessionId: string) => void> = [];

  constructor(opts: ComposerTrackerOptions = {}) {
    this.now = opts.now ?? (() => Date.now());
  }

  /**
   * 컴포저가 **막힘 → 풀림** 으로 바뀌는 순간을 알린다. 이것이 재시도 정책의
   * 심장이다 — 초안 작성자가 자기 손으로 제출하거나 다이얼로그를 닫으면, 그때
   * 보류해 둔 답이 자동으로 다시 나간다(폴링 없음).
   */
  onFree(listener: (sessionId: string) => void): () => void {
    this.freeListeners.push(listener);
    return () => {
      this.freeListeners = this.freeListeners.filter((l) => l !== listener);
    };
  }

  /** PTY 출력 청크 하나. */
  observe(sessionId: string, chunk: string): void {
    if (!chunk) return;
    const s = this.ensure(sessionId);
    // ★전면 TUI 의 리페인트에는 개행이 없다. 그래서 미완 꼬리도 **분류한다** —
    //   컴포저는 거의 항상 청크의 끝(개행 뒤가 아니라)에 그려진다. 꼬리는 다음
    //   청크에서 이어붙여 다시 보므로, 조각난 상태로 잘못 읽어도 곧 교정된다.
    const combined = s.pendingRaw + chunk;
    const parts = combined.split("\n");
    for (const part of parts) {
      // 줄 끝 CR 은 떼고 분류한다 — `normalizeLine` 의 "마지막 CR 뒤만 남긴다"
      // 규칙에 걸리면 줄 전체가 빈 줄이 된다(부트 게이트 feed 와 같은 처리).
      const kind = classifyComposerRaw(part.replace(/\r+$/, ""));
      if (kind !== null) {
        s.obsKind = kind;
        s.obsAt = this.now();
        s.charsSinceObs = 0;
        // ★반증은 본 순간에 **소비한다** (티켓 nMpBzIMJmkSFqrrZfSKz). 입력측
        //   표시가 살아 있는데 그 뒤 화면이 빈 프롬프트를 그렸다면 그 초안은
        //   없어진 것이다. 이걸 "obsAt >= inputAt" 비교로만 두면, 나중에 그
        //   관측이 낡아 null 이 되는 순간 `stateOf` 가 이미 반증된 표시를
        //   되살려 다시 occupied 로 굳힌다 — 유효기간이 반증을 잡아먹는 모양이다.
        if (kind === "empty" && s.inputAt !== null) {
          s.inputAt = null;
          s.inputOrigin = null;
        }
      }
    }
    // 증거 없이 지나간 가시 출력을 센다(ANSI·제어는 화면 글자가 아니다).
    if (s.obsKind !== null) {
      s.charsSinceObs += stripAnsi(chunk).replace(/\s+/g, "").length;
    }
    const tail = parts[parts.length - 1];
    s.pendingRaw =
      tail.length > PENDING_TAIL_MAX_CHARS
        ? tail.slice(tail.length - PENDING_TAIL_MAX_CHARS)
        : tail;
    this.settle(sessionId, s);
  }

  /**
   * PTY 로 들어간 바이트. 사람이 터미널 탭에 친 키, 우리가 붙여넣은 본문,
   * 제출 CR 이 전부 여기로 온다.
   */
  noteInput(
    sessionId: string,
    data: string,
    origin: InputOrigin = "human",
  ): void {
    if (!data) return;
    const s = this.ensure(sessionId);
    // 화살표키·Esc·Ctrl-C 같은 제어 바이트는 컴포저에 글자를 넣지 않는다.
    // ANSI/제어를 벗겨 **가시 문자**가 남는지로 가른다.
    const visible = stripAnsi(data).replace(/[\r\n\t ]/g, "");
    if (visible.length > 0) {
      s.inputAt = this.now();
      s.inputOrigin = origin;
      if (origin === "injected") {
        // 새 주입은 앞 주입의 결말을 무효화한다 — 지금 컴포저에 있을 수 있는
        // 글은 방금 쓴 이것이지 이전 것이 아니다.
        s.selfWriteAt = s.inputAt;
        s.selfWriteOutcome = null;
        s.humanInputSinceSelfWrite = false;
      } else if (s.selfWriteAt !== null) {
        // ★사람이 손을 댔으면 그 뒤의 컴포저 내용은 더 이상 "우리 글" 이 아니다.
        //   이 한 줄이 자기교착 복구가 남의 초안을 건드리지 않게 막는 잠금이다.
        s.humanInputSinceSelfWrite = true;
      }
    }
    // CR/LF = 제출 시도. 위 주석("CR 을 쓰면 입력측 표시를 지운다")의 그 지점.
    if (data.includes("\r") || data.includes("\n")) {
      s.inputAt = null;
      s.inputOrigin = null;
    }
    this.settle(sessionId, s);
  }

  /**
   * 우리가 방금 쓴 글의 제출 결말을 기록한다(`PtyManager` 가 `SubmitOutcome` 을
   * 확정한 직후 호출). 자기교착 판정이 `unconfirmed` 하나만 근거로 삼기 때문에
   * 이 값이 없으면 사유는 `unknown` 으로 남는다 — 모르면 모른다고 하는 쪽이다.
   */
  noteSelfWriteOutcome(sessionId: string, outcome: SelfWriteOutcome): void {
    const s = this.sessions.get(sessionId);
    if (!s || s.selfWriteAt === null) return;
    s.selfWriteOutcome = outcome;
  }

  /** 세션이 죽었다. */
  forget(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  /** 지금 이 세션에 써도 되는가. */
  verdict(sessionId: string): ComposerVerdict {
    const s = this.sessions.get(sessionId);
    if (!s) return verdictFor("indeterminate");
    return verdictFor(this.stateOf(s));
  }

  /** 판정만(테스트·진단용). */
  state(sessionId: string): ComposerState {
    return this.verdict(sessionId).state;
  }

  /**
   * ★점유의 **사유** (티켓 nMpBzIMJmkSFqrrZfSKz). 점유가 아니면 null.
   *
   * busy 신호는 이 클래스가 못 본다(출력 분류기는 컴포저 줄만 읽는다). 그래서
   * `PtyManager` 가 이미 굴리고 있는 `lastBusySignalAt` 을 인자로 받는다 —
   * 같은 신호를 여기서 다시 정의하면 정의가 둘로 갈라진다.
   */
  occupancy(
    sessionId: string,
    signals: OccupancySignals,
  ): OccupancyCause | null {
    const s = this.sessions.get(sessionId);
    if (!s) return classifyOccupancy(this.evidenceFor(null, signals));
    return classifyOccupancy(this.evidenceFor(s, signals));
  }

  /** 판정에 실제로 쓰인 근거를 그대로 돌려준다(로그·테스트가 이유를 인용한다). */
  occupancyEvidence(
    sessionId: string,
    signals: OccupancySignals,
  ): OccupancyEvidence {
    return this.evidenceFor(this.sessions.get(sessionId) ?? null, signals);
  }

  private evidenceFor(
    s: SessionState | null,
    signals: OccupancySignals,
  ): OccupancyEvidence {
    const now = this.now();
    if (!s) {
      return {
        state: "indeterminate",
        msSinceBusySignal: signals.msSinceBusySignal,
        humanDraftSince: null,
        selfWriteAt: null,
        selfWriteOutcome: null,
        humanInputSinceSelfWrite: false,
        now,
      };
    }
    return {
      state: this.stateOf(s),
      msSinceBusySignal: signals.msSinceBusySignal,
      humanDraftSince: this.humanDraftSince(s),
      selfWriteAt: s.selfWriteAt,
      selfWriteOutcome: s.selfWriteOutcome,
      humanInputSinceSelfWrite: s.humanInputSinceSelfWrite,
      now,
    };
  }

  /**
   * 사람이 친 가시 문자가 아직 미제출로 살아 있는가.
   *
   * `inputAt` 은 CR 로만 지워지므로, 사람이 Esc/Ctrl-U 로 지운 경우는 화면이
   * 말해 준다 — 그 입력 **이후**에 빈 컴포저가 그려졌으면 초안은 없다.
   * (`stateOf` 의 "화면이 그 입력 이후를 그렸으면 화면을 믿는다" 와 같은 규율.
   * 다만 여기서는 `text` 를 무효화 근거로 쓰지 않는다 — 사람이 친 글이 화면에
   * 그려진 것이야말로 초안이 있다는 뜻이기 때문이다.)
   */
  private humanDraftSince(s: SessionState): number | null {
    if (s.inputAt === null || s.inputOrigin !== "human") return null;
    const obsKind = this.liveObsKind(s);
    if (obsKind === "empty" && s.obsAt >= s.inputAt) return null;
    return s.inputAt;
  }

  /**
   * 아직 "지금 화면" 이라고 부를 수 있는 관측. 두 계량기를 **둘 다** 통과해야
   * 한다 — 흘러간 출력량(`OBSERVATION_STALE_CHARS`)과 흘러간 시간
   * (`OCCUPANCY_CLAIM_STALE_MS`). 앞의 것만 있으면 조용한 세션에서 영원히
   * 안 늙는다(위 상수 주석의 실측).
   *
   * 시계는 **존재 주장**(`text`)에만 건다. `empty` 는 부재 주장이라 낡아도
   * 안전한 방향이고, `dialog` 는 틀렸을 때 되돌릴 수 없는 선택이 소비된다.
   */
  private liveObsKind(s: SessionState): ComposerLineKind | null {
    if (s.obsKind === null) return null;
    if (s.charsSinceObs > OBSERVATION_STALE_CHARS) return null;
    if (
      s.obsKind === "text" &&
      this.now() - s.obsAt > OCCUPANCY_CLAIM_STALE_MS
    ) {
      return null;
    }
    return s.obsKind;
  }

  /**
   * 입력측 표시가 아직 점유의 근거가 되는가.
   *
   * ★출처로 갈린다(티켓 nMpBzIMJmkSFqrrZfSKz). `human` 은 남의 초안이라 시간이
   * 지난다고 사라지지 않으므로 만료시키지 않는다. `injected` 는 우리 글이고,
   * 그 글이 정말 남아 있으면 화면이 `text` 로 말해 준다 — 화면이 아무 말도
   * 안 하는데 우리 표시 하나로 전달을 무한정 막는 것이 이 티켓의 교착이다.
   */
  private inputClaimLive(s: SessionState): boolean {
    if (s.inputAt === null) return false;
    if (s.inputOrigin === "injected") {
      return this.now() - s.inputAt <= OCCUPANCY_CLAIM_STALE_MS;
    }
    return true;
  }

  private stateOf(s: SessionState): ComposerState {
    const obsKind = this.liveObsKind(s);
    // ★화면이 그 입력 **이후**를 그렸으면 화면을 믿는다. 사람이 쳤다가 지운
    //   경우가 여기로 구제된다.
    if (
      this.inputClaimLive(s) &&
      s.inputAt !== null &&
      (obsKind === null || s.obsAt < s.inputAt)
    ) {
      return "occupied";
    }
    if (obsKind === null) return "indeterminate";
    if (obsKind === "dialog") return "awaiting-choice";
    if (obsKind === "text") return "occupied";
    return "empty";
  }

  private ensure(sessionId: string): SessionState {
    let s = this.sessions.get(sessionId);
    if (!s) {
      s = freshSession();
      this.sessions.set(sessionId, s);
    }
    return s;
  }

  /** 막힘→풀림 전이면 구독자에게 알린다. */
  private settle(sessionId: string, s: SessionState): void {
    const writable = verdictFor(this.stateOf(s)).writable;
    const was = s.lastWritable;
    s.lastWritable = writable;
    if (writable && !was) {
      for (const l of this.freeListeners) {
        try {
          l(sessionId);
        } catch (err) {
          console.error(
            `[ComposerTracker] onFree listener threw for ${sessionId}: ${
              err instanceof Error ? err.message : String(err)
            }`,
          );
        }
      }
    }
  }
}
