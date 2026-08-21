/**
 * Codex 모델 메타데이터 카탈로그 — env-swap 벤더(gpt 하네스) 전용.
 *
 * ── 무엇이 문제였나 (2026-08-20 실측) ───────────────────────────────────
 * codex-cli 0.148.0 은 모델 **slug** 로 내장 카탈로그를 조회해 `ModelInfo` 를
 * 얻는다. 우리 env-swap 벤더 id(`solar-pro4`, `deepseek-v4-*`)는 그 카탈로그에
 * 없으므로 codex 는 폴백 메타데이터를 쓰고 경고를 낸다:
 *
 *   Model metadata for `solar-pro4` not found. Defaulting to fallback metadata;
 *   this can degrade performance and cause issues.
 *
 * 이건 성능 경고가 아니라 **도구 등록을 바꾸는** 경고다. 폴백 `ModelInfo` 는
 * `apply_patch_tool_type` 이 비어 있어 codex 가 `apply_patch` 를 등록하지 않는데,
 * 같은 폴백이 고르는 시스템 프롬프트는 여전히 "Use the `apply_patch` tool to edit
 * files" 를 (알려진 모델보다도 더 많이) 안내한다. 그래서 모델이 부르면 라우터가
 * 거절한다:
 *
 *   ERROR codex_core::tools::router: unsupported call: apply_patch
 *
 * A/B 실측(로컬 mock Responses upstream 으로 요청 바디 전량 캡처):
 *   solar-pro4 / deepseek-v4-flash / deepseek-v4-pro → tools 에 apply_patch 없음,
 *     `unsupported call: apply_patch`, 파일 미변경.
 *   gpt-5.5 / gpt-5.4                                → apply_patch 등록(type=custom),
 *     거절 0건.
 * 코딩 에이전트가 **파일을 못 고치는** 실질 블로커이고, 벤치의 gpt/벤더 비대칭의
 * 원인이기도 하다.
 *
 * ── 왜 이 방법인가 ──────────────────────────────────────────────────────
 * codex 0.148.0 의 `ConfigToml`(97 필드)에는 구버전의 `include_apply_patch_tool`
 * 이 **없고**, `codex features list` 의 `apply_patch_freeform` 은 stage=removed 라
 * 켤 수 없다. "폴백에서도 apply_patch 를 등록하라"는 설정 경로가 존재하지 않는다.
 * 남은 공식 경로가 최상위 키 `model_catalog_json` — 벤더 모델의 `ModelInfo` 를
 * 우리가 선언해 폴백 자체를 타지 않게 만든다.
 *
 * ── 왜 "레퍼런스 모델 복제" 인가 ────────────────────────────────────────
 * codex 는 카탈로그 항목에 `base_instructions` 또는
 * `model_messages.instructions_template` 중 하나를 **요구**한다(없으면 카탈로그
 * 파싱이 실패하고 codex 가 EXIT=1 로 즉사한다). 그 템플릿은 ~20KB 짜리 codex 의
 * 시스템 프롬프트 본문이다. 그걸 우리 레포에 복사해 넣으면 codex 를 올릴 때마다
 * 프롬프트가 조용히 낡는다. 그래서 **설치된 codex 자신이 들고 있는** ModelInfo 를
 * 읽어 레퍼런스로 쓰고, 그 위에 벤더 사실(slug/컨텍스트/effort/능력 플래그)만
 * 덮어쓴다. 프롬프트는 항상 설치된 codex 와 동기다.
 *
 * ── 반드시 지킬 세 가지 (전부 실측으로 확인) ────────────────────────────
 * 1. **대체이지 머지가 아니다.** `model_catalog_json` 을 주면 내장 카탈로그는
 *    통째로 무시된다(solar 한 줄짜리 카탈로그로 gpt-5.5 를 돌리면 gpt-5.5 가
 *    unknown 이 된다). 그래서 이 키는 **벤더 오버라이드 에이전트에만** 방출한다.
 *    openai gpt 에이전트의 config 에는 이 키가 아예 들어가지 않는다 → 무회귀.
 * 2. `apply_patch_tool_type` 은 `"freeform"` 만 유효하다. `"function"` 을 주면
 *    카탈로그 파싱이 실패해 codex 가 EXIT=1 로 즉사한다.
 * 3. `model_catalog_json` 은 **최상위 키**다. `[model_providers.*]` 테이블보다
 *    뒤에 쓰면 그 테이블의 하위 키로 흡수돼 설정 로드가 깨진다.
 */
