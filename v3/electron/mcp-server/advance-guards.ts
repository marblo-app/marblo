/**
 * 미션 전진 신호의 **안전장치 층** (티켓 Sf8Id64jLeyDvWIS4cub).
 *
 * 설계 단일소스: `v3/docs/mission-advance-signal-design-2026-09-04.md` §7.
 *
 * ── 왜 전진 로직과 파일을 나눴나 ────────────────────────────────────────────
 * 사장님 지시가 "무한루프랑 비용폭주는 방지하도록 설계만 잘해주고 가자" 였고,
 * 순서는 **안전장치 먼저, 그 위에 전진 로직** 이다. 한도가 전진 로직의 뒤에
 * 붙은 옵션이면 언젠가 우회 경로가 생긴다 — 아래 층으로 깔아두면 전진 로직이
 * 이 층을 지나지 않고는 신호를 만들 수 없다(`mission-advance.ts` 가 이 모듈의
 * `evaluateAdvanceGuards` 를 통과해야만 SIGNAL_ADVANCE 에 도달한다).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase 를 import 하지 않는다(`implicit-mission.ts`·`merge-closeout.ts` 와
 * 같은 규율). 한도 판정·승인필요 분류가 전부 순수 함수라 라이브 보드 없이
 * 전수 고정된다(`tests/unit/mission-advance-guards.test.ts`).
 */

// ── 플래그: 기본값 OFF ──────────────────────────────────────────────────────

/** 자율 전진 신호를 켜는 환경변수. 정확히 `on` 일 때만 켜진다. */
export const ADVANCE_SIGNAL_ENV = "MISSION_ADVANCE_SIGNAL";

/**
 * 자율 전진 신호가 켜져 있는가. **기본값 OFF** — 미설정·오타·빈 값은 전부 off.
 *
 * `getMissionDriver()` 가 `"orchestrator"` 정확일치만 받는 것과 같은 규율이다.
 * 느슨하게 받으면(`"true"`, `"1"`, `"yes"` …) 어느 셸에 무엇이 남아 있는지에
 * 따라 자율 스폰이 의도치 않게 켜진다 — 비용이 나가는 스위치는 좁게 받는다.
 */
export function isAdvanceSignalEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return (env[ADVANCE_SIGNAL_ENV] ?? "").trim().toLowerCase() === "on";
}

/**
 * 부팅 한 줄 — **이 MCP 프로세스가 실제로 받은 값**으로 켜짐/꺼짐을 말한다
 * (티켓 zyHtb4bjBSUWpzQ46avD).
 *
 * 왜 필요한가: 이 플래그가 도달하지 못하던 동안에도 아무 소리가 나지 않았다.
 * 사장님이 셸에 넣든 v3/.env 에 넣든 "켰다"고 믿을 뿐 켜졌는지 확인할 방법이
 * 없었고, 그래서 안 켜졌다는 사실이 며칠을 갔다. 그 침묵을 없애는 게 이 줄의
 * 전부다 — 판정은 `isAdvanceSignalEnabled` 그대로 쓰고 여기서 다시 하지 않는다.
 *
 * ★원문을 그대로 보여준다. `"true"`·`"1"` 같은 오타가 왜 OFF 인지는 값을 봐야
 * 알 수 있다("설정했는데 왜 꺼져 있나"의 유일한 답이 이 문자열이다). 시크릿이
 * 아니라 on/off 스위치라 마스킹 대상이 아니다.
 */
export function formatAdvanceSignalBootLine(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env[ADVANCE_SIGNAL_ENV];
  const head = `[advance-signal] ${ADVANCE_SIGNAL_ENV}=${
    raw === undefined ? "(미설정)" : JSON.stringify(raw)
  }`;
  if (isAdvanceSignalEnabled(env)) {
    return `${head} → ON — 자율 전진 신호가 켜져 있다(한도는 advance-guards 가 건다).`;
  }
  return (
    `${head} → OFF — 자율 전진 신호는 꺼져 있다. ` +
    `켜려면 값이 정확히 "on" 이어야 하고(앞뒤 공백·대소문자만 허용), ` +
    `앱 프로세스 env 로 들어와야 한다(v3/.env 에 적었다면 앱 재시작 필요).`
  );
}

// ── 한도 ────────────────────────────────────────────────────────────────────

