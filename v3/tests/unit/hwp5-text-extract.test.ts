/**
 * HWP5(.hwp, OLE 복합문서) 본문 추출 (티켓 0hDmMoM8oiU0d1eGUHvL).
 *
 * HWP5 는 zip 이 아니라 CFB(복합문서) 라, 픽스처도 CFB 로 조립해야 파서를 진짜로
 * 검증할 수 있다. 아래 `buildCfb` 는 **스펙대로의 최소 CFB** 를 만든다(FAT·디렉터리
 * ·미니FAT·미니스트림) — 우리 리더와 독립적인 구조라, 파서가 통째로 틀리면 실패한다.
 */
import zlib from "node:zlib";
import { describe, it, expect } from "vitest";

import {
  decodeHwp5ParaText,
  extractHwp5SectionText,
  extractHwp5Text,
} from "../../electron/hwp5-text-extract";

// ── CFB 픽스처 빌더 ────────────────────────────────────────────────────────

const SECTOR = 512;
const MINI_SECTOR = 64;
const MINI_CUTOFF = 4096;
const ENDOFCHAIN = 0xfffffffe;
const FREESECT = 0xffffffff;
const FATSECT = 0xfffffffd;

interface CfbEntryInput {
  name: string;
  /** 1=storage, 2=stream, 5=root */
  type: number;
  data?: Buffer;
  child?: number;
  rightSibling?: number;
}

