"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Task } from "@/lib/types";
import { getTasks } from "@/lib/api";
import { connectSSE, SSEConnection, SSEEventType } from "@/lib/sse";
import { ToastType } from "./useToast";

export function useTasks(
  onToast?: (message: string, type: ToastType) => void,
) {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sseConnected, setSseConnected] = useState(false);
  const sseRef = useRef<SSEConnection | null>(null);
  const onToastRef = useRef(onToast);
  onToastRef.current = onToast;

  const fetchTasks = useCallback(async () => {
    try {
      setError(null);
      const data = await getTasks();
      setTasks(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to fetch tasks");
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial fetch
  useEffect(() => {
    fetchTasks();
  }, [fetchTasks]);

  // SSE subscription for real-time updates
  useEffect(() => {
    function triggerToast(event: SSEEventType, task: Task) {
      const toast = onToastRef.current;
      if (!toast) return;
      const title = task.title?.slice(0, 30) || "Task";
      switch (event) {
        case "task_created":
          toast(`New: ${title}`, "info");
          break;
        case "task_claimed":
          toast(`${task.claimed_by || "Agent"} claimed [${title}]`, "warning");
          break;
        case "task_done":
          toast(`[${title}] Done!`, "success");
          break;
        case "task_updated":
          toast(`[${title}] → ${task.status}`, "info");
          break;
        case "task_review":
          toast(`[${title}] submitted for review`, "warning");
          break;
      }
    }

    const sse = connectSSE(
      (event, task) => {
        switch (event) {
          case "task_created":
            setTasks((prev) => {
              // Avoid duplicates
              if (prev.some((t) => t.id === task.id)) {
                return prev.map((t) => (t.id === task.id ? task : t));
              }
              return [...prev, task];
            });
            break;
          case "task_updated":
          case "task_claimed":
          case "task_review":
          case "task_done":
            setTasks((prev) =>
              prev.map((t) => (t.id === task.id ? task : t)),
            );
            break;
        }
        triggerToast(event, task);
      },
      (connected) => {
        setSseConnected(connected);
        // Refetch when reconnecting to catch missed events
        if (connected) {
          fetchTasks();
        }
      },
      (taskId, activity) => {
        setTasks((prev) =>
          prev.map((t) => {
            if (t.id !== taskId) return t;
            const existing = t.activities || [];
            // Avoid duplicates
            if (existing.some((a) => a.id === activity.id)) return t;
            return { ...t, activities: [...existing, activity] };
          }),
        );
      },
    );

    sseRef.current = sse;

    return () => {
      sse.close();
    };
  }, [fetchTasks]);

  const refetch = useCallback(() => {
    setLoading(true);
    fetchTasks();
  }, [fetchTasks]);

  return {
    tasks,
    loading,
    error,
    sseConnected,
    refetch,
    setTasks,
  };
}
