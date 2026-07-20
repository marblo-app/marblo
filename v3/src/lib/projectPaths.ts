/**
 * projectPaths — 프로젝트 폴더 경로의 기기별 해석
 * (티켓 sHyHC9RoutYHDt97UOEm: 기기 간 경로 충돌 근본 해결).
 *
 * ★무엇이 문제였나:
 *   `projects/{id}.folderPath` 는 **생성 시 1회만** 기록되고 이후 어떤 코드도
 *   갱신하지 않는다. 그런데 이 문서는 계정의 모든 기기가 공유한다. 그래서
 *   "먼저 등록한 기기의 경로"가 영구 고착되고, 다른 기기는 자기 디스크에
 *   존재할 수 없는 경로를 물려받는다 — 2026-07-20 사장님이 맥에서 겪으신
 *   `C:\Users\meloc\...` 팝업이 정확히 이것이다(윈도우 PC 가 먼저 등록).
 *   `rootPathScope.isForeignPlatformPath` / `rootPathHealth` 의 #512 진단은
 *   이 증상을 **정확히 진단**하지만 원인을 없애지는 못한다. 이 모듈이 원인을
 *   없앤다 — 진단 코드는 레거시 문서용 안전망으로 그대로 둔다.
 *
 * ★설계 (#494 텔레그램 채널 메타 동기화와 같은 패턴):
 *   "공유할 것과 기기 전용을 나눈다". 기기 전용 값(경로)은 machineId 로 칸을
 *   나눠 `folderPaths` 맵에 담고, 쓰기는 언제나 **내 칸 하나만** 건드린다
 *   (setDoc merge 의 nested map 병합). 신규 컬렉션이 아니라 기존 projects
 *   문서의 필드이므로 firestore.rules 변경·배포가 필요 없다 — projects 의
 *   `allow update: isProjectMember` 는 필드 불문이다.
 *
 * ★가장 중요한 불변식 — 폴백 금지:
 *   내 기기 칸이 없을 때 **다른 기기의 경로로 폴백하지 않는다.** 그게 정확히
 *   지금의 버그다. 없으면 "이 기기에 미등록"으로 해석하고 경로를 반환하지
 *   않는다(호출자는 폴더 선택을 유도한다). 반대로 내가 경로를 정할 때도 다른
 *   기기의 칸을 덮지 않는다 — 덮으면 다음에 그 기기에서 같은 팝업이 뜬다.
 */

import { isForeignPlatformPath } from "./rootPathScope";

/** 한 기기가 이 프로젝트를 어디에 두고 있는지. */
export interface ProjectMachinePath {
  /** 그 기기에서의 절대 경로. */
  path: string;
  /** `process.platform` 값(진단·표시용). */
  platform: string;
  /** 새니타이즈 전 원본 machineId(키는 새니타이즈되므로 값에 원본을 남긴다). */
  machineId: string;
  /** epoch-ms. */
  updatedAt: number;
}

/** machineKey → 그 기기의 경로. */
export type ProjectFolderPaths = Record<string, ProjectMachinePath>;

/** 리졸버가 읽는 프로젝트 문서의 최소 투영. */
export interface ProjectPathDoc {
  folderPath?: string;
  folderPaths?: ProjectFolderPaths;
}

/**
 * machineId 를 Firestore 맵 키로 안전하게 만든다.
 *
 * machineId 는 `${os.hostname()}-${platform}-${uuid}` 인데 hostname 에 점이
 * 흔히 들어간다(이 맥은 "MacBook-Pro.local"). 점은 Firestore 필드 경로
 * 구분자라 맵 키로 쓰면 중첩 필드로 오해될 수 있고, `__` 로 시작하는 키는
 * 예약이다. 그래서 `[A-Za-z0-9_-]` 밖의 문자를 `_` 로 바꾸고 `m_` 를 붙인다.
 * machineId 끝의 UUID 가 유일성을 보장하므로 새니타이즈로 인한 충돌은 없다.
 */
