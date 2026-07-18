import { useEffect } from "react";
import { httpsCallable } from "firebase/functions";
import { doc, updateDoc, increment, serverTimestamp } from "firebase/firestore";
import { functions, db } from "../lib/firebase";
import { isTelemetryEnabled } from "../services/telemetryService";
import { recordTaskCost } from "../services/taskRollups";

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
    window.electronAPI.agent.offCostUpdate?.();
    window.electronAPI.agent.onCostUpdate((data) => {
      // External cost writes (Firestore agents/<id> roll-ups + BigQuery
      // logCostBatch) are first-party telemetry. Respect the build kill-switch
      // and the user's runtime opt-out without unregistering the IPC listener.
      if (!isTelemetryEnabled()) {
        console.info(
          "[CostWriter] first-party telemetry OFF — skipping Firestore/BigQuery cost writes",
        );
        return;
      }

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
        // Rate-limit / plan snapshot (codex) — SET latest value, not increment.
        if (data.detectedPlanType)
          update.detectedPlanType = data.detectedPlanType;
        if (typeof data.rateLimitPercent === "number")
          update.rateLimitPercent = data.rateLimitPercent;
        if (typeof data.rateLimitResetAt === "number")
          update.rateLimitResetAt = data.rateLimitResetAt;
        if (typeof data.rateLimitWeeklyPercent === "number")
          update.rateLimitWeeklyPercent = data.rateLimitWeeklyPercent;
        if (typeof data.rateLimitWeeklyResetAt === "number")
          update.rateLimitWeeklyResetAt = data.rateLimitWeeklyResetAt;
        updateDoc(ref, update).catch((err) => {
          // Doc may not exist yet (e.g. orchestrator session) — ignore.
          console.warn(
            `[CostWriter] Firestore update skipped for agent=${data.agentId}:`,
            err?.code || err?.message || err,
          );
        });
      }

      // 1b. Firestore — tasks/<id> per-task rollups. The agent doc totals
      // above are LIFETIME sums across every task an agent ever touched, which
      // is why task_outcomes.totalCost was 0/NULL in 29/29 BigQuery rows: it
      // read a number that answers a different question. data.taskId is the
      // agent's currentTaskId — the same stamp that gives cost_logs its 98.6%
      // join rate — so these deltas attribute cleanly to one ticket. Buffered
      // and flushed on an interval; see services/taskRollups.ts.
      if (data.taskId) {
        recordTaskCost(data.taskId, {
          cost: data.totalCost,
          inputTokens: data.inputTokens,
          outputTokens: data.outputTokens,
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
          console.debug(
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
