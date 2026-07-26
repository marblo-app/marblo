/**
 * 스킬 레지스트리 — 벤더 네이티브 CLI 스킬의 발견·검증·지시문 조립.
 *
 * 배경 (INTELLIGENT-ROUTING-PLAN §D, 실측):
 *   - 스폰된 에이전트는 부모 env 를 통째 상속하므로 **CLI 네이티브 스킬은 이미
 *     전달된다**(중립 cwd 에서 스폰한 claude 가 사용자 스킬 88개를 전부 인식).
 *     따라서 새 전달경로를 만들 이유가 없다. 없는 것은 **지정과 검증**이다.
 *   - `dispatch_task` 엔 스킬 지정 파라미터가 없었다. "이 티켓엔 이 스킬을 써라"
 *     를 실을 자리가 없었고, 지시문에 이름만 적으면 오타(`/seo-geo-optimization`
 *     — 실제 설치명은 `seo-geo-full`)가 **조용히 무효**가 됐다.
 *   - `~/.codex/skills` 는 사용자 스킬 0개였다(`.system` 6개만). codex 에 스킬
 *     작업을 배정하면 역시 조용히 무효였다.
 *
 * 이 모듈은 그래서 "스킬이 실제로 설치돼 있는가" 를 **디스크에서** 답한다.
 * 카탈로그 하드코딩이 아니라 실측이므로, 사용자가 스킬을 지우면 즉시 반영된다.
 *
 * 보안 규율은 `run_skill`(tools.ts) 의 것을 그대로 계승한다:
 *   - 이름은 문법 화이트리스트(`SKILL_NAME_RE`) — 셸 메타문자·경로구분자·`..` 거부
 *   - 검증은 allowlist 방식(디스크에 있는 것만 통과), 거부는 명시적 에러
 *
 * ★배치 위치: `electron/mcp-server/` 인 이유는 모듈 경계다. mcp tsconfig 는
 * `rootDir: "."` 라서 `../` 를 import 할 수 없지만, electron tsconfig 는
 * `./mcp-server/*` 를 import 할 수 있다(agent-config → tool-surface 선례).
 * 즉 여기 두어야 MCP 프로세스와 Electron 메인 양쪽이 같은 판정기를 쓴다.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** 네이티브 스킬을 지원하는 CLI 벤더. */
export type SkillVendor = "claude" | "codex" | "grok";

export const SKILL_VENDORS: readonly SkillVendor[] = [
  "claude",
  "codex",
  "grok",
];

/** 스킬이 발견된 위치의 종류. */
export type SkillSource = "user" | "project" | "plugin" | "system";

export interface InstalledSkill {
  /** 호출명. 플러그인 스킬은 `plugin:skill` 형태. */
  name: string;
  vendor: SkillVendor;
  source: SkillSource;
  /** SKILL.md 의 절대경로. */
  path: string;
}

export interface SkillLookupOptions {
  /** 프로젝트 로컬 스킬(.claude/skills) 탐색 기준 디렉토리. */
  cwd?: string;
  /** env 주입(테스트용). 기본 process.env. */
  env?: NodeJS.ProcessEnv;
  /** HOME 주입(테스트용). 기본 os.homedir(). */
  homeDir?: string;
}

interface SkillRoot {
  dir: string;
  source: SkillSource;
  /** 플러그인 루트는 `plugin:skill` 로 이름을 접두한다. */
  namePrefix?: string;
}

const SKILL_MANIFEST = "SKILL.md";

/**
 * 허용 스킬명 문법. 소문자/숫자로 시작, `-` `_` `.` 허용, 선택적 `plugin:skill`.
 * 경로구분자(`/`)·공백·셸 메타문자·`..` 는 전부 여기서 걸린다.
 */
const SKILL_NAME_RE = /^[a-z0-9][a-z0-9._-]*(?::[a-z0-9][a-z0-9._-]*)?$/i;

const MAX_SKILL_NAME_LEN = 80;
/** 한 dispatch 가 지정할 수 있는 스킬 수 상한(프롬프트 폭주 방지). */
export const MAX_SKILLS_PER_DISPATCH = 8;

/** activity 로 남기는 스킬 사용 신호의 접두어(P4-2 · 중 신뢰도 신호). */
export const SKILL_ACTIVITY_MARKER = "[skill]";

