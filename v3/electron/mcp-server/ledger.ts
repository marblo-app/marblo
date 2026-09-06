/**
 * 감사 원장(ledger) L0 — 스키마와 순수 파생 함수.
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§5 스키마 · §8 워크트리 정체성 · §15 kind 분류)
 *
 * 이 파일은 **동작을 바꾸지 않는다.** `audit_logs` 한 건에 실리는 필드를 늘릴 뿐이고,
 * 새 캡처 지점을 만들지 않는다 — 기록은 여전히 `auditedTool` 래퍼(tools.ts) 단일
 * 초크포인트에서만 나간다(스펙 §2 "재구현 금지"). 렌더러에 훅을 걸면 사람이 UI 를
 * 클릭한 경우만 잡히고 정작 감사 대상인 AI 행위가 통째로 빠진다.
 *
 * 후속 슬라이스: L1 스풀(§7) · L2 룰(§4/§9) · L3 체인(§6) · L4 뷰(§15).
 */

import { createHash } from "node:crypto";
import * as path from "node:path";

/**
 * 이벤트 분류(§15).
 *
 * - `action`   — MCP 툴 호출. 기존 `audit_logs` 전부가 여기 속한다(하위호환 기본값)
 * - `lifecycle`— 앱/MCP 기동·종료, 빌드 산출물 로드. "이 시점에 무엇이 돌고 있었나"
 * - `deploy`   — 머지·배포·릴리스. "이 수정이 언제 실물에 들어갔나"
 *
 * 분류를 슬라이스 1 에 넣는 이유: 스키마 변경은 나중이 가장 비싸다. 소비하는 UI 는
 * 뒤로 미뤄도 된다.
 */
export type LedgerEventKind = "action" | "lifecycle" | "deploy";

export const LEDGER_KIND_DEFAULT: LedgerEventKind = "action";

/**
 * 원장 한 건. 굵은 주석이 이번 슬라이스 신규 필드(§5).
 *
 * 체인 필드(`seq`/`prevHash`/`hash`)는 **자리만 만들고 이번엔 쓰지 않는다** — L3
 * 담당이다. 타입에서 optional 인 것과 실제 write 에서 생략하는 것이 일치해야
 * L3 가 "체인이 붙은 이벤트"와 "붙기 전 이벤트"를 필드 존재 여부로 구분할 수 있다.
 * (§10 — 소급 무결성 보증은 포기하고 제네시스 체크포인트 이후만 보증한다.)
 */
export interface LedgerEvent {
  // ── 기존 필드 (변경 없음) ──
  projectId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;

  // ── 신규(§5) ──
  /** 이벤트 분류. 기존 경로는 항상 `action`. */
  kind: LedgerEventKind;
  /** 발주한 사람의 uid. MCP 서버가 custom-token 으로 인증한 주체 = 로그인 사용자. */
  actorUid: string | null;
  /** 이 에이전트가 어떤 모델로 돌고 있는가 (claude/codex/agy/…). */
  model: string | null;
  /** 모델 티어(= 스폰 시 complexity: simple/standard/complex). */
  tier: string | null;
  /** 지시문 **해시만**. 원문은 절대 담지 않는다 — 아래 hashInstruction 주석 참조. */
  instructionHash: string | null;
  /** scrub+truncate 된 표시용 지시문. 안전 검증 실패 시 저장하지 않는다. */
  instructionRedacted: string | null;
  /** 이 행위가 속한 티켓. */
  taskId: string | null;
  /** 경로 규약에서 우선 파생하고, 규약 밖이면 taskId 근거로 보강한 결정적 문자열(§8). */
  worktreeId: string | null;

  // ── params 노출 정책 (티켓 yJLfoRpqvCcvarIXcT23) ──
  /**
   * `params` 가 어느 정책으로 걸러졌는가. 항상 `LEDGER_PARAMS_POLICY`.
   * ★이 필드가 **없는** 문서 = 정책 이전에 쌓인 **원문** 문서다. 원장은 불변이라
   * 그 원문은 못 지운다 — 그래서 뷰가 이 필드를 보고 렌더를 끊는다.
   */
  paramsPolicy: string;
  /** 화이트리스트에서 떨어진 최상위 키 **이름**들. 값은 담지 않는다. */
  paramsOmitted: string[];
  /** 인자 **원본** 전체의 해시. 원문 대조용 — instructionHash 와 같은 취지. */
  paramsHash: string | null;

