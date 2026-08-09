/**
 * Builder for `task_outcomes` ML rows — the "수도꼭지" (faucet) that was
 * emitting constants instead of labels.
 *
 * Prior behaviour (taskService.ts, before this module):
 *   success: true            // constant — zero negative labels, so a
 *                            // classifier had nothing to contrast against
 *   taskType: null           // hardcoded TODO
 *   retriesCount: 0          // hardcoded
 *   totalCost / tokens       // agent LIFETIME totals, not per-task; landed
 *                            // as 0/NULL in 29/29 BigQuery rows
 *
 * Evidence: docs/research/routing-slm-data-collection.md §1 (status table)
 * and §3 (defects A/B/C).
 *
 * This module is deliberately pure so the label logic can be tested without
 * Firestore, Cloud Functions or an Electron window. IO lives in
 * services/taskOutcomeReporter.ts.
 *
 * ── Schema contract ──────────────────────────────────────────────────────
 * Every field below is ALREADY part of the `task_outcomes` BigQuery table:
 * functions/src/index.ts (logTaskOutcome) writes all of them on every insert,
 * defaulting to null. Today's inserts succeed, which proves the columns
 * exist — so this change needs **no BigQuery migration**, same as PR#480.
 * Do not add a field here without adding it to the server row first; a
 * streaming insert with an unknown column fails and drops the whole row.
 */

import { classifyTaskType, type TaskType } from "./taskType";

/** Statuses that produce an outcome row. */
export type TerminalTaskStatus = "DONE" | "FAILED" | "BLOCKED";

export const TERMINAL_TASK_STATUSES: readonly TerminalTaskStatus[] = [
  "DONE",
  "FAILED",
  "BLOCKED",
] as const;

export function isTerminalTaskStatus(
  status: string,
): status is TerminalTaskStatus {
  return (TERMINAL_TASK_STATUSES as readonly string[]).includes(status);
}

/** Per-task cost/retry rollups accumulated on the `tasks/<id>` doc. */
export interface TaskRollups {
  costTotal?: number | null;
  costInputTokens?: number | null;
  costOutputTokens?: number | null;
  retriesCount?: number | null;
}

/** Subset of `agents/<id>` used as a fallback model source. */
export interface AgentModelSnapshot {
  /** 하네스(스폰한 바이너리) — `claude`/`gpt`. **모델 id 가 아니다.** */
  model?: string | null;
  /** cost-tracker 가 과금 세션 메타데이터에서 읽은 실제 모델 id. */
  detectedModelId?: string | null;
  /** main 이 스폰 argv 를 되읽어 스탬프한 값. effort 접미사(`@high`)가 붙는다. */
  spawnedModel?: string | null;
  // ── 실행 종료 신호(#890 F-7). main 이 종료 시점에 스탬프한다. ──────────
  /** PTY 산출량(문자 수). 내용 아님. 구 doc 에는 없다. */
  outputChars?: number | null;
  /** 산출량이 무산출 임계 이하였나. */
  noOutput?: boolean | null;
  /** 프로세스 종료 코드. */
  lastExitCode?: number | null;
}

/**
 * ★실패 귀책 어휘 (#890 F-6 · BQ 감사 G10).
 *
 * 종전엔 `errorCategory` 가 **터미널 상태 문자열 그대로**("FAILED"/"BLOCKED")였다.
 * 그 라벨로는 학습이 불가능하다: 음성 39건 중 33건이 BLOCKED 인데, BLOCKED 는
 * "이 모델이 못했다" 가 아니라 **"이 태스크가 막혔다"** 다. 그대로 학습하면
 * 분류기는 "막히기 쉬운 태스크에 비싼 모델을 붙여라" 라는 정반대 정책을 배운다.
 *
 * 세 갈래로 나뉜다 — 이 구분이 이 어휘의 존재 이유다:
 *   · 모델 귀책   `MODEL_FAIL` — 추론 오류·거부·루프. **학습셋의 진짜 음성.**
 *   · 무산출     `NO_OUTPUT`  — 붙었지만 아무것도 안 냄. 모델 품질과 다른 축.
 *   · 환경/외부  `BLOCKED_DEP` `AUTH` `TOOL` `TIMEOUT` `CANCELLED`
 *                 — 모델 선택으로 못 고치는 것들. 유효 라벨 조건 7 이 제외한다.
 */
