/**
 * Registry installer — 공개 레지스트리 항목의 설치/제거. **이 파일이 untrusted
 * manifest 입력의 보안 경계다** (설계 §4.4). 여기 규칙은 전부 "설치 직전"에
 * 다시 돈다 — registry-client 의 파싱 결과를 신뢰하지 않는다.
 *
 * 하드룰 요약 (설계 §4.4, 전부 이 파일에서 강제):
 *   1. root 는 enum — manifest 는 키만 주고, 절대경로는 앱 코드가 매핑한다.
 *   2. dest 는 단일 세그먼트 + resolve/realpath 컨테인 재검사(심링크 탈출 방어).
 *   3. files[] 는 allowlist — 목록 밖은 쓰지 않고, 경로탈출 세그먼트는 거부.
 *   4. free-form command 금지 — runner enum, package 는 name@exact-version.
 *   5. env_required 는 이름만. expandEnv 는 레지스트리 경로에 절대 적용 안 함.
 *      "${" 는 args/package/key 어디에서도 거부(하네스 CLI 의 런타임 env 확장을
 *      통한 우회 유출 차단). 하네스 크레덴셜 키는 env_required 로 요구 불가.
 *   6. installShell(curl-pipe-bash)은 레지스트리에서 도달 불가 — 이 모듈엔
 *      그 경로 자체가 없다(내장 카탈로그 전용).
 *   7. uninstall 은 원장 기반 — 설치 후 편집된 manifest 가 삭제를 못 돌린다.
 *   8. 모든 정규식은 anchored + 길이 한도, 초과는 잘라내지 않고 거부.
 *   9. ★community files 설치는 3자 source repo 에서 받는다(no-vendor). 그 fetch 는
 *      (a) https://github.com/<owner>/<repo> 로 파싱된 좌표에서 앱이 조립한
 *      raw.githubusercontent.com URL 로만 나가고(호스트 allowlist — manifest 가
 *      URL 을 실어 보낼 방법이 없다), (b) ref 는 불변 핀(40-hex SHA 또는
 *      버전태그)만 — main/HEAD 등 가변 브랜치는 거부, (c) 파일 **전수**가
 *      manifest integrity(sha256)와 대조된다 — 태그는 이동 가능하므로 digest 가
 *      실질적인 핀이다. consent 게이트(assertInstallableItem)는 이 경로에도
 *      동일하게 선행한다.
 */
import crypto from "crypto";
import fs from "fs";
import os from "os";
import path from "path";
import { CATALOG } from "./harness-catalog";
import { readClaudeJson, writeClaudeJsonAtomic } from "./harness-manager";
import {
  fetchRawFile,
  fetchRawRegistryFile,
  type RegistryFilesInstall,
  type RegistryIndex,
  type RegistryItem,
  type RegistryMcpInstall,
} from "./registry-client";
import {
  readLedger,
  writeLedger,
  type LedgerEntry,
  type RegistryLedger,
} from "./registry-ledger";

const HOME = os.homedir();

// §4.4 rule 1 — root enum. manifest 가 절대경로를 실어 보낼 방법이 없다.
const INSTALL_ROOTS: Record<string, string> = {
  "claude-skills": path.join(HOME, ".claude", "skills"),
  "claude-agents": path.join(HOME, ".claude", "agents"),
};

/**
 * root 는 item type 에 **묶여** 있다(공개 스키마의 같은 allOf 게이트와 1:1).
 * 단순 allowlist 로 두면 skill 로 리뷰된 항목이 에이전트 트리에 떨어질 수 있고,
 * 에이전트 트리의 파일은 하네스가 매 세션 로드하는 페르소나가 된다 — 즉 "리뷰된
 * 카테고리 ≠ 착지한 카테고리" 가 조용히 성립한다. 양방향 모두 거부한다.
 */
const ROOT_FOR_TYPE: Record<string, string> = {
  skill: "claude-skills",
  agent: "claude-agents",
};

