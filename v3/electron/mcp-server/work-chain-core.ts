/**
 * 오케스트레이터 워크체인 — 순수 코어 (티켓 fQtXQ2NzyYs0MRpqByTS).
 *
 * ## 무엇
 * 오케가 "A 끝나면 B, 그다음 C" 를 계획해 놓고 A 를 마치면 B·C 를 잊는다. 그 계획은
 * 오케의 대화 맥락에만 있어서 맥락이 요약되거나 세션이 바뀌면 사라진다(2026-08-22
 * 실측 세 건: 열겠다던 웹 티켓을 안 열었고, "배포 급해서 멈춤" 이 어디에도 안 남았고,
 * 머지한 티켓 둘을 REVIEW 로 방치했다). 이 모듈은 그 계획을 **보드 옆에 남기는**
 * 목록의 데이터 모델과 판정 규칙이다. Firestore I/O 는 `work-chain.ts`, 렌더러는
 * `src/lib/workChain.ts` 가 이 파일을 그대로 import 한다(의존성 0 — firebase 도,
 * src/ 도 import 하지 않는다. MCP 서버 tsconfig 는 rootDir 격리라 src/ 를 못 보지만
 * 반대 방향(src → electron/mcp-server)은 이미 `model-tier` 가 쓰는 경로다).
 *
 * 암묵 미션 라벨 매칭은 `implicit-mission.ts` 의 `missionLabelKey` 를 그대로
 * 쓴다 — 새 정규화 규칙을 만들지 않는다. 미션 엔진(MISSION_DRIVER)과는 무관.
 *
 * ## 왜 새 문서인가 — missions / flows / pendingInstructions 를 안 쓴 근거
 *   · missions: 수명주기가 mission-engine 지휘자에 용접돼 있다. `planning` 이면
 *     wire.ts 가 집어 실행하고, `implicit` 이면 MissionsTab 이 숨긴다. step.type 은
 *     러너 동사 4종의 닫힌 union 이고 why/선행조건 필드가 없다 — 메모 목록이 들어갈
 *     자리가 없다.
 *   · flows: x/y 좌표 달린 캔버스 DAG. 상태는 flow 단위뿐(노드별 지속 상태 없음)이고
 *     update_flow 로 누구나 completed 를 적는 자기보고다.
 *   · pendingInstructions: 1회성 PTY 전송 큐. 룰이 `isDelivered false→true` 외의
 *     모든 변경을 금지해 편집·상태·삭제가 구조적으로 불가.
 *   · tasks 재사용(새 contextId)도 봤다: role enum 확장 + 워커 피드/디스패치/보드 필터
 *     전부 손대야 하고, 결정적으로 오케 메모 티켓의 DONE 은 여전히 **오케 자기보고**다.
 *     체인은 티켓을 *참조해 근거로 써야지* 티켓 *자체*가 되면 안 된다.
 * 그래서 프로젝트당 1문서 `workChains/{projectId}` 다 — 경로가 곧 테넌트 경계라
 * projectId 필드를 빼먹어 구멍이 나는 일(missions 가 그랬다)이 구조적으로 없고,
 * list 쿼리도 인덱스도 필요 없다.
 *
 * ## ★완료 판정은 보드 사실로
 * 항목의 "끝났다" 는 오케가 말하는 게 아니라 **연결된 티켓의 실제 status** 로
 * 판정한다(`deriveItemState`). 오늘 에이전트 셋이 "완료" 라 보고했는데 푸시가 안 돼
 * 있었다 — 오케 체인에도 같은 종류의 거짓말이 생긴다. 티켓이 연결된 항목은
 * `self_reported` 종료를 **거부**한다(`rejectSelfReportReason`). 티켓이 없는 항목만
 * 근거 문장을 달아 자기보고로 닫을 수 있고, 그 사실은 `evidence: "self"` 로 끝까지
 * 구분돼 보인다.
 *
 * ## 항목 필드 (무엇·왜·선행조건·상태)
 *   what           무엇을 할 것인가 (한 줄)
 *   why            왜 — 나중에 이 항목이 아직 유효한지 판단하는 근거
 *                  ("배포가 급해서 보류" 는 배포가 끝나면 자동으로 유효해진다)
 *   afterTaskIds   선행 티켓 — 전부 DONE 이어야 ready
 *   afterItemIds   선행 체인 항목 — 전부 done/dropped 여야 ready
 *   taskIds        이 항목의 실체 티켓 — 전부 `doneWhen` 에 닿으면 done (보드 근거)
 *   missionLabel   암묵 미션 라벨 — 보드에서 그 라벨의 티켓을 모아 taskIds 와
 *                  합집합으로 판정한다. 매칭은 `missionLabelKey`(implicit-mission.ts)
 *                  그대로. 라벨만 있고 티켓 0개면 done 이 아니다(unsplit).
 *   doneWhen       exists(티켓이 생기면) | review(REVIEW 이상) | done(DONE)
 *   closed         오케/사용자의 명시적 종료 — dropped(사유) | self_reported(근거)
 *   source         manual(오케가 직접 add_work_chain_item) | auto(도구 층이 오케가
 *                  이미 쓴 문장에서 포착 — work-chain-capture.ts). ★쓰는 쪽의 자발성을
 *                  없앤 축이라 끝까지 구분돼 보여야 한다(자기보고 evidence 와 같은 규율).
 *   sourceTool     auto 일 때 어느 도구가 적었나 — 오탐이 어느 표면에서 나오는지 진단.
 */

