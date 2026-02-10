import { Task, ActivityLog } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

export type SSEEventType =
  | "task_created"
  | "task_updated"
  | "task_claimed"
  | "task_review"
  | "task_done"
  | "task_activity";

export type SSECallback = (event: SSEEventType, task: Task) => void;
export type SSEActivityCallback = (taskId: string, activity: ActivityLog) => void;

export interface SSEConnection {
  close: () => void;
  isConnected: () => boolean;
}

const EVENT_TYPES: SSEEventType[] = [
  "task_created",
  "task_updated",
  "task_claimed",
  "task_review",
  "task_done",
  "task_activity",
];

export function connectSSE(
  onEvent: SSECallback,
  onConnectionChange?: (connected: boolean) => void,
  onActivity?: SSEActivityCallback,
): SSEConnection {
  let eventSource: EventSource | null = null;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let connected = false;
  let closed = false;

  function handleEvent(eventType: SSEEventType, event: MessageEvent) {
    try {
      const parsed = JSON.parse(event.data);
      if (eventType === "task_activity") {
        const activity: ActivityLog = parsed.activity;
        const taskId: string = parsed.task_id;
        if (activity && taskId && onActivity) {
          onActivity(taskId, activity);
        }
        return;
      }
      // Backend sends: { "type": "...", "task": { ...TaskResponse } }
      const task: Task = parsed.task;
      if (task) {
        onEvent(eventType, task);
      }
    } catch {
      // Ignore malformed messages
    }
  }

  function connect() {
    if (closed) return;

    try {
      eventSource = new EventSource(`${API_BASE}/api/events`);

      eventSource.onopen = () => {
        connected = true;
        onConnectionChange?.(true);
      };

      // Register listeners for each event type the backend emits
      for (const eventType of EVENT_TYPES) {
        eventSource.addEventListener(eventType, (event) => {
          handleEvent(eventType, event as MessageEvent);
        });
      }

      eventSource.onerror = () => {
        connected = false;
        onConnectionChange?.(false);
        eventSource?.close();
        eventSource = null;

        // Auto-reconnect after 3 seconds
        if (!closed) {
          reconnectTimer = setTimeout(connect, 3000);
        }
      };
    } catch {
      connected = false;
      onConnectionChange?.(false);
      if (!closed) {
        reconnectTimer = setTimeout(connect, 3000);
      }
    }
  }

  connect();

  return {
    close: () => {
      closed = true;
      if (reconnectTimer) clearTimeout(reconnectTimer);
      eventSource?.close();
      eventSource = null;
      connected = false;
      onConnectionChange?.(false);
    },
    isConnected: () => connected,
  };
}
