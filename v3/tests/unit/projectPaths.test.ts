/**
 * @vitest-environment jsdom
 *
 * `navigator` 를 쓰는 이유: 이 스위트는 POSIX 호스트를 가정한다(레포의
 * rootPathScope.test.ts 와 같은 관례) — isForeignPlatformPath 가 navigator 로
 * 호스트 OS 를 보기 때문. vitest 기본 "node" 환경엔 navigator 가 없다(Node 는
 * v21 부터 자체 제공 — 그 전역을 빌려 쓰면 이 레포 CI/릴리스 대상인 Node 20,
 * engines ">=20 <23" 에서 깨진다). jsdom 을 명시해 Node 버전과 무관하게 항상
 * 진짜 navigator 가 있게 한다.
 */
import { describe, it, expect } from "vitest";
import {
  buildMachinePathEntry,
  machineKeyFor,
  parseFolderPaths,
  resolveProjectFolderPath,
  resolveProjectPath,
  withMachinePath,
  type ProjectPathDoc,
} from "../../src/lib/projectPaths";

const onWindows = navigator.userAgent.includes("Windows");

const MAC = "MacBook-Pro.local-darwin-1111-2222";
const MAC_MINI = "dongwon-macmini.local-darwin-3333-4444";
const WIN = "DESKTOP-MELOC-win32-5555-6666";

const MAC_PATH = "/Users/dongwonkim/Documents/programming/music_composer";
const MAC_MINI_PATH = "/Users/dongwonkim/work/music_composer";
const WIN_PATH =
  "C:\\Users\\meloc\\OneDrive\\Documents\\programming\\music_composer";

function entry(machineId: string, path: string, platform: string) {
  return buildMachinePathEntry(machineId, path, platform, 1_000);
}

function docWith(...pairs: Array<[string, string, string]>): ProjectPathDoc {
  const folderPaths = pairs.reduce(
    (acc, [machineId, path, platform]) =>
      withMachinePath(acc, machineId, entry(machineId, path, platform)),
    {},
  );
  return { folderPaths };
}

// ─── 티켓이 요구한 3케이스: 내 기기 존재 / 부재 / 타 기기만 존재 ───────────
//
// 지금의 버그는 정확히 "타 기기만 존재"를 "내 경로"로 오해한 것이다. 세
// 경우의 **해석이 서로 구분되는지**가 이 스위트의 핵심이다.

describe("resolveProjectPath — 기기별 3케이스 구분", () => {
  it("① 내 기기 값 존재 → own, 내 경로를 준다", () => {
    const doc = docWith([MAC, MAC_PATH, "darwin"], [WIN, WIN_PATH, "win32"]);

    const r = resolveProjectPath(doc, MAC);

    expect(r.kind).toBe("own");
    expect(r).toMatchObject({ path: MAC_PATH, source: "machine" });
    expect(resolveProjectFolderPath(doc, MAC)).toBe(MAC_PATH);
  });

  it("② 부재(아무 기기도 등록 안 함) → unregistered, 경로 없음", () => {
    const doc: ProjectPathDoc = {};

    expect(resolveProjectPath(doc, MAC).kind).toBe("unregistered");
    expect(resolveProjectFolderPath(doc, MAC)).toBeUndefined();
  });

  it("③ ★타 기기만 존재 → foreign-only, 절대 경로를 주지 않는다 (이 티켓의 버그)", () => {
    const doc = docWith([WIN, WIN_PATH, "win32"]);

    const r = resolveProjectPath(doc, MAC);

    expect(r.kind).toBe("foreign-only");
    // ★핵심 회귀 가드: 남의 경로로 폴백하면 안 된다.
    expect(resolveProjectFolderPath(doc, MAC)).toBeUndefined();
    // 반면 진단/안내용으로 "어느 기기에 있는지"는 보존한다 — 경로를 *쓰는* 것과
    // 어디 있는지 *알려주는* 것은 다르다. 폴더 선택 유도 문구가 이걸 쓴다.
    expect(r).toMatchObject({
      otherMachines: [expect.objectContaining({ path: WIN_PATH })],
    });
  });

  it("세 케이스의 kind 가 서로 전부 다르다", () => {
    const kinds = [
      resolveProjectPath(docWith([MAC, MAC_PATH, "darwin"]), MAC).kind,
      resolveProjectPath({}, MAC).kind,
      resolveProjectPath(docWith([WIN, WIN_PATH, "win32"]), MAC).kind,
    ];
    expect(new Set(kinds).size).toBe(3);
  });
});

// ─── 사장님이 실제로 겪은 시나리오 (2026-07-20 12:30 부팅) ────────────────

