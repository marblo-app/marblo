/**
 * 의존성 없는 Office/한글 문서 텍스트 추출기 (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * ── 왜 필요한가 ──────────────────────────────────────────────────────────
 * Drive 위키가 전부 Office 업로드본(.docx/.xlsx)이거나 한글 파일이라, 커넥터가
 * "텍스트로 변환할 수 없는 형식" 으로 되돌려 보내면 검색만 되고 읽기가 안 된다.
 *
 * ── 무엇을 하고 무엇을 못 하나 (정직한 한계) ─────────────────────────────
 *  ✔ docx  : word/document.xml 의 <w:t> 텍스트. 문단/줄바꿈/탭을 근사 복원.
 *  ✔ pptx  : ppt/slides/slideN.xml 의 <a:t> 텍스트를 슬라이드 순서대로.
 *  ✔ xlsx  : sharedStrings + 각 시트를 CSV 로. 시트 이름/순서는 workbook.xml.
 *  ✔ hwpx  : Contents/sectionN.xml 의 <hp:t> 텍스트.
 *  ✔ hwp   : HWP5(OLE) best-effort — hwp5-text-extract.ts 참고.
 *  ✘ 서식·표 구조·이미지·차트 데이터는 복원하지 않는다(본문 텍스트만).
 *  ✘ 스캔 이미지만 든 문서는 빈 결과다 — 호출자는 `reason` 으로 그 사실을
 *    사용자에게 드러내야 한다. 조용히 "본문 없음" 으로 넘기지 말 것.
 */
import { extractHwp5Text } from "./hwp5-text-extract";
import type { OfficeFormat } from "./office-formats";
import { looksLikeZip, openZip, type ZipArchive } from "./zip-archive";

export interface OfficeTextResult {
  text: string;
  /** 본문이 비었다(= 쓸 만한 텍스트가 없다). */
  empty: boolean;
  /**
   * 왜 비었는가.
   *  - `no-text`    : 파일은 정상적으로 열렸는데 텍스트가 없다(이미지/스캔본).
   *  - `unreadable` : 컨테이너를 열지 못했다(손상·암호·잘림·미지원 하위형식).
   */
  reason?: "no-text" | "unreadable";
  /** 사용자에게 보여줄 짧은 설명(선택). */
  detail?: string;
}

// ── XML 텍스트 뽑기 ───────────────────────────────────────────────────────

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
};

