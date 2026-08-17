/**
 * @vitest-environment jsdom
 *
 * 리포 연결 후 독립 워크트리 안내 (YTpcEK5Ow5LIldkJJzQc)
 *
 * 계약:
 *  1) 연결 성공 시 1회성 팝업 — localStorage 로 본 기록.
 *  2) ConnectionStatusPanel 에 상시 note 노출.
 *  3) StartHereTab 에 권장 안내 노출.
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
    selector({
      currentProject: {
        id: "proj-1",
        name: "Demo",
        folderPath: "/tmp/demo",
      },
    }),
  ),
}));

import {
  ConnectionStatusPanel,
  WorktreeGuideNote,
  WorktreeGuidePopup,
  WORKTREE_GUIDE_POPUP_KEY,
  consumeWorktreeGuidePopup,
  hasSeenWorktreeGuidePopup,
  markWorktreeGuidePopupSeen,
} from "../../src/components/harness/ConnectionStatusPanel";
import { StartHereTab } from "../../src/components/onboarding/StartHereTab";
import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";

// StartHereTab 의 무거운 의존성은 최소 스텁.
vi.mock("../../src/stores/cliSetupStore", () => ({
  ROWS: [],
  useCliSetupStore: vi.fn((selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      ready: false,
      states: {},
      probeAll: vi.fn(),
      refreshVersions: vi.fn(),
      requiredInstalled: () => false,
    }),
  ),
}));

vi.mock("../../src/stores/onboardingProgressStore", () => ({
  useOnboardingProgressStore: vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({
        progress: {
          current: "install",
          dismissed: false,
          done: {},
          skipped: {},
        },
        markDone: vi.fn(),
        markSkipped: vi.fn(),
        setCurrent: vi.fn(),
        setDismissed: vi.fn(),
      }),
  ),
}));

vi.mock("../../src/stores/splitWorkspaceStore", () => ({
  useSplitWorkspaceStore: vi.fn(
    (selector: (s: Record<string, unknown>) => unknown) =>
      selector({ setActiveTab: vi.fn() }),
  ),
}));

vi.mock("../../src/hooks/useCliSetupEngine", () => ({
  useStepPrdSuccess: vi.fn(),
}));

vi.mock("../../src/hooks/useByomOptions", () => ({
  useByomOptions: () => ({ gate: { installed: false, ready: false } }),
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: { cliSetupStep: vi.fn() },
}));

vi.mock("../../src/services/cliSetupActions", () => ({
  connectFolder: vi.fn(),
  createFirstTicket: vi.fn(),
  seedSamplePrd: vi.fn(),
}));

vi.mock("../../src/components/onboarding/CliSetupRows", () => ({
  CliRowCard: () => null,
  InstallAllPanel: () => null,
  OneClickSignInPanel: () => null,
}));

vi.mock("../../src/components/onboarding/ByomStartSection", () => ({
  ByomStartSection: () => null,
}));

vi.mock("../../src/components/onboarding/FirstTicketResultNote", () => ({
  FirstTicketResultNote: () => null,
}));

vi.mock("../../src/components/onboarding/VendorModelsSection", () => ({
  VendorModelsSection: () => null,
}));

vi.mock("../../src/components/onboarding/DemoMode", () => ({
  DemoMode: () => null,
  DEMO_CONNECT_PENDING_KEY: "demo-pending",
}));

vi.mock("../../src/components/onboarding/demoScript", () => ({
  DEMO_TOTAL_SECONDS: 30,
}));

vi.mock("../../src/components/onboarding/OnrampDecomposeCard", () => ({
  OnrampDecomposeCard: () => null,
}));

vi.mock("../../src/lib/onboardingProgress", () => ({
  isOnboardingComplete: () => false,
  resumeStep: () => "install",
  stepViews: () => [
    { id: "install", status: "current", skipped: false },
    { id: "auth", status: "remaining", skipped: false },
    { id: "prd", status: "remaining", skipped: false },
    { id: "firstTicket", status: "remaining", skipped: false },
  ],
}));

/** vitest node env 에는 localStorage 가 없다 — 인메모리 스텁. */
class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  constructor(initial: Record<string, string> = {}) {
    for (const [k, v] of Object.entries(initial)) this.map.set(k, v);
  }
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(k: string): string | null {
    return this.map.get(k) ?? null;
  }
  setItem(k: string, v: string): void {
    this.map.set(k, String(v));
  }
  removeItem(k: string): void {
    this.map.delete(k);
  }
  key(i: number): string | null {
    return [...this.map.keys()][i] ?? null;
  }
}

function memoryStorage(initial: Record<string, string> = {}): Storage {
  return new MemoryStorage(initial);
}

function installLocalStorage(storage: Storage = new MemoryStorage()) {
  vi.stubGlobal("localStorage", storage);
  const win = (globalThis as { window?: { localStorage?: Storage } }).window;
  if (win) {
    Object.defineProperty(win, "localStorage", {
      configurable: true,
      value: storage,
    });
  } else {
    vi.stubGlobal("window", { localStorage: storage, electronAPI: undefined });
  }
  return storage;
}

function installConnectionStub(overrides: {
  get?: () => Promise<unknown>;
  upsert?: () => Promise<unknown>;
  listAgents?: () => Promise<unknown[]>;
} = {}) {
  const api = {
    connection: {
      get: overrides.get ?? vi.fn(async () => null),
      upsert: overrides.upsert ?? vi.fn(async () => ({})),
      check: vi.fn(async () => ({ ok: true, items: [] })),
      setAccess: vi.fn(),
      remove: vi.fn(async () => true),
    },
    agent: {
      list: overrides.listAgents ?? vi.fn(async () => []),
    },
    github: {
      status: vi.fn(async () => ({ connected: false })),
      deviceStart: vi.fn(),
      devicePoll: vi.fn(),
      disconnect: vi.fn(),
    },
    system: {
      nodeHealth: vi.fn(async () => null),
    },
  };
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = api;
  return api;
}

