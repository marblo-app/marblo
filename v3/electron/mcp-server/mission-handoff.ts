/**
 * 미션 계층의 **결정 코어** — 미션을 쪼개고, 미션에서 미션으로
 * (티켓 F2TAJlSgSP8Ag1qJNkp1).
 *
 * 설계 단일소스: `v3/docs/mission-layer-advance-design-2026-09-04.md`.
 * 선행(★대체가 아니라 연장): `v3/docs/mission-advance-signal-design-2026-09-04.md` (#1414).
 *
 * 사장님 설계 지시:
 * _"폐루프가 돌기 시작하면 오케브레인 미션을 하나씩 끝내면서 다음 미션으로 넘어가는
 * 형태로 가도록 체크할 수 있어? 다만 이 루프에서 우리 유세이지탭에 사용량 토큰
 * 잔여량을 체크하면서 스폰을 진행하고, 텔레로 다음 미션의 시작은 사용자에게
 * 물어보고 가능 형태로 설계하면 어떨까"_
 *
 * ── 계층 ───────────────────────────────────────────────────────────────────
 *   #1414 (`mission-advance.ts`)  = **미션 안에서** 태스크 완료 → 다음 태스크
 *   이 모듈                       = ① 미션을 태스크로 쪼개기  ② 미션 → 다음 미션
 *
 * ── 이 모듈이 하지 않는 것 ─────────────────────────────────────────────────
 *   • **티켓을 만들지 않는다.** 분해는 오케가 한다 — 기계가 사장님 지시를 임의로
 *     티켓으로 번역하면 그 번역이 틀렸을 때 아무도 모른다(설계 §2).
 *   • 미션 엔진을 새로 설계하지 않는다. 후크 하나와 게이트 둘을 더할 뿐이다.
 *   • **새 한도·새 임계·새 환경변수를 만들지 않는다.** 한도는 전부
 *     `advance-guards.ts` 것이고, 플래그는 #1414 와 **같은 하나**다(설계 §7).
 *
 * ── 순수 모듈 ──────────────────────────────────────────────────────────────
 * firebase 도 건드리지 않고, **환경변수를 단 한 줄도 읽지 않는다**. 플래그 판정은 호출자가
 * `isAdvanceSignalEnabled()` 로 해서 `enabled` 로 넘긴다 — #1414 의
 * `AdvanceInput.enabled` 와 똑같은 모양이고, 그래서 "이 계층만 따로 켜는"
 * 스위치가 존재할 자리가 없다.
 */
import {
  detectApprovalSignals,
  evaluateAdvanceGuards,
  evaluateTokenBudgetGate,
  type AdvanceCaps,
  type AdvanceStateSnapshot,
  type GuardCode,
  type HarnessQuotaReading,
  type TokenGateVerdict,
} from "./advance-guards.js";
import type {
  DerivedWorkChainItem,
  WorkChainItemState,
  WorkChainSource,
} from "./work-chain-core.js";

// ── 입력 모양 ───────────────────────────────────────────────────────────────

/**
 * 워크체인 항목의 판정용 모양. `deriveWorkChain()` 결과에서 필요한 것만 좁혀
 * 받는다 — 순수 판정이 파생 구조 전체에 묶이지 않게.
 */
export interface HandoffChainItem {
  id: string;
  what: string;
  why: string;
  note?: string | null;
  missionLabel?: string | null;
  /** `manual` | `auto` | `owner`. 없으면 구버전 항목 = manual. */
  source?: WorkChainSource | null;
  state: WorkChainItemState;
  /** 명시 taskIds ∪ 미션 소속. **비어 있으면 근거 티켓이 없다.** */
  evidenceTaskIds: readonly string[];
  /** 아직 안 끝난 선행 티켓/항목 — waiting 사유를 사람이 읽게. */
  pendingTaskIds?: readonly string[];
  pendingItemIds?: readonly string[];
}

