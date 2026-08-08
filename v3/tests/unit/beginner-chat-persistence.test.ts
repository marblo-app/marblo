/**
 * @vitest-environment jsdom
 *
 * ★비기너 상단 대화창 — "일회성 첫 요청" → "지속 대화창" 전환의 계약.
 *
 * 시연에서 사장님이 짚은 자리다: 첫 요청이 전달되면 입력칸이 통째로 사라져서,
 * 오케에게 이어서 말할 곳이 없었다. 그런데 그 잠금은 장식이 아니라 실제 사고
 * (활성화 진단 §7 P1-2 ①: 같은 프롬프트를 14초 간격으로 3번 주입)의 수리였다.
 * 그래서 이 전환은 **가드를 없애는 게 아니라 형태를 바꾸는 것**이고, 그 두 가지
 * (계속 대화된다 / 같은 말이 두 번 주입되지 않는다)가 한 화면에서 동시에
 * 성립하는지는 눈으로 확인하기 어렵다 — 여기서 못박는다.
 *
 * 실제 오케 PTY 는 태우지 않는다. 계약의 경계는 `routeInstructionToOrchestrator`
 * 호출이므로, 그 함수의 **호출 횟수와 인자**가 곧 "주입됐는가" 다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, useState } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";

const routeSpy = vi.hoisted(() =>
  vi.fn(async () => "local" as "local" | "queued" | "failed"),
);

vi.mock("../../src/services/orchestratorInstructionService", () => ({
  routeInstructionToOrchestrator: routeSpy,
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", name: "demo" } }),
  ),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

import { BeginnerChatBar } from "../../src/components/beginner/BeginnerChatBar";
import {
  useBeginnerAsk,
  BEGINNER_DUP_WINDOW_MS,
} from "../../src/hooks/useBeginnerAsk";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

/**
 * 셸이 하는 배선(훅 + 입력 문자열 보유)을 그대로 재현한 최소 하네스.
 *
 * ★여기서는 컴포저를 **계속 마운트한 채** 둔다. 이 파일의 관심사는 컴포넌트가
 * 스스로 잠기지 않는다는 것(같은 문장 가드가 폼 잠금이 아니라 훅에 있다)이고,
 * "언제 접히는가" 는 셸의 규칙이라 `beginner-shell-wiring.test.ts` 가 든다.
 * 얼굴만 셸과 같은 규칙으로 바꾼다: 첫 전달 뒤에는 안내를 접은 얼굴.
 */
function Harness() {
  const ask = useBeginnerAsk();
  const [draft, setDraft] = useState("");
  return createElement(BeginnerChatBar, {
    ask,
    draft,
    onDraftChange: setDraft,
    mode: ask.locked ? "followUp" : "intro",
  });
}

function input() {
  return screen.getByTestId("beginner-first-ask-input") as HTMLTextAreaElement;
}