const DEST_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_DEST_LEN = 64;
const FILE_SEGMENT_RE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,254}$/;
const MAX_FILE_PATH_LEN = 300;
const MAX_FILE_DEPTH = 8;
const MAX_FILES = 200;
const MAX_FILE_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 10 * 1024 * 1024;

// §4.4 rule 4 — runner enum. docker/binary 는 계약상 유효하지만 1a 에서는
// 설정을 쓰지 않는다(런치 시맨틱 미정) — 명시적 거부가 조용한 오동작보다 낫다.
const MCP_RUNNERS = new Set(["npx", "uvx", "docker", "binary"]);
const SUPPORTED_MCP_RUNNERS = new Set(["npx", "uvx"]);
const MCP_PACKAGE_RE =
  /^(@[a-z0-9~][a-z0-9._~-]{0,63}\/)?[a-z0-9~][a-z0-9._~-]{0,127}@\d+\.\d+\.\d+(-[0-9A-Za-z.-]{1,32})?$/;
const MCP_KEY_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const MAX_MCP_KEY_LEN = 48;
const ENV_NAME_RE = /^[A-Z][A-Z0-9_]{0,63}$/;
const MAX_ARG_LEN = 256;

/**
 * 레지스트리 MCP 서버가 요구할 수 없는 env 키 — 하네스/클라우드 크레덴셜.
 * env_required 는 "이 서버 전용으로 사용자가 넣어줄 키"지, 우리가 이미 들고
 * 있는 계정 크레덴셜을 서드파티 서버 프로세스로 흘려보내는 통로가 아니다.
 */
const ENV_DENYLIST = new Set([
  "ANTHROPIC_API_KEY",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_BASE_URL",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "GOOGLE_API_KEY",
  "GEMINI_API_KEY",
  "AWS_ACCESS_KEY_ID",
  "AWS_SECRET_ACCESS_KEY",
  "AWS_SESSION_TOKEN",
]);

// 내장 카탈로그와의 충돌 방어(§9 "registry id cannot shadow a builtin"):
// 레지스트리 항목은 내장 mcpKey / 내장 skills dest 를 절대 못 덮는다.
const BUILTIN_MCP_KEYS = new Set(
  CATALOG.map((p) => p.detect.mcpKey).filter((k): k is string => !!k),
);
const BUILTIN_SKILL_DESTS = new Set(
  CATALOG.filter((p) => p.install.kind === "git")
    .map((p) => p.install.dest)
    .filter((d): d is string => !!d),
);

export interface InstallerDeps {
  /** 원장 파일 경로 — main.ts 가 userData 로 채운다. */
  ledgerPath: string;
  /** 테스트 주입용 root enum 오버라이드(키셋은 동일해야 한다). */
  rootsOverride?: Record<string, string>;
  /** 테스트 주입용 ~/.claude.json 대체 IO. */
  claudeJsonIo?: {
    read: () => Record<string, unknown> & {
      mcpServers?: Record<string, unknown>;
    };
    write: (data: object) => void;
  };
  fetchImpl?: typeof fetch;
  marbloVersion?: string;
}

export interface InstallOptions {
  /** update 시 로컬 수정 감지에도 덮어쓰기(사용자가 명시 확인한 경우만). */
  overwriteLocalChanges?: boolean;
  /**
   * ★community(미검수) 항목 설치에 대한 명시 동의. 렌더러의 경고 모달이 이
   * 플래그를 세우지만, **강제는 여기(메인 프로세스)가 한다** — 렌더러 UI 를
   * 우회한 IPC 호출이 플래그 없이 community 를 설치할 수 없다. official/verified
   * 원클릭과 revoked 차단에는 이 플래그가 아무 영향도 주지 않는다.
   */
  acknowledgeUnreviewed?: boolean;
}

function roots(deps: InstallerDeps): Record<string, string> {
  return deps.rootsOverride ?? INSTALL_ROOTS;
}

function claudeJsonIo(
  deps: InstallerDeps,
): NonNullable<InstallerDeps["claudeJsonIo"]> {
  return (
    deps.claudeJsonIo ?? {
      read: () => readClaudeJson() as Record<string, unknown>,
      write: (data) => writeClaudeJsonAtomic(data),
    }
  );
}

