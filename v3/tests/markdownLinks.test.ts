/**
 * resolveMarkdownLinkTarget — 마크다운 링크 갈래 판정(순수). 티켓 9XXzjqJzWVmTc6ASnETU.
 *
 * ★핵심 계약: 저장소 밖을 가리키는 경로는 **열지 않는다**. 조용히 루트로
 * 클램프하지도 않는다(그러면 엉뚱한 파일이 열린다).
 */
import { describe, expect, it } from "vitest";
import {
  resolveInsideRoot,
  resolveMarkdownLinkTarget,
  slugifyHeading,
} from "../src/lib/markdownLinks";

const CTX = { rootPath: "/repo", filePath: "/repo/docs/guide.md" };

describe("resolveMarkdownLinkTarget — 저장소 안 문서 경로", () => {
  it("같은 폴더 상대경로를 절대 경로로 해석한다", () => {
    expect(resolveMarkdownLinkTarget("./other.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/other.md",
    });
    expect(resolveMarkdownLinkTarget("other.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/other.md",
    });
  });

  it("하위·상위 폴더를 넘나드는 상대경로를 해석한다", () => {
    expect(resolveMarkdownLinkTarget("sub/deep.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/sub/deep.md",
    });
    expect(resolveMarkdownLinkTarget("../README.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/README.md",
    });
    expect(resolveMarkdownLinkTarget("../src/lib/x.ts", CTX)).toEqual({
      kind: "file",
      path: "/repo/src/lib/x.ts",
    });
  });

  it("`/` 로 시작하면 프로젝트 루트 상대다", () => {
    expect(resolveMarkdownLinkTarget("/docs/api.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/api.md",
    });
  });

  it("퍼센트 인코딩·프래그먼트·쿼리를 떼고 경로만 쓴다", () => {
    expect(resolveMarkdownLinkTarget("./my%20doc.md", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/my doc.md",
    });
    expect(resolveMarkdownLinkTarget("./other.md#설치", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/other.md",
    });
    expect(resolveMarkdownLinkTarget("./other.md?v=2", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/other.md",
    });
  });

  it("문서가 아닌 파일(이미지·코드)도 특별취급 없이 그냥 연다", () => {
    expect(resolveMarkdownLinkTarget("./img/shot.png", CTX)).toEqual({
      kind: "file",
      path: "/repo/docs/img/shot.png",
    });
  });

  it("윈도 스타일 루트에서도 루트의 구분자를 유지한다", () => {
    expect(
      resolveMarkdownLinkTarget("./other.md", {
        rootPath: "C:\\proj",
        filePath: "C:\\proj\\docs\\guide.md",
      }),
    ).toEqual({ kind: "file", path: "C:\\proj\\docs\\other.md" });
  });
});

describe("resolveMarkdownLinkTarget — ★경로 탈출 차단", () => {
  it("루트 위로 올라가는 경로는 거절한다(클램프하지 않는다)", () => {
    for (const href of [
      "../../../etc/passwd",
      "../../etc/passwd",
      "./../../../../root/.ssh/id_rsa",
      "../..",
      "sub/../../../outside.md",
    ]) {
      expect(resolveMarkdownLinkTarget(href, CTX)).toEqual({
        kind: "ignore",
        reason: "outside-root",
      });
    }
  });

  it("루트 상대(`/..`)로도 탈출할 수 없다", () => {
    expect(resolveMarkdownLinkTarget("/../../etc/passwd", CTX)).toEqual({
      kind: "ignore",
      reason: "outside-root",
    });
  });

  it("인코딩으로 우회해도 막힌다(%2e%2e)", () => {
    expect(
      resolveMarkdownLinkTarget("%2e%2e/%2e%2e/%2e%2e/etc/passwd", CTX),
    ).toEqual({ kind: "ignore", reason: "outside-root" });
  });

  it("현재 문서가 루트 밖이면 기준점이 없으므로 열지 않는다", () => {
    expect(
      resolveMarkdownLinkTarget("./other.md", {
        rootPath: "/repo",
        filePath: "/somewhere/else/guide.md",
      }),
    ).toEqual({ kind: "ignore", reason: "outside-root" });
  });

  it("탈출 후 루트 안으로 되돌아오는 경로도 루트 밖을 거친 순간 거절한다", () => {
    expect(resolveMarkdownLinkTarget("../../repo/docs/other.md", CTX)).toEqual({
      kind: "ignore",
      reason: "outside-root",
    });
  });
});

