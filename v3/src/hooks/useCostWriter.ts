import { useEffect } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const logCostBatch = httpsCallable(functions, 'logCostBatch');

/**
 * Listens for cost:update IPC events from Electron main process
 * and sends them to BigQuery via Cloud Function.
 */
export function useCostWriter() {
  useEffect(() => {
    if (!window.electronAPI?.agent?.onCostUpdate) return;
    // DIAGNOSTIC: skip cost writes when telemetry disabled. Each cost:update
    // triggers a Firebase Cloud Function call — during streaming responses
    // these can pile up on the main thread.
    if (import.meta.env.VITE_DISABLE_TELEMETRY === '1') {
      console.warn('[DIAG] useCostWriter DISABLED');
      return;
    }

    window.electronAPI.agent.offCostUpdate?.();
    window.electronAPI.agent.onCostUpdate((data) => {
      logCostBatch({
        entries: [{
          projectId: data.projectId,
          agentId: data.agentId,
          model: data.model,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
          cacheReadTokens: data.cacheReadTokens,
          cacheWriteTokens: data.cacheWriteTokens,
          totalCost: data.totalCost,
          // ML-ready: task linkage
          taskId: data.taskId || null,
          taskType: data.taskType || null,
          sessionId: data.sessionId || null,
        }],
      }).then((result) => {
        const res = result.data as { inserted: number };
        console.log(`[CostWriter] Sent to BigQuery: ${res.inserted} entry for agent=${data.agentId}`);
      }).catch((err) => {
        console.error('[CostWriter] Failed to send cost log:', err);
      });
    });

    return () => {
      window.electronAPI?.agent?.offCostUpdate?.();
    };
  }, []);
}
