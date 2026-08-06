import { httpsCallable } from "firebase/functions";
import { functions } from "../lib/firebase";
import type {
  AdminActiveUserMetricsResponse,
  AdminAnalyticsDashboardData,
  AdminRetentionCohortsResponse,
} from "../types/adminAnalytics";

export interface AdminAnalyticsQuery {
  days?: number;
  includeAdmin?: boolean;
}

const getAdminRetentionCohortsFn = httpsCallable<
  AdminAnalyticsQuery,
  AdminRetentionCohortsResponse
>(functions, "getAdminRetentionCohorts");

const getAdminActiveUserMetricsFn = httpsCallable<
  AdminAnalyticsQuery,
  AdminActiveUserMetricsResponse
>(functions, "getAdminActiveUserMetrics");

function readMockAdminAnalytics():
  | AdminAnalyticsDashboardData
  | AdminRetentionCohortsResponse
  | null {
  if (!window.electronAPI?.testMode?.bypassAuth) return null;
  const raw = window.localStorage.getItem("marblo:test:adminAnalyticsData");
  if (!raw) return null;
  return JSON.parse(raw) as
    | AdminAnalyticsDashboardData
    | AdminRetentionCohortsResponse;
}

export async function getAdminRetentionCohorts(
  query: AdminAnalyticsQuery = {}
): Promise<AdminRetentionCohortsResponse> {
  const mock = readMockAdminAnalytics();
  if (mock) return "retention" in mock ? mock.retention : mock;
  const result = await getAdminRetentionCohortsFn(query);
  return result.data;
}

export async function getAdminActiveUserMetrics(
  query: AdminAnalyticsQuery = {}
): Promise<AdminActiveUserMetricsResponse> {
  const mock = readMockAdminAnalytics();
  if (mock && "activeUsers" in mock) return mock.activeUsers;
  const result = await getAdminActiveUserMetricsFn(query);
  return result.data;
}

export async function getAdminAnalyticsDashboard(
  query: AdminAnalyticsQuery = {}
): Promise<AdminAnalyticsDashboardData> {
  const [retention, activeUsers] = await Promise.all([
    getAdminRetentionCohorts(query),
    getAdminActiveUserMetrics(query),
  ]);
  return { retention, activeUsers };
}
