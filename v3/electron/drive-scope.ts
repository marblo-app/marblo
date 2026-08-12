/**
 * drive-scope — 프로젝트 위키 폴더 **경계의 집행자**. 티켓 MCTHALmNAWPpilTFwe8o.
 *
 * ── 이 파일이 푸는 문제 ──────────────────────────────────────────────────
 * `drive-project-binding.ts` 는 "프로젝트 P 의 위키 = 폴더 F" 라는 **사실**을
 * 저장할 뿐이다. 그 사실이 실제로 지켜지려면 두 질문에 답할 수 있어야 한다.
 *
 *   Q1. "F 범위 안에서만 검색하라" — Drive 의 `'X' in parents` 는 **직계 자식만**
 *       매칭한다. 위키 폴더는 거의 항상 하위 폴더를 갖고, 사용자는 당연히 하위
 *       문서도 찾히리라 기대한다. 그래서 F 의 하위 폴더를 미리 펼쳐(BFS) 부모
 *       OR 절로 넘긴다.
 *   Q2. "이 파일이 F 안에 있는가" — drive_fetch 는 file id 하나를 받는다. id 만
 *       보고는 소속을 알 수 없으므로 **parents 를 타고 위로** 올라가며 F 를
 *       만나는지 확인한다. 이 검사가 없으면 프로젝트 A 의 에이전트가 (다른 경로로
 *       알아낸) 프로젝트 B 문서의 id 를 그대로 fetch 할 수 있다 — 바인딩이
 *       장식이 되는 지점이다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **electron 의존 없음.** 커넥터 인터페이스만 받는다 — 유닛테스트가 가짜
 *    커넥터를 그대로 꽂는다.
 * 2. **상한은 있되 조용하지 않다.** 폴더 수·깊이에 상한을 두지만, 걸리면
 *    `truncated: true` 로 드러내고 호출자가 그 사실을 사용자에게 말한다.
 *    "전부 봤다" 는 오해가 지식 취득에서 가장 비싸다.
 * 3. **캐시는 TTL 로 늙는다.** 폴더 구조는 자주 바뀌지 않지만 영원하지도 않다.
 *    바인딩이 바뀌면 호출자가 `invalidate()` 로 즉시 버린다.
 */
import {
  DRIVE_FOLDER_MIME,
  type DriveFileMeta,
  type DriveListParams,
  type DriveSearchResult,
} from "./google-drive-connector";

/** 이 모듈이 커넥터에게 요구하는 최소 계약(테스트가 이걸 가짜로 구현한다). */
export interface DriveScopeConnector {
  search(params: DriveListParams): Promise<DriveSearchResult>;
  getFileMeta(fileId: string): Promise<DriveFileMeta>;
}

/** 펼친 폴더 스코프. */
export interface DriveFolderScope {
  /** 바인딩된 루트 폴더. */
  rootFolderId: string;
  /** 루트 + 하위 폴더 id 들(루트가 항상 첫 원소). */
  folderIds: string[];
  /** 상한에 걸려 일부 하위 폴더를 펼치지 못했는가. */
  truncated: boolean;
}

export interface DriveScopeOptions {
  /**
   * 펼칠 폴더 총 개수 상한.
   *
   * ★이 숫자는 취향이 아니라 **URL 길이 산수**다. 부모 절 하나는
   * `'<33자 id>' in parents` ≈ 46자이고, 홑따옴표·공백이 퍼센트 인코딩되면
   * 실제 전송 길이는 폴더당 대략 60바이트가 된다. files.list 는 GET 이라
   * 쿼리스트링이 길어지면 Google 이 414/400 으로 거절한다. 50 이면 약 3KB 로
   * 안전권에 머물고, 그보다 크게 잡으면 "폴더가 많은 사용자만 조회가 통째로
   * 실패" 하는 최악의 실패 모드가 된다 — 절단은 값으로 드러나지만(truncated)
   * 400 은 그냥 실패다.
   */
  maxFolders?: number;
  /** 하위 탐색 깊이 상한(루트=0). 순환/공유 폴더 꼬임의 안전판이기도 하다. */
  maxDepth?: number;
  /** 조상 탐색(위로 올라가기) 깊이 상한. */
  maxAncestorDepth?: number;
  /** 캐시 수명 ms. */
  ttlMs?: number;
  now?: () => number;
}

