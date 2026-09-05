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
  /**
   * `evidenceTaskIds` 중 `doneWhen` 에 닿은 수 / 전체 수. `deriveWorkChain` 이
   * **이미 파생해 둔 값**이다 — 착수 여부 판정(K3)에 새 조회를 내지 않으려고
   * 그대로 실어 나른다. 없으면 0 = "착수 근거 없음"(구버전 호출자 호환).
   */
  reachedCount?: number;
  totalCount?: number;
}

/** `DerivedWorkChainItem` → 판정 입력. 어댑터를 한 곳에 둔다. */
export function toHandoffChainItem(d: DerivedWorkChainItem): HandoffChainItem {
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
    reachedCount: d.reachedCount,
    totalCount: d.totalCount,
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
  /** ★정렬을 결정한 사실들 — 문장과 테스트가 같은 값을 본다. */
  facts: HandoffRankFacts;
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
 * ★선택 순서는 **명시적인 네 키의 사전식(lexicographic) 비교**다(설계 §3 확장,
 * 티켓 hKdbFBcRKsWZThQc8C4p). 순서가 암시적이면 사장님이 예측할 수 없다.
 *
 * ── 왜 가중치 합산이 아니라 사전식인가 ─────────────────────────────────────
 * 축마다 계수를 붙여 더하는 순간 그 계수는 **아무도 근거를 못 대는 수**가 된다.
 * 사전식은 계수가 없다 — "무엇이 무엇보다 먼저인가" 만 말하고, 그 한 문장은
 * 근거를 댈 수 있다. 그래서 이 파일에는 임의 상수가 없다.
 *
 * ── ★먼저 밝힐 제약: 배열 index 는 전순서다 ────────────────────────────────
 * `work-chain-core.ts` 는 _"배열 순서 = 우선순위"_ 로 정의했고 index 는 유일하다.
 * 따라서 **index 아래에 놓는 축은 영원히 발화하지 않는 죽은 코드**이고,
 * 거꾸로 index 위에 놓는 축은 **필연적으로 사장님이 배열로 정하신 순서를 덮는다**.
 * 그래서 축의 채택 기준은 하나다 — _"이 축은 사장님의 배열 큐레이션을 덮을
 * 만한가."_ 덮을 만한 것은 **사장님이 배열을 정하실 때 손에 없던 구조적 사실**
 * 뿐이다. 아래 K2·K3 이 그것이고, 기각한 축들은 그것이 아니다.
 *
 *   K1. **사장님 지시 우선** — `source === "owner"` 가 앞.
 *       _빼면_: 오케가 스스로 적은 auto/manual 메모가 배열 앞에 있다는 이유만으로
 *       사장님 지시보다 먼저 제안된다. 이건 처리량 축이 아니라 **권한** 축이다.
 *   K2. **막고 있는 것이 많은 순** — 이 항목을 아직 안 끝난 선행으로 지목한
 *       다른 열린 항목 수 내림차순.
 *       _빼면_: 아무것도 막지 않는 잎 항목이 병목보다 먼저 제안되고, 그 병목을
 *       기다리던 N건은 한 바퀴를 통째로 더 기다린다. 누가 누구를 막는지는
 *       사장님이 배열을 정하실 때 머릿속에 없는 사실이다 — 덮는 게 아니라
 *       사장님 의도(그 N건도 원하신다)를 대신 이룬다.
 *   K3. **이미 착수된 것 먼저** — 근거 티켓 중 하나라도 완료에 닿았는가.
 *       _빼면_: 반쯤 끝난 미션을 둔 채 새 미션을 여는 제안이 나오고, 동시 진행
 *       미션 수만 늘어 **어느 것도 안 닫힌다**. 90%에서 멈춘 미완이 가장 비싸다.
 *   K4. **체인 배열 순서(=우선순위)** — 최종 tie-break. index 가 유일하므로
 *       네 키가 **전순서**를 만든다: 동률이 없고, 같은 입력이면 항상 같은 답이다.
 *
 * ── ★넣지 않은 축과 그 근거 ────────────────────────────────────────────────
 *   • **티켓 priority**: 보드의 priority 는 _"어느 에이전트가 다음 티켓을 집나"_
 *     (디스패치)를 위해 **티켓 생성 시점에** 매긴 수다. 미션 간 순서는 체인
 *     배열이라는 **더 나중의·더 굵은** 큐레이션이 이미 답한 질문이고, 둘을
 *     겹치면 오래된 세밀 큐레이션이 최신 큐레이션을 조용히 덮는다. 그래서
 *     _"빼면 순서가 틀린다"_ 를 쓸 수 없다 — 빼면 사장님이 정하신 대로 간다.
 *     게다가 항목당 티켓이 여럿이라 대표값(max/mean/min)을 고르는 순간 근거
 *     없는 가중치가 생긴다.
 *   • **방치 기간(updatedAt)**: `insertItem` 이 append 라서 오래된 항목은 이미
 *     배열 앞이다 — K4 와 대부분 겹친다. 겹치지 않는 유일한 경우는 사장님이
 *     오래된 항목을 **일부러 뒤로 내리신** 때인데, 거기서 발화하면 그 의도를
 *     되돌린다.
 *   • **사장님 최근 언급**: 언급 → 항목 매핑이 없다. 퍼지 문자열 매칭은
 *     "확신에 찬 오답" 생성기다. 사장님께는 이미 정확한 채널이 둘 있고(체인
 *     재정렬, owner 항목 추가) K1·K4 가 그 둘을 그대로 존중한다.
 */

/** 정렬을 결정한 사실들. 신호 문장과 테스트가 **같은 값**을 본다. */
export interface HandoffRankFacts {
  /** K1 — 사장님 지시인가. */
  owner: boolean;
  /** K2 — 이 항목을 선행으로 기다리는 다른 열린 항목 수. */
  blocking: number;
  /** K3 — 근거 티켓 중 완료에 닿은 수 / 전체 수. */
  reached: number;
  total: number;
  /** K4 — 체인 배열에서의 자리(0부터). */
  index: number;
}

/**
 * K2 의 값 — **이 항목을 기다리는 다른 열린 항목이 몇 개인가.**
 *
 * 새 개념을 만들지 않았다. `pendingItemIds` 는 `deriveWorkChain` 이 이미
 * _"아직 안 끝난 선행 항목"_ 으로 파생해 둔 그 집합이다. 그 화살표를 뒤집어
 * 세기만 한다 — 새 조회도, 새 필드도 없다.
 *
 * 닫힌(done/dropped) 항목은 세지 않는다: 이미 끝난 일은 막혀 있지 않다.
 * 반대로 승인 필요 항목은 **센다** — 자율 후보가 아닐 뿐 사장님이 원하시는
 * 실재하는 일이고, 막혀 있다는 사실은 그대로다.
 */
export function countBlockedBy(
  chain: readonly HandoffChainItem[],
  itemId: string,
): number {
  let n = 0;
  for (const other of chain) {
    if (other.id === itemId) continue;
    if (other.state === "done" || other.state === "dropped") continue;
    if ((other.pendingItemIds ?? []).includes(itemId)) n += 1;
  }
  return n;
}

/** K3 의 값 — 근거 티켓 중 하나라도 완료에 닿았는가(= 이미 착수됨). */
export function isStarted(item: HandoffChainItem): boolean {
  return (item.reachedCount ?? 0) > 0;
}

/**
 * 네 키를 한 배열로. 사전식 비교라 계수가 없다 — 자리(index)가 곧 우선이다.
 * K2 만 내림차순이므로 부호를 뒤집어 **전부 오름차순 비교**로 통일한다.
 */
function rankKey(facts: HandoffRankFacts): [number, number, number, number] {
  return [
    facts.owner ? 0 : 1, // K1
    -facts.blocking, // K2 (많을수록 앞)
    isStartedFacts(facts) ? 0 : 1, // K3
    facts.index, // K4
  ];
}

function isStartedFacts(facts: HandoffRankFacts): boolean {
  return facts.reached > 0;
}

function compareRankKeys(a: readonly number[], b: readonly number[]): number {
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return a[i] - b[i];
  }
  return 0;
}

