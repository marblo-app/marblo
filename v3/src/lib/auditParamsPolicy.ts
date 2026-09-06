/**
 * 원장 `params` 노출 정책 — **렌더러 사본** (티켓 yJLfoRpqvCcvarIXcT23).
 *
 * ★권위는 `electron/mcp-server/ledger.ts` 다. 여기서 그걸 import 하지 않고 다시
 * 적는 이유는 `types/audit.ts` 가 스키마를 다시 적는 이유와 같다 — 렌더러
 * tsconfig 가 electron 트리를 포함하지 않고(node:crypto 를 타는 모듈이라 포함시켜
 * 서도 안 된다), mcp-server tsconfig 는 `rootDir: "."` 이라 반대 방향 import 도
 * 막힌다. 두 벌이 갈라지는 것은 `tests/unit/audit-params-display-guard.test.ts`
 * 의 드리프트 가드가 잡는다. 목록을 고칠 때는 두 파일을 같이 고친다.
 *
 * ★이 파일이 하는 일은 **두 가지**이고 둘은 다르다:
 *  1. `ledgerParamsAreScrubbed` — 이 문서가 write 화이트리스트를 통과했는가
 *  2. `displayableLedgerParams` — 통과 못 한 **옛 문서**에서 화면에 내보낼 것
 *
 * 2번이 필요한 이유: write 를 고쳐도 **기존 문서에는 원문이 이미 남아 있고,
 * 원장은 불변이라 못 지운다.** 화면이 같이 막지 않으면 수리가 절반만 된다.
 */

/** 권위: ledger.ts 의 같은 이름 상수. */
export const LEDGER_PARAMS_POLICY = "whitelist-v1";

/** 권위: ledger.ts. 식별자 칸의 최대 길이. */
export const LEDGER_PARAM_ID_MAX_CHARS = 120;

/**
 * ★**안전하게 보여도 되는 필드 목록 — 1등급: 식별자·열거값.**
 * 분석 페이지가 원장을 넓게 노출할 때 쓰는 기준이 이것이다. 값이 저엔트로피
 * 식별자/열거값인 칸만 들어간다. 권위본의 주석에 각 항목의 근거가 있다.
 */
export const LEDGER_PARAM_ID_KEYS: readonly string[] = [
  "after_item_ids",
  "after_task_ids",
  "afterItemIds",
  "afterTaskIds",
  "agent_id",
  "agent_name",
  "agentId",
  "agentName",
  "all_projects",
  "allProjects",
  "blocking",
  "complexity",
  "dependsOnPrevious",
  "effort",
  "end",
  "event_id",
  "eventId",
  "file_id",
  "fileId",
  "flow_id",
  "flowId",
  "force",
  "from",
  "instruction_id",
  "instructionId",
  "item_id",
  "itemId",
  "kind",
  "limit",
  "message_id",
  "messageId",
  "mission_id",
  "missionId",
  "model",
  "offset",
  "page_id",
  "pageId",
  "pane_id",
  "paneId",
  "pr",
  "pr_url",
  "previous",
  "priority",
  "project_id",
  "projectId",
  "prUrl",
  "question_id",
  "questionId",
  "reopen",
  "role",
  "source_type",
  "sourceType",
  "spawned_model",
  "spawnedModel",
  "start",
  "status",
  "success",
  "target_agent_id",
  "targetAgent",
  "targetAgentId",
  "task_id",
  "taskId",
  "tier",
  "to",
  "url",

  // ── 시스템이 스스로 만드는 이벤트의 계수 칸(ledger-spool.ts §11) ──
  // 사람 입력이 지나가지 않는 자리다. 여기를 비우면 "몇 건이 유실됐나"가 사라져
  // 유실 기록의 유실이 화면에서 되살아난다.
  "confirmedMissing",
  "droppedCount",
  "firstDroppedAtMs",
  "firstUnresolvedAtMs",
  "lastDroppedAtMs",
  "lastUnresolvedAtMs",
  "maxBytes",
  "maxRecords",
  "unresolvedCount",
];

