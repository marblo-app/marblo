/**
 * Drive 위키 폴더 **경계 집행** — 티켓 MCTHALmNAWPpilTFwe8o.
 *
 * 검증 대상은 두 가지다.
 *   1. 하위트리 펼치기(BFS) — `in parents` 가 직계만 매칭하므로 하위 폴더까지
 *      닿으려면 미리 펼쳐야 한다. 상한에 걸리면 **truncated 로 드러나야** 한다.
 *   2. 조상 탐색 — file id 하나만 갖고 "이게 우리 위키 안인가" 를 답한다.
 *      이게 drive_fetch 의 유일한 방어선이라, false 가 나와야 할 때 확실히
 *      false 여야 한다(교차 오염).
 *
 * 네트워크 없이 가짜 커넥터를 꽂는다 — 검증하는 것은 우리 로직이지 Drive 가 아니다.
 */
import { describe, it, expect } from "vitest";
import {
  authorizeScopedFetch,
  createDriveScopeResolver,
  driveAccessFromInput,
  planScopedSearch,
  type DriveScopeConnector,
} from "../../electron/drive-scope";
import {
  DRIVE_FOLDER_MIME,
  type DriveFileMeta,
  type DriveListParams,
  type DriveSearchResult,
} from "../../electron/google-drive-connector";

/** 가짜 Drive: 폴더트리 + 파일의 부모 관계만 있는 최소 세계. */
function fakeDrive(tree: {
  /** folderId → 자식 폴더 id 들 */
  folders: Record<string, string[]>;
  /** fileId → 부모 id 들 */
  parents?: Record<string, string[]>;
  /** getFileMeta 가 실패해야 하는 id 들 */
  unreadable?: string[];
}): DriveScopeConnector & { searchCalls: DriveListParams[] } {
  const searchCalls: DriveListParams[] = [];
  return {
    searchCalls,
    async search(params: DriveListParams): Promise<DriveSearchResult> {
      searchCalls.push(params);
      const children = tree.folders[params.folderId ?? ""] ?? [];
      const files: DriveFileMeta[] = children.map((id) => ({
        id,
        title: id,
        mimeType: DRIVE_FOLDER_MIME,
        isFolder: true,
      }));
      return { files, query: "" };
    },
    async getFileMeta(fileId: string): Promise<DriveFileMeta> {
      if (tree.unreadable?.includes(fileId)) {
        throw new Error("403");
      }
      const parents =
        tree.parents?.[fileId] ??
        // 폴더도 부모를 갖는다 — folders 맵을 역인덱싱해서 찾는다.
        Object.entries(tree.folders)
          .filter(([, children]) => children.includes(fileId))
          .map(([parent]) => parent);
      return {
        id: fileId,
        title: fileId,
        mimeType: "text/plain",
        isFolder: false,
        parents,
      };
    },
  };
}

