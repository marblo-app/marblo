/**
 * 사용자가 말한 모델을 실제 CLI 인자로 바꾸는 층 — `model@effort` 파서 + 핀 해석.
 *
 * ── 왜 필요한가 ─────────────────────────────────────────────────────────
 * 모델 축이 두 개인데 코드에는 하나뿐이었다. `dispatch_task(model=…)` 도, 오케
 * 모델 셀렉터도 `normalizeModel()`(dispatch-scoring)만 거쳤고 그 함수는 **프로바이더**
 * (claude / gpt / antigravity)까지만 접는다. 그래서
 *
 *     dispatch_task(model: "fable")   →  normalizeModel("fable") = undefined
 *
 * 이 되어 "fable 로 띄워라"는 지시가 조용히 사라지고 태그 스코어링으로 폴백했다.
 * 'opus5'·'sonnet'·'gpt-5.6-terra' 도 전부 같은 운명이었다. 이 파일이 그 둘째 축
 * ―**어느 프로바이더의 어느 모델을 어느 effort 로**― 을 담당한다.
 *
 * ── 규율 ────────────────────────────────────────────────────────────────
 * 1. **모델 목록을 여기서 만들지 않는다.** 아는 모델은 전부 `model-registry.ts`
 *    에서 파생된다. 이 파일에 모델 id 리터럴은 하나도 없다(폴백 상수조차
 *    `agent-config` 의 기존 정책값을 재사용한다). 새 모델은 레지스트리에 행 하나면
 *    여기·셀렉터·dispatch 에 동시에 나타난다.
 * 2. **프로바이더 판정은 `normalizeModel()` 단일 표를 계속 쓴다.** 여기서 두 번째
 *    프로바이더 alias 표를 만들면 "codex==gpt" 같은 규칙이 두 곳으로 갈라진다.
 * 3. **모르는 입력을 삼키지 않는다.** 해석 실패는 `undefined` 로 돌려 호출자가
 *    기존 경로(태그 스코어링 / 기본 모델)로 가게 한다 — 임의의 모델로 추측 스폰
 *    하지 않는다.
 * 4. **지정 모델이 spawn 을 깨뜨리지 않는다.** CLI 버전이 그 모델을 검증한 범위
 *    밖이면 `resolveClaudeModelPinned` 의 기존 폴백(opus)으로 떨어지고 구조화
 *    로그를 남긴다. "최상위를 못 쓰는 것"은 허용, "spawn 이 깨지는 것"은 불허
 *    (agent-config §8.3 의 기존 계약).
 */
import {
  resolveClaudeModelPinned,
  type TopModelFallback,
} from "./agent-config";
import {
  getModel,
  modelsByProvider,
  MODEL_REGISTRY,
  type EffortLevel,
  type ModelRegistryEntry,
} from "./model-registry";
import { normalizeModel, type ModelType } from "./dispatch-scoring";

/** 파싱된 모델 지정 — "무엇을 원했는가"(정책 적용 전). */
export interface ModelSpec {
  /** 프로바이더 축. 구체 모델을 골랐으면 그 모델의 provider 에서 파생된다. */
  provider: ModelType;
  /** 레지스트리의 구체 모델 id. 프로바이더만 말했으면(예: "codex") undefined. */
  modelId?: string;
  /** 지정 effort. 이 모델이 지원하는 값일 때만 채워진다. */
  effort?: EffortLevel;
  /** 지정했지만 이 모델엔 적용 불가라 버린 effort(진단용). */
  droppedEffort?: string;
  /** 정규화 전 원문(로그·텔레메트리용). */
  raw: string;
}

/** 정책(버전가드·폴백)까지 적용된 최종 스폰 핀. */
export interface ResolvedModelPin {
  provider: ModelType;
  /** claude CLI 의 `--model` 값. claude 를 구체 지정했을 때만. */
  claudeModel?: string;
  /** codex CLI 의 `-c model=…` 값. gpt 를 구체 지정했을 때만. */
  codexModel?: string;
  /** codex CLI 의 `-c model_reasoning_effort=…` 값. */
  codexEffort?: EffortLevel;
  /** 버전가드에 걸려 폴백했으면 그 상세(구조화 로그는 agent-config 이 이미 남김). */
  fallback?: TopModelFallback;
  /** 텔레메트리·로그용 `model@effort` 표기(effort 없으면 모델 id 만). P2-3. */
  label: string;
  /** 파싱 결과 원본. */
  spec: ModelSpec;
}