/** `DerivedWorkChainItem` → 판정 입력. 어댑터를 한 곳에 둔다. */
export function toHandoffChainItem(
  d: DerivedWorkChainItem,
): HandoffChainItem {
  return {
    id: d.item.id,
    what: d.item.what,
    why: d.item.why,
    note: d.item.note ?? null,
    missionLabel: d.item.missionLabel ?? null,
    source: d.item.source ?? null,
    state: d.state,
    evidenceTaskIds: d.evidenceTaskIds,
    pendingTaskIds: d.pendingTaskIds,
    pendingItemIds: d.pendingItemIds,
  };
}

export interface HandoffInput {
  /** 방금 닫힌 미션. */
  closedMissionId: string;
  closedMissionLabel?: string | null;
  /** 그 미션의 마지막 티켓 — 사유 문장과 중복 판정의 근거. */
  finishedTaskId: string;
  /** 워크체인 전체(파생 상태 포함). 배열 순서가 곧 우선순위다. */
  chain: readonly HandoffChainItem[];
  /** 이 미션에 대해 **이미 사장님께 여쭀는가**. 중복 질문 금지. */
  alreadyAsked: boolean;
  /** #1414 의 미션 자율 진행 상태 — 같은 한도를 그대로 통과한다. */
  state: AdvanceStateSnapshot;
  /** 미해결 오너 질문 또는 미소비 오너 인바운드가 있는가. */
  ownerInputPending: boolean;
  /** 브리지가 내려준 하네스별 잔여(= 사용량 탭이 그리는 그 실측). */
  quota: readonly HarnessQuotaReading[];
  /** 브리지가 함께 내려준 예비선. 라우터가 near-limit 을 자르는 그 선. */
  reservePct: number;
  /** 잔여를 아예 못 읽었을 때의 사유(브리지 미가동 등). 있으면 질문에 싣는다. */
  quotaError?: string | null;
  /** ★플래그. #1414 와 **같은 하나**를 호출자가 판정해 넘긴다. */
  enabled: boolean;
  caps?: AdvanceCaps;
}

// ── 출력 모양 ───────────────────────────────────────────────────────────────

export type HandoffAction =
  /** 아무 일도 하지 않는다(정상). */
  | "NO_HANDOFF"
  /** #1414 한도에 걸렸다 — 자율 진행 정지, **사유를 남긴다**. */
  | "HALT"
  /** 이번만 보류(상태를 바꾸지 않는다). 다음 완료에 다시 평가된다. */
  | "HOLD"
  /** ★토큰이 부족하다 — **스폰하지 않고** 사장님께 사유를 알린다. */
  | "NOTIFY_OWNER"
  /** ★다음 미션 시작 여부를 사장님께 여쭙고 **거기서 멈춘다**. */
  | "ASK_OWNER";

export type HandoffCode =
  | "flag-off"
  | "already-asked"
  | "chain-exhausted"
  | "tokens-insufficient"
  | "handoff"
  | GuardCode;

/** 다음 미션 후보에게 필요한 첫 행동. */
export type HandoffNeed =
  /** 근거 티켓이 0건이다 — **먼저 태스크로 쪼개야** 아무나 집을 수 있다. */
  | "split"
  /** 티켓이 이미 있고 남아 있다 — 바로 dispatch 가능. */
  | "dispatch";

export interface HandoffCandidate {
  item: HandoffChainItem;
  need: HandoffNeed;
  /** 정렬 결과의 자리(1부터). 사장님이 순서를 예측할 수 있게 신호에 적는다. */
  rank: number;
  /** 이 자리에 온 이유 한 줄(정렬 키를 사람 말로). */
  rankReason: string;
}

