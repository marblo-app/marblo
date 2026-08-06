export type RetentionHorizon = "d1" | "d7" | "d14" | "d30";

export interface RetentionCohort {
  period: "day" | "week";
  cohort: string;
  cohortUsers: number;
  returningUsers: Record<RetentionHorizon, number>;
  rates: Record<RetentionHorizon, number | null>;
}

export interface RetentionCohortsResult {
  day: RetentionCohort[];
  week: RetentionCohort[];
  note: string;
}

export interface ActivationGateStep {
  key:
    | "install"
    | "first_run"
    | "login"
    | "folder_connected"
    | "orchestrator_opened"
    | "agent_spawned"
    | "first_ticket_complete";
  event: string;
  label: string;
  users: number;
  dropFromPrev: number | null;
  dropRateFromPrev: number | null;
  isMaxDrop: boolean;
}

export interface ActivationGateFunnelResult {
  steps: ActivationGateStep[];
  maxDrop: ActivationGateStep | null;
  note: string;
}

export interface AdminRetentionCohortsResponse {
  rangeDays: number;
  generatedAt: string;
  adminExcluded: {
    applied: boolean;
    uidFiltered: boolean;
    clientIdCount: number;
  };
  cohorts: RetentionCohortsResult;
  activationGate: ActivationGateFunnelResult;
}

export interface ActiveByDayMetric {
  date: string;
  dau: number;
  events: number;
}

export interface ThirtyDayRetentionPoint {
  date: string;
  eligibleUsers: number;
  retainedUsers: number;
  retentionRate: number | null;
}

export interface AdminActiveUserMetricsResponse {
  rangeDays: number;
  generatedAt: string;
  adminExcluded: {
    applied: boolean;
    uidFiltered: boolean;
    clientIdCount: number;
  };
  dau: number;
  wau: number;
  mau: number;
  dauWauRatio: number | null;
  dauMauRatio: number | null;
  activeByDay: ActiveByDayMetric[];
  thirtyDayRetention: {
    current: ThirtyDayRetentionPoint | null;
    trend: ThirtyDayRetentionPoint[];
  };
  note: string;
}

export interface AdminAnalyticsDashboardData {
  retention: AdminRetentionCohortsResponse;
  activeUsers: AdminActiveUserMetricsResponse;
}