/** 엔트리 배열(0번은 Root Entry)로 CFB 바이트를 만든다. */
function buildCfb(entries: CfbEntryInput[]): Buffer {
  // 1) 작은 스트림은 미니 스트림에, 큰 스트림은 일반 섹터에 싣는다.
  const miniChunks: Buffer[] = [];
  const bigStreams: Array<{ index: number; data: Buffer }> = [];
  const placement = new Map<number, { start: number; size: number }>();

  entries.forEach((entry, index) => {
    if (!entry.data || entry.type !== 2) return;
    if (entry.data.length < MINI_CUTOFF) {
      const start = miniChunks.length;
      for (let o = 0; o < entry.data.length; o += MINI_SECTOR) {
        const chunk = Buffer.alloc(MINI_SECTOR);
        entry.data.subarray(o, o + MINI_SECTOR).copy(chunk);
        miniChunks.push(chunk);
      }
      placement.set(index, { start, size: entry.data.length });
    } else {
      bigStreams.push({ index, data: entry.data });
    }
  });
  const miniStream = Buffer.concat(miniChunks);

  // 2) 섹터 배치: 0=FAT, 1=디렉터리, 2=미니FAT, 3~=미니스트림, 그다음 큰 스트림.
  const dirSectorCount = Math.max(1, Math.ceil(entries.length / 4));
  const fatSector = 0;
  const dirStart = 1;
  const miniFatSector = dirStart + dirSectorCount;
  const miniStreamStart = miniFatSector + 1;
  const miniStreamSectors = Math.ceil(miniStream.length / SECTOR);
  let nextSector = miniStreamStart + miniStreamSectors;

  const sectorData = new Map<number, Buffer>();
  const fat: number[] = [];
  const setChain = (start: number, count: number) => {
    for (let i = 0; i < count; i++) {
      fat[start + i] = i === count - 1 ? ENDOFCHAIN : start + i + 1;
    }
  };

  fat[fatSector] = FATSECT;
  setChain(dirStart, dirSectorCount);
  fat[miniFatSector] = ENDOFCHAIN;
  if (miniStreamSectors) setChain(miniStreamStart, miniStreamSectors);
  for (let i = 0; i < miniStreamSectors; i++) {
    const chunk = Buffer.alloc(SECTOR);
    miniStream.subarray(i * SECTOR, (i + 1) * SECTOR).copy(chunk);
    sectorData.set(miniStreamStart + i, chunk);
  }

  for (const { index, data } of bigStreams) {
    const count = Math.ceil(data.length / SECTOR);
    setChain(nextSector, count);
    for (let i = 0; i < count; i++) {
      const chunk = Buffer.alloc(SECTOR);
      data.subarray(i * SECTOR, (i + 1) * SECTOR).copy(chunk);
      sectorData.set(nextSector + i, chunk);
    }
    placement.set(index, { start: nextSector, size: data.length });
    nextSector += count;
  }

  // 3) 미니 FAT: 미니 섹터들의 연결(스트림별로 순차).
  const miniFat: number[] = [];
  entries.forEach((entry, index) => {
    if (!entry.data || entry.type !== 2) return;
    const place = placement.get(index);
    if (!place || entry.data.length >= MINI_CUTOFF) return;
    const count = Math.ceil(entry.data.length / MINI_SECTOR);
    for (let i = 0; i < count; i++) {
      miniFat[place.start + i] =
        i === count - 1 ? ENDOFCHAIN : place.start + i + 1;
    }
  });

  // 4) 디렉터리 엔트리(128B 씩).
  const dirBytes = Buffer.alloc(dirSectorCount * SECTOR, 0);
  entries.forEach((entry, index) => {
    const offset = index * 128;
    const name = Buffer.from(entry.name, "utf16le");
    name.copy(dirBytes, offset, 0, Math.min(name.length, 62));
    dirBytes.writeUInt16LE(Math.min(name.length, 62) + 2, offset + 0x40);
    dirBytes.writeUInt8(entry.type, offset + 0x42);
    dirBytes.writeUInt32LE(FREESECT, offset + 0x44); // left
    dirBytes.writeUInt32LE(entry.rightSibling ?? FREESECT, offset + 0x48);
    dirBytes.writeUInt32LE(entry.child ?? FREESECT, offset + 0x4c);
    const place = placement.get(index);
    if (index === 0) {
      // Root Entry 는 미니 스트림의 시작 섹터와 크기를 든다.
      dirBytes.writeUInt32LE(
        miniStreamSectors ? miniStreamStart : ENDOFCHAIN,
        offset + 0x74,
      );
      dirBytes.writeUInt32LE(miniStream.length, offset + 0x78);
    } else {
      dirBytes.writeUInt32LE(place ? place.start : ENDOFCHAIN, offset + 0x74);
      dirBytes.writeUInt32LE(place ? place.size : 0, offset + 0x78);
    }
  });
  for (let i = 0; i < dirSectorCount; i++) {
    sectorData.set(
      dirStart + i,
      dirBytes.subarray(i * SECTOR, (i + 1) * SECTOR),
    );
  }

  // 5) FAT / 미니FAT 섹터 기록.
  const totalSectors = nextSector;
  const fatBytes = Buffer.alloc(SECTOR, 0xff);
  for (let i = 0; i < Math.min(totalSectors, SECTOR / 4); i++) {
    fatBytes.writeUInt32LE(fat[i] ?? FREESECT, i * 4);
  }
  sectorData.set(fatSector, fatBytes);

  const miniFatBytes = Buffer.alloc(SECTOR, 0xff);
  for (let i = 0; i < Math.min(miniFat.length, SECTOR / 4); i++) {
    miniFatBytes.writeUInt32LE(miniFat[i] ?? FREESECT, i * 4);
  }
  sectorData.set(miniFatSector, miniFatBytes);

  // 6) 헤더 + 섹터들.
  const header = Buffer.alloc(SECTOR, 0);
  Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]).copy(header);
  header.writeUInt16LE(0x003e, 0x18); // minor version
  header.writeUInt16LE(0x0003, 0x1a); // major version
  header.writeUInt16LE(0xfffe, 0x1c); // byte order
  header.writeUInt16LE(9, 0x1e); // sector shift → 512
  header.writeUInt16LE(6, 0x20); // mini sector shift → 64
  header.writeUInt32LE(1, 0x2c); // FAT 섹터 수
  header.writeUInt32LE(dirStart, 0x30);
  header.writeUInt32LE(MINI_CUTOFF, 0x38);
  header.writeUInt32LE(miniFatSector, 0x3c);
  header.writeUInt32LE(1, 0x40);
  header.writeUInt32LE(ENDOFCHAIN, 0x44); // DIFAT 없음
  header.writeUInt32LE(0, 0x48);
  header.writeUInt32LE(fatSector, 0x4c);
  for (let i = 1; i < 109; i++) header.writeUInt32LE(FREESECT, 0x4c + i * 4);

  const body: Buffer[] = [header];
  for (let i = 0; i < totalSectors; i++) {
    body.push(sectorData.get(i) ?? Buffer.alloc(SECTOR, 0));
  }
  return Buffer.concat(body);
}