export interface HandoffVerdict {
  action: HandoffAction;
  code: HandoffCode;
  /** 사람이 읽는 사유. HALT/HOLD/NOTIFY 면 반드시 비어 있지 않다. */
  reason: string;
  /** ★근거 티켓이 없는 사장님 지시 — 분해 대상(설계 §2). */
  splitTargets: HandoffCandidate[];
  /** 선택 순서대로 정렬된 다음 미션 후보. */
  candidates: HandoffCandidate[];
  /** 후보 1위. 없으면 null. */
  next: HandoffCandidate | null;
  /** 승인 필요 표지가 잡혀 자율 대상에서 뺀 항목. */
  needsOwnerApproval: HandoffChainItem[];
  /** 선행이 안 풀려 후보가 못 된 항목 — 조용히 빼지 않는다. */
  blocked: HandoffChainItem[];
  /** 토큰 게이트 판정. 게이트에 닿기 전이면 null. */
  tokenGate: TokenGateVerdict | null;
  /** 오케 PTY 로 보낼 본문. 보낼 것이 없으면 "". */
  orchestratorMessage: string;
  /**
   * ★사장님께 텔레그램으로 보낼 본문. **이 값은 로그·저널·activity·툴 응답
   * 어디에도 적지 않는다**(#1412 규약 + 이 티켓의 금지 사항). 호출자는 이것을
   * 브리지로 넘기기만 한다.
   */
  telegramMessage: string;
  /** HALT 일 때 미션 문서에 박을 사유. */
  haltReason?: string;
}

// ── ① 분해 대상 판정 ────────────────────────────────────────────────────────

/**
 * 이 항목이 **사장님이 직접 주신 지시**인가.
 *
 * `work-chain-core.ts` 가 `owner` 축을 따로 만든 이유는 표시가 아니라 **권한**
 * 이다 — 오케가 한 약속은 오케가 닫을 수 있지만 사장님 지시는 임의로 못 닫는다.
 * 같은 이유로 "사람이 없어도 반드시 굴러야 하는 것" 도 이 축뿐이다.
 * `manual`(오케가 손으로 적음)·`auto`(도구가 포착) 는 분해 대상이 아니다.
 */
export function isOwnerDirective(item: HandoffChainItem): boolean {
  return item.source === "owner";
}

/**
 * 근거 티켓이 하나도 안 붙었는가 — **아무도 못 집는 상태**.
 *
 * 판정 축을 새로 만들지 않았다. `evidenceTaskIds`(명시 taskIds ∪ 미션 라벨
 * 소속)는 `work-chain-core.ts` 가 완료 판정·진행률에 쓰는 **그 집합**이다.
 * 티켓이 이미 붙은 항목은 이 집합이 비지 않으므로 **자동으로 제외된다**
 * (지시: "이미 티켓이 붙은 항목은 건드리지 마라").
 */
export function lacksBackingTask(item: HandoffChainItem): boolean {
  return item.evidenceTaskIds.length === 0;
}

/**
 * 승인 필요 작업인가 — 배포·메일 발송·결제·심사 기간 화면 변경.
 * 판정은 #1414 의 `detectApprovalSignals` 를 그대로 쓴다(표지 + 부정어 창).
 * 스캔 면은 체인 항목이 가진 사람이 쓴 문장 전부다 — **의심스러우면 승인 필요
 * 쪽으로 붙인다**(여기서 누락의 대가가 크다).
 */
export function chainItemNeedsApproval(item: HandoffChainItem): boolean {
  return (
    detectApprovalSignals({
      title: item.what,
      description: item.why,
      comment: item.note ?? null,
    }).length > 0
  );
}

// ── ② 선택 순서 ─────────────────────────────────────────────────────────────

/**
 * ★선택 순서는 **명시적으로 두 키**다(설계 §3). 순서가 암시적이면 사장님이
 * 예측할 수 없다.
 *
 *   1. **사장님 지시 우선** — `source === "owner"` 가 앞
 *   2. **우선순위 = 체인 배열 순서** — `work-chain-core.ts` 가 이미
 *      _"배열 순서 = 우선순위"_ 로 정의했다. 새 우선순위 개념을 만들지 않는다.
 *
 * index 가 유일하므로 두 키가 **전순서**를 만든다 — 동률이 없고, 같은 입력이면
 * 항상 같은 답이다(테스트가 고정).
 */
function rankKey(item: HandoffChainItem, index: number): [number, number] {
  return [isOwnerDirective(item) ? 0 : 1, index];
}