export type ErrorCategory =
  | "MODEL_FAIL"
  | "NO_OUTPUT"
  | "TIMEOUT"
  | "TOOL"
  | "AUTH"
  | "BLOCKED_DEP"
  | "CANCELLED";

/** 모델 귀책으로 볼 수 있는 카테고리 — 유효 라벨 조건 7(#890 §3-B). */
export const MODEL_ATTRIBUTABLE_CATEGORIES: readonly ErrorCategory[] = [
  "MODEL_FAIL",
  "NO_OUTPUT",
  "TIMEOUT",
  "TOOL",
] as const;

/**
 * 실패 사유 문자열 → 카테고리. **로컬 순수함수**이고 나가는 값은 enum 하나다
 * (`classifyTaskType` 과 같은 계약, #890 §2-E) — 본문은 절대 밖으로 나가지 않는다.
 *
 * 한·영 두 어휘를 함께 본다. 우리 실사용 코멘트가 한국어이기 때문이고, 이 함수가
 * 영어 키워드만 봤다면 실측 데이터에서 아무것도 못 골라냈을 것이다.
 */
function categoryFromReasonText(text: string): ErrorCategory | null {
  const t = text.toLowerCase();
  // 순서가 의미를 만든다: 인증/취소처럼 **확정적인** 사유를 먼저 본다. 마지막
  // MODEL_FAIL 은 아래 호출부가 폴백으로 정하므로 여기선 찾지 않는다.
  if (
    /(auth|인증|로그인|login|credential|unauthorized|unauthenticated|api\s*key|토큰\s*만료)/.test(
      t,
    )
  ) {
    return "AUTH";
  }
  if (/(cancel|취소|중단|aborted|사용자\s*중지)/.test(t)) return "CANCELLED";
  if (/(timeout|타임아웃|시간\s*초과|응답\s*없음|stalled|정체)/.test(t)) {
    return "TIMEOUT";
  }
  if (
    /(mcp|tool|도구|스폰\s*실패|spawn\s*fail|binary|not\s*found|cli|permission\s*denied|권한\s*없)/.test(
      t,
    )
  ) {
    return "TOOL";
  }
  if (/(의존|depend|선행|대기|waiting\s*on|blocked\s*by)/.test(t)) {
    return "BLOCKED_DEP";
  }
  return null;
}

/** 실패 귀책 분류에 필요한 신호들. 전부 이미 수집되는 값이다. */
export interface ErrorCategoryInput {
  status: TerminalTaskStatus;
  /** 의존성 게이트 — BLOCKED 의 대다수가 여기서 갈린다. */
  dependsOn?: string[] | null;
  dependsOnCompleted?: boolean | null;
  /** 상태 전환 시 남긴 사유 한 줄. 읽기만 하고 밖으로 내보내지 않는다. */
  comment?: string | null;
  /** 산출물 증거 — 있으면 무산출이 아니다. */
  prUrl?: string | null;
  /** 이 태스크에 귀속된 출력 토큰. null = 미집계(0 과 다르다). */
  totalOutputTokens?: number | null;
  /** 에이전트 종료 신호(#890 F-7). */
  agent?: Pick<
    AgentModelSnapshot,
    "outputChars" | "noOutput" | "lastExitCode"
  > | null;
}

/**
 * ★실패를 무산출 / 모델귀책 / 환경 으로 가른다 (#890 F-6·F-7).
 *
 * 판정 사다리 — **강한 증거부터**:
 *   1. 성공이면 카테고리가 없다(깨끗한 "왜 실패했나" 축을 유지).
 *   2. 사유 문자열이 확정적으로 말하는 것(인증/취소/타임아웃/도구/의존).
 *   3. 의존성 게이트가 실제로 안 풀린 BLOCKED → `BLOCKED_DEP`.
 *   4. **무산출 증거** → `NO_OUTPUT`.
 *   5. 남으면 `MODEL_FAIL`(FAILED) / `BLOCKED_DEP`(BLOCKED).
 *
 * ★무산출은 **적극적 증거가 있을 때만** 선언한다. `totalOutputTokens` 가 null 인
 * 것은 "안 냈다" 가 아니라 "집계가 안 붙었다" 일 수 있고, 그 둘을 뭉개면 비용
 * 파이프라인의 공백이 전부 모델의 무산출로 둔갑한다. 그래서 명시적 0 이거나
 * 에이전트 측 무산출 신호가 있을 때만 NO_OUTPUT 이다.
 */
