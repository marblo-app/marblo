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

// ── 빌트인 항목 — 스토어에 뜨면 안 되는 것들 ────────────────────────
//
// 위의 두 집합(BUILTIN_MCP_KEYS·BUILTIN_SKILL_DESTS)은 **착지 지점**의 충돌을
// 막는다: "레지스트리 항목이 내장 자산의 자리를 덮지 못한다". 여기서 다루는
// 것은 다른 질문이다 — **그 항목이 애초에 스토어에 있어야 하는가**.
//
// 아래 id 들은 사용자가 이미 갖고 있는 것들이다. 설치 버튼을 눌러야 생기는
// 물건이 아니라 앱(또는 하네스 CLI)이 심어 놓고 시작하는 물건이라, 스토어
// 목록에 뜨면 "안 깔려 있나?" 라는 없는 질문을 만든다. 그래서 목록에서 뺀다.
//
// ★이 집합은 "official 티어 기본설치"(DEFAULT_INSTALL_*)와 **정반대 개념**이다.
// 헷갈리면 안 된다:
//   - 빌트인(여기)     = 설치 개념이 없음. 앱에 들어 있음. 스토어에서 숨김.
//   - official 기본설치 = 설치형 항목인데 첫 실행 때 우리가 대신 눌러 준 것.
//                        스토어에 그대로 보이고, 사용자가 제거할 수 있다.
//
// 파생이 아니라 **명시 집합**인 이유: '빌트인'의 출처가 세 갈래인데 어느 한
// 규칙도 셋을 다 덮지 못한다 — (a) 앱 번들이 심는 tf-*(bundle-installer),
// (b) 앱 프로세스가 곧 구현체인 marblo-control MCP, (c) 하네스 CLI 자체가 들고
// 있는 code-review. 억지 파생 규칙 하나로 묶으면 규칙이 무엇을 감추는지 아무도
// 못 읽는다. 대신 tf-* 는 번들 디렉터리와 어긋나지 않는지 테스트가 대조한다
// (registry-builtin-hidden.test.ts).
const BUILTIN_REGISTRY_ITEM_IDS = new Set<string>([
  // (a) 앱 번들 tf-* — bundle-installer 가 ~/.claude/{commands,skills} 에
  //     매 기동마다 심는다. 레지스트리에는 이 중 일부만 워크플로로 게시돼
  //     있지만, 집합은 번들 전체를 담는다(게시가 늘어도 자동으로 덮이게).
  "tf-add",
  "tf-analyze",
  "tf-create-tasks",
  "tf-done",
  "tf-feedback",
  "tf-fix",
  "tf-guide",
  "tf-handoff",
  "tf-hold",
  "tf-plan",
  "tf-ralph",
  "tf-resume",
  "tf-review",
  "tf-spawn-agents",
  "tf-start",
  "tf-status",
  "tf-sync",
  "tf-work",
  // (b) 오케스트레이터가 보드를 굴리는 MCP — 매니페스트 본문부터 "Ships with
  //     the Marblo app" 이다. 앱이 곧 이 서버라 설치할 대상이 없다.
  "marblo-control",
  // (c) 하네스 CLI(Claude Code)에 같은 이름의 네이티브 스킬이 이미 있다.
  //     이것만 성격이 다르다 — files 설치 계약이 **있는** 항목이라 누르면
  //     실제로 ~/.claude/skills/code-review 가 생기고, 그 순간 CLI 내장
  //     /code-review 와 이름이 겹친다. 그래서 숨기는 쪽이 안전하다.
  "code-review",
]);

/**
 * 이 항목이 "앱/하네스가 이미 들고 있는 것"인가. true 면 스토어 목록에서
 * 빠지고(overlayInstallState), 설치 요청도 거부된다(assertInstallableItem).
 */
export function isBuiltinRegistryItem(id: string): boolean {
  return BUILTIN_REGISTRY_ITEM_IDS.has(id);
}

