export enum TaskStatus {
  TODO = "TODO",
  CLAIMED = "CLAIMED",
  IN_PROGRESS = "IN_PROGRESS",
  REVIEW = "REVIEW",
  BLOCKED = "BLOCKED",
  FAILED = "FAILED",
  DONE = "DONE",
}

export enum TaskRole {
  backend = "backend",
  frontend = "frontend",
  test = "test",
  devops = "devops",
}

export interface ActivityLog {
  id: string;
  task_id: string;
  agent_id: string | null;
  message: string;
  created_at: string;
}

export interface Task {
  id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  role: TaskRole;
  priority: number;
  depends_on: string[] | null;
  depends_on_completed: boolean;
  claimed_by: string | null;
  claimed_at: string | null;
  created_at: string;
  updated_at: string;
  comment: string | null;
  pr_url: string | null;
  activities?: ActivityLog[];
}

export interface CreateTaskPayload {
  title: string;
  description?: string;
  role: TaskRole;
  priority?: number;
  depends_on?: string[];
}

export interface UpdateTaskPayload {
  title?: string;
  description?: string;
  status?: TaskStatus;
  role?: TaskRole;
  priority?: number;
  depends_on?: string[];
  claimed_by?: string;
  comment?: string;
  pr_url?: string;
}

export interface SSEEvent {
  event: string;
  data: Task | Task[];
}

export const COLUMN_STATUSES = [
  TaskStatus.TODO,
  TaskStatus.CLAIMED,
  TaskStatus.IN_PROGRESS,
  TaskStatus.REVIEW,
  TaskStatus.DONE,
] as const;

export const STATUS_LABELS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: "To Do",
  [TaskStatus.CLAIMED]: "Claimed",
  [TaskStatus.IN_PROGRESS]: "In Progress",
  [TaskStatus.REVIEW]: "Review",
  [TaskStatus.BLOCKED]: "Blocked",
  [TaskStatus.FAILED]: "Failed",
  [TaskStatus.DONE]: "Done",
};

export const STATUS_COLORS: Record<TaskStatus, string> = {
  [TaskStatus.TODO]: "bg-gray-600",
  [TaskStatus.CLAIMED]: "bg-blue-600",
  [TaskStatus.IN_PROGRESS]: "bg-yellow-600",
  [TaskStatus.REVIEW]: "bg-purple-600",
  [TaskStatus.BLOCKED]: "bg-red-600",
  [TaskStatus.FAILED]: "bg-red-800",
  [TaskStatus.DONE]: "bg-green-600",
};

export const ROLE_COLORS: Record<TaskRole, string> = {
  [TaskRole.backend]: "bg-orange-500/20 text-orange-400 border-orange-500/30",
  [TaskRole.frontend]: "bg-cyan-500/20 text-cyan-400 border-cyan-500/30",
  [TaskRole.test]: "bg-pink-500/20 text-pink-400 border-pink-500/30",
  [TaskRole.devops]: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
};

export const AGENT_COLORS: Record<string, { border: string; bg: string; text: string }> = {
  backend: { border: "border-blue-500", bg: "bg-blue-500", text: "text-blue-400" },
  frontend: { border: "border-green-500", bg: "bg-green-500", text: "text-green-400" },
  test: { border: "border-yellow-500", bg: "bg-yellow-500", text: "text-yellow-400" },
  devops: { border: "border-orange-500", bg: "bg-orange-500", text: "text-orange-400" },
  merge: { border: "border-purple-500", bg: "bg-purple-500", text: "text-purple-400" },
  pm: { border: "border-gray-300", bg: "bg-gray-300", text: "text-gray-300" },
};

export function getAgentColor(agentId: string | null) {
  if (!agentId) return { border: "border-gray-600", bg: "bg-gray-600", text: "text-gray-500" };
  const key = Object.keys(AGENT_COLORS).find((k) => agentId.toLowerCase().includes(k));
  return key ? AGENT_COLORS[key] : { border: "border-gray-400", bg: "bg-gray-400", text: "text-gray-400" };
}
