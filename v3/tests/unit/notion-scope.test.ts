import { describe, it, expect } from "vitest";
import {
  authorizeScopedNotionFetch,
  notionAccessFromInput,
  planScopedNotionSearch,
} from "../../electron/notion-scope";
import type {
  NotionConnector,
  NotionDocument,
  NotionObjectMeta,
  NotionSearchParams,
  NotionSearchResult,
} from "../../electron/notion-connector";

function fakeConnector(opts: {
  databasePages?: NotionObjectMeta[];
  childPages?: NotionObjectMeta[];
  metas?: Record<string, NotionObjectMeta>;
}): NotionConnector {
  return {
    async search(_params: NotionSearchParams): Promise<NotionSearchResult> {
      return { results: [], hasMore: false };
    },
    async queryDatabase(): Promise<NotionSearchResult> {
      return { results: opts.databasePages ?? [], hasMore: false };
    },
    async getPageMeta(pageId: string): Promise<NotionObjectMeta> {
      const meta = opts.metas?.[pageId];
      if (!meta) throw new Error("missing");
      return meta;
    },
    async fetchPage(pageId: string): Promise<NotionDocument> {
      return {
        id: pageId,
        title: pageId,
        object: "page",
        text: "",
        extraction: "empty",
        truncated: false,
      };
    },
    async listChildPages(): Promise<NotionObjectMeta[]> {
      return opts.childPages ?? [];
    },
  };
}

describe("notionAccessFromInput", () => {
  it("project scope와 projectId를 명시적으로 해석한다", () => {
    expect(notionAccessFromInput({})).toEqual({ mode: "user" });
    expect(
      notionAccessFromInput({ scope: "project", projectId: " p1 " }),
    ).toEqual({ mode: "project", projectId: "p1" });
  });
});

describe("planScopedNotionSearch", () => {
  it("바인딩이 없으면 전체 Notion 검색으로 넓히지 않는다", async () => {
    const result = await planScopedNotionSearch(
      fakeConnector({}),
      "project-a",
      null,
      {},
    );
    expect(result.ok).toBe(false);
  });

  it("DB 바인딩은 databases.query 결과만 반환한다", async () => {
    const result = await planScopedNotionSearch(
      fakeConnector({
        databasePages: [
          { id: "p1", object: "page", title: "Spec" },
          { id: "p2", object: "page", title: "Notes" },
        ],
      }),
      "project-a",
      {
        projectId: "project-a",
        objectId: "db",
        objectKind: "database",
        title: "Wiki DB",
        updatedAt: 1,
      },
      { query: "spec" },
    );
    expect(result.ok).toBe(true);
    if (result.ok)
      expect(result.result.results.map((p) => p.id)).toEqual(["p1"]);
  });
});

describe("authorizeScopedNotionFetch", () => {
  it("DB 안의 페이지는 허용하고 밖의 페이지는 거절한다", async () => {
    const connector = fakeConnector({
      metas: {
        inside: {
          id: "inside",
          object: "page",
          title: "Inside",
          parent: { type: "database_id", databaseId: "db1" },
        },
        outside: {
          id: "outside",
          object: "page",
          title: "Outside",
          parent: { type: "workspace" },
        },
      },
    });
    const binding = {
      projectId: "project-a",
      objectId: "db1",
      objectKind: "database" as const,
      title: "Wiki DB",
      updatedAt: 1,
    };
    expect(
      (
        await authorizeScopedNotionFetch(
          connector,
          "project-a",
          binding,
          "inside",
        )
      ).ok,
    ).toBe(true);
    expect(
      (
        await authorizeScopedNotionFetch(
          connector,
          "project-a",
          binding,
          "outside",
        )
      ).ok,
    ).toBe(false);
  });
});
