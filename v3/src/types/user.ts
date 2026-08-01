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

/**
 * `users` 문서에서 Firestore Timestamp → Date 로 바꿔야 하는 필드 — **단일
 * 소스**.
 *
 * ★왜 타입 파일에 있나: 같은 컬렉션을 teamService 와 presenceService 가 각자
 * 읽는데, 예전엔 목록을 각자 들고 있었고 teamService 쪽에 lastHeartbeatAt 이
 * 빠져 있었다. 그 경로로 온 User 만 raw Timestamp 를 품은 채 `Date` 로 타이핑돼
 * tsc 를 통과했고, 그 값을 Date 로 믿은 getPresenceStatus 가 렌더 도중 터져
 * 프로젝트 탭 전체가 ErrorBoundary 로 날아갔다. 목록을 여기 하나로 모아 두면
 * 세 번째 소비자가 생겨도 같은 방식으로 갈라질 수 없다. (firebase 를 import
 * 하지 않는 순수 모듈이라 서비스 양쪽에서 안전하게 참조된다.)
 */
export const USER_DATE_FIELDS = ["createdAt", "lastHeartbeatAt"];

export type PresenceStatus = "online" | "idle" | "offline";

/** Time-based thresholds for presence classification (in milliseconds). */
export const PRESENCE_ONLINE_WINDOW_MS = 60_000; // <= 60s = online
export const PRESENCE_IDLE_WINDOW_MS = 300_000; // 60-300s = idle, >300s = offline

/**
 * heartbeat 값을 밀리초로 정규화한다. 판정 불가면 null.
 *
 * ★왜 타입이 `Date` 인데 방어하나: 이 값은 서로 다른 서비스(presenceService,
 * teamService)가 각자 변환해서 넣는데, 한 곳이라도 날짜 변환 목록에서
 * 빠뜨리면 raw Firestore Timestamp 가 `Date` 로 선언된 자리에 그대로 들어온다
 * — tsc 는 못 잡고, 렌더 도중 `.getTime is not a function` 으로 터져 화면
 * 전체가 ErrorBoundary 로 날아간다(프로젝트 탭 실장애). 변환 누락은 고쳤지만,
 * presence 는 부가 정보라서 값이 이상하다고 화면을 죽일 이유가 전혀 없다.
 * Timestamp(toDate/seconds)·ISO 문자열·epoch 숫자를 모두 받아 준다.
 */
function heartbeatMs(value: unknown): number | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.getTime();
  }
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value);
    return Number.isNaN(parsed) ? null : parsed;
  }
  if (typeof value === "object" && value !== null) {
    // Firestore Timestamp — 인스턴스 검사 대신 형태로 본다. firebase/firestore
    // 를 import 하면 이 순수 타입 모듈이 SDK 에 묶인다.
    const ts = value as { toDate?: unknown; seconds?: unknown };
    if (typeof ts.toDate === "function") {
      const date = (ts as { toDate: () => unknown }).toDate();
      return date instanceof Date && !Number.isNaN(date.getTime())
        ? date.getTime()
        : null;
    }
    if (typeof ts.seconds === "number") return ts.seconds * 1000;
  }
  return null;
}

export function getPresenceStatus(
  lastHeartbeatAt: Date | null | undefined,
  nowMs: number = Date.now(),
): PresenceStatus {
  if (!lastHeartbeatAt) return "offline";
  const heartbeat = heartbeatMs(lastHeartbeatAt);
  if (heartbeat === null) return "offline";
  const age = nowMs - heartbeat;
  if (age <= PRESENCE_ONLINE_WINDOW_MS) return "online";
  if (age <= PRESENCE_IDLE_WINDOW_MS) return "idle";
  return "offline";
}