beforeEach(() => {
  useLocaleStore.setState({ locale: "ko" });
  installLocalStorage();
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe("worktree guide popup storage helpers", () => {
  it("미표시 상태면 consume 이 true 이고 키를 기록한다", () => {
    const storage = memoryStorage();
    expect(hasSeenWorktreeGuidePopup(storage)).toBe(false);
    expect(consumeWorktreeGuidePopup(storage)).toBe(true);
    expect(storage.getItem(WORKTREE_GUIDE_POPUP_KEY)).toBe("1");
    expect(hasSeenWorktreeGuidePopup(storage)).toBe(true);
  });

  it("이미 본 적 있으면 consume 이 false 이다", () => {
    const storage = memoryStorage({ [WORKTREE_GUIDE_POPUP_KEY]: "1" });
    expect(consumeWorktreeGuidePopup(storage)).toBe(false);
  });

  it("markSeen 후 hasSeen 이 true 이다", () => {
    const storage = memoryStorage();
    markWorktreeGuidePopupSeen(storage);
    expect(hasSeenWorktreeGuidePopup(storage)).toBe(true);
  });
});

describe("WorktreeGuideNote / Popup UI", () => {
  it("상시 note 에 독립 워크트리 본문이 보인다", () => {
    render(createElement(WorktreeGuideNote));
    expect(screen.getByTestId("worktree-guide-note")).toBeTruthy();
    expect(
      screen.getByText(ko["harness.conn.worktreeGuide.body"]),
    ).toBeTruthy();
  });

  it("팝업 확인 버튼이 onClose 를 호출한다", () => {
    const onClose = vi.fn();
    render(createElement(WorktreeGuidePopup, { onClose }));
    expect(screen.getByTestId("worktree-guide-popup")).toBeTruthy();
    fireEvent.click(screen.getByTestId("worktree-guide-popup-dismiss"));
    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("ConnectionStatusPanel — 연결 성공 시 1회성 팝업", () => {
  it("첫 연결 성공 시 팝업을 띄우고 재동기화 시에는 안 띄운다", async () => {
    const storage = installLocalStorage();
    let connected: Record<string, unknown> | null = null;
    const connectedPayload = {
      projectId: "proj-1",
      localPath: "/tmp/demo",
      repoUrl: "https://github.com/acme/demo",
      defaultBranch: "main",
      accessMode: "read",
      permissionsState: "unknown",
      connectedHarness: null,
      lastRunAt: null,
      availableMcps: [],
    };
    const api = installConnectionStub({
      get: vi.fn(async () => connected),
      upsert: vi.fn(async () => {
        connected = connectedPayload;
        return connected;
      }),
    });

    render(createElement(ConnectionStatusPanel));

    await waitFor(() =>
      expect(screen.getByText(ko["harness.conn.noRepo"])).toBeTruthy(),
    );
    // 미연결 상태에서도 상시 안내가 보인다.
    expect(screen.getByTestId("worktree-guide-note")).toBeTruthy();

    // GitHub 계정 연결에도 같은 "연결하기" 라벨이 있어, 저장소 연결 CTA
    // (primary 파란 버튼) 만 고른다.
    const connectBtn = screen
      .getAllByRole("button")
      .find(
        (btn) =>
          btn.textContent?.includes(ko["harness.conn.connect"]) &&
          btn.className.includes("bg-[#89b4fa]"),
      ) as HTMLButtonElement;
    expect(connectBtn).toBeTruthy();
    fireEvent.click(connectBtn);

    await waitFor(() =>
      expect(screen.getByTestId("worktree-guide-popup")).toBeTruthy(),
    );
    expect(api.connection.upsert).toHaveBeenCalled();
    expect(storage.getItem(WORKTREE_GUIDE_POPUP_KEY)).toBe("1");

    fireEvent.click(screen.getByTestId("worktree-guide-popup-dismiss"));
    await waitFor(() =>
      expect(screen.queryByTestId("worktree-guide-popup")).toBeNull(),
    );

    // 연결 상태에서도 상시 note 유지.
    expect(screen.getByTestId("worktree-guide-note")).toBeTruthy();
    expect(
      screen.getByText(ko["harness.conn.worktreeGuide.body"]),
    ).toBeTruthy();

    // 재마운트 + 이미 연결됨: 재동기화해도 팝업 없음.
    cleanup();
    connected = connectedPayload;
    installLocalStorage(storage);
    installConnectionStub({
      get: vi.fn(async () => connected),
      upsert: vi.fn(async () => connected),
    });
    render(createElement(ConnectionStatusPanel));

    await waitFor(() =>
      expect(screen.getByText(ko["harness.conn.resync"])).toBeTruthy(),
    );
    fireEvent.click(
      screen.getByText(ko["harness.conn.resync"]).closest("button")!,
    );
    // 재동기화는 첫 연결이 아니므로 팝업이 뜨지 않는다.
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("worktree-guide-popup")).toBeNull();
  });
});

describe("StartHereTab — 권장 독립 워크트리 안내", () => {
  it("권장 배지와 깃 리포 연결 설명이 보인다", () => {
    render(createElement(StartHereTab));
    expect(screen.getByTestId("start-here-worktree-recommend")).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.worktreeRecommend.badge"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.worktreeRecommend.title"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["onboarding.startHere.worktreeRecommend.body"]),
    ).toBeTruthy();
  });
});