/** `&amp;` `&#10;` `&#x41;` 를 되돌린다. 모르는 엔티티는 그대로 둔다. */
export function decodeXmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body.startsWith("#x") || body.startsWith("#X")) {
        const code = parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (body.startsWith("#")) {
        const code = parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

interface XmlTextRules {
  /** 이 태그 **안의** 문자 데이터만 본문으로 삼는다(예: w:t, a:t, hp:t). */
  textTags: string[];
  /** 닫힐 때 줄바꿈을 넣는 태그(문단). */
  paragraphTags?: string[];
  /** 나올 때 줄바꿈을 넣는 태그(강제 개행). */
  breakTags?: string[];
  /** 나올 때 탭을 넣는 태그. */
  tabTags?: string[];
}

/** `<w:t xml:space="preserve">` → `w:t`. 닫는 태그·자체닫음도 같은 이름. */
function tagNameOf(tag: string): string {
  const match = /^<\/?\s*([^\s/>]+)/.exec(tag);
  return match ? match[1] : "";
}

/**
 * XML 을 태그 단위로 훑어 본문 텍스트를 만든다.
 *
 * 파서를 쓰지 않는 이유는 zip 리더와 같다 — 우리가 필요한 건 "특정 태그 안의
 * 문자 데이터" 뿐이고, OOXML/HWPX 는 잘 정형화된 기계 생성 XML 이라 토큰 스캔으로
 * 충분하다. 대신 **태그 안에 있을 때만** 텍스트를 모아서, 속성값이나 다른
 * 요소의 문자 데이터가 본문에 섞이지 않게 한다.
 */
export function extractXmlText(xml: string, rules: XmlTextRules): string {
  const textTags = new Set(rules.textTags);
  const paragraphTags = new Set(rules.paragraphTags ?? []);
  const breakTags = new Set(rules.breakTags ?? []);
  const tabTags = new Set(rules.tabTags ?? []);

  let out = "";
  let depth = 0; // textTag 안에 있는 깊이
  const tokenRe = /<[^>]*>|[^<]+/g;
  let match: RegExpExecArray | null;
  while ((match = tokenRe.exec(xml)) !== null) {
    const token = match[0];
    if (token[0] !== "<") {
      if (depth > 0) out += decodeXmlEntities(token);
      continue;
    }
    // 주석·CDATA·선언은 무시한다.
    if (token.startsWith("<!") || token.startsWith("<?")) continue;
    const name = tagNameOf(token);
    const closing = token.startsWith("</");
    const selfClosing = token.endsWith("/>");

    if (textTags.has(name)) {
      if (closing) depth = Math.max(0, depth - 1);
      else if (!selfClosing) depth++;
      continue;
    }
    if (breakTags.has(name) && !closing) {
      out += "\n";
      continue;
    }
    if (tabTags.has(name) && !closing) {
      out += "\t";
      continue;
    }
    if (paragraphTags.has(name) && (closing || selfClosing)) {
      out += "\n";
      continue;
    }
  }
  return out;
}

/** 빈 줄이 과하게 늘어지는 걸 막고 앞뒤 공백을 턴다. */
function tidy(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

// ── 포맷별 추출 ───────────────────────────────────────────────────────────

/** `slide12.xml` 처럼 숫자가 박힌 이름을 사람이 기대하는 순서로 정렬한다. */
function numericSort(names: string[]): string[] {
  const indexOf = (name: string): number => {
    const match = /(\d+)(?=\.[^.]+$)/.exec(name);
    return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
  };
  return [...names].sort(
    (a, b) => indexOf(a) - indexOf(b) || a.localeCompare(b),
  );
}

function extractDocx(zip: ZipArchive): string {
  // 본문 + 각주/미주(있으면). 머리말/꼬리말은 반복 잡음이라 넣지 않는다.
  const parts: string[] = [];
  for (const name of [
    "word/document.xml",
    "word/footnotes.xml",
    "word/endnotes.xml",
  ]) {
    const xml = zip.readText(name);
    if (!xml) continue;
    const text = extractXmlText(xml, {
      textTags: ["w:t"],
      paragraphTags: ["w:p"],
      breakTags: ["w:br", "w:cr"],
      tabTags: ["w:tab"],
    });
    if (text.trim()) parts.push(text);
  }
  return parts.join("\n");
}

function extractPptx(zip: ZipArchive): string {
  const slides = numericSort(
    zip.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/i.test(n)),
  );
  const parts: string[] = [];
  slides.forEach((name, index) => {
    const xml = zip.readText(name);
    if (!xml) return;
    const text = tidy(
      extractXmlText(xml, {
        textTags: ["a:t"],
        paragraphTags: ["a:p"],
        breakTags: ["a:br"],
      }),
    );
    // 슬라이드 번호를 남긴다 — 나중에 "몇 번째 장" 을 인용할 수 있어야 한다.
    if (text) parts.push(`## 슬라이드 ${index + 1}\n${text}`);
  });
  return parts.join("\n\n");
}

/** `A1`, `BC12` → 0-based 열 인덱스. 모르면 -1. */
export function columnIndexFromRef(ref: string): number {
  const letters = /^([A-Za-z]+)/.exec(ref)?.[1];
  if (!letters) return -1;
  let index = 0;
  for (const ch of letters.toUpperCase()) {
    index = index * 26 + (ch.charCodeAt(0) - 64);
  }
  return index - 1;
}

/** CSV 한 칸 — 쉼표·따옴표·줄바꿈이 있으면 감싼다. */
function csvCell(value: string): string {
  if (!/[",\n]/.test(value)) return value;
  return `"${value.replace(/"/g, '""')}"`;
}

/** sharedStrings.xml → 인덱스별 문자열. */
function readSharedStrings(zip: ZipArchive): string[] {
  const xml = zip.readText("xl/sharedStrings.xml");
  if (!xml) return [];
  const items: string[] = [];
  const siRe = /<si\b[^>]*>([\s\S]*?)<\/si>|<si\b[^>]*\/>/g;
  let match: RegExpExecArray | null;
  while ((match = siRe.exec(xml)) !== null) {
    const body = match[1] ?? "";
    items.push(extractXmlText(body, { textTags: ["t"] }));
  }
  return items;
}

/**
 * workbook.xml + rels 로 (시트 이름 → 시트 XML 경로) 순서를 만든다. rels 가 없거나
 * 깨졌으면 worksheets 폴더를 번호순으로 훑는 것으로 대신한다.
 */
function sheetPlan(zip: ZipArchive): Array<{ name: string; path: string }> {
  const workbook = zip.readText("xl/workbook.xml");
  const rels = zip.readText("xl/_rels/workbook.xml.rels");
  const plan: Array<{ name: string; path: string }> = [];

  if (workbook && rels) {
    const target = new Map<string, string>();
    const relRe = /<Relationship\b[^>]*\/?>/g;
    let rel: RegExpExecArray | null;
    while ((rel = relRe.exec(rels)) !== null) {
      const id = /\bId="([^"]+)"/.exec(rel[0])?.[1];
      const path = /\bTarget="([^"]+)"/.exec(rel[0])?.[1];
      if (id && path) {
        const normalized = path.replace(/^\/?xl\//, "").replace(/^\//, "");
        target.set(id, `xl/${normalized}`);
      }
    }
    const sheetRe = /<sheet\b[^>]*\/?>/g;
    let sheet: RegExpExecArray | null;
    while ((sheet = sheetRe.exec(workbook)) !== null) {
      const name = /\bname="([^"]*)"/.exec(sheet[0])?.[1];
      const rid = /\br:id="([^"]+)"/.exec(sheet[0])?.[1];
      const path = rid ? target.get(rid) : undefined;
      if (name && path) {
        plan.push({ name: decodeXmlEntities(name), path });
      }
    }
  }

  if (plan.length) return plan;
  return numericSort(
    zip.names().filter((n) => /^xl\/worksheets\/sheet\d+\.xml$/i.test(n)),
  ).map((path, i) => ({ name: `Sheet${i + 1}`, path }));
}

