/**
 * HWP5(구형 .hwp) 본문 추출 — best-effort (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * ── 왜 이렇게까지 하나 ────────────────────────────────────────────────────
 * .hwpx 는 zip 이라 쉽지만 국내 실무 문서는 아직 대부분 HWP5 다. HWP5 는
 * **OLE 복합문서(CFB)** 안에 스트림들이 든 구조라, zip 리더로는 한 글자도 못
 * 읽는다. hwp.js 같은 라이브러리는 브라우저 렌더링까지 끌고 오는 무거운
 * 의존성이라(그리고 dist-mcp/Cloud Build 번들에 부담이라) 우리가 필요한
 * **CFB 스트림 읽기 + 문단 텍스트 레코드**만 직접 구현했다.
 *
 * ── 무엇을 하고 무엇을 못 하나 (정직한 한계) ─────────────────────────────
 *  ✔ BodyText/SectionN 스트림의 HWPTAG_PARA_TEXT(문단 텍스트)를 순서대로 읽는다.
 *  ✔ 압축(zlib raw deflate) 문서와 비압축 문서 둘 다.
 *  ✘ 암호 설정 문서·배포용 문서(ViewText, 암호화)는 못 읽는다 → `unreadable`.
 *  ✘ 표/글상자 안의 텍스트는 별도 문단 레코드로 들어있으면 읽히지만, 서식·
 *    레이아웃·이미지는 복원하지 않는다.
 *  ✘ 4GB 이상 CFB, DIFAT 이 비정상인 손상 파일은 지원 대상이 아니다.
 */
import zlib from "node:zlib";

import type { OfficeTextResult } from "./office-text-extract";

// ── CFB(OLE 복합문서) 최소 리더 ──────────────────────────────────────────

const CFB_SIG_HI = 0xd0cf11e0;
const CFB_SIG_LO = 0xa1b11ae1;

/** FAT 특수값: 스트림 끝. */
const END_OF_CHAIN = 0xfffffffe;
/** FAT 특수값: 할당되지 않음. */
const FREE_SECTOR = 0xffffffff;

/** 무한 루프 방지 — 손상된 FAT 이 자기 자신을 가리키는 경우가 있다. */
const MAX_CHAIN_SECTORS = 200_000;

interface CfbDirEntry {
  name: string;
  /** 1=storage, 2=stream, 5=root. */
  type: number;
  leftSibling: number;
  rightSibling: number;
  child: number;
  startSector: number;
  size: number;
}

interface CfbFile {
  entries: CfbDirEntry[];
  readStream(entry: CfbDirEntry): Buffer | null;
}

function readChain(
  bytes: Buffer,
  fat: Uint32Array,
  start: number,
  sectorSize: number,
  sectorOffset: (sector: number) => number,
  byteLimit: number,
): Buffer {
  const chunks: Buffer[] = [];
  let sector = start;
  let guard = 0;
  let collected = 0;
  while (
    sector !== END_OF_CHAIN &&
    sector !== FREE_SECTOR &&
    sector < fat.length &&
    guard++ < MAX_CHAIN_SECTORS &&
    collected < byteLimit
  ) {
    const offset = sectorOffset(sector);
    if (offset + sectorSize > bytes.length) {
      // 잘린 파일 — 남은 만큼만 살린다.
      if (offset < bytes.length) chunks.push(bytes.subarray(offset));
      break;
    }
    chunks.push(bytes.subarray(offset, offset + sectorSize));
    collected += sectorSize;
    sector = fat[sector];
  }
  return Buffer.concat(chunks);
}

