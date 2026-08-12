/**
 * 의존성 없는 최소 PDF 텍스트 추출기.
 *
 * ── 왜 라이브러리를 안 쓰나 ───────────────────────────────────────────────
 * Drive 커넥터 MVP(티켓 zqNxS9904aeeBEug1uAD)의 완료 기준에 "일반 파일(PDF/txt)
 * 본문 취득" 이 있다. 여기에 `pdf-parse`/`pdfjs-dist` 를 넣으면 (a) 앱 번들과
 * dist-mcp esbuild 번들이 수 MB 불어나고 (b) pdfjs 는 worker/canvas 를 끌고 와
 * Electron main 에서 다루기 번거롭다. 반면 "텍스트 레이어가 있는 PDF 에서
 * 문자열만 긁는" 일은 node 내장 zlib 로 충분하다.
 *
 * ── 무엇을 하고 무엇을 못 하나 (정직한 한계) ─────────────────────────────
 *  ✔ FlateDecode(또는 무압축) 콘텐츠 스트림의 텍스트 연산자(Tj, TJ, ', ")에서
 *    문자열을 추출한다. 일반적인 워드/구글독스 내보내기 PDF 는 잘 읽힌다.
 *  ✘ 스캔 이미지 PDF(텍스트 레이어 없음)는 빈 문자열이다 — OCR 은 하지 않는다.
 *  ✘ 암호화된 PDF, LZW/기타 필터, CID 폰트의 비표준 인코딩은 지원하지 않는다.
 *  ✘ 정확한 단어/줄 위치 복원은 하지 않는다(좌표 기반 레이아웃 미해석).
 * 호출자는 결과가 빈 문자열일 수 있음을 전제하고 `extraction` 값으로 그 사실을
 * 사용자에게 드러내야 한다. 조용히 "본문 없음" 으로 넘기지 말 것.
 */
import zlib from "node:zlib";

/** PDF 문자열 리터럴의 이스케이프 시퀀스. */
const ESCAPES: Record<string, string> = {
  n: "\n",
  r: "\r",
  t: "\t",
  b: "\b",
  f: "\f",
  "(": "(",
  ")": ")",
  "\\": "\\",
};

/** `\ddd` 8진 이스케이프까지 푼 PDF literal string 디코드. */
function decodeLiteralString(raw: string): string {
  let out = "";
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    if (ch !== "\\") {
      out += ch;
      continue;
    }
    const next = raw[++i];
    if (next === undefined) break;
    if (next in ESCAPES) {
      out += ESCAPES[next];
      continue;
    }
    if (next >= "0" && next <= "7") {
      let octal = next;
      while (octal.length < 3) {
        const peek = raw[i + 1];
        if (peek === undefined || peek < "0" || peek > "7") break;
        octal += peek;
        i++;
      }
      out += String.fromCharCode(parseInt(octal, 8));
      continue;
    }
    // 줄바꿈 앞의 `\` 는 줄 잇기 — 아무것도 내보내지 않는다.
    if (next === "\n") continue;
    if (next === "\r") {
      if (raw[i + 1] === "\n") i++;
      continue;
    }
    out += next;
  }
  return out;
}

/**
 * `<48656C6C6F>` 형태의 hex string 디코드. 바이트가 2개씩 붙은 UTF-16BE 인
 * 경우(선행 BOM `FEFF` 또는 홀수 위치가 전부 0x00)를 감지해 함께 처리한다.
 */
function decodeHexString(raw: string): string {
  const hex = raw.replace(/[^0-9a-fA-F]/g, "");
  const padded = hex.length % 2 === 1 ? `${hex}0` : hex;
  const bytes = Buffer.from(padded, "hex");
  // Node 는 UTF-16**LE** 만 디코드한다. PDF 의 UTF-16 은 항상 BE 라 바이트를
  // 뒤집어야 한다 — 안 뒤집으면 "OK" 가 "伀䬀" 같은 CJK 로 나온다.
  const asUtf16be = (buf: Buffer): string => {
    if (buf.length < 2) return "";
    const even = buf.length % 2 === 0 ? buf : buf.subarray(0, buf.length - 1);
    const swapped = Buffer.from(even);
    swapped.swap16();
    return swapped.toString("utf16le");
  };
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return asUtf16be(bytes.subarray(2));
  }
  if (
    bytes.length >= 4 &&
    bytes.length % 2 === 0 &&
    bytes.every((b, i) => (i % 2 === 0 ? b === 0 : true))
  ) {
    // UTF-16BE without BOM (every high byte is 0x00 → latin-1 range text).
    return asUtf16be(bytes);
  }
  return bytes.toString("latin1");
}

/**
 * latin1 로 읽어 온 바이트열이 사실은 UTF-8 이면 그렇게 다시 읽는다.
 *
 * 콘텐츠 스트림은 바이트 그대로 다뤄야 해서 latin1 로 디코드한다(1바이트 = 1문자,
 * 무손실). 그런데 적잖은 PDF 생성기가 literal string 안에 UTF-8 바이트를 그대로
 * 넣는다 — 그 경우 latin1 결과는 "ë³¸ë¬¸" 같은 모지바케다. 문자열이 전부
 * 0x00–0xFF 범위(= 아직 바이트열)이고 그 바이트가 유효한 UTF-8 이면 UTF-8 해석이
 * 옳다. 이미 유니코드가 섞였으면(hex UTF-16 경로) 손대지 않는다.
 */
