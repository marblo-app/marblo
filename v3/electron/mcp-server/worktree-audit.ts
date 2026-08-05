/**
 * 감사 원장(ledger) L4 — 워크트리 감사 뷰 + 오케용 조회.
 *
 * 설계 권위: docs/superpowers/specs/2026-07-19-team-governance-audit-ledger-design.md
 * (§8 워크트리 정체성 · §9 구현 순서 4단계(감사 뷰) · §15 오케를 1차 소비자로)
 *
 * 이 파일은 **순수 함수만** 담는다. Firestore 조회·파일시스템 스캔·git 실행 같은
 * 불순물은 tools.ts 가 담당한다 — ledger.ts/ledger-chain.ts 와 같은 분리 원칙이다.
 * 판정 로직을 여기 순수 함수로 빼두면 라이브 인프라 없이 vitest 로 전부 검증된다.
 *
 * ## 핵심 규율 — "모른다"를 "괜찮다"로 답하지 않는다 (§15)
 *
 * 아래 함수들은 근거가 없으면 각 축을 명시적으로 `null`/`"unknown"` 으로 남긴다.
 * 특히 `describeSafeToDelete` 는 위험 신호가 하나도 없어도 확인 못한 축이 있으면
 * `"unknown"` 을 돌려준다 — 확인 불가를 안전으로 반올림하는 게 감사에서 가장 나쁜
 * 실패 모드다(오늘 오판의 상당수가 "머지됨"을 "동작함"의 근거로 승격시킨 데서 났다).
 */

import {
  deriveLedgerWorktreeId,
  parseWorktreePath,
  type WorktreeIdentity,
} from "./ledger.js";

// ── 워크트리 경로 분류 ───────────────────────────────────────────

export interface WorktreeDirClassification {
  worktreeId: string | null;
  identity: WorktreeIdentity | null;
  /** 규약 밖일 때만 채워지는, 사람이 읽는 이유. */
  offConventionReason: string | null;
}

/**
 * 디스크의 워크트리 디렉터리 하나를 분류한다. `ledger.ts` 의 `parseWorktreePath`
 * 를 그대로 재사용한다(§2 재구현 금지) — 원장에 이벤트를 적재할 때 쓰는 것과
 * 완전히 같은 판별기라야 감사 뷰와 원장이 같은 worktreeId 를 말한다.
 *
 * 규약 밖 경로라도 taskId 근거가 있으면 `<projectId>/<taskId>` 로 귀속한다.
 * taskId 근거도 없을 때만 **worktreeId=null** 로 두고 억지 귀속하지 않는다(§8).
 */
export function classifyWorktreeDir(
  absPath: string,
  opts: { homeDir: string; projectId?: string | null; taskId?: string | null },
): WorktreeDirClassification {
  const identity = parseWorktreePath(absPath, opts);
  if (!identity) {
    const fallbackWorktreeId =
      opts.projectId && opts.taskId
        ? deriveLedgerWorktreeId({
            cwd: absPath,
            homeDir: opts.homeDir,
            projectId: opts.projectId,
            taskId: opts.taskId,
          })
        : null;
    if (fallbackWorktreeId && opts.projectId && opts.taskId) {
      return {
        worktreeId: fallbackWorktreeId,
        identity: { projectId: opts.projectId, taskId: opts.taskId },
        offConventionReason:
          "경로가 <root>/<projectId>/<taskId> 규약과 다르지만 taskId 근거가 있어 " +
          "티켓 워크트리로 귀속합니다 (설계 §8).",
      };
    }
    return {
      worktreeId: null,
      identity: null,
      offConventionReason:
        "경로가 <root>/<projectId>/<taskId> 규약과 다릅니다 — 규약 외로 표기합니다 " +
        "(taskId 근거 없음, 억지 귀속 금지: 설계 §8).",
    };
  }
  return {
    worktreeId: `${identity.projectId}/${identity.taskId}`,
    identity,
    offConventionReason: null,
  };
}

// ── 알려진 워크트리 합집합 (물리 삭제분 포함) ────────────────────

export type WorktreeOrigin = "disk" | "ledger" | "both";

export interface KnownWorktree {
  worktreeId: string;
  origin: WorktreeOrigin;
}

/**
 * 디스크에서 관측된 worktreeId 와 원장에서 관측된 worktreeId 의 합집합.
 *
 * ★물리 삭제된 워크트리도 조회돼야 한다(설계 핵심 요구) — 디스크 목록만 보면
 * 지워진 워크트리가 감사 뷰에서 통째로 사라진다. `origin: "ledger"` 가 바로 그
 * 신호다: 지금 디스크엔 없지만 원장엔 흔적이 남은 워크트리.
 */