import fs from "fs";
import os from "os";
import path from "path";
import { contextRecordFor } from "./model-context-reference";
import { getModel, type EffortLevel } from "./model-registry";

/** codex `ModelInfo` — 우리가 통째로 다루는 불투명 레코드. */
export type CodexModelInfo = Record<string, unknown>;

export interface CodexModelCatalog {
  models: CodexModelInfo[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** codex TUI 가 effort 칸에 붙이는 설명과 같은 결의 짧은 문구. */
const EFFORT_DESCRIPTION: Readonly<Record<EffortLevel, string>> = {
  low: "Fast responses with lighter reasoning",
  medium: "Balances speed and reasoning depth for everyday tasks",
  high: "Greater reasoning depth for complex problems",
  xhigh: "Extra high reasoning depth for complex problems",
  max: "Maximum reasoning depth for the hardest problems",
  ultra: "Maximum reasoning with automatic task delegation",
};

/** 사람이 읽는 이름. slug 를 잃지 않도록 벤더 표기를 그대로 쓴다. */
const DISPLAY_NAME: Readonly<Record<string, string>> = {
  "solar-pro4": "Upstage Solar Pro 4",
  "deepseek-v4-flash": "DeepSeek V4 Flash",
  "deepseek-v4-pro": "DeepSeek V4 Pro",
};

// ── codex 자신의 ModelInfo 읽기 ───────────────────────────────────────────

/** codex 바이너리에 박혀 있는 기본 카탈로그의 시작 표식. */
const EMBEDDED_CATALOG_MARKER = '{\n  "models": [\n';
/** 카탈로그 JSON 이 들어가는 최대 크기(현재 ~190KB). 넉넉히 잡는다. */
const EMBEDDED_CATALOG_WINDOW = 4 * 1024 * 1024;

/** PATH 에서 codex 실행 파일을 찾는다. 없으면 빈 문자열. */
function findCodexBinary(): string {
  const dirs = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, "codex");
    try {
      if (fs.statSync(candidate).isFile()) return candidate;
    } catch {
      /* 다음 후보 */
    }
  }
  return "";
}

/**
 * 문자열 리터럴을 존중하며 `{`…`}` 를 짝맞춰 JSON 오브젝트 끝을 찾는다.
 * (바이너리에서 잘라내는 것이므로 JSON.parse 에 통째로 넘길 수 없다.)
 */
function sliceBalancedJsonObject(region: Buffer): string | null {
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < region.length; i++) {
    const c = region[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (inString) {
      if (c === 0x5c) escaped = true;
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) {
      inString = true;
      continue;
    }
    if (c === 0x7b) depth++;
    else if (c === 0x7d) {
      depth--;
      if (depth === 0) return region.subarray(0, i + 1).toString("utf-8");
    }
  }
  return null;
}

/**
 * codex 바이너리에 임베드된 기본 모델 카탈로그를 꺼낸다.
 * 214MB 를 스캔하지만 실측 ~70ms 라 스폰 경로에서 감당된다.
 */
