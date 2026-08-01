import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { usePresenceSync } from "../../hooks/usePresenceSync";
import type { UserPresence } from "../../types/collaboration";
import { subscribeToPresence } from "../../services/collaborationService";

interface PresenceIndicatorProps {
  projectId: string;
}

export function PresenceIndicator({ projectId }: PresenceIndicatorProps) {
  const { user } = useAuth();
  const [presenceList, setPresenceList] = useState<UserPresence[]>([]);
  const [hoveredUserId, setHoveredUserId] = useState<string | null>(null);

  // 내 presence 문서 주기 갱신 — 이 컴포넌트가 presence 의 유일한 마운트
  // 지점(Header)이므로 읽기(구독)와 쓰기(하트비트)를 같이 배선한다.
  usePresenceSync(projectId);

  useEffect(() => {
    if (!projectId) return;

    const unsubscribe = subscribeToPresence(projectId, (presence) => {
      // 자기 자신 제외
      setPresenceList(presence.filter((p) => p.userId !== user?.uid));
    });

    return unsubscribe;
  }, [projectId, user?.uid]);

  if (presenceList.length === 0) return null;

  const MAX_VISIBLE = 4;
  const visible = presenceList.slice(0, MAX_VISIBLE);
  const overflow = presenceList.length - MAX_VISIBLE;

  return (
    <div className="flex items-center gap-1">
      {visible.map((p) => (
        <div
          key={p.userId}
          className="relative"
          onMouseEnter={() => setHoveredUserId(p.userId)}
          onMouseLeave={() => setHoveredUserId(null)}
        >
          {/* 아바타 */}
          {p.photoURL ? (
            <img
              src={p.photoURL}
              alt={p.displayName}
              className="h-6 w-6 rounded-full border-2 border-green-500"
            />
          ) : (
            <div className="flex h-6 w-6 items-center justify-center rounded-full border-2 border-green-500 bg-gray-600 text-xs font-medium text-white">
              {p.displayName?.[0] || "?"}
            </div>
          )}

          {/* 온라인 인디케이터 */}
          <span className="absolute -bottom-0.5 -right-0.5 h-2 w-2 rounded-full bg-green-400 ring-1 ring-gray-900" />

          {/* 툴팁 */}
          {hoveredUserId === p.userId && (
            <div className="absolute left-1/2 top-full z-50 mt-2 -translate-x-1/2 whitespace-nowrap rounded bg-gray-700 px-2 py-1 text-xs text-gray-200 shadow-lg">
              <p className="font-medium">{p.displayName}</p>
              <p className="text-gray-400">{p.location}</p>
            </div>
          )}
        </div>
      ))}

      {overflow > 0 && (
        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-700 text-xs text-gray-300">
          +{overflow}
        </div>
      )}
    </div>
  );
}
