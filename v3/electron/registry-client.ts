/**
 * Registry client — fetches the public marblo-app/marblo registry and turns
 * it into a validated, cached index the Store can render.
 *
 * ── 신뢰 경계 (설계 v3/docs/ecosystem-registry-design.md §4.4) ──────────
 * 여기 들어오는 모든 바이트는 **untrusted 입력**이다(커뮤니티 PR 로 바뀔 수
 * 있는 공개 레포). 이 모듈은 파싱·검증·캐시만 한다 — 어떤 경우에도 디스크의
 * 사용자 영역(~/.claude 등)에 쓰지 않는다. 설치는 registry-installer 가
 * 별도로, 설치 직전에 다시 전 항목을 재검증한 뒤에만 한다. 내장 카탈로그
 * (harness-catalog)와 코드 경로를 공유하지 않는다.
 *
 * ── 실패 모드 (§4.1 degradation) ────────────────────────────────────────
 * fetch 실패 → 마지막 캐시를 stale 표시로 서빙. 캐시도 없으면 items:[] +
 * available:false — 스토어는 내장 카탈로그만으로 항상 열린다. 알 수 없는
 * schema_version / 파싱 불가 manifest 는 그 항목만 조용히 숨긴다(S12) —
 * 인덱스 전체를 죽이는 파싱 에러는 없다.
 */
import fs from "fs";
import path from "path";
import { parse as parseYaml } from "yaml";

// ── Registry source ────────────────────────────────────────────────
// Phase 1a 는 skill(files)과 mcp-server(config) 2종만 소비한다(§2 scope).
// agents/·workflows/·knowledge/ 는 1b — 디렉터리 자체를 읽지 않는다.
const REGISTRY_REPO = "marblo-app/marblo";
const REGISTRY_BRANCH = "main";
const PHASE_1A_DIRS: Record<string, RegistryItemType> = {
  skills: "skill",
  "mcp-servers": "mcp-server",
};

const API_BASE = `https://api.github.com/repos/${REGISTRY_REPO}`;
const RAW_BASE = `https://raw.githubusercontent.com/${REGISTRY_REPO}`;

// §4.4 rule 8 — 모든 한도는 reject, truncate 아님.
const MAX_MANIFEST_BYTES = 16 * 1024;
const MAX_ITEMS = 500;
const MAX_FILES_PER_ITEM = 200;
const MAX_ITEM_TOTAL_BYTES = 10 * 1024 * 1024;
const MAX_DESCRIPTION_LEN = 280;
const MAX_ID_LEN = 64;
const FETCH_TIMEOUT_MS = 15_000;
const MANIFEST_FETCH_CONCURRENCY = 8;
const INDEX_MEMO_TTL_MS = 10 * 60 * 1000;

export type RegistryTier = "official" | "verified" | "community";
export type RegistryItemType = "skill" | "mcp-server";
export type RegistryItemStatus = "active" | "deprecated" | "revoked";

/** files 설치: root 는 앱이 절대경로로 매핑하는 enum 키. 경로는 절대 안 받는다. */
export interface RegistryFilesInstall {
  kind: "files";
  root: "claude-skills";
  /** 단일 세그먼트 `^[a-z0-9]+(-[a-z0-9]+)*$` — installer 가 재검증한다. */
  dest: string;
  /** 명시 allowlist — 이 목록 밖은 어떤 것도 쓰지 않는다. item path 기준 상대경로. */
  files: string[];
  /** v2 manifest 의 per-file sha256 (있으면 설치 시 검증). */
  integrity?: Record<string, string>;
}

/** mcp-server 설치: free-form command 금지 — runner 는 enum, package 는 exact pin. */
export interface RegistryMcpInstall {
  kind: "mcp-server";
  runner: "npx" | "uvx" | "docker" | "binary";
  /** `name@x.y.z` 정확 핀. */
  package: string;
  args: string[];
  /** env 변수 **이름**만. 값은 어떤 manifest 필드에도 존재할 수 없다. */
  envRequired: string[];
  mcpKey: string;
}

export type RegistryInstall = RegistryFilesInstall | RegistryMcpInstall;