const DEFAULT_MAX_FOLDERS = 50;
const DEFAULT_MAX_DEPTH = 10;
const DEFAULT_MAX_ANCESTOR_DEPTH = 20;
const DEFAULT_TTL_MS = 5 * 60 * 1000;
/** 하위 폴더 목록 페이지 크기(커넥터 상한과 동일). */
const FOLDER_PAGE_SIZE = 100;
/** 한 폴더의 자식 폴더 페이지를 최대 몇 장까지 넘길지(폭주 방지). */
const MAX_FOLDER_PAGES = 10;

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export interface DriveScopeResolver {
  /** 루트 폴더의 하위트리를 펼친다(캐시됨). */
  resolveSubtree(rootFolderId: string): Promise<DriveFolderScope>;
  /** fileId 가 rootFolderId 하위(자기 자신 포함)인가. */
  isWithinScope(fileId: string, rootFolderId: string): Promise<boolean>;
  /** 캐시 무효화. 인자가 없으면 전부. */
  invalidate(rootFolderId?: string): void;
}

/**
 * 스코프 해석기. 커넥터 1개(= 유저 1명의 Drive)에 하나씩 만들어 쓴다.
 */
export function createDriveScopeResolver(
  connector: DriveScopeConnector,
  options: DriveScopeOptions = {},
): DriveScopeResolver {
  const maxFolders = options.maxFolders ?? DEFAULT_MAX_FOLDERS;
  const maxDepth = options.maxDepth ?? DEFAULT_MAX_DEPTH;
  const maxAncestorDepth =
    options.maxAncestorDepth ?? DEFAULT_MAX_ANCESTOR_DEPTH;
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const clock = options.now ?? Date.now;

  const subtreeCache = new Map<string, CacheEntry<DriveFolderScope>>();
  const ancestryCache = new Map<string, CacheEntry<boolean>>();

  /**
   * 한 폴더의 직계 하위 **폴더**들. 페이지는 상한까지만 넘기되, 남은 페이지가
   * 있었다는 사실을 `truncated` 로 함께 돌려준다 — 조용히 버리면 상한을 올린
   * 미래의 누군가가 "다 훑었다" 고 믿는다(모듈 규율 #2).
   */
  async function childFolders(
    folderId: string,
  ): Promise<{ folders: DriveFileMeta[]; truncated: boolean }> {
    const folders: DriveFileMeta[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_FOLDER_PAGES; page += 1) {
      const result: DriveSearchResult = await connector.search({
        folderId,
        // 폴더만 원한다 — includeFolders 를 켜지 않으면 쿼리 빌더가
        // `mimeType != folder` 를 붙여 결과가 항상 비어 버린다.
        includeFolders: true,
        mimeTypes: [DRIVE_FOLDER_MIME],
        pageSize: FOLDER_PAGE_SIZE,
        pageToken,
      });
      for (const file of result.files) {
        if (file.isFolder) folders.push(file);
      }
      pageToken = result.nextPageToken;
      if (!pageToken) return { folders, truncated: false };
    }
    // 루프를 끝까지 돌았는데 pageToken 이 남아 있다 = 아직 더 있다.
    return { folders, truncated: !!pageToken };
  }

  /**
   * ★`failed` 는 캐시 가능성의 판정 기준이다.
   *
   * 절단(truncated)에는 성격이 다른 두 원인이 섞인다. 상한에 걸린 것은
   * **안정된 사실**이라 캐시해도 된다(다음에 물어도 같은 답이다). 반면 Drive
   * 호출이 실패해서 못 펼친 것은 **일시적 사고**다 — 그걸 5분 캐시에 넣으면
   * 429 한 번이 "이 프로젝트 위키는 루트뿐" 이라는 상태를 5분간 고정한다.
   */
  interface SubtreeComputation {
    scope: DriveFolderScope;
    /** 하나라도 Drive 호출이 실패했는가(= 이 결과는 캐시하면 안 된다). */
    failed: boolean;
  }

  async function computeSubtree(
    rootFolderId: string,
  ): Promise<SubtreeComputation> {
    const folderIds: string[] = [rootFolderId];
    const seen = new Set<string>([rootFolderId]);
    let truncated = false;
    let failed = false;

    let frontier: string[] = [rootFolderId];
    for (let depth = 0; depth < maxDepth; depth += 1) {
      if (frontier.length === 0) break;
      const next: string[] = [];
      for (const folderId of frontier) {
        let children: DriveFileMeta[];
        try {
          const listed = await childFolders(folderId);
          children = listed.folders;
          if (listed.truncated) truncated = true;
        } catch {
          // 한 하위 폴더를 못 읽는다고(권한·일시오류) 스코프 전체를 실패시키지
          // 않는다. 대신 "전부 펼치지는 못했다"(truncated) + "그 원인이 사고였다"
          // (failed) 를 함께 남긴다 — 후자가 캐시를 막는다.
          truncated = true;
          failed = true;
          continue;
        }
        for (const child of children) {
          if (seen.has(child.id)) continue; // 공유 폴더가 두 곳에 걸릴 수 있다
          if (folderIds.length >= maxFolders) {
            // 상한 도달은 안정된 사실이라 failed 가 아니다(캐시 가능).
            return {
              scope: { rootFolderId, folderIds, truncated: true },
              failed,
            };
          }
          seen.add(child.id);
          folderIds.push(child.id);
          next.push(child.id);
        }
      }
      frontier = next;
    }
    // 깊이 상한에서 멈췄는데 아직 펼칠 폴더가 남아 있으면 그것도 절단이다.
    if (frontier.length > 0) truncated = true;

    return { scope: { rootFolderId, folderIds, truncated }, failed };
  }

  function cached<T>(
    cache: Map<string, CacheEntry<T>>,
    key: string,
  ): T | undefined {
    const entry = cache.get(key);
    if (!entry) return undefined;
    if (entry.expiresAt <= clock()) {
      cache.delete(key);
      return undefined;
    }
    return entry.value;
  }

  return {
    async resolveSubtree(rootFolderId: string): Promise<DriveFolderScope> {
      const hit = cached(subtreeCache, rootFolderId);
      if (hit) return hit;
      const { scope, failed } = await computeSubtree(rootFolderId);
      // ★사고로 못 펼친 결과는 캐시하지 않는다. 넣으면 429 한 번이 "이 위키는
      // 루트뿐" 이라는 상태를 TTL 내내 고정하고, 그 사이 Drive 가 멀쩡해져도
      // 다시 훑지 않는다. 이번 호출엔 확보한 것만 돌려주고(truncated 로 정직히
      // 알리고), 다음 호출이 새로 시도하게 둔다.
      if (!failed) {
        subtreeCache.set(rootFolderId, {
          value: scope,
          expiresAt: clock() + ttlMs,
        });
      }
      return scope;
    },

    async isWithinScope(
      fileId: string,
      rootFolderId: string,
    ): Promise<boolean> {
      if (!fileId || !rootFolderId) return false;
      // 위키 폴더 그 자체를 가리키는 id 는 범위 안이다.
      if (fileId === rootFolderId) return true;

      const cacheKey = `${fileId} ${rootFolderId}`;
      const hit = cached(ancestryCache, cacheKey);
      if (hit !== undefined) return hit;

      // parents 를 타고 위로. Drive 파일은 부모가 여럿일 수 있어(구식 공유)
      // 큐로 훑되, 방문 집합과 깊이 상한으로 순환·폭주를 막는다.
      let verdict = false;
      let failed = false;
      const visited = new Set<string>([fileId]);
      let frontier: string[] = [fileId];

      outer: for (let depth = 0; depth < maxAncestorDepth; depth += 1) {
        if (frontier.length === 0) break;
        const next: string[] = [];
        for (const id of frontier) {
          let meta: DriveFileMeta;
          try {
            meta = await connector.getFileMeta(id);
          } catch {
            // 조상을 못 읽으면 그 가지는 "확인 불가" 다. 확인되지 않은 것을
            // 통과시키지 않는다(fail-closed) — 다른 가지가 증명하면 통과한다.
            failed = true;
            continue;
          }
          for (const parent of meta.parents ?? []) {
            if (parent === rootFolderId) {
              verdict = true;
              break outer;
            }
            if (visited.has(parent)) continue;
            visited.add(parent);
            next.push(parent);
          }
        }
        frontier = next;
      }

      // ★"범위 밖임을 증명했다" 와 "확인하지 못했다" 는 다른 사실이다. 둘 다
      // 이번 호출은 막지만(fail-closed), 후자를 캐시하면 429 한 번이 정당한
      // 파일에 TTL 내내 "다른 프로젝트 문서입니다" 딱지를 붙인다 — 에이전트가
      // 없는 사실을 단정하게 만드는, 이 모듈이 가장 피해야 할 실패다.
      // 통과(true)는 증명된 사실이라 실패 여부와 무관하게 캐시한다.
      if (verdict || !failed) {
        ancestryCache.set(cacheKey, {
          value: verdict,
          expiresAt: clock() + ttlMs,
        });
      }
      return verdict;
    },

    invalidate(rootFolderId?: string): void {
      if (!rootFolderId) {
        subtreeCache.clear();
        ancestryCache.clear();
        return;
      }
      subtreeCache.delete(rootFolderId);
      const suffix = ` ${rootFolderId}`;
      for (const key of [...ancestryCache.keys()]) {
        if (key.endsWith(suffix)) ancestryCache.delete(key);
      }
    },
  };
}

