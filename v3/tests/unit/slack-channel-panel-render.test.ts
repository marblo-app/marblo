/**
 * @vitest-environment jsdom
 *
 * SlackChannelPanel(렌더러) — 티켓 MMYZuUjyluFlbJwC1gH9.
 *
 * ★이 파일이 못박는 계약은 하나다: 시크릿은 렌더러에 절대 안 내려온다.
 * status 응답엔 botToken/appToken 원문이 없고 hasBotToken/hasAppToken
 * 불리언만 있다(#936 IPC 계약) — 그래서 토큰 입력란은 항상 write-only 로
 * 비어 있어야 하고, 화면 어디에도 토큰 원문 문자열이 찍히면 안 된다.
 *
 * 두 번째로 잡는 사고: 토큰 입력란이 항상 비어 있다는 것 자체가 함정이다.
 * "빈 입력 = null 로 저장"을 그대로 재사용하면, 토큰을 저장한 다음 채널
 * ID만 바꾸거나 토글만 눌러도 매 저장마다 방금 저장한 토큰이 지워진다.
 * 그래서 save 호출에 botToken/appToken 이 "입력했을 때만" 실리는지를
 * 별도로 검증한다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (s: unknown) => unknown) =>
    selector({ currentProject: { id: "p1", name: "Project One" } }),
  ),
}));

import { SlackChannelPanel } from "../../src/components/harness/SlackChannelPanel";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function baseStatus(over: Record<string, unknown> = {}) {
  return {
    projectId: "p1",
    enabled: false,
    hasBotToken: false,
    hasAppToken: false,
    hasChannelId: false,
    channelId: null,
    inboundCapability: "trigger",
    preflight: {
      ok: false,
      hasBotToken: false,
      hasAppToken: false,
      hasChannelId: false,
      botTokenValid: false,
      appTokenValid: false,
      channelIdValid: false,
      issues: [],
    },
    canEnable: false,
    active: false,
    secretsEncrypted: true,
    ...over,
  };
}

function installSlackChannelStub(overrides: Record<string, unknown> = {}) {
  const api = {
    list: vi.fn(async () => []),
    set: vi.fn(async (input: Record<string, unknown>) =>
      baseStatus({
        channelId: (input.channelId as string | null) ?? null,
        hasBotToken: !!input.botToken,
        hasAppToken: !!input.appToken,
        enabled: !!input.enabled,
      }),
    ),
    status: vi.fn(async () => baseStatus()),
    remove: vi.fn(async () => true),
    probe: vi.fn(async () => ({
      ok: true,
      botUserId: "U123",
      teamId: "T123",
      appTokenOk: false,
    })),
    onHealth: vi.fn(),
    offHealth: vi.fn(),
    ...overrides,
  };
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = { slackChannel: api };
  return api;
}

function renderPanel() {
  return render(createElement(SlackChannelPanel));
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
});

afterEach(cleanup);

describe("SlackChannelPanel — 시크릿 미노출", () => {
  it("status 가 hasBotToken/hasAppToken=true 를 돌려줘도 토큰 입력란은 항상 비어 있다(write-only)", async () => {
    installSlackChannelStub({
      status: vi.fn(async () =>
        baseStatus({
          channelId: "C0123456789",
          hasBotToken: true,
          hasAppToken: true,
          enabled: true,
          active: true,
          canEnable: true,
        }),
      ),
    });
    renderPanel();

    await waitFor(() =>
      expect(screen.getByDisplayValue("C0123456789")).toBeTruthy(),
    );

    const passwordInputs = document.querySelectorAll(
      'input[type="password"]',
    ) as NodeListOf<HTMLInputElement>;
    expect(passwordInputs).toHaveLength(2);
    for (const input of passwordInputs) {
      expect(input.value).toBe("");
    }
    // 저장됨을 알리는 텍스트만 있고, 실제 토큰 문자열은 화면 어디에도 없다.
    expect(document.body.textContent).not.toMatch(/xoxb-|xapp-/);
  });

  it("연결됨 상태면 배지가 연결로 뜬다", async () => {
    installSlackChannelStub({
      status: vi.fn(async () =>
        baseStatus({ enabled: true, active: true, canEnable: true }),
      ),
    });
    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(ko["harness.slack.status.connected"]),
      ).toBeTruthy(),
    );
  });
});

describe("SlackChannelPanel — 저장 시 빈 토큰 필드는 '지움'이 아니라 '유지'다", () => {
  it("채널 ID만 바꿔 저장하면 botToken/appToken 키를 아예 안 보낸다", async () => {
    const api = installSlackChannelStub({
      status: vi.fn(async () =>
        baseStatus({ hasBotToken: true, hasAppToken: true, channelId: "C1" }),
      ),
    });
    renderPanel();

    await waitFor(() => expect(screen.getByDisplayValue("C1")).toBeTruthy());

    const channelInput = screen.getByDisplayValue("C1");
    fireEvent.change(channelInput, { target: { value: "C2" } });
    fireEvent.click(screen.getByText(ko["harness.slack.save"]));

    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(1));
    const input = api.set.mock.calls[0][0] as Record<string, unknown>;
    expect(input.channelId).toBe("C2");
    expect("botToken" in input).toBe(false);
    expect("appToken" in input).toBe(false);
  });

  it("bot token을 입력하고 저장하면 그 값이 실린다", async () => {
    const api = installSlackChannelStub();
    renderPanel();

    await waitFor(() => expect(api.status).toHaveBeenCalledWith("p1"));

    const passwordInputs = document.querySelectorAll(
      'input[type="password"]',
    ) as NodeListOf<HTMLInputElement>;
    fireEvent.change(passwordInputs[0], { target: { value: "xoxb-secret" } });
    fireEvent.click(screen.getByText(ko["harness.slack.save"]));

    await waitFor(() => expect(api.set).toHaveBeenCalledTimes(1));
    const input = api.set.mock.calls[0][0] as Record<string, unknown>;
    expect(input.botToken).toBe("xoxb-secret");

    // 저장 뒤 입력란은 다시 비워진다(write-only 유지).
    await waitFor(() => {
      const inputs = document.querySelectorAll(
        'input[type="password"]',
      ) as NodeListOf<HTMLInputElement>;
      expect(inputs[0].value).toBe("");
    });
  });
});

describe("SlackChannelPanel — probe / remove", () => {
  it("probe 버튼을 누르면 slackChannel.probe 를 호출하고 결과를 그린다", async () => {
    const api = installSlackChannelStub({
      status: vi.fn(async () => baseStatus({ hasBotToken: true })),
      probe: vi.fn(async () => ({
        ok: true,
        botUserId: "U9",
        teamId: "T9",
        appTokenOk: false,
      })),
    });
    renderPanel();

    await waitFor(() => expect(api.status).toHaveBeenCalled());
    fireEvent.click(screen.getByText(ko["harness.slack.probe"]));

    await waitFor(() => expect(api.probe).toHaveBeenCalledWith("p1"));
    await waitFor(() =>
      expect(screen.getByText(ko["harness.slack.probeResultOk"])).toBeTruthy(),
    );
  });

  it("remove 버튼은 확인 후 slackChannel.remove 를 호출한다", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    const api = installSlackChannelStub({
      status: vi.fn(async () => baseStatus({ hasBotToken: true })),
    });
    renderPanel();

    await waitFor(() => expect(api.status).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle(ko["harness.slack.remove"]));

    expect(confirmSpy).toHaveBeenCalled();
    await waitFor(() => expect(api.remove).toHaveBeenCalledWith("p1"));

    confirmSpy.mockRestore();
  });

  it("확인 취소 시 remove 를 호출하지 않는다", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(false);
    const api = installSlackChannelStub({
      status: vi.fn(async () => baseStatus({ hasBotToken: true })),
    });
    renderPanel();

    await waitFor(() => expect(api.status).toHaveBeenCalled());
    fireEvent.click(screen.getByTitle(ko["harness.slack.remove"]));

    expect(confirmSpy).toHaveBeenCalled();
    expect(api.remove).not.toHaveBeenCalled();

    confirmSpy.mockRestore();
  });
});

describe("SlackChannelPanel — 연결 가이드 (접힘/열림)", () => {
  it("기본값은 접힘 상태이고, 토글을 누르면 7단계 가이드가 펼쳐진다", async () => {
    installSlackChannelStub();
    renderPanel();

    const toggle = await screen.findByText(ko["harness.slack.guide.toggle"]);
    const toggleButton = toggle.closest("button") as HTMLButtonElement;
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.slack.guide.step2"],
    );

    fireEvent.click(toggleButton);

    expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    const bodyText = document.body.textContent ?? "";
    for (const step of [
      "step1After",
      "step2",
      "step3",
      "step4",
      "step5",
      "step6",
      "step7",
    ] as const) {
      expect(bodyText).toContain(
        ko[`harness.slack.guide.${step}` as keyof typeof ko],
      );
    }

    // 다시 누르면 접힌다.
    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.slack.guide.step2"],
    );
  });

  it("1단계 링크는 api.slack.com/apps 를 새 탭으로 연다", async () => {
    installSlackChannelStub();
    renderPanel();

    fireEvent.click(await screen.findByText(ko["harness.slack.guide.toggle"]));

    const link = screen.getByText("api.slack.com/apps") as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://api.slack.com/apps");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});
