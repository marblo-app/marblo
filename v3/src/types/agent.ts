export type ModelType = 'claude' | 'gemini' | 'gpt' | 'custom';
export type AgentStatus = 'idle' | 'working' | 'error' | 'stopped';

export interface Agent {
  id: string;
  projectId: string;
  ownerId: string;
  name: string;
  model: ModelType;
  role: string;
  status: AgentStatus;
  currentTaskId: string | null;
  command: string;
  skillFile: string;
  createdAt: Date;
}