import {
  isImplicitMissionDoc,
  missionLabelKey,
  normalizeMissionLabel,
} from "./implicit-mission.js";

export type WorkChainTaskStatus =
  | "TODO"
  | "CLAIMED"
  | "IN_PROGRESS"
  | "REVIEW"
  | "BLOCKED"
  | "FAILED"
  | "DONE";

export type WorkChainDoneWhen = "exists" | "review" | "done";

export type WorkChainClosedKind = "dropped" | "self_reported";

/**
 * 항목이 **어떻게 생겼나**. `manual` 은 오케가 add_work_chain_item 을 부르기로
 * 결심한 것이고, `auto` 는 도구 층이 오케가 이미 쓴 문장에서 포착한 것이다
 * (work-chain-capture.ts). 이 축을 저장하는 이유는 두 가지다 —
 *   ① 오탐 진단: 자동 포착이 어느 표면에서 헛것을 잡는지 사후에 셀 수 있어야 한다.
 *   ② 신뢰 표시: 사장님·오케 모두 "이건 기계가 적은 것" 을 알고 봐야 한다.
 */
export type WorkChainSource = "manual" | "auto";

export interface WorkChainClosed {
  kind: WorkChainClosedKind;
  /** dropped 의 사유 / self_reported 의 근거 문장. 비울 수 없다. */
  reason: string;
  /** epoch ms */
  at: number;
  /** agentId 또는 uid */
  by: string;
}

export interface WorkChainItem {
  id: string;
  what: string;
  why: string;
  afterTaskIds: string[];
  afterItemIds: string[];
  taskIds: string[];
  /**
   * 암묵 미션 라벨(표시용 원문, normalizeMissionLabel 적용). 매칭은
   * `missionLabelKey`. 없으면 미션 묶음 없음(기존 항목).
   */
  missionLabel?: string;
  doneWhen: WorkChainDoneWhen;
  closed?: WorkChainClosed;
  /** 진행 메모(선택). 상태가 아니라 맥락이다. */
  note?: string;
  /** 어떻게 생겼나. 없으면 manual(구버전 항목 호환). */
  source?: WorkChainSource;
  /** source === "auto" 일 때 적은 도구 이름(예: "merge_and_close"). */
  sourceTool?: string;
  /** epoch ms — 배열 안의 값이라 Timestamp 대신 숫자(렌더러/MCP 양쪽에서 같은 타입). */
  createdAt: number;
  updatedAt: number;
  createdBy: string;
}

/** `workChains/{projectId}` 문서. 문서 id == projectId. */
export interface WorkChainDocShape {
  projectId: string;
  items: WorkChainItem[];
  /** 항목 편집마다 +1 — 렌더러/오케가 "내가 본 버전" 을 말할 수 있게. */
  rev: number;
  updatedBy: string;
}

/** 파생 상태 — 저장하지 않는다. 읽을 때마다 티켓 라이브 상태로 다시 계산한다. */
export type WorkChainItemState = "waiting" | "ready" | "done" | "dropped";

/** done 의 근거 — board(티켓 상태) 인지 self(자기보고) 인지. */
export type WorkChainEvidence = "board" | "self";

export interface DerivedWorkChainItem {
  item: WorkChainItem;
  state: WorkChainItemState;
  /** state === "done" 일 때만. */
  evidence?: WorkChainEvidence;
  /** waiting 일 때 — 아직 안 끝난 선행 티켓 id. */
  pendingTaskIds: string[];
  /** waiting 일 때 — 아직 안 끝난 선행 항목 id. */
  pendingItemIds: string[];
  /** 연결 티켓 중 보드에 없는 것(삭제됐거나 id 오타). 근거가 사라진 항목이다. */
  missingTaskIds: string[];
  /**
   * 이 항목의 완료 근거 티켓(명시 taskIds ∪ 미션 소속). 패널 진행률·MCP
   * evidence 줄의 단일 목록.
   */
  evidenceTaskIds: string[];
  /** evidenceTaskIds 중 doneWhen 에 닿은 수. */
  reachedCount: number;
  totalCount: number;
  /**
   * 미션 라벨은 있는데 보드에 그 미션 티켓이 0개(명시 taskIds 도 없음).
   * ★done 이 아니다 — 빈 집합을 전칭으로 두면 걸자마자 완료로 보인다.
   * state 는 after* 가 없으면 ready (다음 할 일 = 쪼개기).
   */
  unsplit: boolean;
  /**
   * 이 라벨에 매칭된 implicit 미션 문서 수. 2 이상이면 진행률은 여러 배치의
   * 합집합이다 — 펼침/MCP 에 그 사실을 밝혀야 한다(조용한 합산 금지).
   */
  missionCount: number;
}

export interface DerivedWorkChain {
  items: DerivedWorkChainItem[];
  /** 열린(=waiting|ready) 항목. 배열 순서 = 우선순위. */
  open: DerivedWorkChainItem[];
  ready: DerivedWorkChainItem[];
  waiting: DerivedWorkChainItem[];
  /** 첫 ready 항목 — "다음에 할 일". 없으면 null. */
  next: DerivedWorkChainItem | null;
}

/** 티켓 id → 라이브 status. 없는 티켓은 null (undefined 는 "아직 못 읽음" 이 아니라 "없음" 으로 취급). */
export type TaskStatusLookup = Record<string, WorkChainTaskStatus | null>;