export interface AdvanceCaps {
  /**
   * 한 미션이 **사람 개입 없이** 연달아 밀 수 있는 신호 수. 사람 개입이
   * 관측되면 0으로 리셋된다. 넘으면 HALT.
   */
  maxConsecutiveSignals: number;
  /**
   * 한 미션에서 동시에 도는 티켓 수 상한. 오늘 실측으로 11기까지 갔지만 그건
   * 손으로 배치한 것이고, 자율이면 더 빨리 는다 — 그래서 자율 경로의 기본값은
   * 보수적이다. 도달해도 HALT 가 아니라 back-pressure(§7-2).
   */
  maxConcurrentInFlight: number;
  /**
   * 열린 티켓 수가 줄지 않은 채 연속으로 나간 신호의 상한. 넘으면 HALT.
   * 무한루프의 실제 모양이 이것이다(§7-3).
   */
  maxStagnantSignals: number;
}

/** 기본 한도. 사장님이 설계 문서를 보시고 조정하실 값이다(§11). */
export const DEFAULT_ADVANCE_CAPS: AdvanceCaps = {
  maxConsecutiveSignals: 5,
  maxConcurrentInFlight: 3,
  maxStagnantSignals: 2,
};

// ── 미션별 자율 진행 상태 (missions/{id}.advanceState) ──────────────────────

export interface AdvanceStateSnapshot {
  /** 사람 개입 이후 배달된 자율 신호 수. ★배달된 것만 센다(§7 배달 3분기). */
  consecutiveSignals: number;
  /** 열린 티켓 수가 안 줄어든 채 연속으로 나간 신호 수. */
  stagnantSignals: number;
  /** 직전 신호 시점의 열린 티켓 수. 미관측이면 undefined(첫 신호). */
  lastOpenCount?: number;
  /** 이미 신호를 낸 티켓 id — 같은 완료가 두 번 들어와도 신호는 한 번. */
  signaledTaskIds: readonly string[];
  /** HALT 된 사유. 있으면 사람이 풀어줄 때까지 자율 진행이 멈춘다. */
  haltReason?: string | null;
}

/** 아무것도 기록되지 않은 미션의 초기 상태. */
export function emptyAdvanceState(): AdvanceStateSnapshot {
  return { consecutiveSignals: 0, stagnantSignals: 0, signaledTaskIds: [] };
}

// ── 승인 필요 작업 분류 ─────────────────────────────────────────────────────

/**
 * 자율 스폰 금지 대상 표지 — 배포 · 메일 발송 · 결제 · 심사 기간 화면 변경.
 * 사장님이 직접 지목하신 네 갈래다.
 *
 * ★`merge-closeout.ts` 의 `detectFollowupSignals` 와 **스캔 면이 반대**다.
 * 저기서는 본문(description)을 거의 안 본다 — 계획 언어("실행 전 승인 필수")가
 * 거의 모든 티켓 본문에 있어 오탐하면 멀쩡한 티켓이 REVIEW 에 붙잡히기 때문이다.
 * 여기서는 **본문도 본다.** 방향이 반대이기 때문이다:
 *   - 저기서 오탐 = 티켓이 REVIEW 에 남는다 (가볍다)
 *   - 여기서 누락 = 승인 없이 배포를 자율 스폰한다 (무겁다)
 * 그래서 의심스러우면 승인 필요 쪽으로 붙인다.
 */
const APPROVAL_REQUIRED_MARKERS = [
  // 배포
  "배포",
  "deploy",
  "릴리스",
  "릴리즈",
  "release",
  "롤아웃",
  "rollout",
  "프로덕션 반영",
  "production 반영",
  // 메일 발송
  "메일 발송",
  "메일발송",
  "이메일 발송",
  "메일 전송",
  "뉴스레터",
  "send email",
  "send mail",
  "email blast",
  "발송",
  // 결제
  "결제",
  "payment",
  "billing",
  "청구",
  "환불",
  "refund",
  "구독 요금",
  "가격 변경",
  "pricing change",
  // 심사 기간 화면 변경
  "심사",
  "심사 기간",
  "app review",
  "스토어 심사",
  "review period",
  // 명시 옵트인
  "승인 필요",
  "승인필요",
  "사장님 승인",
  "requires approval",
  "needs approval",
] as const;

