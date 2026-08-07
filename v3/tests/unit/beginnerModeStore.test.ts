import { beforeEach, describe, expect, it } from "vitest";
import { useBeginnerModeStore } from "../../src/stores/beginnerModeStore";

/**
 * 스토어의 계약만 본다(진입 판정 표 자체는 beginnerMode.test.ts 가 덮는다):
 *  - 승격/되돌리기가 상태를 뒤집는가
 *  - ★첫완료·승격모달 기록이 **멱등**인가 — 여기가 깨지면 계측이 매 렌더마다
 *    중복 발화하고, 승격 모달이 다시 뜬다
 *  - enteredAt(첫완료 TTFV 의 분모)이 되돌리기로 리셋되지 않는가
 *
 * 노드 테스트 환경엔 localStorage 가 없어 영속은 조용히 no-op 된다 — 인메모리
 * 값으로 동작해야 한다는 것 자체가 프라이빗 모드 계약이다.
 */
describe("beginnerModeStore", () => {
  beforeEach(() => {
    // 모듈 평가 시 한 번 판정된 초기 레코드를 테스트마다 알려진 상태로 되돌린다.
    useBeginnerModeStore.setState({
      state: "beginner",
      enteredAt: 1_000,
      firstCompletionAt: 0,
      promotionShownAt: 0,
      enteredReported: false,
      entryReason: "fresh_install",
    });
  });

  it("promote 는 어드밴스드로 넘기고, 승격 시점을 '모달 본 것'으로 기록한다", () => {
    useBeginnerModeStore.getState().promote("completed");
    const s = useBeginnerModeStore.getState();
    expect(s.state).toBe("advanced");
    // 되돌아왔을 때 다시 조르지 않도록 — 모달을 안 거치고 승격해도 기록된다.
    expect(s.promotionShownAt).toBeGreaterThan(0);
  });

  it("revertToBeginner 는 비기너로 돌리되 enteredAt 을 리셋하지 않는다", () => {
    useBeginnerModeStore.getState().promote("manual");
    useBeginnerModeStore.getState().revertToBeginner();
    const s = useBeginnerModeStore.getState();
    expect(s.state).toBe("beginner");
    // enteredAt 은 "이 설치가 처음 비기너가 된 때" = 첫완료 TTFV 의 분모다.
    // 되돌릴 때마다 새로 찍으면 지표가 늘어난다.
    expect(s.enteredAt).toBe(1_000);
  });

  it("revert 는 진입 계측을 다시 쏠 수 있게 하고, 사유를 settings 로 바꾼다", () => {
    useBeginnerModeStore.getState().markEnteredReported();
    expect(useBeginnerModeStore.getState().enteredReported).toBe(true);
    useBeginnerModeStore.getState().revertToBeginner();
    const s = useBeginnerModeStore.getState();
    expect(s.enteredReported).toBe(false);
    // ★enteredAt 이 이미 서 있다는 이유로 fresh_install 로 계상하면(옛 판정식)
    // 설정 경유 복귀가 신규 설치로 잡혀 퍼널 분모가 망가진다.
    expect(s.entryReason).toBe("settings");
  });

  it("★markFirstCompletion 은 멱등 — 두 번째 호출은 null (계측 중복 방지)", () => {
    const first = useBeginnerModeStore.getState().markFirstCompletion();
    expect(first).not.toBeNull();
    expect(first).toBeGreaterThanOrEqual(0);
    expect(useBeginnerModeStore.getState().firstCompletionAt).toBeGreaterThan(
      0,
    );

    expect(useBeginnerModeStore.getState().markFirstCompletion()).toBeNull();
  });

  it("enteredAt 이 없으면 첫완료 경과는 0 으로 보고한다 (음수/NaN 금지)", () => {
    useBeginnerModeStore.setState({ enteredAt: 0 });
    expect(useBeginnerModeStore.getState().markFirstCompletion()).toBe(0);
  });

  it("★markPromotionShown 은 멱등 — 첫 기록 시각이 덮이지 않는다", () => {
    useBeginnerModeStore.getState().markPromotionShown();
    const at = useBeginnerModeStore.getState().promotionShownAt;
    expect(at).toBeGreaterThan(0);
    useBeginnerModeStore.getState().markPromotionShown();
    expect(useBeginnerModeStore.getState().promotionShownAt).toBe(at);
  });

  it("promote 는 이미 있는 promotionShownAt 을 덮지 않는다", () => {
    useBeginnerModeStore.setState({ promotionShownAt: 777 });
    useBeginnerModeStore.getState().promote("days");
    expect(useBeginnerModeStore.getState().promotionShownAt).toBe(777);
  });
});
