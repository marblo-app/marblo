import { beforeEach, describe, expect, it } from "vitest";
import {
  isAdminPermissionDenied,
  useAdminAccessStore,
} from "../../src/stores/adminAccessStore";

/**
 * 어드민 분석 탭의 노출 규칙(티켓 8lYqKIYj). 여기서 지키려는 불변식은 두 개고,
 * 둘 다 한쪽으로 틀리면 조용히 아픈 종류다:
 *
 *   1. 판정 전(unknown)은 **보인다**. 미리 숨기면 진짜 어드민이 탭을 찾을 길이
 *      없는 닭-달걀이 된다.
 *   2. 확정적 permission-denied 만 숨김 사유다. 네트워크·내부 오류로 숨기면
 *      잠깐 끊긴 어드민에게서 탭이 사라지고, 그걸 되살릴 UI 가 없다.
 */
describe("adminAccessStore", () => {
  beforeEach(() => {
    useAdminAccessStore.setState({ statusByUid: {} });
  });

  it("관측 전에는 unknown 이다 (= 탭을 미리 숨기지 않는다)", () => {
    expect(useAdminAccessStore.getState().accessFor("uid-1")).toBe("unknown");
  });

  it("uid 가 없으면(로그아웃) unknown 으로 degrade 한다", () => {
    expect(useAdminAccessStore.getState().accessFor(null)).toBe("unknown");
    expect(useAdminAccessStore.getState().accessFor(undefined)).toBe("unknown");
  });

  it("성공/거절을 uid 별로 따로 기억한다", () => {
    useAdminAccessStore.getState().markGranted("admin-uid");
    useAdminAccessStore.getState().markDenied("other-uid");
    const s = useAdminAccessStore.getState();
    expect(s.accessFor("admin-uid")).toBe("granted");
    expect(s.accessFor("other-uid")).toBe("denied");
    // 관측하지 않은 세 번째 계정까지 물들면 안 된다.
    expect(s.accessFor("fresh-uid")).toBe("unknown");
  });

  it("같은 값을 다시 기록해도 상태 객체를 새로 만들지 않는다(리렌더 루프 방지)", () => {
    useAdminAccessStore.getState().markGranted("admin-uid");
    const first = useAdminAccessStore.getState().statusByUid;
    useAdminAccessStore.getState().markGranted("admin-uid");
    expect(useAdminAccessStore.getState().statusByUid).toBe(first);
  });

  describe("isAdminPermissionDenied", () => {
    it("permission-denied 만 확정 신호로 본다", () => {
      expect(isAdminPermissionDenied({ code: "permission-denied" })).toBe(true);
      expect(
        isAdminPermissionDenied({ code: "functions/permission-denied" }),
      ).toBe(true);
    });

    it("★서버 설정 문제·일시 오류는 비어드민 신호가 아니다", () => {
      // ADMIN_UID 미설정 → requireAdmin 이 failed-precondition 을 던진다.
      // 이건 사용자 자격과 무관하므로 탭을 숨기면 안 된다.
      expect(isAdminPermissionDenied({ code: "failed-precondition" })).toBe(
        false,
      );
      expect(isAdminPermissionDenied({ code: "unavailable" })).toBe(false);
      expect(isAdminPermissionDenied({ code: "internal" })).toBe(false);
      expect(isAdminPermissionDenied({ code: "deadline-exceeded" })).toBe(
        false,
      );
    });

    it("code 가 없는 오류(네트워크 예외 등)에도 안전하다", () => {
      expect(isAdminPermissionDenied(new Error("network error"))).toBe(false);
      expect(isAdminPermissionDenied(null)).toBe(false);
      expect(isAdminPermissionDenied(undefined)).toBe(false);
      expect(isAdminPermissionDenied("permission-denied")).toBe(false);
    });
  });
});