// ── 캐시 ────────────────────────────────────────────────────────
// 디스크 스캔은 싸지만 한 dispatch 안에서 여러 번 불린다(검증 → 벤더 게이트 →
// 지시문 조립). 짧은 TTL 캐시로 같은 호출 안에서는 한 번만 읽는다. 사용자가
// 스킬을 설치/삭제하면 TTL 만료 후 곧바로 반영된다.

const CACHE_TTL_MS = 5_000;
const cache = new Map<string, { at: number; skills: InstalledSkill[] }>();

/** 테스트/설치 직후 강제 무효화. */
export function clearSkillRegistryCache(): void {
  cache.clear();
}

// ── 벤더 매핑 ───────────────────────────────────────────────────

/**
 * 스폰 모델 → 스킬 벤더. `gpt`/`codex` 는 같은 Codex CLI 다
 * (메모 `marblo_v3_fleet_codex_naming`).
 *
 * null = **네이티브 스킬 개념이 없는 벤더**(gemini/antigravity/local/custom).
 * 조용히 무효가 되지 않도록, 호출부는 null 을 "스킬 지정 불가" 로 다뤄야 한다.
 */
export function vendorForModel(
  model: string | null | undefined,
): SkillVendor | null {
  if (!model) return null;
  const m = model.trim().toLowerCase();
  if (m === "claude") return "claude";
  if (m === "gpt" || m === "codex") return "codex";
  if (m === "grok") return "grok";
  return null;
}

// ── 루트 탐색 ───────────────────────────────────────────────────

function claudeConfigDir(opts: SkillLookupOptions): string {
  const env = opts.env ?? process.env;
  const home = opts.homeDir ?? os.homedir();
  const configured = env.CLAUDE_CONFIG_DIR?.trim();
  return configured ? configured : path.join(home, ".claude");
}

function codexHomeDir(opts: SkillLookupOptions): string {
  const env = opts.env ?? process.env;
  const home = opts.homeDir ?? os.homedir();
  const configured = env.CODEX_HOME?.trim();
  return configured ? configured : path.join(home, ".codex");
}

function grokHomeDir(opts: SkillLookupOptions): string {
  const env = opts.env ?? process.env;
  const home = opts.homeDir ?? os.homedir();
  const configured = env.GROK_HOME?.trim();
  return configured ? configured : path.join(home, ".grok");
}

/**
 * 벤더별 스킬 루트. 사용자가 실제로 어디를 봐야 하는지 에러 메시지에 그대로
 * 싣기 때문에, 존재하지 않는 루트도 목록에는 남긴다(발견 단계에서만 걸러냄).
 */
export function skillRootsFor(
  vendor: SkillVendor,
  opts: SkillLookupOptions = {},
): SkillRoot[] {
  if (vendor === "claude") {
    const roots: SkillRoot[] = [
      { dir: path.join(claudeConfigDir(opts), "skills"), source: "user" },
    ];
    if (opts.cwd) {
      roots.push({
        dir: path.join(opts.cwd, ".claude", "skills"),
        source: "project",
      });
    }
    return roots;
  }
  if (vendor === "grok") {
    const roots: SkillRoot[] = [
      { dir: path.join(grokHomeDir(opts), "skills"), source: "user" },
    ];
    if (opts.cwd) {
      roots.push({
        dir: path.join(opts.cwd, ".grok", "skills"),
        source: "project",
      });
    }
    return roots;
  }
  // codex: 사용자 스킬 + 프리인스톨된 .system 스킬
  const codexSkills = path.join(codexHomeDir(opts), "skills");
  return [
    { dir: codexSkills, source: "user" },
    { dir: path.join(codexSkills, ".system"), source: "system" },
  ];
}

/** 표시용 루트 경로 목록(에러 메시지에 싣는다). */
export function skillRootPathsFor(
  vendor: SkillVendor,
  opts: SkillLookupOptions = {},
): string[] {
  const roots = skillRootsFor(vendor, opts).map((r) => r.dir);
  if (vendor === "claude") {
    roots.push(path.join(claudeConfigDir(opts), "plugins", "cache", "*"));
  }
  if (vendor === "grok") {
    roots.push(path.join(grokHomeDir(opts), "plugins", "cache", "*"));
  }
  return roots;
}

