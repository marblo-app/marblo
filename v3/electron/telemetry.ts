import { BrowserWindow } from 'electron';

// Send telemetry events to the renderer process for Firestore persistence
export function sendTelemetry(
  win: BrowserWindow | null,
  event: string,
  payload: Record<string, unknown>
) {
  if (!win || win.isDestroyed()) return;
  try {
    win.webContents.send('telemetry:event', { event, ...payload });
  } catch {
    // Silently fail
  }
}

export const mainTelemetry = {
  agentSpawned(win: BrowserWindow | null, agentId: string, name: string, model: string, role: string, projectId?: string) {
    sendTelemetry(win, 'agent:spawned', { agentId, name, model, role, projectId });
  },

  agentStopped(win: BrowserWindow | null, agentId: string, exitCode?: number) {
    sendTelemetry(win, 'agent:stopped', { agentId, exitCode });
  },

  agentCrashed(win: BrowserWindow | null, agentId: string, exitCode: number) {
    sendTelemetry(win, 'agent:crashed', { agentId, exitCode });
  },

  agentRestarted(win: BrowserWindow | null, agentId: string, attempt: number) {
    sendTelemetry(win, 'agent:restarted', { agentId, attempt });
  },

  tokenUsage(win: BrowserWindow | null, agentId: string, model: string, tokensInput: number, tokensOutput: number, cost: number, projectId?: string) {
    sendTelemetry(win, 'token:usage', { agentId, model, tokensInput, tokensOutput, cost, projectId });
  },

  heartbeat(win: BrowserWindow | null, agentId: string, projectId: string, status: string, tokensAccumulated: number, costAccumulated: number) {
    sendTelemetry(win, 'agent:heartbeat', { agentId, projectId, status, tokensInput: tokensAccumulated, cost: costAccumulated });
  },
};