function rankReasonFor(item: HandoffChainItem, rank: number): string {
  const first = isOwnerDirective(item)
    ? "사장님 지시(source=owner)라 우선"
    : "사장님 지시 항목 다음";
  return `${rank}순위 — ${first}, 그다음 체인 배열 순서(=우선순위)`;
}

function needOf(item: HandoffChainItem): HandoffNeed {
  return lacksBackingTask(item) ? "split" : "dispatch";
}

/**
 * 열린 체인에서 다음 미션 후보를 고른다.
 *
 * ★후보는 **`ready` 인 항목만**이다. `waiting`(선행 미충족)은 지금 시작할 수
 * 없으므로 고르면 고른 게 아니다. 다만 조용히 빼지 않는다 — `blocked` 로 함께
 * 돌려주고 신호에 사유와 함께 적는다.
 *
 * 승인 필요 항목도 후보에서 빠지고 `needsOwnerApproval` 로 따로 나간다 —
 * 배포/메일/결제/심사화면은 자율 대상이 아니다(#1414 와 같은 규율).
 */
export function selectHandoffCandidates(chain: readonly HandoffChainItem[]): {
  candidates: HandoffCandidate[];
  needsOwnerApproval: HandoffChainItem[];
  blocked: HandoffChainItem[];
} {
  const needsOwnerApproval: HandoffChainItem[] = [];
  const blocked: HandoffChainItem[] = [];
  const open: { item: HandoffChainItem; index: number }[] = [];

  chain.forEach((item, index) => {
    if (item.state === "done" || item.state === "dropped") return;
    if (chainItemNeedsApproval(item)) {
      needsOwnerApproval.push(item);
      return;
    }
    if (item.state !== "ready") {
      blocked.push(item);
      return;
    }
    open.push({ item, index });
  });

  const candidates = open
    .slice()
    .sort((a, b) => {
      const ka = rankKey(a.item, a.index);
      const kb = rankKey(b.item, b.index);
      return ka[0] - kb[0] || ka[1] - kb[1];
    })
    .map(({ item }, i) => ({
      item,
      need: needOf(item),
      rank: i + 1,
      rankReason: rankReasonFor(item, i + 1),
    }));

  return { candidates, needsOwnerApproval, blocked };
}

/**
 * ★분해 대상 — 근거 티켓이 안 붙은 사장님 지시.
 *
 * 후보와 **같은 집합에서** 뽑는다(= `ready` 이고 승인 필요가 아닌 것). 규칙을
 * 하나로 두는 이유: 루프가 손대는 대상은 항상 "지금 행동 가능한 것"이어야 하고,
 * 그래야 선행이 안 풀린 일을 앞당겨 끌어오는 경로가 생기지 않는다.
 */
export function selectSplitTargets(
  candidates: readonly HandoffCandidate[],
): HandoffCandidate[] {
  return candidates.filter(
    (c) => isOwnerDirective(c.item) && lacksBackingTask(c.item),
  );
}

// ── 신호 본문 ───────────────────────────────────────────────────────────────

/**
 * 항목 한 줄. ★id·what·why·라벨만 나간다 — PTY 원문도, 텔레그램 본문도,
 * 토큰도 넣지 않는다(#1412 규약, 이 티켓의 금지 사항).
 */
function itemLine(c: HandoffCandidate): string {
  const label = c.item.missionLabel ? ` [라벨: ${c.item.missionLabel}]` : "";
  const tickets =
    c.need === "split"
      ? " — ★근거 티켓 0건: 먼저 태스크로 쪼개라"
      : ` — 티켓 ${c.item.evidenceTaskIds.length}건 보유: 바로 dispatch 가능`;
  return `  ${c.rank}) [${c.item.id}] "${c.item.what}"${label}${tickets}\n     왜: ${c.item.why}`;
}

function blockedLine(item: HandoffChainItem): string {
  const waits = [
    ...(item.pendingTaskIds ?? []),
    ...(item.pendingItemIds ?? []),
  ].filter(Boolean);
  const why = waits.length > 0 ? ` ← 대기: ${waits.join(", ")}` : "";
  return `  - [${item.id}] "${item.what}"${why}`;
}

