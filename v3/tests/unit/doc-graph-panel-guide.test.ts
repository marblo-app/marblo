/**
 * @vitest-environment jsdom
 *
 * DocGraphPanel — 파일 그래프 사용법 접힘 가이드 + 링크 0 안내.
 * ConnectorGuidePanel(#939) 패턴: 기본 접힘·기억, 토글 시 단계 노출.
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
import { en } from "../../src/locales/en";
import { useEditorStore } from "../../src/stores/editorStore";

vi.mock("../../src/components/code/DocGraphView", () => ({
  DocGraphView: ({ sources }: { sources: unknown[] }) =>
    createElement("div", {
      "data-testid": "doc-graph-view-stub",
      "data-source-count": String(sources.length),
    }),
}));

const { DocGraphPanel } = await import(
  "../../src/components/code/DocGraphPanel"
);

const ROOT = "/tmp/doc-graph-guide-test";
const GUIDE_STORAGE_KEY = "marblo.docGraph.guide.open";

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

function installFsStub(files: Record<string, string>) {
  const tree = Object.keys(files).map((rel) => ({
    name: rel.split("/").pop()!,
    path: `${ROOT}/${rel}`,
    type: "file",
  }));
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

describe("DocGraphPanel — 사용법 가이드", () => {
  it("기본값은 접힘이고, 토글하면 4단계+옵시디언 차이 안내가 펼쳐진다", async () => {
    installFsStub({ "notes.md": "# hi\n" });
    render(createElement(DocGraphPanel));

    const toggle = await screen.findByText(ko["code.docGraph.guide.toggle"]);
    const toggleButton = toggle.closest("button") as HTMLButtonElement;
    expect(toggleButton.getAttribute("aria-expanded")).toBe("false");
    expect(document.body.textContent ?? "").not.toContain(
      ko["code.docGraph.guide.step2"],
    );

    fireEvent.click(toggleButton);
    expect(toggleButton.getAttribute("aria-expanded")).toBe("true");
    const body = document.body.textContent ?? "";
    expect(body).toContain(ko["code.docGraph.guide.step1"]);
    expect(body).toContain(ko["code.docGraph.guide.step2"]);
    expect(body).toContain(ko["code.docGraph.guide.step3"]);
    expect(body).toContain(ko["code.docGraph.guide.step4"]);
    expect(body).toContain(ko["code.docGraph.guide.diff"]);
    expect(storage.get(GUIDE_STORAGE_KEY)).toBe("1");
  });

  it("문서에 링크가 없으면 noLinksHint 를 보여준다", async () => {
    installFsStub({
      "a.md": "# A\nno links here\n",
      "b.md": "# B\nalso alone\n",
    });
    render(createElement(DocGraphPanel));

    await waitFor(() => {
      expect(screen.getByTestId("doc-graph-no-links-hint").textContent).toBe(
        ko["code.docGraph.noLinksHint"],
      );
    });
  });

  it("문서에 링크가 있으면 noLinksHint 를 숨긴다", async () => {
    installFsStub({
      "a.md": "See [[b]]\n",
      "b.md": "# B\n",
    });
    render(createElement(DocGraphPanel));

    await waitFor(() => {
      expect(screen.getByTestId("doc-graph-view-stub")).toBeTruthy();
    });
    expect(screen.queryByTestId("doc-graph-no-links-hint")).toBeNull();
  });

  it("en 로케일에서도 가이드 토글 라벨이 나온다", async () => {
    useLocaleStore.setState({ locale: "en" });
    installFsStub({ "notes.md": "# hi\n" });
    render(createElement(DocGraphPanel));

    expect(
      await screen.findByText(en["code.docGraph.guide.toggle"]),
    ).toBeTruthy();
  });
});