/** 시트 XML → CSV 텍스트. */
export function sheetXmlToCsv(xml: string, sharedStrings: string[]): string {
  const lines: string[] = [];
  const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let row: RegExpExecArray | null;
  while ((row = rowRe.exec(xml)) !== null) {
    const cells: string[] = [];
    const cellRe = /<c\b([^>]*)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cell: RegExpExecArray | null;
    while ((cell = cellRe.exec(row[1])) !== null) {
      const attrs = cell[1] ?? "";
      const body = cell[2] ?? "";
      const type = /\bt="([^"]*)"/.exec(attrs)?.[1] ?? "n";
      let value = "";
      if (type === "s") {
        const raw = extractXmlText(body, { textTags: ["v"] }).trim();
        const index = Number(raw);
        value = Number.isInteger(index) ? (sharedStrings[index] ?? "") : "";
      } else if (type === "inlineStr") {
        value = extractXmlText(body, { textTags: ["t"] });
      } else {
        // n(숫자)·str(수식 결과 문자열)·b(불리언)·e(오류) 모두 <v> 의 캐시값을 쓴다.
        value = extractXmlText(body, { textTags: ["v"] });
      }
      const ref = /\br="([^"]*)"/.exec(attrs)?.[1] ?? "";
      const column = columnIndexFromRef(ref);
      // 빈 칸이 생략된 sparse 시트라도 열 위치를 지킨다.
      if (column >= 0) {
        while (cells.length < column) cells.push("");
        cells[column] = value.replace(/\n/g, " ").trim();
      } else {
        cells.push(value.replace(/\n/g, " ").trim());
      }
    }
    // 완전히 빈 행은 CSV 에 빈 줄만 남기므로 건너뛴다.
    if (cells.some((c) => c !== "")) lines.push(cells.map(csvCell).join(","));
  }
  return lines.join("\n");
}