/**
 * ★**안전하게 보여도 되는 필드 목록 — 2등급: 표시용 자유 텍스트.**
 * 이 키들은 **레드액트본**으로만 원장에 있다(원문 아님). 그래서 화면에 그려도
 * 된다. 단 그건 정책 표식이 박힌 문서에 한한 이야기이고, 옛 문서의 같은 키에는
 * 원문이 들어 있으므로 `displayableLedgerParams` 가 걷어낸다.
 */
export const LEDGER_PARAM_TEXT_KEYS: readonly string[] = [
  "answer",
  "approach",
  "changes",
  "comment",
  "context",
  "description",
  "done_when",
  "edges",
  "feedback",
  "goal",
  "keyword",
  "location",
  "message",
  "name",
  "nodes",
  "note",
  "problem",
  "query",
  "question",
  "reason",
  "scope",
  "subject",
  "summary",
  "tags",
  "tasks",
  "text",
  "title",
  "verification",
  "what",
  "why",
];

const ID_KEY_SET: ReadonlySet<string> = new Set(LEDGER_PARAM_ID_KEYS);

/** 이 원장 문서의 `params` 가 write 화이트리스트를 통과했는가. */
export function ledgerParamsAreScrubbed(log: {
  paramsPolicy?: string | null;
}): boolean {
  return log.paramsPolicy === LEDGER_PARAMS_POLICY;
}

export interface DisplayableLedgerParams {
  params: Record<string, unknown>;
  /** 옛 문서라 일부(자유 텍스트)를 걷어냈는가. 화면이 그 사실을 말하는 데 쓴다. */
  withheld: boolean;
}

/**
 * 화면에 내보낼 `params`.
 *
 * - 정책 표식이 있는 문서 → **그대로**. write 가 이미 한 일을 두 번 하지 않는다.
 * - 표식이 없는 옛 문서 → **1등급 키만**, 그것도 값이 식별자 모양일 때만.
 *   자유 텍스트(2등급)는 옛 문서에서는 **원문**이므로 통과시키지 않는다 —
 *   여기서 마스킹으로 때우지 않는 이유는 반쯤 가린 원문이 가장 나쁘기 때문이다.
 *
 * ★목표는 원장을 감추는 것이 아니라 **무엇이 안전하게 보여도 되는지 선을 긋는
 * 것**이다. 그래서 옛 문서도 통째로 비우지 않고 티켓·상태·역할은 남긴다.
 */
export function displayableLedgerParams(log: {
  paramsPolicy?: string | null;
  params?: Record<string, unknown> | null;
}): DisplayableLedgerParams {
  const params = log.params ?? {};
  if (ledgerParamsAreScrubbed(log)) return { params, withheld: false };
  const out: Record<string, unknown> = {};
  let withheld = false;
  for (const [key, value] of Object.entries(params)) {
    if (!ID_KEY_SET.has(key) || !isDisplayableIdValue(value)) {
      withheld = true;
      continue;
    }
    out[key] = value;
  }
  return { params: out, withheld };
}

/**
 * 옛 문서의 1등급 값이 실제로 식별자 모양인가.
 *
 * 키 이름만 믿을 수 없다 — 옛 문서는 어떤 값이든 들어갈 수 있었고, `to` 처럼
 * 툴마다 뜻이 다른 키도 있다. 객체·배열은 통째로 거른다(그 안에 무엇이 있는지
 * 옛 문서에 대해서는 보증할 수 없다).
 */
function isDisplayableIdValue(value: unknown): boolean {
  if (value === null) return true;
  if (typeof value === "boolean" || typeof value === "number") return true;
  if (typeof value !== "string") return false;
  if (value.length > LEDGER_PARAM_ID_MAX_CHARS) return false;
  return !/[@]|\s{2,}|[\r\n]/.test(value);
}