/**
 * 한 라벨 키에 대한 보드 소속. I/O 가 채우고 `deriveWorkChain` 이 읽는다.
 *
 * ★같은 라벨로 배치를 두 번 돌리면 implicit 미션이 두 개 생긴다(끝난 미션에는
 * 합류하지 않음). 합산은 유지한다 — 라벨은 집합 키이고, 최근 1개만 고르면
 * 과거 배치가 조용히 빠진다. 대신 `missionCount` 를 실어 2개 이상이면
 * 펼침/MCP 가 "미션 N개 합산" 을 말한다. 조용한 12/40 은 오늘
 * `identity_linked_ratio` 와 같은 실패(숫자는 맞는데 물은 것과 다른 답).
 */
export interface MissionMembershipBucket {
  taskIds: readonly string[];
  missionCount: number;
}

export type MissionMembershipLookup = Readonly<
  Record<string, MissionMembershipBucket>
>;

/** `buildMissionMembership` 에 넘기는 미션 문서 최소 모양. */
export interface MissionMembershipSource {
  id: string;
  missionKind?: string | null;
  implicitLabel?: string | null;
  status?: string | null;
}

/** `buildMissionMembership` 에 넘기는 보드 티켓 최소 모양. */
export interface MissionMemberTask {
  id: string;
  contextId?: string | null;
  missionId?: string | null;
  deleted?: boolean;
}

export const WORK_CHAIN_COLLECTION = "workChains";

export const WORK_CHAIN_DONE_WHEN_VALUES: readonly WorkChainDoneWhen[] = [
  "exists",
  "review",
  "done",
];

/** `doneWhen` 기준으로 이 status 가 "닿았다" 인가. */
export function statusSatisfiesDoneWhen(
  status: WorkChainTaskStatus | null | undefined,
  doneWhen: WorkChainDoneWhen,
): boolean {
  if (status === null || status === undefined) return false;
  if (doneWhen === "exists") return true;
  if (doneWhen === "review") return status === "REVIEW" || status === "DONE";
  return status === "DONE";
}

function uniqStrings(values: readonly string[] | undefined): string[] {
  const out: string[] = [];
  for (const v of values ?? []) {
    const s = (v ?? "").trim();
    if (s && !out.includes(s)) out.push(s);
  }
  return out;
}

/**
 * 암묵 미션 문서 + 보드 티켓 → 라벨 키별 티켓 id + 매칭 미션 수.
 *
 * 조인은 Replay 와 같다: `task.contextId === missionId`(missionId 필드가 있으면
 * 그것도). abandoned 는 제외, completed 는 포함(방금 끝난 미션이 unsplit 으로
 * 뒤집히면 안 된다). 엔진을 켜지 않는다 — 문서 읽기만.
 *
 * 같은 키의 미션이 여럿이면 티켓을 합집합으로 모은다(가). 개수는
 * `missionCount` 로 드러난다 — 조용히 합산만 하지 않는다.
 */
export function buildMissionMembership(
  missions: readonly MissionMembershipSource[],
  tasks: readonly MissionMemberTask[],
): Record<string, MissionMembershipBucket> {
  const missionIdToKeys = new Map<string, string[]>();
  const keyToMissionIds = new Map<string, string[]>();
  for (const mission of missions) {
    if (!isImplicitMissionDoc(mission)) continue;
    if (mission.status === "abandoned") continue;
    const label = normalizeMissionLabel(mission.implicitLabel ?? null);
    if (!label) continue;
    const key = missionLabelKey(label);
    const prev = missionIdToKeys.get(mission.id) ?? [];
    if (!prev.includes(key)) prev.push(key);
    missionIdToKeys.set(mission.id, prev);
    const ids = keyToMissionIds.get(key) ?? [];
    if (!ids.includes(mission.id)) ids.push(mission.id);
    keyToMissionIds.set(key, ids);
  }
  const taskIdsByKey: Record<string, string[]> = {};
  for (const task of tasks) {
    if (!task.id || task.deleted) continue;
    const refs = uniqStrings([task.contextId ?? "", task.missionId ?? ""]);
    for (const ref of refs) {
      if (ref === "board") continue;
      const keys = missionIdToKeys.get(ref);
      if (!keys) continue;
      for (const key of keys) {
        const list = taskIdsByKey[key] ?? [];
        if (!list.includes(task.id)) list.push(task.id);
        taskIdsByKey[key] = list;
      }
    }
  }
  const out: Record<string, MissionMembershipBucket> = {};
  for (const [key, missionIds] of keyToMissionIds) {
    out[key] = {
      taskIds: taskIdsByKey[key] ?? [],
      missionCount: missionIds.length,
    };
  }
  return out;
}

/** 명시 taskIds ∪ 미션 소속. 완료 판정·진행률의 단일 집합. */
export function evidenceTaskIds(
  item: WorkChainItem,
  membership: MissionMembershipLookup = {},
): string[] {
  const fromMission = item.missionLabel
    ? (membership[missionLabelKey(item.missionLabel)]?.taskIds ?? [])
    : [];
  return uniqStrings([...item.taskIds, ...fromMission]);
}

