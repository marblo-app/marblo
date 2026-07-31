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
// 설치 계약이 있는 타입은 skill·mcp-server·agent 뿐이다. workflow·knowledge 는
// 인덱싱·표시(참조 전용)만 한다 — 스토어가 카테고리 탭으로 전 타입을 브라우징
// 하는 화면이 된 이상, 디렉터리를 아예 안 읽으면 그 카테고리가 항상 빈 칸이 된다.
const REGISTRY_REPO = "marblo-app/marblo";
const REGISTRY_BRANCH = "main";
const INDEXED_DIRS: Record<string, RegistryItemType> = {
  skills: "skill",
  "mcp-servers": "mcp-server",
  agents: "agent",
  workflows: "workflow",
  knowledge: "knowledge",
};

/**
 * files 설치를 갖는 타입 → 그 타입에 **허용된 유일한** root(공개 스키마의
 * install allOf 게이트와 1:1). 목록이 아니라 1:1 매핑인 게 핵심이다 — 에이전트
 * 트리에 떨어진 파일은 하네스가 매 세션 로드하는 페르소나가 되므로, "스킬로
 * 리뷰됐는데 에이전트로 착지" 는 조용한 권한 상승이다. 양방향 모두 막힌다.
 */
const FILES_INSTALL_ROOT_BY_TYPE: Partial<
  Record<RegistryItemType, RegistryFilesInstall["root"]>
