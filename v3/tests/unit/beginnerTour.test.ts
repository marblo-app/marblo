// @vitest-environment jsdom
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 비기너 투어의 **재노출 경계**만 본다 — 규칙 자체는 coachmark.test.ts, 그리기는
 * coachmarkOverlay.test.ts 가 덮는다.
 *
 * ★여기서 지키는 회귀: 건너뛰기가 자기 자신을 되살리면 안 된다. 건너뛰기는
 * 영속 기록에 '끝' 표시를 남기지 않으므로(다음 실행에 다시 권하려고), 세션 경계가
 * 없으면 닫는 순간 곧바로 다시 뜬다 — 유저에겐 닫히지 않는 팝업이다.
 */

// 텔레메트리는 firebase 를 물고 들어온다. 투어 계약과 무관하므로 통째로 스텁.
vi.mock("../../src/services/telemetryService", () => ({
  default: {
    coachmarkStarted: vi.fn(),
    coachmarkCompleted: vi.fn(),
    coachmarkSkipped: vi.fn(),
  },
}));

const { BeginnerTour } =
  await import("../../src/components/beginner/BeginnerTour");
const { useCoachmarkStore } = await import("../../src/stores/coachmarkStore");
const { BEGINNER_TOUR_ID, MAX_TOUR_OFFERS } =
  await import("../../src/lib/coachmark");
const telemetry = (await import("../../src/services/telemetryService")).default;

function anchors() {
  for (const name of ["chat", "ask", "live", "advanced"]) {
    const el = document.createElement("div");
    el.setAttribute("data-coach", `beginner-${name}`);
    document.body.appendChild(el);
  }
}

/** rAF 기반 시작을 실제 프레임 없이 흘려보낸다. */
async function flushFrames() {
  await new Promise((r) => setTimeout(r, 0));
  await new Promise((r) => requestAnimationFrame(() => r(null)));
  await new Promise((r) => setTimeout(r, 0));
}

describe("BeginnerTour", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
    useCoachmarkStore.setState({ tours: {} });
    vi.clearAllMocks();
  });
  afterEach(cleanup);

  it("앵커가 준비되면 뜨고, 시작을 기록한다", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: true }));
    await flushFrames();
    expect(screen.getByTestId("beginner-tour")).toBeTruthy();
    expect(
      useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID].startedCount,
    ).toBe(1);
    expect(telemetry.coachmarkStarted).toHaveBeenCalledTimes(1);
  });

  it("연결·폴더 게이트에 서 있는 동안(ready=false)엔 안 뜬다", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: false }));
    await flushFrames();
    expect(screen.queryByTestId("beginner-tour")).toBeNull();
  });

  it("다른 오버레이가 떠 있으면(blocked) 겹쳐 띄우지 않는다", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: true, blocked: true }));
    await flushFrames();
    expect(screen.queryByTestId("beginner-tour")).toBeNull();
  });

  it("★건너뛰기는 그 세션 안에서 다시 뜨지 않는다(닫히지 않는 팝업 회귀)", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: true }));
    await flushFrames();
    fireEvent.click(screen.getByTestId("beginner-tour-skip"));
    await flushFrames();
    expect(screen.queryByTestId("beginner-tour")).toBeNull();
    // 그래도 '끝' 표시는 남기지 않는다 — 다음 실행엔 다시 권해야 한다.
    const rec = useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID];
    expect(rec.completedAt).toBe(0);
    expect(rec.dismissedAt).toBe(0);
    expect(rec.startedCount).toBeLessThan(MAX_TOUR_OFFERS);
    expect(telemetry.coachmarkSkipped).toHaveBeenCalledWith(
      BEGINNER_TOUR_ID,
      0,
      4,
      false,
    );
  });

  it("'다시 보지 않기' 는 영속 기록에 끝을 남긴다", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: true }));
    await flushFrames();
    fireEvent.click(screen.getByTestId("beginner-tour-never"));
    await flushFrames();
    expect(
      useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID].dismissedAt,
    ).toBeGreaterThan(0);
    expect(telemetry.coachmarkSkipped).toHaveBeenCalledWith(
      BEGINNER_TOUR_ID,
      0,
      4,
      true,
    );
  });

  it("끝까지 보면 완주를 기록하고 다시 안 뜬다", async () => {
    anchors();
    render(createElement(BeginnerTour, { ready: true }));
    await flushFrames();
    for (let i = 0; i < 4; i++) {
      fireEvent.click(screen.getByTestId("beginner-tour-next"));
    }
    await flushFrames();
    expect(screen.queryByTestId("beginner-tour")).toBeNull();
    expect(
      useCoachmarkStore.getState().tours[BEGINNER_TOUR_ID].completedAt,
    ).toBeGreaterThan(0);
    expect(telemetry.coachmarkCompleted).toHaveBeenCalledTimes(1);
  });

  it("이미 완주한 설치에선 아예 안 뜬다", async () => {
    anchors();
    useCoachmarkStore.setState({
      tours: {
        [BEGINNER_TOUR_ID]: {
          startedCount: 1,
          completedAt: 1_000,
          dismissedAt: 0,
        },
      },
    });
    render(createElement(BeginnerTour, { ready: true }));
    await flushFrames();
    expect(screen.queryByTestId("beginner-tour")).toBeNull();
  });
});