export function unionKnownWorktrees(
  diskWorktreeIds: readonly string[],
  ledgerWorktreeIds: readonly string[],
): KnownWorktree[] {
  const disk = new Set(diskWorktreeIds);
  const ledger = new Set(ledgerWorktreeIds);
  const all = new Set<string>([...disk, ...ledger]);
  return [...all].sort().map((worktreeId) => ({
    worktreeId,
    origin: disk.has(worktreeId)
      ? ledger.has(worktreeId)
        ? "both"
        : "disk"
      : "ledger",
  }));
}

// ── 체인 봉인 여부 집계 (§10 보증 구간) ───────────────────────────

export interface SealSummary {
  /** 체인이 붙어 검증 가능한 건수. */
  sealed: number;
  /** 체인 이전 기록 — 무결성 미보증(§10). 실패가 아니라 별도 집계. */
  preLedger: number;
}

export interface SealFields {
  seq?: number;
  prevHash?: string;
  hash?: string;
}

/**
 * 체인 필드가 붙어 있는가. `ledger-chain.ts` 의 `isSealed()` 와 **같은 세 필드
 * 존재 검사**다 — 다만 그 함수의 타입 시그니처가 전체 `LedgerEventWrite` 를
 * 요구해서(타입가드 용도), 원장 이벤트의 요약본만 도는 이 파일에서는 그대로
 * 재사용할 수 없다. 판정 로직(세 필드 모두 있어야 sealed) 자체는 동일하다.
 */
function isSealed(e: SealFields): boolean {
  return (
    typeof e.seq === "number" &&
    typeof e.prevHash === "string" &&
    typeof e.hash === "string"
  );
}

export function summarizeSealStatus(
  events: readonly SealFields[],
): SealSummary {
  let sealed = 0;
  let preLedger = 0;
  for (const e of events) {
    if (isSealed(e)) sealed += 1;
    else preLedger += 1;
  }
  return { sealed, preLedger };
}

// ── 감사 뷰 행 (워크트리 목록 = 진입점) ───────────────────────────

export interface WorktreeAuditEvent {
  agentId: string;
  occurredAtMs: number;
  toolName: string;
  seq?: number;
  prevHash?: string;
  hash?: string;
}

export interface MergeHistoryRow {
  taskId: string | null;
  branch: string | null;
  headSha: string | null;
  mergedAtMs: number | null;
}

export interface MergeInfo {
  branch: string | null;
  headSha: string | null;
  mergedAtMs: number;
}

/** 여러 머지 기록 중 가장 최근 것. `mergedAtMs` 없는 행은 근거 없음으로 버린다. */
export function pickLatestMerge(
  rows: readonly MergeHistoryRow[],
): MergeInfo | null {
  let best: (MergeHistoryRow & { mergedAtMs: number }) | null = null;
  for (const r of rows) {
    if (r.mergedAtMs === null) continue;
    if (!best || r.mergedAtMs > best.mergedAtMs) {
      best = { ...r, mergedAtMs: r.mergedAtMs };
    }
  }
  return best
    ? {
        branch: best.branch,
        headSha: best.headSha,
        mergedAtMs: best.mergedAtMs,
      }
    : null;
}

export interface WorktreeAuditRow {
  worktreeId: string;
  taskId: string;
  origin: WorktreeOrigin;
  /** disk|both 면 지금 디스크에 있다는 뜻. ledger 단독이면 물리 삭제됨. */
  existsOnDisk: boolean;
  lastAgentId: string | null;
  lastEventAtMs: number | null;
  sealed: number;
  preLedger: number;
  merged: boolean;
  mergedAtMs: number | null;
}

/**
 * 감사 뷰의 행을 조립한다. 이벤트/머지 조회는 tools.ts 가 미리 해서 넘긴다 —
 * 이 함수는 조인·정렬·집계만 한다(순수).
 */
export function buildWorktreeAuditRows(input: {
  known: readonly KnownWorktree[];
  eventsByWorktreeId: ReadonlyMap<string, readonly WorktreeAuditEvent[]>;
  mergeByTaskId: ReadonlyMap<string, MergeInfo | null>;
}): WorktreeAuditRow[] {
  return input.known.map((k) => {
    const taskId = k.worktreeId.split("/")[1] ?? "";
    const events = input.eventsByWorktreeId.get(k.worktreeId) ?? [];
    const sorted = [...events].sort((a, b) => b.occurredAtMs - a.occurredAtMs);
    const last = sorted[0] ?? null;
    const { sealed, preLedger } = summarizeSealStatus(events);
    const merge = input.mergeByTaskId.get(taskId) ?? null;
    return {
      worktreeId: k.worktreeId,
      taskId,
      origin: k.origin,
      existsOnDisk: k.origin !== "ledger",
      lastAgentId: last?.agentId ?? null,
      lastEventAtMs: last?.occurredAtMs ?? null,
      sealed,
      preLedger,
      merged: merge !== null,
      mergedAtMs: merge?.mergedAtMs ?? null,
    };
  });
}

