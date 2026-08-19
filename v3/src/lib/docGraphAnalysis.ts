/**
 * 프로젝트 문서(md) 관계 그래프 — **순수 분석기**, DOM/스토어/IPC 무관.
 *
 * 카파시 LLM-위키 3계층 중 '위키 그래프' 를 그리기 위한 인접 행 추출.
 * 노드 = 로컬 md 문서, 엣지 = [[wikilink]] · 마크다운 링크 · 상호참조.
 *
 * 배치/캔버스는 `taskGraphForce` + `layoutTaskGraph` 를 재사용한다. 여기서는
 * 링크 파싱·타깃 해석·고아 판정·백링크만 담당하고, 뷰는 결과 그래프만 먹는다.
 */

import type { Task } from "../types/task";
import { layoutTaskGraph, type TaskGraphLayout } from "./taskGraphLayout";
import {
  GRAPH_MAX_RADIUS,
  GRAPH_MIN_RADIUS,
  ISOLATED_ALPHA,
  ISOLATED_RADIUS_SCALE,
} from "./taskGraphAnalysis";

/** 위키 그래프에 넣는 문서 원본. path 가 노드 id 의 재료다. */
export interface DocSource {
  /** 프로젝트 루트 기준 상대 경로(구분자 `/`). */
  path: string;
  content: string;
}

export type DocLinkKind = "wikilink" | "markdown";

export type DocSpecial = "index" | "log" | null;

export interface DocGraphNode {
  id: string;
  path: string;
  /** 라벨용 — 보통 확장자 없는 basename. */
  title: string;
  /** index.md / log.md 허브 표시. */
  special: DocSpecial;
  /**
   * 폴더 스코프 밖이지만 스코프 안 문서가 링크해서 경계로 포함한 노드.
   * `externalLinks: "boundary"` 일 때만 true.
   */
  isBoundary?: boolean;
  outDegree: number;
  inDegree: number;
}

/** 스코프 밖 링크 처리. */
export type DocGraphExternalLinks = "exclude" | "boundary";

/** `buildDocGraph` / `filterDocSources` 폴더 스코프 옵션. */
export interface DocGraphScopeOptions {
  /**
   * 프로젝트 상대 폴더 prefix. 빈 문자열·미지정 = 전체 루트.
   * 예: `"docs"` → `docs/` 아래 md 만.
   */
  folderPrefix?: string;
  /**
   * 스코프 밖(상위·형제 폴더) 문서로 가는 링크.
   * - `exclude`(기본): 간선·노드 모두 제외
   * - `boundary`: 대상 문서를 경계 노드로 포함
   */
  externalLinks?: DocGraphExternalLinks;
}

export interface DocGraphEdge {
  id: string;
  /** 링크를 건 문서. */
  from: string;
  /** 링크 대상 문서. */
  to: string;
  kind: DocLinkKind;
}

export interface DocGraph {
  nodes: DocGraphNode[];
  edges: DocGraphEdge[];
  /** id → 이 문서를 가리키는 문서 id 목록(백링크). */
  backlinks: Map<string, string[]>;
  /** 진입·진출 간선이 모두 0 인 고아 문서. */
  orphanIds: Set<string>;
}

/** 고아 노드 투명도 — 태스크 그래프와 동일 값. */
export { ISOLATED_ALPHA as DOC_ORPHAN_ALPHA };

/** `[[page]]` / `[[page|alias]]` / `[[folder/page#heading]]`. */
const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;

/**
 * 마크다운 인라인 링크 `[text](target)`. 이미지 `![]()` 는 제외.
 * 외부 URL·앵커만 있는 것은 나중에 resolve 단계에서 버린다.
 */
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;