// ── §4.4 rule 2 — dest / path containment ──────────────────────────

export function validateDest(dest: string): void {
  if (
    typeof dest !== "string" ||
    dest.length === 0 ||
    dest.length > MAX_DEST_LEN ||
    !DEST_RE.test(dest)
  ) {
    throw new Error(
      `설치 거부: dest "${dest}" 는 단일 소문자-하이픈 세그먼트가 아님`,
    );
  }
}

/**
 * dest 를 root 안의 절대경로로 해석하고, resolve + realpath 로 컨테인을
 * 재검사한다. dest 가 이미 존재하는데 심링크면 거부(심링크 탈출 방어) —
 * realpath 가 root 밖을 가리키는 경우도 거부.
 */
export function resolveContainedDest(rootDir: string, dest: string): string {
  validateDest(dest);
  const rootResolved = path.resolve(rootDir);
  const target = path.resolve(rootResolved, dest);
  const rel = path.relative(rootResolved, target);
  if (rel !== dest) {
    throw new Error(`설치 거부: dest "${dest}" 가 root 를 벗어남`);
  }
  let lst: fs.Stats | null = null;
  try {
    lst = fs.lstatSync(target);
  } catch {
    /* 존재하지 않음 — 신규 설치 */
  }
  if (lst) {
    if (lst.isSymbolicLink()) {
      throw new Error(`설치 거부: dest "${dest}" 가 심링크임`);
    }
    const rootReal = fs.realpathSync(rootResolved);
    const targetReal = fs.realpathSync(target);
    if (
      targetReal !== path.join(rootReal, dest) &&
      !targetReal.startsWith(path.join(rootReal, dest) + path.sep)
    ) {
      throw new Error(`설치 거부: dest "${dest}" realpath 가 root 밖을 가리킴`);
    }
  }
  return target;
}

// ── §4.4 rule 3 — files allowlist ──────────────────────────────────

export function validateRelFilePath(p: string): void {
  if (typeof p !== "string" || p.length === 0 || p.length > MAX_FILE_PATH_LEN) {
    throw new Error(`설치 거부: 파일 경로 길이 위반`);
  }
  if (p.includes("\\") || p.startsWith("/") || /^[A-Za-z]:/.test(p)) {
    throw new Error(`설치 거부: 파일 경로 "${p}" 형식 위반(절대경로/역슬래시)`);
  }
  const segments = p.split("/");
  if (segments.length > MAX_FILE_DEPTH) {
    throw new Error(`설치 거부: 파일 경로 "${p}" 깊이 초과`);
  }
  for (const seg of segments) {
    if (
      seg === "" ||
      seg === "." ||
      seg === ".." ||
      !FILE_SEGMENT_RE.test(seg)
    ) {
      throw new Error(`설치 거부: 파일 경로 "${p}" 에 허용되지 않는 세그먼트`);
    }
  }
}

export function validateFilesList(files: string[]): void {
  if (!Array.isArray(files) || files.length === 0 || files.length > MAX_FILES) {
    throw new Error("설치 거부: files 목록이 비었거나 한도 초과");
  }
  const seen = new Set<string>();
  for (const f of files) {
    validateRelFilePath(f);
    if (seen.has(f)) throw new Error(`설치 거부: files 중복 항목 "${f}"`);
    seen.add(f);
  }
}

// ── §4.4 rules 4·5 — MCP 서버 설정 구성(자유 커맨드·env 유출 차단) ──

function assertNoRuntimeExpansion(value: string, where: string): void {
  // 하네스 CLI 들은 MCP 설정의 command/args/env 에서 ${VAR} 를 런타임 확장한다.
  // 우리가 expandEnv 를 안 돌려도 manifest 가 "${ANTHROPIC_API_KEY}" 를 args 에
  // 실으면 CLI 가 확장해 서버 argv 로 넘긴다 — 그래서 문법 자체를 거부한다.
  if (value.includes("${")) {
    throw new Error(
      `설치 거부: ${where} 에 env 확장 문법("\${")은 허용되지 않음`,
    );
  }
}

