/**
 * "안 될 때" 의 어휘 — 렌더러 로드 상태 7종.
 *
 * 정본: `docs/design-tokens-and-failure-vocabulary-2026-08-22.md` §3.
 *
 * 왜 이게 필요한가: 로딩 40개 중 28개가 실패 상태를 안 그리고, 리스트 114개 중
 * 43개가 빈 상태를 안 그린다. 티켓 목록을 못 불러오면 화면은 **빈 보드**를 그린다 —
 * "0개" 와 "못 불러왔다" 가 화면에서 구분되지 않는다. 백엔드(`functions/src/
 * teamUsage.ts`)는 이미 `disabled / not_provisioned / empty / partial / complete`
 * 다섯 상태를 타입으로 갈라 놓았는데, 렌더러에 그 대응물이 없었다. 이 파일이 그
 * 대응물이다 — 새 어휘를 발명하지 않고 그 계약을 화면 쪽으로 승격한다.
 *
 * ★설계의 핵심 — **다음 행동이 없는 상태는 타입이 거부한다.**
 *   - `failed`    : `retry` 가 필수. 재시도 함수를 못 넘기면 그건 실패 화면이 아니라
 *                   설계 미완이다(정본 §3-3 규칙 4).
 *   - `denied`    : `askWhom` 이 필수. "권한이 없다" 만 말하고 **누구에게** 요청하는지
 *                   없으면 사용자는 갈 데가 없다.
 *   - `empty`     : `hint`(만드는 법 한 문장) + `create`(primary 행동 하나) 필수.
 *   - `not_ready` : `availableWhen`(언제 생기나) 또는 `enable`(켜는 법) 중 하나 필수.
 *   - `partial`   : `showMore` 필수.
 *   - `loading`   : 골격이 곧 행동이다 — 높이는 `StateBlock`/`Skeleton` 이 받는다.
 *                   5초 초과 시 "계속 시도 중" 과 함께 `cancel` 을 보여줄 수 있다.
 *   이 규칙을 문서로 부탁하지 않고 `tsc` 가 막게 만든다. 증거:
 *   `tests/unit/load-state-typecheck.test.ts` (행동 없이 구성 → 컴파일 에러).
 *
 * ★`reasonCode` 는 **i18n 키**다(`MessageKey`). `err.message` 원문은 이 자리에 올 수
 *   없고(타입이 거부), 오직 `detail` 에만 들어가 **접힌 "상세"** 안에서만 보인다.
 *
 * 백엔드 5상태 ↔ 렌더러 매핑(정본 §3-2): `complete`→ready · 합 0→empty(★이때만 0을
 * 그린다) · `partial`→partial · `not_provisioned`→not_ready · `disabled`→denied(권한)
 * 또는 not_ready(배선) · 전송/파싱 실패→failed.
 *
 * 스토어 계약(정본 §3-3): 새 스토어는 `loading: boolean` 대신 `state: LoadState`
 * 하나만 가진다. `catch` 는 반드시 `kind` 를 세팅한다. 이 PR 은 어휘만 만들고 기존
 * 스토어/화면을 바꾸지 않는다 — 치환은 3/8 부터다.
 */
import type { MessageKey } from "../../locales/ko";

/**
 * 화면에 보일 문장 — 반드시 로케일 키다. 변수가 필요하면 `{ key, vars }`.
 * 원문 문자열(`string`)을 받지 않는 것이 의도다: 여기로 `err.message` 가 새지 않는다.
 */
export type LocalizedText =
  | MessageKey
  | { key: MessageKey; vars?: Record<string, string | number> };

/** 다음 행동 하나 — 라벨은 로케일 키, 클릭은 함수. */
export interface StateAction {
  label: LocalizedText;
  onClick: () => void;
}

export interface LoadingState {
  kind: "loading";
  /** 시작 시각(epoch ms). 주면 리마운트에도 "5초 초과" 판정이 이어진다. */
  since?: number;
  /** 5초가 넘으면 "계속 시도 중…" 옆에 취소 버튼으로 노출된다. */
  cancel?: () => void;
}

export interface ReadyState {
  kind: "ready";
}

export interface EmptyState {
  kind: "empty";
  /** "아직 ○○가 없습니다" — 기본값은 `common.state.empty.title`. */
  title?: LocalizedText;
  /** ★만드는 법 한 문장. 없으면 예쁜 빈 화면일 뿐이다. */
  hint: LocalizedText;
  /** ★primary 행동 하나 — 첫 항목 만들기. */
  create: StateAction;
}

export interface FailedState {
  kind: "failed";
  /** "○○를 불러오지 못했습니다" — 기본값은 `common.state.failed.title`. */
  title?: LocalizedText;
  /** ★사유 한 문장 — i18n 키. `err.message` 는 타입이 거부한다. */
  reasonCode: MessageKey;
  /** 원문 오류(있으면). 본문에 쓰지 않고 접힌 "상세" 에만 들어간다. */
  detail?: string;
  /** ★다시 시도 — 선택이 아니다. */
  retry: () => void;
  /** 실패 유형에 맞는 다음 행동 라벨. 없으면 공통 "다시 시도"를 쓴다. */
  action?: StateAction;
}

export interface DeniedState {
  kind: "denied";
  /** 기본값: "권한이 없어 읽지 못했습니다 — 0 이 아니라 알 수 없음입니다". */
  title?: LocalizedText;
  reasonCode: MessageKey;
  /** ★누구에게 요청하는지 — 오너 이름/역할. 화면이 "{whom}에게 요청하세요" 로 그린다. */
  askWhom: string;
  /** 요청 버튼이 가능하면(메시지 보내기 등) 여기에. 없으면 이름만 보여준다. */
  onAsk?: () => void;
}

interface NotReadyBase {
  kind: "not_ready";
  /** 수치 자리에 들어갈 상태 라벨 — 기본값 "아직 수집되지 않음". */
  label?: LocalizedText;
  reasonCode: MessageKey;
}

/** ★`availableWhen`(언제 생기나) 또는 `enable`(켜는 법) 중 하나는 있어야 한다. */
export type NotReadyState = NotReadyBase &
  (
    | { availableWhen: LocalizedText; enable?: StateAction }
    | { availableWhen?: LocalizedText; enable: StateAction }
  );

export interface PartialState {
  kind: "partial";
  shown: number;
  total: number;
  /** ★더 보기 / 범위 넓히기. */
  showMore: () => void;
}

export type LoadState =
  | LoadingState
  | ReadyState
  | EmptyState
  | FailedState
  | DeniedState
  | NotReadyState
  | PartialState;

export type LoadStateKind = LoadState["kind"];

/** 데이터를 그려도 되는 상태 — `ready` 와 `partial`(있는 만큼은 그린다). */
export function hasData(state: LoadState): state is ReadyState | PartialState {
  return state.kind === "ready" || state.kind === "partial";
}

/**
 * ★실패를 0 으로 그리면 안 되는 상태 — 숫자 자리에 숫자가 아니라 라벨이 들어간다.
 * `CostWidget.tsx:69` 의 `if (totalCost === 0) return null` 이 합친 두 세계를 가른다.
 */
export function isNumberless(
  state: LoadState,
): state is FailedState | DeniedState | NotReadyState {
  return (
    state.kind === "failed" ||
    state.kind === "denied" ||
    state.kind === "not_ready"
  );
}

/** 로딩이 "계속 시도 중" 으로 바뀌는 기준(ms). 정본 §3-2 상태 1. */
export const LOADING_STILL_TRYING_MS = 5000;
