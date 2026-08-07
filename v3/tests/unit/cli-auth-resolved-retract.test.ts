/**
 * @vitest-environment jsdom
 *
 * 그록 인증 팝업 오탐 근본수정 (ticket UO8F2SM7i6YTQcnbqrSX) — 렌더러 쪽 철회 배선.
 *
 * main 의 로그인-화면 백스톱이 발화한 뒤 CLI 가 readiness 에 도달하면
 * `agent:authResolved` 를 보낸다. Layout 이 그걸 `marblo:cli-auth-resolved` 로
 * 옮기고, 두 인증 표면(레거시 모달 CliSetupGate / 스플릿 셸 배너 CliSetupHost)이
 * 공유하는 useCliSetupEngine 이 그 이벤트로 표면을 닫는다.
 *
 * ★닫기는 `close` 여야 하고 `dismiss` 면 안 된다 — dismiss 는 영구 dismissal 을
 * 기록하므로, 사용자가 누른 적도 없는데 진짜 미인증일 때 안내가 사라진다.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render } from "@testing-library/react";

vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

// 엔진의 첫-실행 프로브/자동설치 경로는 이 테스트의 관심사가 아니다 — 아무것도
// 하지 않는(=표면을 절대 열지 않는) 스토어로 고정한다.
const storeState = {
  probeAll: vi.fn(async () => ({ requiredReady: true, results: {} })),
  runInstall: vi.fn(async () => {}),
  refreshVersions: vi.fn(),
  ready: true,
  loginRunning: false,
  setLoginRunning: vi.fn(),
  requiredInstalled: () => true,
};

vi.mock("../../src/stores/cliSetupStore", () => ({
  ORCHESTRATOR_CLI_IDS: ["cli-claude-code", "cli-codex"],
  ROWS: [],
  useCliSetupStore: (sel: (s: typeof storeState) => unknown) =>
    sel(storeState as never),
}));

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: (sel: (s: unknown) => unknown) =>
    sel({ currentProject: { folderPath: "/tmp/project" } }),
}));

vi.mock("../../src/stores/onboardingProgressStore", () => ({
  isOnboardingDismissed: () => false,
  setOnboardingDismissed: vi.fn(),
}));

const { useCliSetupEngine } = await import("../../src/hooks/useCliSetupEngine");

function Harness(props: {
  close: () => void;
  openAt: (step: string) => void;
}): null {
  useCliSetupEngine({
    openAt: props.openAt as never,
    close: props.close,
  });
  return null;
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("marblo:cli-auth-resolved — 오탐 철회", () => {
  it("이벤트를 받으면 인증 표면을 close 한다", () => {
    const close = vi.fn();
    const openAt = vi.fn();
    render(createElement(Harness, { close, openAt }));
    // 마운트 시점의 ready-edge 도 close 를 부르므로 기준선을 잡고 증분만 본다.
    close.mockClear();

    window.dispatchEvent(new CustomEvent("marblo:cli-auth-resolved"));

    expect(close).toHaveBeenCalledTimes(1);
  });

  it("언마운트 후에는 더 이상 반응하지 않는다(리스너 누수 없음)", () => {
    const close = vi.fn();
    const openAt = vi.fn();
    const { unmount } = render(createElement(Harness, { close, openAt }));
    unmount();
    close.mockClear();

    window.dispatchEvent(new CustomEvent("marblo:cli-auth-resolved"));

    expect(close).not.toHaveBeenCalled();
  });
});

describe("Layout — agent:authResolved → marblo:cli-auth-resolved 브리지", () => {
  it("Layout 이 authResolved IPC 를 구독해 철회 이벤트로 옮긴다", async () => {
    // Layout 전체를 렌더하려면 앱 셸 전부가 필요하므로, 배선 자체를 소스에서 확인한다
    // (needsAuth ↔ authResolved 가 짝을 이루는지가 이 티켓의 계약이다).
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(
      path.join(process.cwd(), "src/components/Layout.tsx"),
      "utf-8",
    );
    expect(src).toContain('window.electronAPI.on("agent:authResolved"');
    expect(src).toContain('new CustomEvent("marblo:cli-auth-resolved")');
    expect(src).toContain('window.electronAPI.off("agent:authResolved")');
  });
});
