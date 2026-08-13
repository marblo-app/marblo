/**
 * 의존성 없는 ZIP 리더 (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * 표준 zip 을 실제로 조립해 검증한다 — deflate/store 양쪽, 그리고 커넥터가 10MB
 * 상한으로 **잘라 온 zip**(중앙 디렉터리가 날아간 경우)까지.
 */
import { describe, it, expect } from "vitest";

import { looksLikeZip, openZip } from "../../electron/zip-archive";
import { makeZip } from "./zip-fixture";

describe("openZip", () => {
  it("deflate 엔트리와 store 엔트리를 모두 읽는다", () => {
    const zip = openZip(
      makeZip([
        { name: "a.txt", data: "압축된 본문" },
        { name: "b.txt", data: "무압축 본문", store: true },
      ]),
    );
    expect(zip?.readText("a.txt")).toBe("압축된 본문");
    expect(zip?.readText("b.txt")).toBe("무압축 본문");
  });

  it("엔트리 이름을 나열한다", () => {
    const zip = openZip(
      makeZip([
        { name: "word/document.xml", data: "<x/>" },
        { name: "docProps/app.xml", data: "<x/>" },
      ]),
    );
    expect(zip?.names()).toEqual(["word/document.xml", "docProps/app.xml"]);
  });

  it("없는 엔트리는 null 이다(throw 금지)", () => {
    const zip = openZip(makeZip([{ name: "a.txt", data: "x" }]));
    expect(zip?.read("nope.txt")).toBeNull();
  });

  it("zip 이 아니면 null 이고, 빈 버퍼에도 죽지 않는다", () => {
    expect(openZip(Buffer.from("%PDF-1.4"))).toBeNull();
    expect(openZip(Buffer.alloc(0))).toBeNull();
    expect(looksLikeZip(Buffer.from("PK", "latin1"))).toBe(true);
  });

  it("중앙 디렉터리가 잘려 나가도 앞쪽 엔트리는 로컬 헤더 스캔으로 읽는다", () => {
    // 커넥터의 10MB 상한에 걸린 zip 이 정확히 이 모양이다.
    const full = makeZip([
      { name: "word/document.xml", data: "잘리기 전 본문" },
      { name: "word/styles.xml", data: "스타일" },
    ]);
    const truncated = full.subarray(0, full.length - 80);
    const zip = openZip(truncated);
    expect(zip).not.toBeNull();
    expect(zip?.readText("word/document.xml")).toBe("잘리기 전 본문");
  });
});
