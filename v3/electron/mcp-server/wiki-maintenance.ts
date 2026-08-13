import * as fs from "node:fs/promises";
import * as path from "node:path";

export const WIKI_INDEX = "index.md";
export const WIKI_LOG = "log.md";
export const ASSISTANT_MEMORY = "MEMORY.md";

const MARKDOWN_RE = /\.(md|markdown|mdown|mkd|mkdn)$/i;
const SKIP_DIRS = new Set([
  ".git",
  ".marblo",
  "node_modules",
  "dist",
  "dist-electron",
  "dist-mcp",
  "build",
  ".next",
  ".vite",
]);
const MAX_WIKI_FILES = 500;
const MAX_DOC_BYTES = 1_000_000;
const MAX_QUERY_RESULTS = 25;

export interface WikiDocSource {
  path: string;
  content: string;
}

export type WikiLinkKind = "wikilink" | "markdown";

export interface WikiGraphNode {
  id: string;
  path: string;
  title: string;
  special: "index" | "log" | "memory" | null;
  outDegree: number;
  inDegree: number;
}

export interface WikiGraphEdge {
  id: string;
  from: string;
  to: string;
  kind: WikiLinkKind;
}

export interface WikiGraph {
  nodes: WikiGraphNode[];
  edges: WikiGraphEdge[];
  backlinks: Map<string, string[]>;
  orphanIds: Set<string>;
}

export interface WikiReadResult {
  rootPath: string;
  docs: WikiDocSource[];
  skipped: string[];
  truncated: boolean;
}

export interface WikiLintIssue {
  level: "warning" | "error";
  code: string;
  path: string;
  message: string;
}

export interface WikiIngestResult {
  rootPath: string;
  graph: WikiGraph;
  written: string[];
  skipped: string[];
  truncated: boolean;
}

export interface WikiQueryMatch {
  path: string;
  title: string;
  score: number;
  snippet: string;
}

