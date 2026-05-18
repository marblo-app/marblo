export interface User {
  id: string; // uid
  email: string;
  displayName: string;
  photoURL: string;
  createdAt: Date;
  /**
   * Last presence heartbeat. The renderer refreshes this every 30s while the
   * marblo app is open. Consumers compute online/idle/offline from the age
   * of this timestamp — there is no separate "online" boolean.
   */
  lastHeartbeatAt?: Date;
}

export type PresenceStatus = "online" | "idle" | "offline";

/** Time-based thresholds for presence classification (in milliseconds). */
export const PRESENCE_ONLINE_WINDOW_MS = 60_000; // <= 60s = online
export const PRESENCE_IDLE_WINDOW_MS = 300_000; // 60-300s = idle, >300s = offline

export function getPresenceStatus(
  lastHeartbeatAt: Date | null | undefined,
  nowMs: number = Date.now(),
): PresenceStatus {
  if (!lastHeartbeatAt) return "offline";
  const age = nowMs - lastHeartbeatAt.getTime();
  if (age <= PRESENCE_ONLINE_WINDOW_MS) return "online";
  if (age <= PRESENCE_IDLE_WINDOW_MS) return "idle";
  return "offline";
}
