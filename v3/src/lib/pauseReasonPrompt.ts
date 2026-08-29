/**
 * "왜 멈췄나" 단일 문항의 **판정부** — 언제 물을지, 무엇을 물을지, 무엇을 보낼지.
 *
 * 근거: `docs/wiki/30-investigations/sole-persistent-user-is-not-external.md`
 * (#1310) 처방 3. 요지는 하나다 — **떠나는 사람은 실패해서 떠나지 않는다.**
 * 173 task 를 하고 떠난 설치는 마지막 이틀 33/33 성공, `agent:crashed` 0,
 * `errorCategory` 전부 NULL, 마지막 이벤트가 정상 종료였다. task 에 도달한 설치
 * 7개 중 6개가 첫 시도에 성공했고 그중 3개는 1~2일 만에 사라졌다. 즉 **성공률·
 * 실패율·첫 성공 시간에는 이탈 신호가 없다.** BigQuery 를 더 봐도 나오지 않는다 —
 * 앱 안에 그 신호가 애초에 없기 때문이다. 그래서 직접 묻는다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★언제 묻나 — **7일 이상 앱을 안 열었다가 다시 연 순간**, 설치당 딱 1회.
 *
 * 후보가 셋이었다.
 *  · 프로젝트를 닫을 때 → 기각. 프로젝트를 닫는 것은 멈추는 것이 아니다. 정상
 *    작업 흐름에 질문을 끼우면 응답은 "그냥 닫았다" 로 수렴하고, 진짜 이탈자는
 *    프로젝트를 닫는 행동조차 하지 않는다(C 의 마지막 이벤트는 정상 종료였다).
 *  · 설치 후 N일 무활동 → 기각. **그 시점에 화면 앞에 사람이 없다.** 앱이 못 여는
 *    질문은 계측이 아니라 희망이다. 그 구간을 덮는 것은 메일 경로(커밋 87323489)
 *    이고, 이 파일은 앱이 실제로 도달할 수 있는 유일한 순간만 맡는다.
 *  · ★복귀 순간 → 채택. "당신은 멈췄었다" 가 **관측된 사실**이고, 사람이 화면
 *    앞에 있고, 기억이 아직 남아 있는 유일한 교집합이다.
 *
 * ★한계는 숨기지 않는다: 이 문항은 **돌아온 사람만** 잡는다. 영영 안 돌아온
 * 설치(E·F·G)는 앱으로 도달 불가이고, 그쪽은 메일 경로의 몫이다. 즉 여기서
 * 모이는 답은 이탈자 전수가 아니라 **일시정지자 표본**이다.
 *
 * ★임계 7일인 이유: 주말+며칠(≤4일)은 정상 리듬이라 그걸로 한 번뿐인 질문을
 * 태우면 "그냥 주말이었다" 만 남는다. 7일은 **근무 주 하나를 통째로 건너뛴** 것을
 * 뜻한다. 실측 D 의 9일 공백(08-04 → 08-13)이 이 창에 잡힌다.
 *
 * ★설치당 1회인 이유: 활성 설치가 한 자릿수다. 두 번째 질문의 한계정보는 0 에
 * 가깝고 성가심은 그대로다. 그래서 문면이 "다시 나오지 않습니다" 라고 약속하고,
 * 그 약속을 이 파일이 지킨다(답해도·닫아도 마커는 똑같이 찍힌다).
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★무엇을 묻나 — 고정 선택지 6칸 + 선택적 한 줄.
 *
 * 활성 설치가 한 자릿수라 **5명이 답해도 읽히는** 설계여야 한다. 자유서술 corpus
 * 는 5줄이면 통계가 아니라 일화이고, 자유서술만 두면 응답률이 먼저 죽는다. 6칸
 * tally 는 n=5 에서도 그냥 세어진다 — 각 칸이 0 또는 1 이어도 의미가 남는다.
 *
 * 칸을 이렇게 고른 기준은 "**우리가 다르게 할 행동**이 갈리는가" 하나다:
 *   no_need        → 제품 문제가 아니다. 수요 타이밍. (아무것도 고치지 않는다)
 *   other_tool     → 대체재에 졌다. 가장 전략적인 신호.
 *   setup_friction → 온보딩/연결. 이미 계측이 두꺼운 구간.
 *   output_quality → 결과물 품질.
 *   cost           → 가격.
 *   other          → 위 다섯으로 안 갈리는 것. 한 줄 메모가 붙을 자리.
 *
 * ★순서에 no_need 를 맨 앞에 둔 것은 의도다. 제품 탓 선택지를 위에 깔면 "뭐가
 * 문제였냐" 고 유도하는 문항이 된다. 가장 흔하고 가장 무해한 답을 먼저 보여줘야
 * 사람이 자기 사실을 고른다.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * ★무엇을 보내나 — 선택지 코드는 텔레메트리, 산문은 절대 텔레메트리로 안 간다.
 *
 * `lib/telemetry/scrub.ts` 의 USER_INPUT_KEY 는 "free-form notes" 를 **스펙상
 * 전면 차단**한다(부분 스크럽은 자연어에서 신뢰할 수 없다는 이유). 그래서
 * FirstProjectSurvey 와 같은 분업을 그대로 쓴다 — 산문은 전용 callable
 * (`submitPauseReason`), 텔레메트리는 코드와 **길이**만.
 *
 * 그리고 텔레메트리가 꺼져 있으면 아예 묻지 않는다. 답을 받을 수 없는데 묻는 건
 * 계측이 아니라 연극이고, 동의를 끈 사람에게 수집 창을 띄우는 건 그 자체로
 * 경계 침범이다.
 */
