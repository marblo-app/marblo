/**
 * 미션 리플레이 대시보드 파킹 플래그.
 *
 * 결정(2026-08-08): 미션 리플레이 대시보드 + PPT 식 GIF 는 daily UX 로 쓰이지
 * 않는다. 그래서 History 탭은 **기존 단순 완료내역**으로 되돌리고, 미션 선택·
 * GIF·집계 쇼케이스 같은 리플레이 표면은 이 플래그 뒤로 숨긴다.
 *
 * ★코드는 삭제하지 않는다. `lib/replay/*`(redactReplay·missionOutline·
 * gifStoryboard), `components/work-history/replay/*`(MissionGifPanel·
 * ReplayShareFlow …)는 그대로 남아 있고 **진입점만** 끊긴 상태다 — 보드-SVG
 * 애니메이션 마케팅 기능으로 재사용할 백로그가 걸려 있기 때문이다.
 *
 * 폴라리티: `marblo.workspaceMode.enabled` 와 반대로 **명시적 "1" 만 ON**이다.
 * 키가 없거나 값이 이상하거나 스토리지 읽기가 실패하면 OFF — 파킹된 실험이
 * 사고로 다시 켜지는 쪽보다, 켜려던 사람이 한 번 더 켜는 쪽이 안전하다.
 *
 * 켜는 법(개발/테스트/데모):
 *   localStorage.setItem("marblo.replayDashboard.enabled", "1") → 앱 재시작
 * 값은 렌더 시점에 읽히고 컴포넌트는 마운트 때 한 번 고정하므로, 켜고 끄려면
 * 탭 재마운트(사실상 앱 재시작)가 필요하다.
 */
export const REPLAY_DASHBOARD_FLAG_KEY = "marblo.replayDashboard.enabled";

/** 플래그를 읽을 스토리지. 테스트가 실제 localStorage 없이 주입할 수 있게 최소 형태만 요구한다. */
export interface ReplayDashboardFlagStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function safeStorage(): ReplayDashboardFlagStorage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.localStorage;
  } catch {
    // private mode / storage 비활성 — 읽을 수 없으면 OFF(기본값)로 간다.
    return null;
  }
}

export function isReplayDashboardEnabled(
  storage: ReplayDashboardFlagStorage | null = safeStorage(),
): boolean {
  if (!storage) return false;
  try {
    return storage.getItem(REPLAY_DASHBOARD_FLAG_KEY) === "1";
  } catch {
    return false;
  }
}

export function setReplayDashboardEnabled(
  enabled: boolean,
  storage: ReplayDashboardFlagStorage | null = safeStorage(),
): void {
  if (!storage) return;
  try {
    storage.setItem(REPLAY_DASHBOARD_FLAG_KEY, enabled ? "1" : "0");
  } catch {
    // 저장 실패는 무시 — 다음 로드에서 기본값(OFF)으로 돌아간다.
  }
}