async function send(text: string) {
  fireEvent.change(input(), { target: { value: text } });
  await act(async () => {
    fireEvent.click(screen.getByTestId("beginner-first-ask-send"));
  });
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  routeSpy.mockClear();
  routeSpy.mockImplementation(async () => "local");
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(1_000_000));
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("지속 대화창", () => {
  it("★전달돼도 컴포넌트가 스스로 잠기지 않는다 (일회성 아님)", async () => {
    // 화면에서 이 칸이 접히는 건 셸의 판정이다(대화 표면 하나 —
    // beginner-shell-wiring.test.ts). 컴포넌트 자체가 잠기면 프리필로 되살려도
    // 아무것도 못 쓰게 되므로, 그 둘은 다른 계약이다.
    render(createElement(Harness));
    await send("README 를 읽고 시작 가이드를 정리해 줘");

    expect(routeSpy).toHaveBeenCalledTimes(1);
    // 예전 계약은 여기서 입력칸과 버튼이 사라지는 것이었다.
    expect(screen.getByTestId("beginner-first-ask-input")).toBeTruthy();
    expect(screen.getByTestId("beginner-first-ask-send")).toBeTruthy();
    expect(screen.getByTestId("beginner-first-ask").dataset.mode).toBe("chat");
  });

  it("★전달에 성공하면 입력을 비운다 — 남아 있으면 그게 연타의 미끼다", async () => {
    render(createElement(Harness));
    await send("가이드 정리해 줘");
    expect(input().value).toBe("");
  });

  it("★다른 말은 몇 번이든 이어서 보낼 수 있다", async () => {
    render(createElement(Harness));
    await send("가이드 정리해 줘");
    await send("거기에 예시도 넣어 줘");
    await send("마지막으로 오타도 봐 줘");

    expect(routeSpy).toHaveBeenCalledTimes(3);
    expect(routeSpy.mock.calls.map((c) => (c[0] as any).message)).toEqual([
      "가이드 정리해 줘",
      "거기에 예시도 넣어 줘",
      "마지막으로 오타도 봐 줘",
    ]);
  });

  it("첫 전달 뒤에는 안내(제목·예시 칩)를 접는다", async () => {
    const { container } = render(createElement(Harness));
    expect(container.textContent).toContain(ko["beginner.ask.title"]);
    expect(container.textContent).toContain(ko["beginner.ask.example1"]);

    await send("가이드 정리해 줘");

    expect(container.textContent).not.toContain(ko["beginner.ask.title"]);
    expect(container.textContent).not.toContain(ko["beginner.ask.example1"]);
  });
});

describe("★중복 주입 가드는 형태만 바뀌었다 (진단 §7 P1-2 ①)", () => {
  it("같은 문장을 곧바로 다시 보내면 주입하지 않는다", async () => {
    render(createElement(Harness));
    await send("가이드 정리해 줘");
    expect(routeSpy).toHaveBeenCalledTimes(1);

    await send("가이드 정리해 줘");
    expect(routeSpy).toHaveBeenCalledTimes(1);
    // 조용히 삼키지 않는다 — 막았다는 사실을 그 자리에서 말한다.
    expect(screen.getByTestId("beginner-ask-duplicate")).toBeTruthy();
  });

  it("창이 지나면 같은 문장도 다시 보낼 수 있다", async () => {
    render(createElement(Harness));
    await send("가이드 정리해 줘");

    vi.setSystemTime(new Date(1_000_000 + BEGINNER_DUP_WINDOW_MS + 1));
    await send("가이드 정리해 줘");
    expect(routeSpy).toHaveBeenCalledTimes(2);
  });

  it("★전달에 실패한 문장은 가드에 걸리지 않는다 (오케가 받은 적이 없다)", async () => {
    routeSpy.mockImplementation(async () => "failed");
    render(createElement(Harness));

    await send("가이드 정리해 줘");
    await send("가이드 정리해 줘");

    expect(routeSpy).toHaveBeenCalledTimes(2);
    // 실패는 대화 국면으로 넘기지 않는다 — 아직 첫 요청 앞이다.
    expect(screen.getByTestId("beginner-first-ask").dataset.mode).toBe("intro");
    expect(
      screen.getByTestId("beginner-first-ask-result").dataset.delivery,
    ).toBe("failed");
  });

  it("★queued 는 전달로 치지 않는다 (F3) — 안내도 접지 않는다", async () => {
    routeSpy.mockImplementation(async () => "queued");
    render(createElement(Harness));
    await send("가이드 정리해 줘");

    expect(screen.getByTestId("beginner-first-ask").dataset.mode).toBe("intro");
    expect(
      screen.getByTestId("beginner-first-ask-result").dataset.delivery,
    ).toBe("queued");
    // 오케가 받은 적이 없으니 입력도 비우지 않는다(그대로 다시 누를 수 있어야).
    expect(input().value).toBe("가이드 정리해 줘");
  });
});