function extractXlsx(zip: ZipArchive): string {
  const sharedStrings = readSharedStrings(zip);
  const parts: string[] = [];
  for (const { name, path } of sheetPlan(zip)) {
    const xml = zip.readText(path);
    if (!xml) continue;
    const csv = sheetXmlToCsv(xml, sharedStrings);
    // 시트가 여러 개라 이름 없이 CSV 만 이어 붙이면 어느 시트인지 알 수 없다.
    if (csv.trim()) parts.push(`## ${name}\n${csv}`);
  }
  return parts.join("\n\n");
}

function extractHwpx(zip: ZipArchive): string {
  const sections = numericSort(
    zip.names().filter((n) => /^Contents\/section\d+\.xml$/i.test(n)),
  );
  const parts: string[] = [];
  for (const name of sections) {
    const xml = zip.readText(name);
    if (!xml) continue;
    const text = extractXmlText(xml, {
      textTags: ["hp:t", "t"],
      paragraphTags: ["hp:p", "p"],
      breakTags: ["hp:lineBreak"],
      tabTags: ["hp:tab"],
    });
    if (text.trim()) parts.push(text);
  }
  return parts.join("\n");
}

// ── 진입점 ────────────────────────────────────────────────────────────────

const ZIP_BASED: ReadonlySet<OfficeFormat> = new Set<OfficeFormat>([
  "docx",
  "pptx",
  "xlsx",
  "hwpx",
]);

/** OLE 복합문서(HWP5·구형 Office) 시그니처 D0 CF 11 E0 A1 B1 1A E1. */
function looksLikeOle(bytes: Buffer): boolean {
  return (
    bytes.length >= 8 &&
    bytes.readUInt32BE(0) === 0xd0cf11e0 &&
    bytes.readUInt32BE(4) === 0xa1b11ae1
  );
}

/**
 * 바이트 → 텍스트. **절대 throw 하지 않는다** — 못 읽으면 `empty: true` 와 이유다.
 *
 * 확장자/MIME 이 틀린 파일이 흔해서(특히 한글), 선언된 형식보다 **실제 시그니처**를
 * 우선한다: .hwp 인데 zip 이면 HWPX 로, .hwpx 인데 OLE 면 HWP5 로 처리한다.
 */
export function extractOfficeText(
  bytes: Buffer,
  format: OfficeFormat,
): OfficeTextResult {
  try {
    if (format === "hwp" && looksLikeZip(bytes)) {
      return extractOfficeText(bytes, "hwpx");
    }
    if (ZIP_BASED.has(format) && looksLikeOle(bytes)) {
      if (format === "hwpx") return extractOfficeText(bytes, "hwp");
      return {
        text: "",
        empty: true,
        reason: "unreadable",
        // .doc/.xls/.ppt(97-2003) 은 OOXML 이 아니라 OLE 다 — 우리 파서 밖이다.
        detail:
          "97-2003 형식(OLE)은 지원하지 않습니다. 최신 형식으로 저장해 주세요.",
      };
    }

    if (format === "hwp") return extractHwp5Text(bytes);

    const zip = openZip(bytes);
    if (!zip) {
      return {
        text: "",
        empty: true,
        reason: "unreadable",
        detail: "압축 컨테이너를 열 수 없습니다(손상되었거나 잘린 파일).",
      };
    }
    const raw =
      format === "docx"
        ? extractDocx(zip)
        : format === "pptx"
          ? extractPptx(zip)
          : format === "xlsx"
            ? extractXlsx(zip)
            : extractHwpx(zip);
    const text = tidy(raw);
    if (text) return { text, empty: false };
    return {
      text: "",
      empty: true,
      reason: "no-text",
      detail:
        "문서 안에 추출할 텍스트가 없습니다(이미지만 있는 문서일 수 있습니다).",
    };
  } catch {
    return {
      text: "",
      empty: true,
      reason: "unreadable",
      detail: "파일을 해석하는 중 오류가 났습니다.",
    };
  }
}