describe("resolveSubtree", () => {
  it("루트와 하위 폴더 전부를 펼친다(직계만 보면 위키 절반을 못 본다)", async () => {
    const drive = fakeDrive({
      folders: {
        wiki: ["team", "archive"],
        team: ["team-2026"],
        archive: [],
        "team-2026": [],
      },
    });
    const resolver = createDriveScopeResolver(drive);

    const scope = await resolver.resolveSubtree("wiki");
    expect(scope.folderIds).toEqual(["wiki", "team", "archive", "team-2026"]);
    expect(scope.truncated).toBe(false);
  });

  it("같은 폴더를 두 번 담지 않는다(공유 폴더가 두 곳에 걸릴 수 있다)", async () => {
    const drive = fakeDrive({
      folders: {
        wiki: ["a", "b"],
        a: ["shared"],
        b: ["shared"],
        shared: [],
      },
    });
    const scope = await createDriveScopeResolver(drive).resolveSubtree("wiki");
    expect(scope.folderIds).toEqual(["wiki", "a", "b", "shared"]);
  });

  it("폴더 수 상한에 걸리면 truncated 로 드러낸다(조용한 절단 금지)", async () => {
    const drive = fakeDrive({
      folders: { wiki: ["a", "b", "c", "d"], a: [], b: [], c: [], d: [] },
    });
    const scope = await createDriveScopeResolver(drive, {
      maxFolders: 3,
    }).resolveSubtree("wiki");

    expect(scope.folderIds).toHaveLength(3);
    expect(scope.truncated).toBe(true);
  });

  it("깊이 상한에 걸려도 truncated 로 드러낸다", async () => {
    const drive = fakeDrive({
      folders: { wiki: ["l1"], l1: ["l2"], l2: ["l3"], l3: [] },
    });
    const scope = await createDriveScopeResolver(drive, {
      maxDepth: 1,
    }).resolveSubtree("wiki");

    expect(scope.folderIds).toEqual(["wiki", "l1"]);
    expect(scope.truncated).toBe(true);
  });

  it("한 하위 폴더를 못 읽어도 나머지는 살리고 사실만 남긴다", async () => {
    const drive: DriveScopeConnector = {
      async search(params) {
        if (params.folderId === "locked") throw new Error("403");
        const map: Record<string, string[]> = { wiki: ["ok", "locked"] };
        return {
          files: (map[params.folderId ?? ""] ?? []).map((id) => ({
            id,
            title: id,
            mimeType: DRIVE_FOLDER_MIME,
            isFolder: true,
          })),
          query: "",
        };
      },
      async getFileMeta(fileId) {
        return {
          id: fileId,
          title: fileId,
          mimeType: "text/plain",
          isFolder: false,
        };
      },
    };
    const scope = await createDriveScopeResolver(drive).resolveSubtree("wiki");
    expect(scope.folderIds).toEqual(["wiki", "ok", "locked"]);
    expect(scope.truncated).toBe(true);
  });

  it("TTL 안에서는 캐시를 쓰고, invalidate 하면 다시 훑는다", async () => {
    const drive = fakeDrive({ folders: { wiki: ["a"], a: [] } });
    const resolver = createDriveScopeResolver(drive);

    await resolver.resolveSubtree("wiki");
    const afterFirst = drive.searchCalls.length;
    await resolver.resolveSubtree("wiki");
    expect(drive.searchCalls.length).toBe(afterFirst);

    resolver.invalidate("wiki");
    await resolver.resolveSubtree("wiki");
    expect(drive.searchCalls.length).toBeGreaterThan(afterFirst);
  });

  it("TTL 이 지나면 캐시가 늙는다", async () => {
    const drive = fakeDrive({ folders: { wiki: ["a"], a: [] } });
    let clock = 1_000;
    const resolver = createDriveScopeResolver(drive, {
      ttlMs: 100,
      now: () => clock,
    });

    await resolver.resolveSubtree("wiki");
    const afterFirst = drive.searchCalls.length;
    clock += 1_000;
    await resolver.resolveSubtree("wiki");
    expect(drive.searchCalls.length).toBeGreaterThan(afterFirst);
  });
});