describe("resolveMarkdownLinkTarget — 외부·앵커·그 외", () => {
  it("http(s) 는 외부다(종전대로 OS 브라우저)", () => {
    expect(resolveMarkdownLinkTarget("https://example.com/a", CTX)).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
    expect(resolveMarkdownLinkTarget("http://example.com", CTX)).toEqual({
      kind: "external",
      url: "http://example.com",
    });
    expect(resolveMarkdownLinkTarget("//example.com/a", CTX)).toEqual({
      kind: "external",
      url: "https://example.com/a",
    });
  });

  it("순수 `#` 은 앵커다", () => {
    expect(resolveMarkdownLinkTarget("#설치-방법", CTX)).toEqual({
      kind: "anchor",
      anchor: "설치-방법",
    });
    expect(resolveMarkdownLinkTarget("#%EC%84%A4%EC%B9%98", CTX)).toEqual({
      kind: "anchor",
      anchor: "설치",
    });
  });

  it("그 외 스킴은 아무것도 하지 않는다 — ★빈 창 금지", () => {
    for (const href of [
      "mailto:ceo@hypemarc.com",
      "javascript:alert(1)",
      "data:text/html,<script>",
      "file:///etc/passwd",
      "vscode://open",
      "C:\\Windows\\System32\\drivers\\etc\\hosts",
    ]) {
      expect(resolveMarkdownLinkTarget(href, CTX)).toEqual({
        kind: "ignore",
        reason: "unsupported-scheme",
      });
    }
  });

  it("빈 href·문서 컨텍스트 없음은 아무것도 하지 않는다", () => {
    expect(resolveMarkdownLinkTarget("", CTX).kind).toBe("ignore");
    expect(resolveMarkdownLinkTarget(undefined, CTX).kind).toBe("ignore");
    expect(resolveMarkdownLinkTarget("#", CTX).kind).toBe("ignore");
    // 노트북 셀처럼 소속 문서를 모르는 경우
    expect(
      resolveMarkdownLinkTarget("./other.md", {
        rootPath: "/repo",
        filePath: null,
      }),
    ).toEqual({ kind: "ignore", reason: "no-context" });
    expect(
      resolveMarkdownLinkTarget("./other.md", {
        rootPath: null,
        filePath: "/repo/docs/guide.md",
      }),
    ).toEqual({ kind: "ignore", reason: "no-context" });
  });
});

describe("resolveInsideRoot", () => {
  it("루트 안이면 정규화된 상대 경로를, 벗어나면 null 을 준다", () => {
    expect(resolveInsideRoot("docs", "./a/../b.md")).toBe("docs/b.md");
    expect(resolveInsideRoot("docs", "../b.md")).toBe("b.md");
    expect(resolveInsideRoot("docs", "../../b.md")).toBeNull();
    expect(resolveInsideRoot("", "../b.md")).toBeNull();
    expect(resolveInsideRoot("", "a//b.md")).toBe("a/b.md");
  });
});

describe("slugifyHeading", () => {
  it("헤딩 텍스트를 앵커 id 로 만든다", () => {
    expect(slugifyHeading("Getting Started")).toBe("getting-started");
    expect(slugifyHeading("설치 방법")).toBe("설치-방법");
    expect(slugifyHeading("API: `openFile()` 사용법!")).toBe(
      "api-openfile-사용법",
    );
    expect(slugifyHeading("  다중   공백  ")).toBe("다중-공백");
  });
});