// ── 접근 모드 결정 (★"스코프가 걸리는가" 를 정하는 코드) ──────────────────
//
// 여기 있는 것들은 main.ts 에 있던 판단을 옮겨온 것이다. 옮긴 이유는 하나다:
// **스코프가 적용되는지 여부를 정하는 코드가 테스트 밖에 있으면 안 된다.**
// main.ts 는 electron 을 임포트해 node 테스트가 로드할 수 없고, 그 안에 있는 한
// "에이전트 경로는 항상 프로젝트 스코프" 라는 이 기능의 핵심 불변식에 회귀
// 테스트를 걸 방법이 없었다. 이 모듈은 순수 TS 라 그대로 검증된다.

import type { DriveProjectBinding } from "./drive-project-binding";

/** 접근 모드 — 두 개의 호출 경로. */
export type DriveAccess =
  /** 사람이 자기 드라이브를 보는 화면(폴더 피커). 스코프 없음. */
  | { mode: "user" }
  /** 에이전트 경로. 이 프로젝트의 바인딩 폴더 밖은 보이지 않는다. */
  | { mode: "project"; projectId: string | null };

/** 검색 응답에 함께 실리는 스코프 사실(어디를 뒤졌는지 숨기지 않는다). */
export interface DriveScopeInfo {
  folderId: string;
  folderName: string | null;
  /** 실제로 쿼리에 넣은 폴더 수(루트 포함). */
  folderCount: number;
  /** 상한/권한 때문에 하위 폴더 일부를 펼치지 못했는가. */
  truncated: boolean;
}

