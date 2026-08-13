import {
  sameNotionId,
  type NotionConnector,
  type NotionObjectMeta,
  type NotionSearchParams,
  type NotionSearchResult,
} from "./notion-connector";
import type { NotionProjectBinding } from "./notion-project-binding";

export type NotionAccess =
  | { mode: "user" }
  | { mode: "project"; projectId: string | null };

export interface NotionScopeInfo {
  objectId: string;
  objectKind: "database" | "page";
  title: string | null;
  truncated: boolean;
}

export function notionAccessFromInput(
  input: Record<string, unknown>,
): NotionAccess {
  if (input.scope !== "project") return { mode: "user" };
  const projectId =
    typeof input.projectId === "string" && input.projectId.trim()
      ? input.projectId.trim()
      : null;
  return { mode: "project", projectId };
}

function bindingMissing(projectId: string | null) {
  return {
    ok: false as const,
    error: projectId
      ? "이 프로젝트의 Notion 위키가 지정되어 있지 않습니다. Harness 탭에서 Notion DB 또는 페이지를 먼저 선택해 주세요."
      : "프로젝트 범위를 알 수 없어 Notion 위키를 조회할 수 없습니다.",
  };
}

function includesQuery(
  meta: NotionObjectMeta,
  query: string | undefined,
): boolean {
  const needle = query?.trim().toLowerCase();
  if (!needle) return true;
  return meta.title.toLowerCase().includes(needle);
}

export async function planScopedNotionSearch(
  connector: NotionConnector,
  projectId: string | null,
  binding: NotionProjectBinding | null,
  params: NotionSearchParams,
): Promise<
  | {
      ok: true;
      result: NotionSearchResult;
      scope: NotionScopeInfo;
    }
  | { ok: false; error: string }
> {
  if (!projectId || !binding) return bindingMissing(projectId);

  if (binding.objectKind === "database") {
    const result = await connector.queryDatabase({
      databaseId: binding.objectId,
      pageSize: params.pageSize,
      startCursor: params.startCursor,
    });
    return {
      ok: true,
      result: {
        ...result,
        results: result.results.filter((item) =>
          includesQuery(item, params.query),
        ),
      },
      scope: {
        objectId: binding.objectId,
        objectKind: binding.objectKind,
        title: binding.title,
        truncated: false,
      },
    };
  }

  const children = await connector.listChildPages(binding.objectId);
  const root = await connector.getPageMeta(binding.objectId);
  const results = [root, ...children].filter((item) =>
    includesQuery(item, params.query),
  );
  return {
    ok: true,
    result: { results, hasMore: false },
    scope: {
      objectId: binding.objectId,
      objectKind: binding.objectKind,
      title: binding.title,
      truncated: false,
    },
  };
}

export async function authorizeScopedNotionFetch(
  connector: NotionConnector,
  projectId: string | null,
  binding: NotionProjectBinding | null,
  pageId: string,
): Promise<
  { ok: true; scope: NotionScopeInfo } | { ok: false; error: string }
> {
  if (!projectId || !binding) return bindingMissing(projectId);
  if (binding.objectKind === "page" && sameNotionId(pageId, binding.objectId)) {
    return {
      ok: true,
      scope: {
        objectId: binding.objectId,
        objectKind: binding.objectKind,
        title: binding.title,
        truncated: false,
      },
    };
  }

  let meta = await connector.getPageMeta(pageId);
  for (let depth = 0; depth < 20; depth += 1) {
    const parent = meta.parent;
    if (!parent) break;
    if (
      binding.objectKind === "database" &&
      parent.type === "database_id" &&
      sameNotionId(parent.databaseId, binding.objectId)
    ) {
      return {
        ok: true,
        scope: {
          objectId: binding.objectId,
          objectKind: binding.objectKind,
          title: binding.title,
          truncated: false,
        },
      };
    }
    if (
      binding.objectKind === "page" &&
      parent.type === "page_id" &&
      sameNotionId(parent.pageId, binding.objectId)
    ) {
      return {
        ok: true,
        scope: {
          objectId: binding.objectId,
          objectKind: binding.objectKind,
          title: binding.title,
          truncated: false,
        },
      };
    }
    if (parent.type !== "page_id") break;
    meta = await connector.getPageMeta(parent.pageId);
  }
  return {
    ok: false,
    error:
      "요청한 Notion 페이지는 이 프로젝트에 바인딩된 DB/페이지 범위 밖입니다.",
  };
}