const WIKILINK_RE = /\[\[([^\]|#]+)(?:#[^\]|]*)?(?:\|[^\]]*)?\]\]/g;
const MD_LINK_RE = /(?<!!)\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g;
const FENCE_RE = /```[\s\S]*?```|~~~[\s\S]*?~~~/g;
const INLINE_CODE_RE = /`[^`\n]+`/g;

export function normalizeWikiPath(raw: string): string {
  return raw
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/\/+/g, "/");
}

export function wikiDocIdFromPath(rawPath: string): string {
  return normalizeWikiPath(rawPath).replace(
    /\.(md|markdown|mdown|mkd|mkdn)$/i,
    "",
  );
}

export function wikiDocTitleFromPath(rawPath: string): string {
  const id = wikiDocIdFromPath(rawPath);
  return id.split("/").pop() || id;
}

function wikiSpecial(rawPath: string): WikiGraphNode["special"] {
  const base = wikiDocTitleFromPath(rawPath).toLowerCase();
  if (base === "index") return "index";
  if (base === "log") return "log";
  if (base === "memory") return "memory";
  return null;
}

function stripCode(content: string): string {
  return content.replace(FENCE_RE, "\n").replace(INLINE_CODE_RE, " ");
}

function extractWikilinks(content: string): string[] {
  const text = stripCode(content);
  const out: string[] = [];
  WIKILINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = WIKILINK_RE.exec(text)) !== null) {
    const target = match[1]?.trim();
    if (target) out.push(target);
  }
  return out;
}

function extractMarkdownLinks(content: string): string[] {
  const text = stripCode(content);
  const out: string[] = [];
  MD_LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = MD_LINK_RE.exec(text)) !== null) {
    const href = (match[2] ?? "").trim();
    if (!href) continue;
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) continue;
    if (href.startsWith("#")) continue;
    const bare = href.split("#")[0]?.trim();
    if (bare) out.push(bare);
  }
  return out;
}

function dirnamePosix(rawPath: string): string {
  const i = rawPath.lastIndexOf("/");
  return i <= 0 ? "" : rawPath.slice(0, i);
}

function joinPosix(dir: string, name: string): string {
  if (!dir) return name.replace(/^\//, "");
  if (name.startsWith("/")) return name.slice(1);
  const stack: string[] = [];
  for (const part of `${dir}/${name}`.split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") {
      stack.pop();
      continue;
    }
    stack.push(part);
  }
  return stack.join("/");
}

function resolveWikiTarget(
  raw: string,
  fromPath: string,
  knownIds: ReadonlySet<string>,
  idByBasename: ReadonlyMap<string, string[]>,
): string | null {
  let target = normalizeWikiPath(raw);
  try {
    target = decodeURIComponent(target);
  } catch {
    /* keep raw */
  }
  target = target.replace(/\/+$/, "");
  if (!target) return null;

  const tryId = (candidate: string): string | null => {
    const id = wikiDocIdFromPath(candidate);
    return knownIds.has(id) ? id : null;
  };

  if (target.startsWith("/")) {
    const hit = tryId(target.slice(1));
    if (hit) return hit;
  } else {
    const hit = tryId(target);
    if (hit) return hit;
  }

  const fromDir = dirnamePosix(normalizeWikiPath(fromPath));
  const relHit = tryId(joinPosix(fromDir, target));
  if (relHit) return relHit;

  const base = wikiDocTitleFromPath(target).toLowerCase();
  const candidates = idByBasename.get(base);
  if (candidates?.length === 1) return candidates[0];
  return null;
}

function edgeKey(from: string, to: string, kind: WikiLinkKind): string {
  return `${from}->${to}:${kind}`;
}

export function buildWikiGraph(sources: readonly WikiDocSource[]): WikiGraph {
  const nodes: WikiGraphNode[] = [];
  const knownIds = new Set<string>();
  const idByBasename = new Map<string, string[]>();

  for (const src of sources) {
    const docPath = normalizeWikiPath(src.path);
    if (!docPath) continue;
    const id = wikiDocIdFromPath(docPath);
    if (knownIds.has(id)) continue;
    knownIds.add(id);
    const base = wikiDocTitleFromPath(id).toLowerCase();
    const list = idByBasename.get(base);
    if (list) list.push(id);
    else idByBasename.set(base, [id]);
    nodes.push({
      id,
      path: docPath,
      title: wikiDocTitleFromPath(docPath),
      special: wikiSpecial(docPath),
      outDegree: 0,
      inDegree: 0,
    });
  }

  const edgeMap = new Map<string, WikiGraphEdge>();
  const pairKind = new Map<string, WikiLinkKind>();
  for (const src of sources) {
    const docPath = normalizeWikiPath(src.path);
    const from = wikiDocIdFromPath(docPath);
    if (!knownIds.has(from)) continue;
    const add = (raw: string, kind: WikiLinkKind) => {
      const to = resolveWikiTarget(raw, docPath, knownIds, idByBasename);
      if (!to || to === from) return;
      const pair = `${from}->${to}`;
      const prev = pairKind.get(pair);
      if (prev === "wikilink" && kind === "markdown") return;
      if (prev && prev !== kind) edgeMap.delete(edgeKey(from, to, prev));
      pairKind.set(pair, kind);
      edgeMap.set(edgeKey(from, to, kind), {
        id: edgeKey(from, to, kind),
        from,
        to,
        kind,
      });
    };
    for (const target of extractWikilinks(src.content)) add(target, "wikilink");
    for (const target of extractMarkdownLinks(src.content))
      add(target, "markdown");
  }

  const edges = Array.from(edgeMap.values());
  const backlinks = new Map<string, string[]>();
  const byId = new Map(nodes.map((node) => [node.id, node]));
  for (const node of nodes) backlinks.set(node.id, []);
  for (const edge of edges) {
    const from = byId.get(edge.from);
    const to = byId.get(edge.to);
    if (!from || !to) continue;
    from.outDegree += 1;
    to.inDegree += 1;
    const list = backlinks.get(edge.to);
    if (list && !list.includes(edge.from)) list.push(edge.from);
  }
  const orphanIds = new Set(
    nodes
      .filter((node) => node.inDegree === 0 && node.outDegree === 0)
      .map((node) => node.id),
  );
  return { nodes, edges, backlinks, orphanIds };
}

export async function resolveWikiRoot(rootPath?: string): Promise<string> {
  const raw = (
    rootPath ||
    process.env.MARBLO_PROJECT_ROOT ||
    process.cwd()
  ).trim();
  if (!raw) throw new Error("wiki root path is empty.");
  const resolved = path.resolve(raw);
  const stat = await fs.stat(resolved);
  if (!stat.isDirectory())
    throw new Error(`wiki root is not a directory: ${resolved}`);
  return resolved;
}

async function walkMarkdownFiles(
  rootPath: string,
): Promise<{ files: string[]; truncated: boolean }> {
  const files: string[] = [];
  const stack = [rootPath];
  let truncated = false;
  while (stack.length > 0) {
    const dir = stack.pop()!;
    let entries: Array<import("node:fs").Dirent>;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!SKIP_DIRS.has(entry.name)) stack.push(abs);
        continue;
      }
      if (!entry.isFile() || !MARKDOWN_RE.test(entry.name)) continue;
      files.push(abs);
      if (files.length >= MAX_WIKI_FILES) {
        truncated = true;
        return { files, truncated };
      }
    }
  }
  files.sort((a, b) => a.localeCompare(b));
  return { files, truncated };
}

export async function readWiki(rootPath: string): Promise<WikiReadResult> {
  const { files, truncated } = await walkMarkdownFiles(rootPath);
  const docs: WikiDocSource[] = [];
  const skipped: string[] = [];
  for (const abs of files) {
    const rel = normalizeWikiPath(path.relative(rootPath, abs));
    try {
      const stat = await fs.stat(abs);
      if (stat.size > MAX_DOC_BYTES) {
        skipped.push(`${rel} (too large)`);
        continue;
      }
      docs.push({ path: rel, content: await fs.readFile(abs, "utf8") });
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      skipped.push(`${rel} (${reason})`);
    }
  }
  return { rootPath, docs, skipped, truncated };
}

function formatIndex(graph: WikiGraph): string {
  const sorted = [...graph.nodes].sort((a, b) => a.path.localeCompare(b.path));
  const hubs = sorted
    .filter((node) => node.inDegree + node.outDegree > 0 || node.special)
    .map(
      (node) =>
        `- [[${node.id}]] (${node.inDegree} in / ${node.outDegree} out)`,
    );
  const orphans = sorted
    .filter((node) => graph.orphanIds.has(node.id) && !node.special)
    .map((node) => `- [[${node.id}]]`);
  return [
    "# Index",
    "",
    "<!-- marblo-wiki:auto:start -->",
    "## Documents",
    "",
    ...(hubs.length ? hubs : ["- (no linked documents yet)"]),
    "",
    "## Orphans",
    "",
    ...(orphans.length ? orphans : ["- (none)"]),
    "<!-- marblo-wiki:auto:end -->",
    "",
  ].join("\n");
}

function formatLogEntry(graph: WikiGraph, now: Date): string {
  const iso = now.toISOString();
  return [
    `## ${iso}`,
    "",
    `- ingest: ${graph.nodes.length} docs, ${graph.edges.length} links, ${graph.orphanIds.size} orphans`,
    "",
  ].join("\n");
}

