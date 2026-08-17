// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 마블로 모드 첫 진입 투어의 **재노출 경계** — BeginnerTour 와 같은 계약.
 * 규칙 자체는 coachmark.test.ts, 그리기는 coachmarkOverlay.test.ts 가 덮는다.
 */

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    coachmarkStarted: vi.fn(),
    coachmarkCompleted: vi.fn(),
    coachmarkSkipped: vi.fn(),
  },
}));

const { MarbloModeTour } = await import(
  "../../src/components/workspace/MarbloModeTour"
);
const { useCoachmarkStore } = await import("../../src/stores/coachmarkStore");
const { ADVANCED_TOUR_ID, MAX_TOUR_OFFERS } = await import(
  "../../src/lib/coachmark"
);
const telemetry = (await import("../../src/services/telemetryService")).default;

const TAB_IDS = [
  "board",
  "code",
  "agents",
  "harness",
  "usage",
  "settings",
] as const;

function anchors() {
  for (const name of TAB_IDS) {
    const el = document.createElement("button");
    el.setAttribute("data-coach", `workspace-tab-${name}`);
    document.body.appendChild(el);
  }
}

async function flushFrames() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 0));
}

describe("Marblo mode tour", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useCoachmarkStore.setState({ tours: {} });
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("앵커가 준비되면 뜨고, 시작을 기록한다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: true }));
    await flushFrames();
    expect(screen.getByTestId("advanced-tour")).toBeTruthy();
    expect(
      useCoachmarkStore.getState().tours[ADVANCED_TOUR_ID].startedCount,
    ).toBe(1);
    expect(telemetry.coachmarkStarted).toHaveBeenCalledWith(
      ADVANCED_TOUR_ID,
      6,
    );
  });

  it("폴더 게이트(ready=false)에선 안 뜬다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: false }));
    await flushFrames();
    expect(screen.queryByTestId("advanced-tour")).toBeNull();
  });

  it("다른 오버레이(blocked) 위엔 겹쳐 띄우지 않는다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: true, blocked: true }));
    await flushFrames();
    expect(screen.queryByTestId("advanced-tour")).toBeNull();
  });

  it("★건너뛰기는 그 세션 안에서 다시 뜨지 않는다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: true }));
    await flushFrames();
    fireEvent.click(screen.getByTestId("advanced-tour-skip"));
    await flushFrames();
    expect(screen.queryByTestId("advanced-tour")).toBeNull();
    const rec = useCoachmarkStore.getState().tours[ADVANCED_TOUR_ID];
    expect(rec.completedAt).toBe(0);
    expect(rec.dismissedAt).toBe(0);
    expect(rec.startedCount).toBeLessThan(MAX_TOUR_OFFERS);
  });

  it("'다시 보지 않기' 는 영속 기록에 끝을 남긴다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: true }));
    await flushFrames();
    fireEvent.click(screen.getByTestId("advanced-tour-never"));
    await flushFrames();
    expect(
      useCoachmarkStore.getState().tours[ADVANCED_TOUR_ID].dismissedAt,
    ).toBeGreaterThan(0);
  });

  it("끝까지 보면 완주를 기록하고 다시 안 뜬다", async () => {
    anchors();
    render(createElement(MarbloModeTour, { ready: true }));
    await flushFrames();
    for (let i = 0; i < 6; i++) {
      fireEvent.click(screen.getByTestId("advanced-tour-next"));
    }
    await flushFrames();
    expect(screen.queryByTestId("advanced-tour")).toBeNull();
    expect(
      useCoachmarkStore.getState().tours[ADVANCED_TOUR_ID].completedAt,
    ).toBeGreaterThan(0);
    expect(telemetry.coachmarkCompleted).toHaveBeenCalledTimes(1);
  });

  it("이미 완주한 설치에선 아예 안 뜬다", async () => {
    anchors();
    useCoachmarkStore.setState({
      tours: {
        [ADVANCED_TOUR_ID]: {
          startedCount: 1,
          completedAt: 1_000,
          dismissedAt: 0,
        },
      },
    });
    render(createElement(MarbloModeTour, { ready: true }));
    await flushFrames();
    expect(screen.queryByTestId("advanced-tour")).toBeNull();
  });
});
