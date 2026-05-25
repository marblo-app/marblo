import { useEffect } from "react";
import { useAuth } from "./useAuth";
import { updateHeartbeat } from "../services/presenceService";

const HEARTBEAT_INTERVAL_MS = 30_000;

/**
 * Refresh the current user's presence heartbeat every 30 seconds while the
 * marblo app is open. Mount once near the app root (e.g. in Layout).
 *
 * Consumers compute online/idle/offline from the age of `lastHeartbeatAt`
 * via `getPresenceStatus()` in `types/user.ts`. The 30s cadence is half of
 * the 60s online window, so a single missed write still leaves the user
 * classified as online.
 */
export function usePresenceHeartbeat(): void {
  const { user } = useAuth();

  useEffect(() => {
    if (!user?.uid) return;

    // Fire immediately so the first heartbeat lands before the 30s tick.
    updateHeartbeat(user.uid);

    const id = setInterval(() => {
      updateHeartbeat(user.uid);
    }, HEARTBEAT_INTERVAL_MS);

    return () => clearInterval(id);
  }, [user?.uid]);
}