import type { MessageKey } from "../locales/ko";

export const PAUSE_REASON_STORAGE_KEYS = {
  /** 이 설치가 앱을 마지막으로 연 시각(ms). 공백 계산의 유일한 원천. */
  lastOpenedAt: "marblo:pauseReason:lastOpenedAt",
  /** 물어본 적 있는가. 답해도·닫아도 똑같이 찍힌다(설치당 1회 약속). */
  asked: "marblo:pauseReason:asked",
  /** 이번 실행에서 계산한 공백(일). sessionStorage 전용 — 재마운트 방어. */
  sessionGapDays: "marblo:pauseReason:sessionGapDays",
} as const;

/** 근무 주 하나를 통째로 건너뛴 폭. 위 헤더 "임계 7일인 이유" 참조. */
export const PAUSE_REASON_GAP_DAYS = 7;

/** 한 줄 메모의 상한. 문단을 받는 칸이 아니다. */
export const PAUSE_REASON_NOTE_MAX = 200;

const DAY_MS = 24 * 60 * 60 * 1000;

export const PAUSE_REASON_CODES = [
  "no_need",
  "other_tool",
  "setup_friction",
  "output_quality",
  "cost",
  "other",
] as const;

export type PauseReasonCode = (typeof PAUSE_REASON_CODES)[number];

export interface PauseReasonOption {
  code: PauseReasonCode;
  labelKey: MessageKey;
}

/**
 * 화면에 그려지는 순서 그대로. ★순서를 바꾸려면 위 헤더의 "no_need 를 맨 앞에"
 * 근거를 먼저 반박해야 한다 — 순서는 장식이 아니라 유도 여부를 가른다.
 */
export const PAUSE_REASON_OPTIONS: readonly PauseReasonOption[] = [
  { code: "no_need", labelKey: "retention.pauseReason.option.noNeed" },
  { code: "other_tool", labelKey: "retention.pauseReason.option.otherTool" },
  {
    code: "setup_friction",
    labelKey: "retention.pauseReason.option.setupFriction",
  },
  {
    code: "output_quality",
    labelKey: "retention.pauseReason.option.outputQuality",
  },
  { code: "cost", labelKey: "retention.pauseReason.option.cost" },
  { code: "other", labelKey: "retention.pauseReason.option.other" },
];

export type PauseReasonStorage = Pick<Storage, "getItem" | "setItem">;