export function classifyErrorCategory(
  input: ErrorCategoryInput,
): ErrorCategory | null {
  const { status } = input;
  if (status === "DONE") return null;

  const fromText = input.comment ? categoryFromReasonText(input.comment) : null;
  if (fromText) return fromText;

  const dependencyPending =
    (input.dependsOn?.length ?? 0) > 0 && input.dependsOnCompleted !== true;
  if (status === "BLOCKED" && dependencyPending) return "BLOCKED_DEP";

  const producedArtifact = !!input.prUrl?.trim();
  const agentSaysEmpty = input.agent?.noOutput === true;
  const zeroTokens = input.totalOutputTokens === 0;
  if (!producedArtifact && (agentSaysEmpty || zeroTokens)) return "NO_OUTPUT";

  return status === "FAILED" ? "MODEL_FAIL" : "BLOCKED_DEP";
}

export interface BuildTaskOutcomeInput {
  clientId: string;
  taskId: string;
  status: TerminalTaskStatus;
  task: {
    projectId?: string | null;
    title?: string | null;
    goal?: string | null;
    description?: string | null;
    role?: string | null;
    priority?: number | null;
    scope?: string[] | null;
    claimedAt?: Date | null;
    createdAt?: Date | null;
    // ── 실패 귀책 신호(#890 F-6). 전부 이미 태스크 doc 에 있는 값이다. ──
    dependsOn?: string[] | null;
    dependsOnCompleted?: boolean | null;
    comment?: string | null;
    prUrl?: string | null;
  };
  rollups?: TaskRollups | null;
  agent?: AgentModelSnapshot | null;
  /** Injected for determinism in tests. */
  now?: Date;
}

export interface TaskOutcomeRow {
  clientId: string;
  taskId: string;
  projectId: string | null;
  taskType: TaskType | null;
  taskComplexity: number | null;
  role: string | null;
  model: string | null;
  promptLength: number | null;
  scopeFileCount: number;
  success: boolean;
  durationMs: number | null;
  totalInputTokens: number | null;
  totalOutputTokens: number | null;
  totalCost: number | null;
  retriesCount: number;
  errorCategory: string | null;
  createdAt: string;
  completedAt: string;
}

/**
 * Non-negative finite number, or null. Guards the cost/retry rollups: a
 * corrupt or partially-written counter must not poison the training set with
 * NaN / Infinity / negative values, and BigQuery would reject NaN outright.
 */
/** 첫 번째 non-empty 문자열. 공백만 있는 값은 없는 것으로 친다. */
function firstNonEmpty(
  ...candidates: (string | null | undefined)[]
): string | undefined {
  for (const c of candidates) {
    const v = (c ?? "").trim();
    if (v) return v;
  }
  return undefined;
}

function sanitizeCount(value: number | null | undefined): number | null {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    return null;
  }
  return value;
}