function upsertAutoBlock(existing: string | null, generated: string): string {
  if (!existing) return generated;
  const start = "<!-- marblo-wiki:auto:start -->";
  const end = "<!-- marblo-wiki:auto:end -->";
  const s = existing.indexOf(start);
  const e = existing.indexOf(end);
  if (s < 0 || e < s) return generated;
  const before = existing.slice(0, s).trimEnd();
  const after = existing.slice(e + end.length).trimStart();
  const block = generated.slice(
    generated.indexOf(start),
    generated.indexOf(end) + end.length,
  );
  return [before, block, after].filter(Boolean).join("\n\n") + "\n";
}

async function readOptionalFile(
  rootPath: string,
  rel: string,
): Promise<string | null> {
  try {
    return await fs.readFile(path.join(rootPath, rel), "utf8");
  } catch {
    return null;
  }
}

async function writeRootFile(
  rootPath: string,
  rel: string,
  content: string,
): Promise<void> {
  await fs.writeFile(path.join(rootPath, rel), content, "utf8");
}

export async function ingestWiki(options: {
  rootPath: string;
  assistantMemoryAppend?: string;
  maintainMemory?: boolean;
  now?: Date;
}): Promise<WikiIngestResult> {
  const read = await readWiki(options.rootPath);
  const graph = buildWikiGraph(read.docs);
  const written: string[] = [];

  const existingIndex = await readOptionalFile(options.rootPath, WIKI_INDEX);
  await writeRootFile(
    options.rootPath,
    WIKI_INDEX,
    upsertAutoBlock(existingIndex, formatIndex(graph)),
  );
  written.push(WIKI_INDEX);

  const existingLog = await readOptionalFile(options.rootPath, WIKI_LOG);
  await writeRootFile(
    options.rootPath,
    WIKI_LOG,
    `${formatLogEntry(graph, options.now ?? new Date())}${existingLog ?? "# Log\n\n"}`,
  );
  written.push(WIKI_LOG);

  if (options.maintainMemory || options.assistantMemoryAppend?.trim()) {
    const existingMemory = await readOptionalFile(
      options.rootPath,
      ASSISTANT_MEMORY,
    );
    const seed =
      existingMemory ??
      "# MEMORY\n\nLong-term memory for this assistant project.\n\n";
    const append = options.assistantMemoryAppend?.trim();
    const next = append
      ? `${seed.trimEnd()}\n\n## ${new Date().toISOString()}\n\n${append}\n`
      : seed;
    await writeRootFile(options.rootPath, ASSISTANT_MEMORY, next);
    written.push(ASSISTANT_MEMORY);
  }

  return {
    rootPath: options.rootPath,
    graph,
    written,
    skipped: read.skipped,
    truncated: read.truncated,
  };
}