export function readEmbeddedCodexCatalog(binaryPath: string): CodexModelInfo[] {
  let fd: number | null = null;
  try {
    fd = fs.openSync(binaryPath, "r");
    const size = fs.fstatSync(fd).size;
    const marker = Buffer.from(EMBEDDED_CATALOG_MARKER, "utf-8");
    const chunkSize = 8 * 1024 * 1024;
    const chunk = Buffer.alloc(chunkSize);
    let carry = Buffer.alloc(0);
    let offset = -1;
    let pos = 0;
    while (pos < size && offset < 0) {
      const read = fs.readSync(
        fd,
        chunk,
        0,
        Math.min(chunkSize, size - pos),
        pos,
      );
      if (read <= 0) break;
      const hay = Buffer.concat([carry, chunk.subarray(0, read)]);
      const at = hay.indexOf(marker);
      if (at >= 0) offset = pos - carry.length + at;
      carry = hay.subarray(Math.max(0, hay.length - marker.length + 1));
      pos += read;
    }
    if (offset < 0) return [];

    const region = Buffer.alloc(
      Math.min(EMBEDDED_CATALOG_WINDOW, size - offset),
    );
    fs.readSync(fd, region, 0, region.length, offset);
    const json = sliceBalancedJsonObject(region);
    if (!json) return [];
    const parsed: unknown = JSON.parse(json);
    if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];
    return parsed.models.filter(isRecord);
  } catch {
    return [];
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

/** codex 가 원격 /models 응답을 캐시해 둔 파일(있으면 가장 최신 사실이다). */
function readModelsCache(codexHome: string): CodexModelInfo[] {
  try {
    const raw = fs.readFileSync(
      path.join(codexHome, "models_cache.json"),
      "utf-8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || !Array.isArray(parsed.models)) return [];
    return parsed.models.filter(isRecord);
  } catch {
    return [];
  }
}

/**
 * 설치된 codex 가 아는 `ModelInfo` 목록.
 * 1) 사용자 `~/.codex/models_cache.json`(원격 카탈로그 캐시)
 * 2) codex 바이너리 임베드 카탈로그
 * 둘 다 codex 자신이 만든 사실이다 — 우리가 지어내지 않는다.
 */
export function loadCodexModelInfos(options?: {
  codexHome?: string;
  binaryPath?: string;
}): CodexModelInfo[] {
  const home = options?.codexHome ?? path.join(os.homedir(), ".codex");
  const cached = readModelsCache(home);
  if (cached.length > 0) return cached;
  const binary = options?.binaryPath ?? findCodexBinary();
  if (!binary) return [];
  return readEmbeddedCodexCatalog(binary);
}

function instructionsTemplate(info: CodexModelInfo): string {
  if (typeof info.base_instructions === "string" && info.base_instructions) {
    return info.base_instructions;
  }
  const messages = info.model_messages;
  if (isRecord(messages) && typeof messages.instructions_template === "string") {
    return messages.instructions_template;
  }
  return "";
}

/**
 * 벤더 모델이 복제할 레퍼런스 ModelInfo 를 고른다.
 *
 * 조건은 이름이 아니라 **성질**로 건다 — codex 가 모델 라인업을 갈아도 따라간다.
 *  · apply_patch 를 freeform 으로 쓰는 모델일 것 (그게 이 티켓의 목적이다)
 *  · `tool_mode === "code_mode_only"` 가 아닐 것 — 그런 모델은 tools 배열을 아예
 *    안 싣는다(실측: gpt-5.6-terra 의 tools=[]). 벤더는 code-mode 호스트를 못 쓴다.
 *  · shell 이 `shell_command` 일 것
 *  · 프롬프트 템플릿을 들고 있을 것(카탈로그 필수 조건)
 * 동률이면 `priority` 오름차순 → slug 사전순으로 **결정적**으로 고른다.
 */
export function pickCodexReferenceModelInfo(
  models: CodexModelInfo[],
): CodexModelInfo | null {
  const candidates = models.filter(
    (m) =>
      m.apply_patch_tool_type === "freeform" &&
      m.tool_mode !== "code_mode_only" &&
      m.shell_type === "shell_command" &&
      typeof m.slug === "string" &&
      instructionsTemplate(m).length > 0,
  );
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => {
    const pa = typeof a.priority === "number" ? a.priority : Number.MAX_SAFE_INTEGER;
    const pb = typeof b.priority === "number" ? b.priority : Number.MAX_SAFE_INTEGER;
    if (pa !== pb) return pa - pb;
    return String(a.slug).localeCompare(String(b.slug));
  });
  return candidates[0] ?? null;
}

// ── 벤더 카탈로그 조립 ────────────────────────────────────────────────────

/**
 * 핀된 모델의 codex 카탈로그를 만든다. codex 가 이미 아는 모델(openai gpt)이나
 * gpt 하네스가 아닌 모델이면 null — 그 경우 `model_catalog_json` 을 **쓰면 안
 * 된다**(내장 카탈로그를 통째로 덮어써 회귀를 만든다).
 *
 * 레퍼런스를 못 찾아도 null 을 준다. 그 경우 호출자는 카탈로그 없이 스폰하고
 * (= 이 PR 이전과 동일한 동작) 사유를 **크게 로그로 남긴다**. 설정 조립 실패로
 * 에이전트를 아예 못 띄우는 것보다 낫다 — 다만 조용히 넘기지는 않는다.
 */
export function buildCodexModelCatalog(
  pinnedModelId?: string,
  options?: { models?: CodexModelInfo[]; codexHome?: string; binaryPath?: string },
): CodexModelCatalog | null {
  if (!pinnedModelId) return null;
  const entry = getModel(pinnedModelId);
  if (!entry || entry.harness !== "gpt") return null;
  // openai 는 codex 내장 카탈로그가 이미 아는 벤더다 — 건드리지 않는다.
  if (entry.provider !== "upstage" && entry.provider !== "deepseek") return null;

  const models = options?.models ?? loadCodexModelInfos(options);
  const reference = pickCodexReferenceModelInfo(models);
  if (!reference) return null;

  const efforts: EffortLevel[] =
    entry.efforts.length > 0 ? [...entry.efforts] : ["medium"];
  const context = contextRecordFor(entry.id);

  const info: CodexModelInfo = {
    // codex 가 요구하는 나머지 필드(특히 ~20KB 프롬프트 템플릿)는 레퍼런스에서
    // 그대로 물려받는다. codex 를 올리면 이 값들도 같이 최신이 된다.
    ...reference,

    slug: entry.id,
    display_name: DISPLAY_NAME[entry.id] ?? entry.id,
    // ★이 한 줄이 apply_patch 등록 여부를 가른다.
    apply_patch_tool_type: "freeform",
    visibility: "list",
    supported_in_api: true,
    priority: 1,
    tool_mode: null,

    // effort 축은 레지스트리가 벤더 문서로 확정한 값만 연다.
    supported_reasoning_levels: efforts.map((effort) => ({
      effort,
      description: EFFORT_DESCRIPTION[effort],
    })),
    default_reasoning_level: entry.defaultEffort ?? efforts[0]!,

    // 벤더의 OpenAI 호환 API 에는 `text.verbosity` 가 없다. true 로 두면 codex 가
    // 요청 바디에 `text` 객체를 얹는다(실측: gpt-5.5 요청엔 있고 폴백 solar 요청엔
    // 없다). 네이티브 Responses 로 붙는 DeepSeek 에서 그대로 400 을 부를 수 있다.
    support_verbosity: false,

    // hosted web_search 는 ChatGPT 백엔드 도구다. API 키로 붙는 커스텀 provider
    // 에선 닿지 않고, Upstage 는 chat 브리지가 hosted 도구를 어차피 버린다.
    // 광고해봐야 apply_patch 와 똑같은 "unsupported call" 을 한 종류 더 만든다.
    // ★끄는 방법은 `null` 이 아니라 **키 삭제**다 — 이 필드의 디시리얼라이저는
    //   "string or map" 만 받고 null 을 거부해 카탈로그 파싱이 통째로 실패한다
    //   (실측: codex EXIT=1). 삭제는 아래에서 한다.
    supports_search_tool: false,

    // 우리 배선에서 두 벤더 모두 텍스트만 주고받는다.
    input_modalities: ["text"],
    supports_image_detail_original: false,

    // 벤더는 reasoning summary 를 내지 않는다.
    supports_reasoning_summaries: false,
    default_reasoning_summary: "none",

    // ChatGPT 백엔드 전용 축들 — 커스텀 provider 에선 의미가 없다.
    prefer_websockets: false,
    use_responses_lite: false,
    multi_agent_version: null,
    auto_review_model_override: null,
  };

  // 레퍼런스가 물려준 hosted web_search 설정을 걷어낸다(위 주석 참조).
  delete info.web_search_tool_type;

  // 컨텍스트 창은 추측하지 않는다 — 우리 레퍼런스에 출처가 있는 모델만 적는다.
  // 없으면 레퍼런스 값을 그대로 둔다.
  if (context && typeof context.tokens === "number") {
    info.context_window = context.tokens;
    info.max_context_window = context.tokens;
    info.auto_compact_token_limit = null;
  }

  return { models: [info] };
}

/** 디스크에 쓸 JSON 문자열. */
export function renderCodexModelCatalogJson(
  catalog: CodexModelCatalog,
): string {
  return JSON.stringify(catalog, null, 2) + "\n";
}
