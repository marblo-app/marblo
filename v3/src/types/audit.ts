export interface AuditLog {
  id: string;
  projectId: string;
  agentId: string;
  toolName: string;
  params: Record<string, unknown>;
  result: string;
  duration: number;
  success: boolean;
  createdAt: Date;
}
