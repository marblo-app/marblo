import { describe, expect, it } from "vitest";
import {
  MAX_SNIPPET_LINES,
  annotateDiffLines,
  buildRangeFromLines,
  buildRangeFromSelection,
  formatDiffComment,
  formatRangeLabel,
} from "../../src/lib/diffComment";

const FILE_DIFF = [
  "diff --git a/src/a.ts b/src/a.ts",
  "index 1111111..2222222 100644",
  "--- a/src/a.ts",
  "+++ b/src/a.ts",
  "@@ -10,4 +10,5 @@ export function a() {",
  "   const x = 1;",
  "-  return x;",
  "+  const y = 2;",
  "+  return x + y;",
  " }",
];

describe("annotateDiffLines", () => {
  it("가 헌크 헤더에서 시작 줄번호를 잡고 컨텍스트/추가/삭제를 각 사이드로 센다", () => {
    const lines = annotateDiffLines(FILE_DIFF);

    // Headers before the first @@ carry no file line.
    expect(lines.slice(0, 5).every((l) => l.lineNo === null)).toBe(true);
    expect(lines[4]?.side).toBe("meta");

    expect(lines[5]).toMatchObject({ lineNo: 10, side: "new" }); // context
    expect(lines[6]).toMatchObject({ lineNo: 11, side: "old" }); // deletion
    expect(lines[7]).toMatchObject({ lineNo: 11, side: "new" }); // addition
    expect(lines[8]).toMatchObject({ lineNo: 12, side: "new" }); // addition
    expect(lines[9]).toMatchObject({ lineNo: 13, side: "new" }); // context
  });

  it("는 헌크 안의 '---' 를 헤더가 아니라 실제 삭제줄로 센다 (내용이 '--' 로 시작하는 코드)", () => {
    const lines = annotateDiffLines([
      "@@ -1,2 +1,1 @@",
      " keep",
      "--- a comment marker in source",
    ]);

    // The context line already consumed old line 1, so this is old line 2.
    expect(lines[2]).toMatchObject({ lineNo: 2, side: "old" });
  });

  it("는 'No newline' 마커와 빈 줄에 줄번호를 주지 않는다", () => {
    const lines = annotateDiffLines([
      "@@ -1,1 +1,1 @@",
      "+only line",
      "\\ No newline at end of file",
      "",
    ]);

    expect(lines[1]?.lineNo).toBe(1);
    expect(lines[2]?.lineNo).toBeNull();
    expect(lines[3]?.lineNo).toBeNull();
  });
});

describe("buildRangeFromSelection", () => {
  const lines = annotateDiffLines(FILE_DIFF);

  it("이 선택 범위의 실제 파일 줄번호와 diff 원문을 담는다", () => {
    const range = buildRangeFromSelection("src/a.ts", lines, 6, 8);

    // Selection spans a deletion + two additions. Numbering reports the NEW
    // side only (11-12) rather than mixing in the deletion's old-side 11.
    expect(range.startLine).toBe(11);
    expect(range.endLine).toBe(12);
    expect(range.snippet).toEqual([
      "-  return x;",
      "+  const y = 2;",
      "+  return x + y;",
    ]);
    expect(range.truncated).toBe(false);
  });

  it("은 역방향 드래그(끝→시작)도 같은 범위로 정규화한다", () => {
    expect(buildRangeFromSelection("src/a.ts", lines, 8, 6)).toEqual(
      buildRangeFromSelection("src/a.ts", lines, 6, 8),
    );
  });

  it("은 헤더만 선택하면 줄번호 없이 파일경로만 남긴다", () => {
    const range = buildRangeFromSelection("src/a.ts", lines, 0, 1);
    expect(range.startLine).toBeNull();
    expect(formatRangeLabel(range)).toBe("src/a.ts");
  });

  it("은 거대한 선택을 잘라내되 줄번호 범위는 전체 선택 기준으로 보고한다", () => {
    const many = annotateDiffLines([
      "@@ -1,100 +1,100 @@",
      ...Array.from({ length: 100 }, (_, i) => `+line ${i + 1}`),
    ]);
    const range = buildRangeFromSelection("src/big.ts", many, 1, 100);

    expect(range.truncated).toBe(true);
    expect(range.snippet).toHaveLength(MAX_SNIPPET_LINES);
    expect(range.startLine).toBe(1);
    expect(range.endLine).toBe(100);
  });

  it("은 범위를 벗어난 인덱스를 배열 경계로 클램프한다", () => {
    const range = buildRangeFromSelection("src/a.ts", lines, -5, 999);
    expect(range.snippet).toHaveLength(lines.length);
  });
});

describe("buildRangeFromLines (Monaco 경로)", () => {
  it("은 gutter 클릭(단일 줄)을 시작=끝 범위로 만든다", () => {
    const range = buildRangeFromLines("src/a.ts", 7, 7, (n) => `line ${n}`);

    expect(range).toMatchObject({ startLine: 7, endLine: 7, truncated: false });
    expect(range.snippet).toEqual(["line 7"]);
    expect(formatRangeLabel(range)).toBe("src/a.ts:7");
  });

  it("은 여러 줄 선택을 범위 라벨로 만든다", () => {
    const range = buildRangeFromLines("src/a.ts", 12, 9, (n) => `line ${n}`);

    expect(formatRangeLabel(range)).toBe("src/a.ts:9-12");
    expect(range.snippet).toHaveLength(4);
  });
});

describe("formatDiffComment", () => {
  it("는 파일경로·줄번호·코드본문을 코멘트에 함께 싣는다", () => {
    const lines = annotateDiffLines(FILE_DIFF);
    const range = buildRangeFromSelection("src/a.ts", lines, 7, 8);

    const message = formatDiffComment(range, "  이 부분 y 계산이 중복입니다  ");

    expect(message).toBe(
      [
        "[Code review] src/a.ts:11-12",
        "```diff",
        "+  const y = 2;",
        "+  return x + y;",
        "```",
        "",
        "이 부분 y 계산이 중복입니다",
      ].join("\n"),
    );
  });

  it("는 잘린 경우 그 사실을 명시한다", () => {
    const range = buildRangeFromLines("src/big.ts", 1, 100, () => "x");
    expect(formatDiffComment(range, "확인 바랍니다")).toContain(
      `snippet truncated to ${MAX_SNIPPET_LINES} lines`,
    );
  });

  it("는 스니펫이 없어도 코멘트 본문을 잃지 않는다", () => {
    const message = formatDiffComment(
      {
        filePath: "src/a.ts",
        startLine: null,
        endLine: null,
        snippet: [],
        truncated: false,
      },
      "파일 전체 얘기",
    );

    expect(message).toBe("[Code review] src/a.ts\n\n파일 전체 얘기");
  });
});

describe("범위 라벨의 사이드 일관성", () => {
  const lines = annotateDiffLines(FILE_DIFF);

  it("삭제만 선택하면 old 사이드 줄번호를 쓴다", () => {
    const range = buildRangeFromSelection("src/a.ts", lines, 6, 6);
    expect(formatRangeLabel(range)).toBe("src/a.ts:11");
  });

  it("삭제+추가가 섞이면 new 사이드만으로 라벨을 만든다 (사이드 혼합 금지)", () => {
    const range = buildRangeFromSelection("src/a.ts", lines, 5, 9);
    expect(formatRangeLabel(range)).toBe("src/a.ts:10-13");
  });
});
