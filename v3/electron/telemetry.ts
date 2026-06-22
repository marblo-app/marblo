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

  agentCrashed(win: BrowserWindow | null, agentId: string, exitCode: number) {
    sendTelemetry(win, "agent:crashed", { agentId, exitCode });
  },

  agentRestarted(win: BrowserWindow | null, agentId: string, attempt: number) {
    sendTelemetry(win, "agent:restarted", { agentId, attempt });
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
