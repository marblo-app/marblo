/**
 * @vitest-environment jsdom
 *
 * "왜 멈췄나" 문항의 DOM 계약 (티켓 CkVKKGI8wZZPGfyVvH6c · #1310 처방 3).
 *
 * 판정 자체는 pauseReasonPrompt 테스트가 값으로 지킨다. 여기서 보는 것은 그
 * 판정이 화면·저장소·텔레메트리에 어떻게 닿는가다 — 특히 **조용히 죽는** 두 경로:
 *  · 막혀 있을 때 저장소를 밀어버려 다음 실행의 공백이 0 이 되는 것
 *  · 선택지를 고른 답이 [보내기] 를 안 누르면 사라지는 것
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

const telemetryMock = vi.hoisted(() => ({
  enabled: true,
  pauseReasonPrompt: vi.fn(),
}));
const submitPauseReason = vi.hoisted(() =>
  vi.fn(async () => ({
    ok: true,
    duplicate: false,
  })),
);

vi.mock("../../src/services/telemetryService", () => ({
  isTelemetryEnabled: () => telemetryMock.enabled,
  telemetry: { pauseReasonPrompt: telemetryMock.pauseReasonPrompt },
}));
vi.mock("../../src/services/pauseReasonService", () => ({ submitPauseReason }));

import { PauseReasonPrompt } from "../../src/components/retention/PauseReasonPrompt";
import { PAUSE_REASON_STORAGE_KEYS } from "../../src/lib/pauseReasonPrompt";
import { useLocaleStore } from "../../src/lib/i18n";

const DAY = 24 * 60 * 60 * 1000;

/**
 * 이 jsdom 설정에는 window.localStorage 가 없다(--localstorage-file 미지정).
 * 저장소를 직접 심어 **실제 키 이름까지** 검사한다 — 통째로 모킹하면 "무엇을
 * 남기는가" 를 볼 수 없고, 이 문항의 재노출 방지는 바로 그 키에 걸려 있다.
 */
