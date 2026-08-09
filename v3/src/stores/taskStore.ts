import { create } from 'zustand';
import type { Task, TaskStatus } from '../types/task';
import { subscribeToTasks as subscribeToTasksService } from '../services/taskService';
import * as taskService from '../services/taskService';
import telemetry from '../services/telemetryService';

interface TaskFilter {
  status: TaskStatus | null;
  role: string | null;
}

interface TaskState {
  tasks: Task[];
  loading: boolean;
  filter: TaskFilter;

  fetchTasks: (projectId: string) => Promise<void>;
  subscribeToTasks: (projectId: string) => () => void;
  refreshTasks: (projectId: string) => Promise<void>;
  createTask: (data: Omit<Task, 'id' | 'createdAt' | 'updatedAt'>) => Promise<string>;
  updateTask: (id: string, data: Partial<Task>) => Promise<void>;
  updateTaskStatus: (id: string, status: TaskStatus) => Promise<void>;
  setFilter: (filter: Partial<TaskFilter>) => void;
  getFilteredTasks: () => Task[];
}

interface ActiveTaskSubscription {
  projectId: string;
  unsubscribe: () => void;
}

let activeTaskSubscription: ActiveTaskSubscription | null = null;

function unsubscribeActiveTaskSubscription(): void {
  activeTaskSubscription?.unsubscribe();
}

export const useTaskStore = create<TaskState>((set, get) => ({
  tasks: [],
  loading: false,
  filter: {
    status: null,
    role: null,
  },

  fetchTasks: async (projectId: string) => {
    set({ loading: true });
    try {
      const tasks = await taskService.getTasks(projectId);
      set({ tasks, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  subscribeToTasks: (projectId: string) => {
    unsubscribeActiveTaskSubscription();
    set({ loading: true });
    let isActive = true;
    const unsubscribeService = subscribeToTasksService(projectId, (tasks) => {
      if (!isActive) return;
      // 활성화 퍼널의 "첫 티켓" 칸(설치당 1회). 여기서 세는 이유는 오케가 MCP
      // 로 만든 티켓이 렌더러 taskService 를 우회하기 때문 — 보드에 보이는 것을
      // 기준으로 하면 생성 경로와 무관하게 잡힌다. 헬퍼가 자체 one-shot 이라
      // 스냅샷이 여러 번 와도 한 번만 나간다.
      if (tasks.length > 0) telemetry.firstTicketObserved();
      set({ tasks, loading: false });
    });

    const unsubscribe = () => {
      if (!isActive) return;
      isActive = false;
      unsubscribeService();
      if (activeTaskSubscription?.unsubscribe === unsubscribe) {
        activeTaskSubscription = null;
      }
    };

    activeTaskSubscription = { projectId, unsubscribe };
    return () => {
      if (activeTaskSubscription?.projectId === projectId) {
        activeTaskSubscription.unsubscribe();
        return;
      }
      unsubscribe();
    };
  },

  refreshTasks: async (projectId: string) => {
    unsubscribeActiveTaskSubscription();
    get().subscribeToTasks(projectId);
    try {
      const tasks = await taskService.getTasks(projectId);
      if (activeTaskSubscription?.projectId === projectId) {
        set({ tasks, loading: false });
      }
    } catch {
      if (activeTaskSubscription?.projectId === projectId) {
        set({ loading: false });
      }
    }
  },

  createTask: async (data) => {
    return taskService.createTask(data);
  },

  updateTask: async (id, data) => {
    await taskService.updateTask(id, data);
  },

  updateTaskStatus: async (id, status) => {
    await taskService.updateTaskStatus(id, status);
  },

  setFilter: (filter) => {
    set((s) => ({ filter: { ...s.filter, ...filter } }));
  },

  getFilteredTasks: () => {
    const { tasks, filter } = get();
    return tasks.filter((t) => {
      if (filter.status && t.status !== filter.status) return false;
      if (filter.role && t.role !== filter.role) return false;
      return true;
    });
  },
}));
