/**
 * Office/한글(zip 계열) 본문 추출 (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * 실제 docx/pptx/xlsx/hwpx 는 "XML 이 든 zip" 이라, 그 구조 그대로 픽스처를
 * 조립해 검증한다. 검증 대상은 **우리가 만든 것**(어느 파트를 읽는가, 문단·
 * 슬라이드·셀을 어떻게 텍스트로 옮기는가, 빈 문서를 어떻게 드러내는가)이다.
 */
import { describe, it, expect } from "vitest";

import {
  columnIndexFromRef,
  decodeXmlEntities,
  extractOfficeText,
  extractXmlText,
  sheetXmlToCsv,
} from "../../electron/office-text-extract";
import {
  detectOfficeFormat,
  isOfficeDocument,
} from "../../electron/office-formats";
import { makeZip } from "./zip-fixture";

// ── 형식 판별 ──────────────────────────────────────────────────────────────

describe("detectOfficeFormat", () => {
  it("OOXML MIME 을 알아본다", () => {
    expect(
      detectOfficeFormat(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ),
    ).toBe("docx");
    expect(
      detectOfficeFormat(
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ),
    ).toBe("xlsx");
    expect(
      detectOfficeFormat(
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
      ),
    ).toBe("pptx");
  });

  it("MIME 이 octet-stream 이어도 확장자로 한글 파일을 알아본다", () => {
    // Drive 는 업로드 클라이언트가 준 MIME 을 그대로 보관한다 — 한글 파일은
    // 대개 octet-stream 으로 올라와 있어서 확장자가 유일한 단서다.
    expect(detectOfficeFormat("application/octet-stream", "보고서.hwp")).toBe(
      "hwp",
    );
    expect(detectOfficeFormat("application/octet-stream", "보고서.HWPX")).toBe(
      "hwpx",
    );
    expect(detectOfficeFormat("application/x-hwp", "이름없음")).toBe("hwp");
  });

  it("MIME 을 확장자보다 먼저 본다(`문서.hwp.pdf` 같은 이름에서 틀리지 않게)", () => {
    expect(detectOfficeFormat("application/pdf", "문서.hwp.pdf")).toBeNull();
  });

  it("지원하지 않는 형식은 null 이다", () => {
    expect(isOfficeDocument("image/png", "스캔.png")).toBe(false);
    expect(isOfficeDocument("application/msword", "옛날문서.doc")).toBe(false);
  });
});

// ── XML 텍스트 스캐너 ──────────────────────────────────────────────────────

describe("extractXmlText", () => {
  it("지정한 태그 안의 문자 데이터만 모은다(속성·다른 요소는 무시)", () => {
    const xml =
      '<w:p><w:pPr><w:pStyle w:val="제목"/></w:pPr><w:r><w:t>본문</w:t></w:r></w:p>';
    expect(extractXmlText(xml, { textTags: ["w:t"] })).toBe("본문");
  });

  it("XML 엔티티를 되돌린다", () => {
    expect(decodeXmlEntities("A&amp;B &lt;태그&gt; &#65; &#x42;")).toBe(
      "A&B <태그> A B",
    );
  });
});

// ── docx ──────────────────────────────────────────────────────────────────

const DOCX_XML = `<?xml version="1.0"?>
<w:document xmlns:w="x"><w:body>
<w:p><w:r><w:t xml:space="preserve">마블로 특허 </w:t><w:t>출원 명세서</w:t></w:r></w:p>
<w:p><w:r><w:t>발명의 명칭</w:t><w:tab/><w:t>AI 오케스트레이션</w:t></w:r></w:p>
<w:p><w:r><w:t>줄바꿈</w:t><w:br/><w:t>다음 줄</w:t></w:r></w:p>
</w:body></w:document>`;

function docxFixture(documentXml = DOCX_XML): Buffer {
  return makeZip([
    { name: "[Content_Types].xml", data: "<Types/>" },
    { name: "word/document.xml", data: documentXml },
  ]);
}

