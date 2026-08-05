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
  /** 이 행위가 속한 티켓. */
  taskId: string | null;
  /** 경로 규약에서 우선 파생하고, 규약 밖이면 taskId 근거로 보강한 결정적 문자열(§8). */
  worktreeId: string | null;

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
  return {
    projectId: input.projectId,
    agentId: input.agentId,
    toolName: input.toolName,
    params: input.params,
    result: input.result,
    duration: input.duration,
    success: input.success,
    kind: input.kind ?? LEDGER_KIND_DEFAULT,
    actorUid: input.actorUid ?? null,
    model: input.runtime?.model ?? null,
    tier: input.runtime?.tier ?? null,
    instructionHash: input.runtime?.instructionHash ?? null,
    taskId,
    worktreeId: deriveLedgerWorktreeId({
      cwd,
      homeDir,
      projectId: input.projectId,
      taskId,
    }),
  };
}