/**
 * 표지를 뒤집는 부정어. `"배포 없음"` / `"결제 아님"` / `"deploy: none"` 이
 * 승인 필요로 잡히면 멀쩡한 티켓이 영영 자율 경로에서 빠진다.
 */
const APPROVAL_NEGATIONS = [
  "없음",
  "없다",
  "없습니다",
  "없이",
  "아님",
  "아니다",
  "제외",
  "불필요",
  "none",
  "not required",
] as const;

/**
 * ★영어는 부정어가 표지 **앞**에 온다 — `"no deploy required"`. 한국어는 뒤에
 * 붙어서(`"배포 없음"`) 후행 창만으로 충분했지만, 영문 표지를 함께 받는 이상
 * 선행 창도 봐야 한다. 단어 경계를 강제해 `"know"`·`"nothing"` 같은 부분일치가
 * 표지를 죽이지 못하게 한다.
 */
const APPROVAL_LEADING_NEGATION = /(?:^|[^a-z])(?:no|not|without)\s+$/;

/** 표지 앞뒤 이 범위 안에 부정어가 오면 그 표지는 죽은 것으로 본다. */
const APPROVAL_NEGATION_WINDOW = 12;

/** 승인필요 분류가 읽는 면. 본문(description)까지 본다 — 위 주석의 이유. */
export interface ApprovalTextSources {
  title?: string | null;
  description?: string | null;
  comment?: string | null;
  notes?: readonly string[] | null;
}

function occurrences(haystack: string, needle: string): number[] {
  const hits: number[] = [];
  let from = 0;
  for (;;) {
    const i = haystack.indexOf(needle, from);
    if (i === -1) return hits;
    hits.push(i);
    from = i + needle.length;
  }
}

function negated(text: string, start: number, len: number): boolean {
  const tail = text.slice(start + len, start + len + APPROVAL_NEGATION_WINDOW);
  if (APPROVAL_NEGATIONS.some((n) => tail.includes(n))) return true;
  const head = text.slice(Math.max(0, start - APPROVAL_NEGATION_WINDOW), start);
  return APPROVAL_LEADING_NEGATION.test(head);
}

function scanApproval(text: string | null | undefined): string[] {
  if (!text) return [];
  const hay = text.toLowerCase();
  const found: string[] = [];
  for (const marker of APPROVAL_REQUIRED_MARKERS) {
    const hits = occurrences(hay, marker);
    if (hits.length === 0) continue;
    // 한 번이라도 부정되지 않은 등장이 있으면 살아 있는 표지로 본다 —
    // "배포 없음 … 결국 배포해야 함" 은 여전히 승인 필요다.
    if (hits.some((i) => !negated(hay, i, marker.length))) found.push(marker);
  }
  return found;
}

/**
 * 이 티켓이 사장님 승인을 필요로 하는가 — 잡힌 표지들을 돌려준다.
 * 비어 있지 않으면 **자율 스폰 대상에서 뺀다**(readyNow 에 안 들어간다).
 */
export function detectApprovalSignals(src: ApprovalTextSources): string[] {
  const notesText = (src.notes ?? []).join("\n");
  return [
    ...new Set([
      ...scanApproval(src.title),
      ...scanApproval(src.description),
      ...scanApproval(src.comment),
      ...scanApproval(notesText),
    ]),
  ];
}

/** 편의 술어 — 표지가 하나라도 잡히면 승인 필요. */
export function requiresOwnerApproval(src: ApprovalTextSources): boolean {
  return detectApprovalSignals(src).length > 0;
}

// ── 슬롯 back-pressure ──────────────────────────────────────────────────────

export interface SlotPressure {
  /** 포화면 readyNow 를 비운다(정보는 전달, 행동만 막는다). */
  saturated: boolean;
  inFlight: number;
  limit: number;
  reason?: string;
}

/**
 * 동시 슬롯 판정. ★HALT 가 아니다 — 티켓 하나가 끝나면 자연히 풀리므로 사람이
 * 풀어줘야 하는 정지로 만들면 안 된다. 신호는 그대로 나가되 "지금은 새로 뽑지
 * 마라"를 담는다.
 */