/**
 * RegistryMcpInstall → ~/.claude.json mcpServers 엔트리. 검증 실패는 전부
 * throw — 어떤 것도 쓰지 않는다. **expandEnv 는 여기서 절대 호출하지 않는다.**
 */
export function buildMcpServerEntry(install: RegistryMcpInstall): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  if (!MCP_RUNNERS.has(install.runner)) {
    throw new Error(
      `설치 거부: runner "${install.runner}" 는 허용 목록에 없음`,
    );
  }
  if (!SUPPORTED_MCP_RUNNERS.has(install.runner)) {
    throw new Error(
      `설치 거부: runner "${install.runner}" 는 Phase 1a 에서 미지원(1b 예정)`,
    );
  }
  if (
    typeof install.package !== "string" ||
    install.package.length > 200 ||
    !MCP_PACKAGE_RE.test(install.package)
  ) {
    throw new Error(
      `설치 거부: package "${install.package}" 는 name@x.y.z 정확 핀이 아님`,
    );
  }
  assertNoRuntimeExpansion(install.package, "package");
  if (
    typeof install.mcpKey !== "string" ||
    install.mcpKey.length > MAX_MCP_KEY_LEN ||
    !MCP_KEY_RE.test(install.mcpKey)
  ) {
    throw new Error(`설치 거부: mcp_key "${install.mcpKey}" 형식 위반`);
  }
  if (BUILTIN_MCP_KEYS.has(install.mcpKey)) {
    throw new Error(
      `설치 거부: mcp_key "${install.mcpKey}" 는 내장 카탈로그 키와 충돌(가림 금지)`,
    );
  }
  if (!Array.isArray(install.args) || install.args.length > 20) {
    throw new Error("설치 거부: args 형식 위반");
  }
  for (const a of install.args) {
    if (typeof a !== "string" || a.length > MAX_ARG_LEN) {
      throw new Error("설치 거부: args 항목 길이 위반");
    }
    assertNoRuntimeExpansion(a, "args");
  }
  if (!Array.isArray(install.envRequired) || install.envRequired.length > 10) {
    throw new Error("설치 거부: env_required 형식 위반");
  }
  const env: Record<string, string> = {};
  for (const name of install.envRequired) {
    if (typeof name !== "string" || !ENV_NAME_RE.test(name)) {
      throw new Error(
        `설치 거부: env_required 이름 "${name}" 형식 위반(이름만 허용)`,
      );
    }
    if (ENV_DENYLIST.has(name)) {
      throw new Error(
        `설치 거부: env_required 에 하네스 크레덴셜 키 "${name}" 요구 불가`,
      );
    }
    // 값은 우리가 절대 채우지 않는다 — "${NAME}" 리터럴을 남겨 하네스 CLI 가
    // 사용자 환경에서 런타임 확장하게 한다(자기 자신 키의 자기 참조만 허용).
    env[name] = `\${${name}}`;
  }
  const args =
    install.runner === "npx"
      ? ["-y", install.package, ...install.args]
      : [install.package, ...install.args];
  return { command: install.runner, args, env };
}

// ── §4.4 rule 9 — community source fetch (3자 repo, pinned only) ───
//
// registry-client 에 같은 모양의 판정이 있지만(정직한 UI 용) 여기서 **독립
// 재구현**한다 — 이 파일이 보안 경계다. client 쪽이 느슨해져도 설치는 여기서
// 막힌다. 세 함수 전부: 실패는 throw, 어떤 것도 fetch 하지 않는다.