function readSkillDirs(root: SkillRoot, vendor: SkillVendor): InstalledSkill[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(root.dir, { withFileTypes: true });
  } catch {
    return []; // 없는 루트는 조용히 스킵 — 존재 자체가 선택적이다.
  }
  const found: InstalledSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    // `.system` 같은 dot 디렉토리는 그 자체가 스킬이 아니라 별도 루트다.
    if (entry.name.startsWith(".")) continue;
    const manifest = path.join(root.dir, entry.name, SKILL_MANIFEST);
    if (!fs.existsSync(manifest)) continue;
    found.push({
      name: root.namePrefix ? `${root.namePrefix}:${entry.name}` : entry.name,
      vendor,
      source: root.source,
      path: manifest,
    });
  }
  return found;
}

/**
 * Claude 플러그인 스킬 — `~/.claude/plugins/cache/<marketplace>/<plugin>/
 * <version>/skills/<name>/SKILL.md`. 호출명은 `<plugin>:<name>`
 * (예: `superpowers:brainstorming`). 같은 플러그인의 여러 버전이 캐시에 남아
 * 있을 수 있으므로 이름 기준으로 중복 제거한다.
 */
function readPluginSkills(
  cacheRoot: string,
  vendor: SkillVendor,
): InstalledSkill[] {
  const out: InstalledSkill[] = [];
  const listDirs = (dir: string): string[] => {
    try {
      return fs
        .readdirSync(dir, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);
    } catch {
      return [];
    }
  };
  for (const marketplace of listDirs(cacheRoot)) {
    const marketplaceDir = path.join(cacheRoot, marketplace);
    for (const plugin of listDirs(marketplaceDir)) {
      const pluginDir = path.join(marketplaceDir, plugin);
      for (const version of listDirs(pluginDir)) {
        out.push(
          ...readSkillDirs(
            {
              dir: path.join(pluginDir, version, "skills"),
              source: "plugin",
              namePrefix: plugin,
            },
            vendor,
          ),
        );
      }
    }
  }
  return out;
}

function readClaudePluginSkills(opts: SkillLookupOptions): InstalledSkill[] {
  return readPluginSkills(
    path.join(claudeConfigDir(opts), "plugins", "cache"),
    "claude",
  );
}

function readGrokPluginSkills(opts: SkillLookupOptions): InstalledSkill[] {
  return readPluginSkills(
    path.join(grokHomeDir(opts), "plugins", "cache"),
    "grok",
  );
}

/**
 * 벤더에 실제로 설치된 스킬 목록. 디스크 실측이며, 같은 이름이 여러 루트에
 * 있으면 먼저 발견된 것(user → project → plugin 순)을 남긴다.
 */
export function listInstalledSkills(
  vendor: SkillVendor,
  opts: SkillLookupOptions = {},
): InstalledSkill[] {
  const key = [
    vendor,
    opts.cwd ?? "",
    opts.homeDir ?? "",
    (opts.env ?? process.env).CLAUDE_CONFIG_DIR ?? "",
    (opts.env ?? process.env).CODEX_HOME ?? "",
  ].join("|");
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.skills;

  const collected: InstalledSkill[] = [];
  for (const root of skillRootsFor(vendor, opts)) {
    collected.push(...readSkillDirs(root, vendor));
  }
  if (vendor === "claude") {
    collected.push(...readClaudePluginSkills(opts));
  }
  if (vendor === "grok") {
    collected.push(...readGrokPluginSkills(opts));
  }

  const byName = new Map<string, InstalledSkill>();
  for (const skill of collected) {
    const lower = skill.name.toLowerCase();
    if (!byName.has(lower)) byName.set(lower, skill);
  }
  const skills = Array.from(byName.values()).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  cache.set(key, { at: Date.now(), skills });
  return skills;
}

// ── 이름 정규화·검증 ────────────────────────────────────────────

/**
 * 사용자가 쓸 법한 표기를 호출명으로 접는다:
 *   "/seo-geo-full" · "`seo-geo-full`" · "seo-geo-full/" · " seo-geo-full "
 * 전부 → "seo-geo-full".
 * 문법 위반은 여기서 고치지 않는다 — `isValidSkillName` 이 거부한다.
 */
