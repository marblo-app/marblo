/**
 * "첫 완료 미션 → Replay/공유" 널지 — 1회성 노출 여부를 localStorage 에 남긴다.
 *
 * `chatReadWatermark.ts` 와 같은 이유로 같은 모양을 쓴다: 이 널지는 한 번 보이면
 * (또는 닫으면) 다시 뜨면 안 되고, 그 "봤다" 는 앱 재시작(Electron 콜드스타트)에도
 * 살아남아야 한다 — 세션 상태(React state)만으로는 재시작마다 다시 뜬다(채팅
 * 토스트가 먼저 겪은 교훈).
 */

const STORAGE_PREFIX = "marblo:work-history:first-mission-nudge";

export type FirstMissionShareNudgeStorage = Pick<
  Storage,
  "getItem" | "setItem"
>;

function storageKey(projectId: string): string {
  return `${STORAGE_PREFIX}:${projectId}`;
}

/** 이 프로젝트에서 널지를 이미 보여줬거나 닫았는가. */
export function hasSeenFirstMissionShareNudge(
  storage: FirstMissionShareNudgeStorage | null,
  projectId: string | null,
): boolean {
  if (!storage || !projectId) return false;
  return storage.getItem(storageKey(projectId)) !== null;
}

/** 널지를 봤다고 기록한다 — 멱등(여러 번 불러도 안전). */
export function markFirstMissionShareNudgeSeen(
  storage: FirstMissionShareNudgeStorage | null,
  projectId: string | null,
): void {
  if (!storage || !projectId) return;
  storage.setItem(storageKey(projectId), "1");
}