/**
 * 이 자리에 온 이유 — **발화한 키만** 사람 말로 적는다.
 *
 * 고정 문장을 돌려주면 사장님은 "왜 얘가 1순위인지" 를 여전히 모르신다.
 * 그래서 실제로 값이 있는 축만 골라 붙인다.
 */
function rankReasonFor(facts: HandoffRankFacts, rank: number): string {
  const parts: string[] = [
    facts.owner ? "사장님 지시(source=owner)" : "오케가 적은 항목",
  ];
  if (facts.blocking > 0) {
    parts.push(`다른 항목 ${facts.blocking}건이 이걸 기다린다`);
  }
  if (isStartedFacts(facts)) {
    parts.push(`이미 착수(티켓 ${facts.reached}/${facts.total} 완료)`);
  } else if (facts.total > 0) {
    parts.push(`아직 착수 전(티켓 ${facts.total}건)`);
  } else {
    parts.push("아직 티켓 없음");
  }
  parts.push(`체인 ${facts.index + 1}번째`);
  return `${rank}순위 — ${parts.join(" · ")}`;
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

  const scored = open.map(({ item, index }) => ({
    item,
    facts: {
      owner: isOwnerDirective(item),
      // ★막고 있는 것은 **체인 전체**에서 센다 — 후보 집합이 아니라. 후보가
      //   아닌 waiting/승인필요 항목이 이 항목을 기다리는 것도 막힌 것이다.
      blocking: countBlockedBy(chain, item.id),
      reached: item.reachedCount ?? 0,
      total: item.totalCount ?? item.evidenceTaskIds.length,
      index,
    } satisfies HandoffRankFacts,
  }));

  const candidates = scored
    .slice()
    .sort((a, b) => compareRankKeys(rankKey(a.facts), rankKey(b.facts)))
    .map(({ item, facts }, i) => ({
      item,
      need: needOf(item),
      rank: i + 1,
      rankReason: rankReasonFor(facts, i + 1),
      facts,
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
  return (
    `  ${c.rank}) [${c.item.id}] "${c.item.what}"${label}${tickets}\n` +
    `     왜: ${c.item.why}\n` +
    `     순위 근거: ${c.rankReason}`
  );
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
    `선택 순서(사전식 4키, 가중치 없음): ①사장님 지시(source=owner) → ` +
      `②막고 있는 다른 항목 수 많은 순 → ③이미 착수된 것 → ④체인 배열 순서(=우선순위)`,
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
  } else if (
    input.blocked.length === 0 &&
    input.needsOwnerApproval.length === 0
  ) {
    // ★두 경우를 섞지 않는다 — 사장님/오케가 할 행동이 다르다.
    out.push(
      `▶ ★오케브레인이 비었습니다 — 남은 미션이 0건이다. 다음 후보가 없다.`,
    );
  } else {
    out.push(
      `▶ 지금 시작할 수 있는 다음 미션 후보가 없다 — 다만 오케브레인이 빈 것은 아니다 ` +
        `(선행 대기 ${input.blocked.length}건 / 승인 필요 ${input.needsOwnerApproval.length}건). ` +
        `새 미션이 필요한 게 아니라 그 막힘을 푸는 일이다.`,
    );
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
 * ★사장님께 몇 개까지 보여드릴 것인가.
 *
 * 임의의 수가 아니라 **두 제약의 교집합**이다: (가) 하나만 지명하면 그건 선택지가
 * 아니라 통보다 — 사장님이 고르실 수 없으면 자율이 아니라 독단이다. (나) 전부
 * 실으면 텔레그램 한 통이 보드 전체가 되고, 그 순간 아무도 안 읽는다.
 * 그래서 "고를 수 있는 최소" 인 3 이다. 나머지는 **개수로 정직하게 밝히고**
 * 전체 목록은 오케 신호에 그대로 남는다(잘라내는 게 아니라 옮겨 담는다).
 */
export const OWNER_CHOICE_LIMIT = 3;

/** 사장님께 보여드릴 후보 한 덩이 — 무엇을·왜·지금 무엇이 필요한지. */
function ownerCandidateBlock(c: HandoffCandidate): string {
  const need =
    c.need === "split"
      ? "아직 티켓이 없어서, 시작하면 먼저 태스크로 쪼갭니다"
      : `티켓 ${c.item.evidenceTaskIds.length}건이 이미 붙어 있어 바로 진행합니다`;
  return [
    `${c.rank}) "${c.item.what}"`,
    `   - 왜: ${c.item.why}`,
    `   - 상태: ${need}`,
    `   - 이 순위인 이유: ${c.rankReason}`,
  ].join("\n");
}

/**
 * 상위 몇 개 + 남은 개수. **잘라냈다는 사실 자체를 적는다** — 조용히 자르면
 * 사장님은 후보가 그게 전부인 줄 아신다.
 */
function ownerCandidateList(candidates: readonly HandoffCandidate[]): string[] {
  const shown = candidates.slice(0, OWNER_CHOICE_LIMIT);
  const rest = candidates.length - shown.length;
  const out = shown.map(ownerCandidateBlock);
  if (rest > 0) {
    out.push(
      `(그 밖에 후보 ${rest}건이 더 있습니다 — 전체 목록은 오케에 있습니다.)`,
    );
  }
  return out;
}

/**
 * ★사장님께 나가는 텔레그램 본문.
 *
 * 이 값은 **호출자가 브리지로 넘기기만 한다** — activity·저널·툴 응답 어디에도
 * 적히지 않는다(테스트로 고정). 담기는 것은 보드에 이미 공개된 사실뿐이고,
 * 토큰·chatId 는 이 문자열에 들어갈 자리가 없다.
 *
 * ★하나를 지명하지 않는다. 상위 몇 개를 **근거와 함께** 늘어놓고 사장님이
 * 고르시게 한다 — 기계가 하나를 정해 시작해버리면 자율이 아니라 독단이다.
 */
export function formatOwnerHandoffAsk(input: {
  closedLabel: string;
  candidates: readonly HandoffCandidate[];
  tokenNote: string;
}): string {
  return [
    `[마블로] 미션 '${input.closedLabel}' 이 끝났습니다.`,
    ``,
    `남은 미션을 우선순위로 훑었습니다. 다음 후보 ${input.candidates.length}건 중 상위 ${Math.min(
      input.candidates.length,
      OWNER_CHOICE_LIMIT,
    )}건입니다:`,
    ``,
    ...ownerCandidateList(input.candidates),
    ``,
    `순위 기준: ①사장님 지시 → ②막고 있는 다른 항목이 많은 것 → ③이미 착수된 것 → ④체인 순서`,
    `토큰 잔여: ${input.tokenNote}`,
    ``,
    `★어느 것부터 할까요? 승인해 주시기 전까지는 아무것도 스폰하지 않고 여기서 멈춰 있습니다.`,
    `이 메시지에 답장해 주시면 오케에 전달됩니다 (예: "1번 시작해" / "2번부터" / "다 아니야" / "멈춰").`,
  ].join("\n");
}

/**
 * ★토큰이 부족해 시작하지 못했다는 **보고**(질문이 아니다).
 *
 * ── 왜 제안을 보류하지 않고 부족과 **함께** 내보내는가 ─────────────────────
 * 토큰 게이트가 막는 것은 **스폰**이지 **정보**가 아니다. 여기서 후보를 감추면
 * 사장님은 (가) 무엇이 밀려 있는지 모르시고 (나) "그건 급하니 다른 하네스로
 * 돌려라 / 잔여를 채워두마" 같은 판단 자체를 하실 수 없다. 즉 보류는 사장님의
 * 선택지를 지우는 대가로 아무것도 아끼지 못한다. 그리고 이 경로는 어차피
 * 승인 게이트 앞에서 멈추므로, 후보를 실어도 시작되는 일은 없다.
 * 대신 **"지금은 잔여가 부족하다"를 후보와 같은 화면에 적는다** — 부족을
 * 숨긴 제안은 승인해 주셔도 안 돌아가는 제안이라 정직하지 않다.
 */
export function formatOwnerTokenBlock(input: {
  closedLabel: string;
  candidates: readonly HandoffCandidate[];
  reason: string;
}): string {
  return [
    `[마블로] 미션 '${input.closedLabel}' 이 끝났지만 다음 미션을 시작하지 못했습니다.`,
    ``,
    `★지금은 토큰 잔여가 부족합니다 — ${input.reason}`,
    ``,
    input.candidates.length > 0
      ? `잔여가 회복되면 이 순서로 제안드릴 후보 ${input.candidates.length}건입니다:`
      : `대기 중인 다음 후보: 없음`,
    ...(input.candidates.length > 0
      ? [``, ...ownerCandidateList(input.candidates)]
      : []),
    ``,
    `★스폰은 진행하지 않았습니다. 잔여가 회복되거나 사장님이 지시하시면 이어서 진행합니다.`,
  ].join("\n");
}

/**
 * ★후보가 하나도 없다는 **보고**. 침묵보다 낫다.
 *
 * 두 경우를 **섞지 않는다** — 섞으면 사장님이 하실 행동이 달라지는데 문구가
 * 같아진다:
 *   • 체인에 열린 항목이 아예 0건  → 오케브레인이 비었다. 채우실 분은 사장님뿐이다.
 *   • 후보만 0건(대기·승인 필요는 남음) → 브레인이 빈 게 아니라 **막혀** 있다.
 *     사장님이 새 미션을 주실 일이 아니라 그 막힘을 푸는 일이다.
 */
export function formatOwnerChainExhausted(input: {
  closedLabel: string;
}): string {
  return [
    `[마블로] 미션 '${input.closedLabel}' 이 끝났습니다.`,
    ``,
    `★오케브레인이 비었습니다 — 남은 미션이 0건입니다.`,
    `대기 중인 항목도, 승인을 기다리는 항목도 없습니다.`,
    ``,
    `다음으로 무엇을 할지 지시해 주시면 오케가 태스크로 쪼갭니다.`,
    `★아무것도 스폰하지 않았고, 지시 전까지 여기서 멈춰 있습니다.`,
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
    // 체인이 비었다는 것도 사실이다 — 조용히 끝내지 않는다.
    //
    // ★두 경우를 갈라 놓는다. 문구가 같으면 사장님이 하실 행동이 달라지는데도
    //   같은 말로 들린다:
    //     (가) 열린 항목이 아예 0건 → **오케브레인이 비었다.** 채우실 분은
    //          사장님뿐이므로 이건 사장님께 간다. 침묵보다 낫다.
    //     (나) 후보만 0건(대기·승인 필요는 남음) → 브레인이 빈 게 아니라 막혔다.
    //          새 미션을 주실 일이 아니므로 사장님을 깨우지 않고 오케에만 남긴다.
    const brainEmpty = blocked.length === 0 && needsOwnerApproval.length === 0;
    const signal = formatHandoffSignal({
      closedMissionId: input.closedMissionId,
      closedLabel,
      finishedTaskId: input.finishedTaskId,
      splitTargets: [],
      candidates: [],
      needsOwnerApproval,
      blocked,
      tokenNote: "후보가 없어 확인하지 않음",
      askedOwner: false,
    });
    return empty(
      // ★NOTIFY_OWNER 는 **보고**다(질문도, 스폰도 아니다) — 토큰 게이트를
      //   지나기 전이지만, 여기서 시작되는 것이 없으므로 게이트가 걸릴 자리도 없다.
      brainEmpty ? "NOTIFY_OWNER" : "NO_HANDOFF",
      "chain-exhausted",
      brainEmpty
        ? `미션 '${closedLabel}' 이 닫혔고 ★오케브레인이 비었다 — 남은 미션 0건. 사장님께 알린다.`
        : `미션 '${closedLabel}' 이 닫혔고 지금 시작할 수 있는 다음 미션 후보가 없다` +
            ` (선행 대기 ${blocked.length}건 / 승인 필요 ${needsOwnerApproval.length}건).` +
            ` 오케브레인이 빈 것은 아니므로 사장님께 새 미션을 여쭙지 않는다.`,
      {
        needsOwnerApproval,
        blocked,
        orchestratorMessage: signal,
        telegramMessage: brainEmpty
          ? formatOwnerChainExhausted({ closedLabel })
          : "",
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
        candidates,
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
      `미션 '${closedLabel}' 완료 — 다음 후보 ${candidates.length}건 중 상위 ` +
      `${Math.min(candidates.length, OWNER_CHOICE_LIMIT)}건을 근거와 함께 사장님께 여쭙는다` +
      `(1순위 "${next.item.what}"). ★하나를 지명하지 않는다. 승인 전에는 시작하지 않는다.`,
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
      candidates,
      tokenNote,
    }),
  };
}
