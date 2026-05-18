import { useEffect, useState } from "react";
import { subscribeToUserPresence } from "../services/presenceService";

/**
 * Subscribe to another user's presence. Returns the latest
 * `lastHeartbeatAt` (or `null` if unknown / never received a heartbeat).
 * Run the value through `getPresenceStatus()` in `types/user.ts` to derive
 * online/idle/offline.
 *
 * Each consumer opens its own Firestore listener. With small teams and
 * typical kanban sizes this is fine; if it ever becomes hot, swap in a
 * ref-counted global presence store.
 */
export function usePresence(userId: string | null | undefined): Date | null {
  const [heartbeat, setHeartbeat] = useState<Date | null>(null);

  useEffect(() => {
    if (!userId) {
      setHeartbeat(null);
      return;
    }
    const unsub = subscribeToUserPresence(userId, setHeartbeat);
    return unsub;
  }, [userId]);

  return heartbeat;
}
