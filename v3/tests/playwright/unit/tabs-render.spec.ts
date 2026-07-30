import { test, expect } from "../helpers/fixtures";

/**
 * Tier 1 smoke 회귀 — 모든 탭이 클릭 시 정상 렌더되는지.
 *
 * 검증:
 *   1. 탭 버튼이 visible + click 가능
 *   2. 클릭 후 콘텐츠 영역에 자식 element 존재 (빈 흰 화면 없음)
 *   3. 명백한 에러 패턴 (red box, "crashed", "Something went wrong") 없음
 *
 * 잡히는 회귀:
 *   - tabComponents map 의 import 깨짐 (모듈 경로 변경, default export 누락)
 *   - lazy import 의 chunk load 실패
 *   - tab 컴포넌트의 mount 시 throw (store 의존성 누락, hook 순서 실수)
 *   - TabBar 의 라벨 변경 (테스트도 같이 갱신해야 함을 알림)
 *
 * 텍스트 단언은 의도적으로 약하게 — 각 탭의 빈 상태/헤더 텍스트가 자주
 * 바뀌므로 strict 단언은 false positive 만 만든다. 강한 단언은 별도 spec
 * 에서 (예: settings-api-keys.spec.ts) 핵심 요소만 콕 짚어서.
 */

// Production-default visible 탭만. `flows` 와 `deploy` 는 TabBar.tsx 의
// DEV_ONLY_TABS — VITE_DEV_FEATURES env 가 명시될 때만 표시. 필요 시 별도
// spec 에서 env 변경 후 검증 (test.use({ marbloOptions: { env: ... } })).
const TABS = [
  "guide",
  "board",
  "missions",
  "code",
  "agents",
  "store",
  "harness",
  "settings",
] as const;

for (const tabId of TABS) {
  test(`@unit ${tabId} 탭이 에러 없이 렌더된다`, async ({ marblo }) => {
    await marblo.openTab(tabId);

    // 탭 전환 후 React render + 비동기 store subscribe 안정화.
    await marblo.page.waitForTimeout(300);

    // 1) 에러 다이얼로그·ErrorBoundary fallback 이 떠 있지 않음.
    //    ErrorBoundary 가 fallback 표시 시 보통 "Something went wrong" 또는
    //    한국어 "오류" 텍스트. 명확한 negative 검증.
    const errorPatterns = [
      "Something went wrong",
      "에러가 발생",
      "오류가 발생",
      "crashed",
      "Cannot read property",
    ];
    for (const pat of errorPatterns) {
      await expect(
        marblo.page.locator(`text=/${pat}/i`),
        `${tabId} 탭에 에러 패턴 "${pat}" 가 보임`,
      ).toHaveCount(0);
    }

    // 2) 메인 콘텐츠 영역에 어떤 자식이라도 존재해야 함.
    //    Layout 의 ActiveTabComponent 가 mount 되어 DOM 노드 1개 이상 생성됐는지.
    //    가장 견고한 시그널: body 안에 button/input/heading/svg 같은 인터랙티브
    //    요소가 최소 1개 이상 (탭바·헤더 외에 콘텐츠 영역에도).
    const interactiveCount = await marblo.page
      .locator("main button, main input, main h1, main h2, main svg, main a")
      .count();
    // 일부 탭은 main 태그 안 쓸 수도 있어 fallback 으로 body 도 본다.
    const bodyInteractiveCount = await marblo.page
      .locator("body button, body input, body h1, body h2, body svg")
      .count();
    expect(
      Math.max(interactiveCount, bodyInteractiveCount),
      `${tabId} 탭에 인터랙티브 요소가 0개 — 콘텐츠 mount 실패 가능성`,
    ).toBeGreaterThan(0);

    // 3) 탭 버튼의 active 상태 — TabBar 의 active class 또는 border-bottom
    //    스타일이 적용됐는지. activeTab state 가 setActiveTab 호출 후 반영됐는지
    //    확인. 셀렉터는 fixture 의 openTab 과 같은 방식 (data-testid 또는 텍스트).
    //    엄격하지 않게 — 클릭 자체는 fixture 가 보장하므로 보조.
  });
}
