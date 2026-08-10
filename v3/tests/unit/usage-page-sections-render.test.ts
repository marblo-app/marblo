/**
 * @vitest-environment jsdom
 *
 * 사용량 탭 **섹션 전수 렌더** 계약 (티켓 kEMh5HGDGggponXrsgby).
 *
 * ── 이 테스트가 잡는 사고 ────────────────────────────────────────────────
 * 사장님 리포트: "Usage 탭에서 사용량 섹션이 VendorBreakdown 말고는 안 보인다."
 * 원인은 두 갈래였고 둘 다 여기서 못박는다.
 *
 *   1. **빈 데이터에 섹션이 통째로 사라진다.** `VendorCreditsPanel` 은 카탈로그가
 *      비면 `return null`, `RateLimitPanel` 은 행이 없으면 `return null` 이었다.
 *      화면에서 조용히 없어지는 섹션은 "데이터가 없다" 가 아니라 "앱이 고장났다"
 *      로 읽힌다 — 빈 섹션도 제목과 EmptyState 를 남겨야 한다.
 *   2. **페이지가 자기 스크롤을 갖지 않는다.** 워크스페이스 셸의 pane 은
 *      `absolute inset-0` + 부모 `overflow-hidden` 이라(PaneGroup) 자식이 스크롤을
 *      들고 있지 않으면 화면 높이를 넘는 부분이 **잘려서 도달 불가**가 된다.
 *      레거시 Layout/WorkTabs 는 감싸는 쪽이 `overflow-auto` 라 안 드러났다.
 *
 * 데이터 소스 계약도 함께 적어 둔다: 이 화면의 집계는 `getCostSummary`
 * (BigQuery `cost_logs`, `userId = auth.uid`) 하나뿐이고 `events` 축과 무관하다
 * (#907 이 events 에서 계정 UID 를 뗐어도 이 화면은 안 깨진다).
 *
 * (테스트는 이 repo 관례대로 .ts + createElement — vitest include 가
 * `tests/**\/*.test.ts` 라 .tsx 는 수집되지 않는다.)
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

// ── 화면 밖 의존(파이어베이스·IPC)은 훅 경계에서 끊는다 ──────────────────
// 여기서 검증하려는 건 "어떤 섹션이 그려지는가" 지 데이터 로딩 경로가 아니다.
const stores = vi.hoisted(() => ({
  agents: [] as unknown[],
  ownedAgents: [] as unknown[],
  trend: [] as unknown[],
  catalogGroups: [] as unknown[],
}));

// 파이어베이스 SDK 초기화는 렌더러 부팅 경로다 — 테스트에서는 심는 것 자체가
// 불가능(설정/네트워크)이라 모듈 경계에서 끊는다.
vi.mock("../../src/lib/firebase", () => ({
  FIREBASE_FUNCTIONS_REGION: "us-central1",
  isPackagedLoopbackAuth: false,
  app: {},
  auth: {},
  db: {},
  functions: {},
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({ user: { uid: "uid-1" } }),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: (sel: (s: unknown) => unknown) =>
    sel({ currentProject: { id: "p1", name: "P1" } }),
}));

vi.mock("../../src/stores/agentStore", () => ({
  useAgentStore: (sel: (s: unknown) => unknown) =>
    sel({
      agents: stores.agents,
      ownedAgents: stores.ownedAgents,
      loading: false,
      subscribeToAgents: () => () => {},
      subscribeToOwnedAgents: () => () => {},
    }),
}));

vi.mock("../../src/stores/costStore", () => ({
  useCostStore: () => ({
    summary: null,
    logs: [],
    loadCosts: vi.fn(),
    loadSummary: vi.fn(),
    trend: stores.trend,
    weekly: null,
    loading: false,
    summaryLoading: false,
  }),
}));

vi.mock("../../src/stores/quickLaneModelStore", () => ({
  useQuickLaneModelStore: (sel: (s: unknown) => unknown) =>
    sel({ groups: stores.catalogGroups, load: () => {} }),
}));

vi.mock("../../src/stores/modelFactSheetStore", () => ({
  useModelFactSheetStore: (sel: (s: unknown) => unknown) =>
    sel({
      rows: [],
      variants: [],
      defaultBenchmark: null,
      status: "idle",
      load: () => {},
      reload: () => {},
    }),
}));

import { UsagePage } from "../../src/components/usage/UsagePage";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function installElectronApiMock() {
  const api = {
    harness: { list: vi.fn(async () => []) },
    usage: { accountRateLimits: vi.fn(async () => null) },
  };
  (window as unknown as { electronAPI: unknown }).electronAPI = api;
  return api;
}

/** 이 탭이 사장님께 약속한 섹션들 — 데이터가 비어도 사라지면 안 되는 목록. */
const SECTION_TITLES = [
  ko["usage.breakdown.title"],
  ko["usage.trend.titleEmpty"],
  // usage.agentModel.title(에이전트↔실모델 표)은 의도적으로 빠졌다 — "모델·
  // 에이전트" 섹션이 같은 사실을 하위모델 막대로 말해 중복이라 렌더를 뗐다.
  ko["usage.credits.title"],
  ko["usage.section.byModelAgent"],
  ko["usage.rateLimit.title"],
];

describe("UsagePage — 섹션 전수 렌더", () => {
  beforeEach(() => {
    stores.agents = [];
    stores.ownedAgents = [];
    stores.trend = [];
    stores.catalogGroups = [];
    // jsdom 의 navigator.language 는 en 이라 기본 로케일이 영어로 잡힌다.
    // 이 테스트는 문구가 아니라 **섹션 존재**를 보므로 한 벌로 고정한다.
    useLocaleStore.setState({ locale: "ko" });
    installElectronApiMock();
  });
  afterEach(cleanup);

  it("데이터가 하나도 없어도 모든 섹션이 제목과 함께 남는다", async () => {
    render(createElement(UsagePage));

    // 총계 카드 4장(Total Tokens · I/O · Cache · Cost)
    for (const key of [
      "usage.card.totalTokens",
      "usage.card.inputOutput",
      "usage.card.cache",
      "usage.card.cost",
    ] as const) {
      expect(screen.getByText(ko[key])).toBeTruthy();
    }

    // 나머지 섹션 — 빈 데이터에서도 제목이 남아야 "데이터 없음" 과 "고장" 이
    // 구분된다.
    for (const title of SECTION_TITLES) {
      expect(
        screen.queryByText(title),
        `빈 데이터에서 섹션이 사라졌다: ${title}`,
      ).toBeTruthy();
    }
  });

  it("페이지가 자기 스크롤을 들고 있다(워크스페이스 pane 에서 잘리지 않게)", () => {
    const { container } = render(createElement(UsagePage));
    const root = container.firstElementChild as HTMLElement;
    // PaneGroup 의 pane 은 absolute inset-0 + 부모 overflow-hidden 이라, 자식이
    // 스크롤 컨테이너가 아니면 화면 높이를 넘는 섹션이 도달 불가로 잘린다.
    expect(root.className).toContain("h-full");
    expect(root.className).toContain("overflow-y-auto");
  });
});
