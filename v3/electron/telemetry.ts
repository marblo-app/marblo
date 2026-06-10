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
};