describe("실제 사고 재현 — 윈도우가 먼저 등록한 프로젝트를 맥에서 열기", () => {
  it("레거시 단일 folderPath 가 다른 OS 모양이면 채택하지 않는다", () => {
    if (onWindows) return;
    const doc: ProjectPathDoc = { folderPath: WIN_PATH };

    const r = resolveProjectPath(doc, MAC);

    expect(r.kind).toBe("foreign-only");
    expect(resolveProjectFolderPath(doc, MAC)).toBeUndefined();
  });

  it("맥에서 경로를 정해도 윈도우 칸은 그대로 남는다 (반대 방향 파손 금지)", () => {
    const before = docWith([WIN, WIN_PATH, "win32"]).folderPaths!;

    const after = withMachinePath(before, MAC, entry(MAC, MAC_PATH, "darwin"));

    // 윈도우에서 다시 열면 여전히 자기 경로가 own 으로 해결돼야 한다.
    expect(resolveProjectPath({ folderPaths: after }, WIN)).toMatchObject({
      kind: "own",
      path: WIN_PATH,
    });
    expect(resolveProjectPath({ folderPaths: after }, MAC)).toMatchObject({
      kind: "own",
      path: MAC_PATH,
    });
  });
});

// ─── 하위호환 마이그레이션 ───────────────────────────────────────────────

describe("레거시 folderPath 마이그레이션", () => {
  it("아직 아무 칸도 없으면 레거시를 '최초 등록 기기 = 나'로 채택한다", () => {
    if (onWindows) return;
    const doc: ProjectPathDoc = { folderPath: MAC_PATH };

    expect(resolveProjectPath(doc, MAC)).toMatchObject({
      kind: "own",
      path: MAC_PATH,
      source: "legacy",
    });
  });

  it("★같은 POSIX 형제 기기: 칸이 이미 있으면 레거시를 채택하지 않는다", () => {
    if (onWindows) return;
    // 맥미니가 먼저 등록(레거시) 후 마이그레이션까지 끝낸 상태에서 맥북이 연다.
    // 두 경로 모두 POSIX 라 shape 검사로는 구분 불가 — 칸 존재 여부가 유일한 단서다.
    const doc: ProjectPathDoc = {
      folderPath: MAC_MINI_PATH,
      folderPaths: docWith([MAC_MINI, MAC_MINI_PATH, "darwin"]).folderPaths,
    };

    const r = resolveProjectPath(doc, MAC);

    expect(r.kind).toBe("foreign-only");
    expect(resolveProjectFolderPath(doc, MAC)).toBeUndefined();
  });

  it("마이그레이션 후 같은 기기에서 열면 체감 변화가 없다", () => {
    if (onWindows) return;
    const legacyOnly: ProjectPathDoc = { folderPath: MAC_PATH };
    const migrated: ProjectPathDoc = {
      folderPath: MAC_PATH,
      folderPaths: docWith([MAC, MAC_PATH, "darwin"]).folderPaths,
    };

    expect(resolveProjectFolderPath(legacyOnly, MAC)).toBe(
      resolveProjectFolderPath(migrated, MAC),
    );
  });

  it("machineId 를 아직 못 받아온 부팅 초기에는 레거시만 보는 기존 동작으로 degrade 한다", () => {
    if (onWindows) return;
    expect(resolveProjectFolderPath({ folderPath: MAC_PATH }, null)).toBe(
      MAC_PATH,
    );
    // 그 상태에서도 foreign-platform 경로는 여전히 차단된다.
    expect(
      resolveProjectFolderPath({ folderPath: WIN_PATH }, null),
    ).toBeUndefined();
  });
});

// ─── 맵 키 안전성 ────────────────────────────────────────────────────────

describe("machineKeyFor", () => {
  it("hostname 의 점을 없앤다 (Firestore 필드경로 구분자 충돌 방지)", () => {
    const key = machineKeyFor(MAC);
    expect(key).not.toContain(".");
    expect(key.startsWith("m_")).toBe(true);
  });

  it("예약 접두 __ 로 시작하지 않는다", () => {
    expect(machineKeyFor("__weird..host").startsWith("__")).toBe(false);
  });

  it("서로 다른 기기는 서로 다른 키를 갖는다", () => {
    expect(machineKeyFor(MAC)).not.toBe(machineKeyFor(MAC_MINI));
  });

  it("같은 machineId 는 항상 같은 키 (결정적)", () => {
    expect(machineKeyFor(MAC)).toBe(machineKeyFor(MAC));
  });
});

// ─── 신뢰 경계 ───────────────────────────────────────────────────────────

describe("parseFolderPaths — 문서에서 온 임의 값 방어", () => {
  it("망가진 입력은 빈 맵으로 접는다", () => {
    expect(parseFolderPaths(undefined)).toEqual({});
    expect(parseFolderPaths(null)).toEqual({});
    expect(parseFolderPaths("nope")).toEqual({});
    expect(parseFolderPaths([1, 2])).toEqual({});
  });

  it("path 가 없거나 빈 엔트리는 버린다", () => {
    expect(
      parseFolderPaths({ a: { platform: "darwin" }, b: { path: "   " } }),
    ).toEqual({});
  });

  it("쓰레기 엔트리만 있는 문서는 unregistered 로 해석된다", () => {
    const doc = { folderPaths: { a: { nope: true } } } as ProjectPathDoc;
    expect(resolveProjectPath(doc, MAC).kind).toBe("unregistered");
  });
});
