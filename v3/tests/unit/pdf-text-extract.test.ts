/**
 * 의존성 없는 PDF 텍스트 추출기 (티켓 zqNxS9904aeeBEug1uAD).
 *
 * 실제 PDF 바이트를 조립해 검증한다 — 무압축 스트림과 FlateDecode 스트림 양쪽,
 * 그리고 "텍스트 레이어가 없다" 를 정직하게 보고하는 경로까지.
 */
import { describe, it, expect } from "vitest";
import zlib from "node:zlib";
import {
  extractPdfText,
  extractTextFromContentStream,
} from "../../electron/pdf-text-extract";

/** 콘텐츠 스트림 하나를 담은 최소 PDF 바이트. */
function pdfWith(streams: Buffer[]): Buffer {
  const parts: Buffer[] = [Buffer.from("%PDF-1.4\n")];
  for (const s of streams) {
    parts.push(
      Buffer.from(`1 0 obj\n<< /Length ${s.length} >>\nstream\n`),
      s,
      Buffer.from("\nendstream\nendobj\n"),
    );
  }
  parts.push(Buffer.from("%%EOF"));
  return Buffer.concat(parts);
}

describe("extractTextFromContentStream", () => {
  it("Tj 문자열을 뽑는다", () => {
    expect(
      extractTextFromContentStream("BT /F1 12 Tf (Hello world) Tj ET"),
    ).toContain("Hello world");
  });

  it("TJ 배열의 조각을 이어 붙이고, 큰 음수 커닝은 공백으로 근사한다", () => {
    const text = extractTextFromContentStream("[(Hello)-400(world)] TJ");
    expect(text).toBe("Hello world");
  });

  it("작은 커닝값은 공백을 만들지 않는다(단어 내부 자간)", () => {
    expect(extractTextFromContentStream("[(He)-20(llo)] TJ")).toBe("Hello");
  });

  it("Td/T* 같은 줄 이동은 줄바꿈으로 근사한다", () => {
    const text = extractTextFromContentStream(
      "BT (첫 줄) Tj 0 -14 Td (둘째 줄) Tj ET",
    );
    expect(text.split("\n").map((l) => l.trim())).toContain("첫 줄");
    expect(text).toContain("둘째 줄");
  });

  it("literal string 의 이스케이프를 푼다", () => {
    expect(extractTextFromContentStream("(a\\(b\\)c) Tj")).toBe("a(b)c");
    expect(extractTextFromContentStream("(tab\\there) Tj")).toBe("tab\there");
    // 8진 이스케이프 (\101 = 'A')
    expect(extractTextFromContentStream("(\\101BC) Tj")).toBe("ABC");
  });

  it("hex string 을 디코드한다", () => {
    // "Hi" = 0x48 0x69
    expect(extractTextFromContentStream("<4869> Tj")).toBe("Hi");
  });

  it("BOM 있는 UTF-16BE hex string 을 디코드한다", () => {
    // FEFF + "OK" as UTF-16BE
    expect(extractTextFromContentStream("<FEFF004F004B> Tj")).toBe("OK");
  });

  it("텍스트 연산자가 없으면 빈 문자열이다", () => {
    expect(extractTextFromContentStream("q 1 0 0 1 0 0 cm /Im1 Do Q")).toBe("");
  });
});

describe("extractPdfText", () => {
  it("무압축 콘텐츠 스트림에서 본문을 뽑는다", () => {
    const pdf = pdfWith([Buffer.from("BT (본문 텍스트) Tj ET")]);
    const result = extractPdfText(pdf);
    expect(result.empty).toBe(false);
    expect(result.text).toContain("본문 텍스트");
  });

  it("FlateDecode 로 압축된 스트림도 푼다", () => {
    const pdf = pdfWith([
      zlib.deflateSync(Buffer.from("BT (압축된 본문) Tj ET")),
    ]);
    const result = extractPdfText(pdf);
    expect(result.empty).toBe(false);
    expect(result.text).toContain("압축된 본문");
  });

  it("여러 스트림(페이지)을 모두 모은다", () => {
    const pdf = pdfWith([
      Buffer.from("BT (첫 페이지) Tj ET"),
      zlib.deflateSync(Buffer.from("BT (둘째 페이지) Tj ET")),
    ]);
    const result = extractPdfText(pdf);
    expect(result.text).toContain("첫 페이지");
    expect(result.text).toContain("둘째 페이지");
  });

  it("텍스트 레이어가 없는 PDF(스캔본)는 empty=true 로 정직하게 보고한다", () => {
    // 이미지만 그리는 콘텐츠 스트림 — 텍스트 연산자가 없다.
    const pdf = pdfWith([Buffer.from("q 612 0 0 792 0 0 cm /Im0 Do Q")]);
    const result = extractPdfText(pdf);
    expect(result.empty).toBe(true);
    expect(result.text).toBe("");
  });

  it("PDF 가 아닌/깨진 바이트에도 throw 하지 않는다", () => {
    expect(() => extractPdfText(Buffer.from("not a pdf at all"))).not.toThrow();
    expect(extractPdfText(Buffer.from("not a pdf at all")).empty).toBe(true);
    expect(extractPdfText(Buffer.alloc(0)).empty).toBe(true);
  });

  it("깨진 Flate 스트림 하나가 나머지 페이지를 못 삼킨다", () => {
    const broken = Buffer.concat([
      Buffer.from([0x78, 0x9c]),
      Buffer.from("garbage-not-deflate"),
    ]);
    const pdf = pdfWith([broken, Buffer.from("BT (살아남은 본문) Tj ET")]);
    expect(extractPdfText(pdf).text).toContain("살아남은 본문");
  });

  it("endstream 을 stream 으로 오인하지 않는다", () => {
    const pdf = pdfWith([Buffer.from("BT (경계 검사) Tj ET")]);
    const result = extractPdfText(pdf);
    expect(result.text).toBe("경계 검사");
  });
});
