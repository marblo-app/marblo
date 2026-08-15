/**
 * @vitest-environment jsdom
 *
 * GitHubAccountConnectionSection(렌더러) — 티켓 leyZnPBHbHUl3H9sRTDF.
 *
 * 계약:
 *  1) Harness 탭 선택 연결 — 접힘/열림 가이드(device OAuth → GitHub App 자동상속).
 *  2) status 는 connected 불리언만 — 토큰 원문은 렌더러에 없음.
 *  3) deviceStart 성공 시 user code + verification 링크 노출, poll success 시 연결 배지.
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

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: vi.fn(() => ({ user: { uid: "u1" } })),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ currentProject: null }),
  ),
}));

import { GitHubAccountConnectionSection } from "../../src/components/harness/ConnectionStatusPanel";
import { useAuth } from "../../src/hooks/useAuth";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

function installGithubStub(overrides: Record<string, unknown> = {}) {
  const api = {
    status: vi.fn(async () => ({ connected: false })),
    deviceStart: vi.fn(async () => ({
      ok: true,
      sessionId: "sess-1",
      userCode: "ABCD-EFGH",
      verificationUri: "https://github.com/login/device",
      verificationUriComplete:
        "https://github.com/login/device?user_code=ABCD-EFGH",
      interval: 1,
    })),
    devicePoll: vi.fn(async () => ({ kind: "pending" as const })),
    disconnect: vi.fn(async () => ({ ok: true })),
    ...overrides,
  };
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = { github: api };
  return api;
}

function renderPanel() {
  return render(createElement(GitHubAccountConnectionSection));
}

async function findEnabledConnectButton() {
  await waitFor(() => {
    const button = screen
      .getByText(ko["harness.github.connect"])
      .closest("button") as HTMLButtonElement;
    expect(button.disabled).toBe(false);
  });
  return screen
    .getByText(ko["harness.github.connect"])
    .closest("button") as HTMLButtonElement;
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  vi.mocked(useAuth).mockReturnValue({ user: { uid: "u1" } } as ReturnType<
    typeof useAuth
  >);
  vi.useRealTimers();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("GitHubAccountConnectionSection — 상태 표시", () => {
  it("미연결이면 배지·선택 라벨이 보인다", async () => {
    installGithubStub();
    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(ko["harness.github.status.disconnected"]),
      ).toBeTruthy(),
    );
    expect(screen.getByText(ko["harness.github.title"])).toBeTruthy();
    expect(screen.getByText(ko["harness.github.optionalBadge"])).toBeTruthy();
    expect(screen.getByText(ko["harness.github.connect"])).toBeTruthy();
  });

  it("연결됨이면 연결 배지가 뜨고 연결 버튼은 없다", async () => {
    installGithubStub({
      status: vi.fn(async () => ({ connected: true })),
    });
    renderPanel();

    await waitFor(() =>
      expect(
        screen.getByText(ko["harness.github.status.connected"]),
      ).toBeTruthy(),
    );
    expect(screen.queryByText(ko["harness.github.connect"])).toBeNull();
  });
});

describe("GitHubAccountConnectionSection — device OAuth", () => {
  it("연결 클릭 시 deviceStart 를 호출하고 user code 를 보여준다", async () => {
    const api = installGithubStub();
    renderPanel();

    fireEvent.click(await findEnabledConnectButton());

    await waitFor(() => expect(api.deviceStart).toHaveBeenCalledWith("u1"));
    await waitFor(() => expect(screen.getByText("ABCD-EFGH")).toBeTruthy());

    const openLink = screen.getByText(
      ko["harness.github.openGithub"],
    ) as HTMLAnchorElement;
    expect(openLink.getAttribute("href")).toBe(
      "https://github.com/login/device?user_code=ABCD-EFGH",
    );
    expect(openLink.getAttribute("target")).toBe("_blank");
  });

  it("poll success 시 연결 배지로 바뀐다", async () => {
    const api = installGithubStub({
      // 짧은 interval 로 바로 poll 이 돌게 한다.
      deviceStart: vi.fn(async () => ({
        ok: true,
        sessionId: "sess-1",
        userCode: "ABCD-EFGH",
        verificationUri: "https://github.com/login/device",
        interval: 0.05,
      })),
      devicePoll: vi.fn(async () => ({ kind: "success" as const })),
    });
    renderPanel();

    fireEvent.click(await findEnabledConnectButton());
    await waitFor(() => expect(api.deviceStart).toHaveBeenCalled());

    await waitFor(
      () =>
        expect(
          screen.getByText(ko["harness.github.status.connected"]),
        ).toBeTruthy(),
      { timeout: 3000 },
    );
    expect(screen.getByText(ko["harness.github.connected"])).toBeTruthy();
  });
});

describe("GitHubAccountConnectionSection — 연결 가이드 (접힘/열림)", () => {
  it("기본값은 접힘 상태이고, 토글을 누르면 가이드 단계가 펼쳐진다", async () => {
    installGithubStub();
    renderPanel();

    const toggle = await screen.findByText(ko["harness.github.guide.toggle"]);
    const toggleButton = toggle.closest("button") as HTMLButtonElement;
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.github.guide.step3"],
    );

    fireEvent.click(toggleButton);

    expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    const bodyText = document.body.textContent ?? "";
    for (const step of ["step1", "step3", "step4", "step5", "step6"] as const) {
      expect(bodyText).toContain(
        ko[`harness.github.guide.${step}` as keyof typeof ko],
      );
    }
    expect(bodyText).toContain(ko["harness.github.guide.appTitle"]);
    expect(bodyText).toContain(ko["harness.github.guide.appBody"]);

    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["harness.github.guide.step3"],
    );
  });

  it("2단계 링크는 github.com/login/device 를 새 탭으로 연다", async () => {
    installGithubStub();
    renderPanel();

    fireEvent.click(await screen.findByText(ko["harness.github.guide.toggle"]));

    const link = screen.getByText(
      "github.com/login/device",
    ) as HTMLAnchorElement;
    expect(link.getAttribute("href")).toBe("https://github.com/login/device");
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toBe("noopener noreferrer");
  });
});

describe("GitHubAccountConnectionSection — 로그인 필요", () => {
  it("user 가 없으면 연결 버튼을 막고 안내를 띄운다", async () => {
    vi.mocked(useAuth).mockReturnValue({ user: null } as ReturnType<
      typeof useAuth
    >);
    installGithubStub();
    renderPanel();

    await waitFor(() =>
      expect(screen.getByText(ko["harness.github.needLogin"])).toBeTruthy(),
    );
    const connect = screen.queryByText(ko["harness.github.connect"]);
    if (connect) {
      expect((connect.closest("button") as HTMLButtonElement).disabled).toBe(
        true,
      );
    }
  });
});