function installStorage(kind: "localStorage" | "sessionStorage") {
  const map = new Map<string, string>();
  Object.defineProperty(window, kind, {
    configurable: true,
    value: {
      getItem: (key: string) => (map.has(key) ? map.get(key)! : null),
      setItem: (key: string, value: string) => {
        map.set(key, String(value));
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
      clear: () => map.clear(),
    },
  });
}

function seedLastOpened(daysAgo: number) {
  window.localStorage.setItem(
    PAUSE_REASON_STORAGE_KEYS.lastOpenedAt,
    String(Date.now() - daysAgo * DAY),
  );
}

describe("PauseReasonPrompt DOM", () => {
  beforeEach(() => {
    installStorage("localStorage");
    installStorage("sessionStorage");
    telemetryMock.enabled = true;
    telemetryMock.pauseReasonPrompt.mockReset();
    submitPauseReason.mockClear();
    useLocaleStore.setState({ locale: "ko" });
  });

  afterEach(() => {
    cleanup();
  });

  it("12일 공백 뒤 복귀에 뜨고, 노출을 그 자리에서 기록한다", () => {
    seedLastOpened(12);
    render(createElement(PauseReasonPrompt));

    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(telemetryMock.pauseReasonPrompt).toHaveBeenCalledWith("shown", {
      gapDays: 12,
    });
    // 띄운 순간 마커가 찍힌다 — 답하든 닫든 두 번 묻지 않겠다는 약속.
    expect(window.localStorage.getItem(PAUSE_REASON_STORAGE_KEYS.asked)).toBe(
      "1",
    );
  });

  it("3일 공백에는 뜨지 않는다", () => {
    seedLastOpened(3);
    render(createElement(PauseReasonPrompt));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(telemetryMock.pauseReasonPrompt).not.toHaveBeenCalled();
  });

  it("★텔레메트리 동의가 꺼져 있으면 뜨지 않는다", () => {
    telemetryMock.enabled = false;
    seedLastOpened(30);
    render(createElement(PauseReasonPrompt));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(telemetryMock.pauseReasonPrompt).not.toHaveBeenCalled();
  });

  it("★막혀 있으면 뜨지도, 저장소를 밀지도 않는다 (다음 기회를 잃지 않는다)", () => {
    seedLastOpened(12);
    const before = window.localStorage.getItem(
      PAUSE_REASON_STORAGE_KEYS.lastOpenedAt,
    );
    render(createElement(PauseReasonPrompt, { blocked: true }));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(
      window.localStorage.getItem(PAUSE_REASON_STORAGE_KEYS.lastOpenedAt),
    ).toBe(before);
    expect(
      window.localStorage.getItem(PAUSE_REASON_STORAGE_KEYS.asked),
    ).toBeNull();
  });

  it("★선택지를 고르는 순간 답이 기록된다 ([보내기] 를 안 눌러도 남는다)", () => {
    seedLastOpened(9);
    render(createElement(PauseReasonPrompt));

    fireEvent.click(screen.getByText("다른 도구로 같은 일을 했다"));

    expect(telemetryMock.pauseReasonPrompt).toHaveBeenCalledWith("answered", {
      gapDays: 9,
      reason: "other_tool",
    });
    // 산문은 이 단계에서 아직 아무 데도 가지 않는다.
    expect(submitPauseReason).not.toHaveBeenCalled();
  });

  it("안 고르고 닫으면 dismissed 로 남는다 (무응답과 미노출을 가른다)", () => {
    seedLastOpened(9);
    render(createElement(PauseReasonPrompt));

    fireEvent.click(screen.getByLabelText("질문 닫기"));

    expect(telemetryMock.pauseReasonPrompt).toHaveBeenCalledWith("dismissed", {
      gapDays: 9,
    });
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("고른 뒤 닫으면 dismissed 를 덧붙이지 않는다 (답은 이미 있다)", () => {
    seedLastOpened(9);
    render(createElement(PauseReasonPrompt));

    fireEvent.click(screen.getByText("비용이 부담됐다"));
    fireEvent.click(screen.getByLabelText("질문 닫기"));

    const phases = telemetryMock.pauseReasonPrompt.mock.calls.map((c) => c[0]);
    expect(phases).toEqual(["shown", "answered"]);
  });

  it("한 줄을 쓰면 전용 callable 로만 가고, 텔레메트리에는 길이만 남는다", async () => {
    seedLastOpened(14);
    render(createElement(PauseReasonPrompt));

    fireEvent.click(screen.getByText("결과물이 기대에 못 미쳤다"));
    fireEvent.change(screen.getByLabelText("덧붙일 말 (선택)"), {
      target: { value: "  테스트가  자꾸 깨졌다 " },
    });
    fireEvent.click(screen.getByText("보내기"));
    await vi.waitFor(() => expect(submitPauseReason).toHaveBeenCalledTimes(1));

    expect(submitPauseReason.mock.calls[0][0]).toMatchObject({
      reason: "output_quality",
      note: "테스트가 자꾸 깨졌다",
      gapDays: 14,
    });
    const noteCall = telemetryMock.pauseReasonPrompt.mock.calls.find(
      (c) => c[0] === "note",
    );
    expect(noteCall?.[1]).toMatchObject({
      reason: "output_quality",
      noteLength: 11,
      noteDelivered: true,
    });
    // ★산문은 텔레메트리 인자 어디에도 없다.
    for (const call of telemetryMock.pauseReasonPrompt.mock.calls) {
      expect(JSON.stringify(call)).not.toContain("테스트가");
    }
  });

  it("한 줄 전송이 실패해도 고른 항목은 잃지 않는다", async () => {
    submitPauseReason.mockRejectedValueOnce(new Error("offline"));
    seedLastOpened(14);
    render(createElement(PauseReasonPrompt));

    fireEvent.click(screen.getByText("비용이 부담됐다"));
    fireEvent.change(screen.getByLabelText("덧붙일 말 (선택)"), {
      target: { value: "비쌈" },
    });
    fireEvent.click(screen.getByText("보내기"));

    await screen.findByText(
      "덧붙인 말은 전달되지 않았습니다. 고른 항목은 기록됐습니다.",
    );
    const phases = telemetryMock.pauseReasonPrompt.mock.calls.map((c) => c[0]);
    expect(phases).toEqual(["shown", "answered", "note"]);
    expect(telemetryMock.pauseReasonPrompt).toHaveBeenLastCalledWith("note", {
      gapDays: 14,
      reason: "cost",
      noteLength: 2,
      noteDelivered: false,
    });
  });
});