/** 저장 문서 → 타입 보정. 손상/구버전 필드는 조용히 기본값으로(읽기 경로를 절대 안 죽인다). */
export function normalizeWorkChainItem(raw: unknown): WorkChainItem | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const id = typeof r.id === "string" ? r.id.trim() : "";
  const what = typeof r.what === "string" ? r.what.trim() : "";
  if (!id || !what) return null;
  const doneWhen = WORK_CHAIN_DONE_WHEN_VALUES.includes(
    r.doneWhen as WorkChainDoneWhen,
  )
    ? (r.doneWhen as WorkChainDoneWhen)
    : "done";
  let closed: WorkChainClosed | undefined;
  if (r.closed && typeof r.closed === "object") {
    const c = r.closed as Record<string, unknown>;
    if (c.kind === "dropped" || c.kind === "self_reported") {
      closed = {
        kind: c.kind,
        reason: typeof c.reason === "string" ? c.reason : "",
        at: typeof c.at === "number" ? c.at : 0,
        by: typeof c.by === "string" ? c.by : "",
      };
    }
  }
  const item: WorkChainItem = {
    id,
    what,
    why: typeof r.why === "string" ? r.why : "",
    afterTaskIds: uniqStrings(r.afterTaskIds as string[] | undefined),
    afterItemIds: uniqStrings(r.afterItemIds as string[] | undefined),
    taskIds: uniqStrings(r.taskIds as string[] | undefined),
    doneWhen,
    createdAt: typeof r.createdAt === "number" ? r.createdAt : 0,
    updatedAt: typeof r.updatedAt === "number" ? r.updatedAt : 0,
    createdBy: typeof r.createdBy === "string" ? r.createdBy : "",
  };
  if (closed) item.closed = closed;
  if (typeof r.note === "string" && r.note.trim()) item.note = r.note;
  // 구버전 문서에는 source 가 없다 — 없으면 manual 로 본다(자동 포착 이전의 항목은
  // 전부 오케가 손으로 적은 것이므로 사실과 맞다).
  if (r.source === "auto" || r.source === "manual") item.source = r.source;
  if (typeof r.sourceTool === "string" && r.sourceTool.trim())
    item.sourceTool = r.sourceTool.trim();
  const missionLabel = normalizeMissionLabel(
    typeof r.missionLabel === "string" ? r.missionLabel : null,
  );
  if (missionLabel) item.missionLabel = missionLabel;
  return item;
}

export function normalizeWorkChainItems(raw: unknown): WorkChainItem[] {
  if (!Array.isArray(raw)) return [];
  const out: WorkChainItem[] = [];
  for (const entry of raw) {
    const item = normalizeWorkChainItem(entry);
    if (item) out.push(item);
  }
  return out;
}

/** 체인 항목이 참조하는 모든 티켓 id(선행 + 실체 + 미션 소속). 라이브 상태를 읽어야 할 집합. */
export function referencedTaskIds(
  items: readonly WorkChainItem[],
  membership: MissionMembershipLookup = {},
): string[] {
  const ids: string[] = [];
  for (const it of items) {
    for (const id of [
      ...it.afterTaskIds,
      ...evidenceTaskIds(it, membership),
    ]) {
      if (!ids.includes(id)) ids.push(id);
    }
  }
  return ids;
}

/**
 * 항목 하나의 파생 상태. `itemStateById` 는 선행 항목 판정용(이미 계산된 것만 들어
 * 있으면 된다 — 배열 순서대로 계산하므로 "앞 항목" 은 항상 있다. 뒤 항목을 선행으로
 * 건 역참조는 미완료로 본다 = 순환 방지).
 */
export function deriveItemState(
  item: WorkChainItem,
  tasks: TaskStatusLookup,
  itemStateById: ReadonlyMap<string, WorkChainItemState>,
  membership: MissionMembershipLookup = {},
): DerivedWorkChainItem {
  const evidenceIds = evidenceTaskIds(item, membership);
  const unsplit = Boolean(item.missionLabel) && evidenceIds.length === 0;
  const reachedCount = evidenceIds.filter((id) =>
    statusSatisfiesDoneWhen(tasks[id], item.doneWhen),
  ).length;
  const totalCount = evidenceIds.length;
  const missingTaskIds = [...item.afterTaskIds, ...evidenceIds].filter(
    (id) => tasks[id] === null || tasks[id] === undefined,
  );
  const missionCount = item.missionLabel
    ? (membership[missionLabelKey(item.missionLabel)]?.missionCount ?? 0)
    : 0;
  const progress = {
    evidenceTaskIds: evidenceIds,
    reachedCount,
    totalCount,
    unsplit,
    missingTaskIds,
    missionCount,
  };
  if (item.closed?.kind === "dropped") {
    return {
      item,
      state: "dropped",
      pendingTaskIds: [],
      pendingItemIds: [],
      ...progress,
    };
  }
  // ★보드 근거가 자기보고보다 먼저다. 티켓이 연결돼 있으면 그 상태가 답이다.
  // 미션 라벨만 있고 티켓 0개(unsplit)는 빈 전칭이 아니다 — done 이 될 수 없다.
  if (evidenceIds.length > 0) {
    if (reachedCount === totalCount) {
      return {
        item,
        state: "done",
        evidence: "board",
        pendingTaskIds: [],
        pendingItemIds: [],
        ...progress,
      };
    }
  } else if (!unsplit && item.closed?.kind === "self_reported") {
    return {
      item,
      state: "done",
      evidence: "self",
      pendingTaskIds: [],
      pendingItemIds: [],
      ...progress,
    };
  }
  const pendingTaskIds = item.afterTaskIds.filter((id) => tasks[id] !== "DONE");
  const pendingItemIds = item.afterItemIds.filter((id) => {
    const s = itemStateById.get(id);
    return s !== "done" && s !== "dropped";
  });
  const waiting = pendingTaskIds.length > 0 || pendingItemIds.length > 0;
  return {
    item,
    state: waiting ? "waiting" : "ready",
    pendingTaskIds,
    pendingItemIds,
    ...progress,
  };
}