describe("isWithinScope — ★교차 오염 방어선", () => {
  const tree = {
    folders: {
      "wiki-a": ["a-sub"],
      "a-sub": [],
      "wiki-b": ["b-sub"],
      "b-sub": [],
    },
    parents: {
      "doc-a": ["a-sub"],
      "doc-b": ["b-sub"],
      "doc-loose": ["some-other-folder"],
    },
  };

  it("바인딩 폴더 하위 문서는 통과한다(깊이 2)", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(await resolver.isWithinScope("doc-a", "wiki-a")).toBe(true);
  });

  it("★프로젝트 B 의 문서는 프로젝트 A 스코프에서 막힌다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(await resolver.isWithinScope("doc-b", "wiki-a")).toBe(false);
    expect(await resolver.isWithinScope("doc-a", "wiki-b")).toBe(false);
  });

  it("어느 위키에도 안 속한 개인 문서는 막힌다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(await resolver.isWithinScope("doc-loose", "wiki-a")).toBe(false);
  });

  it("바인딩 폴더 자기 자신은 범위 안이다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(await resolver.isWithinScope("wiki-a", "wiki-a")).toBe(true);
  });

  it("조상을 못 읽으면 통과시키지 않는다(fail-closed)", async () => {
    const resolver = createDriveScopeResolver(
      fakeDrive({
        folders: { "wiki-a": ["a-sub"], "a-sub": [] },
        parents: { "doc-x": ["a-sub"] },
        unreadable: ["doc-x"],
      }),
    );
    expect(await resolver.isWithinScope("doc-x", "wiki-a")).toBe(false);
  });

  it("부모 순환이 있어도 멈춘다(무한 루프 금지)", async () => {
    const resolver = createDriveScopeResolver(
      fakeDrive({
        folders: {},
        parents: { x: ["y"], y: ["x"] },
      }),
    );
    expect(await resolver.isWithinScope("x", "wiki-a")).toBe(false);
  });

  it("조상 깊이 상한을 넘는 문서는 통과시키지 않는다", async () => {
    const resolver = createDriveScopeResolver(
      fakeDrive({
        folders: {},
        parents: { deep: ["mid"], mid: ["wiki-a"] },
      }),
      { maxAncestorDepth: 1 },
    );
    expect(await resolver.isWithinScope("deep", "wiki-a")).toBe(false);
    // 한 단계 위(mid)는 상한 안이라 통과한다 — 상한이 스코프 자체를 망가뜨리지
    // 않는다는 대조군.
    expect(await resolver.isWithinScope("mid", "wiki-a")).toBe(true);
  });

  it("빈 id 는 거절한다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(await resolver.isWithinScope("", "wiki-a")).toBe(false);
    expect(await resolver.isWithinScope("doc-a", "")).toBe(false);
  });
});

// ── ★일시적 오류를 "사실" 로 캐시하지 않는다 ─────────────────────────────
//
// fail-closed 는 옳지만, 그 판정의 **근거가 사고**였다면 캐시해선 안 된다.
// 429 한 번이 정당한 파일에 TTL 내내 "다른 프로젝트 문서입니다" 딱지를 붙이면,
// 에이전트는 없는 사실(그 문서는 우리 것이 아니다)을 단정하게 된다.

