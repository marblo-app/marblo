import type { Unsubscribe } from "firebase/firestore";
import type { User } from "../types/user";
import { USER_DATE_FIELDS } from "../types/user";
import {
  updateDocument,
  subscribeToDocument,
  toTimestamp,
  convertTimestamps,
} from "./firestore";

const COLLECTION = "users";

/**
 * Refresh the calling user's heartbeat. Best-effort: failures are logged
 * but never thrown — heartbeat is a presence signal only, not load-bearing
 * for any other feature, so a transient Firestore hiccup must not crash
 * the host hook.
 */
export async function updateHeartbeat(userId: string): Promise<void> {
  try {
    await updateDocument(COLLECTION, userId, {
      lastHeartbeatAt: toTimestamp(new Date()),
    });
  } catch (err) {
    console.warn("[presence] updateHeartbeat failed:", err);
  }
}

/**
 * Subscribe to a user's presence. The callback receives the latest
 * `lastHeartbeatAt`, or `null` if the user document is missing or has no
 * heartbeat field yet. Consumers should pipe the value through
 * `getPresenceStatus()` to derive online/idle/offline.
 */
export function subscribeToUserPresence(
  userId: string,
  callback: (lastHeartbeatAt: Date | null) => void,
): Unsubscribe {
  return subscribeToDocument<Record<string, unknown>>(
    COLLECTION,
    userId,
    (raw) => {
      if (!raw) {
        callback(null);
        return;
      }
      const u = convertTimestamps<User>(raw, USER_DATE_FIELDS);
      callback(u.lastHeartbeatAt ?? null);
    },
  );
}