const SOURCE_FETCH_ALLOWED_HOSTS = new Set(["raw.githubusercontent.com"]);
const SRC_REF_SHA_RE = /^[0-9a-f]{40}$/;
/** 공개 스키마 source.ref 버전태그 패턴과 1:1 — main/master/HEAD/develop 불일치. */
const SRC_REF_TAG_RE = /^v?\d+(\.\d+)*([.-][0-9A-Za-z.-]+)?$/;
const SRC_OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})?$/;
const SRC_REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function assertPinnedSourceRef(ref: unknown): string {
  if (typeof ref !== "string" || ref.length === 0 || ref.length > 120) {
    throw new Error("설치 거부: source.ref 없음 또는 길이 위반");
  }
  if (!SRC_REF_SHA_RE.test(ref) && !SRC_REF_TAG_RE.test(ref)) {
    throw new Error(
      `설치 거부: source.ref "${ref}" 는 pinned 참조가 아님(40-hex SHA 또는 버전태그만 — 브랜치/HEAD 불가)`,
    );
  }
  return ref;
}

export function parseSourceRepositoryOrThrow(repository: unknown): {
  owner: string;
  repo: string;
} {
  if (typeof repository !== "string" || repository.length > 200) {
    throw new Error("설치 거부: source.repository 없음 또는 길이 위반");
  }
  const m = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)\/?$/.exec(repository);
  if (!m) {
    throw new Error(
      `설치 거부: source.repository "${repository}" 는 https://github.com/<owner>/<repo> 형식이 아님`,
    );
  }
  const owner = m[1];
  let repo = m[2];
  if (repo.endsWith(".git")) repo = repo.slice(0, -4);
  if (
    !SRC_OWNER_RE.test(owner) ||
    !SRC_REPO_NAME_RE.test(repo) ||
    repo === "." ||
    repo === ".."
  ) {
    throw new Error(
      `설치 거부: source.repository "${repository}" 의 owner/repo 형식 위반`,
    );
  }
  return { owner, repo };
}

/**
 * community 항목의 source 좌표 → raw fetch base URL. manifest 는 URL 을 실을 수
 * 없다 — owner/repo/ref/path 를 각각 charset 검증한 뒤 앱이 조립하고, 조립
 * 결과를 URL 파서로 재검사해 허용 호스트만 통과시킨다(스푸핑·인젝션 방어).
 */
export function buildCommunitySourceBase(
  item: Pick<RegistryItem, "sourceRepository" | "sourceRef" | "sourcePath">,
): string {
  const { owner, repo } = parseSourceRepositoryOrThrow(item.sourceRepository);
  const ref = assertPinnedSourceRef(item.sourceRef);
  let prefix = "";
  if (item.sourcePath !== undefined) {
    // 경로탈출·절대경로·역슬래시·dot 세그먼트 거부 — files 와 같은 규칙.
    validateRelFilePath(item.sourcePath);
    prefix = `/${item.sourcePath}`;
  }
  const base = `https://raw.githubusercontent.com/${owner}/${repo}/${ref}${prefix}`;
  assertAllowedSourceUrl(base);
  return base;
}

/** 파일 하나의 최종 fetch URL — rel 은 이미 allowlist 검증됐지만, 조립 결과를
 *  다시 URL 파서로 재검사한다(방어 심층 — 어떤 조합도 허용 호스트를 못 벗어난다). */
function sourceFileUrl(base: string, rel: string): string {
  const url = `${base}/${rel}`;
  assertAllowedSourceUrl(url);
  return url;
}

function assertAllowedSourceUrl(url: string): void {
  const parsed = new URL(url);
  if (
    parsed.protocol !== "https:" ||
    !SOURCE_FETCH_ALLOWED_HOSTS.has(parsed.hostname) ||
    parsed.username !== "" ||
    parsed.password !== "" ||
    parsed.port !== ""
  ) {
    throw new Error(
      `설치 거부: source fetch URL "${url}" 은 허용 호스트가 아님`,
    );
  }
}

// ── 공통 게이트 ────────────────────────────────────────────────────

