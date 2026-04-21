import { useEffect, useRef } from 'react';
import { httpsCallable } from 'firebase/functions';
import { functions } from '../lib/firebase';

const logCostBatch = httpsCallable(functions, 'logCostBatch');

/**
 * Listens for cost:update IPC events from Electron main process
 * and sends them to BigQuery via Cloud Function.
 */
export function useCostWriter() {
  const registered = useRef(false);

  useEffect(() => {
    if (registered.current) return;
    if (!window.electronAPI?.agent?.onCostUpdate) return;

    registered.current = true;

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
  }, []);
}