const STOP_LINE =
  "★사장님 승인 전에는 시작하지 마라 — 텔레그램으로 여쭤 두었다. 답을 받기 전 자율 스폰 금지.";

/**
 * 오케 PTY 본문. 오케가 **이 메시지만 읽고** 다음 행동(쪼개기 / 대기)을
 * 결정할 수 있어야 한다.
 *
 * `[Mission Handoff]` 접두사는 `shouldInjectOrchestratorNotification` 의 미분류
 * 기본값을 타므로 게이트를 고치지 않고도 오케 PTY 에 닿는다(#1414 와 동일 — 회귀 0).
 */
export function formatHandoffSignal(input: {
  closedMissionId: string;
  closedLabel: string;
  /** 이 미션을 닫은 마지막 티켓 — 어느 완료가 이 신호를 냈는지 추적 가능하게. */
  finishedTaskId: string;
  splitTargets: readonly HandoffCandidate[];
  candidates: readonly HandoffCandidate[];
  needsOwnerApproval: readonly HandoffChainItem[];
  blocked: readonly HandoffChainItem[];
  tokenNote: string;
  askedOwner: boolean;
}): string {
  const out: string[] = [
    `[Mission Handoff] 미션 '${input.closedLabel}' 완료 — 다음 미션 후보 ${input.candidates.length}건 ` +
      `(미션 ${input.closedMissionId}, 닫은 티켓 ${input.finishedTaskId})`,
    `선택 순서: ①사장님 지시(source=owner) 먼저 → ②체인 배열 순서(=우선순위)`,
  ];

  if (input.splitTargets.length > 0) {
    out.push(
      `✂ [Mission Split] 근거 티켓이 없는 사장님 지시 ${input.splitTargets.length}건 — 아무도 못 집는 상태다. 태스크로 쪼개고 티켓을 붙여라:`,
    );
    for (const c of input.splitTargets) out.push(itemLine(c));
    out.push(
      `  → create_task 로 쪼갠 뒤 add_work_chain_item / update_work_chain_item 의 task_ids 로 그 항목에 붙여라. 붙어야 완료가 보드 근거로 판정된다.`,
    );
  }

  if (input.candidates.length > 0) {
    out.push(`▶ 다음 미션 후보 (${input.candidates.length}) — 선택 순서대로:`);
    for (const c of input.candidates) out.push(itemLine(c));
  } else {
    out.push(`▶ 지금 시작할 수 있는 다음 미션 후보가 없다.`);
  }

  if (input.blocked.length > 0) {
    out.push(
      `⏸ 선행 미충족으로 후보에서 제외 (${input.blocked.length}) — 지금 시작할 수 없다:`,
    );
    for (const item of input.blocked) out.push(blockedLine(item));
  }
  if (input.needsOwnerApproval.length > 0) {
    out.push(
      `🔒 사장님 승인 필요 (${input.needsOwnerApproval.length}) — ★자율 대상 아님(배포·메일·결제·심사화면):`,
    );
    for (const item of input.needsOwnerApproval) out.push(blockedLine(item));
  }

  out.push(`토큰: ${input.tokenNote}`);
  out.push(
    input.askedOwner
      ? STOP_LINE
      : "★스폰하지 않았다. 사장님께 사유를 알렸다 — 답을 받기 전 자율 스폰 금지.",
  );
  return out.join("\n");
}

/**
 * ★사장님께 나가는 텔레그램 본문.
 *
 * 이 값은 **호출자가 브리지로 넘기기만 한다** — activity·저널·툴 응답 어디에도
 * 적히지 않는다(테스트로 고정). 담기는 것은 보드에 이미 공개된 사실뿐이고,
 * 토큰·chatId 는 이 문자열에 들어갈 자리가 없다.
 */