/** 체인 전체 파생. 배열 순서 = 우선순위. */
export function deriveWorkChain(
  items: readonly WorkChainItem[],
  tasks: TaskStatusLookup,
  membership: MissionMembershipLookup = {},
): DerivedWorkChain {
  const stateById = new Map<string, WorkChainItemState>();
  const derived: DerivedWorkChainItem[] = [];
  for (const item of items) {
    const d = deriveItemState(item, tasks, stateById, membership);
    stateById.set(item.id, d.state);
    derived.push(d);
  }
  const open = derived.filter(
    (d) => d.state === "waiting" || d.state === "ready",
  );
  const ready = derived.filter((d) => d.state === "ready");
  const waiting = derived.filter((d) => d.state === "waiting");
  return { items: derived, open, ready, waiting, next: ready[0] ?? null };
}

// ── 쓰기 규칙 (tools.ts 와 렌더러 서비스가 공유) ─────────────────────────

export const WORK_CHAIN_WHAT_MAX = 200;
export const WORK_CHAIN_WHY_MAX = 500;
export const WORK_CHAIN_REASON_MAX = 500;
export const WORK_CHAIN_ITEMS_MAX = 200;

export interface NewWorkChainItemInput {
  what: string;
  why: string;
  taskIds?: string[];
  afterTaskIds?: string[];
  afterItemIds?: string[];
  /** 암묵 미션 라벨. 정규화해 저장. 빈 값/공백은 없는 것과 같다. */
  missionLabel?: string;
  doneWhen?: WorkChainDoneWhen;
  note?: string;
  /** 기본 manual. 자동 포착 경로만 "auto" 를 준다. */
  source?: WorkChainSource;
  /** source === "auto" 일 때 필수 취급 — 어느 도구가 적었는지 없으면 진단이 안 된다. */
  sourceTool?: string;
}

/** 입력 검증 — 실패 사유 문자열 또는 null. 순수. */
export function validateNewItem(input: NewWorkChainItemInput): string | null {
  const what = (input.what ?? "").trim();
  const why = (input.why ?? "").trim();
  if (!what) return "what 이 비어 있다 — 무엇을 할지 한 줄로 적어라.";
  if (what.length > WORK_CHAIN_WHAT_MAX)
    return `what 이 너무 길다(${what.length} > ${WORK_CHAIN_WHAT_MAX}). 제목은 한 줄, 맥락은 why 로.`;
  if (!why)
    return "why 가 비어 있다 — 이 항목이 왜 필요한지 없으면 나중에 아직 유효한지 판단할 수 없다.";
  if (why.length > WORK_CHAIN_WHY_MAX)
    return `why 가 너무 길다(${why.length} > ${WORK_CHAIN_WHY_MAX}).`;
  if (input.doneWhen && !WORK_CHAIN_DONE_WHEN_VALUES.includes(input.doneWhen))
    return `done_when 은 ${WORK_CHAIN_DONE_WHEN_VALUES.join("|")} 중 하나다.`;
  return null;
}

/** 검증 통과한 입력 → 항목. id/시각은 호출자가 준다(순수 유지). */
export function buildWorkChainItem(
  input: NewWorkChainItemInput,
  meta: { id: string; now: number; by: string },
): WorkChainItem {
  const item: WorkChainItem = {
    id: meta.id,
    what: input.what.trim(),
    why: input.why.trim(),
    afterTaskIds: uniqStrings(input.afterTaskIds),
    afterItemIds: uniqStrings(input.afterItemIds),
    taskIds: uniqStrings(input.taskIds),
    doneWhen: input.doneWhen ?? "done",
    createdAt: meta.now,
    updatedAt: meta.now,
    createdBy: meta.by,
  };
  const note = (input.note ?? "").trim();
  if (note) item.note = note;
  const missionLabel = normalizeMissionLabel(input.missionLabel);
  if (missionLabel) item.missionLabel = missionLabel;
  if (input.source === "auto") {
    item.source = "auto";
    const tool = (input.sourceTool ?? "").trim();
    if (tool) item.sourceTool = tool;
  }
  return item;
}

/**
 * ★자기보고 종료 거부 규칙. 티켓이 연결된 항목은 보드가 판정한다 — 오케가
 * "했다" 고 적어도 받지 않는다. 거부 사유 문자열 또는 null(허용).
 */
export function rejectSelfReportReason(
  item: WorkChainItem,
  reason: string | undefined,
): string | null {
  if (item.taskIds.length > 0 || item.missionLabel) {
    const bound = item.missionLabel
      ? `미션 '${item.missionLabel}'${item.taskIds.length ? ` / 티켓 ${item.taskIds.join(", ")}` : ""}`
      : `티켓 ${item.taskIds.join(", ")}`;
    return (
      `항목 '${item.what}' 은 ${bound} 에 연결돼 있다 — ` +
      `완료 판정은 그 티켓의 보드 상태(doneWhen=${item.doneWhen})가 한다. ` +
      `자기보고로 닫을 수 없다. 티켓을 실제로 ${item.doneWhen === "done" ? "DONE" : item.doneWhen === "review" ? "REVIEW" : "생성"} 으로 만들어라 ` +
      `(머지했으면 merge_and_close). 티켓과 무관해졌다면 close=dropped 로 사유를 적어라.`
    );
  }
  if (!(reason ?? "").trim()) {
    return "self_reported 로 닫으려면 reason 에 근거(무엇을 확인했는지)를 적어야 한다.";
  }
  return null;
}

