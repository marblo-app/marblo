export type DeployStatus = 'pending' | 'building' | 'deploying' | 'success' | 'failed';
export type SchedulerStatus = 'enabled' | 'paused' | 'disabled';

export interface GcpConfig {
  projectId: string;
  region: string;
  serviceAccountEmail: string;
  connected: boolean;
  lastChecked: Date | null;
}

export interface CloudRunService {
  id: string;
  name: string;
  url: string;
  region: string;
  status: 'active' | 'inactive';
  lastDeployedAt: Date | null;
  image: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  serviceName: string;
  status: DeployStatus;
  image: string;
  region: string;
  triggeredBy: string;
  logs: string;
  startedAt: Date;
  completedAt: Date | null;
  error: string | null;
}

export interface SchedulerJob {
  id: string;
  name: string;
  schedule: string;
  targetUrl: string;
  httpMethod: 'GET' | 'POST';
  status: SchedulerStatus;
  lastRunAt: Date | null;
  nextRunAt: Date | null;
  timeZone: string;
}
