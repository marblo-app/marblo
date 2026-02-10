import { Task, CreateTaskPayload, UpdateTaskPayload, ActivityLog } from "./types";

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:8001";

class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit & { noJson?: boolean },
): Promise<T> {
  const url = `${API_BASE}${endpoint}`;
  const { noJson, ...fetchOptions } = options || {};
  const res = await fetch(url, {
    ...fetchOptions,
    headers: {
      "Content-Type": "application/json",
      ...fetchOptions?.headers,
    },
  });

  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || res.statusText);
  }

  if (noJson || res.status === 204) {
    return undefined as T;
  }

  return res.json();
}

export async function getTasks(status?: string, role?: string, project?: string): Promise<Task[]> {
  const params = new URLSearchParams();
  if (status) params.set("status", status);
  if (role) params.set("role", role);
  if (project) params.set("project", project);
  const query = params.toString();
  return fetchApi<Task[]>(`/api/tasks${query ? `?${query}` : ""}`);
}

export async function getTask(id: string): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}`);
}

export async function createTask(payload: CreateTaskPayload): Promise<Task> {
  return fetchApi<Task>("/api/tasks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function updateTask(
  id: string,
  payload: UpdateTaskPayload,
): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export async function deleteTask(id: string): Promise<void> {
  await fetchApi<void>(`/api/tasks/${id}`, {
    method: "DELETE",
    noJson: true,
  });
}

export async function claimTask(
  id: string,
  agentId: string,
): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}/claim`, {
    method: "POST",
    body: JSON.stringify({ agent_id: agentId }),
  });
}

export async function submitForReview(
  id: string,
  prUrl: string,
): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}/review`, {
    method: "POST",
    body: JSON.stringify({ pr_url: prUrl }),
  });
}

export async function approveTask(id: string): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}/approve`, {
    method: "POST",
  });
}

export async function rejectTask(
  id: string,
  comment: string,
): Promise<Task> {
  return fetchApi<Task>(`/api/tasks/${id}/reject`, {
    method: "POST",
    body: JSON.stringify({ comment }),
  });
}

export async function getTaskActivities(taskId: string): Promise<ActivityLog[]> {
  return fetchApi<ActivityLog[]>(`/api/tasks/${taskId}/activities`);
}

export async function addTaskActivity(
  taskId: string,
  message: string,
  agentId?: string,
): Promise<ActivityLog> {
  return fetchApi<ActivityLog>(`/api/tasks/${taskId}/activities`, {
    method: "POST",
    body: JSON.stringify({ message, agent_id: agentId }),
  });
}

export { ApiError };