export interface RegistryItem {
  schemaVersion: number;
  id: string;
  name: string;
  type: RegistryItemType;
  version: string;
  description: string;
  /**
   * v1 manifest 의 tier 는 기여자가 자기 파일에 스스로 적는 값이다(설계 S2 —
   * CI 파생은 Lane A). UI 는 이것을 "공시"로만 표시해야 하고, installer 의
   * tier gate 는 이 값 기준으로 community 를 차단한다(보수적 방향으로만 사용).
   */
  tier: RegistryTier;
  publisherName: string;
  publisherUrl?: string;
  status: RegistryItemStatus;
  /** 스코프 문자열 verbatim. 빈 배열 = "아무것도 필요없다"는 명시적 주장. */
  permissions: string[];
  /** v1 은 permissions 가 optional 이라(S4) 미신고와 빈 배열을 구분해 보여준다. */
  permissionsDeclared: boolean;
  sourceRepository?: string;
  sourceRef?: string;
  license?: string;
  homepage?: string;
  /** repo 내 항목 경로 (예: skills/code-review). */
  path: string;
  /** 이 항목을 읽은 레지스트리 커밋 — 설치는 항상 이 커밋에서 받는다. */
  commit: string;
  /**
   * null = 이 manifest 로는 안전한 자동 설치가 불가(v1 mcp-server 등) —
   * UI 는 목록·공시만 하고 설치 버튼을 달지 않는다.
   */
  install: RegistryInstall | null;
  /** true = v1 in-repo skill 페이로드에서 파생한 files 설치(레포 트리 기반). */
  installDerived: boolean;
  /** install 이 null 인 이유(사용자 표시용). */
  notInstallableReason?: string;
}

export interface RegistryIndex {
  /** 인덱스를 만든 레지스트리 커밋. 캐시조차 없으면 null. */
  commit: string | null;
  fetchedAt: number;
  /** true = 네트워크 실패로 이전 캐시를 서빙 중. */
  stale: boolean;
  /** false = 캐시도 없음 — 레지스트리 섹션을 그리지 말 것. */
  available: boolean;
  items: RegistryItem[];
  error?: string;
}

interface TreeEntry {
  path: string;
  mode: string;
  type: string;
  size?: number;
}

export interface RegistryFetchDeps {
  fetchImpl?: typeof fetch;
  cacheDir?: string;
}

// ── Validation helpers (anchored + length-bounded, §4.4 rule 8) ────
const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,32})?$/;
const COMMIT_RE = /^[0-9a-f]{40}$/;
const TIERS: RegistryTier[] = ["official", "verified", "community"];
const STATUSES: RegistryItemStatus[] = ["active", "deprecated", "revoked"];

function asString(v: unknown, maxLen: number): string | null {
  if (typeof v !== "string" || v.length === 0 || v.length > maxLen) return null;
  return v;
}

function asStringArray(
  v: unknown,
  maxItems: number,
  maxLen: number,
): string[] | null {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > maxItems) return null;
  const out: string[] = [];
  for (const e of v) {
    const s = asString(e, maxLen);
    if (s === null) return null;
    out.push(s);
  }
  return out;
}

/**
 * Parse + validate one marblo.yaml. Returns null when the manifest must be
 * hidden (unknown schema_version, malformed, over limits) — never throws.
 * `install` 파생은 여기서 하지 않는다(트리 정보가 필요) — caller 가 붙인다.
 */