export function evaluateSlotPressure(
  inFlight: number,
  caps: AdvanceCaps = DEFAULT_ADVANCE_CAPS,
): SlotPressure {
  const limit = caps.maxConcurrentInFlight;
  if (inFlight < limit) return { saturated: false, inFlight, limit };
  return {
    saturated: true,
    inFlight,
    limit,
    reason: `슬롯 포화 (${inFlight}/${limit}) — 지금은 새로 뽑지 말고 진행 중인 것이 끝나기를 기다려라.`,
  };
}

// ── 한도 판정 ───────────────────────────────────────────────────────────────

export type GuardCode =
  | "ok"
  | "already-halted"
  | "owner-input-pending"
  | "consecutive-spawn-cap"
  | "no-progress";

export interface GuardDecision {
  /**
   * - `pass` — 전진 신호를 만들어도 된다
   * - `hold` — 이번만 보류(상태를 바꾸지 않는다). 다음 완료에 다시 평가된다
   * - `halt` — 사람이 풀어줄 때까지 자율 진행 정지. **사유가 기록된다**
   */
  outcome: "pass" | "hold" | "halt";
  code: GuardCode;
  /** 사람이 읽는 사유. halt/hold 면 반드시 비어 있지 않다(조용한 정지 금지). */
  reason: string;
  /**
   * 신호가 **배달되면** 저장할 stagnant 카운터. 진행이 있었으면 0으로 떨어진다.
   * halt/hold 일 때는 의미 없다(0).
   */
  nextStagnantSignals: number;
}

export interface GuardInput {
  state: AdvanceStateSnapshot;
  /** 이 미션의 현재 열린(비종료) 티켓 수 — 진행 없음 판정의 유일한 근거. */
  openCount: number;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  caps?: AdvanceCaps;
}

/**
 * 세 한도 + 사장님 입력 우선을 한 자리에서 판정한다(설계 §8 순서 그대로).
 *
 * ★판정 순서가 곧 우선순위다:
 *   1. 이미 HALT 면 그 사유를 그대로 유지한다(새 사유로 덮지 않는다 — 최초
 *      원인이 사후 진단의 근거다)
 *   2. 사장님 입력이 대기 중이면 자율 진행보다 **항상 우선**한다
 *   3. 연속 스폰 한도
 *   4. 진행 없음 한도
 */
export function evaluateAdvanceGuards(input: GuardInput): GuardDecision {
  const caps = input.caps ?? DEFAULT_ADVANCE_CAPS;
  const { state, openCount } = input;

  const halted = (state.haltReason ?? "").trim();
  if (halted) {
    return {
      outcome: "halt",
      code: "already-halted",
      reason: `자율 진행이 이미 정지 상태다 — ${halted}. 사람이 advanceState 를 풀어야 재개된다.`,
      nextStagnantSignals: 0,
    };
  }

  // ★사장님 입력이 오면 자율 진행보다 항상 우선한다. hold 이지 halt 가 아니다 —
  // 입력이 처리되면 아무도 풀어주지 않아도 다음 완료에서 자연히 재개된다.
  if (input.ownerInputPending) {
    return {
      outcome: "hold",
      code: "owner-input-pending",
      reason:
        "사장님 입력(미해결 질문 또는 미소비 인바운드)이 대기 중이라 자율 전진을 보류한다 — 사장님 지시가 자율 진행보다 우선한다.",
      nextStagnantSignals: 0,
    };
  }

  if (state.consecutiveSignals >= caps.maxConsecutiveSignals) {
    return {
      outcome: "halt",
      code: "consecutive-spawn-cap",
      reason:
        `연속 자율 스폰 한도 도달 (${state.consecutiveSignals}/${caps.maxConsecutiveSignals}) — ` +
        `사람 개입 없이 여기까지 밀었다. 사장님 확인 후 재개한다.`,
      nextStagnantSignals: 0,
    };
  }

  // 진행 없음: 열린 티켓 수가 **줄지 않았으면** 폭주 신호다. 티켓은 계속 닫히는데
  // (신호는 DONE 때만 나가므로) 열린 수가 안 주는 것은 오케가 형제를 집는 대신
  // 새 티켓을 더 만들고 있다는 뜻이다 — 그게 비용이 무한히 나가는 모양이다.
  const prev = state.lastOpenCount;
  const stagnant =
    prev !== undefined && openCount >= prev ? state.stagnantSignals + 1 : 0;
  if (stagnant > caps.maxStagnantSignals) {
    return {
      outcome: "halt",
      code: "no-progress",
      reason:
        `진행 없음 — 열린 티켓이 ${prev}건에서 ${openCount}건으로 줄지 않은 채 ` +
        `신호가 ${stagnant}회 연속 나갔다(한도 ${caps.maxStagnantSignals}). ` +
        `스폰만 반복되고 티켓이 안 닫히는 상태라 자율 진행을 정지한다.`,
      nextStagnantSignals: stagnant,
    };
  }

  return {
    outcome: "pass",
    code: "ok",
    reason: "",
    nextStagnantSignals: stagnant,
  };
}

