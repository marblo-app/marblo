import { useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { functions, db } from "../lib/firebase";

const logCostBatch = httpsCallable(functions, "logCostBatch");

/**
 * Listens for cost:update IPC events from Electron main process and persists
 * them in two places:
 *
 *  1. Firestore agents/<agentId> — atomic increment of rolling totals
 *     (totalCost, totalInputTokens, etc.). The Agents tab Usage view reads
 *     these via the existing agentStore subscription, so cost shows up live
 *     without depending on BigQuery / Cloud Functions.
 *
 *  2. BigQuery via the logCostBatch Cloud Function — for historical
 *     analytics. Best-effort; failures are logged but don't break the UI
 *     since the Firestore path covers the live read path.
 *
 * Each cost:update from main carries DELTA values (not totals), so we use
 * Firestore `increment()` for atomicity across multiple windows / restarts.
 */
export function useCostWriter() {
  useEffect(() => {
    if (!window.electronAPI?.agent?.onCostUpdate) return;
    // DIAGNOSTIC: skip cost writes when telemetry disabled. Each cost:update
    // triggers a Firebase Cloud Function call — during streaming responses
    // these can pile up on the main thread.
    if (import.meta.env.VITE_DISABLE_TELEMETRY === "1") {
      console.warn("[DIAG] useCostWriter DISABLED");
      return;
    }

    window.electronAPI.agent.offCostUpdate?.();
    window.electronAPI.agent.onCostUpdate((data) => {
      // 1. Firestore — agents/<id> rolling totals (atomic increment).
      // Important: do NOT write back agent.model. The cost tracker
      // detects the precise model id from session metadata (e.g.
      // "claude-opus-4-7"), but agent.model is the ModelType *family*
      // ('claude' | 'gemini' | 'gpt' | 'custom') used by UI lookups
      // (MODEL_ICONS, MODEL_PRICING, etc). Overwriting it with the
      // versioned id breaks AgentStatusCard / MemberCard which index
      // those tables by family — they crashed the Agents tab. Stash
      // the detected id under detectedModelId for analytics instead.
      if (data.agentId) {
        const ref = doc(db, "agents", data.agentId);
        const update: Record<string, unknown> = {
          totalCost: increment(data.totalCost || 0),
          totalInputTokens: increment(data.inputTokens || 0),
          totalOutputTokens: increment(data.outputTokens || 0),
          totalCacheReadTokens: increment(data.cacheReadTokens || 0),
          totalCacheWriteTokens: increment(data.cacheWriteTokens || 0),
          costUpdatedAt: serverTimestamp(),
        };
        if (data.model) update.detectedModelId = data.model;
        updateDoc(ref, update).catch((err) => {
          // Doc may not exist yet (e.g. orchestrator session) — ignore.
          console.warn(
            `[CostWriter] Firestore update skipped for agent=${data.agentId}:`,
            err?.code || err?.message || err,
          );
        });
      }

      // 2. BigQuery — historical analytics.
      logCostBatch({
        entries: [
          {
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
          },
        ],
      })
        .then((result) => {
          const res = result.data as { inserted: number };
          console.log(
            `[CostWriter] Sent to BigQuery: ${res.inserted} entry for agent=${data.agentId}`,
          );
        })
        .catch((err) => {
          console.error("[CostWriter] Failed to send cost log:", err);
        });
    });

    return () => {
      window.electronAPI?.agent?.offCostUpdate?.();
    };
  }, []);
}
