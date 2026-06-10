import { create } from "zustand";
import type { CostLog, CostSummary } from "../types/cost";
import {
  fetchCostLogs,
  calculateSummary,
  fetchCostSummary,
} from "../services/costService";
import type {
  CostByDayEntry,
  CostWeeklyByModel,
} from "../services/costService";

// Last-7-days token rollup derived from getCostSummary (weekly* fields).
export interface CostWeekly {
  byModel: CostWeeklyByModel[];
  totalTokens: number;
  cost: number;
  rangeDays: number;
}

interface CostState {
  logs: CostLog[];
  summary: CostSummary | null;
  loading: boolean;
  loadCosts: (projectId: string) => Promise<void>;

  // getCostSummary (server-side BigQuery daily/weekly token aggregation).
  // `trend` is the per-day+model breakdown driving the daily-trend chart;
  // `weekly` is the last-7-days rollup behind the "최근 7일 총 토큰량" card.
  trend: CostByDayEntry[];
  weekly: CostWeekly | null;
  summaryLoading: boolean;
  loadSummary: (projectId: string, days?: number) => Promise<void>;
}

export const useCostStore = create<CostState>((set) => ({
  logs: [],
  summary: null,
  loading: false,

  loadCosts: async (projectId: string) => {
    if (!projectId) {
      set({ logs: [], summary: null, loading: false });
      return;
    }
    set({ loading: true });
    try {
      const logs = await fetchCostLogs(projectId);
      set({
        logs,
        summary: calculateSummary(logs),
        loading: false,
      });
    } catch (error) {
      console.error("[CostStore] Failed to load costs:", error);
      set({ loading: false });
    }
  },

  trend: [],
  weekly: null,
  summaryLoading: false,

  loadSummary: async (projectId: string, days = 30) => {
    if (!projectId) {
      set({ trend: [], weekly: null, summaryLoading: false });
      return;
    }
    set({ summaryLoading: true });
    try {
      const res = await fetchCostSummary(projectId, days);
      set({
        trend: res.byDay,
        weekly: {
          byModel: res.weeklyByModel,
          totalTokens: res.weeklyTotalTokens,
          cost: res.weeklyCost,
          rangeDays: res.rangeDays,
        },
        summaryLoading: false,
      });
    } catch (error) {
      // Function may be undeployed in dev — leave trend/weekly empty so the UI
      // renders its graceful empty states instead of crashing.
      console.error("[CostStore] Failed to load cost summary:", error);
      set({ summaryLoading: false });
    }
  },
}));