export function normalizeSkillName(raw: string): string {
  return raw
    .trim()
    .replace(/^[`'"]+|[`'"]+$/g, "")
    .replace(/^\/+/, "")
    .replace(/\/+$/, "")
    .trim();
}

export function isValidSkillName(name: string): boolean {
  if (!name || name.length > MAX_SKILL_NAME_LEN) return false;
  return SKILL_NAME_RE.test(name);
}

/** 편집거리(Levenshtein) — 오타 제안용. 이름이 짧아 O(nm) 로 충분하다. */
function editDistance(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (m === 0) return n;
  if (n === 0) return m;
  let prev = new Array<number>(n + 1);
  let cur = new Array<number>(n + 1);
  for (let j = 0; j <= n; j++) prev[j] = j;
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a.charCodeAt(i - 1) === b.charCodeAt(j - 1) ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    const swap = prev;
    prev = cur;
    cur = swap;
  }
  return prev[n];
}

function sharedPrefixLen(a: string, b: string): number {
  const max = Math.min(a.length, b.length);
  let i = 0;
  while (i < max && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

/**
 * 오타 제안. `/seo-geo-optimization` → `seo-geo-full` 같은 케이스를 잡는 것이
 * 이 함수의 존재 이유이므로, 편집거리만 쓰지 않고 **공통 접두어**와
 * **토큰 겹침** 을 함께 본다(그 둘의 편집거리는 11 로 멀다).
 */
export function suggestSkillNames(
  wanted: string,
  installed: string[],
  limit = 3,
): string[] {
  const w = wanted.toLowerCase();
  const wTokens = new Set(w.split(/[-_.:]+/).filter(Boolean));
  const scored: Array<{ name: string; score: number }> = [];
  for (const name of installed) {
    const n = name.toLowerCase();
    const prefix = sharedPrefixLen(w, n);
    const tokens = n.split(/[-_.:]+/).filter(Boolean);
    const overlap = tokens.filter((t) => wTokens.has(t)).length;
    const dist = editDistance(w, n);
    const near = dist <= Math.max(2, Math.floor(w.length * 0.34));
    if (prefix < 4 && overlap === 0 && !near) continue;
    // 접두어가 길수록, 토큰이 많이 겹칠수록, 편집거리가 짧을수록 높은 점수.
    scored.push({ name, score: prefix * 2 + overlap * 3 - dist * 0.2 });
  }
  scored.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return scored.slice(0, limit).map((s) => s.name);
}

export interface MissingSkill {
  name: string;
  suggestions: string[];
}

export interface SkillValidation {
  vendor: SkillVendor;
  ok: boolean;
  /** 설치가 확인된 스킬. */
  resolved: InstalledSkill[];
  /** 설치되지 않은 스킬 + 오타 제안. */
  missing: MissingSkill[];
  /** 그 벤더에 설치된 전체 스킬 수(0 이면 "설치 자체가 안 됨" 신호). */
  installedCount: number;
}

/** 이름 목록을 한 벤더에 대해 검증한다. 문법 위반은 호출부가 먼저 거른다. */
export function validateSkillsFor(
  vendor: SkillVendor,
  names: string[],
  opts: SkillLookupOptions = {},
): SkillValidation {
  const installed = listInstalledSkills(vendor, opts);
  const byLower = new Map(installed.map((s) => [s.name.toLowerCase(), s]));
  const allNames = installed.map((s) => s.name);
  const resolved: InstalledSkill[] = [];
  const missing: MissingSkill[] = [];
  for (const name of names) {
    const hit = byLower.get(name.toLowerCase());
    if (hit) resolved.push(hit);
    else missing.push({ name, suggestions: suggestSkillNames(name, allNames) });
  }
  return {
    vendor,
    ok: missing.length === 0,
    resolved,
    missing,
    installedCount: installed.length,
  };
}

// ── 라우팅 게이트 ───────────────────────────────────────────────

export interface SkillRoutingInput {
  /** 원문 스킬명(정규화 전). */
  skills: string[];
  /** 명시 모델 힌트(normalizeModel 이후 값). 없으면 스코어링에 맡긴다. */
  explicitModel?: string | null;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  homeDir?: string;
}

export type SkillRouting =
  | {
      ok: true;
      /** 정규화된 스킬명. */
      skills: string[];
      /** 지정 스킬이 전부 설치된 벤더 — 라우팅은 여기로만 간다. */
      allowedVendors: SkillVendor[];
      /** 로그/telemetry 용 한 줄 요약. */
      note: string;
    }
  | { ok: false; error: string };

const INSTALL_HINT =
  "설치: `bash scripts/install-agent-skills.sh --vendor <claude|codex>` " +
  "(런북: v3/docs/SKILL-DELIVERY-RUNBOOK.md)";

function formatMissing(v: SkillValidation): string {
  return v.missing
    .map((m) => {
      const hint = m.suggestions.length
        ? ` — 혹시 이것? ${m.suggestions.join(", ")}`
        : "";
      return `'${m.name}'${hint}`;
    })
    .join("; ");
}

/**
 * dispatch 의 스킬 게이트.
 *
 * ★조용한 무효 금지가 이 함수의 전부다. 지정한 스킬이 대상 벤더에 없으면
 * 스폰하지 않고 **즉시 실패**하며, 오타 후보와 설치 런북을 함께 돌려준다.
 *
 * - 명시 모델이 있으면 그 벤더 하나만 본다(사용자가 고른 벤더를 말없이 바꾸지
 *   않는다 — 재배정 가드 정책과 동일한 원칙).
 * - 명시 모델이 없으면 스킬이 전부 설치된 벤더만 라우팅 후보로 남긴다. 모든
 *   벤더가 실패하면 벤더별 사유를 전부 담아 실패한다.
 */
export function resolveSkillRouting(input: SkillRoutingInput): SkillRouting {
  const normalized: string[] = [];
  for (const raw of input.skills) {
    const name = normalizeSkillName(raw);
    if (!name) continue;
    if (!isValidSkillName(name)) {
      return {
        ok: false,
        error:
          `Dispatch aborted (skills): 스킬명 '${raw}' 이 허용 문법이 아니다. ` +
          "소문자/숫자로 시작하는 [a-z0-9._-] 이름 또는 'plugin:skill' 형태만 " +
          "허용된다(경로·셸 메타문자 금지).",
      };
    }
    if (!normalized.some((n) => n.toLowerCase() === name.toLowerCase())) {
      normalized.push(name);
    }
  }
  if (normalized.length === 0) {
    return {
      ok: true,
      skills: [],
      allowedVendors: [...SKILL_VENDORS],
      note: "",
    };
  }
  if (normalized.length > MAX_SKILLS_PER_DISPATCH) {
    return {
      ok: false,
      error:
        `Dispatch aborted (skills): 한 번에 지정할 수 있는 스킬은 ` +
        `${MAX_SKILLS_PER_DISPATCH}개까지다(요청 ${normalized.length}개).`,
    };
  }

  const opts: SkillLookupOptions = {
    cwd: input.cwd,
    env: input.env,
    homeDir: input.homeDir,
  };

  if (input.explicitModel) {
    const vendor = vendorForModel(input.explicitModel);
    if (!vendor) {
      return {
        ok: false,
        error:
          `Dispatch aborted (skills): 모델 '${input.explicitModel}' 은 네이티브 ` +
          `CLI 스킬을 지원하지 않는다(지원: claude, codex). 지정 스킬 ` +
          `[${normalized.join(", ")}] 이 조용히 무시되지 않도록 차단했다. ` +
          "스킬 없이 보내거나 claude/codex 로 지정하라.",
      };
    }
    const v = validateSkillsFor(vendor, normalized, opts);
    if (!v.ok) {
      return {
        ok: false,
        error:
          `Dispatch aborted (skills): ${vendor} 에 설치되지 않은 스킬 — ` +
          `${formatMissing(v)}. (${vendor} 설치 스킬 ${v.installedCount}개, ` +
          `탐색 경로: ${skillRootPathsFor(vendor, opts).join(
            ", ",
          )}) ${INSTALL_HINT}`,
      };
    }
    return {
      ok: true,
      skills: normalized,
      allowedVendors: [vendor],
      note: `skills=[${normalized.join(",")}] vendor=${vendor}(explicit)`,
    };
  }

  const allowed: SkillVendor[] = [];
  const reasons: string[] = [];
  for (const vendor of SKILL_VENDORS) {
    const v = validateSkillsFor(vendor, normalized, opts);
    if (v.ok) allowed.push(vendor);
    else
      reasons.push(
        `${vendor}: ${formatMissing(v)} (설치 ${v.installedCount}개)`,
      );
  }
  if (allowed.length === 0) {
    return {
      ok: false,
      error:
        `Dispatch aborted (skills): 지정 스킬 [${normalized.join(", ")}] 이 ` +
        `어떤 벤더에도 설치돼 있지 않다 — ${reasons.join(
          " | ",
        )}. ${INSTALL_HINT}`,
    };
  }
  return {
    ok: true,
    skills: normalized,
    allowedVendors: allowed,
    note:
      `skills=[${normalized.join(",")}] vendors=[${allowed.join(",")}]` +
      (reasons.length ? ` blocked(${reasons.join(" | ")})` : ""),
  };
}

// ── 지시문 조립 ─────────────────────────────────────────────────

/**
 * 스폰/재사용 지시문 맨 앞에 붙는 스킬 지시 블록.
 *
 * 전달 자체는 env 상속으로 이미 되므로, 이 블록이 하는 일은 두 가지다:
 *   1) **지정** — 어떤 스킬을 쓸지 이름으로 못박는다(설치 검증을 통과한 이름만
 *      들어오므로 오타가 여기까지 오지 않는다).
 *   2) **관측** — 호출 직후 `add_activity("[skill] <name> invoked")` 를 규약으로
 *      요구한다. 자기보고라 위조 가능하지만(그래서 신뢰도 '중'), 지금은
 *      "썼는지 아예 알 수 없음" 이 문제였으므로 신호가 0 → 1 이 된다.
 *      쓰지 않기로 판단한 경우도 `skipped — 이유` 로 남기게 해서 침묵과
 *      명시적 불사용을 구분한다.
 */
export function buildSkillDirective(
  skills: string[],
  opts: { vendor?: SkillVendor | null; taskId?: string } = {},
): string {
  if (skills.length === 0) return "";
  const invoke =
    opts.vendor === "codex"
      ? "`$<이름>` 또는 스킬 이름을 명시해 호출"
      : "Skill 도구 또는 `/<이름>`";
  const activity = opts.taskId
    ? `add_activity(task_id="${opts.taskId}", message="${SKILL_ACTIVITY_MARKER} <이름> invoked")`
    : `add_activity(task_id=..., message="${SKILL_ACTIVITY_MARKER} <이름> invoked")`;
  return [
    "[지정 스킬 — 이 작업은 아래 스킬로 수행한다]",
    ...skills.map((s) => `- ${s}`),
    `- 호출법: ${invoke}. 설치 여부는 dispatch 시점에 이미 검증됐다(오타 아님).`,
    `- ★각 스킬을 실제로 호출한 직후 ${activity} 로 1줄 기록한다 — 이게 "스킬을 정말 썼는가" 의 유일한 관측 신호다.`,
    `- 상황상 쓰지 않기로 판단하면 임의로 침묵하지 말고 "${SKILL_ACTIVITY_MARKER} <이름> skipped — 이유" 로 남긴다.`,
    "",
  ].join("\n");
}

/** 지시문 + 스킬 블록. 스킬이 없으면 원문 그대로(무회귀). */
export function withSkillDirective(
  instruction: string,
  skills: string[],
  opts: { vendor?: SkillVendor | null; taskId?: string } = {},
): string {
  const directive = buildSkillDirective(skills, opts);
  return directive ? `${directive}\n${instruction}` : instruction;
}

export interface SkillUsageMarker {
  name: string;
  status: "invoked" | "skipped";
  detail?: string;
}

/**
 * activity 스트림에서 스킬 사용 신호를 뽑는다(P4-2 집계용).
 * `[skill] seo-geo-full invoked` / `[skill] seo-geo-full skipped — 이유`.
 */
export function parseSkillUsageMarkers(message: string): SkillUsageMarker[] {
  const out: SkillUsageMarker[] = [];
  const re = /\[skill\]\s+([A-Za-z0-9._:-]+)\s+(invoked|skipped)([^\n]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(message)) !== null) {
    const detail = m[3].replace(/^[\s—:-]+/, "").trim();
    out.push({
      name: m[1],
      status: m[2].toLowerCase() === "invoked" ? "invoked" : "skipped",
      ...(detail ? { detail } : {}),
    });
  }
  return out;
}
