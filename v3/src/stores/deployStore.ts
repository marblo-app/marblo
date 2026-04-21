import { create } from 'zustand';
import type { GcpConfig, Deployment } from '../types/deploy';
import * as deployService from '../services/deployService';

interface DeployState {
  gcpConfig: GcpConfig | null;
  deployments: Deployment[];
  loading: boolean;
  error: string | null;

  subscribeToConfig: (projectId: string) => () => void;
  subscribeToDeployments: (projectId: string) => () => void;
  saveGcpConfig: (projectId: string, config: Omit<GcpConfig, 'lastChecked'>) => Promise<void>;
  clearError: () => void;
}

export const useDeployStore = create<DeployState>((set) => ({
  gcpConfig: null,
  deployments: [],
  loading: false,
  error: null,

  subscribeToConfig: (projectId: string) => {
    if (!projectId) {
      set({ gcpConfig: null });
      return () => {};
    }
    return deployService.subscribeToGcpConfig(projectId, (config) => {
      set({ gcpConfig: config });
    });
  },

  subscribeToDeployments: (projectId: string) => {
    if (!projectId) {
      set({ deployments: [], loading: false });
      return () => {};
    }
    set({ loading: true });
    return deployService.subscribeToDeployments(projectId, (deployments) => {
      set({ deployments, loading: false });
    });
  },

  saveGcpConfig: async (projectId, config) => {
    try {
      await deployService.saveGcpConfig(projectId, config);
    } catch (err) {
      set({ error: (err as Error).message });
    }
  },

  clearError: () => set({ error: null }),
}));