  // ── 체인(§6) — L3 가 채운다. 이번 슬라이스는 write 하지 않는다 ──
  /** (projectId, agentId) 체인 내 순번. 순서 권위는 createdAt 이 아니라 이것이다. */
  seq?: number;
  prevHash?: string;
  hash?: string;
}

/** 원장에 실제로 write 하는 필드 — 체인 필드는 빠진다(L3 담당). */
export type LedgerEventWrite = Omit<LedgerEvent, "seq" | "prevHash" | "hash">;

// ── 워크트리 정체성 (§8) ──────────────────────────────────────────

/**
 * 에이전트 워크트리 풀의 경로 규약: `<home>/.marblo/worktrees/<projectId>/<taskId>`.
 * WorktreeManager(worktree-manager.ts) 가 실제로 만드는 경로와 같은 규약이다.
 */
export function worktreesRoot(homeDir: string): string {
  return path.join(homeDir, ".marblo", "worktrees");
}

/**
 * Firestore 문서 id 로 그럴듯한지. 자동 id 는 20자 영숫자지만 다른 길이도 있을 수
 * 있으므로 폭을 좀 두되, 경로 조각으로 들어올 수 있는 위험한 값(`.`/`..`/공백/
 * 구분자)은 거른다. 애매하면 통과시키지 않는다 — 억지 귀속보다 null 이 낫다(§8).
 */
function looksLikeDocId(segment: string): boolean {
  return /^[A-Za-z0-9_-]{1,128}$/.test(segment);
}

export interface WorktreeIdentity {
  projectId: string;
  taskId: string;
}

/**
 * 경로에서 워크트리 정체성을 **역산**한다. 순수 함수 — 디스크도 앱 상태도 안 본다.
 *
 * ★왜 앱 상태가 아니라 경로에서 읽는가:
 * 지금 마블로 repo 하나가 projectId 두 개(GFB8Jn…, uVJL1v…)로 이중 등록돼 있고
 * 양쪽 버킷에 워크트리가 흩어져 있다. 앱 상태(현재 바인딩된 projectId)로 귀속하면
 * **같은 워크트리가 조회 시점에 따라 다른 프로젝트로 보인다** — 감사 원장에서
 * 가장 나쁜 성질이다. 경로는 워크트리를 만든 시점에 확정돼 이후 앱 상태가 흔들려도
 * 변하지 않으므로, 이중 등록 상황에서 유일하게 안정적인 근거다.
 *
 * 이중 등록 자체는 이 함수가 숨기지 않는다: 원장의 `projectId`(앱 상태)와
 * `worktreeId` 접두사(경로)가 어긋나면 그대로 드러난다. 감사 뷰(L4)가 읽을 신호다.
 *
 * 하위 디렉터리도 받는다 — 에이전트 CLI 의 cwd 가 워크트리 루트가 아니라
 * `<worktree>/v3` 같은 하위일 수 있는데, 앞 두 조각은 그래도 결정적이다.
 *
 * 규약 밖 경로(수동 생성, /tmp/ 등)는 **null**. 이 함수 단독으로는 억지로
 * 귀속시키지 않는다 — 판별 불가한 것을 확실한 것처럼 보이게 만드는 게 감사에서는
 * 가장 나쁘다(§8). 단, 원장 이벤트 조립 단계에서는 별도 taskId 근거가 있으면
 * `deriveLedgerWorktreeId` 가 `<projectId>/<taskId>` 로 보강한다.
 */
export function parseWorktreePath(
  absPath: string,
  opts: { homeDir: string },
): WorktreeIdentity | null {
  if (!absPath) return null;
  const pool = worktreesRoot(opts.homeDir);
  const resolved = path.resolve(absPath);
  // 정확히 세그먼트 경계로 비교한다. `~/.marblo/worktrees-old/…` 같은 이웃 경로가
  // 단순 문자열 접두사 검사에 걸려 오귀속되는 것을 막는다.
  if (!resolved.startsWith(pool + path.sep)) return null;

  const rest = resolved.slice(pool.length + path.sep.length);
  const segments = rest.split(path.sep).filter(Boolean);
  if (segments.length < 2) return null; // 풀 바로 아래(프로젝트 버킷)만으론 티켓 미상

  const [projectId, taskId] = segments;
  if (!looksLikeDocId(projectId) || !looksLikeDocId(taskId)) return null;
  return { projectId, taskId };
}

/**
 * `worktreeId` — 새 Firestore 컬렉션·문서가 아니다. 경로에서 결정적으로 파생되는
 * 문자열 하나다(§5/§8).
 *
 * 워크트리가 물리적으로 삭제돼도 원장의 이 값은 남는다. "삭제된 워크트리에서 무슨
 * 일이 있었나" 를 답할 수 있어야 감사가 성립하므로 이게 오히려 요구사항이다.
 */