describe("전이적 실패는 캐시하지 않는다", () => {
  it("getFileMeta 가 일시 실패하면 그 false 를 기억하지 않는다", async () => {
    let failNext = true;
    const drive: DriveScopeConnector = {
      async search() {
        return { files: [], query: "" };
      },
      async getFileMeta(fileId) {
        if (failNext) throw new Error("429 rate limit");
        return {
          id: fileId,
          title: fileId,
          mimeType: "text/plain",
          isFolder: false,
          parents: ["wiki-a"],
        };
      },
    };
    const resolver = createDriveScopeResolver(drive);

    // 1차: Drive 가 삐끗 → 통과시키지 않는다(fail-closed).
    expect(await resolver.isWithinScope("doc-a", "wiki-a")).toBe(false);

    // 2차: Drive 회복 → 캐시된 false 에 갇히지 않고 다시 확인해 통과한다.
    failNext = false;
    expect(await resolver.isWithinScope("doc-a", "wiki-a")).toBe(true);
  });

  it("범위 밖임을 '증명한' false 는 캐시한다(재조회 낭비 금지)", async () => {
    let metaCalls = 0;
    const drive: DriveScopeConnector = {
      async search() {
        return { files: [], query: "" };
      },
      async getFileMeta(fileId) {
        metaCalls += 1;
        return {
          id: fileId,
          title: fileId,
          mimeType: "text/plain",
          isFolder: false,
          parents: ["someone-elses-folder"],
        };
      },
    };
    const resolver = createDriveScopeResolver(drive);

    expect(await resolver.isWithinScope("doc-b", "wiki-a")).toBe(false);
    const afterFirst = metaCalls;
    expect(await resolver.isWithinScope("doc-b", "wiki-a")).toBe(false);
    expect(metaCalls).toBe(afterFirst); // 캐시 적중
  });

  it("폴더 목록이 일시 실패하면 반쪽 하위트리를 캐시하지 않는다", async () => {
    let failNext = true;
    const drive: DriveScopeConnector = {
      async search(params) {
        if (failNext) throw new Error("500");
        const map: Record<string, string[]> = { wiki: ["a", "b"], a: [], b: [] };
        return {
          files: (map[params.folderId ?? ""] ?? []).map((id) => ({
            id,
            title: id,
            mimeType: DRIVE_FOLDER_MIME,
            isFolder: true,
          })),
          query: "",
        };
      },
      async getFileMeta(fileId) {
        return {
          id: fileId,
          title: fileId,
          mimeType: "text/plain",
          isFolder: false,
        };
      },
    };
    const resolver = createDriveScopeResolver(drive);

    const first = await resolver.resolveSubtree("wiki");
    expect(first.folderIds).toEqual(["wiki"]);
    expect(first.truncated).toBe(true);

    // Drive 회복 → 다시 훑어 온전한 하위트리를 얻는다.
    failNext = false;
    const second = await resolver.resolveSubtree("wiki");
    expect(second.folderIds).toEqual(["wiki", "a", "b"]);
    expect(second.truncated).toBe(false);
  });

  it("상한 도달로 인한 절단은 안정된 사실이라 캐시한다", async () => {
    const drive = fakeDrive({
      folders: { wiki: ["a", "b", "c"], a: [], b: [], c: [] },
    });
    const resolver = createDriveScopeResolver(drive, { maxFolders: 2 });

    const first = await resolver.resolveSubtree("wiki");
    expect(first.truncated).toBe(true);
    const afterFirst = drive.searchCalls.length;
    await resolver.resolveSubtree("wiki");
    expect(drive.searchCalls.length).toBe(afterFirst); // 캐시 적중
  });

  it("자식 폴더 페이지 상한에 걸리면 조용히 버리지 않고 절단으로 알린다", async () => {
    // nextPageToken 을 끝없이 돌려주는 폴더 — 페이지 상한이 먼저 걸린다.
    const drive: DriveScopeConnector = {
      async search(params) {
        if (params.folderId !== "wiki") return { files: [], query: "" };
        return {
          files: [
            {
              id: `child-${params.pageToken ?? "0"}`,
              title: "child",
              mimeType: DRIVE_FOLDER_MIME,
              isFolder: true,
            },
          ],
          nextPageToken: `p${(params.pageToken ?? "0").length + 1}`,
          query: "",
        };
      },
      async getFileMeta(fileId) {
        return {
          id: fileId,
          title: fileId,
          mimeType: "text/plain",
          isFolder: false,
        };
      },
    };
    const scope = await createDriveScopeResolver(drive, {
      maxFolders: 10_000,
      maxDepth: 1,
    }).resolveSubtree("wiki");

    expect(scope.truncated).toBe(true);
  });
});

// ── ★"스코프가 걸리는가" 자체의 회귀 테스트 ──────────────────────────────
//
// 이전에는 이 판단이 main.ts 안에 있어(= electron 임포트) 테스트가 불가능했다.
// 이 기능의 핵심 불변식이 하필 검증 사각지대에 있던 셈이라 drive-scope 로
// 옮겼다. 여기 있는 것들이 그 불변식의 회귀 테스트다.

