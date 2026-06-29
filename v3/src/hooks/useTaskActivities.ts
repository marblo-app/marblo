import { useEffect, useState } from "react";
import type { Activity } from "../types/activity";
import { subscribeToActivities } from "../services/activityService";

/**
 * 주어진 taskId 들의 activities 를 각각 구독해 taskId → Activity[] 맵으로 모은다.
 *
 * 완료 보고는 task 의 activities 에 평문으로 적재되므로(별도 채널 없음), "작업내역"
 * 탭은 완료 태스크별 activities 를 읽어 완료 보고를 찾아낸다. Firestore 리스너가
 * task 당 하나씩 생기므로 호출부에서 taskIds 를 합리적 수(최근 N개)로 제한해 둘 것.
 *
 * 새 IPC/백엔드 없음 — 기존 activityService.subscribeToActivities 재사용.
 */
export function useTaskActivities(
  taskIds: string[],
): Record<string, Activity[]> {
  const [map, setMap] = useState<Record<string, Activity[]>>({});
  // taskId 는 Firestore auto-id(콤마 없음)라 join 으로 안정적 effect 키를 만든다.
  const key = taskIds.slice().sort().join(",");

  useEffect(() => {
    const ids = key ? key.split(",") : [];
    if (ids.length === 0) {
      setMap({});
      return;
    }
    // 더 이상 추적하지 않는 task 의 잔재를 떨군다(구독 목록이 바뀌었을 때).
    setMap((prev) => {
      const next: Record<string, Activity[]> = {};
      for (const id of ids) if (prev[id]) next[id] = prev[id];
      return next;
    });

    const unsubs = ids.map((id) =>
      subscribeToActivities(id, (activities) => {
        setMap((prev) => ({ ...prev, [id]: activities }));
      }),
    );
    return () => unsubs.forEach((unsub) => unsub());
  }, [key]);

  return map;
}