export function machineKeyFor(machineId: string): string {
  return `m_${machineId.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

/**
 * 이 프로젝트의 경로가 이 기기에서 어떤 상태인가.
 *
 * `reconnect-manager.ts` 의 own/foreign/legacy 어휘를 그대로 따른다 —
 * 같은 문제(계정 공유 문서를 기기 단위로 안전하게 해석)의 같은 해법이다.
 *
 *  - `own`          — 이 기기의 경로를 안다. 유일하게 경로를 내주는 분기.
 *  - `unregistered` — 아무 기기도 경로를 등록한 적이 없다(신규 프로젝트).
 *  - `foreign-only` — **다른 기기의 경로만** 있다. 경로를 내주지 않는다.
 *                     이 분기가 내주면 그게 바로 지금의 버그다.
 */
export type ProjectPathResolution =
  | { kind: "own"; path: string; source: "machine" | "legacy" }
  | { kind: "unregistered" }
  | { kind: "foreign-only"; otherMachines: ProjectMachinePath[] };

/** 신뢰-경계 검증: 문서에서 온 임의 값을 정규화한다. */
function parseEntry(raw: unknown): ProjectMachinePath | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const m = raw as Record<string, unknown>;
  const path = typeof m.path === "string" && m.path.trim() ? m.path : null;
  if (!path) return null;
  return {
    path,
    platform: typeof m.platform === "string" ? m.platform : "",
    machineId: typeof m.machineId === "string" ? m.machineId : "",
    updatedAt: typeof m.updatedAt === "number" ? m.updatedAt : 0,
  };
}

/** 문서의 folderPaths 맵을 검증해 정규화한다. 없거나 망가졌으면 빈 맵. */
export function parseFolderPaths(raw: unknown): ProjectFolderPaths {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: ProjectFolderPaths = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const entry = parseEntry(value);
    if (entry) out[key] = entry;
  }
  return out;
}

/**
 * 이 기기 기준으로 프로젝트 경로를 해석한다. 순수 함수 — 디스크를 보지 않는다.
 *
 * `machineId` 가 null 이면(렌더러가 아직 IPC 로 못 받아온 부팅 초기 창)
 * 내 칸을 특정할 수 없으므로 레거시 단일 필드만 보는 기존 동작으로 degrade
 * 한다. 그 경우에도 foreign-platform 경로는 여전히 차단되므로 어느 시점에도
 * 현재 동작보다 나빠지지 않는다.
 */
export function resolveProjectPath(
  doc: ProjectPathDoc,
  machineId: string | null,
): ProjectPathResolution {
  const entries = parseFolderPaths(doc.folderPaths);
  const legacy =
    typeof doc.folderPath === "string" && doc.folderPath.trim()
      ? doc.folderPath
      : null;

  // 1) 내 칸이 있으면 그것이 권위자다.
  if (machineId) {
    const mine = entries[machineKeyFor(machineId)];
    if (mine) return { kind: "own", path: mine.path, source: "machine" };
  }

  const others = Object.entries(entries)
    .filter(([key]) => !machineId || key !== machineKeyFor(machineId))
    .map(([, entry]) => entry);

  // 2) 레거시 채택(하위호환): 아직 **아무 기기도** 칸을 만들지 않았을 때만
  //    레거시 단일 경로를 "최초 등록 기기 = 나"로 간주한다.
  //
  //    ★칸이 하나라도 있으면 레거시는 그 기기 것이므로 절대 채택하지 않는다.
  //    이 가드가 없으면 맥미니↔맥북처럼 **같은 POSIX 라 shape 검사로 못 걸러
  //    지는 형제 기기** 케이스에서 남의 경로를 내 것으로 오해한다.
  //
  //    foreign-platform(다른 OS 모양) 경로는 애초에 내 것일 수 없으므로 제외
  //    한다 — 이게 사장님이 겪으신 `C:\Users\...` 케이스를 막는 지점이다.
  if (others.length === 0 && legacy && !isForeignPlatformPath(legacy)) {
    return { kind: "own", path: legacy, source: "legacy" };
  }

  // 3) 다른 기기의 경로만 있다(레거시 단일 필드만 있고 그게 남의 OS 모양인
  //    경우 포함). ★경로를 내주지 않는다.
  if (others.length > 0) {
    return { kind: "foreign-only", otherMachines: others };
  }
  if (legacy) {
    return {
      kind: "foreign-only",
      otherMachines: [
        { path: legacy, platform: "", machineId: "", updatedAt: 0 },
      ],
    };
  }

  // 4) 아무도 등록한 적 없다.
  return { kind: "unregistered" };
}

/**
 * 이 기기에서 쓸 수 있는 경로, 없으면 undefined.
 *
 * `undefined` 는 앱 전역이 이미 "로컬 경로 없음"으로 올바르게 처리하는 값이다
 * (CliSetupGate 게이트, ConnectionStatusPanel 버튼 비활성, harness 의 "프로젝트에
 * 로컬 경로가 없어 연결할 수 없습니다" 안내 등). 그래서 foreign-only 를
 * undefined 로 접는 것만으로 컴포넌트 수정 없이 올바른 UX 가 나온다.
 */
export function resolveProjectFolderPath(
  doc: ProjectPathDoc,
  machineId: string | null,
): string | undefined {
  const r = resolveProjectPath(doc, machineId);
  return r.kind === "own" ? r.path : undefined;
}

/** 이 기기 칸에 기록할 엔트리를 만든다. */
export function buildMachinePathEntry(
  machineId: string,
  path: string,
  platform: string,
  now: number,
): ProjectMachinePath {
  return { path, platform, machineId, updatedAt: now };
}

/**
 * 내 칸만 갈아끼운 새 맵을 돌려준다(다른 기기 칸은 그대로 보존).
 *
 * 실제 Firestore 쓰기는 `setDoc(..., {folderPaths: {[key]: entry}}, {merge:true})`
 * 로 내 칸만 보내므로 형제 키를 덮을 일이 애초에 없다. 이 함수는 로컬 상태
 * (인메모리 프로젝트 목록)를 같은 규칙으로 갱신하기 위한 것이다.
 */
export function withMachinePath(
  existing: ProjectFolderPaths | undefined,
  machineId: string,
  entry: ProjectMachinePath,
): ProjectFolderPaths {
  return { ...parseFolderPaths(existing), [machineKeyFor(machineId)]: entry };
}