export function deriveWorktreeId(
  absPath: string,
  opts: { homeDir: string },
): string | null {
  const identity = parseWorktreePath(absPath, opts);
  return identity ? `${identity.projectId}/${identity.taskId}` : null;
}

/**
 * 원장 이벤트의 worktreeId 를 결정한다.
 *
 * 1. cwd 가 워크트리 규약 안이면 cwd 가 최우선 근거다. 이중 등록 프로젝트처럼 앱
 *    상태와 경로가 어긋난 경우에도 경로 접두사를 숨기지 않는다.
 * 2. cwd 가 규약 밖이어도 taskId 가 있으면 완료내역과 같은 단위인
 *    `<projectId>/<taskId>` 로 귀속한다. 에이전트가 per-task 워크트리 밖에서
 *    MCP 툴을 호출한 경우 감사 뷰가 "Outside worktree convention" 으로 떠버리는
 *    것을 막기 위한 명시적 정책이다.
 * 3. taskId 근거도 없으면 null 로 둔다. 이 경우는 여전히 억지 귀속 금지다.
 */
export function deriveLedgerWorktreeId(input: {
  cwd?: string;
  homeDir?: string;
  projectId: string;
  taskId: string | null;
}): string | null {
  const fromCwd =
    input.cwd && input.homeDir
      ? deriveWorktreeId(input.cwd, { homeDir: input.homeDir })
      : null;
  if (fromCwd) return fromCwd;

  if (
    looksLikeDocId(input.projectId) &&
    input.taskId &&
    looksLikeDocId(input.taskId)
  ) {
    return `${input.projectId}/${input.taskId}`;
  }
  return null;
}

// ── 지시문 해시 (§5) ──────────────────────────────────────────────

