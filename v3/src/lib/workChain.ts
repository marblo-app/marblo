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
  buildWorkChainItem,
  deriveWorkChain,
  insertItem,
  newWorkChainItemId,
  normalizeWorkChainItems,
  referencedTaskIds,
  validateNewItem,
  type DerivedWorkChain,
  type DerivedWorkChainItem,
  type NewWorkChainItemInput,
  type TaskStatusLookup,
  type WorkChainDocShape,
  type WorkChainEvidence,
  type WorkChainItem,
  type WorkChainItemState,
  type WorkChainTaskStatus,
} from "../../electron/mcp-server/work-chain-core";
import type { TaskStatusLookup as Lookup } from "../../electron/mcp-server/work-chain-core";

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