/** CFB 바이트 → 디렉터리 + 스트림 리더. 형식이 아니면 null. */
export function openCfb(bytes: Buffer): CfbFile | null {
  if (
    bytes.length < 512 ||
    bytes.readUInt32BE(0) !== CFB_SIG_HI ||
    bytes.readUInt32BE(4) !== CFB_SIG_LO
  ) {
    return null;
  }
  const sectorSize = 1 << bytes.readUInt16LE(0x1e);
  const miniSectorSize = 1 << bytes.readUInt16LE(0x20);
  if (sectorSize < 128 || sectorSize > 1 << 20) return null;
  const fatSectorCount = bytes.readUInt32LE(0x2c);
  const firstDirSector = bytes.readUInt32LE(0x30);
  const miniCutoff = bytes.readUInt32LE(0x38);
  const firstMiniFatSector = bytes.readUInt32LE(0x3c);
  const miniFatSectorCount = bytes.readUInt32LE(0x40);
  const firstDifatSector = bytes.readUInt32LE(0x44);
  const difatSectorCount = bytes.readUInt32LE(0x48);

  // 섹터 N 의 파일 오프셋 — 헤더가 0번 섹터 자리를 차지한다.
  const sectorOffset = (sector: number): number => (sector + 1) * sectorSize;

  // ── DIFAT: FAT 이 어느 섹터들에 있는지 ──────────────────────────────
  const fatSectors: number[] = [];
  for (let i = 0; i < 109 && fatSectors.length < fatSectorCount; i++) {
    const sector = bytes.readUInt32LE(0x4c + i * 4);
    if (sector === FREE_SECTOR || sector === END_OF_CHAIN) break;
    fatSectors.push(sector);
  }
  let difat = firstDifatSector;
  const perDifat = sectorSize / 4 - 1;
  for (
    let i = 0;
    i < difatSectorCount && difat !== END_OF_CHAIN && difat !== FREE_SECTOR;
    i++
  ) {
    const offset = sectorOffset(difat);
    if (offset + sectorSize > bytes.length) break;
    for (let j = 0; j < perDifat; j++) {
      const sector = bytes.readUInt32LE(offset + j * 4);
      if (sector === FREE_SECTOR || sector === END_OF_CHAIN) continue;
      fatSectors.push(sector);
    }
    difat = bytes.readUInt32LE(offset + perDifat * 4);
  }

  // ── FAT 조립 ────────────────────────────────────────────────────────
  const entriesPerSector = sectorSize / 4;
  const fat = new Uint32Array(fatSectors.length * entriesPerSector);
  let written = 0;
  for (const sector of fatSectors) {
    const offset = sectorOffset(sector);
    if (offset + sectorSize > bytes.length) break;
    for (let i = 0; i < entriesPerSector; i++) {
      fat[written++] = bytes.readUInt32LE(offset + i * 4);
    }
  }
  if (!written) return null;

  // ── 디렉터리 엔트리 ─────────────────────────────────────────────────
  const dirBytes = readChain(
    bytes,
    fat,
    firstDirSector,
    sectorSize,
    sectorOffset,
    bytes.length,
  );
  const entries: CfbDirEntry[] = [];
  for (let offset = 0; offset + 128 <= dirBytes.length; offset += 128) {
    const nameLength = dirBytes.readUInt16LE(offset + 0x40);
    const name =
      nameLength > 2
        ? dirBytes
            .subarray(offset, offset + Math.min(nameLength - 2, 64))
            .toString("utf16le")
        : "";
    entries.push({
      name,
      type: dirBytes.readUInt8(offset + 0x42),
      leftSibling: dirBytes.readUInt32LE(offset + 0x44),
      rightSibling: dirBytes.readUInt32LE(offset + 0x48),
      child: dirBytes.readUInt32LE(offset + 0x4c),
      startSector: dirBytes.readUInt32LE(offset + 0x74),
      // 크기는 u64 지만 우리 상한(10MB)에선 하위 32비트로 충분하다.
      size: dirBytes.readUInt32LE(offset + 0x78),
    });
  }
  if (!entries.length) return null;

  // ── 미니 FAT / 미니 스트림(작은 스트림은 여기에 산다) ────────────────
  let miniFat = new Uint32Array(0);
  if (miniFatSectorCount > 0) {
    const miniFatBytes = readChain(
      bytes,
      fat,
      firstMiniFatSector,
      sectorSize,
      sectorOffset,
      miniFatSectorCount * sectorSize,
    );
    miniFat = new Uint32Array(Math.floor(miniFatBytes.length / 4));
    for (let i = 0; i < miniFat.length; i++) {
      miniFat[i] = miniFatBytes.readUInt32LE(i * 4);
    }
  }
  const root = entries[0];
  let miniStream: Buffer | null = null;
  const getMiniStream = (): Buffer => {
    if (!miniStream) {
      miniStream = readChain(
        bytes,
        fat,
        root.startSector,
        sectorSize,
        sectorOffset,
        bytes.length,
      );
    }
    return miniStream;
  };

  const readStream = (entry: CfbDirEntry): Buffer | null => {
    if (entry.size === 0) return Buffer.alloc(0);
    if (entry.size < miniCutoff && entry.type !== 5) {
      const mini = getMiniStream();
      const chunks: Buffer[] = [];
      let sector = entry.startSector;
      let guard = 0;
      while (
        sector !== END_OF_CHAIN &&
        sector !== FREE_SECTOR &&
        sector < miniFat.length &&
        guard++ < MAX_CHAIN_SECTORS
      ) {
        const offset = sector * miniSectorSize;
        if (offset >= mini.length) break;
        chunks.push(mini.subarray(offset, offset + miniSectorSize));
        sector = miniFat[sector];
      }
      const joined = Buffer.concat(chunks);
      return joined.subarray(0, Math.min(entry.size, joined.length));
    }
    const joined = readChain(
      bytes,
      fat,
      entry.startSector,
      sectorSize,
      sectorOffset,
      entry.size + sectorSize,
    );
    return joined.subarray(0, Math.min(entry.size, joined.length));
  };

  return { entries, readStream };
}

