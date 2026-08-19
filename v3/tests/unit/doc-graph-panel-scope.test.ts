/**
 * @vitest-environment jsdom
 *
 * DocGraphPanel — 폴더 스코프 드롭다운: 선택 시 필터된 sources 만 뷰에 전달.
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

import { useLocaleStore } from "../../src/lib/i18n";
import { ko } from "../../src/locales/ko";
import { useEditorStore } from "../../src/stores/editorStore";

vi.mock("../../src/components/code/DocGraphView", () => ({
  DocGraphView: ({ sources }: { sources: Array<{ path: string }> }) =>
    createElement("div", {
      "data-testid": "doc-graph-view-stub",
      "data-source-count": String(sources.length),
      "data-source-paths": sources.map((s) => s.path).sort().join("|"),
    }),
}));

const { DocGraphPanel } = await import(
  "../../src/components/code/DocGraphPanel"
);

const ROOT = "/tmp/doc-graph-scope-test";
const SCOPE_STORAGE_KEY = "marblo.docGraph.folderScope";

function installMemoryStorage(): Map<string, string> {
  const map = new Map<string, string>();
  Object.defineProperty(window, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => map.get(key) ?? null,
      setItem: (key: string, value: string) => {
        map.set(key, value);
      },
      removeItem: (key: string) => {
        map.delete(key);
      },
    },
  });
  return map;
}

function installFsTree() {
  const tree = [
    {
      name: "docs",
      path: `${ROOT}/docs`,
      type: "directory",
      children: [
        { name: "guide.md", path: `${ROOT}/docs/guide.md`, type: "file" },
        { name: "api.md", path: `${ROOT}/docs/api.md`, type: "file" },
      ],
    },
    {
      name: "lectures",
      path: `${ROOT}/lectures`,
      type: "directory",
      children: [
        {
          name: "intro.md",
          path: `${ROOT}/lectures/intro.md`,
          type: "file",
        },
      ],
    },
    { name: "README.md", path: `${ROOT}/README.md`, type: "file" },
  ];
  const files: Record<string, string> = {
    "docs/guide.md": "See [[docs/api]] and [[README]].\n",
    "docs/api.md": "Back [[docs/guide]].\n",
    "lectures/intro.md": "Hi\n",
    "README.md": "Root\n",
  };
  const api = {
    readTree: vi.fn(async () => tree),
    readFile: vi.fn(async (_root: string, absPath: string) => {
      const rel = absPath.replace(`${ROOT}/`, "");
      const content = files[rel];
      if (content === undefined) throw new Error(`missing ${rel}`);
      return content;
    }),
  };
  (
    globalThis as unknown as { window: { electronAPI: unknown } }
  ).window.electronAPI = { fs: api };
  return api;
}

let storage: Map<string, string>;

beforeEach(() => {
  storage = installMemoryStorage();
  useLocaleStore.setState({ locale: "ko" });
  useEditorStore.setState({
    rootPath: ROOT,
    openFiles: [],
    activeFilePath: null,
    showDiff: false,
    saveError: null,
  });
});

afterEach(() => {
  cleanup();
  storage.clear();
  useEditorStore.setState({ rootPath: null });
});

describe("DocGraphPanel — folder scope", () => {
  it("기본은 전체, docs 선택 시 docs 아래만 뷰에 전달", async () => {
    installFsTree();
    render(createElement(DocGraphPanel));

    const select = (await screen.findByTestId(
      "doc-graph-scope-select",
    )) as HTMLSelectElement;
    expect(select.value).toBe("");

    await waitFor(() => {
      const stub = screen.getByTestId("doc-graph-view-stub");
      expect(stub.getAttribute("data-source-count")).toBe("4");
    });

    fireEvent.change(select, { target: { value: "docs" } });

    await waitFor(() => {
      const stub = screen.getByTestId("doc-graph-view-stub");
      expect(stub.getAttribute("data-source-paths")).toBe(
        "docs/api.md|docs/guide.md",
      );
    });

    expect(storage.get(SCOPE_STORAGE_KEY)).toBe("docs");
    expect(screen.getByTestId("doc-graph-external-select")).toBeTruthy();
    expect(
      Array.from(select.options).some(
        (o) => o.textContent === ko["code.docGraph.scope.all"],
      ),
    ).toBe(true);
  });

  it("boundary 모드면 스코프 밖 링크 대상을 함께 전달", async () => {
    installFsTree();
    render(createElement(DocGraphPanel));

    const scope = await screen.findByTestId("doc-graph-scope-select");
    await waitFor(() => {
      expect(screen.getByTestId("doc-graph-view-stub")).toBeTruthy();
    });

    fireEvent.change(scope, { target: { value: "docs" } });
    const external = await screen.findByTestId("doc-graph-external-select");
    fireEvent.change(external, { target: { value: "boundary" } });

    await waitFor(() => {
      const stub = screen.getByTestId("doc-graph-view-stub");
      const paths = stub.getAttribute("data-source-paths") ?? "";
      expect(paths.split("|").sort()).toEqual(
        ["README.md", "docs/api.md", "docs/guide.md"].sort(),
      );
    });
  });
});
