import { useEffect } from "react";
import { useAuth } from "./useAuth";
import { updatePresence } from "../services/collaborationService";

// subscribeToPresence 의 STALE_MS(5분)보다 충분히 짧게 — 한 번 놓쳐도
// 온라인으로 남는다. users/{uid}.lastHeartbeatAt(usePresenceHeartbeat)과 달리
// 이 문서는 프로젝트 스코프(presence/{projectId}/users/{uid})라 "이 프로젝트에
// 지금 누가 접속 중인지"를 팀원에게 보여준다.
const PRESENCE_INTERVAL_MS = 60_000;

/**
 * 현재 사용자의 presence 문서를 주기적으로 갱신한다. 실패는 경고만 —
 * presence 는 표시용 신호라 Firestore 일시 오류(또는 구 룰 미배포 상태의
 * permission-denied)가 앱을 깨뜨리면 안 된다.
 */
export function usePresenceSync(projectId: string | null | undefined): void {
  const { user } = useAuth();
  const uid = user?.uid;
  const displayName = user?.displayName || user?.email || "";
  const photoURL = user?.photoURL ?? "";

  useEffect(() => {
    if (!projectId || !uid) return;

    const write = () => {
      updatePresence(projectId, uid, "app", displayName, photoURL).catch(
        (err) => console.warn("[presence] updatePresence failed:", err),
      );
    };

    write();
    const id = setInterval(write, PRESENCE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [projectId, uid, displayName, photoURL]);
}
