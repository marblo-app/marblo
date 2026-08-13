/**
 * Office/한글 문서 **형식 판별**만 하는 순수 모듈 (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * ── 왜 추출기와 분리했나 ────────────────────────────────────────────────────
 * google-drive-connector.ts 는 "electron 도, zlib 도 임포트하지 않는다" 는 규율을
 * 갖고 있고(파일 상단 설계 규율 2), 실제 추출은 주입(`extractOfficeText`)으로
 * 받는다. 그런데 커넥터는 **바이트를 받기 전에** "이 파일이 텍스트로 바꿀 수 있는
 * 형식인가" 를 알아야 한다(이미지를 10MB 씩 받아오지 않기 위해). 그 판별은
 * MIME/확장자 표만 있으면 되는 순수 함수라, zlib 을 끌고 오는 추출기에서 떼어
 * 여기에 뒀다. 커넥터는 이 파일만 직접 임포트한다.
 */

/** 우리가 본문을 뽑을 수 있는 문서 형식. */
export type OfficeFormat = "docx" | "pptx" | "xlsx" | "hwpx" | "hwp";

/** MIME → 형식. 소문자 base MIME 기준. */
const MIME_TO_FORMAT: Record<string, OfficeFormat> = {
  // OOXML (zip)
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document":
    "docx",
  "application/vnd.ms-word.document.macroenabled.12": "docx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation":
    "pptx",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow":
    "pptx",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "pptx",
  "application/vnd.ms-powerpoint.slideshow.macroenabled.12": "pptx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.ms-excel.sheet.macroenabled.12": "xlsx",
  // 한글(HWPX = zip, HWP5 = OLE 복합문서)
  "application/hwp+zip": "hwpx",
  "application/vnd.hancom.hwpx": "hwpx",
  "application/haansofthwpx": "hwpx",
  "application/x-hwpx": "hwpx",
  "application/x-hwp": "hwp",
  "application/hwp": "hwp",
  "application/haansofthwp": "hwp",
  "application/vnd.hancom.hwp": "hwp",
};

/** 확장자 → 형식. MIME 이 octet-stream 으로 오는 경우(한글 파일이 특히 잦다). */
const EXT_TO_FORMAT: Record<string, OfficeFormat> = {
  docx: "docx",
  docm: "docx",
  pptx: "pptx",
  pptm: "pptx",
  ppsx: "pptx",
  xlsx: "xlsx",
  xlsm: "xlsx",
  hwpx: "hwpx",
  hwp: "hwp",
};

/** `application/pdf; charset=x` 같은 파라미터를 떼고 소문자화. */
function baseMime(mimeType: string): string {
  return mimeType.split(";")[0].trim().toLowerCase();
}

/** 파일명에서 확장자만(소문자, 점 제외). 없으면 빈 문자열. */
function extensionOf(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  if (dot <= 0 || dot === fileName.length - 1) return "";
  return fileName.slice(dot + 1).toLowerCase();
}

/**
 * MIME(우선) → 확장자(차선) 순으로 형식을 판별한다. 둘 다 모르면 null.
 *
 * 확장자를 차선으로 두는 이유: Drive 는 업로드 클라이언트가 준 MIME 을 그대로
 * 보관해서 한글 파일이 `application/octet-stream` 으로 올라와 있는 일이 흔하다.
 * 반대로 확장자를 먼저 보면 `보고서.hwp.pdf` 같은 이름에서 틀린다.
 */
export function detectOfficeFormat(
  mimeType: string,
  fileName = "",
): OfficeFormat | null {
  const byMime = MIME_TO_FORMAT[baseMime(mimeType)];
  if (byMime) return byMime;
  return EXT_TO_FORMAT[extensionOf(fileName)] ?? null;
}

/** 본문 추출을 시도해 볼 만한 Office/한글 파일인가. */
export function isOfficeDocument(mimeType: string, fileName = ""): boolean {
  return detectOfficeFormat(mimeType, fileName) !== null;
}

/** 사람이 읽는 형식 이름 — 사용자 메시지에 쓴다. */
export const OFFICE_FORMAT_LABEL: Record<OfficeFormat, string> = {
  docx: "Word(.docx)",
  pptx: "PowerPoint(.pptx)",
  xlsx: "Excel(.xlsx)",
  hwpx: "한글(.hwpx)",
  hwp: "한글(.hwp)",
};