export const INSTRUCTION_HASH_PREFIX = "sha256:";
export const INSTRUCTION_REDACTED_MAX_CHARS = 1200;
const INSTRUCTION_REDACTED_SUFFIX = "\n[truncated]";

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KR_RE = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const PHONE_INTL_RE = /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const HOME_PATH_RE =
  /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|[A-Za-z]:\\Users\\[^\\\s"']+)/g;
const WORKTREE_PATH_RE =
  /(?:~|\/Users\/[^/\s"']+|\/home\/[^/\s"']+)?\/?\.marblo\/worktrees\/[A-Za-z0-9_-]+(?:\/[A-Za-z0-9_-]+)?(?:\/[^\s"']*)?/g;
const SECRET_ASSIGNMENT_RE =
  /\b[A-Z0-9_]*(?:API[_-]?KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL|CLIENT[_-]?SECRET|PRIVATE[_-]?KEY|AUTHORIZATION)[A-Z0-9_]*\s*[:=]\s*([^\s"'`]+)/gi;
const KNOWN_SECRET_RE =
  /(?:sk-ant-[A-Za-z0-9_-]{16,}|sk-proj-[A-Za-z0-9_-]{16,}|sk-or-v?1?-?[A-Za-z0-9_-]{16,}|sk_live_[A-Za-z0-9]{16,}|sk_test_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|pk_live_[A-Za-z0-9]{16,}|sk-[A-Za-z0-9_-]{16,}|AIza[A-Za-z0-9_-]{16,}|ya29\.[A-Za-z0-9_-]{16,}|1\/\/0[A-Za-z0-9_-]{16,}|xai-[A-Za-z0-9_-]{16,}|github_pat_[A-Za-z0-9_]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|glpat-[A-Za-z0-9_-]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|hooks\.slack\.com\/services\/[A-Za-z0-9/_-]+|(?:AKIA|ASIA)[A-Z0-9]{16}|hf_[A-Za-z0-9]{16,}|nvapi-[A-Za-z0-9_-]{16,}|pplx-[A-Za-z0-9]{16,}|r8_[A-Za-z0-9]{16,}|gsk_[A-Za-z0-9]{16,}|npm_[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9]{16,}|vercel_[A-Za-z0-9]{16,})/g;
const JWT_RE = /eyJ[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]{4,}\.[A-Za-z0-9_-]+/g;
const PEM_PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/g;
const CREDENTIAL_URL_RE =
  /\b(?:https?|postgres|postgresql|mysql|mongodb(?:\+srv)?|redis|rediss|amqp|amqps|mssql|ftp|sftp)[^\s:]*:\/\/[^\s/:@]+:[^\s@]+@/gi;
const RESIDUAL_BEARER_TOKEN_RE = /\bBearer\s+[A-Za-z0-9._-]{16,}/g;
const RESIDUAL_OAUTH_TOKEN_RE = /\boauth[_-]?[A-Za-z0-9._-]{16,}/gi;

function resetAndTest(re: RegExp, value: string): boolean {
  re.lastIndex = 0;
  return re.test(value);
}

/**
 * 지시문의 해시. **원문은 원장에 담지 않는다.**
 *
 * 원문을 복제하면 지시문에 섞인 비밀·고객 데이터까지 불변 컬렉션에 영구 박제된다.
 * 불변성은 잘못 넣은 것도 못 지운다는 뜻이므로 감사 원장에는 오히려 적게 담아야
 * 한다. 원문 대조가 필요하면 해시로 티켓과 맞춘다(§5).
 *
 * 빈 문자열/공백뿐이면 null — "해시가 있다"가 "지시문이 있었다"를 뜻하게 유지한다.
 */
export function hashInstruction(
  instruction: string | undefined,
): string | null {
  if (!instruction || !instruction.trim()) return null;
  return (
    INSTRUCTION_HASH_PREFIX +
    createHash("sha256").update(instruction, "utf8").digest("hex")
  );
}

function maskSecretAssignments(value: string): string {
  return value.replace(
    SECRET_ASSIGNMENT_RE,
    (match: string, secret: string) =>
      match.slice(0, match.length - secret.length) + "<REDACTED>",
  );
}

function truncateInstructionRedacted(value: string): string {
  if (value.length <= INSTRUCTION_REDACTED_MAX_CHARS) return value;
  const keep = Math.max(
    0,
    INSTRUCTION_REDACTED_MAX_CHARS - INSTRUCTION_REDACTED_SUFFIX.length,
  );
  return value.slice(0, keep).trimEnd() + INSTRUCTION_REDACTED_SUFFIX;
}

function hasResidualUnsafeInstructionText(value: string): boolean {
  return (
    resetAndTest(KNOWN_SECRET_RE, value) ||
    resetAndTest(JWT_RE, value) ||
    resetAndTest(PEM_PRIVATE_KEY_RE, value) ||
    resetAndTest(CREDENTIAL_URL_RE, value) ||
    resetAndTest(RESIDUAL_BEARER_TOKEN_RE, value) ||
    resetAndTest(RESIDUAL_OAUTH_TOKEN_RE, value) ||
    resetAndTest(EMAIL_RE, value) ||
    resetAndTest(PHONE_KR_RE, value) ||
    resetAndTest(PHONE_INTL_RE, value)
  );
}

/**
 * 지시문 표시용 비식별 텍스트.
 *
 * 원장에는 원문을 절대 저장하지 않는다. 알려진 secret/PII 는 먼저 마스킹하고,
 * 같은 detector 를 다시 통과시켜 잔존하면 null 로 접는다. 즉, 마스킹이 실패한
 * 것으로 의심되면 표시용 필드 자체를 저장하지 않는 안전측 정책이다.
 */
export function redactInstructionForLedger(
  instruction: string | undefined,
): string | null {
  if (!instruction || !instruction.trim()) return null;
  const scrubbed = scrubForLedger(instruction);

  if (hasResidualUnsafeInstructionText(scrubbed)) return null;
  return truncateInstructionRedacted(scrubbed);
}

/**
 * 원장에 실을 텍스트 한 벌을 마스킹한다. 지시문과 툴 인자가 **같은** 마스킹을
 * 쓰게 하려고 뽑아 놓은 것이다 — 두 벌로 두면 한쪽에만 새 패턴이 들어가고 다른
 * 쪽은 조용히 뒤처진다(이 티켓이 정확히 그 모양의 사고다).
 */
function scrubForLedger(value: string): string {
  return maskSecretAssignments(value)
    .replace(KNOWN_SECRET_RE, "<API_KEY>")
    .replace(JWT_RE, "<TOKEN>")
    .replace(PEM_PRIVATE_KEY_RE, "<PRIVATE_KEY>")
    .replace(CREDENTIAL_URL_RE, "<CREDENTIAL_URL>")
    .replace(EMAIL_RE, "<EMAIL>")
    .replace(PHONE_KR_RE, "<PHONE>")
    .replace(PHONE_INTL_RE, "<PHONE>")
    .replace(WORKTREE_PATH_RE, "<WORKTREE_PATH>")
    .replace(HOME_PATH_RE, "<USER_HOME>");
}

// ── params 화이트리스트 (티켓 yJLfoRpqvCcvarIXcT23) ─────────────

/**
 * `params` 노출 정책의 판별 표식.
 *
 * ★이 값이 문서에 박혀 있는 것 하나만이 "이 문서의 `params` 는 화이트리스트를
 * 통과했다"의 근거다. 표식이 없는 문서는 **정책 이전에 쌓인 원문 문서**이고,
 * 원장은 불변이라 그 원문은 **지울 수 없다** — 그래서 뷰가 표식을 보고 렌더를
 * 끊는다(src/lib/auditParamsPolicy.ts). 표식을 문서 밖(예: 배포 시각 비교)에서
 * 추론하지 않는 이유: 스풀은 30분 뒤에 재적재될 수 있어 createdAt 과 정책 적용
 * 시점의 대소가 뒤집힌다.
 *
 * 정책을 바꿀 때는 이 문자열도 함께 올린다 — 그래야 뷰가 옛 정책 문서를 옛
 * 정책으로 다룰 수 있다.
 */
export const LEDGER_PARAMS_POLICY = "whitelist-v1";

export const PARAMS_HASH_PREFIX = "sha256:";

/** 식별자/열거값 칸의 최대 길이. 이걸 넘으면 그건 식별자가 아니라 산문이다. */
export const LEDGER_PARAM_ID_MAX_CHARS = 120;
/** 표시용 자유 텍스트의 최대 길이. 지시문(1200)보다 짧게 잡는다 — 원장에 산문을 쌓지 않는다. */
export const LEDGER_PARAM_TEXT_MAX_CHARS = 200;
const LEDGER_PARAM_TEXT_SUFFIX = "…[truncated]";
/** 중첩 깊이 상한. 넘으면 버린다 — 깊은 구조에 원문을 숨겨 통과시키는 경로를 막는다. */
const LEDGER_PARAM_MAX_DEPTH = 4;
/** 배열 원소 상한. 길이 요약(create_tasks_bulk 의 `tasks.length`)은 이 안에서 보존된다. */
const LEDGER_PARAM_MAX_ARRAY = 50;

/**
 * ★**안전하게 보여도 되는 필드 목록 (분석 페이지가 쓸 기준) — 1등급: 식별자·열거값.**
 *
 * 여기 있는 키의 문자열 값은 **그대로** 원장에 남고 화면에 그대로 뜬다. 그래서
 * 기준은 "값이 저엔트로피 식별자/열거값인가" 하나다 — 티켓 id, 역할, 상태,
 * 모델명, 개수, 불리언. 사람이 자유롭게 타이핑하는 칸은 여기 두지 않는다.
 *
 * ★키 이름만으로는 부족하다. `to` 는 `update_task_status` 에서는 상태값이지만
 * `mail_send` 에서는 **수신자 메일 주소**다. 그래서 값 검사(assertSafeIdValue)가
 * 실제 안전망이고, 이 목록은 모양을 통제할 뿐이다.
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
 *
 * 여기 있는 키는 **원문이 아니라 레드액트본**으로 남는다: 시크릿·PII·경로를
 * 마스킹하고 200자로 자르고, 마스킹이 미덥지 않으면(잔존 탐지) 키 자체를 버린다.
 * `instructionRedacted` 가 지시문에 대해 이미 하고 있는 그 파이프라인 그대로다.
 *
 * ★왜 원문 대신 이걸 남기는가: 원장은 "무엇이 안전하게 보여도 되는지"의 선을
 * 긋는 물건이지 감추는 물건이 아니다. 여기를 통째로 비우면 감사 뷰의 detail 이
 * 죽고 분석 페이지가 쓸모없어진다.
 *
 * ★여기 **없는** 것들과 그 이유:
 * - `instruction`/`instructions`/`prompt`/`initial_prompt` — 지시문의 자리는
 *   `instructionHash` + `instructionRedacted` 다. params 로 두 벌 두면 한쪽만
 *   고쳐지는 순간 갈라진다(이 티켓이 정확히 그렇게 생겼다).
 * - `body` — 메일 본문. "무엇을 보냈나"는 `subject` 로 충분하고, 본문은 외부로
 *   나간 벌크 콘텐츠라 원장에 눕힐 이유가 없다.
 * - `value` — 설정 값. 이름만으로 비밀 여부를 알 수 없다.
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
const TEXT_KEY_SET: ReadonlySet<string> = new Set(LEDGER_PARAM_TEXT_KEYS);

type ParamTier = "id" | "text";

function paramTier(key: string): ParamTier | null {
  if (ID_KEY_SET.has(key)) return "id";
  if (TEXT_KEY_SET.has(key)) return "text";
  return null;
}

/** 버림. `undefined` 를 쓰면 "값이 없었다"와 구분이 안 되므로 전용 심볼을 쓴다. */
const OMIT = Symbol("ledger-param-omit");

function truncateParamText(value: string): string {
  if (value.length <= LEDGER_PARAM_TEXT_MAX_CHARS) return value;
  const keep = Math.max(
    0,
    LEDGER_PARAM_TEXT_MAX_CHARS - LEDGER_PARAM_TEXT_SUFFIX.length,
  );
  return value.slice(0, keep).trimEnd() + LEDGER_PARAM_TEXT_SUFFIX;
}

/**
 * 표시용 자유 텍스트 한 칸. `redactInstructionForLedger` 와 **같은 파이프라인**이고
 * 길이 상한만 다르다(지시문 1200 / 인자 200).
 */
export function redactParamTextForLedger(value: string): string | null {
  if (!value.trim()) return null;
  const scrubbed = scrubForLedger(value);
  if (hasResidualUnsafeInstructionText(scrubbed)) return null;
  const truncated = truncateParamText(scrubbed);
  return truncated.trim() ? truncated : null;
}

/**
 * 식별자 칸 한 칸. 마스킹해서 통과시키지 않는다 — 식별자에 마스킹이 필요하다는
 * 것 자체가 그 칸이 식별자가 아니라는 증거이므로 **버린다.**
 */
function safeIdValue(value: string): string | typeof OMIT {
  const trimmed = value.trim();
  if (!trimmed) return OMIT;
  if (trimmed.length > LEDGER_PARAM_ID_MAX_CHARS) return OMIT;
  if (hasResidualUnsafeInstructionText(trimmed)) return OMIT;
  if (scrubForLedger(trimmed) !== trimmed) return OMIT;
  return trimmed;
}

function projectParamValue(
  key: string,
  value: unknown,
  depth: number,
): unknown | typeof OMIT {
  if (depth > LEDGER_PARAM_MAX_DEPTH) return OMIT;
  const tier = paramTier(key);
  if (tier === null) return OMIT;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") {
    return tier === "id"
      ? safeIdValue(value)
      : (redactParamTextForLedger(value) ?? OMIT);
  }
  if (Array.isArray(value)) {
    // ★길이를 보존한다 — `tasks.length` 같은 개수 요약이 감사 뷰의 detail 이다.
    // 버려진 원소는 null 자리로 남긴다("없었다"가 아니라 "못 싣는다").
    return value.slice(0, LEDGER_PARAM_MAX_ARRAY).map((item) => {
      const projected = projectParamValue(key, item, depth + 1);
      return projected === OMIT ? null : projected;
    });
  }
  if (typeof value === "object") {
    // 중첩 객체는 **자기 키 이름**으로 다시 걸린다(submit_for_review 의 summary).
    const out: Record<string, unknown> = {};
    for (const [childKey, childValue] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const projected = projectParamValue(childKey, childValue, depth + 1);
      if (projected !== OMIT) out[childKey] = projected;
    }
    return out;
  }
  return OMIT;
}

/** 버려진 키 이름만 기록한다. 키 이름은 툴 스키마에서 오지만 그래도 모양을 검사한다. */
function safeOmittedKeyName(key: string): string {
  return /^[A-Za-z0-9_.-]{1,40}$/.test(key) ? key : "<key>";
}

/**
 * 해시용 정규화. 키를 정렬해 삽입 순서가 해시를 흔들지 않게 한다
 * (ledger-chain.ts 의 `canonicalize` 와 같은 취지 — 그쪽을 import 하면 L0 가
 * L3 에 의존하게 되므로 여기서는 최소 구현만 둔다).
 */
function canonicalParams(value: unknown): string {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) {
    return `[${value.map((v) => canonicalParams(v)).join(",")}]`;
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalParams(obj[k])}`)
      .join(",")}}`;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return "null";
  return JSON.stringify(value) ?? "null";
}

export interface LedgerParamsProjection {
  /** 원장에 실제로 실릴 인자. 화이트리스트를 통과한 것만 들어 있다. */
  params: Record<string, unknown>;
  /** 버려진 **최상위** 키 이름. 값은 담지 않는다 — "무엇을 못 싣는지"만 남긴다. */
  omitted: string[];
  /** 원본 인자 전체의 해시. 원문 대조는 이걸로 한다(instructionHash 와 같은 취지). */
  hash: string | null;
}

/**
 * 툴 인자 원문 → 원장에 실을 투영.
 *
 * ★블랙리스트가 아니라 화이트리스트인 이유: 새 툴이 새 키를 들고 오는 순간
 * 블랙리스트는 조용히 샌다. 여기서는 모르는 키가 **기본적으로 버려지고**, 새 키를
 * 싣고 싶으면 위 두 목록에 사람이 명시적으로 추가해야 한다.
 */
/** 원장 문서에 실리는 params 3종 세트. `buildLedgerEvent` 밖에서 쓰는 경로용. */
export interface SealedLedgerParams {
  params: Record<string, unknown>;
  paramsPolicy: string;
  paramsOmitted: string[];
  paramsHash: string | null;
}

/**
 * `buildLedgerEvent` 를 거치지 않고 `audit_logs` 에 직접 쓰는 경로(미션 미러 ·
 * 스풀 tombstone)가 같은 정책을 지나게 하는 어댑터.
 *
 * ★원장에 쓰는 문이 여러 개인 것 자체는 바꾸지 않는다. 대신 **정책 표식을 박는
 * 유일한 방법**을 이 함수로 만들어, 표식이 있는데 화이트리스트를 안 지난 문서가
 * 생길 수 없게 한다.
 */
export function sealLedgerParams(
  params: Record<string, unknown>,
): SealedLedgerParams {
  const projected = projectParamsForLedger(params);
  return {
    params: projected.params,
    paramsPolicy: LEDGER_PARAMS_POLICY,
    paramsOmitted: projected.omitted,
    paramsHash: projected.hash,
  };
}

export function projectParamsForLedger(
  params: Record<string, unknown>,
): LedgerParamsProjection {
  const out: Record<string, unknown> = {};
  const omitted: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    const projected = projectParamValue(key, value, 0);
    if (projected === OMIT) {
      omitted.push(safeOmittedKeyName(key));
      continue;
    }
    out[key] = projected;
  }
  const hasInput = Object.keys(params).length > 0;
  return {
    params: out,
    omitted,
    hash: hasInput
      ? PARAMS_HASH_PREFIX +
        createHash("sha256")
          .update(canonicalParams(params), "utf8")
          .digest("hex")
      : null,
  };
}

