/**
 * @vitest-environment jsdom
 *
 * MarkdownPreview 링크 내비게이션 — 티켓 9XXzjqJzWVmTc6ASnETU.
 *
 * 버그: `a` 렌더러가 **모든** 링크에 target="_blank" 를 붙였다. 상대경로
 * 링크(`./other.md`)·앵커(`#section`)는 앱 origin(localhost)으로 해석돼
 * main 의 setWindowOpenHandler 에서 "내부 내비게이션" 으로 분류되고
 * action:"allow" → 라우트 없는 **빈 BrowserWindow** 가 뜬다.
 *
 * 계약:
 *  1) 저장소 안 문서 상대경로 → 기본동작 취소 + editorStore.openFile 로 앱 안에서 연다.
 *  2) 외부 http(s) → 종전대로 target="_blank"(=main 이 OS 브라우저로 넘김). 회귀 금지.
 *  3) 앵커 → 새 창이 아니라 문서 안 스크롤.
 *  4) 그 외(mailto:, 저장소 밖 경로 등) → 아무것도 안 한다. ★빈 창 금지.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { cleanup, render, screen } from "@testing-library/react";

// Monaco 를 테스트에 끌고 오지 않는다 — Edit 탭은 이 테스트의 관심사가 아니다.
vi.mock("../../src/components/code/CodeEditor", () => ({
  CodeEditor: () => createElement("div", { "data-testid": "code-editor" }),
}));

import { MarkdownPreview } from "../../src/components/code/MarkdownPreview";
import { useEditorStore } from "../../src/stores/editorStore";

const ROOT = "/repo";
const DOC = "/repo/docs/guide.md";

let openFile: ReturnType<typeof vi.fn>;

beforeEach(() => {
  openFile = vi.fn(async () => {});
  useEditorStore.setState({ rootPath: ROOT, openFile });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

function renderDoc(content: string) {
  return render(
    createElement(MarkdownPreview, {
      filePath: DOC,
      content,
      language: "markdown",
    }),
  );
}

/** 클릭 기본동작이 취소됐는지 = 새 창(빈 창)으로 가지 않았는지. */
function clickLink(name: string): boolean {
  const link = screen.getByRole("link", { name });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true });
  link.dispatchEvent(event);
  return event.defaultPrevented;
}

describe("MarkdownPreview 링크 내비게이션", () => {
  it("저장소 안 상대경로 링크는 새 창이 아니라 앱 안에서 연다", () => {
    renderDoc("[다른 문서](./other.md)");

    const link = screen.getByRole("link", { name: "다른 문서" });
    // ★빈 창 버그의 직접 원인 — 내부 링크에는 target="_blank" 가 없어야 한다.
    expect(link.getAttribute("target")).toBeNull();

    expect(clickLink("다른 문서")).toBe(true);
    expect(openFile).toHaveBeenCalledWith("/repo/docs/other.md");
  });

  it("상위 폴더 상대경로도 저장소 안이면 연다", () => {
    renderDoc("[루트 리드미](../README.md)");

    expect(clickLink("루트 리드미")).toBe(true);
    expect(openFile).toHaveBeenCalledWith("/repo/README.md");
  });

  it("외부 http(s) 링크는 종전대로 OS 브라우저로 간다(target=_blank 유지)", () => {
    renderDoc("[깃허브](https://github.com/melocream/marblo)");

    const link = screen.getByRole("link", { name: "깃허브" });
    expect(link.getAttribute("target")).toBe("_blank");
    expect(link.getAttribute("rel")).toContain("noopener");
    // 기본동작을 막지 않아야 main 의 setWindowOpenHandler 가 shell.openExternal 로 넘긴다.
    expect(clickLink("깃허브")).toBe(false);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("앵커 링크는 새 탭이 아니라 문서 안 스크롤이다", () => {
    const scrollIntoView = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: scrollIntoView,
    });

    renderDoc("## 설치 방법\n\n[설치로](#설치-방법)");

    expect(screen.getByRole("heading", { name: "설치 방법" }).id).toBe(
      "설치-방법",
    );
    expect(clickLink("설치로")).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
    expect(scrollIntoView).toHaveBeenCalled();
  });

  it("저장소 밖으로 탈출하는 상대경로는 아무것도 열지 않는다", () => {
    renderDoc("[탈출](../../../etc/passwd)");

    expect(clickLink("탈출")).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
  });

  it("mailto: 같은 그 외 스킴은 아무것도 하지 않는다(빈 창 금지)", () => {
    renderDoc("[메일](mailto:ceo@hypemarc.com)");

    const link = screen.getByRole("link", { name: "메일" });
    expect(link.getAttribute("target")).toBeNull();
    expect(clickLink("메일")).toBe(true);
    expect(openFile).not.toHaveBeenCalled();
  });
});