export function buildTaskOutcome(input: BuildTaskOutcomeInput): TaskOutcomeRow {
  const { clientId, taskId, status, task, rollups, agent } = input;
  const now = input.now ?? new Date();

  // ── Defect ① — success is now the real terminal status ────────────────
  // DONE means the work was accepted; FAILED and BLOCKED are the negative
  // class that did not exist before. `errorCategory` keeps the *reason*
  // distinguishable so an analyst can drop BLOCKED (often recoverable) while
  // keeping FAILED, without needing a new column.
  const success = status === "DONE";

  // ── durationMs — claimed → terminal ────────────────────────────────────
  // NOTE: this is ticket lead time, NOT agent working time. The research doc
  // (§3.2) reports a 7.3h median and attributes it to createdAt→DONE; the code
  // has always measured claimedAt→terminal, which is narrower but still
  // wall-clock and still includes idle/overnight gaps. It is left as-is
  // (measuring true agent-active time needs a session-level clock that does
  // not exist yet) and must NOT be used as the ML-3 cost-prediction target —
  // join `cost_logs` on taskId for that. See doc §6 [3].
  const durationMs = task.claimedAt
    ? Math.max(0, now.getTime() - new Date(task.claimedAt).getTime())
    : null;

  // ── Defect ② — per-task cost, not agent-lifetime cost ─────────────────
  // Rollups are incremented on the task doc from the cost:update stream,
  // which already carries a taskId (that stamp is what gives cost_logs its
  // 98.6% join rate). Falls back to null — never to the agent's lifetime
  // total, which is what made these columns meaningless.
  const totalCost = sanitizeCount(rollups?.costTotal);
  const totalInputTokens = sanitizeCount(rollups?.costInputTokens);
  const totalOutputTokens = sanitizeCount(rollups?.costOutputTokens);

  // ── Defect ③ — real retry count ───────────────────────────────────────
  const retriesCount = sanitizeCount(rollups?.retriesCount) ?? 0;

  // ── Defect ④ — derived task type ──────────────────────────────────────
  const taskType = classifyTaskType(task);

  // ── Defect ⑤ — 구체 실행 모델 ───────────────────────────────────────────
  // 근거 사다리는 usageBreakdown.mapAgentsToModels / UsagePage 와 **같아야 한다**:
  //   1. detectedModelId — 과금된 세션이 기록한 모델 id(가장 강한 근거)
  //   2. spawnedModel    — main 이 스폰 argv 를 되읽어 스탬프한 값
  //   3. model           — 하네스족. 모델 id 가 아니지만 "어느 바이너리로 돌았나"
  //                        는 관측된 사실이라 최후 폴백으로만 남긴다.
  //
  // ★종전엔 2번이 통째로 빠져 있었다. argv 로 관측된 구체 모델이 agents doc 에
  // 멀쩡히 있는데도 이 행만 족(claude)이나 null 로 적재돼 `task_outcomes.model` 이
  // "-" 로 보였다 — 같은 사실을 읽는 세 화면 중 여기만 사다리가 짧았던 것이다.
  const model =
    firstNonEmpty(agent?.detectedModelId, agent?.spawnedModel, agent?.model) ??
    null;

  // promptLength: the column exists server-side but the client never sent it
  // (doc §3.2 — "서버는 받는데 클라가 안 보냄"). Description length is a
  // legitimate task-size feature and, like promptHash/promptLength on the
  // events table, ships a LENGTH only — never the text.
  const descriptionLength = task.description?.length ?? null;

  return {
    clientId,
    taskId,
    projectId: task.projectId ?? null,
    taskType,
    // Still `priority`, NOT true complexity. Kept numeric on purpose: the
    // column holds integers today and writing a "simple|standard|complex"
    // string would fail the streaming insert and drop the row. Real
    // complexity is recoverable by joining `events` (dispatch:decision
    // metadata.complexity) on taskId. Doc §1 marks this 🟡, not 🔴.
    taskComplexity: task.priority ?? null,
    role: task.role ?? null,
    model,
    promptLength: descriptionLength,
    scopeFileCount: task.scope?.length ?? 0,
    success,
    durationMs,
    totalInputTokens,
    totalOutputTokens,
    totalCost,
    retriesCount,
    // ★F-6(감사 G10) — 종전엔 여기가 터미널 **상태 문자열**("FAILED"/"BLOCKED")
    // 이었다. 그 라벨로는 "모델이 못했다" 와 "태스크가 막혔다" 가 구분되지 않아
    // 음성 라벨이 통째로 못 쓰는 값이었다. 이제 7종 어휘로 귀책을 가른다.
    //
    // 하위호환: 컬럼 타입(STRING)·nullable 계약은 그대로다 — BigQuery 스키마
    // 변경 없음. 기존 행은 옛 어휘("FAILED"/"BLOCKED")로 남아 있고, 새 행부터
    // 새 어휘가 쌓인다. 두 시기를 섞어 세지 않도록 분석 쪽에서 갈라 보면 된다.
    // null for DONE so the column stays a clean "why did this fail" axis.
    errorCategory: classifyErrorCategory({
      status,
      dependsOn: task.dependsOn,
      dependsOnCompleted: task.dependsOnCompleted,
      comment: task.comment,
      prUrl: task.prUrl,
      totalOutputTokens,
      agent,
    }),
    createdAt:
      task.createdAt instanceof Date
        ? task.createdAt.toISOString()
        : now.toISOString(),
    completedAt: now.toISOString(),
  };
}