// ── 워크트리 귀속의 근거 경로 ────────────────────────────────────

/**
 * worktreeId 를 파생시킬 때 첫 근거로 삼는 경로 = **이 프로세스의 cwd 뿐이다.**
 *
 * 근거: 에이전트 CLI 는 워크트리를 cwd 로 스폰되고(bridge-server.ts
 * `cwd: req.worktreePath`) MCP 서버는 그 cwd 를 상속한다. 그래서 cwd 가
 * "이 에이전트가 어느 워크트리에서 일하고 있는가"의 실제 근거다.
 *
 * ★`MARBLO_PROJECT_ROOT` 를 폴백으로 쓰지 않는다 — 의도적이다.
 * 그 env 는 이름 그대로 **프로젝트 루트**를 뜻하고(main.ts 의 rootPath 폴백,
 * mission-engine 의 projectRoot 폴백 등 5곳이 전부 그 의미로 읽는다), 프로젝트
 * 루트는 정의상 `~/.marblo/worktrees/<projectId>/<taskId>` 규약 **밖** 경로다.
 * 폴백으로 두면 그 env 가 설정되는 순간 모든 이벤트의 worktreeId 가 조용히
 * null 이 된다 — 귀속이 통째로 죽는데 아무 신호가 없다. 감사 원장에서 판별
 * 가능한 것을 판별 불가로 만들고 그 사실조차 안 보이는 게 최악의 실패 모드다.
 *
 * cwd 가 규약 밖이면 원장 조립 단계에서 taskId 근거로 보강할 수 있지만,
 * `MARBLO_PROJECT_ROOT` 같은 env 경로는 여전히 근거가 아니다.
 *
 * env 를 인자로 받으면서 쓰지 않는 것이 이 함수의 요점이다 — 시그니처 자체가
 * "여기에 env 폴백을 다시 넣지 말 것"을 못 박는 회귀 가드이고, 테스트가 그
 * 불변식을 직접 검증한다. 다른 용도로 이 env 를 읽는 기존 5곳은 건드리지 않는다.
 */