export function lintWiki(docs: readonly WikiDocSource[]): {
  graph: WikiGraph;
  issues: WikiLintIssue[];
} {
  const graph = buildWikiGraph(docs);
  const paths = new Set(
    docs.map((doc) => normalizeWikiPath(doc.path).toLowerCase()),
  );
  const issues: WikiLintIssue[] = [];
  if (!paths.has(WIKI_INDEX)) {
    issues.push({
      level: "warning",
      code: "missing-index",
      path: WIKI_INDEX,
      message: "index.md is missing.",
    });
  }
  if (!paths.has(WIKI_LOG)) {
    issues.push({
      level: "warning",
      code: "missing-log",
      path: WIKI_LOG,
      message: "log.md is missing.",
    });
  }
  for (const node of graph.nodes) {
    if (graph.orphanIds.has(node.id) && !node.special) {
      issues.push({
        level: "warning",
        code: "orphan",
        path: node.path,
        message: "Document has no resolved incoming or outgoing links.",
      });
    }
  }
  return { graph, issues };
}

function scoreDoc(doc: WikiDocSource, terms: readonly string[]): number {
  const haystack = `${doc.path}\n${doc.content}`.toLowerCase();
  let score = 0;
  for (const term of terms) {
    let idx = haystack.indexOf(term);
    while (idx >= 0) {
      score += idx < doc.path.length ? 5 : 1;
      idx = haystack.indexOf(term, idx + term.length);
    }
  }
  return score;
}

function snippetFor(doc: WikiDocSource, terms: readonly string[]): string {
  const content = doc.content.replace(/\s+/g, " ").trim();
  const lower = content.toLowerCase();
  const first =
    terms
      .map((term) => lower.indexOf(term))
      .filter((idx) => idx >= 0)
      .sort((a, b) => a - b)[0] ?? 0;
  const start = Math.max(0, first - 80);
  return content.slice(start, start + 240);
}

export function queryWiki(
  docs: readonly WikiDocSource[],
  query: string,
  limit = MAX_QUERY_RESULTS,
): WikiQueryMatch[] {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
  if (terms.length === 0) return [];
  return docs
    .map((doc) => ({ doc, score: scoreDoc(doc, terms) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.doc.path.localeCompare(b.doc.path))
    .slice(0, Math.max(1, Math.min(MAX_QUERY_RESULTS, limit)))
    .map(({ doc, score }) => ({
      path: doc.path,
      title: wikiDocTitleFromPath(doc.path),
      score,
      snippet: snippetFor(doc, terms),
    }));
}