function readInt(storage: PauseReasonStorage, key: string): number | null {
  const raw = storage.getItem(key);
  if (raw === null || raw === "") return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * 마지막 실행 시각 → 지금까지의 공백(일, 내림).
 *
 * null 을 돌려주는 경우가 둘이고 **둘 다 "묻지 않는다"** 로 간다:
 *  · 기록이 없다 = 이 설치의 첫 실행. 멈춘 적이 없으므로 물을 것이 없다.
 *  · 시계가 거꾸로 갔다(now < last) = 값이 거짓이다. 거짓 위에서 묻지 않는다.
 */
export function gapDaysSince(
  lastOpenedAt: number | null,
  nowMs: number,
): number | null {
  if (lastOpenedAt === null) return null;
  const delta = nowMs - lastOpenedAt;
  if (!Number.isFinite(delta) || delta < 0) return null;
  return Math.floor(delta / DAY_MS);
}

/**
 * 이번 실행의 공백을 확정하고 "마지막 실행 시각"을 지금으로 갱신한다.
 *
 * ★한 실행에서 두 번 불려도 같은 값을 돌려준다(sessionStorage 캐시). 셸 전환·
 * StrictMode 이중 마운트로 이 함수가 재호출되면, 캐시가 없을 때는 방금 자기가
 * 쓴 시각을 읽어 공백이 0 으로 뭉개진다 — 그 순간 질문은 영원히 안 뜬다.
 */
export function resolveOpenGapDays(
  local: PauseReasonStorage | null,
  session: PauseReasonStorage | null,
  nowMs: number,
): number | null {
  if (!local) return null;

  const cached = session?.getItem(PAUSE_REASON_STORAGE_KEYS.sessionGapDays);
  if (cached !== null && cached !== undefined) {
    if (cached === "") return null;
    const parsed = Number.parseInt(cached, 10);
    return Number.isFinite(parsed) ? parsed : null;
  }

  const gap = gapDaysSince(
    readInt(local, PAUSE_REASON_STORAGE_KEYS.lastOpenedAt),
    nowMs,
  );
  local.setItem(PAUSE_REASON_STORAGE_KEYS.lastOpenedAt, String(nowMs));
  session?.setItem(
    PAUSE_REASON_STORAGE_KEYS.sessionGapDays,
    gap === null ? "" : String(gap),
  );
  return gap;
}

export function hasAskedPauseReason(
  storage: PauseReasonStorage | null,
): boolean {
  return storage?.getItem(PAUSE_REASON_STORAGE_KEYS.asked) === "1";
}

/** 답해도, 닫아도, 똑같이 찍는다 — "다시 나오지 않습니다" 는 답한 사람만의 약속이 아니다. */
export function markPauseReasonAsked(storage: PauseReasonStorage | null): void {
  storage?.setItem(PAUSE_REASON_STORAGE_KEYS.asked, "1");
}

/**
 * 노출 판정 — **이 함수 하나가 전부다.** 컴포넌트에 조건을 흩지 않는다.
 */
export function shouldAskPauseReason(args: {
  gapDays: number | null;
  alreadyAsked: boolean;
  telemetryEnabled: boolean;
  /** 다른 모달이 이미 화면을 차지하고 있다. */
  blocked?: boolean;
  thresholdDays?: number;
}): boolean {
  const threshold = args.thresholdDays ?? PAUSE_REASON_GAP_DAYS;
  // 동의가 꺼져 있으면 묻지 않는다 — 답을 못 받는 질문은 계측이 아니다.
  if (!args.telemetryEnabled) return false;
  if (args.alreadyAsked) return false;
  if (args.blocked) return false;
  if (args.gapDays === null) return false;
  return args.gapDays >= threshold;
}

export function isPauseReasonCode(value: unknown): value is PauseReasonCode {
  return (
    typeof value === "string" &&
    (PAUSE_REASON_CODES as readonly string[]).includes(value)
  );
}

/**
 * 한 줄 메모 정리 — 공백 정규화 + 상한 절단.
 *
 * ★여기서 스크럽하지 않는다. 이 값은 텔레메트리로 가지 않고 전용 callable 로만
 * 가며, 시크릿 레닥션은 서버가 저장 직전에 한 번 한다(submitBugReport 와 같은
 * 규율 — 클라의 선의를 신뢰 경계로 쓰지 않는다).
 */
export function sanitizePauseNote(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, PAUSE_REASON_NOTE_MAX);
}