/** HWP5 FileHeader 스트림(256B). flags: bit0 압축, bit1 암호, bit2 배포용. */
function fileHeader(flags: number): Buffer {
  const buf = Buffer.alloc(256, 0);
  buf.write("HWP Document File", 0, "latin1");
  buf.writeUInt32LE(0x05000000, 32); // version 5.0.0.0
  buf.writeUInt32LE(flags, 36);
  return buf;
}

/**
 * PARA_TEXT 레코드 하나(tagId 67, level 0).
 *
 * 크기가 0xFFF 이상이면 헤더의 size 자리에 0xFFF 를 넣고 **다음 4바이트**에 실제
 * 크기를 쓰는 게 HWP5 규칙이다 — 긴 문단은 이 경로를 탄다.
 */
function paraTextRecord(text: string): Buffer {
  const data = Buffer.from(text, "utf16le");
  const extended = data.length >= 0xfff;
  const size = extended ? 0xfff : data.length;
  const header = Buffer.alloc(extended ? 8 : 4);
  header.writeUInt32LE(((67 & 0x3ff) | (0 << 10) | (size * 0x100000)) >>> 0, 0);
  if (extended) header.writeUInt32LE(data.length, 4);
  return Buffer.concat([header, data]);
}

/** 문단들을 담은 Section0 스트림(옵션으로 raw deflate 압축). */
function sectionStream(paragraphs: string[], compressed: boolean): Buffer {
  const raw = Buffer.concat(paragraphs.map(paraTextRecord));
  return compressed ? zlib.deflateRawSync(raw) : raw;
}

/** FileHeader + BodyText/Section0 을 갖춘 최소 HWP5 문서. */
function hwp5Fixture(paragraphs: string[], flags = 0x1): Buffer {
  const compressed = (flags & 0x1) !== 0;
  return buildCfb([
    { name: "Root Entry", type: 5, child: 1 },
    { name: "FileHeader", type: 2, data: fileHeader(flags), rightSibling: 2 },
    { name: "BodyText", type: 1, child: 3 },
    {
      name: "Section0",
      type: 2,
      data: sectionStream(paragraphs, compressed),
    },
  ]);
}

// ── 레코드 디코더 ──────────────────────────────────────────────────────────

describe("decodeHwp5ParaText", () => {
  it("UTF-16LE 본문을 읽는다", () => {
    expect(decodeHwp5ParaText(Buffer.from("한글 본문", "utf16le"))).toBe(
      "한글 본문",
    );
  });

  it("8 wchar 를 차지하는 확장 컨트롤을 통째로 건너뛴다", () => {
    // 컨트롤(코드 2) + 뒤따르는 7 wchar 를 건너뛰지 않으면 컨트롤 ID 가 한자로 섞인다.
    const control = Buffer.alloc(16);
    control.writeUInt16LE(2, 0);
    control.write("secretid", 2, "latin1");
    const data = Buffer.concat([
      Buffer.from("앞", "utf16le"),
      control,
      Buffer.from("뒤", "utf16le"),
    ]);
    expect(decodeHwp5ParaText(data)).toBe("앞뒤");
  });

  it("탭은 탭으로, 줄바꿈은 줄바꿈으로 옮긴다", () => {
    const tab = Buffer.alloc(16);
    tab.writeUInt16LE(9, 0);
    const data = Buffer.concat([
      Buffer.from("가", "utf16le"),
      tab,
      Buffer.from("나", "utf16le"),
      Buffer.from([10, 0]),
      Buffer.from("다", "utf16le"),
    ]);
    expect(decodeHwp5ParaText(data)).toBe("가\t나\n다");
  });
});