/**
 * 디렉터리 트리에서 이름으로 자식을 찾는다.
 *
 * CFB 의 형제 목록은 red-black 트리라 좌/우 형제를 모두 훑어야 한다. 선형 스캔
 * 대신 트리를 타는 이유: 배포용 문서는 `BodyText` 와 `ViewText` **양쪽**에
 * `SectionN` 을 두기 때문에, 어느 저장소 밑인지 구분하지 않으면 암호화된
 * ViewText 를 본문으로 착각한다.
 */
function findChild(
  entries: CfbDirEntry[],
  parentIndex: number,
  name: string,
): number {
  const parent = entries[parentIndex];
  if (!parent) return -1;
  const target = name.toLowerCase();
  const stack = [parent.child];
  const seen = new Set<number>();
  while (stack.length) {
    const index = stack.pop();
    if (index === undefined || index === FREE_SECTOR || index >= entries.length)
      continue;
    if (seen.has(index)) continue;
    seen.add(index);
    const entry = entries[index];
    if (entry.name.toLowerCase() === target) return index;
    stack.push(entry.leftSibling, entry.rightSibling);
  }
  return -1;
}

/** 한 저장소 아래의 모든 자식 인덱스(형제 트리 전체). */
function listChildren(entries: CfbDirEntry[], parentIndex: number): number[] {
  const parent = entries[parentIndex];
  if (!parent) return [];
  const out: number[] = [];
  const stack = [parent.child];
  const seen = new Set<number>();
  while (stack.length) {
    const index = stack.pop();
    if (index === undefined || index === FREE_SECTOR || index >= entries.length)
      continue;
    if (seen.has(index)) continue;
    seen.add(index);
    out.push(index);
    const entry = entries[index];
    stack.push(entry.leftSibling, entry.rightSibling);
  }
  return out;
}

// ── HWP5 레코드 ───────────────────────────────────────────────────────────

/** HWPTAG_BEGIN(0x10) + 51 = 문단 텍스트 레코드. */
const HWPTAG_PARA_TEXT = 0x10 + 51;

/**
 * 컨트롤 문자 분류(HWP5 스펙 "문단의 텍스트").
 * 확장/인라인 컨트롤은 **8개 wchar** 를 통째로 차지한다 — 그만큼 건너뛰지 않으면
 * 컨트롤 ID 바이트가 본문에 한자·기호로 섞여 나온다.
 */
const EIGHT_WCHAR_CONTROLS = new Set([
  1, 2, 3, 4, 5, 6, 7, 8, 9, 11, 12, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
]);

/** PARA_TEXT 레코드 하나(UTF-16LE + 컨트롤) → 문단 텍스트. */
export function decodeHwp5ParaText(data: Buffer): string {
  let out = "";
  for (let i = 0; i + 1 < data.length; i += 2) {
    const code = data.readUInt16LE(i);
    if (code === 9) {
      out += "\t";
      i += 14; // 탭은 인라인 컨트롤 — 나머지 7 wchar 를 건너뛴다
      continue;
    }
    if (code === 10 || code === 13) {
      out += "\n";
      continue;
    }
    if (EIGHT_WCHAR_CONTROLS.has(code)) {
      i += 14;
      continue;
    }
    if (code < 32) continue; // 나머지 문자 컨트롤은 버린다
    out += String.fromCharCode(code);
  }
  return out;
}

/** 섹션 스트림(압축 해제된 상태) → 텍스트. */
export function extractHwp5SectionText(section: Buffer): string {
  const paragraphs: string[] = [];
  let cursor = 0;
  while (cursor + 4 <= section.length) {
    const header = section.readUInt32LE(cursor);
    cursor += 4;
    const tagId = header & 0x3ff;
    let size = (header >> 20) & 0xfff;
    if (size === 0xfff) {
      if (cursor + 4 > section.length) break;
      size = section.readUInt32LE(cursor);
      cursor += 4;
    }
    if (cursor + size > section.length) {
      // 잘린 레코드 — 여기까지 모은 문단은 살린다.
      if (tagId === HWPTAG_PARA_TEXT && cursor < section.length) {
        paragraphs.push(decodeHwp5ParaText(section.subarray(cursor)));
      }
      break;
    }
    if (tagId === HWPTAG_PARA_TEXT) {
      paragraphs.push(
        decodeHwp5ParaText(section.subarray(cursor, cursor + size)),
      );
    }
    cursor += size;
  }
  return paragraphs.join("\n");
}

