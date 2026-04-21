import { useState, useEffect, useCallback, useRef } from 'react';
import { where } from 'firebase/firestore';
import type { Flow, FlowNode, FlowEdge } from '../types/flow';
import { subscribeToCollection, convertTimestamps } from '../services/firestore';
import * as flowService from '../services/flowService';

const COLLECTION = 'flows';
const DATE_FIELDS = ['createdAt', 'updatedAt'];
const AUTOSAVE_DELAY = 3000;

function toFlow(raw: Record<string, unknown>): Flow {
  return convertTimestamps<Flow>(raw, DATE_FIELDS);
}

export function useFlows(projectId: string) {
  const [flows, setFlows] = useState<Flow[]>([]);
  const [selectedFlowId, setSelectedFlowId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [saveStatus, setSaveStatus] = useState<'saved' | 'saving' | 'unsaved'>('saved');
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const selectedFlow = flows.find((f) => f.id === selectedFlowId) ?? null;

  // Real-time subscription
  useEffect(() => {
    if (!projectId) {
      setFlows([]);
      setLoading(false);
      return;
    }

    setLoading(true);
    const unsubscribe = subscribeToCollection<Record<string, unknown>>(
      COLLECTION,
      [where('projectId', '==', projectId)],
      (docs) => {
        setFlows(docs.map(toFlow));
        setLoading(false);
      },
    );

    return () => unsubscribe();
  }, [projectId]);

  const createFlow = useCallback(
    async (name: string, preset?: { nodes: FlowNode[]; edges: FlowEdge[]; description?: string }) => {
      try {
        const id = await flowService.createFlow({
          projectId,
          name,
          description: preset?.description || '',
          nodes: preset?.nodes || [],
          edges: preset?.edges || [],
          status: 'draft',
          createdBy: 'user',
        });
        setSelectedFlowId(id);
        return id;
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create flow');
        throw err;
      }
    },
    [projectId],
  );

  const deleteFlow = useCallback(
    async (flowId: string) => {
      try {
        await flowService.deleteFlow(flowId);
        if (selectedFlowId === flowId) {
          setSelectedFlowId(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete flow');
        throw err;
      }
    },
    [selectedFlowId],
  );

  const saveFlow = useCallback(
    async (flowId: string, data: { nodes?: FlowNode[]; edges?: FlowEdge[]; name?: string }) => {
      try {
        setSaveStatus('saving');
        await flowService.updateFlow(flowId, data);
        setSaveStatus('saved');
      } catch (err) {
        setSaveStatus('unsaved');
        setError(err instanceof Error ? err.message : 'Failed to save flow');
        throw err;
      }
    },
    [],
  );

  const autoSave = useCallback(
    (flowId: string, data: { nodes?: FlowNode[]; edges?: FlowEdge[] }) => {
      setSaveStatus('unsaved');
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
      autosaveTimer.current = setTimeout(() => {
        saveFlow(flowId, data);
      }, AUTOSAVE_DELAY);
    },
    [saveFlow],
  );

  // Cleanup autosave timer
  useEffect(() => {
    return () => {
      if (autosaveTimer.current) {
        clearTimeout(autosaveTimer.current);
      }
    };
  }, []);

  return {
    flows,
    selectedFlow,
    selectedFlowId,
    loading,
    error,
    saveStatus,
    setSelectedFlowId,
    createFlow,
    deleteFlow,
    saveFlow,
    autoSave,
    clearError: () => setError(null),
  };
}