function assertInstallableItem(item: RegistryItem, opts: InstallOptions): void {
  // revoked 는 어떤 동의로도 뚫리지 않는다 — tier 게이트보다 먼저 본다.
  if (item.status === "revoked") {
    throw new Error("설치 거부: 회수(revoked)된 항목");
  }
  // §6.3 — community 는 리뷰되지 않은 텍스트 페이로드다. 설치는 사용자가
  // 경고를 지나 명시 동의(acknowledgeUnreviewed)를 준 요청만 통과한다.
  // 플래그 강제는 이 함수(메인 프로세스)가 한다 — 렌더러 UI 는 신뢰하지 않는다.
  if (item.tier === "community") {
    if (opts.acknowledgeUnreviewed !== true) {
      throw new Error(
        "설치 거부: community tier 는 미검수 — 경고 동의(acknowledgeUnreviewed) 없는 설치 불가",
      );
    }
  } else if (item.tier !== "official" && item.tier !== "verified") {
    throw new Error(`설치 거부: 알 수 없는 tier "${item.tier}"`);
  }
  if (!item.install) {
    throw new Error(item.notInstallableReason ?? "설치 거부: 설치 계약 없음");
  }
  if (!/^[0-9a-f]{40}$/.test(item.commit)) {
    throw new Error("설치 거부: 핀 커밋이 유효하지 않음");
  }
}

