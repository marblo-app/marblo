/**
 * @vitest-environment jsdom
 *
 * FirstSharedProjectModal — invited teammate first-entry path.
 *
 * Regression target: the first shared-project prompt must not point the user at
 * a different tab for repository download. Its primary CTA emits the same
 * repository-setup event consumed by RepoConnectModal, so one click enters the
 * clone/connect flow.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement, Fragment } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";

import type { Project } from "../../src/types/project";
import { ko } from "../../src/locales/ko";

const NOW = new Date("2026-08-29T09:00:00Z");
const REPO = "https://github.com/acme/app.git";

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
    user: { uid: "member-1" },
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

import { FirstSharedProjectModal } from "../../src/components/collaboration/FirstSharedProjectModal";
import { FirstSharedProjectModalView } from "../../src/components/collaboration/FirstSharedProjectModalView";
import { RepoConnectModal } from "../../src/components/collaboration/RepoConnectModal";
import { useLocaleStore } from "../../src/lib/i18n";

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project-1",
    name: "Shared App",
    ownerId: "owner-1",
    members: ["owner-1", "member-1"],
    gitRemoteUrl: REPO,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

function installElectronApiMock() {
  const electronAPI = {
    platform: "darwin",
    fs: {
      checkFolderValidity: vi.fn(),
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
}

describe("FirstSharedProjectModal repository entry", () => {
  beforeEach(() => {
    localStorage.clear();
    useLocaleStore.getState().setLocale("ko");
    projectStoreMock.state.currentProject = makeProject();
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

  it("opens repository setup with one click from the shared-project prompt", async () => {
    render(
      createElement(
        Fragment,
        null,
        createElement(RepoConnectModal),
        createElement(FirstSharedProjectModal),
      ),
    );

    expect(screen.queryByText(ko["collab.repoConnect.title"])).toBeNull();

    fireEvent.click(
      screen.getByText(ko["collab.firstShared.cta.notDownloaded"]),
    );

    expect(
      await screen.findByText(ko["collab.repoConnect.title"]),
    ).toBeTruthy();
    expect(
      screen.getByText(ko["collab.repoConnect.status.readyToDownload.title"]),
    ).toBeTruthy();
  });

  it.each([
    {
      name: "no repository address",
      props: { hasRepoRemote: false, needsRepoConnect: true },
      titleKey: "collab.firstShared.repoStatus.noRepo.title",
      ctaKey: "collab.firstShared.cta.noRepo",
    },
    {
      name: "repository not downloaded",
      props: { hasRepoRemote: true, needsRepoConnect: true },
      titleKey: "collab.firstShared.repoStatus.notDownloaded.title",
      ctaKey: "collab.firstShared.cta.notDownloaded",
    },
    {
      name: "repository downloading",
      props: {
        hasRepoRemote: true,
        needsRepoConnect: true,
        isRepoConnecting: true,
      },
      titleKey: "collab.firstShared.repoStatus.downloading.title",
      ctaKey: "collab.firstShared.cta.downloading",
    },
    {
      name: "repository downloaded",
      props: { hasRepoRemote: true, needsRepoConnect: false },
      titleKey: "collab.firstShared.repoStatus.downloaded.title",
      ctaKey: null,
    },
  ] as const)(
    "renders the $name state with specific copy",
    ({ props, titleKey, ctaKey }) => {
      render(
        createElement(FirstSharedProjectModalView, {
          projectName: "Shared App",
          onClose: vi.fn(),
          onConnectRepo: vi.fn(),
          ...props,
        }),
      );

      expect(screen.getByText(ko[titleKey])).toBeTruthy();
      if (ctaKey) {
        expect(screen.getByText(ko[ctaKey])).toBeTruthy();
      } else {
        expect(
          screen.queryByText(ko["collab.firstShared.cta.notDownloaded"]),
        ).toBeNull();
        expect(
          screen.queryByText(ko["collab.firstShared.cta.noRepo"]),
        ).toBeNull();
      }
    },
  );
});