/** 테스트가 번들 디렉터리와 대조할 수 있게 노출(복사본 — 원본 불변). */
export function builtinRegistryItemIds(): string[] {
  return [...BUILTIN_REGISTRY_ITEM_IDS];
}

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
  // 빌트인은 목록에서 이미 빠져 있지만(overlayInstallState), 표시 정책이
  // 방어선이면 안 된다 — id 를 직접 실은 IPC 요청도 여기서 죽는다.
  if (isBuiltinRegistryItem(item.id)) {
    throw new Error(
      `설치 거부: "${item.id}" 는 앱 내장 항목 — 설치 대상이 아님`,
    );
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

/**
 * 인덱스 + 원장 → UI 항목(설치 상태 배지). 렌더마다 해시 재검사는 안 한다(§7 P3).
 *
 * ★빌트인은 여기서 목록에서 빠진다 — 앱이 이미 들고 있는 것에 설치 버튼이나
 * '자동 설치 불가' 배지가 붙으면, 사용자는 없는 문제를 찾게 된다.
 *
 * 단 **원장에 있으면 그대로 보여준다.** 빌트인으로 지정되기 전 버전에서 이미
 * 설치한 사용자가 있을 수 있고, 그 항목을 목록에서 지워 버리면 제거 버튼까지
 * 같이 사라져 사용자가 자기 홈에 남은 파일을 UI 로 되돌릴 방법이 없어진다.
 * "숨김"이 "잠금"이 되면 안 된다.
 */
export function overlayInstallState(
  index: RegistryIndex,
  ledger: RegistryLedger,
): RegistryStoreItem[] {
  const listed = index.items.filter(
    (item) => !isBuiltinRegistryItem(item.id) || !!ledger.items[item.id],
  );
  return listed.map((item) => {
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

// ── official 첫파티 기본설치 ───────────────────────────────────────
//
// 빈 에이전트 목록으로 시작하는 앱은 "무엇을 스폰하라는 건지"에 답하지 않는다.
// 그래서 우리가 만든 official 티어 에이전트는 첫 실행에 우리가 대신 깔아 준다.
//
// ★빌트인과 혼동 금지(위 BUILTIN_REGISTRY_ITEM_IDS 주석 참조). 여기 항목들은
// **설치형이다** — 스토어에 그대로 보이고, 원장에 기록되고, 사용자가 제거
// 버튼으로 지울 수 있다. 우리가 한 일은 첫 설치 버튼을 대신 눌러 준 것뿐이다.
//
// 강제가 아니라는 것의 실질적 의미는 "지운 것이 되살아나지 않는다" 이다. 그
// 보장을 마커 하나(ledger.defaultInstallAt)로 만든다 — 패스는 앱 수명에서 딱
// 한 번 완주하고, 그 뒤에는 레지스트리에 official 에이전트가 몇 개 추가되든
// 다시 돌지 않는다. 사용자가 스토어에서 직접 고르는 영역이 된다.

/** 기본설치 대상 판정 — 데이터 기반 규칙이다(하드코딩 id 목록이 아니다). */
export function isDefaultInstallCandidate(item: RegistryItem): boolean {
  return (
    item.tier === "official" &&
    item.type === "agent" &&
    item.status === "active" &&
    item.install?.kind === "files" &&
    !isBuiltinRegistryItem(item.id)
  );
}

export interface DefaultInstallResult {
  /** 마커가 이미 있어 아무것도 하지 않았다. */
  alreadyRan: boolean;
  installed: string[];
  /** 원장에 이미 있어 건너뛴 항목(사용자가 직접 깔았거나 이전 패스의 결과). */
  skipped: string[];
  failed: Array<{ id: string; error: string }>;
}

/**
 * 첫 실행 기본설치 패스. **호출자는 신선한 인덱스일 때만 부른다**(main.ts).
 *
 * stale·unavailable 인덱스에서 돌리면 안 되는 이유가 마커에 있다: 레지스트리에
 * 닿지도 못한 실행에서 패스를 "완주"로 찍으면, 그 사용자는 기본 에이전트를
 * 영원히 못 받는다. "물어보지도 못했다"와 "물어봤는데 일부 실패했다"는 다르게
 * 다뤄야 한다 — 전자는 다음 기동에 재시도, 후자는 마커를 찍고 끝낸다(부분
 * 실패로 무한 재시도하면 매 기동 네트워크를 두드리게 된다).
 */
export async function installDefaultRegistryItems(
  index: RegistryIndex,
  deps: InstallerDeps,
): Promise<DefaultInstallResult> {
  const result: DefaultInstallResult = {
    alreadyRan: false,
    installed: [],
    skipped: [],
    failed: [],
  };
  if (readLedger(deps.ledgerPath).defaultInstallAt) {
    result.alreadyRan = true;
    return result;
  }

  const candidates = index.items.filter(isDefaultInstallCandidate);
  // 후보가 0 이면 인덱스가 비었거나 우리가 모르는 상태다 — 마커를 찍지 않고
  // 다음 기동에 다시 본다(빈 인덱스로 "완주" 를 찍는 실수 방지).
  if (candidates.length === 0) return result;

  for (const item of candidates) {
    // 원장 재확인은 루프 안에서 한다 — 앞선 반복이 원장을 갱신했고, 사용자가
    // 이전에 직접 설치한 항목을 여기서 덮어(update 경로) 로컬 수정을 건드리는
    // 일이 없어야 한다.
    if (readLedger(deps.ledgerPath).items[item.id]) {
      result.skipped.push(item.id);
      continue;
    }
    try {
      await installRegistryItem(item, deps);
      result.installed.push(item.id);
    } catch (err) {
      // 한 항목의 실패가 나머지를 막지 않는다 — 기본설치는 편의 기능이지
      // 기동 조건이 아니다.
      result.failed.push({
        id: item.id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const ledger = readLedger(deps.ledgerPath);
  ledger.defaultInstallAt = new Date().toISOString();
  writeLedger(deps.ledgerPath, ledger);
  return result;
}