export function worktreeAttributionCwd(
  _env: NodeJS.ProcessEnv,
  processCwd: string,
): string {
  return processCwd;
}

// ── 에이전트 실행 맥락 (env 계약) ────────────────────────────────

/**
 * 스폰 시 주입되는 에이전트 실행 맥락의 env 키. **이 슬라이스는 읽는 쪽만 만든다** —
 * 주입(생산자) 쪽은 spawn 경로를 건드려야 하므로 후속 슬라이스로 미뤘다. 지금은
 * 셋 다 미주입이라 항상 null 로 기록된다. 계약(키 이름·의미)을 여기서 못 박아
 * 두는 이유는 스키마 변경이 나중일수록 비싸기 때문이다(§15).
 *
 * 프롬프트 **원문이 아니라 해시**를 넘긴다 — 원문이 자식 프로세스 env 로 흐르지
 * 않게 하려는 의도적 선택이다.
 */
export const LEDGER_ENV = {
  model: "MARBLO_AGENT_MODEL",
  tier: "MARBLO_AGENT_TIER",
  instructionHash: "MARBLO_INSTRUCTION_HASH",
} as const;

export interface AgentRuntimeContext {
  model: string | null;
  tier: string | null;
  instructionHash: string | null;
}

const nullIfBlank = (v: string | undefined): string | null =>
  v && v.trim() ? v.trim() : null;