describe("driveAccessFromInput", () => {
  it("scope 를 명시하지 않으면 사람이 고르는 화면(비스코프)이다", () => {
    expect(driveAccessFromInput({})).toEqual({ mode: "user" });
    expect(driveAccessFromInput({ projectId: "p1" })).toEqual({ mode: "user" });
  });

  it('scope:"project" 면 프로젝트 스코프다', () => {
    expect(driveAccessFromInput({ scope: "project", projectId: "p1" })).toEqual({
      mode: "project",
      projectId: "p1",
    });
  });

  it("빈/비문자 projectId 는 null 로 좁힌다(빈 문자열이 통과하면 안 된다)", () => {
    expect(driveAccessFromInput({ scope: "project", projectId: "   " })).toEqual(
      { mode: "project", projectId: null },
    );
    expect(driveAccessFromInput({ scope: "project", projectId: 42 })).toEqual({
      mode: "project",
      projectId: null,
    });
  });
});

describe("planScopedSearch — 에이전트 경로는 언제나 스코프된다", () => {
  const binding = {
    projectId: "project-a",
    folderId: "wiki-a",
    folderName: "A 위키",
    updatedAt: 1,
  };
  const tree = {
    folders: { "wiki-a": ["a-sub"], "a-sub": [], "wiki-b": ["b-sub"] },
  };

  it("★바인딩이 없으면 조회 자체를 거절한다(드라이브 전체로 넓히지 않는다)", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const planned = await planScopedSearch(resolver, "project-a", null, {});
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toContain("지정되지 않았습니다");
  });

  it("projectId 를 모르면 거절한다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const planned = await planScopedSearch(resolver, null, binding, {});
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toContain("projectId 없음");
  });

  it("바인딩 폴더의 하위트리를 folderIds 로 실어 보낸다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const planned = await planScopedSearch(resolver, "project-a", binding, {
      text: "분기 보고",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.params.folderIds).toEqual(["wiki-a", "a-sub"]);
    expect(planned.params.text).toBe("분기 보고");
    expect(planned.scope.folderId).toBe("wiki-a");
  });

  it("★호출자가 범위 밖 폴더를 지정하면 거절한다(스코프 우회 차단)", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const planned = await planScopedSearch(resolver, "project-a", binding, {
      folderId: "wiki-b",
    });
    expect(planned.ok).toBe(false);
    if (!planned.ok) expect(planned.error).toContain("안에 없습니다");
  });

  it("범위 안의 하위 폴더 지정은 허용하고 그 폴더만 훑는다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const planned = await planScopedSearch(resolver, "project-a", binding, {
      folderId: "a-sub",
    });
    expect(planned.ok).toBe(true);
    if (!planned.ok) return;
    expect(planned.params.folderIds).toEqual(["a-sub"]);
    // 원래의 folderId 는 지워져야 한다 — 남으면 부모 절이 중복된다.
    expect(planned.params.folderId).toBeUndefined();
    // 폴더 하나만 본 검색에 "하위트리를 다 못 폈다" 경고가 붙으면 안 된다.
    expect(planned.scope.truncated).toBe(false);
    expect(planned.scope.folderCount).toBe(1);
  });
});

describe("authorizeScopedFetch — id 하나로는 소속을 알 수 없다", () => {
  const bindingA = {
    projectId: "project-a",
    folderId: "wiki-a",
    folderName: "A 위키",
    updatedAt: 1,
  };
  const tree = {
    folders: { "wiki-a": ["a-sub"], "a-sub": [], "wiki-b": ["b-sub"] },
    parents: { "doc-a": ["a-sub"], "doc-b": ["b-sub"] },
  };

  it("바인딩 폴더 하위 문서는 허용한다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    expect(
      await authorizeScopedFetch(resolver, "project-a", bindingA, "doc-a"),
    ).toEqual({ ok: true });
  });

  it("★다른 프로젝트의 문서 id 는 거절한다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const result = await authorizeScopedFetch(
      resolver,
      "project-a",
      bindingA,
      "doc-b",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("안에 없습니다");
  });

  it("바인딩이 없으면 거절한다", async () => {
    const resolver = createDriveScopeResolver(fakeDrive(tree));
    const result = await authorizeScopedFetch(
      resolver,
      "project-a",
      null,
      "doc-a",
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toContain("지정되지 않았습니다");
  });
});
