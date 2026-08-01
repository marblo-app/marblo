/**
 * presence 판정 회귀 — 프로젝트 탭이 통째로 "Something went wrong" 으로 죽던
 * 실장애의 재현 테스트.
 *
 * 원인은 두 겹이었다:
 *   1) teamService.USER_DATE_FIELDS 가 lastHeartbeatAt 을 빠뜨려 raw Firestore
 *      Timestamp 가 `Date` 로 선언된 자리에 그대로 들어왔다.
 *   2) getPresenceStatus 가 그 값을 Date 로 믿고 .getTime() 을 불러 렌더 도중
 *      throw → ErrorBoundary 가 화면 전체를 삼켰다.
 *
 * 여기서는 (2)를 고정한다. (1)은 teamService 쪽 목록 자체를 검사한다.
 */
import { describe, it, expect } from "vitest";
import {
  getPresenceStatus,
  PRESENCE_ONLINE_WINDOW_MS,
  PRESENCE_IDLE_WINDOW_MS,
} from "../../src/types/user";

const NOW = 1_700_000_000_000;

/** Firestore Timestamp 의 형태만 흉내 낸다(SDK 를 끌어오지 않는다). */
function timestampLike(ms: number) {
  return {
    seconds: Math.floor(ms / 1000),
    nanoseconds: 0,
    toDate: () => new Date(ms),
  };
}

describe("getPresenceStatus — Date 입력(기존 계약)", () => {
  it("최근 heartbeat 는 online", () => {
    expect(getPresenceStatus(new Date(NOW - 1000), NOW)).toBe("online");
  });

  it("online 창을 넘기면 idle", () => {
    const at = new Date(NOW - PRESENCE_ONLINE_WINDOW_MS - 1000);
    expect(getPresenceStatus(at, NOW)).toBe("idle");
  });

  it("idle 창을 넘기면 offline", () => {
    const at = new Date(NOW - PRESENCE_IDLE_WINDOW_MS - 1000);
    expect(getPresenceStatus(at, NOW)).toBe("offline");
  });

  it("null/undefined 는 offline", () => {
    expect(getPresenceStatus(null, NOW)).toBe("offline");
    expect(getPresenceStatus(undefined, NOW)).toBe("offline");
  });
});

describe("getPresenceStatus — 변환 안 된 값이 와도 throw 하지 않는다", () => {
  it("★Firestore Timestamp 를 받아도 터지지 않고 Date 와 같은 판정을 낸다", () => {
    const ms = NOW - 1000;
    // 고치기 전에는 여기서 `.getTime is not a function` 으로 throw 했다.
    expect(() =>
      getPresenceStatus(timestampLike(ms) as unknown as Date, NOW)
    ).not.toThrow();
    expect(getPresenceStatus(timestampLike(ms) as unknown as Date, NOW)).toBe(
      getPresenceStatus(new Date(ms), NOW)
    );
  });

  it("toDate 없이 seconds 만 있는 Timestamp 도 처리한다", () => {
    const value = { seconds: Math.floor((NOW - 1000) / 1000), nanoseconds: 0 };
    expect(getPresenceStatus(value as unknown as Date, NOW)).toBe("online");
  });

  it("ISO 문자열 / epoch 숫자도 처리한다", () => {
    expect(
      getPresenceStatus(
        new Date(NOW - 1000).toISOString() as unknown as Date,
        NOW
      )
    ).toBe("online");
    expect(getPresenceStatus((NOW - 1000) as unknown as Date, NOW)).toBe(
      "online"
    );
  });

  it("판정 불가한 값은 offline 으로 접는다(throw 금지)", () => {
    for (const bad of [{}, [], "not-a-date", NaN, { toDate: () => "nope" }]) {
      expect(() =>
        getPresenceStatus(bad as unknown as Date, NOW)
      ).not.toThrow();
      expect(getPresenceStatus(bad as unknown as Date, NOW)).toBe("offline");
    }
  });
});