describe("extractHwp5SectionText", () => {
  it("문단 텍스트 레코드만 골라 순서대로 잇는다", () => {
    const section = Buffer.concat([
      paraTextRecord("첫 문단"),
      // 다른 태그(문단 모양 등)는 무시돼야 한다.
      (() => {
        const header = Buffer.alloc(4);
        header.writeUInt32LE((66 & 0x3ff) | ((4 & 0xfff) << 20));
        return Buffer.concat([header, Buffer.alloc(4)]);
      })(),
      paraTextRecord("둘째 문단"),
    ]);
    expect(extractHwp5SectionText(section)).toBe("첫 문단\n둘째 문단");
  });

  it("레코드가 잘려도 거기까지는 살린다", () => {
    const full = Buffer.concat([paraTextRecord("살아남은 문단")]);
    expect(extractHwp5SectionText(full.subarray(0, full.length - 4))).toContain(
      "살아남은",
    );
  });
});

// ── 문서 전체 ──────────────────────────────────────────────────────────────

describe("extractHwp5Text", () => {
  it("압축된 HWP5 문서에서 본문을 뽑는다", () => {
    const result = extractHwp5Text(
      hwp5Fixture(["마블로 회의록", "두 번째 문단입니다"]),
    );
    expect(result.empty).toBe(false);
    expect(result.text).toContain("마블로 회의록");
    expect(result.text).toContain("두 번째 문단입니다");
  });

  it("큰 문서(미니 스트림 상한 초과)는 일반 섹터 체인으로 읽는다", () => {
    // 4KB 를 넘는 스트림은 미니 스트림이 아니라 일반 섹터에 실린다 — 다른 코드
    // 경로라 별도로 확인한다.
    const long = "본문 한 줄이 길어지면 섹터를 여러 개 쓴다. ".repeat(300);
    const result = extractHwp5Text(hwp5Fixture([long], 0x0));
    expect(result.empty).toBe(false);
    expect(result.text).toContain("섹터를 여러 개 쓴다");
    expect(result.text.length).toBeGreaterThan(4096);
  });

  it("비압축 문서도 읽는다", () => {
    const result = extractHwp5Text(hwp5Fixture(["압축 안 된 본문"], 0x0));
    expect(result.text).toContain("압축 안 된 본문");
  });

  it("암호가 걸린 문서는 '읽을 수 없음' 을 이유와 함께 알린다", () => {
    const result = extractHwp5Text(hwp5Fixture(["비밀"], 0x1 | 0x2));
    expect(result.empty).toBe(true);
    expect(result.reason).toBe("unreadable");
    expect(result.detail).toContain("암호");
  });

  it("배포용(복사 방지) 문서도 이유를 밝힌다", () => {
    const result = extractHwp5Text(hwp5Fixture(["배포용"], 0x1 | 0x4));
    expect(result.reason).toBe("unreadable");
    expect(result.detail).toContain("배포용");
  });

  it("BodyText 가 없으면(배포용 ViewText 등) 조용히 빈 본문을 내지 않는다", () => {
    const doc = buildCfb([
      { name: "Root Entry", type: 5, child: 1 },
      { name: "FileHeader", type: 2, data: fileHeader(0x1), rightSibling: 2 },
      { name: "ViewText", type: 1, child: 3 },
      { name: "Section0", type: 2, data: Buffer.alloc(64, 7) },
    ]);
    const result = extractHwp5Text(doc);
    expect(result.reason).toBe("unreadable");
    expect(result.detail).toContain("BodyText");
  });

  it("CFB 가 아니거나 깨진 입력에도 throw 하지 않는다", () => {
    expect(() => extractHwp5Text(Buffer.from("PK"))).not.toThrow();
    expect(extractHwp5Text(Buffer.alloc(0)).reason).toBe("unreadable");
    expect(extractHwp5Text(Buffer.alloc(4096, 0x41)).reason).toBe("unreadable");
  });
});
