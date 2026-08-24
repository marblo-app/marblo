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

interface SessionState {
  /** 화면이 마지막으로 말해 준 컴포저 증거. */
  obsKind: ComposerLineKind | null;
  obsAt: number;
  /** 그 증거 이후 흘러간 가시 출력 문자 수. 시한(위 상수)의 계량기. */
  charsSinceObs: number;
  /** 가시 문자가 들어갔고 그 뒤 CR 이 없었던 시각. 없으면 null. */
  inputAt: number | null;
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
  noteInput(sessionId: string, data: string): void {
    if (!data) return;
    const s = this.ensure(sessionId);
    // 화살표키·Esc·Ctrl-C 같은 제어 바이트는 컴포저에 글자를 넣지 않는다.
    // ANSI/제어를 벗겨 **가시 문자**가 남는지로 가른다.
    const visible = stripAnsi(data).replace(/[\r\n\t ]/g, "");
    if (visible.length > 0) s.inputAt = this.now();
    // CR/LF = 제출 시도. 위 주석("CR 을 쓰면 입력측 표시를 지운다")의 그 지점.
    if (data.includes("\r") || data.includes("\n")) s.inputAt = null;
    this.settle(sessionId, s);
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

  private stateOf(s: SessionState): ComposerState {
    // 낡은 관측은 "지금 화면" 이 아니다(위 OBSERVATION_STALE_CHARS 주석).
    const obsKind =
      s.charsSinceObs > OBSERVATION_STALE_CHARS ? null : s.obsKind;
    // ★화면이 그 입력 **이후**를 그렸으면 화면을 믿는다. 사람이 쳤다가 지운
    //   경우가 여기로 구제된다.
    if (s.inputAt !== null && (obsKind === null || s.obsAt < s.inputAt)) {
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