export function formatOwnerHandoffAsk(input: {
  closedLabel: string;
  next: HandoffCandidate;
  remaining: number;
  tokenNote: string;
}): string {
  const need =
    input.next.need === "split"
      ? "아직 티켓이 없어서, 시작하면 먼저 태스크로 쪼갭니다"
      : `티켓 ${input.next.item.evidenceTaskIds.length}건이 이미 붙어 있어 바로 진행합니다`;
  return [
    `[마블로] 미션 '${input.closedLabel}' 이 끝났습니다.`,
    ``,
    `다음 미션 후보 1순위: "${input.next.item.what}"`,
    `- 왜: ${input.next.item.why}`,
    `- 상태: ${need}`,
    `- 선택 이유: ${input.next.rankReason}`,
    `- 대기 중인 다른 후보: ${Math.max(0, input.remaining - 1)}건`,
    ``,
    `토큰 잔여: ${input.tokenNote}`,
    ``,
    `★시작할까요? 승인해 주시기 전까지는 아무것도 스폰하지 않고 여기서 멈춰 있습니다.`,
    `이 메시지에 답장해 주시면 오케에 전달됩니다 (예: "시작해" / "다음 것부터" / "멈춰").`,
  ].join("\n");
}

/** ★토큰이 부족해 시작하지 못했다는 **보고**(질문이 아니다). */
export function formatOwnerTokenBlock(input: {
  closedLabel: string;
  next: HandoffCandidate | null;
  reason: string;
}): string {
  return [
    `[마블로] 미션 '${input.closedLabel}' 이 끝났지만 다음 미션을 시작하지 못했습니다.`,
    ``,
    `사유: ${input.reason}`,
    input.next
      ? `대기 중인 다음 후보: "${input.next.item.what}"`
      : `대기 중인 다음 후보: 없음`,
    ``,
    `★스폰은 진행하지 않았습니다. 잔여가 회복되거나 사장님이 지시하시면 이어서 진행합니다.`,
  ].join("\n");
}

// ── 결정 코어 ───────────────────────────────────────────────────────────────

function empty(
  action: HandoffAction,
  code: HandoffCode,
  reason: string,
  extra?: Partial<HandoffVerdict>,
): HandoffVerdict {
  return {
    action,
    code,
    reason,
    splitTargets: [],
    candidates: [],
    next: null,
    needsOwnerApproval: [],
    blocked: [],
    tokenGate: null,
    orchestratorMessage: "",
    telegramMessage: "",
    ...extra,
  };
}

/**
 * 미션이 닫힌 직후의 전체 판정. 설계 §8 의 순서를 그대로 따른다 —
 * **게이트가 전진 판정보다 위에 있다.** 어느 경로로도 게이트를 지나지 않고
 * 다음 미션이 시작되지 않는다.
 */