/** 압축 플래그가 켜져 있으면 raw deflate 를 푼다. 실패하면 null. */
function inflateSection(raw: Buffer, compressed: boolean): Buffer | null {
  if (!compressed) return raw;
  try {
    return zlib.inflateRawSync(raw);
  } catch {
    try {
      return zlib.inflateRawSync(raw, {
        finishFlush: zlib.constants.Z_SYNC_FLUSH,
      });
    } catch {
      // 일부 생성기는 zlib 헤더를 붙인다.
      try {
        return zlib.inflateSync(raw, {
          finishFlush: zlib.constants.Z_SYNC_FLUSH,
        });
      } catch {
        return null;
      }
    }
  }
}

/**
 * HWP5 바이트 → 텍스트. **절대 throw 하지 않는다.**
 */
export function extractHwp5Text(bytes: Buffer): OfficeTextResult {
  const unreadable = (detail: string): OfficeTextResult => ({
    text: "",
    empty: true,
    reason: "unreadable",
    detail,
  });

  let cfb: CfbFile | null = null;
  try {
    cfb = openCfb(bytes);
  } catch {
    cfb = null;
  }
  if (!cfb) {
    return unreadable(
      "한글(.hwp) 복합문서 구조를 열 수 없습니다(손상되었거나 잘린 파일).",
    );
  }

  // FileHeader 로 압축·암호 여부를 읽는다.
  const headerIndex = findChild(cfb.entries, 0, "FileHeader");
  let compressed = true;
  if (headerIndex >= 0) {
    const header = cfb.readStream(cfb.entries[headerIndex]);
    if (header && header.length >= 40) {
      const signature = header.subarray(0, 17).toString("latin1");
      if (!signature.startsWith("HWP Document File")) {
        return unreadable("한글(.hwp) 파일이 아닙니다.");
      }
      const flags = header.readUInt32LE(36);
      compressed = (flags & 0x1) !== 0;
      if ((flags & 0x2) !== 0) {
        return unreadable("암호가 걸린 한글 문서라 본문을 읽을 수 없습니다.");
      }
      if ((flags & 0x4) !== 0) {
        return unreadable(
          "배포용(복사 방지) 한글 문서라 본문이 암호화되어 있습니다.",
        );
      }
    }
  }

  const bodyIndex = findChild(cfb.entries, 0, "BodyText");
  if (bodyIndex < 0) {
    return unreadable(
      "한글 문서의 본문 저장소(BodyText)를 찾지 못했습니다 — 배포용 문서일 수 있습니다.",
    );
  }

  const sections = listChildren(cfb.entries, bodyIndex)
    .map((index) => ({ index, entry: cfb.entries[index] }))
    .filter(({ entry }) => /^Section\d+$/i.test(entry.name))
    .sort(
      (a, b) =>
        Number(a.entry.name.replace(/\D/g, "")) -
        Number(b.entry.name.replace(/\D/g, "")),
    );
  if (!sections.length) {
    return unreadable("한글 문서에서 본문 섹션을 찾지 못했습니다.");
  }

  const parts: string[] = [];
  let decodeFailures = 0;
  for (const { entry } of sections) {
    const raw = cfb.readStream(entry);
    if (!raw || !raw.length) continue;
    const section =
      inflateSection(raw, compressed) ?? inflateSection(raw, false);
    if (!section) {
      decodeFailures++;
      continue;
    }
    let text = "";
    try {
      text = extractHwp5SectionText(section);
    } catch {
      decodeFailures++;
      continue;
    }
    if (text.trim()) parts.push(text);
  }

  const text = parts
    .join("\n")
    .replace(/\r\n?/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  if (text) return { text, empty: false };
  if (decodeFailures) {
    return unreadable(
      "한글 문서의 본문 스트림을 해석하지 못했습니다(지원하지 않는 하위 형식일 수 있습니다).",
    );
  }
  return {
    text: "",
    empty: true,
    reason: "no-text",
    detail:
      "문서 안에 추출할 텍스트가 없습니다(이미지만 있는 문서일 수 있습니다).",
  };
}