// ── Q1: 이 수정이 지금 도는 프로세스에 실제 들어있나 ──────────────

export type AncestorCheckResult = "ancestor" | "not-ancestor" | "unknown";

export type LivenessStatus =
  | "confirmed-live"
  | "confirmed-not-live"
  | "not-merged"
  | "unknown";

export interface LivenessVerdict {
  status: LivenessStatus;
  detail: string;
}

/**
 * "이 티켓의 수정이 지금 도는 프로세스에 실제 들어있나" 에 답한다.
 *
 * `mergeInfo.headSha` 는 (app 자체 squash 경로든 gh 서버 경로든) **base 브랜치에
 * 실제로 착지한 커밋**이다(worktree-manager 의 `mergedSha` = squash 뒤 repoRoot
 * HEAD) — 그래서 이 커밋과 이 프로세스가 도는 빌드 커밋 사이의 조상관계 확인이
 * squash 로 인해 실패하는 함정(merge_and_close 주석 참조)에 걸리지 않는다.
 *
 * 근거가 하나라도 빠지면(headSha 없음/baked 커밋 없음/git 확인 실패) `unknown`.
 * 절대로 "안전측으로" live/not-live 를 추측하지 않는다.
 */
export function describeProcessLiveness(input: {
  mergeInfo: MergeInfo | null;
  bakedCommit: string | null;
  ancestorResult: AncestorCheckResult;
}): LivenessVerdict {
  const { mergeInfo, bakedCommit, ancestorResult } = input;
  if (!mergeInfo) {
    return {
      status: "not-merged",
      detail:
        "merge_history 에 이 티켓의 머지 기록이 없습니다 — 아직 실물에 들어가지 " +
        "않았거나, merge_history 도입(#566/#501) 이전에 머지되었을 수 있습니다.",
    };
  }
  if (!mergeInfo.headSha) {
    return {
      status: "unknown",
      detail:
        "머지 기록은 있으나 headSha 가 비어 있어 조상관계를 확인할 수 없습니다.",
    };
  }
  if (!bakedCommit) {
    return {
      status: "unknown",
      detail:
        "이 MCP 프로세스가 unbundled 로 실행 중이라(빌드 커밋 미상) 확인할 수 " +
        "없습니다.",
    };
  }
  if (ancestorResult === "unknown") {
    return {
      status: "unknown",
      detail:
        `git 조상관계 확인에 실패했습니다(머지 커밋=${mergeInfo.headSha}, ` +
        `실행 중 빌드=${bakedCommit}) — 근거 없이 답하지 않습니다.`,
    };
  }
  if (ancestorResult === "ancestor") {
    return {
      status: "confirmed-live",
      detail:
        `머지 커밋(${mergeInfo.headSha})이 이 프로세스가 실행 중인 빌드` +
        `(${bakedCommit})의 조상입니다 — 지금 도는 프로세스에 실제로 들어있습니다.`,
    };
  }
  return {
    status: "confirmed-not-live",
    detail:
      `머지 커밋(${mergeInfo.headSha})이 이 프로세스가 실행 중인 빌드` +
      `(${bakedCommit})의 조상이 아닙니다 — 이 프로세스는 그 수정 이전 빌드이거나 ` +
      `다른 브랜치를 실행 중입니다.`,
  };
}

// ── Q2: 지워도 안전한가 ────────────────────────────────────────────

export type SafetyVerdictKind =
  | "already-gone"
  | "not-safe"
  | "likely-safe"
  | "unknown";

export interface SafetyEvidence {
  existsOnDisk: boolean;
  /** null = 확인 실패(예: git status 명령 실패). */
  dirty: boolean | null;
  /** null = 확인 실패(예: upstream 없음/git 명령 실패). */
  unpushedCount: number | null;
  /** null = 담당 에이전트를 특정하지 못했거나 상태를 확인하지 못함. */
  agentBusy: boolean | null;
}

export interface SafetyVerdict {
  verdict: SafetyVerdictKind;
  reasons: string[];
}

