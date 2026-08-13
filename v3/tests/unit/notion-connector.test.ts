import { describe, it, expect } from "vitest";
import {
  createNotionConnector,
  notionErrorMessage,
  parseNotionList,
  parseNotionObject,
  type NotionFetchLike,
} from "../../electron/notion-connector";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function page(
  id: string,
  title: string,
  parent?: unknown,
): Record<string, unknown> {
  return {
    object: "page",
    id,
    url: `https://notion.so/${id}`,
    last_edited_time: "2026-08-13T00:00:00.000Z",
    parent: parent ?? { type: "workspace" },
    properties: {
      Name: {
        type: "title",
        title: [{ plain_text: title }],
      },
    },
  };
}

describe("parseNotionObject", () => {
  it("페이지 title 속성에서 표시 제목을 뽑는다", () => {
    expect(parseNotionObject(page("p1", "Roadmap"))?.title).toBe("Roadmap");
  });

  it("데이터베이스 title 배열에서 표시 제목을 뽑는다", () => {
    const parsed = parseNotionObject({
      object: "database",
      id: "db1",
      title: [{ plain_text: "Team Wiki" }],
    });
    expect(parsed).toMatchObject({
      id: "db1",
      object: "database",
      title: "Team Wiki",
    });
  });
});

describe("parseNotionList", () => {
  it("깨진 항목은 버리고 페이지/DB만 남긴다", () => {
    const result = parseNotionList({
      results: [page("p1", "A"), { object: "block", id: "b1" }],
      has_more: true,
      next_cursor: "NEXT",
    });
    expect(result.results).toHaveLength(1);
    expect(result.nextCursor).toBe("NEXT");
    expect(result.hasMore).toBe(true);
  });
});

describe("notionErrorMessage", () => {
  it("인증/권한/한도 오류를 사용자 문구로 바꾼다", () => {
    expect(notionErrorMessage(401, {})).toContain("다시 연결");
    expect(notionErrorMessage(403, { message: "denied" })).toContain("denied");
    expect(notionErrorMessage(429, {})).toContain("한도");
  });
});

describe("createNotionConnector", () => {
  it("search API를 read-only POST로 호출하고 토큰은 헤더에만 싣는다", async () => {
    const calls: Array<{ url: string; init?: Parameters<NotionFetchLike>[1] }> =
      [];
    const fetchImpl: NotionFetchLike = async (url, init) => {
      calls.push({ url, init });
      return jsonResponse(200, {
        results: [page("p1", "Spec")],
        has_more: false,
      });
    };
    const connector = createNotionConnector({
      getAccessToken: async () => "secret_testtoken000000000000",
      fetchImpl,
    });

    const result = await connector.search({ query: "spec", pageSize: 10 });
    expect(result.results[0]?.title).toBe("Spec");
    expect(calls[0]?.url).toBe("https://api.notion.com/v1/search");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[0]?.init?.headers?.Authorization).toBe(
      "Bearer secret_testtoken000000000000",
    );
    expect(calls[0]?.url).not.toContain("secret_testtoken");
  });

  it("databases.query 결과를 중립 검색 결과로 파싱한다", async () => {
    const calls: string[] = [];
    const connector = createNotionConnector({
      getAccessToken: async () => "secret_testtoken000000000000",
      fetchImpl: async (url) => {
        calls.push(url);
        return jsonResponse(200, {
          results: [page("p1", "From DB")],
          has_more: false,
        });
      },
    });
    const result = await connector.queryDatabase({
      databaseId: "db123",
      pageSize: 5,
    });
    expect(calls[0]).toContain("/databases/db123/query");
    expect(result.results[0]?.title).toBe("From DB");
  });

  it("blocks.children를 재귀 조회해 markdown-ish 본문으로 바꾼다", async () => {
    const connector = createNotionConnector({
      getAccessToken: async () => "secret_testtoken000000000000",
      fetchImpl: async (url) => {
        if (url.includes("/pages/p1"))
          return jsonResponse(200, page("p1", "Doc"));
        if (url.includes("/blocks/p1/children")) {
          return jsonResponse(200, {
            results: [
              {
                object: "block",
                id: "h1",
                type: "heading_1",
                heading_1: { rich_text: [{ plain_text: "Title" }] },
              },
              {
                object: "block",
                id: "b1",
                type: "bulleted_list_item",
                bulleted_list_item: { rich_text: [{ plain_text: "Item" }] },
              },
            ],
            has_more: false,
          });
        }
        return jsonResponse(404, { message: "missing" });
      },
    });
    const doc = await connector.fetchPage("p1");
    expect(doc.text).toContain("# Title");
    expect(doc.text).toContain("- Item");
    expect(doc.extraction).toBe("blocks");
  });
});
