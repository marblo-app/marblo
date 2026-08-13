/**
 * 의존성 없는 최소 ZIP **리더** (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * ── 왜 라이브러리를 안 쓰나 ───────────────────────────────────────────────
 * docx/pptx/xlsx/hwpx 는 전부 "XML 이 든 zip" 이다. 여기에 jszip/adm-zip 을
 * 넣으면 앱 번들과 dist-mcp esbuild 번들이 불어나고(그리고 Cloud Build 에서
 * devDependency 실수가 나기 쉽다), 우리가 필요한 건 **읽기 + deflate 풀기**
 * 뿐이라 node 내장 zlib 로 충분하다. pdf-text-extract.ts 와 같은 판단이다.
 *
 * ── 무엇을 하고 무엇을 못 하나 ───────────────────────────────────────────
 *  ✔ store(0)·deflate(8) 엔트리 읽기. 중앙 디렉터리 우선, 없으면 로컬 헤더 스캔.
 *  ✔ **잘린 zip** 도 앞부분 엔트리는 읽는다(커넥터가 10MB 상한으로 자르므로
 *    현실적으로 생긴다). 중앙 디렉터리가 날아가면 스캔 경로로 떨어진다.
 *  ✘ 암호화 zip, bzip2/lzma 등 다른 압축 방식, zip64(4GB 초과)는 지원하지 않는다.
 *  ✘ 쓰기는 없다.
 */
import zlib from "node:zlib";

const SIG_LOCAL = 0x04034b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_EOCD = 0x06054b50;

/** EOCD 를 찾을 때 뒤에서부터 훑는 최대 길이(주석 최대 64KB + 헤더 22B). */
const EOCD_SEARCH_WINDOW = 66_000;

interface ZipEntryRecord {
  name: string;
  method: number;
  compressedSize: number;
  /** 압축 데이터의 시작 오프셋. 로컬 헤더를 읽어야 확정되므로 lazy 다. */
  localHeaderOffset: number;
  /** 로컬 헤더 스캔 경로에서 이미 데이터 위치를 알아낸 경우. */
  dataOffset?: number;
}

export interface ZipArchive {
  /** 아카이브 안의 엔트리 이름들(디렉터리 엔트리 제외). */
  names(): string[];
  /** 엔트리 바이트. 없거나 못 풀면 null(throw 하지 않는다). */
  read(name: string): Buffer | null;
  /** 엔트리를 UTF-8 문자열로. 없으면 null. */
  readText(name: string): string | null;
}