export function evaluateMissionHandoff(input: HandoffInput): HandoffVerdict {
  // 0. ★플래그 — #1414 와 **같은 하나**. 꺼져 있으면 아무것도 읽지 않는다.
  if (!input.enabled) {
    return empty(
      "NO_HANDOFF",
      "flag-off",
      "자율 전진 신호가 꺼져 있다(기본값 OFF).",
    );
  }

  // 1. 중복 질문 금지 — 같은 미션 마감이 재유입돼도 사장님을 두 번 깨우지 않는다.
  if (input.alreadyAsked) {
    return empty(
      "NO_HANDOFF",
      "already-asked",
      `미션 ${input.closedMissionId} 의 다음 미션은 이미 사장님께 여쭀다 — 중복 질문을 보내지 않는다.`,
    );
  }

  // 2. ★#1414 안전장치를 그대로 통과한다. 새 한도를 만들지 않는다.
  //    미션이 닫혔으므로 열린 티켓은 0건이다.
  const guard = evaluateAdvanceGuards({
    state: input.state,
    openCount: 0,
    ownerInputPending: input.ownerInputPending,
    caps: input.caps,
  });
  if (guard.outcome === "halt") {
    return empty("HALT", guard.code, guard.reason, {
      haltReason: guard.reason,
      orchestratorMessage:
        `[Mission Handoff] ⏸ 미션 ${input.closedMissionId} 완료 후 다음 미션 전진 정지\n` +
        `사유: ${guard.reason}\n` +
        `사장님 확인 없이 재개하지 마라.`,
    });
  }
  if (guard.outcome === "hold") {
    // ★사장님이 이미 말씀 중이면 질문을 **또** 보내지 않는다. 상태를 바꾸지
    //   않으므로 그 입력이 처리되면 다음 완료에서 자연히 재개된다.
    return empty("HOLD", guard.code, guard.reason);
  }

  // 3. 후보 계산 — 선택 순서는 명시적 두 키(§3).
  const { candidates, needsOwnerApproval, blocked } = selectHandoffCandidates(
    input.chain,
  );
  const splitTargets = selectSplitTargets(candidates);
  const next = candidates[0] ?? null;
  const closedLabel =
    (input.closedMissionLabel ?? "").trim() || input.closedMissionId;

  if (!next) {
    // 체인이 비었다는 것도 사실이다 — 조용히 끝내지 않고 오케에 보고한다.
    return empty(
      "NO_HANDOFF",
      "chain-exhausted",
      `미션 '${closedLabel}' 이 닫혔고 지금 시작할 수 있는 다음 미션 후보가 없다` +
        (blocked.length > 0 ? ` (선행 대기 ${blocked.length}건)` : "") +
        (needsOwnerApproval.length > 0
          ? ` (승인 필요 ${needsOwnerApproval.length}건)`
          : "") +
        ".",
      {
        needsOwnerApproval,
        blocked,
        orchestratorMessage: formatHandoffSignal({
          closedMissionId: input.closedMissionId,
          closedLabel,
          finishedTaskId: input.finishedTaskId,
          splitTargets: [],
          candidates: [],
          needsOwnerApproval,
          blocked,
          tokenNote: "후보가 없어 확인하지 않음",
          askedOwner: false,
        }),
      },
    );
  }

  // 4. ★게이트 1 — 토큰 잔여. 여쭙기 **전에** 할 수 있는지 확인한다(§4).
  const tokenGate = evaluateTokenBudgetGate(input.quota, input.reservePct);
  const tokenNote = input.quotaError
    ? `${tokenGate.reason} (조회 오류: ${input.quotaError})`
    : tokenGate.reason;

  const common = {
    splitTargets,
    candidates,
    next,
    needsOwnerApproval,
    blocked,
    tokenGate,
  };

  if (!tokenGate.allowSpawn) {
    // ★스폰하지 않는다. 질문이 아니라 **보고**가 나간다 — 부족한 상태에서
    //   "시작할까요?" 를 여쭈면 사장님이 승인하셔도 스폰이 안 된다.
    return {
      action: "NOTIFY_OWNER",
      code: "tokens-insufficient",
      reason: tokenGate.reason,
      ...common,
      orchestratorMessage: formatHandoffSignal({
        closedMissionId: input.closedMissionId,
        closedLabel,
        finishedTaskId: input.finishedTaskId,
        splitTargets,
        candidates,
        needsOwnerApproval,
        blocked,
        tokenNote,
        askedOwner: false,
      }),
      telegramMessage: formatOwnerTokenBlock({
        closedLabel,
        next,
        reason: tokenGate.reason,
      }),
    };
  }

  // 5. ★게이트 2 — 사장님 승인. 질문을 보내고 **여기서 멈춘다**.
  //    이 함수의 어느 반환값도 "스폰하라"를 뜻하지 않는다.
  return {
    action: "ASK_OWNER",
    code: "handoff",
    reason:
      `미션 '${closedLabel}' 완료 — 다음 후보 ${candidates.length}건 중 1순위 "${next.item.what}" 를 ` +
      `사장님께 여쭙는다. 승인 전에는 시작하지 않는다.`,
    ...common,
    orchestratorMessage: formatHandoffSignal({
      closedMissionId: input.closedMissionId,
      closedLabel,
      finishedTaskId: input.finishedTaskId,
      splitTargets,
      candidates,
      needsOwnerApproval,
      blocked,
      tokenNote,
      askedOwner: true,
    }),
    telegramMessage: formatOwnerHandoffAsk({
      closedLabel,
      next,
      remaining: candidates.length,
      tokenNote,
    }),
  };
}