/**
 * 요청 payload → 접근 모드.
 *
 * ★기본값이 `user`(비스코프)인 것은 **렌더러 IPC 한정**의 기본값이다. 에이전트
 * 경로(브리지)는 이 함수를 거치지 않고 `{ mode: "project" }` 를 직접 넘기며,
 * 그쪽 게이트웨이 시그니처가 projectId 를 필수로 요구한다.
 */
export function driveAccessFromInput(
  raw: Record<string, unknown>,
): DriveAccess {
  const projectId =
    typeof raw.projectId === "string" && raw.projectId.trim()
      ? raw.projectId.trim()
      : null;
  return raw.scope === "project"
    ? { mode: "project", projectId }
    : { mode: "user" };
}

export function driveNoProjectError(): { ok: false; error: string } {
  return {
    ok: false,
    error:
      "어느 프로젝트의 위키를 읽어야 할지 알 수 없습니다(projectId 없음). " +
      "Marblo 가 띄운 에이전트가 아니면 프로젝트 Drive 지식에 접근할 수 없습니다.",
  };
}

export function driveNoBindingError(projectId: string): {
  ok: false;
  error: string;
} {
  return {
    ok: false,
    error:
      `이 프로젝트(${projectId})에 위키로 쓸 Google Drive 폴더가 지정되지 않았습니다. ` +
      "Harness 탭 → Google Drive 연동에서 이 프로젝트의 위키 폴더를 선택해 주세요.",
  };
}