/** 항목 배열에 삽입 — position 이 없거나 범위 밖이면 끝에. 원본은 건드리지 않는다. */
export function insertItem(
  items: readonly WorkChainItem[],
  item: WorkChainItem,
  position?: number,
): WorkChainItem[] {
  const next = [...items];
  if (
    typeof position === "number" &&
    Number.isInteger(position) &&
    position >= 0 &&
    position < next.length
  ) {
    next.splice(position, 0, item);
  } else {
    next.push(item);
  }
  return next;
}

// ── 텍스트 렌더 (MCP 도구 결과 / 오케 PTY 알림용) ────────────────────────

const STATE_LABEL: Record<WorkChainItemState, string> = {
  ready: "READY",
  waiting: "WAITING",
  done: "DONE",
  dropped: "DROPPED",
};

function shortTaskList(
  ids: readonly string[],
  titles?: Record<string, string>,
): string {
  return ids
    .map((id) => (titles?.[id] ? `${titles[id]}(${id})` : id))
    .join(", ");
}

export interface FormatWorkChainOptions {
  /** 티켓 id → 제목 (있으면 id 옆에 보여준다). */
  taskTitles?: Record<string, string>;
  /** 티켓 id → status (근거 줄에 보여준다). */
  taskStatuses?: TaskStatusLookup;
  /** 닫힌 항목(done/dropped)도 보여줄지. 기본 false = 열린 것만. */
  includeClosed?: boolean;
}

/** 항목 한 줄 + 근거/선행 줄. */
export function formatDerivedItem(
  d: DerivedWorkChainItem,
  index: number,
  opts: FormatWorkChainOptions = {},
): string {
  const { item } = d;
  const head = `${index + 1}. [${STATE_LABEL[d.state]}${
    d.state === "done" && d.evidence
      ? `·${d.evidence === "board" ? "board" : "SELF-REPORTED"}`
      : ""
  }] ${item.what} (id=${item.id})`;
  const lines = [head, `   why: ${item.why || "(없음)"}`];
  // 기계가 적은 항목은 그렇게 보여야 한다 — 오케가 "내가 적었나?" 를 되짚지 않도록.
  if (item.source === "auto") {
    lines.push(
      `   source: auto${item.sourceTool ? `(${item.sourceTool})` : ""} — 네 문장에서 자동 포착됨. 틀렸으면 close="dropped".`,
    );
  }
  if (item.missionLabel) {
    const combined =
      d.missionCount >= 2 ? ` — 미션 ${d.missionCount}개 합산` : "";
    if (d.unsplit) {
      lines.push(
        `   mission: '${item.missionLabel}' — unsplit (티켓 0개, 아직 안 쪼개짐. done 아님)${combined}`,
      );
    } else {
      lines.push(
        `   mission: '${item.missionLabel}' ${d.reachedCount}/${d.totalCount} reached (doneWhen=${item.doneWhen})${combined}`,
      );
    }
  }
  if (d.evidenceTaskIds.length) {
    const facts = d.evidenceTaskIds
      .map((id) => {
        const st = opts.taskStatuses?.[id];
        const title = opts.taskTitles?.[id];
        return `${title ? `${title} ` : ""}${id}=${st === null || st === undefined ? "MISSING" : st}`;
      })
      .join(", ");
    lines.push(`   evidence(doneWhen=${item.doneWhen}): ${facts}`);
  }
  if (d.state === "waiting") {
    const parts: string[] = [];
    if (d.pendingTaskIds.length)
      parts.push(
        `tasks not DONE: ${shortTaskList(d.pendingTaskIds, opts.taskTitles)}`,
      );
    if (d.pendingItemIds.length)
      parts.push(`items not done: ${d.pendingItemIds.join(", ")}`);
    lines.push(`   waiting on: ${parts.join(" / ")}`);
  } else if (item.afterTaskIds.length || item.afterItemIds.length) {
    lines.push(
      `   after: ${[
        ...item.afterTaskIds.map((id) => `task ${id}`),
        ...item.afterItemIds.map((id) => `item ${id}`),
      ].join(", ")} (모두 충족)`,
    );
  }
  if (d.missingTaskIds.length) {
    lines.push(
      `   ⚠️ 보드에 없는 티켓: ${d.missingTaskIds.join(", ")} — 지워졌거나 id 오타. 근거가 사라졌다.`,
    );
  }
  if (item.closed) {
    lines.push(
      `   closed: ${item.closed.kind} — ${item.closed.reason}${item.closed.by ? ` (by ${item.closed.by})` : ""}`,
    );
  }
  if (item.note) lines.push(`   note: ${item.note}`);
  return lines.join("\n");
}

/** 체인 전체 텍스트. 오케가 읽는 형태 — 맨 위에 "다음" 을 못 박는다. */
export function formatWorkChain(
  derived: DerivedWorkChain,
  opts: FormatWorkChainOptions = {},
): string {
  if (derived.items.length === 0) {
    return (
      "워크체인이 비어 있다. 다음에 할 일이 있으면 add_work_chain_item(what, why, " +
      "task_ids?/after_task_ids?) 로 적어라 — 대화 맥락은 요약되면 사라지지만 이 목록은 남는다."
    );
  }
  const lines: string[] = [];
  const closedCount = derived.items.length - derived.open.length;
  lines.push(
    `워크체인: open=${derived.open.length} (ready=${derived.ready.length}, waiting=${derived.waiting.length}), closed=${closedCount}`,
  );
  lines.push(
    derived.next
      ? `▶ 다음: ${derived.next.item.what} (id=${derived.next.item.id})`
      : derived.open.length
        ? "▶ 다음: 없음 — 열린 항목이 전부 선행 대기 중이다"
        : "▶ 다음: 없음 — 열린 항목이 없다",
  );
  const shown = opts.includeClosed ? derived.items : derived.open;
  shown.forEach((d, i) => {
    const idx = derived.items.indexOf(d);
    lines.push(formatDerivedItem(d, idx >= 0 ? idx : i, opts));
  });
  if (!opts.includeClosed && closedCount > 0) {
    lines.push(`(닫힌 항목 ${closedCount}개는 include_closed=true 로 본다)`);
  }
  return lines.join("\n");
}

