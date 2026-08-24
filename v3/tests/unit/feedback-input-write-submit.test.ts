/**
 * @vitest-environment jsdom
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import FeedbackInput from "../../src/components/terminal/FeedbackInput";
import { useLocaleStore } from "../../src/lib/i18n";
import { addActivity } from "../../src/services/activityService";

vi.mock("../../src/services/activityService", () => ({
  addActivity: vi.fn(async () => undefined),
}));

type WriteResult = Awaited<ReturnType<Window["electronAPI"]["pty"]["writeAndSubmit"]>>;

const writeAndSubmit = vi.fn<Window["electronAPI"]["pty"]["writeAndSubmit"]>();

function installElectronApi() {
  Object.defineProperty(window, "electronAPI", {
    configurable: true,
    value: {
      pty: {
        writeAndSubmit,
      },
    },
  });
}

describe("FeedbackInput writeAndSubmit result handling", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    installElectronApi();
    useLocaleStore.getState().setLocale("ko");
  });

  afterEach(() => {
    cleanup();
  });

  it("keeps the draft and does not record history when the target composer is occupied", async () => {
    writeAndSubmit.mockResolvedValueOnce({
      ok: false,
      refusal: "composer-occupied",
      reason: "occupied",
    } satisfies WriteResult);

    render(createElement(FeedbackInput, { sessionId: "pty-1", taskId: "task-1" }));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "그거 취소해" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await screen.findByRole("status");

    expect(writeAndSubmit).toHaveBeenCalledWith("pty-1", "그거 취소해");
    expect(input.value).toBe("그거 취소해");
    expect(addActivity).not.toHaveBeenCalled();
    expect(screen.queryByText("최근 피드백")).toBeNull();
    expect(screen.getByRole("status").textContent).toContain(
      "상대 컴포저에 미제출 초안이 있어 보내지 않았습니다",
    );
  });

  it("keeps the draft and uses the dialog-specific refusal copy", async () => {
    writeAndSubmit.mockResolvedValueOnce({
      ok: false,
      refusal: "awaiting-choice",
      reason: "choice",
    } satisfies WriteResult);

    render(createElement(FeedbackInput, { sessionId: "pty-1" }));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "yes 말고 취소" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await screen.findByRole("status");

    expect(input.value).toBe("yes 말고 취소");
    expect(screen.getByRole("status").textContent).toContain(
      "상대가 확인 다이얼로그에 멈춰 있어 보내지 않았습니다",
    );
  });

  it("preserves the previous success path when the composer is writable", async () => {
    writeAndSubmit.mockResolvedValueOnce({
      ok: true,
      refusal: null,
      reason: null,
    } satisfies WriteResult);

    render(createElement(FeedbackInput, { sessionId: "pty-1", taskId: "task-1" }));

    const input = screen.getByRole("textbox") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "진행 상황 알려줘" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => expect(input.value).toBe(""));

    expect(addActivity).toHaveBeenCalledWith(
      "task-1",
      "pm",
      "[PM 피드백] 진행 상황 알려줘",
    );
    expect(screen.getByTitle("피드백 히스토리")).toBeTruthy();
  });
});
