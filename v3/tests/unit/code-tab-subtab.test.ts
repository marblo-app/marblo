/**
 * @vitest-environment jsdom
 *
 * CodeTab — 파일 그래프 서브탭에서 파일을 열면 에디터/미리보기로 돌아간다.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";

import type { OpenFile } from "../../src/stores/editorStore";
import { useEditorStore } from "../../src/stores/editorStore";

vi.mock("../../src/stores/projectStore", () => ({
  useProjectStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({ currentProject: null }),
  ),
}));

vi.mock("../../src/stores/worktreeStore", () => ({
  useWorktreeStore: vi.fn((selector: (state: unknown) => unknown) =>
    selector({
      worktrees: [],
      ensureFresh: vi.fn(async () => {}),
      archiveOverrides: {},
    }),
  ),
}));

vi.mock("../../src/hooks/useArchiveSignals", () => ({
  useArchiveSignals: () => ({
    doneTaskIds: new Set<string>(),
    busyTaskIds: new Set<string>(),
  }),
}));

vi.mock("../../src/components/code/DocGraphPanel", () => ({
  DocGraphPanel: ({ onDocumentOpened }: { onDocumentOpened?: () => void }) =>
    createElement(
      "div",
      { "data-testid": "doc-graph-panel" },
      createElement(
        "button",
        {
          type: "button",
          onClick: () => onDocumentOpened?.(),
        },
        "open graph doc",
      ),
    ),
}));

vi.mock("../../src/components/code/EditorTabs", () => ({
  EditorTabs: () => createElement("div", { "data-testid": "editor-tabs" }),
}));

vi.mock("../../src/components/code/WorktreeDiffBanner", () => ({
  WorktreeDiffBanner: () =>
    createElement("div", { "data-testid": "worktree-diff-banner" }),
}));

vi.mock("../../src/components/code/MarkdownPreview", () => ({
  MarkdownPreview: ({ filePath }: { filePath: string }) =>
    createElement("div", {
      "data-testid": "markdown-preview",
      "data-file-path": filePath,
    }),
}));

vi.mock("../../src/components/code/CodeEditor", () => ({
  CodeEditor: ({ filePath }: { filePath: string }) =>
    createElement("div", {
      "data-testid": "code-editor",
      "data-file-path": filePath,
    }),
}));

vi.mock("../../src/components/code/ImagePreview", () => ({
  ImagePreview: () => createElement("div", { "data-testid": "image-preview" }),
}));

vi.mock("../../src/components/code/NotebookView", () => ({
  NotebookView: () => createElement("div", { "data-testid": "notebook-view" }),
}));

vi.mock("../../src/components/workspace/DiffSurface", () => ({
  DiffSurface: () => createElement("div", { "data-testid": "diff-surface" }),
}));

const { CodeTab } = await import("../../src/components/tabs/CodeTab");

function markdownFile(path: string): OpenFile {
  return {
    path,
    name: path.split("/").pop() ?? path,
    content: "# Preview\n",
    originalContent: "# Preview\n",
    language: "markdown",
    isModified: false,
  };
}

beforeEach(() => {
  useEditorStore.setState({
    rootPath: "/tmp/project",
    openFiles: [markdownFile("/tmp/project/README.md")],
    activeFilePath: "/tmp/project/README.md",
    showDiff: false,
    saveError: null,
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  useEditorStore.setState({
    rootPath: null,
    openFiles: [],
    activeFilePath: null,
    showDiff: false,
    saveError: null,
  });
});

describe("CodeTab subtab switching", () => {
  it("keeps the graph visible when reveal-doc-graph does not change the active file", async () => {
    render(createElement(CodeTab));

    act(() => {
      window.dispatchEvent(new CustomEvent("marblo:reveal-doc-graph"));
    });

    expect(await screen.findByTestId("doc-graph-panel")).toBeTruthy();
    expect(screen.queryByTestId("markdown-preview")).toBeNull();
  });

  it("switches back to editor preview when a different Markdown file becomes active", async () => {
    render(createElement(CodeTab));

    act(() => {
      window.dispatchEvent(new CustomEvent("marblo:reveal-doc-graph"));
    });
    expect(await screen.findByTestId("doc-graph-panel")).toBeTruthy();

    act(() => {
      useEditorStore.setState({
        openFiles: [
          markdownFile("/tmp/project/README.md"),
          markdownFile("/tmp/project/notes.md"),
        ],
        activeFilePath: "/tmp/project/notes.md",
      });
    });

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeTruthy();
    });
    expect(
      screen.getByTestId("markdown-preview").getAttribute("data-file-path"),
    ).toBe("/tmp/project/notes.md");
    expect(screen.queryByTestId("doc-graph-panel")).toBeNull();
  });

  it("still lets graph node opens return directly to the editor subtab", async () => {
    render(createElement(CodeTab));

    act(() => {
      window.dispatchEvent(new CustomEvent("marblo:reveal-doc-graph"));
    });

    fireEvent.click(await screen.findByText("open graph doc"));

    await waitFor(() => {
      expect(screen.getByTestId("markdown-preview")).toBeTruthy();
    });
    expect(screen.queryByTestId("doc-graph-panel")).toBeNull();
  });
});
