/**
 * 리플레이 대시보드 파킹 플래그 계약.
 *
 * 핀하는 것은 **기본값이 OFF** 라는 사실 하나다. History 탭이 단순 완료내역으로
 * 돌아간 근거가 전부 이 함수의 반환값이라, 여기서 기본값이 뒤집히면 미션 GIF·
 * 집계 쇼케이스·감사로그 Replay CTA 가 한꺼번에 되살아난다(= 사장님 결정 역행).
 * 그래서 "키 없음/이상한 값/스토리지 고장" 을 전부 OFF 로 못 박는다.
 */
import { describe, expect, it } from "vitest";
import {
  REPLAY_DASHBOARD_FLAG_KEY,
  isReplayDashboardEnabled,
  setReplayDashboardEnabled,
  type ReplayDashboardFlagStorage,
} from "../../src/lib/replayDashboardFlag";

function memoryStorage(
  seed: Record<string, string> = {},
): ReplayDashboardFlagStorage & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (key) => (key in data ? data[key] : null),
    setItem: (key, value) => {
      data[key] = value;
    },
  };
}

describe("replayDashboardFlag", () => {
  it("키가 없으면 OFF — 파킹된 대시보드는 아무 것도 안 해도 안 켜진다", () => {
    expect(isReplayDashboardEnabled(memoryStorage())).toBe(false);
  });

  it('명시적 "1" 만 ON 이다', () => {
    expect(
      isReplayDashboardEnabled(
        memoryStorage({ [REPLAY_DASHBOARD_FLAG_KEY]: "1" }),
      ),
    ).toBe(true);
  });

  it.each(["0", "true", "yes", "", "  1"])(
    '"%s" 같은 값은 ON 이 아니다(느슨한 truthy 해석 금지)',
    (raw) => {
      expect(
        isReplayDashboardEnabled(
          memoryStorage({ [REPLAY_DASHBOARD_FLAG_KEY]: raw }),
        ),
      ).toBe(false);
    },
  );

  it("스토리지가 없거나 던지면 OFF 로 떨어진다(fail-closed)", () => {
    expect(isReplayDashboardEnabled(null)).toBe(false);
    const broken: ReplayDashboardFlagStorage = {
      getItem: () => {
        throw new Error("storage disabled");
      },
      setItem: () => {
        throw new Error("storage disabled");
      },
    };
    expect(isReplayDashboardEnabled(broken)).toBe(false);
    // 저장 실패도 조용히 흡수한다 — 플래그 하나가 화면을 죽이면 안 된다.
    expect(() => setReplayDashboardEnabled(true, broken)).not.toThrow();
  });

  it("setter 로 켜면 다음 읽기가 ON 이다(파킹 해제 경로가 살아 있음)", () => {
    const storage = memoryStorage();
    setReplayDashboardEnabled(true, storage);
    expect(storage.data[REPLAY_DASHBOARD_FLAG_KEY]).toBe("1");
    expect(isReplayDashboardEnabled(storage)).toBe(true);

    setReplayDashboardEnabled(false, storage);
    expect(isReplayDashboardEnabled(storage)).toBe(false);
  });
});
