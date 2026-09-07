/**
 * 오케 워크체인 — 렌더러 진입점. 모델·파생 규칙의 단일 소스는
 * `electron/mcp-server/work-chain-core.ts`(의존성 0, MCP 서버와 공유) 이고 여기서는
 * 그것을 다시 내보내며, 보드 스토어의 Task 배열을 코어가 받는 `TaskStatusLookup` 으로
 * 바꾸는 접착만 한다(`model-tier` 와 같은 src → electron/mcp-server import 경로).
 *
 * ★완료 판정은 오케 자기보고가 아니라 **보드 스토어의 티켓 status** 다 — 화면이
 * 보여주는 "완료" 는 MCP 쪽 get_work_chain 이 말하는 "완료" 와 같은 함수의 결과다.
 */
export {
  WORK_CHAIN_COLLECTION,
  WORK_CHAIN_WHAT_MAX,
  WORK_CHAIN_WHY_MAX,
  buildMissionMembership,
  buildWorkChainItem,
  deriveWorkChain,
  evidenceTaskIds,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  referencedTaskIds,
  validateNewItem,
  type DerivedWorkChain,
  type DerivedWorkChainItem,
  type MissionMemberTask,
  type MissionMembershipLookup,
  type MissionMembershipSource,
  type NewWorkChainItemInput,
  type TaskStatusLookup,
  type WorkChainDocShape,
  type WorkChainEvidence,
  type WorkChainItem,
  type WorkChainItemState,
  type WorkChainTaskStatus,
} from "../../electron/mcp-server/work-chain-core";
import type {
  DerivedWorkChainItem,
  TaskStatusLookup as Lookup,
} from "../../electron/mcp-server/work-chain-core";
import { missionLabelKey } from "../../electron/mcp-server/implicit-mission";

/**
 * 보드 스토어의 티켓 → 코어 조회표. 체인이 참조하는 id 만 채우고, 스토어에 없는
 * 티켓은 `null`(보드에 없음) 로 둔다 — 코어는 이를 "근거 사라짐" 으로 드러낸다.
 */
export function taskStatusLookupFrom(
  tasks: ReadonlyArray<{ id: string; status: string; deleted?: boolean }>,
  ids: readonly string[],
): Lookup {
  const byId = new Map<string, { status: string; deleted?: boolean }>();
  for (const t of tasks) byId.set(t.id, t);
  const out: Lookup = {};
  for (const id of ids) {
    const t = byId.get(id);
    out[id] = t && !t.deleted ? (t.status as Lookup[string]) : null;
  }
  return out;
}

/** 티켓 id → 제목(있으면). 화면에서 id 대신 제목을 보여주기 위한 접착. */
export function taskTitlesFrom(
  tasks: ReadonlyArray<{ id: string; title?: string }>,
  ids: readonly string[],
): Record<string, string> {
  const byId = new Map<string, string>();
  for (const t of tasks) if (t.title) byId.set(t.id, t.title);
  const out: Record<string, string> = {};
  for (const id of ids) {
    const title = byId.get(id);
    if (title) out[id] = title;
  }
  return out;
}

/**
 * 오케브레인 패널을 미션 단위로 구조화하기 위한 순수 접착(티켓
 * `te3lbjp13nJ39L8WhUhv`, 2026-09-07 — "오케브레인이 곧 미션 목록"이라는
 * 사장님의 원래 설계 의도). `deriveWorkChain`이 이미 우선순위 순서로 낸
 * 목록을 훑으면서, 같은 `missionLabel`(대소문자 무시 매칭 —
 * `missionLabelKey`, 미션 소속 판정과 동일 규칙)을 가진 항목을 그 라벨이
 * **처음 등장한 자리**로 모은다.
 *
 * ★그룹은 항목이 2개 이상 모일 때만 만든다. 지금 대부분의 항목엔 라벨이
 * 아직 없고(오케가 안 붙였다), 라벨이 있는 항목도 대부분 1개뿐이다 — 그
 * 흔한 경우를 그룹 래퍼 없이 지금과 완전히 같은 모양(`{kind:"item"}`)으로
 * 남겨야 "라벨이 서서히 채워지는 동안 화면이 안 고장난 것처럼 보인다"는
 * 완료 기준이 저절로 성립한다. 라벨 없는 항목은 항상 `{kind:"item"}`이다.
 */
export type WorkChainRenderEntry =
  | { kind: "item"; item: DerivedWorkChainItem }
  | {
      kind: "group";
      labelKey: string;
      /** 그룹에 처음 들어온 항목의 표시용 라벨 원문. */
      label: string;
      items: DerivedWorkChainItem[];
    };

export function buildWorkChainRenderGroups(
  items: readonly DerivedWorkChainItem[],
): WorkChainRenderEntry[] {
  const entries: WorkChainRenderEntry[] = [];
  const groupIndexByKey = new Map<string, number>();

  for (const d of items) {
    const label = d.item.missionLabel;
    if (!label) {
      entries.push({ kind: "item", item: d });
      continue;
    }
    const key = missionLabelKey(label);
    const existingIndex = groupIndexByKey.get(key);
    if (existingIndex === undefined) {
      groupIndexByKey.set(key, entries.length);
      entries.push({ kind: "group", labelKey: key, label, items: [d] });
      continue;
    }
    const existing = entries[existingIndex];
    // Always a "group" entry: this branch only runs on a repeat key, and the
    // first occurrence always creates a group (never "item") above.
    if (existing.kind === "group") existing.items.push(d);
  }

  // A "group" of exactly one item is indistinguishable from a plain item
  // except for the extra collapse step — flatten it back so the common
  // (still-unlabeled-majority) case renders exactly as it did before this
  // ticket.
  return entries.map((entry) =>
    entry.kind === "group" && entry.items.length === 1
      ? { kind: "item", item: entry.items[0] }
      : entry,
  );
}

/**
 * 그룹 행 하나가 답해야 하는 사장님 질문: "이 미션이 어디까지 왔고, 다음은
 * 뭐냐". 진행률은 근거 티켓(보드) 집계가 아니라 **체인 항목(단계) 집계**로
 * 낸다 — 같은 라벨 아래 항목들은 보통 서로 다른 근거 티켓 집합을 가진
 * 별개 단계라, 티켓을 합치면 단계마다 크기가 달라 숫자가 오히려 무엇을
 * 답하는지 흐려진다. "3단계 중 2단계 완료"는 항상 명확하다.
 */
export interface WorkChainGroupSummary {
  /** state가 done 또는 dropped인 항목 수 — 더는 손 갈 일이 없는 단계. */
  finishedCount: number;
  totalCount: number;
  /** 아직 안 끝난 것 중 우선순위가 가장 앞선 항목 — 없으면 전부 끝남. */
  next: DerivedWorkChainItem | null;
}

export function summarizeWorkChainGroup(
  items: readonly DerivedWorkChainItem[],
): WorkChainGroupSummary {
  let finishedCount = 0;
  let next: DerivedWorkChainItem | null = null;
  for (const d of items) {
    const finished = d.state === "done" || d.state === "dropped";
    if (finished) finishedCount += 1;
    else if (!next) next = d;
  }
  return { finishedCount, totalCount: items.length, next };
}