function recoverUtf8(text: string): string {
  let hasHighByte = false;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0xff) return text; // 이미 디코드된 유니코드 — 건드리면 망가진다
    if (code >= 0x80) hasHighByte = true;
  }
  if (!hasHighByte) return text; // 순수 ASCII — 두 해석이 같다
  const decoded = Buffer.from(text, "latin1").toString("utf8");
  // U+FFFD 가 생겼다면 UTF-8 이 아니었다는 뜻 — 원본을 지킨다.
  return decoded.includes("�") ? text : decoded;
}

/**
 * 콘텐츠 스트림 하나에서 텍스트를 뽑는다.
 *
 * `TJ` 배열은 `[(A) -250 (B)] TJ` 처럼 커닝 숫자가 섞여 있다. 큰 음수 커닝은
 * 보통 단어 사이 공백이므로 임계값을 넘으면 공백을 넣는다(대략적 근사).
 */
export function extractTextFromContentStream(content: string): string {
  const pieces: string[] = [];
  // (literal) | <hex> | ] TJ | Tj | ' | " | ET | Td/TD/T*  등 줄바꿈 신호
  const tokenRe =
    /\((?:\\.|[^\\()])*\)|<[0-9A-Fa-f\s]*>|-?\d+(?:\.\d+)?|\bT[JjdD*]|\bET\b|'|"/g;
  let pending: string[] = [];
  let lastNumber: number | null = null;
  let match: RegExpExecArray | null;

  const flush = (suffix: string) => {
    if (pending.length) pieces.push(pending.join(""));
    pending = [];
    if (suffix) pieces.push(suffix);
  };

  while ((match = tokenRe.exec(content)) !== null) {
    const token = match[0];
    if (token.startsWith("(")) {
      if (lastNumber !== null && lastNumber <= -180) pending.push(" ");
      pending.push(decodeLiteralString(token.slice(1, -1)));
      lastNumber = null;
      continue;
    }
    if (token.startsWith("<")) {
      if (lastNumber !== null && lastNumber <= -180) pending.push(" ");
      pending.push(decodeHexString(token.slice(1, -1)));
      lastNumber = null;
      continue;
    }
    if (/^-?\d/.test(token)) {
      lastNumber = Number(token);
      continue;
    }
    lastNumber = null;
    // 줄/블록 경계 연산자 → 줄바꿈으로 근사한다.
    if (token === "Td" || token === "TD" || token === "T*" || token === "ET") {
      flush("\n");
      continue;
    }
    if (token === "'" || token === '"') {
      flush("\n");
      continue;
    }
    if (token === "Tj" || token === "TJ") {
      flush("");
      continue;
    }
  }
  flush("");
  return pieces.join("");
}

/** PDF 바이트에서 `stream ... endstream` 구간들을 원시 버퍼로 잘라낸다. */
function sliceStreams(buf: Buffer): Buffer[] {
  const streams: Buffer[] = [];
  const START = Buffer.from("stream");
  const END = Buffer.from("endstream");
  let cursor = 0;
  while (cursor < buf.length) {
    const start = buf.indexOf(START, cursor);
    if (start === -1) break;
    // "endstream" 을 "stream" 으로 오인하지 않도록 앞 글자를 확인한다.
    const prev = start > 0 ? buf[start - 1] : 0x20;
    if (prev === 0x64 /* d, from "end" */) {
      cursor = start + START.length;
      continue;
    }
    let bodyStart = start + START.length;
    if (buf[bodyStart] === 0x0d) bodyStart++;
    if (buf[bodyStart] === 0x0a) bodyStart++;
    const end = buf.indexOf(END, bodyStart);
    if (end === -1) break;
    streams.push(buf.subarray(bodyStart, end));
    cursor = end + END.length;
  }
  return streams;
}

/** Flate 면 풀고, 아니면 그대로. 실패하면 null(그 스트림은 건너뛴다). */
function inflateIfPossible(chunk: Buffer): string | null {
  // zlib 헤더(0x78 ..) 로 시작하면 FlateDecode 로 본다.
  if (chunk.length >= 2 && chunk[0] === 0x78) {
    try {
      return zlib.inflateSync(chunk).toString("latin1");
    } catch {
      try {
        return zlib.inflateRawSync(chunk.subarray(2)).toString("latin1");
      } catch {
        return null;
      }
    }
  }
  const text = chunk.toString("latin1");
  // 텍스트 연산자가 하나도 없으면 이미지/폰트 스트림이다 — 건너뛴다.
  return /\bT[Jj]\b/.test(text) ? text : null;
}

/** 결과가 "실제 텍스트" 인지 판단할 때 쓰는 최소 길이. */
const MIN_MEANINGFUL_CHARS = 1;

export interface PdfTextResult {
  text: string;
  /** 텍스트 레이어를 못 찾았다(스캔 PDF 등). 호출자가 사용자에게 알려야 한다. */
  empty: boolean;
}

/**
 * PDF 바이트 → 텍스트. 절대 throw 하지 않는다 — 못 읽으면 `empty: true` 다.
 */
export function extractPdfText(bytes: Buffer): PdfTextResult {
  let text = "";
  try {
    for (const chunk of sliceStreams(bytes)) {
      const decoded = inflateIfPossible(chunk);
      if (!decoded) continue;
      // 스트림 단위로 UTF-8 복구를 시도한다 — 문서 전체를 한 번에 하면
      // 유니코드가 섞인 한 스트림 때문에 나머지 전부가 복구를 못 받는다.
      const piece = recoverUtf8(extractTextFromContentStream(decoded));
      if (piece.trim()) text += (text ? "\n" : "") + piece;
    }
  } catch {
    // 어떤 스트림이 깨져도 여기까지 모은 텍스트는 살린다.
  }
  const normalized = text.replace(/\n{3,}/g, "\n\n").trim();
  return {
    text: normalized,
    empty: normalized.length < MIN_MEANINGFUL_CHARS,
  };
}