/** 압축 해제. 잘린 스트림도 거기까지는 살린다(Z_SYNC_FLUSH). */
function inflate(chunk: Buffer, method: number): Buffer | null {
  if (method === 0) return chunk;
  if (method !== 8) return null; // bzip2/lzma 등은 지원 대상이 아니다
  try {
    return zlib.inflateRawSync(chunk);
  } catch {
    try {
      // 잘린 데이터: 완결되지 않은 스트림이라 Z_FINISH 로는 throw 한다.
      return zlib.inflateRawSync(chunk, {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    } catch {
      return null;
    }
  }
}

/** 중앙 디렉터리에서 엔트리 목록을 읽는다. 실패하면 null. */
function readCentralDirectory(buf: Buffer): ZipEntryRecord[] | null {
  const from = Math.max(0, buf.length - EOCD_SEARCH_WINDOW);
  let eocd = -1;
  for (let i = buf.length - 22; i >= from; i--) {
    if (buf.readUInt32LE(i) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd === -1) return null;

  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (cdOffset === 0xffffffff) return null; // zip64 — 스캔 경로로 넘긴다
  if (cdOffset >= buf.length) return null;

  const entries: ZipEntryRecord[] = [];
  let cursor = cdOffset;
  for (let i = 0; i < count; i++) {
    if (cursor + 46 > buf.length) break;
    if (buf.readUInt32LE(cursor) !== SIG_CENTRAL) break;
    const method = buf.readUInt16LE(cursor + 10);
    const compressedSize = buf.readUInt32LE(cursor + 20);
    const nameLen = buf.readUInt16LE(cursor + 28);
    const extraLen = buf.readUInt16LE(cursor + 30);
    const commentLen = buf.readUInt16LE(cursor + 32);
    const localHeaderOffset = buf.readUInt32LE(cursor + 42);
    const name = buf
      .subarray(cursor + 46, cursor + 46 + nameLen)
      .toString("utf8");
    if (name && !name.endsWith("/")) {
      entries.push({ name, method, compressedSize, localHeaderOffset });
    }
    cursor += 46 + nameLen + extraLen + commentLen;
  }
  return entries.length ? entries : null;
}

/**
 * 로컬 헤더를 앞에서부터 스캔한다 — 중앙 디렉터리가 없거나(잘린 zip) 깨졌을 때의
 * 대비책. 크기가 0 인 스트리밍 엔트리(데이터 디스크립터 사용)는 남은 버퍼 전체를
 * 넘겨 inflate 가 스스로 끝을 찾게 한다.
 */
function scanLocalHeaders(buf: Buffer): ZipEntryRecord[] {
  const entries: ZipEntryRecord[] = [];
  let cursor = 0;
  while (cursor + 30 <= buf.length) {
    if (buf.readUInt32LE(cursor) !== SIG_LOCAL) {
      // 다음 로컬 헤더 시그니처로 점프한다.
      const next = buf.indexOf(
        Buffer.from([0x50, 0x4b, 0x03, 0x04]),
        cursor + 1,
      );
      if (next === -1) break;
      cursor = next;
      continue;
    }
    const method = buf.readUInt16LE(cursor + 8);
    const declaredSize = buf.readUInt32LE(cursor + 18);
    const nameLen = buf.readUInt16LE(cursor + 26);
    const extraLen = buf.readUInt16LE(cursor + 28);
    const nameStart = cursor + 30;
    const dataOffset = nameStart + nameLen + extraLen;
    if (dataOffset > buf.length) break;
    const name = buf.subarray(nameStart, nameStart + nameLen).toString("utf8");
    const compressedSize = declaredSize || buf.length - dataOffset;
    if (name && !name.endsWith("/")) {
      entries.push({
        name,
        method,
        compressedSize,
        localHeaderOffset: cursor,
        dataOffset,
      });
    }
    cursor = declaredSize ? dataOffset + declaredSize : dataOffset + 1;
  }
  return entries;
}

/** zip 시그니처("PK\x03\x04")로 시작하는가. */
export function looksLikeZip(bytes: Buffer): boolean {
  return bytes.length >= 4 && bytes.readUInt32LE(0) === SIG_LOCAL;
}

/**
 * zip 바이트 → 아카이브. zip 이 아니거나 엔트리를 하나도 못 찾으면 null.
 * 절대 throw 하지 않는다.
 */
export function openZip(bytes: Buffer): ZipArchive | null {
  if (!looksLikeZip(bytes)) return null;
  let records: ZipEntryRecord[];
  try {
    records = readCentralDirectory(bytes) ?? scanLocalHeaders(bytes);
  } catch {
    try {
      records = scanLocalHeaders(bytes);
    } catch {
      return null;
    }
  }
  if (!records.length) return null;

  // 같은 이름이 여러 번 나오면 마지막 것이 유효하다(zip 관례).
  const byName = new Map<string, ZipEntryRecord>();
  for (const record of records) byName.set(record.name, record);

  const read = (name: string): Buffer | null => {
    const record = byName.get(name);
    if (!record) return null;
    try {
      let dataOffset = record.dataOffset;
      if (dataOffset === undefined) {
        const header = record.localHeaderOffset;
        if (header + 30 > bytes.length) return null;
        if (bytes.readUInt32LE(header) !== SIG_LOCAL) return null;
        const nameLen = bytes.readUInt16LE(header + 26);
        const extraLen = bytes.readUInt16LE(header + 28);
        dataOffset = header + 30 + nameLen + extraLen;
      }
      if (dataOffset >= bytes.length) return null;
      const end = Math.min(dataOffset + record.compressedSize, bytes.length);
      return inflate(bytes.subarray(dataOffset, end), record.method);
    } catch {
      return null;
    }
  };

  return {
    names: () => [...byName.keys()],
    read,
    readText: (name) => read(name)?.toString("utf8") ?? null,
  };
}
