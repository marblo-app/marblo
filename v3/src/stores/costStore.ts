import { create } from 'zustand';
import type { CostLog, CostSummary } from '../types/cost';
import { fetchCostLogs, calculateSummary } from '../services/costService';

interface CostState {
  logs: CostLog[];
  summary: CostSummary | null;
  loading: boolean;
  loadCosts: (projectId: string) => Promise<void>;
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
      console.error('[CostStore] Failed to load costs:', error);
      set({ loading: false });
    }
  },
}));