// ─────────────────────────────────────────────────────────────────────────
// 느슨한 표기 → 레지스트리 항목
//
// 사람이 쓰는 표기는 하이픈·점·공백·대소문자가 제각각이다("opus 4.8", "opus4.8",
// "claude-opus-4-8"). 전부 영숫자만 남긴 키로 접어서 한 인덱스에 넣는다.
// ─────────────────────────────────────────────────────────────────────────

function looseKey(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * 한 레지스트리 항목이 응답할 느슨한 키들.
 *
 *   claude-opus-4-8            → claudeopus48, opus48
 *   claude-haiku-4-5-20251001  → claudehaiku4520251001, haiku4520251001, haiku45
 *   gpt-5.6-terra              → gpt56terra, 56terra
 *   (+ 레지스트리에 등록된 alias: opus, sonnet, fable, haiku)
 *
 * 프로바이더 프리픽스와 날짜 접미를 떼는 이유는 사람이 그것들을 잘 안 쓰기
 * 때문이다("opus5" 라고 하지 "claude-opus-5-20260101" 이라고 하지 않는다).
 */
function looseKeysFor(entry: ModelRegistryEntry): string[] {
  const keys = new Set<string>();
  const add = (s: string): void => {
    const k = looseKey(s);
    if (k) keys.add(k);
  };
  add(entry.id);
  for (const alias of entry.aliases) add(alias);
  const prefix = `${entry.provider}-`;
  const bare = entry.id.startsWith(prefix)
    ? entry.id.slice(prefix.length)
    : entry.id;
  add(bare);
  // 날짜 접미(-20251001) 제거형.
  add(bare.replace(/-\d{8}$/, ""));
  return [...keys];
}

/** 느슨한 키 → 항목. 충돌 시 먼저 등록된 쪽이 이긴다(테스트가 충돌 0 을 강제). */
const LOOSE_INDEX = new Map<string, ModelRegistryEntry>();
for (const entry of MODEL_REGISTRY) {
  for (const key of looseKeysFor(entry)) {
    if (!LOOSE_INDEX.has(key)) LOOSE_INDEX.set(key, entry);
  }
}

/** 진단·테스트용: 느슨한 인덱스가 충돌 없이 만들어지는지 확인한다. */
export function looseIndexCollisions(): string[] {
  const seen = new Map<string, string>();
  const collisions: string[] = [];
  for (const entry of MODEL_REGISTRY) {
    for (const key of looseKeysFor(entry)) {
      const prev = seen.get(key);
      if (prev && prev !== entry.id)
        collisions.push(`${key}: ${prev} vs ${entry.id}`);
      else seen.set(key, entry.id);
    }
  }
  return collisions;
}

/**
 * 느슨한 표기로 레지스트리 항목을 찾는다. 정확한 id/alias 는 레지스트리의
 * `getModel` 이 먼저 처리하고, 그 다음에만 느슨한 인덱스를 본다.
 */
export function findModelLoose(input: string): ModelRegistryEntry | undefined {
  const trimmed = input.trim();
  if (!trimmed) return undefined;
  return getModel(trimmed) ?? LOOSE_INDEX.get(looseKey(trimmed));
}

// ─────────────────────────────────────────────────────────────────────────
// 파싱
// ─────────────────────────────────────────────────────────────────────────

/**
 * `"<model>@<effort>"` 지정을 파싱한다.
 *
 *   "codex"            → { provider: "gpt" }                       (기존 동작)
 *   "opus5"            → { provider: "claude", modelId: "claude-opus-5" }
 *   "gpt-5.6-terra@max"→ { provider: "gpt", modelId: "gpt-5.6-terra", effort: "max" }
 *   "fable@high"       → { provider: "claude", modelId: "claude-fable-5",
 *                          droppedEffort: "high" }   ← claude 엔 effort 축이 없다
 *   "존재하지않음"       → undefined                                 (호출자가 폴백)
 *
 * ★프로바이더 토큰("claude"/"codex"/"gpt"/"agy"…)을 **먼저** 가로챈다. 그래야
 * 기존 호출(`model: "codex"`)의 동작이 한 바이트도 바뀌지 않는다 — 프로바이더만
 * 말한 것을 구체 모델 지정으로 승격시키지 않는다.
 */
export function parseModelSpec(input?: string): ModelSpec | undefined {
  const raw = (input ?? "").trim();
  if (!raw) return undefined;

  const at = raw.lastIndexOf("@");
  const modelPart = at > 0 ? raw.slice(0, at).trim() : raw;
  const effortPart =
    at > 0
      ? raw
          .slice(at + 1)
          .trim()
          .toLowerCase()
      : "";

  // 1) 프로바이더만 말한 경우 — 구체 모델 없음(기존 경로 그대로).
  //    normalizeModel 은 "gpt-5.6-terra" 같은 구체 슬러그도 "gpt" 로 접으므로,
  //    레지스트리에 그 id 가 있는지를 먼저 확인해 구체 지정과 구분한다.
  const entry = findModelLoose(modelPart);
  if (!entry) {
    const provider = normalizeModel(modelPart);
    if (!provider) return undefined;
    return withEffort({ provider, raw }, effortPart, undefined);
  }

  // 2) 구체 모델 지정. 프로바이더는 레지스트리 항목에서 파생한다(별도 표 없음).
  return withEffort(
    { provider: entry.provider as ModelType, modelId: entry.id, raw },
    effortPart,
    entry,
  );
}

/** effort 를 검증해 붙인다. 지원하지 않으면 버리고 사유를 남긴다(스폰은 계속). */
function withEffort(
  base: ModelSpec,
  effortPart: string,
  entry: ModelRegistryEntry | undefined,
): ModelSpec {
  if (!effortPart) return base;
  // 구체 모델을 안 골랐으면 검증할 대상이 없다 — effort 만 단독으로는 못 쓴다.
  const supported = entry?.efforts ?? [];
  if (supported.includes(effortPart as EffortLevel)) {
    return { ...base, effort: effortPart as EffortLevel };
  }
  console.warn("[model-selection] effort 무시", {
    raw: base.raw,
    requested: effortPart,
    model: entry?.id ?? base.provider,
    supported: supported.length
      ? supported.join("/")
      : "(이 모델엔 effort 축 없음)",
  });
  return { ...base, droppedEffort: effortPart };
}

// ─────────────────────────────────────────────────────────────────────────
// 핀 해석(정책 적용)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 파싱된 지정을 실제 CLI 핀으로 바꾼다. claude 는 기존 버전가드
 * (`resolveClaudeModelPinned`)를 그대로 통과시킨다 — 미검증 CLI 면 opus 로
 * 그레이스풀 폴백하고 spawn 은 성공한다(§8.3 불변식).
 *
 * @param installedClaudeVersion 테스트용 주입. 미지정이면 실제 설치본을 읽는다.
 */
export function resolveModelPin(
  input?: string,
  installedClaudeVersion?: string,
): ResolvedModelPin | undefined {
  const spec = parseModelSpec(input);
  if (!spec) return undefined;

  // 프로바이더만 말했으면 모델 핀 없음 — 기존 complexity 티어 정책이 그대로 돈다.
  if (!spec.modelId) {
    return { provider: spec.provider, label: spec.provider, spec };
  }

  if (spec.provider === "claude") {
    const resolution = resolveClaudeModelPinned(
      spec.modelId,
      installedClaudeVersion,
    );
    return {
      provider: "claude",
      claudeModel: resolution.model,
      ...(resolution.fallback ? { fallback: resolution.fallback } : {}),
      label: resolution.model,
      spec,
    };
  }

  if (spec.provider === "gpt") {
    // codex 는 레지스트리에 minCli 가 없다(= 게이트 없음). effort 는 모델별
    // 지원목록으로 이미 검증됐고, 미지정이면 CLI 기본 effort 를 그대로 둔다.
    return {
      provider: "gpt",
      codexModel: spec.modelId,
      ...(spec.effort ? { codexEffort: spec.effort } : {}),
      label: spec.effort ? `${spec.modelId}@${spec.effort}` : spec.modelId,
      spec,
    };
  }

  // 그 외 프로바이더(antigravity/local/custom)는 아직 모델 핀 축이 없다 —
  // 레지스트리에 행이 생기면 여기 분기를 추가한다.
  return { provider: spec.provider, label: spec.modelId, spec };
}

// ─────────────────────────────────────────────────────────────────────────
// 셀렉터용 목록
// ─────────────────────────────────────────────────────────────────────────

/** 오케 모델 셀렉터 한 칸. `value` 는 `provider[:modelId]` compound. */
export interface OrchestratorModelChoice {
  value: string;
  provider: ModelType;
  modelId?: string;
  label: string;
}

/** compound 셀렉터 값을 만든다. 프로바이더만이면 접미 없음(기존 값과 동일). */
export function orchestratorModelValue(
  provider: string,
  modelId?: string,
): string {
  return modelId ? `${provider}:${modelId}` : provider;
}

/**
 * compound 셀렉터/저장 값을 프로바이더 + 모델 핀으로 쪼갠다.
 *
 * ★`MARBLO_ORCHESTRATOR_MODEL` env 의 시맨틱을 지키기 위해 존재한다. 그 env 는
 * `resolveOrchestratorModel()` 이 **프로바이더로만** 읽으므로, compound 를 그대로
 * 넣으면 미지값 → claude 폴백이 되어 핀이 조용히 사라진다. 그래서 env 에는 항상
 * 프로바이더만 넣고 모델 핀은 launch 옵션으로 따로 전달한다.
 *
 * 레지스트리가 모르는 모델 접미는 **버린다**(프로바이더는 살린다) — 예전 빌드가
 * 저장해 둔 값이나 오타가 spawn 을 깨뜨리지 않게.
 */
export function splitOrchestratorModelValue(value: string): {
  provider: string;
  modelId?: string;
} {
  const raw = (value ?? "").trim().toLowerCase();
  const sep = raw.indexOf(":");
  if (sep < 0) return { provider: raw };
  const provider = raw.slice(0, sep);
  const modelPart = raw.slice(sep + 1);
  const entry = findModelLoose(modelPart);
  if (!entry) {
    console.warn("[model-selection] 미지 오케 모델 접미 무시", {
      value,
      provider,
      modelPart,
    });
    return { provider };
  }
  return { provider, modelId: entry.id };
}

/**
 * 셀렉터에 넣을 Claude 변형 목록 — 레지스트리 파생(능력등급 높음 → 낮음).
 *
 * 라벨은 id 에서 기계적으로 만든다(리터럴 표 금지). `claude-opus-4-8` →
 * "Claude (Opus 4.8)".
 *
 * ★정렬은 `.reverse()` 가 아니라 내림차순 비교자다. `modelsByProvider` 의 정렬은
 * 안정정렬이라 같은 등급 안에서는 레지스트리 등재 순서(신형이 먼저)가 유지되는데,
 * 통째로 뒤집으면 그 동률 순서까지 뒤집혀 `top` 등급의 Opus 5 밑에 Opus 4.8 이 아니라
 * 위에 오게 된다. 등급만 뒤집고 동률 순서는 보존해야 "신형이 위" 가 성립한다.
 */
export function claudeOrchestratorChoices(): OrchestratorModelChoice[] {
  const rank: Record<string, number> = {
    cheap: 0,
    mid: 1,
    top: 2,
    frontier: 3,
  };
  return modelsByProvider("claude")
    .slice()
    .sort((a, b) => rank[b.capability] - rank[a.capability])
    .map((entry) => ({
      value: orchestratorModelValue("claude", entry.id),
      provider: "claude" as ModelType,
      modelId: entry.id,
      label: `Claude (${humanizeClaudeModelId(entry.id)})`,
    }));
}

/**
 * `claude-opus-4-8` → `Opus 4.8`, `claude-haiku-4-5-20251001` → `Haiku 4.5`.
 * 순수 문자열 변환이라 새 모델이 들어와도 표를 고칠 일이 없다.
 */
export function humanizeClaudeModelId(id: string): string {
  const bare = id.replace(/^claude-/, "").replace(/-\d{8}$/, "");
  const parts = bare.split("-");
  const family = parts[0] ?? bare;
  const version = parts.slice(1).join(".");
  const titled = family.charAt(0).toUpperCase() + family.slice(1);
  return version ? `${titled} ${version}` : titled;
}