export function parseManifest(
  raw: string,
  itemPath: string,
  expectedType: RegistryItemType,
  commit: string,
): RegistryItem | null {
  if (Buffer.byteLength(raw, "utf-8") > MAX_MANIFEST_BYTES) return null;
  let doc: unknown;
  try {
    doc = parseYaml(raw, { maxAliasCount: 8 });
  } catch {
    return null;
  }
  if (!doc || typeof doc !== "object" || Array.isArray(doc)) return null;
  const m = doc as Record<string, unknown>;

  // 알 수 없는 schema_version = 숨김(파싱 에러로 전체를 죽이지 않는다, S12).
  const sv = m.schema_version;
  if (sv !== 1 && sv !== 2) return null;

  const id = asString(m.id, MAX_ID_LEN);
  if (!id || !ID_RE.test(id)) return null;
  const name = asString(m.name, 80);
  const version = asString(m.version, 40);
  const description = asString(m.description, MAX_DESCRIPTION_LEN);
  if (!name || !version || !description || !SEMVER_RE.test(version)) {
    return null;
  }
  if (m.type !== expectedType) return null;

  const pub = m.publisher;
  if (!pub || typeof pub !== "object" || Array.isArray(pub)) return null;
  const pubObj = pub as Record<string, unknown>;
  const publisherName = asString(pubObj.name, 80);
  const tier = pubObj.tier;
  if (
    !publisherName ||
    typeof tier !== "string" ||
    !TIERS.includes(tier as RegistryTier)
  ) {
    return null;
  }

  const status =
    m.status === undefined
      ? "active"
      : STATUSES.includes(m.status as RegistryItemStatus)
        ? (m.status as RegistryItemStatus)
        : null;
  if (!status) return null;

  const permissionsDeclared = m.permissions !== undefined;
  const permissions = asStringArray(m.permissions, 40, 120);
  if (permissions === null) return null;

  let sourceRepository: string | undefined;
  let sourceRef: string | undefined;
  if (m.source && typeof m.source === "object" && !Array.isArray(m.source)) {
    const src = m.source as Record<string, unknown>;
    sourceRepository = asString(src.repository, 200) ?? undefined;
    sourceRef = asString(src.ref, 120) ?? undefined;
  }

  const item: RegistryItem = {
    schemaVersion: sv,
    id,
    name,
    type: expectedType,
    version,
    description,
    tier: tier as RegistryTier,
    publisherName,
    publisherUrl: asString(pubObj.url, 200) ?? undefined,
    status,
    permissions,
    permissionsDeclared,
    sourceRepository,
    sourceRef,
    license: asString(m.license, 40) ?? undefined,
    homepage: asString(m.homepage, 200) ?? undefined,
    path: itemPath,
    commit,
    install: null,
    installDerived: false,
  };

  // v2 manifest 는 install 블록을 직접 나른다(설계 §3.2). 형태만 검증해 싣고,
  // 강제 규칙(§4.4) 은 installer 가 설치 직전에 다시 전부 돈다.
  if (sv === 2) {
    item.install = parseV2InstallBlock(m.install, expectedType);
    if (!item.install) {
      item.notInstallableReason = "install 블록이 없거나 유효하지 않음";
    }
  }
  return item;
}

function parseV2InstallBlock(
  v: unknown,
  expectedType: RegistryItemType,
): RegistryInstall | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  if (expectedType === "skill" && b.kind === "files") {
    const dest = asString(b.dest, MAX_ID_LEN);
    const files = asStringArray(b.files, MAX_FILES_PER_ITEM, 300);
    if (b.root !== "claude-skills" || !dest || !files || files.length === 0) {
      return null;
    }
    let integrity: Record<string, string> | undefined;
    if (
      b.integrity &&
      typeof b.integrity === "object" &&
      !Array.isArray(b.integrity)
    ) {
      const files2 = (b.integrity as Record<string, unknown>).files;
      if (files2 && typeof files2 === "object" && !Array.isArray(files2)) {
        integrity = {};
        for (const [k, val] of Object.entries(
          files2 as Record<string, unknown>,
        )) {
          const hex = asString(val, 64);
          if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
          integrity[k] = hex;
        }
      }
    }
    return { kind: "files", root: "claude-skills", dest, files, integrity };
  }
  if (expectedType === "mcp-server" && b.kind === "mcp-server") {
    const runner = asString(b.runner, 16);
    const pkg = asString(b.package, 200);
    const mcpKey = asString(b.mcp_key, 48);
    const args = asStringArray(b.args, 20, 256);
    const envRequired = asStringArray(b.env_required, 10, 64);
    if (!runner || !pkg || !mcpKey || args === null || envRequired === null) {
      return null;
    }
    if (!["npx", "uvx", "docker", "binary"].includes(runner)) return null;
    return {
      kind: "mcp-server",
      runner: runner as RegistryMcpInstall["runner"],
      package: pkg,
      args,
      envRequired,
      mcpKey,
    };
  }
  return null;
}

/**
 * v1 skill 의 files 설치 파생: 페이로드가 레지스트리 레포 안에 있을 때(예:
 * skills/code-review/SKILL.md), 레포 트리@핀커밋에서 allowlist 를 만든다.
 * 심링크(mode 120000)가 하나라도 있으면 항목 전체를 설치불가로 만든다 —
 * allowlist 에서 조용히 빼면 "다 설치됐다"로 읽히기 때문(§5.2 no silent caps).
 */
