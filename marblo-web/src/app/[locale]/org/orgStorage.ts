/**
 * "마지막 본 조직" 저장 — localStorage 는 신뢰 경계 밖이다.
 *
 * ★여기 적힌 값은 **후보**일 뿐이다. 착지는 항상 서버가 준 멤버십 목록과의
 *   교집합으로 판정한다(`resolveOrgLanding`). 사용자가 임의 값을 넣어도
 *   무시될 뿐 아무 일도 일어나지 않는다(§5.8).
 * ★접근이 막힌 환경(사파리 프라이빗 등)에서 읽기/쓰기가 던질 수 있으므로
 *   전부 try/catch 로 감싸고, 실패는 "값 없음" 으로 접는다.
 */

import { ORG_LAST_SEEN_STORAGE_KEY } from "./orgContract";

export function readLastSeenOrgId(): string | null {
  try {
    const v = window.localStorage.getItem(ORG_LAST_SEEN_STORAGE_KEY);
    return typeof v === "string" && v !== "" ? v : null;
  } catch {
    return null;
  }
}

/** ★개인 조직은 `"me"` 센티널로 적는다 — uid 가 실린 orgId 를 저장하지 않는다. */
export function writeLastSeenOrgId(value: string): void {
  try {
    window.localStorage.setItem(ORG_LAST_SEEN_STORAGE_KEY, value);
  } catch {
    // 저장 실패는 조용히 넘어간다 — 다음 로그인이 규칙 2~4 로 착지할 뿐이다.
  }
}

export function clearLastSeenOrgId(): void {
  try {
    window.localStorage.removeItem(ORG_LAST_SEEN_STORAGE_KEY);
  } catch {
    // 위와 같다.
  }
}
