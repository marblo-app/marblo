/**
 * @vitest-environment jsdom
 *
 * RepoConnectModal — 실제 DOM 렌더 배선 회귀 테스트.
 *
 * 순수 함수(resolveRepoConnectVisible)만 고정하면 이벤트 → forceOpen →
 * visible → JSX 렌더 경로가 끊겨도 놓친다. 여기서는 컴포넌트를 실제로
 * 마운트하고 `marblo:open-repo-connect` 이벤트를 dispatch 해 전체 배선을
 * 검증한다.
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

import type { ProjectPathResolution } from "../../src/lib/projectPaths";
import type { Project } from "../../src/types/project";
import { ko } from "../../src/locales/ko";

const projectStoreMock = vi.hoisted(() => ({
  state: {
    currentProject: null as Project | null,
    machineId: "machine-this",
    setFolderPathForThisMachine: vi.fn(),
    updateProject: vi.fn(),
  },
}));

const editorStoreMock = vi.hoisted(() => ({
  state: {
    setRootPath: vi.fn(),
  },
}));

vi.mock("../../src/stores/projectStore", () => {
  const useProjectStore = vi.fn((selector) =>
    selector(projectStoreMock.state),
  );
  return {
    useProjectStore: Object.assign(useProjectStore, {
      getState: () => projectStoreMock.state,
    }),
  };
});

vi.mock("../../src/stores/editorStore", () => ({
  useEditorStore: vi.fn((selector) => selector(editorStoreMock.state)),
}));

vi.mock("../../src/hooks/useAuth", () => ({
  useAuth: () => ({
    user: { uid: "user-1" },
    loading: false,
    error: null,
    loginWithGoogle: vi.fn(),
    loginWithGithub: vi.fn(),
    loginWithEmail: vi.fn(),
    signupWithEmail: vi.fn(),
    logout: vi.fn(),
    clearError: vi.fn(),
  }),
}));

vi.mock("../../src/services/projectService", () => ({
  normalizeGitRemoteUrl: (url?: string | null) =>
    url?.trim().replace(/\.git$/, "") ?? null,
}));

vi.mock("../../src/services/telemetryService", () => ({
  default: {
    folderConnected: vi.fn(),
  },
}));

import {
  REPO_CONNECT_OPEN_EVENT,
  RepoConnectModal,
} from "../../src/components/collaboration/RepoConnectModal";
import { useLocaleStore } from "../../src/lib/i18n";

const NOW = new Date("2026-08-04T09:00:00Z");
const REPO = "https://github.com/acme/app.git";

function makeProject(
  kind: ProjectPathResolution["kind"] | undefined,
  overrides: Partial<Project> = {},
): Project {
  const folderPathResolution: ProjectPathResolution | undefined =
    kind === "own"
      ? { kind, path: "/Users/me/app", source: "machine" }
      : kind === "foreign-only"
        ? {
            kind,
            otherMachines: [
              {
                machineId: "owner-machine",
                path: "/Users/owner/app",
                platform: "darwin",
                updatedAt: 1,
              },
            ],
          }
        : kind === "unregistered"
          ? { kind }
          : undefined;

  return {
    id: "project-1",
    name: "Project",
    ownerId: "owner-1",
    members: ["owner-1", "user-1"],
    gitRemoteUrl: REPO,
    folderPathResolution,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function installElectronApiMock() {
  const electronAPI = {
    platform: "darwin",
    fs: {
      checkFolderValidity: vi.fn().mockResolvedValue({
        exists: true,
        isEmpty: false,
        remoteUrl: REPO,
        matches: true,
      }),
      selectDirectory: vi.fn().mockResolvedValue(null),
      gitRemoteUrl: vi.fn().mockResolvedValue(REPO),
    },
    repo: {
      defaultCloneParent: vi.fn().mockResolvedValue("/Users/me/Marblo"),
      clone: vi.fn().mockResolvedValue({ ok: true, path: "/Users/me/app" }),
    },
    github: {
      status: vi.fn().mockResolvedValue({ connected: false }),
      deviceStart: vi.fn(),
      devicePoll: vi.fn(),
    },
    connection: {
      upsert: vi.fn().mockResolvedValue(undefined),
    },
  };
  (window as unknown as { electronAPI: Window["electronAPI"] }).electronAPI =
    electronAPI as unknown as Window["electronAPI"];
  return electronAPI;
}

function renderModal() {
  return render(createElement(RepoConnectModal));
}

describe("RepoConnectModal DOM wiring", () => {
  beforeEach(() => {
    useLocaleStore.getState().setLocale("ko");
    projectStoreMock.state.currentProject = makeProject(undefined);
    projectStoreMock.state.machineId = "machine-this";
    projectStoreMock.state.setFolderPathForThisMachine.mockReset();
    projectStoreMock.state.updateProject.mockReset();
    editorStoreMock.state.setRootPath.mockReset();
    installElectronApiMock();
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  it("stays hidden for a project without a resolved kind, then renders after the manual open event and disappears on close", async () => {
    const { rerender } = renderModal();

    expect(screen.queryByText(ko["collab.repoConnect.title"])).toBeNull();

    fireEvent(
      window,
      new CustomEvent(REPO_CONNECT_OPEN_EVENT, { bubbles: false }),
    );

    expect(
      await screen.findByText(ko["collab.repoConnect.title"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["collab.repoConnect.status.readyToDownload.title"]),
    ).toBeTruthy();
    expect(screen.getByText(REPO)).toBeTruthy();

    fireEvent.click(screen.getByText(ko["collab.repoConnect.later"]));

    await waitFor(() => {
      expect(screen.queryByText(ko["collab.repoConnect.title"])).toBeNull();
    });

    projectStoreMock.state.currentProject = makeProject("own", {
      id: "project-own-valid-after-close",
    });
    rerender(createElement(RepoConnectModal));

    await waitFor(() => {
      expect(screen.queryByText(ko["collab.repoConnect.title"])).toBeNull();
    });
  });

  it("does not auto-render for a normal own project after folder validity resolves (#699)", async () => {
    const electronAPI = installElectronApiMock();
    projectStoreMock.state.currentProject = makeProject("own");

    renderModal();

    await waitFor(() => {
      expect(electronAPI.fs.checkFolderValidity).toHaveBeenCalledWith({
        folderPath: "/Users/me/app",
        expectedRemoteUrl: REPO,
      });
    });
    expect(screen.queryByText(ko["collab.repoConnect.title"])).toBeNull();
  });

  it("shows the no-repository-address state in manual mode", async () => {
    projectStoreMock.state.currentProject = makeProject(undefined, {
      gitRemoteUrl: undefined,
    });

    renderModal();

    fireEvent(
      window,
      new CustomEvent(REPO_CONNECT_OPEN_EVENT, { bubbles: false }),
    );

    expect(
      await screen.findByText(ko["collab.repoConnect.status.noRepo.title"]),
    ).toBeTruthy();
    expect(
      screen.getByPlaceholderText(ko["collab.repoConnect.urlPlaceholder"]),
    ).toBeTruthy();
  });

  it("shows the downloading state while clone is pending", async () => {
    const electronAPI = installElectronApiMock();
    let resolveClone: (value: { ok: true; path: string }) => void = () => {};
    const clonePromise = new Promise<{ ok: true; path: string }>((resolve) => {
      resolveClone = resolve;
    });
    electronAPI.repo.clone.mockReturnValueOnce(clonePromise);
    projectStoreMock.state.currentProject = makeProject(undefined);

    renderModal();

    fireEvent(
      window,
      new CustomEvent(REPO_CONNECT_OPEN_EVENT, { bubbles: false }),
    );

    expect(
      await screen.findByText(ko["collab.repoConnect.title"]),
    ).toBeTruthy();
    fireEvent.click(screen.getByText(ko["collab.repoConnect.cloneAndConnect"]));

    expect(
      await screen.findByText(ko["collab.repoConnect.status.downloading.title"]),
    ).toBeTruthy();

    resolveClone({ ok: true, path: "/Users/me/app" });
    await waitFor(() => {
      expect(editorStoreMock.state.setRootPath).toHaveBeenCalledWith(
        "/Users/me/app",
      );
    });
  });
});