/**
 * 티켓 상태가 바뀐 직후 오케에게 붙일 한두 줄 — "체인을 다시 봐라" 지점.
 * `before`/`after` 는 같은 items 를 그 티켓의 이전/이후 status 로 파생한 결과.
 * 변화가 없으면 "" (조용히). 순수.
 */
export function workChainNudgeForTaskChange(
  before: DerivedWorkChain,
  after: DerivedWorkChain,
  taskId: string,
): string {
  const beforeById = new Map(before.items.map((d) => [d.item.id, d]));
  const notes: string[] = [];
  for (const d of after.items) {
    const prev = beforeById.get(d.item.id);
    if (!prev || prev.state === d.state) continue;
    const touches =
      d.evidenceTaskIds.includes(taskId) ||
      d.item.afterTaskIds.includes(taskId);
    if (!touches) continue;
    if (d.state === "done") {
      notes.push(`✔ 체인 항목 '${d.item.what}' 완료 — 보드 근거(${taskId}).`);
    } else if (d.state === "ready" && prev.state === "waiting") {
      notes.push(
        `▶ 체인 항목 '${d.item.what}' 이 준비됨 — 선행 ${taskId} 끝남. 다음에 이걸 해라.`,
      );
    } else if (d.state === "waiting" && prev.state === "ready") {
      notes.push(
        `⏸ 체인 항목 '${d.item.what}' 이 다시 대기 — 선행 ${taskId} 가 DONE 이 아니게 됐다.`,
      );
    }
  }
  if (notes.length === 0) return "";
  const tail = after.next
    ? `체인 다음: ${after.next.item.what} (id=${after.next.item.id})`
    : `체인에 준비된 항목 없음 (open=${after.open.length})`;
  return `${notes.join("\n")}\n${tail} — get_work_chain 으로 확인.`;
}

/** get_all_tasks 같은 상시 조회 끝에 붙는 한 줄 요약. 비어 있으면 "". */
export function workChainFooter(derived: DerivedWorkChain): string {
  if (derived.open.length === 0) return "";
  const nextPart = derived.next
    ? `다음: ${derived.next.item.what} (id=${derived.next.item.id})`
    : "준비된 항목 없음(전부 선행 대기)";
  return `🔗 워크체인 open=${derived.open.length} — ${nextPart}. get_work_chain 으로 본다.`;
}

// ── 세션 인수인계 적재 (티켓 itSrsErpvtwUEcI4Deif) ────────────────────────
//
// 세션이 갈릴 때(모델 스위치 = `orchestrator-handoff.ts` 의 스냅샷) 체인이 통째로
// 빠져 있었다. 새 오케는 보드는 물려받고 "다음에 할 일" 만 못 물려받는다 — 그건
// 이 기능이 없애려던 실패 그 자체다(사장님 대기 항목이 거기 살아 있었다).
//
// ## ★파생 상태가 아니라 항목을 싣는다
// 실리는 건 `WorkChainItem` 의 **저장 필드**뿐이다. ready/waiting/done 은
// 안 싣는다 — 굳혀 보내면 스냅샷을 만든 순간의 판정이 새 세션까지 따라가고,
// 그 사이 티켓이 움직이면 새 오케는 낡은 판정을 사실로 읽는다. 상태는 새
// 세션이 `get_work_chain` 으로 **보드에서 다시 파생**한다(`deriveWorkChain`
// 단일 소스 유지). 여기서 `derived` 를 쓰는 건 오직 **무엇을 실을지 고르는**
// 용도다 — 고르기는 스냅샷 시점 사실이어도 되고, 실리는 값에는 안 들어간다.
//
// `missionLabel` 은 반드시 함께 싣는다(#1168). 라벨이 빠지면 새 세션은 그 항목의
// 미션 진행률(`missionCount`/`evidenceTaskIds`)을 아예 파생할 수 없다 —
// 진행률은 라벨 → 보드 조인으로만 나온다.

/**
 * 인수인계에 실리는 항목 — `WorkChainItem` 에서 **저장 필드만** 남긴 모양.
 * 파생 상태(state/evidence/진행률)는 의도적으로 없다(위 머리말).
 * 빈 배열·빈 값은 키 자체를 뺀다 — 항목당 키 오버헤드가 분량의 큰 몫이다.
 */
export interface WorkChainHandoffItem {
  id: string;
  what: string;
  why: string;
  doneWhen: WorkChainDoneWhen;
  afterTaskIds?: string[];
  afterItemIds?: string[];
  taskIds?: string[];
  missionLabel?: string;
  note?: string;
  source?: WorkChainSource;
  sourceTool?: string;
}

export interface WorkChainHandoffCarry {
  /** 체인 문서의 rev — 새 오케가 "내가 물려받은 버전" 을 말할 수 있게. */
  rev: number;
  /** 스냅샷을 만든 시점의 열린 항목 수. 판정이 아니라 **얼마를 잘랐나의 분모**다. */
  openCount: number;
  /** 실제로 실린 항목(체인 배열 순서 = 우선순위 그대로). */
  items: WorkChainHandoffItem[];
  /** 열려 있었지만 분량 때문에 못 실은 수. >0 이면 get_work_chain 이 필수다. */
  omittedCount: number;
}