export function deriveFilesInstallFromTree(
  item: RegistryItem,
  tree: TreeEntry[],
): void {
  if (item.type !== "skill" || item.install) return;
  const prefix = `${item.path}/`;
  const files: string[] = [];
  let total = 0;
  for (const e of tree) {
    if (!e.path.startsWith(prefix)) continue;
    const rel = e.path.slice(prefix.length);
    if (rel === "marblo.yaml") continue; // Store 메타데이터 — 페이로드 아님
    if (e.type !== "blob") continue;
    if (e.mode === "120000") {
      item.install = null;
      item.notInstallableReason = "페이로드에 심링크 포함 — 설치 거부";
      return;
    }
    files.push(rel);
    total += e.size ?? 0;
  }
  if (files.length === 0) {
    item.notInstallableReason = "레포 내 페이로드 없음(manifest-only)";
    return;
  }
  if (files.length > MAX_FILES_PER_ITEM || total > MAX_ITEM_TOTAL_BYTES) {
    item.notInstallableReason = "페이로드가 크기 한도 초과";
    return;
  }
  item.install = {
    kind: "files",
    root: "claude-skills",
    // dest 는 manifest id 에서 파생 — installer 가 단일세그먼트 규칙으로 재검증.
    dest: item.id,
    files,
  };
  item.installDerived = true;
}

// ── Fetch + cache ──────────────────────────────────────────────────

function cacheFilePath(cacheDir: string): string {
  return path.join(cacheDir, "registry-index-cache.json");
}

interface CacheShape {
  commit: string;
  fetchedAt: number;
  items: RegistryItem[];
}