/** env 에서 실행 맥락을 읽는다. 미주입이면 전부 null — 추측하지 않는다. */
export function readAgentRuntimeContext(
  env: NodeJS.ProcessEnv = process.env,
): AgentRuntimeContext {
  return {
    model: nullIfBlank(env[LEDGER_ENV.model]),
    tier: nullIfBlank(env[LEDGER_ENV.tier]),
    instructionHash: nullIfBlank(env[LEDGER_ENV.instructionHash]),
  };
}

// ── 레코드 조립 ──────────────────────────────────────────────────

/** 툴 인자에서 티켓 id 를 뽑는다. 문자열이 아니면 null — 지어내지 않는다. */
export function taskIdFromParams(
  params: Record<string, unknown>,
): string | null {
  const raw = params.task_id;
  return typeof raw === "string" && raw.trim() ? raw.trim() : null;
}

export interface BuildLedgerEventInput {
  projectId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
  /** 생략 시 `action` — 기존 호출부가 필드를 몰라도 안 깨진다(하위호환). */
  kind?: LedgerEventKind;
  actorUid?: string | null;
  runtime?: Partial<AgentRuntimeContext>;
  instruction?: string;
  taskId?: string | null;
  /** 이 프로세스의 작업 디렉터리. worktreeId 는 여기서만 파생된다. */
  cwd?: string;
  homeDir?: string;
}

