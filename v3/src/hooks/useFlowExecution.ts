import { useState, useCallback, useEffect, useRef } from 'react';
import type { Flow } from '../types/flow';
import telemetry from '../services/telemetryService';

export type ExecutionState = 'idle' | 'running' | 'paused' | 'completed' | 'failed';
export type NodeExecutionStatus = 'running' | 'completed' | 'error' | 'skipped';

export interface FlowExecutionResult {
  run: (flow: Flow) => Promise<void>;
  pause: () => Promise<void>;
  resume: (humanInput?: { nodeId: string; approved: boolean; data?: unknown }) => Promise<void>;
  cancel: () => Promise<void>;
  reset: () => void;
  executionState: ExecutionState;
  runId: string | null;
  nodeStatuses: Record<string, NodeExecutionStatus>;
  nodeResults: Record<string, unknown>;
  pendingHumanNodeId: string | null;
}

export function useFlowExecution(): FlowExecutionResult {
  const [executionState, setExecutionState] = useState<ExecutionState>('idle');
  const [runId, setRunId] = useState<string | null>(null);
  const [nodeStatuses, setNodeStatuses] = useState<Record<string, NodeExecutionStatus>>({});
  const [nodeResults, setNodeResults] = useState<Record<string, unknown>>({});
  const [pendingHumanNodeId, setPendingHumanNodeId] = useState<string | null>(null);
  const runIdRef = useRef<string | null>(null);
  const flowStartTimeRef = useRef<number>(0);
  const nodeStartTimesRef = useRef<Record<string, number>>({});
  const nodeCountRef = useRef<number>(0);
  const totalNodeCountRef = useRef<number>(0);

  const setActiveRunId = useCallback((nextRunId: string | null) => {
    runIdRef.current = nextRunId;
    setRunId(nextRunId);
  }, []);

  // Set up event listener
  useEffect(() => {
    const api = window.electronAPI?.flow;
    if (!api) return;

    const handleEvent = (event: FlowEvent) => {
      switch (event.type) {
        case 'flow:started':
          setActiveRunId(event.runId);
          telemetry.flowStarted(event.runId, totalNodeCountRef.current);
          break;

        case 'node:start':
          setNodeStatuses((prev) => ({ ...prev, [event.nodeId]: 'running' }));
          nodeStartTimesRef.current[event.nodeId] = Date.now();
          nodeCountRef.current++;
          break;

        case 'node:complete': {
          setNodeStatuses((prev) => ({ ...prev, [event.nodeId]: 'completed' }));
          setNodeResults((prev) => ({
            ...prev,
            [event.nodeId]: (event.result && typeof event.result === 'object' && 'output' in (event.result as Record<string, unknown>))
              ? (event.result as Record<string, unknown>).output
              : event.result,
          }));
          const nodeDuration = Date.now() - (nodeStartTimesRef.current[event.nodeId] || Date.now());
          if (runIdRef.current) {
            telemetry.flowNodeExecuted(runIdRef.current, 'unknown', nodeDuration, true);
          }
          break;
        }

        case 'node:error': {
          setNodeStatuses((prev) => ({ ...prev, [event.nodeId]: 'error' }));
          setNodeResults((prev) => ({
            ...prev,
            [event.nodeId]: { __error: true, message: event.error },
          }));
          const errDuration = Date.now() - (nodeStartTimesRef.current[event.nodeId] || Date.now());
          if (runIdRef.current) {
            telemetry.flowNodeExecuted(runIdRef.current, 'unknown', errDuration, false);
          }
          break;
        }

        case 'flow:paused':
          setActiveRunId(event.runId);
          setExecutionState('paused');
          if (event.pendingNodeId) {
            setPendingHumanNodeId(event.pendingNodeId);
          }
          break;

        case 'flow:resumed':
          setActiveRunId(event.runId);
          setExecutionState('running');
          setPendingHumanNodeId(null);
          break;

        case 'flow:completed': {
          setActiveRunId(event.runId);
          setExecutionState('completed');
          setPendingHumanNodeId(null);
          const completedDuration = Date.now() - flowStartTimeRef.current;
          if (runIdRef.current) {
            telemetry.flowCompleted(runIdRef.current, 'completed', completedDuration, nodeCountRef.current);
          }
          break;
        }

        case 'flow:failed': {
          setActiveRunId(event.runId);
          setExecutionState('failed');
          setPendingHumanNodeId(null);
          const failedDuration = Date.now() - flowStartTimeRef.current;
          if (runIdRef.current) {
            telemetry.flowCompleted(runIdRef.current, 'failed', failedDuration, nodeCountRef.current);
          }
          break;
        }

        case 'flow:cancelled':
          setActiveRunId(null);
          setExecutionState('idle');
          setPendingHumanNodeId(null);
          setNodeStatuses({});
          setNodeResults({});
          break;
      }
    };

    api.onEvent(handleEvent);

    return () => {
      api.offEvent();
    };
  }, [setActiveRunId]);

  const run = useCallback(async (flow: Flow) => {
    const api = window.electronAPI?.flow;
    if (!api) return;

    // Reset state for new run
    setNodeStatuses({});
    setNodeResults({});
    setPendingHumanNodeId(null);
    setActiveRunId(null);
    setExecutionState('running');

    flowStartTimeRef.current = Date.now();
    nodeStartTimesRef.current = {};
    nodeCountRef.current = 0;
    totalNodeCountRef.current = flow.nodes?.length ?? 0;

    try {
      const result = await api.run(flow);
      setActiveRunId(result.runId);
    } catch (err) {
      setExecutionState('failed');
      console.error('Failed to start flow:', err);
    }
  }, [setActiveRunId]);

  const pause = useCallback(async () => {
    const api = window.electronAPI?.flow;
    if (!api || !runIdRef.current) return;

    try {
      await api.pause(runIdRef.current);
    } catch (err) {
      console.error('Failed to pause flow:', err);
    }
  }, []);

  const resume = useCallback(async (humanInput?: { nodeId: string; approved: boolean; data?: unknown }) => {
    const api = window.electronAPI?.flow;
    if (!api || !runIdRef.current) return;

    try {
      await api.resume(runIdRef.current, humanInput);
    } catch (err) {
      console.error('Failed to resume flow:', err);
    }
  }, []);

  const cancel = useCallback(async () => {
    const api = window.electronAPI?.flow;
    if (!api || !runIdRef.current) return;

    try {
      await api.cancel(runIdRef.current);
    } catch (err) {
      console.error('Failed to cancel flow:', err);
    }
  }, []);

  const reset = useCallback(() => {
    setExecutionState('idle');
    setActiveRunId(null);
    setNodeStatuses({});
    setNodeResults({});
    setPendingHumanNodeId(null);
  }, [setActiveRunId]);

  return {
    run,
    pause,
    resume,
    cancel,
    reset,
    executionState,
    runId,
    nodeStatuses,
    nodeResults,
    pendingHumanNodeId,
  };
}