function sha256(buf: Buffer): string {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ── files 설치 ─────────────────────────────────────────────────────

async function installFiles(
  item: RegistryItem,
  install: RegistryFilesInstall,
  deps: InstallerDeps,
  opts: InstallOptions,
): Promise<LedgerEntry> {
  const rootDir = roots(deps)[install.root];
  if (!rootDir) {
    throw new Error(`설치 거부: root "${install.root}" 는 허용 목록에 없음`);
  }
  const expectedRoot = ROOT_FOR_TYPE[item.type];
  if (!expectedRoot) {
    throw new Error(`설치 거부: type "${item.type}" 은 files 설치를 갖지 않음`);
  }
  if (install.root !== expectedRoot) {
    throw new Error(
      `설치 거부: type "${item.type}" 은 root "${expectedRoot}" 에만 설치 가능(선언값 "${install.root}")`,
    );
  }
  validateFilesList(install.files);
  // 내장 카탈로그 스킬 가림 방어는 **스킬 트리에서만** 의미가 있다. 에이전트
  // 트리의 dest 는 내장 스킬과 같은 이름공간이 아니므로, 여기서 무조건 막으면
  // 정상 에이전트 항목이 이유 없이 거부된다.
  if (
    install.root === "claude-skills" &&
    BUILTIN_SKILL_DESTS.has(install.dest)
  ) {
    throw new Error(
      `설치 거부: dest "${install.dest}" 는 내장 카탈로그 스킬과 충돌(가림 금지)`,
    );
  }
  // ★§4.4 rule 9 — community 페이로드는 레지스트리 레포에 없다(no-vendor).
  // 3자 source repo 의 pinned ref 에서만 받고, 파일 전수를 manifest integrity 와
  // 대조한다(태그 핀은 이동 가능 — digest 가 실질적인 핀이다). base URL 검증
  // 실패·핀 아님·integrity 누락은 전부 여기서, 네트워크에 나가기 전에 죽는다.
  const sourceBase =
    item.tier === "community" ? buildCommunitySourceBase(item) : null;
  if (sourceBase) {
    for (const rel of install.files) {
      if (!install.integrity?.[rel]) {
        throw new Error(
          `설치 거부: community 설치는 파일 전수 integrity 필수("${rel}" digest 누락)`,
        );
      }
    }
  }

  fs.mkdirSync(rootDir, { recursive: true });
  const target = resolveContainedDest(rootDir, install.dest);

  const ledger = readLedger(deps.ledgerPath);
  const existing = ledger.items[item.id];
  if (fs.existsSync(target)) {
    if (!existing || existing.install.dest !== install.dest) {
      throw new Error(
        `설치 거부: ${install.dest} 가 이미 존재하지만 레지스트리 원장 소유가 아님`,
      );
    }
    // update 경로: 로컬 수정 감지(§4.5) — 사용자가 손댄 파일을 조용히 덮지 않는다.
    if (!opts.overwriteLocalChanges) {
      for (const f of existing.files ?? []) {
        const onDisk = path.join(target, ...f.path.split("/"));
        try {
          if (sha256(fs.readFileSync(onDisk)) !== f.sha256) {
            throw new Error(
              `설치 거부: 로컬 수정 감지(${f.path}) — 덮어쓰기 확인 필요`,
            );
          }
        } catch (err) {
          if (err instanceof Error && err.message.startsWith("설치 거부"))
            throw err;
          // 파일이 지워졌으면 수정으로 간주하지 않는다 — 재설치가 복원한다.
        }
      }
    }
  }

  // 스테이징에 전부 받아 성공하면 rename — 부분 설치를 남기지 않는다.
  const fetchImpl = deps.fetchImpl ?? fetch;
  const staging = path.join(
    rootDir,
    `.reg-staging-${process.pid}-${crypto.randomBytes(4).toString("hex")}`,
  );
  const written: Array<{ path: string; sha256: string }> = [];
  let total = 0;
  try {
    fs.mkdirSync(staging, { recursive: true });
    for (const rel of install.files) {
      const buf = sourceBase
        ? await fetchRawFile(
            fetchImpl,
            sourceFileUrl(sourceBase, rel),
            MAX_FILE_BYTES,
          )
        : await fetchRawRegistryFile(
            fetchImpl,
            item.commit,
            `${item.path}/${rel}`,
            MAX_FILE_BYTES,
          );
      total += buf.byteLength;
      if (total > MAX_TOTAL_BYTES) {
        throw new Error("설치 거부: 페이로드 총 크기 한도 초과");
      }
      const digest = sha256(buf);
      const expected = install.integrity?.[rel];
      if (expected && expected !== digest) {
        throw new Error(`설치 거부: ${rel} integrity 불일치`);
      }
      const dst = path.join(staging, ...rel.split("/"));
      fs.mkdirSync(path.dirname(dst), { recursive: true });
      fs.writeFileSync(dst, buf);
      written.push({ path: rel, sha256: digest });
    }
    // 스테이징 완료 — 기존 디렉터리는 원장 소유 확인 후에만 교체.
    if (fs.existsSync(target)) {
      fs.rmSync(target, { recursive: true, force: true });
    }
    fs.renameSync(staging, target);
  } catch (err) {
    fs.rmSync(staging, { recursive: true, force: true });
    throw err;
  }

  return {
    manifestVersion: item.version,
    commit: item.commit,
    install: { kind: "files", root: install.root, dest: install.dest },
    // 감사 추적: community 는 설치 바이트가 어느 3자 repo 의 어느 핀에서
    // 왔는지를 원장에 남긴다(레지스트리 커밋만으로는 답할 수 없는 질문).
    ...(sourceBase
      ? { sourceRepository: item.sourceRepository, sourceRef: item.sourceRef }
      : {}),
    files: written,
    permissionsGranted: item.permissions,
    installedAt: new Date().toISOString(),
    installedByMarbloVersion: deps.marbloVersion,
  };
}

// ── mcp-server 설치 ────────────────────────────────────────────────

function installMcpServer(
  item: RegistryItem,
  install: RegistryMcpInstall,
  deps: InstallerDeps,
): LedgerEntry {
  const entry = buildMcpServerEntry(install);
  const io = claudeJsonIo(deps);
  const cfg = io.read();
  const servers = (cfg.mcpServers ?? {}) as Record<string, unknown>;
  const ledger = readLedger(deps.ledgerPath);
  const existing = ledger.items[item.id];
  if (
    install.mcpKey in servers &&
    (!existing || existing.install.mcpKey !== install.mcpKey)
  ) {
    throw new Error(
      `설치 거부: mcpServers["${install.mcpKey}"] 가 이미 존재(원장 소유 아님)`,
    );
  }
  servers[install.mcpKey] = entry;
  cfg.mcpServers = servers;
  io.write(cfg);
  return {
    manifestVersion: item.version,
    commit: item.commit,
    install: { kind: "mcp-server", mcpKey: install.mcpKey },
    permissionsGranted: item.permissions,
    installedAt: new Date().toISOString(),
    installedByMarbloVersion: deps.marbloVersion,
  };
}

// ── 공개 API ───────────────────────────────────────────────────────

export async function installRegistryItem(
  item: RegistryItem,
  deps: InstallerDeps,
  opts: InstallOptions = {},
): Promise<void> {
  assertInstallableItem(item, opts);
  const install = item.install!;
  let entry: LedgerEntry;
  if (install.kind === "files") {
    entry = await installFiles(item, install, deps, opts);
  } else {
    entry = installMcpServer(item, install, deps);
  }
  const ledger = readLedger(deps.ledgerPath);
  ledger.items[item.id] = entry;
  writeLedger(deps.ledgerPath, ledger);
}

/**
 * §4.4 rule 7 — 원장 기반 uninstall. 원장에 기록된 파일 목록만 지우고, 빈
 * 디렉터리를 정리한다. manifest 는 아예 읽지 않는다.
 */
export function uninstallRegistryItem(id: string, deps: InstallerDeps): void {
  const ledger = readLedger(deps.ledgerPath);
  const entry = ledger.items[id];
  if (!entry) throw new Error(`제거 거부: 원장에 없는 항목 "${id}"`);

  if (entry.install.kind === "files") {
    const rootDir = entry.install.root ? roots(deps)[entry.install.root] : null;
    if (!rootDir || !entry.install.dest) {
      throw new Error("제거 거부: 원장 레코드가 불완전함");
    }
    const target = resolveContainedDest(rootDir, entry.install.dest);
    for (const f of entry.files ?? []) {
      validateRelFilePath(f.path);
      const p = path.join(target, ...f.path.split("/"));
      try {
        fs.rmSync(p, { force: true });
      } catch {
        /* 개별 파일 삭제 실패는 계속 진행 */
      }
    }
    // 우리가 쓴 파일만 지운 뒤, 비어 있으면 디렉터리 제거(사용자 파일 보존).
    removeEmptyDirsUnder(target);
  } else if (entry.install.kind === "mcp-server") {
    const key = entry.install.mcpKey;
    if (!key) throw new Error("제거 거부: 원장 레코드가 불완전함");
    const io = claudeJsonIo(deps);
    const cfg = io.read();
    if (cfg.mcpServers && key in cfg.mcpServers) {
      delete (cfg.mcpServers as Record<string, unknown>)[key];
      io.write(cfg);
    }
  }

  delete ledger.items[id];
  writeLedger(deps.ledgerPath, ledger);
}

function removeEmptyDirsUnder(target: string): void {
  try {
    const entries = fs.readdirSync(target, { withFileTypes: true });
    for (const e of entries) {
      if (e.isDirectory()) removeEmptyDirsUnder(path.join(target, e.name));
    }
    if (fs.readdirSync(target).length === 0) fs.rmdirSync(target);
  } catch {
    /* 디렉터리가 없거나 접근 불가 — 무시 */
  }
}

// ── UI 오버레이 ────────────────────────────────────────────────────

export type RegistryInstallState =
  | "installed"
  | "outdated"
  | "not-installed"
  | "not-installable";

export interface RegistryStoreItem extends RegistryItem {
  installState: RegistryInstallState;
  installedVersion?: string;
}

/** 인덱스 + 원장 → UI 항목(설치 상태 배지). 렌더마다 해시 재검사는 안 한다(§7 P3). */
export function overlayInstallState(
  index: RegistryIndex,
  ledger: RegistryLedger,
): RegistryStoreItem[] {
  return index.items.map((item) => {
    const entry = ledger.items[item.id];
    let installState: RegistryInstallState;
    if (entry) {
      installState =
        entry.manifestVersion === item.version ? "installed" : "outdated";
    } else {
      installState = item.install ? "not-installed" : "not-installable";
    }
    return {
      ...item,
      installState,
      installedVersion: entry?.manifestVersion,
    };
  });
}