/**
 * "지워도 안전한가" 에 답한다. **이 함수는 삭제를 실행하지 않는다** — 실제 삭제
 * 정책(임계값·보존 로직)은 메인 프로세스 `worktree-manager.ts` 의 `reapSafety()`
 * 가 담당한다(설계 §2 "재구현 금지"). 여기는 그 판단에 쓸 근거를 읽기 전용으로
 * 모아 보여줄 뿐이다.
 *
 * 위험 신호가 하나도 없어도 확인 못 한 축이 있으면 `"unknown"` 을 낸다 — 확인
 * 불가를 안전으로 반올림하지 않는다(§15 핵심 규율).
 */
export function describeSafeToDelete(evidence: SafetyEvidence): SafetyVerdict {
  if (!evidence.existsOnDisk) {
    return {
      verdict: "already-gone",
      reasons: [
        "워크트리가 디스크에 없습니다 — 이미 지워졌거나 이 호스트에 없습니다.",
      ],
    };
  }

  const reasons: string[] = [];
  const unknowns: string[] = [];

  if (evidence.dirty === true) {
    reasons.push("커밋되지 않은 변경이 있습니다(dirty).");
  } else if (evidence.dirty === null) {
    unknowns.push("dirty 여부 확인 실패");
  }

  if (evidence.unpushedCount === null) {
    unknowns.push("unpushed 커밋 수 확인 실패");
  } else if (evidence.unpushedCount > 0) {
    reasons.push(`push 되지 않은 커밋 ${evidence.unpushedCount}건이 있습니다.`);
  }

  if (evidence.agentBusy === true) {
    reasons.push("이 워크트리를 쓰는 에이전트가 지금 활동 중입니다.");
  } else if (evidence.agentBusy === null) {
    unknowns.push("담당 에이전트 활동 여부 확인 실패");
  }

  if (reasons.length > 0) {
    return { verdict: "not-safe", reasons };
  }
  if (unknowns.length > 0) {
    return {
      verdict: "unknown",
      reasons: [
        `판정에 필요한 근거 일부를 확인하지 못했습니다: ${unknowns.join(
          ", ",
        )}. ` +
          `확인된 축에는 위험 신호가 없지만 모른다를 안전으로 답하지 않습니다.`,
      ],
    };
  }
  return {
    verdict: "likely-safe",
    reasons: [
      "dirty 없음 · unpushed 없음 · 담당 에이전트 비활동 — 삭제해도 안전할 " +
        "가능성이 높습니다. 최종 판단(임계값·보존 정책)은 메인 프로세스의 " +
        "reapSafety() 를 따르세요 — 이 결과는 그 판단의 참고 근거입니다.",
    ],
  };
}

// ── Q3: 이 결정이 내려진 시점에 뭐가 돌고 있었나 ──────────────────

export interface ActivityWindowEvent {
  toolName: string;
  occurredAtMs: number;
  agentId: string;
  success: boolean;
  kind: string;
}

export interface ActivityWindowReport {
  events: ActivityWindowEvent[];
  caveat: string;
}

/**
 * "이 결정이 내려진 시점에 무엇이 돌고 있었나" 에 답한다.
 *
 * ★정직하게 답할 수 있는 범위만 답한다: 지금 존재하는 신호는 `kind=action`
 * (MCP 툴 호출) 뿐이다. "MCP 서버 기동"·"빌드 산출물 로드" 같은 `kind=lifecycle`
 * 프로세스 시작 이벤트는 스키마(§15)만 슬라이스 1 에 들어왔고 **생산(주입) 쪽은
 * 아직 없다**(ledger.ts `LEDGER_ENV`/`readAgentRuntimeContext` 주석 참조 — 읽는
 * 쪽만 만들고 주입은 후속 슬라이스). 그래서 이 창이 비었다고 "그때 아무 프로세스도
 * 없었다"로 단정하면 안 된다 — caveat 로 항상 그 한계를 명시한다.
 */
export function describeActivityAtDecisionTime(
  events: readonly ActivityWindowEvent[],
  atMs: number,
  windowMs: number,
): ActivityWindowReport {
  const from = atMs - windowMs;
  const to = atMs + windowMs;
  const inWindow = events
    .filter((e) => e.occurredAtMs >= from && e.occurredAtMs <= to)
    .sort((a, b) => a.occurredAtMs - b.occurredAtMs);
  return {
    events: inWindow,
    caveat:
      "이 창은 이 워크트리에 귀속된 MCP 툴 호출(kind=action) 기록만 봅니다 — " +
      "'MCP 서버 기동'/'빌드 로드' 같은 kind=lifecycle 프로세스 시작 이벤트는 " +
      "아직 생산되지 않습니다(설계 §15: 소비 계약은 슬라이스 1, 생산은 후속 " +
      "슬라이스). 이 창이 비어 있다고 '그 시점에 아무 프로세스도 없었다'로 " +
      "단정할 수 없습니다 — 근거 없음일 뿐입니다.",
  };
}