/** 코드펜스 안 링크는 문서 관계가 아니다 — 제거한 뒤 파싱. */
const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
/** 인라인 코드. */
const INLINE_CODE_RE = /`[^`\n]+`/g;

/** 경로 정규화: `\ → /`, 선행 `./` 제거, 확장자 소문자 통일용 소문자 비교 키. */
export function normalizeDocPath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

/**
 * FileTree/readTree 가 주는 절대 경로 → 프로젝트 상대(위키 id 재료).
 * 이미 상대면 그대로 정규화.
 */
export function toProjectRelative(rootPath: string, filePath: string): string {
  const root = normalizeDocPath(rootPath).replace(/\/+$/, "");
  const file = normalizeDocPath(filePath);
  if (!root) return file;
  if (file === root) return "";
  if (file.startsWith(root + "/")) return file.slice(root.length + 1);
  // macOS 기본 볼륨은 대소문자 무시 — 루트 접두만 느슨히 비교
  const rootLower = root.toLowerCase();
  const fileLower = file.toLowerCase();
  if (fileLower.startsWith(rootLower + "/")) {
    return file.slice(root.length + 1);
  }
  return file;
}

/**
 * 그래프 노드 path(상대) → openFile 용 절대 경로.
 * root 의 구분자 스타일(Windows `\`)을 유지한다.
 */
export function joinProjectPath(rootPath: string, relPath: string): string {
  const root = rootPath.replace(/[/\\]+$/, "");
  const rel = normalizeDocPath(relPath);
  if (!rel) return root;
  const sep = root.includes("\\") && !root.includes("/") ? "\\" : "/";
  return `${root}${sep}${rel.split("/").join(sep)}`;
}

/** 노드 id = 확장자 없는 정규 경로(대소문자 유지, 비교는 별도). */
export function docIdFromPath(path: string): string {
  const n = normalizeDocPath(path);
  return n.replace(/\.(md|markdown|mdown|mkd|mkdn)$/i, "");
}

export function docTitleFromPath(path: string): string {
  const id = docIdFromPath(path);
  const base = id.split("/").pop() || id;
  return base || id;
}

export function classifyDocSpecial(path: string): DocSpecial {
  const base = docTitleFromPath(path).toLowerCase();
  if (base === "index") return "index";
  if (base === "log") return "log";
  return null;
}

/** 코드 블록을 뺀 본문 — 링크 추출 전처리. */
export function stripCodeForLinkScan(content: string): string {
  return content.replace(FENCE_RE, "\n").replace(INLINE_CODE_RE, " ");
}

/**
 * 본문에서 위키링크 타깃 목록(등장 순, 중복 유지 — 호출측에서 dedupe).
 * `[[page|표시]]` 의 page 만, 헤딩 `#` 앞부분만.
 */
export function extractWikilinks(content: string): string[] {
  const text = stripCodeForLinkScan(content);
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKILINK_RE.exec(text)) !== null) {
    const target = m[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}

/**
 * 마크다운 링크 href 목록. `http(s):`, `mailto:`, 순수 `#anchor` 는 제외.
 */
export function extractMarkdownLinks(content: string): string[] {
  const text = stripCodeForLinkScan(content);
  const out: string[] = [];
  MD_LINK_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = MD_LINK_RE.exec(text)) !== null) {
    const href = (m[2] ?? "").trim();
    if (!href) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue; // scheme
    if (href.startsWith("#")) continue;
    // fragment 제거
    const bare = href.split("#")[0]?.trim();
    if (bare) out.push(bare);
  }
  return out;
}

/**
 * 링크 문자열 → 알려진 문서 id.
 *
 * 해석 순서:
 *  1) 절대/루트 상대 정규화 후 exact id / id+.md
 *  2) 출발 문서 디렉터리 기준 상대 경로
 *  3) basename(확장자 제거) 유일 매칭
 *
 * 여러 후보가 basename 으로 겹치면 null (애매하면 잇지 않는다).
 */
export function resolveDocTarget(
  raw: string,
  fromPath: string,
  knownIds: ReadonlySet<string>,
  /** id → path (basename 유일 매칭용). */
  idByBasename?: ReadonlyMap<string, string[]>,
): string | null {
  let target = normalizeDocPath(raw);
  // URL-decode lightly (%20 등)
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep raw */
  }
  target = target.replace(/\/+$/, "");
  if (!target) return null;

  const asId = docIdFromPath(target);

  const tryId = (candidate: string): string | null => {
    const id = docIdFromPath(candidate);
    if (knownIds.has(id)) return id;
    return null;
  };

  // 루트 절대 (`/docs/foo` 형태 — 프로젝트 상대)
  if (target.startsWith("/")) {
    const hit = tryId(target.slice(1));
    if (hit) return hit;
  } else {
    const hit = tryId(asId);
    if (hit) return hit;
  }

  // 상대 경로 (from 의 디렉터리 기준)
  const fromDir = dirnamePosix(normalizeDocPath(fromPath));
  const joined = normalizeDocPath(joinPosix(fromDir, target));
  const relHit = tryId(joined);
  if (relHit) return relHit;

  // basename 유일 매칭
  const base = docTitleFromPath(asId).toLowerCase();
  if (idByBasename) {
    const candidates = idByBasename.get(base);
    if (candidates && candidates.length === 1) return candidates[0];
  } else {
    // knownIds 를 훑는 fallback (소규모 위키)
    const matches: string[] = [];
    for (const id of knownIds) {
      if (docTitleFromPath(id).toLowerCase() === base) matches.push(id);
      if (matches.length > 1) break;
    }
    if (matches.length === 1) return matches[0];
  }

  return null;
}