/** 이 티켓의 완료로 이미 신호를 냈는가 — 같은 완료 재유입 방지(§6). */
export function alreadySignaled(
  state: AdvanceStateSnapshot,
  taskId: string,
): boolean {
  return state.signaledTaskIds.includes(taskId);
}

// ── ★토큰 잔여 게이트 (티켓 F2TAJlSgSP8Ag1qJNkp1) ───────────────────────────
//
// 사장님 지시: _"이 루프에서 우리 유세이지탭에 사용량 토큰 잔여량을 체크하면서
// 스폰을 진행하고"_.
//
// ── 왜 여기(advance-guards.ts)에 두나 ──────────────────────────────────────
// 이건 새 층이 아니라 **한도가 하나 더 생긴 것**이다. 한도가 두 파일에 흩어지면
// 어느 쪽이 진짜인지 아무도 모른다 — 그래서 연속 스폰·슬롯·진행없음과 같은
// 자리에 둔다. 한도를 찾는 사람이 열어야 할 파일은 여전히 이 하나다.
//
// ── ★잔여량을 어디서 읽는가 (설계 §4 게이트 1) ────────────────────────────
// **사용량 탭이 그리는 바로 그 실측**이다. 새 프로브도 새 합성도 만들지 않았다:
//
//        electron/account-usage.ts :: getAccountRateLimits()
//          ├─ IPC "usage:accountRateLimits"  → src/components/usage/UsagePage.tsx
//          └─ 브리지 GET /model-guidance     → harness-quota.ts :: harnessQuotaRows()
//                                            → quota.harnesses[].remainingPercent
//                                            → (이 게이트)
//
// `harness-quota.ts` 헤더가 그 불변식을 이미 명시한다: _"계정 프로브
// (account-usage.getAccountRateLimits) — Usage 탭이 화면에 그리는 그 실측이다.
// … 합성은 여기 한 번만 하고, dispatch 도 guidance 도 이 함수의 결과를 쓴다
// (읽는 셀 = 쓰는 셀)."_ 화면과 루프가 다른 숫자를 볼 수 있는 자리가 없다.
//
// 이 모듈은 순수하게 유지한다 — 프로브 호출·브리지 fetch 는 `tools.ts` 가 하고,
// 여기는 이미 읽어 온 행(row)만 판정한다.

/**
 * 한 하네스의 잔여 한 줄. `harness-quota.ts` 의 `HarnessQuotaRow` /
 * 브리지가 내려주는 `GuidanceQuotaRow` 중 **판정에 필요한 필드만** 받는다
 * (구조적 타이핑이라 양쪽 다 그대로 들어온다). 필드를 좁게 받는 이유는
 * 이 순수 모듈이 electron/ 쪽 타입에 의존하지 않게 하기 위해서다.
 */
export interface HarnessQuotaReading {
  harness: string;
  /** 100 − 사용률. **null 은 "모름"이지 "0% 잔여"가 아니다.** */
  remainingPercent: number | null;
  /** 이 수치가 어디서 왔나(account-probe / weekly-rollup / none). 사유 문장용. */
  source?: string | null;
}

export type TokenGateCode = "sufficient" | "insufficient" | "no-data";

export interface TokenGateVerdict {
  code: TokenGateCode;
  /** 스폰해도 되는가. `no-data` 도 true 다 — 아래 주석의 근거. */
  allowSpawn: boolean;
  /** 사람이 읽는 사유. 항상 비어 있지 않다(조용한 정지 금지). */
  reason: string;
  /** 판정에 쓴 예비선(%). 라우터가 near-limit 을 자르는 그 선과 같다. */
  reservePct: number;
  /** 잔여가 예비선을 넘는 하네스들 — 실제로 스폰할 수 있는 것. */
  headroom: HarnessQuotaReading[];
  /** 수치가 있는데 예비선 이하인 하네스들. */
  exhausted: HarnessQuotaReading[];
  /** 수치 자체가 없는 하네스들(모름). */
  unknown: HarnessQuotaReading[];
}