describe("extractOfficeText — docx", () => {
  it("문단·탭·줄바꿈을 살려 본문을 뽑는다", () => {
    const result = extractOfficeText(docxFixture(), "docx");
    expect(result.empty).toBe(false);
    expect(result.text).toContain("마블로 특허 출원 명세서");
    expect(result.text).toContain("발명의 명칭\tAI 오케스트레이션");
    expect(result.text).toContain("줄바꿈\n다음 줄");
  });

  it("각주도 함께 읽는다", () => {
    const zip = makeZip([
      { name: "word/document.xml", data: DOCX_XML },
      {
        name: "word/footnotes.xml",
        data: "<w:footnotes xmlns:w='x'><w:p><w:r><w:t>각주 내용</w:t></w:r></w:p></w:footnotes>",
      },
    ]);
    expect(extractOfficeText(zip, "docx").text).toContain("각주 내용");
  });

  it("이미지만 든 docx 는 조용히 비지 않고 'no-text' 로 이유를 남긴다", () => {
    const zip = makeZip([
      {
        name: "word/document.xml",
        data: "<w:document xmlns:w='x'><w:body><w:p><w:r><w:drawing/></w:r></w:p></w:body></w:document>",
      },
    ]);
    const result = extractOfficeText(zip, "docx");
    expect(result.empty).toBe(true);
    expect(result.reason).toBe("no-text");
    expect(result.detail).toBeTruthy();
  });

  it("zip 이 아니면 'unreadable' 이다(빈 본문으로 뭉개지 않는다)", () => {
    const result = extractOfficeText(Buffer.from("이건 zip 이 아니다"), "docx");
    expect(result.reason).toBe("unreadable");
  });

  it("97-2003(OLE) 파일이 .docx 로 둔갑해 있으면 그 사실을 말한다", () => {
    const ole = Buffer.alloc(600);
    Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(ole);
    const result = extractOfficeText(ole, "docx");
    expect(result.reason).toBe("unreadable");
    expect(result.detail).toContain("97-2003");
  });

  it("어떤 쓰레기 입력에도 throw 하지 않는다", () => {
    expect(() => extractOfficeText(Buffer.alloc(0), "docx")).not.toThrow();
    expect(() =>
      extractOfficeText(Buffer.from("PK\x03\x04깨진거"), "xlsx"),
    ).not.toThrow();
  });
});

// ── pptx ──────────────────────────────────────────────────────────────────

describe("extractOfficeText — pptx", () => {
  it("슬라이드를 번호순으로 이어 붙이고 슬라이드 번호를 남긴다", () => {
    const slide = (text: string) =>
      `<p:sld xmlns:a="x"><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sld>`;
    // 일부러 사전순과 번호순이 어긋나게 넣는다(slide10 < slide2 가 되는 함정).
    const zip = makeZip([
      { name: "ppt/slides/slide10.xml", data: slide("열째 장") },
      { name: "ppt/slides/slide2.xml", data: slide("둘째 장") },
      { name: "ppt/slides/slide1.xml", data: slide("첫째 장") },
    ]);
    const result = extractOfficeText(zip, "pptx");
    expect(result.text.indexOf("첫째 장")).toBeLessThan(
      result.text.indexOf("둘째 장"),
    );
    expect(result.text.indexOf("둘째 장")).toBeLessThan(
      result.text.indexOf("열째 장"),
    );
    expect(result.text).toContain("## 슬라이드 1");
  });
});

// ── xlsx ──────────────────────────────────────────────────────────────────

