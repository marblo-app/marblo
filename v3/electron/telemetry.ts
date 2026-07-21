import { BrowserWindow } from "electron";

// Send telemetry events to the renderer process for Firestore persistence
export function sendTelemetry(
  win: BrowserWindow | null,
  event: string,
  payload: Record<string, unknown>,
) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send("telemetry:event", { event, ...payload });
  } catch {
    // Silently fail
  }
}

export const mainTelemetry = {
  agentSpawned(
    win: BrowserWindow | null,
    agentId: string,
    name: string,
    model: string,
    role: string,
    projectId?: string,
    promptHash?: string,
    promptLength?: number,
  ) {
    sendTelemetry(win, "agent:spawned", {
      agentId,
      name,
      model,
      role,
      projectId,
      promptHash,
      promptLength,
    });
  },

  agentStopped(win: BrowserWindow | null, agentId: string, exitCode?: number) {
    sendTelemetry(win, "agent:stopped", { agentId, exitCode });
  },

  // `taskId` is the agent's currentTaskId at crash/restart time. Without it
  // these events were observable only per-agent: BigQuery held 820 crashes and
  // 987 restarts with taskId attached to exactly 0 of them, so "this model
  // kept dying on this task" — one of the strongest quality signals we have —
  // could never be joined back to the task it was about
  // (docs/research/routing-slm-data-collection.md §3.3). Same stamp the cost
  // tracker uses, which already achieves a 98.6% join rate. Null for agents
  // not bound to a board task (one-off / orchestrator sessions).
  // errorCategory/errorMessage fill the churn-analysis §5-4 gap: every
  // agent:crashed row in BigQuery had these NULL, so "왜 죽었나(인증? CLI 경로?
  // spawn env?)" was unanswerable — the exact question behind the 22→6 첫스폰
  // 붕괴. The manager already computes the coarse classification (fast-fail =
  // 바이너리 부재/설정 오류 vs runtime crash = 재시작 예산 소진); we now ship it.
  // Both columns already exist first-class in the events schema, and the
  // renderer telemetry choke point scrubs the (short) message for paths/emails.
  agentCrashed(
    win: BrowserWindow | null,
    agentId: string,
    exitCode: number,
    taskId?: string | null,
    errorCategory?: string,
    errorMessage?: string,
  ) {
    sendTelemetry(win, "agent:crashed", {
      agentId,
      exitCode,
      taskId,
      errorCategory,
      errorMessage,
    });
  },

  agentRestarted(
    win: BrowserWindow | null,
    agentId: string,
    attempt: number,
    taskId?: string | null,
  ) {
    sendTelemetry(win, "agent:restarted", { agentId, attempt, taskId });
  },

  tokenUsage(
    win: BrowserWindow | null,
    agentId: string,
    model: string,
    tokensInput: number,
    tokensOutput: number,
    cost: number,
    projectId?: string,
  ) {
    sendTelemetry(win, "token:usage", {
      agentId,
      model,
      tokensInput,
      tokensOutput,
      cost,
      projectId,
    });
  },

  heartbeat(
    win: BrowserWindow | null,
    agentId: string,
    projectId: string,
    status: string,
    tokensAccumulated: number,
    costAccumulated: number,
  ) {
    sendTelemetry(win, "agent:heartbeat", {
      agentId,
      projectId,
      status,
      tokensInput: tokensAccumulated,
      cost: costAccumulated,
    });
  },

  // ── 스폰/모델 할당 v2 (SPAWN-MODEL-ALLOCATION-V2 §8.4) ──────────

  /** modelTierForComplexity 가 complex 티어의 claude 모델을 결정한 시점. */
  modelTierResolved(
    win: BrowserWindow | null,
    model: string,
    complexity: string,
    resolvedClaudeModel: string,
    agentId?: string,
  ) {
    sendTelemetry(win, "model:tier_resolved", {
      model,
      complexity,
      resolvedClaudeModel,
      agentId,
    });
  },

  /** 버전가드 미달 / 미지 모델 / 런타임 강등 등으로 최상위 모델이 폴백된 시점. */
  topModelFallback(
    win: BrowserWindow | null,
    reason: string,
    requested: string,
    installed: string,
    fallbackTo: string,
    agentId?: string,
    taskId?: string,
  ) {
    sendTelemetry(win, "model:top_fallback", {
      reason,
      requested,
      installed,
      fallbackTo,
      agentId,
      taskId,
    });
  },

  /** complex 작업에 모델 믹스(cross-check/split-role)가 발동된 시점(§4). */
  modelMixDispatched(
    win: BrowserWindow | null,
    mode: string,
    taskId: string | null,
  ) {
    sendTelemetry(win, "model:mix_dispatched", { mode, taskId });
  },

  /** complex 작업의 단계분할이 디스패치된 시점(§5). */
  complexStagesDispatched(
    win: BrowserWindow | null,
    stageCount: number,
    perStageComplexity: string[],
    taskId: string | null,
  ) {
    sendTelemetry(win, "model:complex_stages_dispatched", {
      stageCount,
      perStageComplexity,
      taskId,
    });
  },

  // ── 디스패치 결정 스냅샷 (DISPATCH-DECISION-TELEMETRY) ────────
  //
  // "어떤 모델을 어떤 태스크(complexity/tags/role)에 왜(점수/사유) 배치했고
  // → reuse/restart/spawn 중 무엇이었나" 를 BigQuery 에서 결과(cost_logs /
  // 결과 events)와 join 분석할 수 있게 1건의 스냅샷을 남긴다. dispatchSingle 의
  // 각 종착 분기(reuse/restart/spawn) 직후 호출된다.
  //
  // 게이트·PII: 이 이벤트도 다른 모든 이벤트와 동일하게 렌더러의 logTelemetry
  // choke point(firstPartyTelemetryDefaultEnabled opt-in 게이트 + scrub PII)를
  // 통과한 뒤에야 외부로 나간다 — 동의 OFF 면 외부송신 0. 페이로드는 비식별:
  // 프롬프트 원문·파일경로·키를 절대 싣지 않는다(id/모델명/점수/사유 문자열만).
  // ── 머지 결과 스냅샷 (MERGE-OUTCOME-TELEMETRY, ticket cZBlOnkg) ─────
  //
  // 태스크가 squash-merge 로 base 에 착륙한 시점의 결과 라벨. audit 웨지
  // (merge_history)와 동일한 단일 캡처 지점(recordMergeHistory)에서 파생특징을
  // 한 번 계산해 이 이벤트로 ML 싱크(BigQuery events)에도 흘린다 — 중복 캡처
  // 없음. taskId 로 task_outcomes / cost_logs 와 join → "이 모델·역할·복잡도의
  // 태스크가 결국 머지됐나, diff 규모는 얼마였나" 라벨을 완성한다.
  //
  // 게이트·PII: 다른 이벤트와 동일하게 렌더러 logTelemetry choke point(opt-in
  // 게이트 + scrub)를 통과해야 외부로 나간다. 페이로드는 비식별 — 원문 diff/
  // 코드/파일경로 없이 개수·라인±·경로파생 카테고리만 싣는다.
  taskMerged(win: BrowserWindow | null, payload: TaskMergedPayload) {
    // taskId 는 ML join key — 없으면(ad-hoc 워크트리 머지) 학습가치 0 이라 skip.
    if (!payload.taskId) return;
    const linesAdded = payload.linesAdded ?? 0;
    const linesDeleted = payload.linesDeleted ?? 0;
    sendTelemetry(win, "task:merged", {
      taskId: payload.taskId,
      projectId: payload.projectId,
      success: true,
      // events 테이블에 이미 존재하는 first-class ML 컬럼으로 적재.
      filesChanged: payload.filesChanged,
      linesChanged: linesAdded + linesDeleted,
      // 경로파생 coarse 카테고리(docs/test/config/code/mixed) — bug-fix vs
      // feature 는 커밋 의미가 필요해 의도적으로 수집 안 함.
      taskType: payload.changeType,
      // 머지 고유 파생필드는 metadata(JSON)로 접는다(dispatch:decision 패턴).
      metadata: {
        mergeMode: payload.mode,
        linesAdded,
        linesDeleted,
        changeType: payload.changeType,
      },
    });
  },

  dispatchDecision(
    win: BrowserWindow | null,
    payload: DispatchDecisionPayload,
  ) {
    sendTelemetry(win, "dispatch:decision", {
      agentId: payload.agentId,
      taskId: payload.taskId,
      role: payload.role,
      // selectedModel → 표준 `model` 컬럼으로도 적재(GROUP BY model 용이).
      model: payload.selectedModel,
      // dispatch-decision 고유 필드들 — functions 가 metadata(JSON) 로 접는다.
      reuseVsSpawn: payload.reuseVsSpawn,
      selectedModel: payload.selectedModel,
      complexity: payload.complexity,
      tags: payload.tags,
      eligibleModels: payload.eligibleModels,
      explicitModel: payload.explicitModel,
      decisionReason: payload.decisionReason,
      modelSelectionMode: payload.modelSelectionMode,
      perModelScores: payload.perModelScores,
      agentScore: payload.agentScore,
    });
  },
};