function fmtPct(v: number): string {
  return `${Math.round(v)}%`;
}

function describe(rows: readonly HarnessQuotaReading[]): string {
  return rows
    .map((r) =>
      r.remainingPercent === null
        ? `${r.harness} 잔여 조회불가`
        : `${r.harness} 잔여 ${fmtPct(r.remainingPercent)}`,
    )
    .join(", ");
}

/**
 * 스폰 전 토큰 잔여 판정.
 *
 * ★임계를 새로 만들지 않았다. `reservePct` 는 브리지가 `quota.reservePct` 로
 * 함께 내려주는 값이고(`MARBLO_QUOTA_RESERVE_PCT`, 기본 10), **자동선택이
 * near-limit 하네스를 후보에서 뺄 때 쓰는 바로 그 예비선**이다. 라우터가
 * "이제 이 하네스는 안 쓴다"고 판단하는 선과 우리가 "스폰하지 않는다"고
 * 판단하는 선이 갈라지면 그게 또 하나의 두 숫자다.
 *
 * ★`no-data`(전부 null)를 차단으로 읽지 않는 이유:
 *   ① `null` 은 "모름"이지 "0% 잔여"가 아니다 — `harness-quota.ts` 가 grok 키를
 *      아예 만들지 않는 것과 같은 규율이다. 모름을 소진으로 접으면 프로브가 없는
 *      기기에서 폐루프가 **영원히** 멈추고, 그건 #1412 가 고친 조용한 정지의 재발이다.
 *   ② 그래도 안전하다 — **사장님 승인 게이트가 무조건이기 때문이다.** 두 게이트가
 *      직렬이라 여기의 불확실성이 무단 스폰으로 이어질 수 없고, "토큰을 못 읽었다"는
 *      사실은 사장님께 나가는 질문에 그대로 적힌다.
 */
export function evaluateTokenBudgetGate(
  rows: readonly HarnessQuotaReading[],
  reservePct: number,
): TokenGateVerdict {
  const reserve =
    Number.isFinite(reservePct) && reservePct >= 0 && reservePct <= 100
      ? reservePct
      : 10;

  const known = rows.filter(
    (r) =>
      typeof r.remainingPercent === "number" &&
      Number.isFinite(r.remainingPercent),
  );
  const unknown = rows.filter(
    (r) =>
      !(
        typeof r.remainingPercent === "number" &&
        Number.isFinite(r.remainingPercent)
      ),
  );
  const headroom = known.filter((r) => (r.remainingPercent as number) > reserve);
  const exhausted = known.filter(
    (r) => (r.remainingPercent as number) <= reserve,
  );

  if (known.length === 0) {
    return {
      code: "no-data",
      allowSpawn: true,
      reason:
        `토큰 잔여를 조회하지 못했다(${rows.length > 0 ? describe(rows) : "조회 대상 없음"}). ` +
        `모름을 소진으로 접으면 폐루프가 영영 멈추므로 여기서 막지 않는다 — ` +
        `대신 사장님 승인 없이는 어차피 시작되지 않으므로 이 사실을 질문에 함께 싣는다.`,
      reservePct: reserve,
      headroom: [],
      exhausted: [],
      unknown,
    };
  }

  if (headroom.length === 0) {
    return {
      code: "insufficient",
      allowSpawn: false,
      reason:
        `토큰 잔여가 예비선(${fmtPct(reserve)}) 이하다 — ${describe(exhausted)}. ` +
        `자율 스폰을 진행하지 않는다.`,
      reservePct: reserve,
      headroom: [],
      exhausted,
      unknown,
    };
  }

  return {
    code: "sufficient",
    allowSpawn: true,
    reason:
      `토큰 잔여 확인 — ${describe(headroom)} (예비선 ${fmtPct(reserve)} 초과)` +
      (exhausted.length > 0 ? `. 소진: ${describe(exhausted)}` : ""),
    reservePct: reserve,
    headroom,
    exhausted,
    unknown,
  };
}