/**
 * 원장 한 건을 조립한다. 순수 함수 — Firestore 도 시계도 안 만진다(`createdAt` 은
 * write 시점에 호출부가 찍는다).
 *
 * 모르는 값은 **null 로 명시**해서 쓴다. 필드를 생략하지 않는 이유: Firestore 는
 * 없는 필드를 질의할 수 없어서, "귀속 불가(null)"와 "이 필드가 생기기 전 기록"을
 * 구분하려면 null 이 실제로 박혀 있어야 한다. 감사 뷰가 "규약 외"를 표기하려면
 * 이 구분이 필요하다(§8).
 */
export function buildLedgerEvent(
  input: BuildLedgerEventInput,
): LedgerEventWrite {
  const homeDir = input.homeDir;
  const cwd = input.cwd;
  const taskId = input.taskId ?? taskIdFromParams(input.params);
  const instructionRedacted = redactInstructionForLedger(input.instruction);
  // ★귀속(taskId)은 **원본** 인자에서 먼저 뽑는다. 투영은 그 다음이다 —
  // 순서를 바꾸면 화이트리스트를 조일 때마다 귀속이 조용히 죽는다.
  const projectedParams = projectParamsForLedger(input.params);
  return {
    projectId: input.projectId,
    agentId: input.agentId,
    toolName: input.toolName,
    params: projectedParams.params,
    result: input.result,
    duration: input.duration,
    success: input.success,
    kind: input.kind ?? LEDGER_KIND_DEFAULT,
    actorUid: input.actorUid ?? null,
    model: input.runtime?.model ?? null,
    tier: input.runtime?.tier ?? null,
    instructionHash:
      input.runtime?.instructionHash ?? hashInstruction(input.instruction),
    instructionRedacted,
    taskId,
    worktreeId: deriveLedgerWorktreeId({
      cwd,
      homeDir,
      projectId: input.projectId,
      taskId,
    }),
    paramsPolicy: LEDGER_PARAMS_POLICY,
    paramsOmitted: projectedParams.omitted,
    paramsHash: projectedParams.hash,
  };
}