function dirnamePosix(path: string): string {
  const i = path.lastIndexOf("/");
  return i <= 0 ? "" : path.slice(0, i);
}

function joinPosix(dir: string, name: string): string {
  if (!dir) return name.replace(/^\//, "");
  if (name.startsWith("/")) return name.slice(1);
  const parts = `${dir}/${name}`.split("/");
  const stack: string[] = [];
  for (const p of parts) {
    if (!p || p === ".") continue;
    if (p === "..") {
      stack.pop();
      continue;
    }
    stack.push(p);
  }
  return stack.join("/");
}

function edgeKey(from: string, to: string, kind: DocLinkKind): string {
  return `${from}→${to}:${kind}`;
}

/**
 * 경로가 폴더 prefix 아래(또는 그 자체)인지.
 * prefix 가 비면 전체(항상 true).
 */
export function isUnderFolderPrefix(path: string, folderPrefix: string): boolean {
  const pref = normalizeDocPath(folderPrefix).replace(/\/+$/, "");
  if (!pref) return true;
  const p = normalizeDocPath(path);
  if (!p) return false;
  if (p === pref || p.startsWith(`${pref}/`)) return true;
  const id = docIdFromPath(p);
  return id === pref || id.startsWith(`${pref}/`);
}

/**
 * 파일 트리 루트 직속 디렉터리 목록(프로젝트 상대).
 * 숨김(`.` 시작)은 제외. `rootPath` 가 있으면 절대 경로를 상대로 변환.
 */
export function collectTopLevelFolders(
  tree: readonly {
    name: string;
    path: string;
    type: string;
    children?: readonly unknown[];
  }[],
  rootPath = "",
): string[] {
  const folders = new Set<string>();
  for (const node of tree) {
    if (node.type !== "directory") continue;
    if (node.name.startsWith(".")) continue;
    const rel = rootPath
      ? toProjectRelative(rootPath, node.path)
      : normalizeDocPath(node.path);
    const top = (rel.split("/").filter(Boolean)[0] ?? "").trim();
    if (top && !top.startsWith(".")) folders.add(top);
  }
  // UI 표시 순서를 결정하므로 실행 환경 로케일에 관계없이 결과가 고정되도록 "en" 로케일을 명시한다.
  return Array.from(folders).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/**
 * md 경로들에서 1단 폴더 prefix 추출(트리에 없어도 스코프 후보로 쓰기 위함).
 */
export function collectFolderPrefixesFromPaths(
  paths: readonly string[],
): string[] {
  const folders = new Set<string>();
  for (const raw of paths) {
    const p = normalizeDocPath(raw);
    const slash = p.indexOf("/");
    if (slash <= 0) continue;
    const top = p.slice(0, slash);
    if (top && !top.startsWith(".")) folders.add(top);
  }
  return Array.from(folders).sort((a, b) => a.localeCompare(b, "en", { sensitivity: "base" }));
}

/**
 * 폴더 스코프에 맞춰 원본 목록을 줄인다.
 * - exclude: prefix 아래만
 * - boundary: prefix 아래 + 그 안에서 링크한 스코프 밖 문서
 */
export function filterDocSources(
  sources: readonly DocSource[],
  options: DocGraphScopeOptions = {},
): DocSource[] {
  const prefix = normalizeDocPath(options.folderPrefix ?? "").replace(/\/+$/, "");
  if (!prefix) return [...sources];

  const mode: DocGraphExternalLinks = options.externalLinks ?? "exclude";
  const inScope = sources.filter((s) => isUnderFolderPrefix(s.path, prefix));
  if (mode === "exclude" || inScope.length === 0) return inScope;

  const pathById = new Map<string, string>();
  const knownIds = new Set<string>();
  const idByBasename = new Map<string, string[]>();
  const sourceById = new Map<string, DocSource>();

  for (const src of sources) {
    const path = normalizeDocPath(src.path);
    if (!path) continue;
    const id = docIdFromPath(path);
    if (knownIds.has(id)) continue;
    knownIds.add(id);
    pathById.set(id, path);
    sourceById.set(id, src);
    const base = docTitleFromPath(id).toLowerCase();
    const list = idByBasename.get(base);
    if (list) list.push(id);
    else idByBasename.set(base, [id]);
  }

  const needed = new Set<string>();
  for (const src of inScope) {
    const path = normalizeDocPath(src.path);
    const from = docIdFromPath(path);
    needed.add(from);
    const consider = (raw: string) => {
      const to = resolveDocTarget(raw, path, knownIds, idByBasename);
      if (!to || to === from) return;
      const toPath = pathById.get(to);
      if (!toPath) return;
      if (!isUnderFolderPrefix(toPath, prefix)) needed.add(to);
    };
    for (const w of extractWikilinks(src.content)) consider(w);
    for (const m of extractMarkdownLinks(src.content)) consider(m);
  }

  const out: DocSource[] = [];
  for (const id of needed) {
    const src = sourceById.get(id);
    if (!src) continue;
    // 경계 노드는 타깃으로만 보이게 본문을 비운다(밖→안 간선·추가 pull 방지).
    // path 는 유지해 노드 클릭 시 파일 열림이 동작한다.
    if (!isUnderFolderPrefix(src.path, prefix)) {
      out.push({ path: src.path, content: "" });
    } else {
      out.push(src);
    }
  }
  return out;
}

/**
 * md 원본 목록 → 문서 관계 그래프.
 *
 * - 자기 참조·미해결 링크는 간선에서 제외(고아 판정은 "실존 노드끼리 연결" 기준)
 * - 같은 (from,to) 는 kind 우선순위 wikilink > markdown 으로 한 줄만
 * - `folderPrefix` 가 있으면 해당 폴더 아래만(백링크·고아도 그 서브셋 기준)
 */
export function buildDocGraph(
  sources: readonly DocSource[],
  options: DocGraphScopeOptions = {},
): DocGraph {
  const prefix = normalizeDocPath(options.folderPrefix ?? "").replace(/\/+$/, "");
  const mode: DocGraphExternalLinks = options.externalLinks ?? "exclude";
  const scopedSources = prefix
    ? filterDocSources(sources, { folderPrefix: prefix, externalLinks: mode })
    : sources;

  const nodes: DocGraphNode[] = [];
  const knownIds = new Set<string>();
  const pathById = new Map<string, string>();
  const idByBasename = new Map<string, string[]>();

  for (const src of scopedSources) {
    const path = normalizeDocPath(src.path);
    if (!path) continue;
    const id = docIdFromPath(path);
    if (knownIds.has(id)) continue; // 동일 id 첫 파일 우선
    knownIds.add(id);
    pathById.set(id, path);
    const base = docTitleFromPath(id).toLowerCase();
    const list = idByBasename.get(base);
    if (list) list.push(id);
    else idByBasename.set(base, [id]);
    nodes.push({
      id,
      path,
      title: docTitleFromPath(path),
      special: classifyDocSpecial(path),
      isBoundary: Boolean(prefix) && mode === "boundary" && !isUnderFolderPrefix(path, prefix),
      outDegree: 0,
      inDegree: 0,
    });
  }

  const edgeMap = new Map<string, DocGraphEdge>();
  const pairKind = new Map<string, DocLinkKind>(); // from→to → best kind

  // 경계 모드에서도 간선은 스코프 안 문서가 건 링크만(밖→안 역방향은 스코프 밖 본문을 안 읽은 것과 동일)
  const edgeSources =
    prefix && mode === "boundary"
      ? scopedSources.filter((s) => isUnderFolderPrefix(s.path, prefix))
      : scopedSources;

  for (const src of edgeSources) {
    const path = normalizeDocPath(src.path);
    const from = docIdFromPath(path);
    if (!knownIds.has(from)) continue;

    const add = (raw: string, kind: DocLinkKind) => {
      const to = resolveDocTarget(raw, path, knownIds, idByBasename);
      if (!to || to === from) return;
      if (!knownIds.has(to)) return;
      const pair = `${from}→${to}`;
      const prev = pairKind.get(pair);
      // wikilink 가 markdown 보다 우선
      if (prev === "wikilink" && kind === "markdown") return;
      if (prev === kind || (prev === "markdown" && kind === "wikilink") || !prev) {
        pairKind.set(pair, kind);
        const id = edgeKey(from, to, kind);
        // kind 가 바뀌면 이전 키 제거
        if (prev && prev !== kind) {
          edgeMap.delete(edgeKey(from, to, prev));
        }
        edgeMap.set(id, { id, from, to, kind });
      }
    };

    for (const w of extractWikilinks(src.content)) add(w, "wikilink");
    for (const m of extractMarkdownLinks(src.content)) add(m, "markdown");
  }

  const edges = Array.from(edgeMap.values());
  const inDeg = new Map<string, number>();
  const outDeg = new Map<string, number>();
  const backlinks = new Map<string, string[]>();

  for (const n of nodes) {
    inDeg.set(n.id, 0);
    outDeg.set(n.id, 0);
    backlinks.set(n.id, []);
  }
  for (const e of edges) {
    outDeg.set(e.from, (outDeg.get(e.from) ?? 0) + 1);
    inDeg.set(e.to, (inDeg.get(e.to) ?? 0) + 1);
    const bl = backlinks.get(e.to);
    if (bl && !bl.includes(e.from)) bl.push(e.from);
  }

  for (const n of nodes) {
    n.inDegree = inDeg.get(n.id) ?? 0;
    n.outDegree = outDeg.get(n.id) ?? 0;
  }

  const orphanIds = new Set<string>();
  for (const n of nodes) {
    if (n.inDegree === 0 && n.outDegree === 0) orphanIds.add(n.id);
  }

  return { nodes, edges, backlinks, orphanIds };
}

/**
 * 문서 그래프 → 태스크 그래프 레이아웃 계약.
 *
 * `layoutTaskGraph` / `createTaskGraphSimulation` 을 그대로 쓰기 위해
 * 문서 한 장을 최소 Task 스텁으로 감싼다. 뷰는 title·id 만 읽고 status 색은
 * special/orphan 으로 덮어쓴다.
 *
 * 간선 방향: A 가 B 를 링크하면 A→B (layout 에서는 B.dependsOn 에 A).
 */
export function layoutDocGraph(graph: DocGraph): TaskGraphLayout {
  const predecessors = new Map<string, string[]>();
  for (const n of graph.nodes) predecessors.set(n.id, []);
  for (const e of graph.edges) {
    const list = predecessors.get(e.to);
    if (list && !list.includes(e.from)) list.push(e.from);
  }

  const now = new Date(0);
  const tasks: Task[] = graph.nodes.map((n) => {
    const deps = predecessors.get(n.id) ?? [];
    return {
      id: n.id,
      projectId: "doc-graph",
      contextId: "wiki",
      title: n.title,
      description: n.path,
      status: "TODO",
      role: "frontend",
      // special / hub 를 크기 힌트로 — index·log 는 우선순위 높게
      priority: n.special ? 5 : Math.min(5, 2 + Math.floor(Math.sqrt(n.inDegree))),
      dependsOn: deps,
      dependsOnCompleted: deps.length === 0,
      claimedBy: null,
      claimedAt: null,
      scope: [n.path],
      comment: "",
      prUrl: "",
      hasPmFeedback: false,
      createdAt: now,
      updatedAt: now,
    } as Task;
  });

  return layoutTaskGraph(tasks);
}

/**
 * 노드 반지름 — 백링크(in) 허브가 크고, 고아는 태스크 그래프와 같이 축소.
 */
export function docNodeRadius(
  node: DocGraphNode,
  connected = true,
): number {
  const hub = Math.sqrt(Math.max(0, node.inDegree + node.outDegree));
  const specialBoost = node.special ? 4 : 0;
  const raw = GRAPH_MIN_RADIUS + 2 + hub * 3.2 + specialBoost;
  const bounded = Math.min(GRAPH_MAX_RADIUS, raw);
  return connected ? bounded : bounded * ISOLATED_RADIUS_SCALE;
}

/** 파일 트리에서 md 경로만 평탄하게 모은다(테스트·패널 공용). */
export function collectMarkdownPaths(
  tree: readonly { name: string; path: string; type: string; children?: readonly unknown[] }[],
  options: { maxFiles?: number } = {},
): string[] {
  const maxFiles = options.maxFiles ?? 400;
  const out: string[] = [];
  const stack = [...tree];
  while (stack.length > 0 && out.length < maxFiles) {
    const node = stack.pop()!;
    if (node.type === "directory") {
      const children = (node.children ?? []) as typeof tree;
      for (let i = children.length - 1; i >= 0; i -= 1) {
        stack.push(children[i] as (typeof tree)[number]);
      }
      continue;
    }
    if (/\.(md|markdown|mdown|mkd|mkdn)$/i.test(node.name)) {
      out.push(normalizeDocPath(node.path));
    }
  }
  return out;
}