/**
 * 항목 개수 상한. 실측 근거(2026-08-24, `formatHandoffPrompt` 바이트):
 * 빈 스냅샷 프롬프트 702B, 현실적 길이 항목 1개 ≈ 1.1KB, 30개면 34KB 다 —
 * 체인 하나가 인수인계 프롬프트 전체를 40배로 밀어낸다. 그래서 상한을 둔다.
 */
export const WORK_CHAIN_HANDOFF_ITEM_LIMIT = 12;

/**
 * 실린 항목 JSON 의 문자 예산.
 *
 * ★근거는 **대칭**이다: 이미 스냅샷에 실리는 활성 미션 1개가 타임라인
 * 12줄 × 220자(`TIMELINE_LIMIT`·`SUMMARY_LIMIT`) + 출력 꼬리 1000자 ≈ 3.6K 문자를
 * 쓴다. 체인은 "다음에 할 일" 목록 하나이므로 **미션 한 개 몫**을 준다.
 * 개수 상한만 두면 항목 길이가 최대(what 200 + why 500)일 때 12개가 1만 자를
 * 넘어 미션·보드를 밀어내므로, 개수와 분량 둘 다 건다.
 */
export const WORK_CHAIN_HANDOFF_CHAR_BUDGET = 4000;

/** 인수인계용 `why` 길이 상한 — 전문은 새 세션이 get_work_chain 으로 본다. */
export const WORK_CHAIN_HANDOFF_WHY_MAX = 160;

/** 인수인계용 `note` 길이 상한. */
export const WORK_CHAIN_HANDOFF_NOTE_MAX = 100;

function clip(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max)}…` : value;
}

/**
 * 파생 항목 → 인수인계 항목. ★`what` 은 절대 자르지 않는다 — 항목의 신원이자
 * 자동 포착 중복 판정(`dedupeAgainstChain`)의 키다. 잘라 보내면 새 세션이 같은
 * 약속을 다시 말했을 때 중복으로 안 잡히고 항목이 둘로 늘어난다.
 */
function toHandoffItem(item: WorkChainItem): WorkChainHandoffItem {
  const out: WorkChainHandoffItem = {
    id: item.id,
    what: item.what,
    why: clip(item.why, WORK_CHAIN_HANDOFF_WHY_MAX),
    doneWhen: item.doneWhen,
  };
  if (item.afterTaskIds.length) out.afterTaskIds = [...item.afterTaskIds];
  if (item.afterItemIds.length) out.afterItemIds = [...item.afterItemIds];
  if (item.taskIds.length) out.taskIds = [...item.taskIds];
  if (item.missionLabel) out.missionLabel = item.missionLabel;
  if (item.note) out.note = clip(item.note, WORK_CHAIN_HANDOFF_NOTE_MAX);
  if (item.source) out.source = item.source;
  if (item.sourceTool) out.sourceTool = item.sourceTool;
  return out;
}

/**
 * 열린 항목만 인수인계용으로 고른다. 닫힌 항목(done/dropped)은 안 싣는다 —
 * 새 세션이 물려받아야 하는 건 **남은 일**이고, 끝난 일의 근거는 보드에 있다.
 *
 * ★`▶ 다음`(첫 ready)은 상한·예산을 넘겨서라도 반드시 싣는다. 이 기능의 존재
 * 이유가 "다음 할 일을 안 잊는다" 인데, 앞자리가 전부 대기 항목이면 잘림에
 * 그것부터 떨어져 나간다. 다만 **어느 것이 다음인지는 표시하지 않는다** —
 * 그게 곧 굳은 파생 상태이므로, 새 세션이 보드에서 다시 판정한다.
 */
export function buildWorkChainHandoff(
  derived: DerivedWorkChain,
  opts: {
    rev?: number;
    itemLimit?: number;
    charBudget?: number;
  } = {},
): WorkChainHandoffCarry {
  const itemLimit = opts.itemLimit ?? WORK_CHAIN_HANDOFF_ITEM_LIMIT;
  const charBudget = opts.charBudget ?? WORK_CHAIN_HANDOFF_CHAR_BUDGET;
  const items: WorkChainHandoffItem[] = [];
  const taken = new Set<string>();
  let used = 0;
  for (const d of derived.open) {
    if (items.length >= itemLimit) break;
    const carried = toHandoffItem(d.item);
    const cost = JSON.stringify(carried).length;
    // 첫 항목은 예산을 넘겨도 싣는다 — 빈 체인으로 넘기는 것이 더 나쁘다.
    if (items.length > 0 && used + cost > charBudget) break;
    used += cost;
    items.push(carried);
    taken.add(d.item.id);
  }
  const next = derived.next;
  if (next && !taken.has(next.item.id)) {
    items.push(toHandoffItem(next.item));
    taken.add(next.item.id);
  }
  return {
    rev: opts.rev ?? 0,
    openCount: derived.open.length,
    items,
    omittedCount: Math.max(0, derived.open.length - items.length),
  };
}

/** 짧은 랜덤 id — 문서 안 배열 요소라 Firestore 자동 id 가 없다. 순수 PRNG 주입 가능. */
export function newWorkChainItemId(random: () => number = Math.random): string {
  const alphabet = "abcdefghijklmnopqrstuvwxyz0123456789";
  let out = "wc_";
  for (let i = 0; i < 10; i++) {
    out += alphabet[Math.floor(random() * alphabet.length)];
  }
  return out;
}