describe("sheetXmlToCsv", () => {
  it("sharedStrings 를 풀고, 빈 칸이 생략돼도 열 위치를 지킨다", () => {
    const xml = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c><c r="C1" t="s"><v>1</v></c></row>
      <row r="2"><c r="A2"><v>42</v></c></row>
    </sheetData></worksheet>`;
    expect(sheetXmlToCsv(xml, ["이름", "비고"])).toBe("이름,,비고\n42");
  });

  it("쉼표·따옴표가 든 값을 CSV 규칙대로 감싼다", () => {
    const xml = `<worksheet><sheetData><row r="1">
      <c r="A1" t="inlineStr"><is><t>가, 나</t></is></c>
      <c r="B1" t="inlineStr"><is><t>"인용"</t></is></c>
    </row></sheetData></worksheet>`;
    expect(sheetXmlToCsv(xml, [])).toBe('"가, 나","""인용"""');
  });

  it("완전히 빈 행은 건너뛴다", () => {
    const xml = `<worksheet><sheetData>
      <row r="1"><c r="A1" t="s"><v>0</v></c></row>
      <row r="2"><c r="A2"/></row>
    </sheetData></worksheet>`;
    expect(sheetXmlToCsv(xml, ["값"])).toBe("값");
  });
});

describe("columnIndexFromRef", () => {
  it("A1 → 0, C1 → 2, AA1 → 26", () => {
    expect(columnIndexFromRef("A1")).toBe(0);
    expect(columnIndexFromRef("C1")).toBe(2);
    expect(columnIndexFromRef("AA1")).toBe(26);
    expect(columnIndexFromRef("")).toBe(-1);
  });
});

describe("extractOfficeText — xlsx", () => {
  const sheet = (rows: string) =>
    `<worksheet><sheetData>${rows}</sheetData></worksheet>`;

  it("workbook 의 시트 이름·순서를 따라 시트별 CSV 를 만든다", () => {
    const zip = makeZip([
      {
        name: "xl/workbook.xml",
        data: `<workbook><sheets>
          <sheet name="매출" sheetId="1" r:id="rId1"/>
          <sheet name="비용" sheetId="2" r:id="rId2"/>
        </sheets></workbook>`,
      },
      {
        name: "xl/_rels/workbook.xml.rels",
        data: `<Relationships>
          <Relationship Id="rId1" Target="worksheets/sheet1.xml"/>
          <Relationship Id="rId2" Target="worksheets/sheet2.xml"/>
        </Relationships>`,
      },
      {
        name: "xl/sharedStrings.xml",
        data: "<sst><si><t>품목</t></si><si><t>사과</t></si></sst>",
      },
      {
        name: "xl/worksheets/sheet1.xml",
        data: sheet(
          '<row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>1500</v></c></row>',
        ),
      },
      {
        name: "xl/worksheets/sheet2.xml",
        data: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>임대료</t></is></c></row>',
        ),
      },
    ]);
    const result = extractOfficeText(zip, "xlsx");
    expect(result.empty).toBe(false);
    expect(result.text).toContain("## 매출");
    expect(result.text).toContain("품목");
    expect(result.text).toContain("사과,1500");
    expect(result.text).toContain("## 비용");
    expect(result.text).toContain("임대료");
  });

  it("workbook rels 가 없으면 worksheets 폴더를 번호순으로 훑는다", () => {
    const zip = makeZip([
      {
        name: "xl/worksheets/sheet1.xml",
        data: sheet(
          '<row r="1"><c r="A1" t="inlineStr"><is><t>대체 경로</t></is></c></row>',
        ),
      },
    ]);
    expect(extractOfficeText(zip, "xlsx").text).toContain("대체 경로");
  });
});

// ── hwpx ──────────────────────────────────────────────────────────────────

describe("extractOfficeText — hwpx", () => {
  it("Contents/sectionN.xml 의 문단을 순서대로 읽는다", () => {
    const zip = makeZip([
      { name: "mimetype", data: "application/hwp+zip", store: true },
      {
        name: "Contents/section0.xml",
        data: `<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>한글 문서 본문</hp:t></hp:run></hp:p>
               <hp:p><hp:run><hp:t>둘째 문단</hp:t></hp:run></hp:p></hs:sec>`,
      },
      {
        name: "Contents/section1.xml",
        data: `<hs:sec xmlns:hp="x"><hp:p><hp:run><hp:t>둘째 구역</hp:t></hp:run></hp:p></hs:sec>`,
      },
    ]);
    const result = extractOfficeText(zip, "hwpx");
    expect(result.empty).toBe(false);
    expect(result.text).toContain("한글 문서 본문");
    expect(result.text).toContain("둘째 문단");
    expect(result.text.indexOf("둘째 문단")).toBeLessThan(
      result.text.indexOf("둘째 구역"),
    );
  });

  it(".hwp 로 선언됐어도 실제로 zip 이면 HWPX 로 읽는다", () => {
    const zip = makeZip([
      {
        name: "Contents/section0.xml",
        data: "<hs:sec xmlns:hp='x'><hp:p><hp:t>확장자만 hwp</hp:t></hp:p></hs:sec>",
      },
    ]);
    expect(extractOfficeText(zip, "hwp").text).toContain("확장자만 hwp");
  });
});