function readCache(cacheDir: string): CacheShape | null {
  try {
    const raw = fs.readFileSync(cacheFilePath(cacheDir), "utf-8");
    const parsed = JSON.parse(raw) as CacheShape;
    if (
      !parsed ||
      !COMMIT_RE.test(parsed.commit) ||
      !Array.isArray(parsed.items)
    ) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCacheAtomic(cacheDir: string, cache: CacheShape): void {
  try {
    fs.mkdirSync(cacheDir, { recursive: true });
    const file = cacheFilePath(cacheDir);
    const tmp = `${file}.tmp-${process.pid}`;
    fs.writeFileSync(tmp, JSON.stringify(cache), "utf-8");
    fs.renameSync(tmp, file);
  } catch (err) {
    console.warn("[registry] index cache write failed:", err);
  }
}

async function fetchWithTimeout(
  fetchImpl: typeof fetch,
  url: string,
  accept: string,
): Promise<Response> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetchImpl(url, {
      signal: ctrl.signal,
      headers: { Accept: accept, "User-Agent": "marblo-app" },
    });
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(
  fetchImpl: typeof fetch,
  url: string,
): Promise<unknown> {
  const res = await fetchWithTimeout(
    fetchImpl,
    url,
    "application/vnd.github+json",
  );
  if (!res.ok) throw new Error(`GET ${url} → ${res.status}`);
  return res.json();
}

export async function fetchRawRegistryFile(
  fetchImpl: typeof fetch,
  commit: string,
  repoPath: string,
  maxBytes: number,
): Promise<Buffer> {
  const res = await fetchWithTimeout(
    fetchImpl,
    `${RAW_BASE}/${commit}/${repoPath}`,
    "*/*",
  );
  if (!res.ok) throw new Error(`raw fetch ${repoPath} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(
      `raw fetch ${repoPath} → ${buf.byteLength}B > 한도 ${maxBytes}B`,
    );
  }
  return buf;
}

async function mapLimit<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      for (;;) {
        const i = next++;
        if (i >= items.length) return;
        out[i] = await fn(items[i]);
      }
    },
  );
  await Promise.all(workers);
  return out;
}

/** 트리에서 Phase 1a manifest 후보를 고른다: <dir>/<name>/marblo.yaml 정확히 2단. */
export function selectManifestEntries(
  tree: TreeEntry[],
): Array<{ path: string; dir: string; type: RegistryItemType }> {
  const out: Array<{ path: string; dir: string; type: RegistryItemType }> = [];
  for (const e of tree) {
    if (e.type !== "blob") continue;
    const m = e.path.match(
      /^([a-z-]+)\/([a-z0-9]+(?:-[a-z0-9]+)*)\/marblo\.yaml$/,
    );
    if (!m) continue;
    const itemType = PHASE_1A_DIRS[m[1]];
    if (!itemType) continue;
    if ((e.size ?? 0) > MAX_MANIFEST_BYTES) continue;
    out.push({ path: e.path, dir: `${m[1]}/${m[2]}`, type: itemType });
    if (out.length >= MAX_ITEMS) break;
  }
  return out;
}

async function fetchFreshIndex(
  fetchImpl: typeof fetch,
  cached: CacheShape | null,
): Promise<CacheShape> {
  const head = (await fetchJson(
    fetchImpl,
    `${API_BASE}/commits/${REGISTRY_BRANCH}`,
  )) as { sha?: string };
  const commit = head?.sha;
  if (!commit || !COMMIT_RE.test(commit)) {
    throw new Error("레지스트리 HEAD 커밋 해석 실패");
  }
  // 같은 커밋이면 manifest 재fetch 없이 캐시 재사용.
  if (cached && cached.commit === commit) {
    return { ...cached, fetchedAt: Date.now() };
  }

  const treeRes = (await fetchJson(
    fetchImpl,
    `${API_BASE}/git/trees/${commit}?recursive=1`,
  )) as { tree?: TreeEntry[]; truncated?: boolean };
  if (!treeRes?.tree || treeRes.truncated) {
    throw new Error("레지스트리 트리 조회 실패(또는 truncated)");
  }
  const tree = treeRes.tree;

  const entries = selectManifestEntries(tree);
  const items = (
    await mapLimit(entries, MANIFEST_FETCH_CONCURRENCY, async (entry) => {
      try {
        const buf = await fetchRawRegistryFile(
          fetchImpl,
          commit,
          entry.path,
          MAX_MANIFEST_BYTES,
        );
        const item = parseManifest(
          buf.toString("utf-8"),
          entry.dir,
          entry.type,
          commit,
        );
        if (item && item.type === "skill" && item.schemaVersion === 1) {
          deriveFilesInstallFromTree(item, tree);
        }
        if (item && item.type === "mcp-server" && !item.install) {
          item.notInstallableReason ??=
            "manifest 에 설치 계약 없음(schema v1) — 수동 설치만 가능";
        }
        return item;
      } catch (err) {
        console.warn(`[registry] manifest ${entry.path} 처리 실패(숨김):`, err);
        return null;
      }
    })
  ).filter((i): i is RegistryItem => i !== null);

  // id 중복은 먼저 온 것만 남긴다(같은 id 두 항목이 서로를 가리는 혼선 방지).
  const seen = new Set<string>();
  const deduped = items.filter((i) => {
    const key = `${i.type}:${i.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return { commit, fetchedAt: Date.now(), items: deduped };
}

let memoIndex: RegistryIndex | null = null;
let memoAt = 0;

/** 테스트용: 메모이즈 초기화. */
export function resetRegistryClientMemo(): void {
  memoIndex = null;
  memoAt = 0;
}

/**
 * 인덱스 조회 — 절대 throw 하지 않는다. 실패 시 stale 캐시 → 그것도 없으면
 * available:false 빈 인덱스. 스토어가 이것 때문에 못 열리는 일은 없다.
 */
export async function getRegistryIndex(
  deps: RegistryFetchDeps & { forceRefresh?: boolean } = {},
): Promise<RegistryIndex> {
  const fetchImpl = deps.fetchImpl ?? fetch;
  const cacheDir = deps.cacheDir;
  if (
    !deps.forceRefresh &&
    memoIndex &&
    Date.now() - memoAt < INDEX_MEMO_TTL_MS
  ) {
    return memoIndex;
  }
  const cached = cacheDir ? readCache(cacheDir) : null;
  try {
    const fresh = await fetchFreshIndex(fetchImpl, cached);
    if (cacheDir && (!cached || cached.commit !== fresh.commit)) {
      writeCacheAtomic(cacheDir, fresh);
    }
    memoIndex = {
      commit: fresh.commit,
      fetchedAt: fresh.fetchedAt,
      stale: false,
      available: true,
      items: fresh.items,
    };
    memoAt = Date.now();
    return memoIndex;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.warn("[registry] index fetch 실패:", message);
    if (cached) {
      memoIndex = {
        commit: cached.commit,
        fetchedAt: cached.fetchedAt,
        stale: true,
        available: true,
        items: cached.items,
        error: message,
      };
      memoAt = Date.now();
      return memoIndex;
    }
    return {
      commit: null,
      fetchedAt: Date.now(),
      stale: false,
      available: false,
      items: [],
      error: message,
    };
  }
}