> = {
  skill: "claude-skills",
  agent: "claude-agents",
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
export type RegistryItemType =
  | "skill"
  | "mcp-server"
  | "agent"
  | "workflow"
  | "knowledge";
export type RegistryItemStatus = "active" | "deprecated" | "revoked";

/**
 * 표시 문자열 오버레이가 실릴 수 있는 로케일(공개 스키마 `i18n` 의 키와 동일).
 * **영어는 여기 없다** — 영어가 base 그 자체이기 때문이다. `en` 은 오버레이를
 * 조회하지 않고 곧장 base 를 쓴다.
 */
export type RegistryLocale = "ko" | "ja";

/** 한 로케일의 표시 문자열. 필드별로 독립 폴백하므로 둘 다 옵셔널이다. */
export interface RegistryLocalizedStrings {
  name?: string;
  description?: string;
}

/**
 * files 설치: root 는 앱이 절대경로로 매핑하는 enum 키. 경로는 절대 안 받는다.
 * root 는 item type 에 묶인다(skill→claude-skills, agent→claude-agents) — 파서와
 * installer 가 각각 독립적으로 재검사한다.
 */
export interface RegistryFilesInstall {
  kind: "files";
  root: "claude-skills" | "claude-agents";
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
  /**
   * 계약상의 enum 전체. Phase 1a 에서 실제로 파싱을 통과하는 것은 npx·uvx 뿐이다
   * (docker/binary 는 installer 가 거부하므로, 파서가 미리 떨궈 죽은 설치 버튼을
   * 만들지 않는다). 타입은 계약 공간을, 파서·installer 는 지원 범위를 나타낸다.
   */
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
   * 표시 문자열의 로케일 오버레이(공개 스키마 `i18n`, 옵셔널). name·description
   * 은 위의 영어 base 가 정본이고 이건 덧씌우기다 — 없는 항목이 다수이며 그게
   * 정상 상태다. UI 는 **필드 단위로** 폴백해야 한다(§i18n): 이름만 번역된
   * 항목은 이름만 번역돼 나와야지, 둘 다 있어야 보이는 규칙이면 부분 번역이
   * 통째로 사라진다.
   */
  i18n?: Partial<Record<RegistryLocale, RegistryLocalizedStrings>>;
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
  /** source repo 안의 서브경로(디렉터리 prefix) — files 는 여기 기준 상대경로. */
  sourcePath?: string;
  license?: string;
  homepage?: string;
  /** repo 내 항목 경로 (예: skills/code-review). */
  path: string;
  /** 이 항목을 읽은 레지스트리 커밋 — 설치는 항상 이 커밋에서 받는다. */
  commit: string;
  /**
   * null = 이 manifest 로는 안전한 자동 설치가 불가(계약 미선언, 또는 선언했으나
   * 형태 검증 실패) — UI 는 목록·공시만 하고 설치 버튼을 달지 않는다. 이유는
   * notInstallableReason 에 담겨 그대로 표시된다.
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
/** 공개 스키마의 install.files 항목 패턴과 동일 — `..`/절대경로/역슬래시 불가. */
const INSTALL_FILE_RE =
  /^[A-Za-z0-9_][A-Za-z0-9._-]*(?:\/[A-Za-z0-9_][A-Za-z0-9._-]*)*$/;
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

const I18N_LOCALES: RegistryLocale[] = ["ko", "ja"];

/**
 * i18n 오버레이 파싱. install 블록과 달리 **여기서 실패해도 항목을 숨기지
 * 않는다** — 이건 표시 문자열 덧씌우기일 뿐이라, 오버레이가 깨졌으면 영어
 * base 로 그리면 그만이다. 항목을 통째로 감추면 번역 오타 하나가 멀쩡한 자산을
 * 스토어에서 지워버린다. 그래서 모르는 로케일·모양이 틀린 값은 **그 필드만**
 * 조용히 버리고 나머지는 살린다.
 *
 * 공백뿐인 문자열은 base 보다 나쁘다(카드가 빈칸으로 렌더된다) — 길이만 보는
 * asString 을 그대로 쓰지 않고 trim 결과로 판정하는 이유다.
 */
export function parseI18nBlock(
  v: unknown,
): Partial<Record<RegistryLocale, RegistryLocalizedStrings>> | undefined {
  if (!v || typeof v !== "object" || Array.isArray(v)) return undefined;
  const src = v as Record<string, unknown>;
  const out: Partial<Record<RegistryLocale, RegistryLocalizedStrings>> = {};
  for (const locale of I18N_LOCALES) {
    const entry = src[locale];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
    const e = entry as Record<string, unknown>;
    const strings: RegistryLocalizedStrings = {};
    const name = asDisplayString(e.name, 80);
    const description = asDisplayString(e.description, MAX_DESCRIPTION_LEN);
    if (name) strings.name = name;
    if (description) strings.description = description;
    if (name || description) out[locale] = strings;
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

function asDisplayString(v: unknown, maxLen: number): string | undefined {
  const s = asString(v, maxLen);
  return s && s.trim() !== "" ? s : undefined;
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
  let sourcePath: string | undefined;
  if (m.source && typeof m.source === "object" && !Array.isArray(m.source)) {
    const src = m.source as Record<string, unknown>;
    sourceRepository = asString(src.repository, 200) ?? undefined;
    sourceRef = asString(src.ref, 120) ?? undefined;
    sourcePath = asString(src.path, 300) ?? undefined;
  }

  const item: RegistryItem = {
    schemaVersion: sv,
    id,
    name,
    type: expectedType,
    version,
    description,
    i18n: parseI18nBlock(m.i18n),
    tier: tier as RegistryTier,
    publisherName,
    publisherUrl: asString(pubObj.url, 200) ?? undefined,
    status,
    permissions,
    permissionsDeclared,
    sourceRepository,
    sourceRef,
    sourcePath,
    license: asString(m.license, 40) ?? undefined,
    homepage: asString(m.homepage, 200) ?? undefined,
    path: itemPath,
    commit,
    install: null,
    installDerived: false,
  };

  // install 블록은 **schema_version 과 무관하게** 읽는다. 공개 스키마는 이것을
  // v1 의 옵셔널 필드로 실었다(옵셔널 추가는 breaking change 가 아니라 기존
  // manifest 가 전부 유효하게 남는다) — 여기서 sv===2 로 게이트하면 실제 레지스트리가
  // 싣고 있는 계약을 앱이 통째로 못 읽는다. 형태만 검증해 싣고, 강제 규칙(§4.4)은
  // installer 가 설치 직전에 다시 전부 돈다.
  if (m.install !== undefined) {
    item.install = parseInstallBlock(m.install, expectedType);
    if (!item.install) {
      // 계약을 **선언했는데 유효하지 않은** 경우다. 이 항목은 목록·공시만 한다 —
      // 아래 트리 파생으로 조용히 대체하면 게시자가 쓴 계약을 무시하고 레포
      // 페이로드를 대신 설치하게 된다(선언과 다른 것을 설치 = 조용한 오동작).
      item.notInstallableReason = "install 블록이 유효하지 않음";
    }
  } else if (sv === 2) {
    // v2 는 install 이 필수다(§3.2). 없으면 설치 계약 없음.
    item.notInstallableReason = "install 블록이 없음(schema v2 필수)";
  }

  // ★community files 설치의 페이로드는 레지스트리 레포에 없다(no-vendor 정책) —
  // 설치 바이트는 3자 source repo 의 pinned ref 에서만 온다. pinned source 가
  // 없으면 설치 버튼이 눌리는 순간 installer 가 반드시 거부하므로, 여기서 미리
  // 떨궈 죽은 버튼을 만들지 않는다(정직한 UI — 강제는 installer 가 독립으로
  // 다시 한다).
  if (
    item.tier === "community" &&
    item.install?.kind === "files" &&
    !hasInstallableCommunitySource(item)
  ) {
    item.install = null;
    item.notInstallableReason =
      "community 설치는 pinned source(GitHub, 40-hex SHA/버전태그) 필수";
  }
  return item;
}

// ── Community source pin (3자 repo 설치 참조) ──────────────────────
//
// community files 설치는 marblo-app/marblo 가 아니라 **게시자의 source repo**
// 에서 받는다(no-vendor). 그 참조가 안전하려면 세 가지가 전부 필요하다:
//   (1) repository 가 github.com 의 owner/repo 로 정확히 파싱된다(호스트를
//       manifest 가 고르지 못한다 — raw URL 은 앱이 조립한다),
//   (2) ref 가 불변 핀이다(40-hex SHA 또는 버전태그 — 공개 스키마 source.ref
//       패턴과 1:1). main/HEAD 같은 가변 브랜치는 "내일 다른 코드"가 된다,
//   (3) path 가 경로탈출 없는 상대 디렉터리 prefix 다.
// 여기 함수들은 파서의 정직한-UI 판정용이고, installer 가 설치 직전에 같은
// 규칙을 독립적으로 다시 강제한다(§4.4 — client 파싱 결과 불신).

const SOURCE_REF_SHA_RE = /^[0-9a-f]{40}$/;
/** 공개 스키마 source.ref 의 버전태그 패턴과 1:1. main/master/HEAD 는 불일치. */
const SOURCE_REF_TAG_RE = /^v?\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/;
const SOURCE_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/;
const SOURCE_REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function isPinnedSourceRef(ref: unknown): ref is string {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 120) {
    return false;
  }
  return SOURCE_REF_SHA_RE.test(ref) || SOURCE_REF_TAG_RE.test(ref);
}

/**
 * `https://github.com/<owner>/<repo>` 만 통과 — 그 외 호스트/스킴/모양은 null.
 * raw URL 은 여기서 얻은 owner/repo 로 앱이 직접 조립하므로, manifest 가
 * 임의 호스트로 fetch 를 돌릴 방법이 없다.
 */
export function parseGitHubSourceRepository(
  repository: unknown,
): { owner: string; repo: string } | null {
  if (typeof repository !== "string" || repository.length > 200) return null;
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(repository);
  if (!m) return null;
  const owner = m[1];
  let repo = m[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (!SOURCE_OWNER_RE.test(owner)) return null;
  if (!SOURCE_REPO_NAME_RE.test(repo) || repo === "." || repo === "..") {
    return null;
  }
  return { owner, repo };
}

/** source.path 는 상대 디렉터리 prefix — 절대경로·역슬래시·dot 세그먼트 거부. */
export function isSafeSourcePath(p: unknown): boolean {
  if (p === undefined) return true;
  if (typeof p !== "string" || p.length === 0 || p.length > 300) return false;
  if (p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) {
    return false;
  }
  const segments = p.split("/");
  if (segments.length > 8) return false;
  return segments.every(
    (seg) =>
      seg !== "" &&
      seg !== "." &&
      seg !== ".." &&
      /^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$/.test(seg),
  );
}

export function hasInstallableCommunitySource(
  item: Pick<RegistryItem, "sourceRepository" | "sourceRef" | "sourcePath">,
): boolean {
  return (
    parseGitHubSourceRepository(item.sourceRepository) !== null &&
    isPinnedSourceRef(item.sourceRef) &&
    isSafeSourcePath(item.sourcePath)
  );
}

/**
 * 선언된 install 블록의 **형태**만 검증한다. 공개 스키마
 * (registry/manifest.schema.json `install`) 와 1:1 로 맞춰져 있어야 한다 —
 * 여기가 더 느슨하면 스키마가 거부한 모양이 앱에서만 통과하고, 더 빡빡하면
 * CI 를 통과한 정상 항목이 앱에서 조용히 설치불가로 떨어진다.
 */
function parseInstallBlock(
  v: unknown,
  expectedType: RegistryItemType,
): RegistryInstall | null {
  if (!v || typeof v !== "object" || Array.isArray(v)) return null;
  const b = v as Record<string, unknown>;
  // files 설치를 갖는 타입과, 그 타입이 쓸 수 있는 **유일한** root.
  // 공개 스키마의 같은 게이트와 1:1 — 여기가 더 느슨하면 스키마가 거부한 root 조합이
  // 앱에서만 통과해 "skill 로 리뷰된 항목이 에이전트 트리에 착지"가 가능해진다.
  const filesRoot = FILES_INSTALL_ROOT_BY_TYPE[expectedType];
  if (filesRoot && b.kind === "files") {
    const dest = asString(b.dest, MAX_ID_LEN);
    const files = asStringArray(b.files, MAX_FILES_PER_ITEM, 300);
    if (b.root !== filesRoot || !dest || !files || files.length === 0) {
      return null;
    }
    // dest·files 의 모양도 여기서 본다. installer 가 어차피 다시 보지만, 통과
    // 시켜두면 스토어가 "누르면 경로탈출로 거부되는" 설치 버튼을 그린다.
    // 이 검사는 방어가 아니라 정직한 UI 를 위한 것이다 — 방어는 installer 다.
    if (!ID_RE.test(dest)) return null;
    if (
      files.some((f) => !INSTALL_FILE_RE.test(f) || f.split("/").length > 8)
    ) {
      return null;
    }
    // 선언된 files 설치는 integrity 가 **필수**다(공개 스키마와 동일). installer 는
    // 다이제스트가 있을 때만 대조하므로, 여기서 요구하지 않으면 "계약을 선언했는데
    // 아무것도 대조되지 않는" 설치가 생긴다. 트리 파생 설치(v1, 아래 함수)는 핀
    // 커밋 자체가 앵커라 별개 경로다.
    if (
      !b.integrity ||
      typeof b.integrity !== "object" ||
      Array.isArray(b.integrity)
    ) {
      return null;
    }
    const digestMap = (b.integrity as Record<string, unknown>).files;
    if (
      !digestMap ||
      typeof digestMap !== "object" ||
      Array.isArray(digestMap)
    ) {
      return null;
    }
    const integrity: Record<string, string> = {};
    for (const [k, val] of Object.entries(
      digestMap as Record<string, unknown>,
    )) {
      const hex = asString(val, 64);
      if (!hex || !/^[0-9a-f]{64}$/.test(hex)) return null;
      integrity[k] = hex;
    }
    // 목록의 모든 파일이 다이제스트로 덮여야 한다 — 일부만 덮이면 나머지는
    // 대조 없이 디스크에 쓰인다.
    if (files.some((f) => !integrity[f])) return null;
    return { kind: "files", root: filesRoot, dest, files, integrity };
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
    // docker/binary 는 계약상 유효하지만 installer 가 Phase 1a 에서 거부한다.
    // 여기서 통과시키면 스토어가 **누르면 반드시 실패하는** 설치 버튼을 그린다 —
    // 이 모듈의 원칙(가짜 설치 버튼 금지)에 어긋나므로 파싱 단계에서 떨군다.
    if (!["npx", "uvx"].includes(runner)) return null;
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
  // manifest 가 계약을 선언했는데 거부된 경우(reason 이 이미 붙어 있다) 파생하지
  // 않는다 — 선언된 것과 다른 페이로드를 대신 설치하게 되기 때문.
  if (item.notInstallableReason) return;
  // ★community 는 트리 파생 설치가 없다: 파생 allowlist 에는 integrity 가 없어
  // installer 의 "community 는 파일 전수 digest 대조" 규칙에 반드시 걸린다 —
  // 여기서 파생해 주면 누르면 거부되는 죽은 버튼이 된다. community 는 pinned
  // source + integrity 를 **선언**한 항목만 설치 가능하다.
  if (item.tier === "community") {
    item.notInstallableReason =
      "community 는 트리 파생 설치 불가 — install 계약(pinned source+integrity) 선언 필요";
    return;
  }
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

/** 단일 raw URL fetch + 크기 상한(초과는 잘라내지 않고 거부). URL 검증은 caller 몫. */
export async function fetchRawFile(
  fetchImpl: typeof fetch,
  url: string,
  maxBytes: number,
): Promise<Buffer> {
  const res = await fetchWithTimeout(fetchImpl, url, "*/*");
  if (!res.ok) throw new Error(`raw fetch ${url} → ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > maxBytes) {
    throw new Error(
      `raw fetch ${url} → ${buf.byteLength}B > 한도 ${maxBytes}B`,
    );
  }
  return buf;
}

export async function fetchRawRegistryFile(
  fetchImpl: typeof fetch,
  commit: string,
  repoPath: string,
  maxBytes: number,
): Promise<Buffer> {
  return fetchRawFile(fetchImpl, `${RAW_BASE}/${commit}/${repoPath}`, maxBytes);
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

/** 트리에서 인덱싱 대상 manifest 후보를 고른다: <dir>/<name>/marblo.yaml 정확히 2단. */
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
    const itemType = INDEXED_DIRS[m[1]];
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
        // agent 는 skill 과 달리 트리 파생을 하지 않는다: 에이전트 디렉터리에는
        // frontmatter 가 없는 README 가 함께 있고, 그것까지 에이전트 트리에 심으면
        // 게시자가 선언하지 않은 파일을 하네스가 로드 대상으로 스캔하게 된다.
        // 계약을 선언한 항목만 설치하고, 나머지는 이유를 붙여 목록·공시만 한다.
        if (
          item &&
          (item.type === "mcp-server" || item.type === "agent") &&
          !item.install
        ) {
          item.notInstallableReason ??=
            "manifest 에 설치 계약 없음 — 수동 설치만 가능";
        }
        // workflow/knowledge 는 설치 계약 자체가 없는 참조 전용 타입이다 —
        // 스토어는 링크만 제공한다(가짜 설치 버튼 금지).
        if (item && (item.type === "workflow" || item.type === "knowledge")) {
          item.install = null;
          item.notInstallableReason ??= "참조 전용 타입 — 인앱 설치 없음";
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