/** task:merged 이벤트 페이로드. 비식별 — 개수·라인±·경로파생 카테고리만. */
export interface TaskMergedPayload {
  /** ML join key. null 이면 emit skip(ad-hoc 워크트리 머지). */
  taskId: string | null;
  projectId: string;
  mode: "manual" | "auto";
  /** 변경 파일 수(numstat). git show 실패 시 undefined. */
  filesChanged?: number;
  linesAdded?: number;
  linesDeleted?: number;
  /** 경로파생 coarse 카테고리(docs/test/config/code/mixed/unknown). */
  changeType?: string;
}

/** dispatch:decision 이벤트 페이로드. 비식별 — id/모델명/점수/사유만. */
export interface DispatchDecisionPayload {
  taskId: string | null;
  agentId?: string;
  role: string;
  complexity: string;
  tags: string[];
  /** 점수 경쟁에 들어간 후보 모델들(spawn 경로에서만 의미, 그 외 []). */
  eligibleModels: string[];
  selectedModel: string;
  /** scoreModelsDetailed 의 per-model 분해(spawn 경로에서만, 그 외 []). */
  perModelScores: unknown[];
  /** 선택 방식(top-score / round-robin / tie-band) — spawn 경로에서만. */
  modelSelectionMode?: string;
  /** 사람이 읽을 결정 사유(예: reuse 후보 reason 또는 spawn 사유). */
  decisionReason: string;
  reuseVsSpawn: "reuse" | "restart" | "spawn";
  /** 사용자/오케가 모델을 명시했는지(명시 시 점수경쟁 우회). */
  explicitModel: boolean;
  /** reuse/restart 경로에서 선택된 기존 에이전트의 매칭 점수. */
  agentScore?: number;
}