/**
 * 프로젝트 모드에서 실제로 검색할 폴더 집합을 정한다.
 *
 * 호출자가 folder_id 를 명시했다면 **그 폴더가 바인딩 폴더 하위인지 검증**한다.
 * 이 검증이 없으면 에이전트가 임의의 폴더 id 를 넣어 스코프를 우회할 수 있다 —
 * 바인딩이 장식이 되는 정확한 지점이다.
 */
export async function resolveProjectFolderScope(
  resolver: DriveScopeResolver,
  binding: DriveProjectBinding,
  requestedFolderId?: string,
): Promise<
  | { ok: true; folderIds: string[]; scope: DriveScopeInfo }
  | { ok: false; error: string }
> {
  const subtree = await resolver.resolveSubtree(binding.folderId);
  const scope: DriveScopeInfo = {
    folderId: binding.folderId,
    folderName: binding.folderName,
    folderCount: subtree.folderIds.length,
    truncated: subtree.truncated,
  };

  if (!requestedFolderId) {
    return { ok: true, folderIds: subtree.folderIds, scope };
  }

  // 하위트리 목록에 없더라도, 절단됐다면 조상 탐색으로 한 번 더 확인한다
  // (깊은 폴더가 상한 밖에 있었을 뿐일 수 있다).
  const allowed =
    subtree.folderIds.includes(requestedFolderId) ||
    (subtree.truncated &&
      (await resolver.isWithinScope(requestedFolderId, binding.folderId)));
  if (!allowed) {
    return {
      ok: false,
      error: `요청한 폴더는 이 프로젝트의 위키 폴더(${
        binding.folderName ?? binding.folderId
      }) 안에 없습니다. 이 프로젝트의 에이전트는 위키 폴더 하위만 읽을 수 있습니다.`,
    };
  }
  // 한 폴더의 직계 자식만 훑는 검색이다 — 하위트리를 다 못 펼쳤다는 사실은
  // **이 검색과 무관**하다. 그대로 물려주면 "폴더 하나를 봤을 뿐인데 일부만
  // 검색했다" 는 엉뚱한 경고가 붙는다.
  return {
    ok: true,
    folderIds: [requestedFolderId],
    scope: { ...scope, folderCount: 1, truncated: false },
  };
}

/**
 * 검색 파라미터에 프로젝트 스코프를 적용한다. 바인딩이 없으면 **검색 자체가
 * 성립하지 않는다** — 미바인딩을 "드라이브 전체" 로 해석하지 않는 지점이다.
 */
export async function planScopedSearch(
  resolver: DriveScopeResolver,
  projectId: string | null,
  binding: DriveProjectBinding | null,
  params: DriveListParams,
): Promise<
  | { ok: true; params: DriveListParams; scope: DriveScopeInfo }
  | { ok: false; error: string }
> {
  if (!projectId) return driveNoProjectError();
  if (!binding) return driveNoBindingError(projectId);

  const resolved = await resolveProjectFolderScope(
    resolver,
    binding,
    params.folderId,
  );
  if (!resolved.ok) return resolved;

  return {
    ok: true,
    params: {
      ...params,
      // 호출자가 준 folderId 는 위에서 검증·정규화돼 folderIds 로 들어간다.
      folderId: undefined,
      folderIds: resolved.folderIds,
    },
    scope: resolved.scope,
  };
}

/**
 * 이 파일을 이 프로젝트가 읽어도 되는가. id 만으로는 소속을 알 수 없으므로
 * parents 를 타고 올라가 바인딩 폴더를 만나는지 확인한다 — drive_fetch 쪽
 * 교차오염 방어선 전부다.
 */
export async function authorizeScopedFetch(
  resolver: DriveScopeResolver,
  projectId: string | null,
  binding: DriveProjectBinding | null,
  fileId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!projectId) return driveNoProjectError();
  if (!binding) return driveNoBindingError(projectId);

  if (await resolver.isWithinScope(fileId, binding.folderId))
    return { ok: true };
  return {
    ok: false,
    error: `이 파일은 이 프로젝트의 위키 폴더(${
      binding.folderName ?? binding.folderId
    }) 안에 없습니다. 다른 프로젝트나 개인 문서는 읽을 수 없습니다.`,
  };
}
