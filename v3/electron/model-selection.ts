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
  harnessCommandName,
  resolveClaudeModelPinned,
  type TopModelFallback,
} from "./agent-config";
import {
  getModel,
  modelsByHarness,
  vendorEnvSecretKeys,
  HARNESS_NATIVE_VENDOR,
  MODEL_REGISTRY,
  VENDOR_IDS,
  type CapabilityTier,
  type EffortLevel,
  type ModelRegistryEntry,
  type VendorId,
} from "./model-registry";
import { normalizeModel, type ModelType } from "./dispatch-scoring";
import { isApprovalGatedEffort } from "./mcp-server/escalation-approval";

/** 파싱된 모델 지정 — "무엇을 원했는가"(정책 적용 전). */
export interface ModelSpec {
  /**
   * ★하네스 축(= 스폰할 CLI). 구체 모델을 골랐으면 그 모델의 `harness` 에서
   * 파생된다. `ModelType` 과 같은 집합이라 기존 호출자(dispatch/bridge)가 그대로
   * 프로바이더 자리에 쓰던 값과 **바이트 동일**하다 — 축이 쪼개져도(USbdRV4k)
   * 여기 흐르는 값은 종전 그대로다.
   */
  harness: ModelType;
  /**
   * 벤더 축(백엔드 주인). 구체 모델을 골랐을 때만 채워진다. 오늘 값은
   * anthropic/openai 뿐이고, env-swap 벤더(zai 등)가 등록되면 같은 harness 에
   * 다른 vendor 가 실려 온다 — 라우팅·텔레메트리가 두 벤더를 구분할 근거다.
   */
  vendor?: VendorId;
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
  /** 스폰할 CLI(하네스). 종전 `provider` 필드와 값이 같다. */
  harness: ModelType;
  /** 벤더(백엔드 주인). 구체 모델 핀일 때만. */
  vendor?: VendorId;
  /** claude CLI 의 `--model` 값. claude 를 구체 지정했을 때만. */
  claudeModel?: string;
  /** codex CLI 의 `-c model=…` 값. gpt 를 구체 지정했을 때만. */
  codexModel?: string;
  /** codex CLI 의 `-c model_reasoning_effort=…` 값. */
  codexEffort?: EffortLevel;
  /** Grok 등 native CLI 의 모델 선택값. */
  nativeModel?: string;
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
  // ★프리픽스는 **하네스**로 뗀다("claude-opus-5" → "opus5"). 벤더로 떼면
  // env-swap 행(provider=zai, id="glm-5.2")에서 엉뚱한 문자열이 잘린다.
  const prefix = `${entry.harness}-`;
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
// 벤더 숏핸드 해석 (§P1 — env-swap 벤더 이름 → 기본 모델 id)
//
// 사용자가 "minimax", "glm", "kimi" 처럼 벤더 이름만으로 dispatch 하면
// 그건 모델 id 가 아니라 벤더 ID 이다. 이 층이 "minimax" → "MiniMax-M3" 처럼
// 해당 벤더의 플래그십 모델로 해석한다.
//
// loose 인덱스가 "minimax" 를 모르는 이유: 레지스트리 행의 id/alias/bare/날짜접미
// 어디에도 벤더 이름 문자열 자체가 없다. 벤더 이름을 모델로 승격하려면 별도 표가
// 필요하다.
//
// ★하드코딩을 최소화: 숏핸드는 VendorId 로만 매핑하고, primary 모델은
// MODEL_REGISTRY 에서 capability 최고 active 행으로 자동 파생한다
// (동점이면 레지스트리 등재 순서 — 플래그십이 먼저: MiniMax-M3, glm-5.2, k3).
// normalizeModel 에 벤더를 넣지 않는다 — 그건 harness 축이다.
// ─────────────────────────────────────────────────────────────────────────

/** 벤더 숏핸드 / 브랜드명 → VendorId (모델 id 하드코딩 없음). */
const VENDOR_SHORTHAND_TO_VENDOR: Record<string, VendorId> = {
  minimax: "minimax",
  // GLM / Z.ai — 같은 벤더의 두 이름
  glm: "zai",
  zai: "zai",
  // Kimi / Moonshot — 같은 벤더의 두 이름
  kimi: "moonshot",
  moonshot: "moonshot",
  // Upstage Solar Pro
  solar: "upstage",
  upstage: "upstage",
};

const CAPABILITY_RANK: Readonly<Record<CapabilityTier, number>> = {
  cheap: 0,
  mid: 1,
  top: 2,
  frontier: 3,
};

/**
 * 벤더 숏핸드 또는 VendorId 를 해당 벤더의 primary 모델 행으로 해석한다.
 *
 * primary = 해당 벤더 active 행 중 capability 최고. 동점이면 레지스트리 등재 순서
 * (최신/플래그십이 먼저 등록된 규율: MiniMax-M3, glm-5.2, k3).
 *
 * 매핑이 없으면 undefined — 호출자가 기존 `normalizeModel` 경로로 폴백한다.
 */
export function resolveVendorShorthand(
  input: string
): ModelRegistryEntry | undefined {
  const key = input.trim().toLowerCase();
  const vendor = VENDOR_SHORTHAND_TO_VENDOR[key];
  if (!vendor) return undefined;

  let best: ModelRegistryEntry | undefined;
  for (const entry of MODEL_REGISTRY) {
    if (entry.provider !== vendor || entry.status !== "active") continue;
    if (
      !best ||
      CAPABILITY_RANK[entry.capability] > CAPABILITY_RANK[best.capability]
    ) {
      best = entry;
    }
  }
  return best;
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
 *   "minimax"          → { provider: "claude", vendor: "minimax", modelId: "MiniMax-M3" }
 *   "glm" / "zai"      → { provider: "claude", vendor: "zai",     modelId: "glm-5.2" }
 *   "kimi" / "moonshot"→ { provider: "claude", vendor: "moonshot",modelId: "k3" }
 *   "solar" / "upstage"→ { provider: "gpt",    vendor: "upstage", modelId: "solar-pro4" }
 *   "존재하지않음"       → undefined                                 (호출자가 폴백)
 *
 * 해석 순서: (1) 구체 id/alias loose → (2) 벤더 숏핸드 → (3) 하네스 토큰.
 * 구체 id 가 벤더 숏핸드보다 먼저라 `MiniMax-M2.7` / `minimax-m3` 회귀가 보존된다.
 * 하네스 토큰("claude"/"codex"/"gpt"/"agy"…)은 마지막 — 프로바이더만 말한 것을
 * 구체 모델로 승격시키지 않는다.
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

  // 1) 레지스트리의 느슨한 인덱스("opus5" → "claude-opus-5", "minimax-m3" → MiniMax-M3).
  const entry = findModelLoose(modelPart);
  if (entry) {
    return withEffort(
      {
        harness: entry.harness as ModelType,
        vendor: entry.provider,
        modelId: entry.id,
        raw,
      },
      effortPart,
      entry
    );
  }

  // 2) 벤더 숏핸드 → 해당 벤더의 primary 모델 (minimax/glm/kimi 등).
  //    "minimax" → MiniMax-M3, "glm" → glm-5.2, "kimi" → k3.
  //    normalizeModel 에 넣지 않는다(harness 축 오염 방지).
  const vendorEntry = resolveVendorShorthand(modelPart);
  if (vendorEntry) {
    return withEffort(
      {
        harness: vendorEntry.harness as ModelType,
        vendor: vendorEntry.provider,
        modelId: vendorEntry.id,
        raw,
      },
      effortPart,
      vendorEntry
    );
  }

  // 3) 하네스 토큰("claude"/"codex"/"agy" 등) — 구체 모델 없음(기존 경로 그대로).
  const harness = normalizeModel(modelPart);
  if (!harness) return undefined;
  return withEffort({ harness, raw }, effortPart, undefined);
}

/** effort 를 검증해 붙인다. 지원하지 않으면 버리고 사유를 남긴다(스폰은 계속). */
function withEffort(
  base: ModelSpec,
  effortPart: string,
  entry: ModelRegistryEntry | undefined
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
    model: entry?.id ?? base.harness,
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
  installedClaudeVersion?: string
): ResolvedModelPin | undefined {
  const spec = parseModelSpec(input);
  if (!spec) return undefined;

  // 하네스만 말했으면 모델 핀 없음 — 기존 complexity 티어 정책이 그대로 돈다.
  if (!spec.modelId) {
    return { harness: spec.harness, label: spec.harness, spec };
  }

  // ★바이너리 선택은 **harness** 축이 한다(USbdRV4k). 벤더는 env 로 갈리고
  // (`agent-config.applyVendorEnv`) 바이너리를 바꾸지 않는다 — 그래서 GLM 같은
  // env-swap 벤더가 이 분기를 하나도 늘리지 않는다.
  if (spec.harness === "claude") {
    const resolution = resolveClaudeModelPinned(
      spec.modelId,
      installedClaudeVersion
    );
    return {
      harness: "claude",
      ...(spec.vendor ? { vendor: spec.vendor } : {}),
      claudeModel: resolution.model,
      ...(resolution.fallback ? { fallback: resolution.fallback } : {}),
      label: resolution.model,
      spec,
    };
  }

  if (spec.harness === "gpt") {
    // codex 는 레지스트리에 minCli 가 없다(= 게이트 없음). effort 는 모델별
    // 지원목록으로 이미 검증됐고, 미지정이면 CLI 기본 effort 를 그대로 둔다.
    return {
      harness: "gpt",
      ...(spec.vendor ? { vendor: spec.vendor } : {}),
      codexModel: spec.modelId,
      ...(spec.effort ? { codexEffort: spec.effort } : {}),
      label: spec.effort ? `${spec.modelId}@${spec.effort}` : spec.modelId,
      spec,
    };
  }

  if (spec.harness === "grok") {
    return {
      harness: "grok",
      ...(spec.vendor ? { vendor: spec.vendor } : {}),
      nativeModel: spec.modelId,
      label: spec.modelId,
      spec,
    };
  }

  // 그 외 하네스(antigravity/local/custom)는 아직 모델 핀 축이 없다.
  return {
    harness: spec.harness,
    ...(spec.vendor ? { vendor: spec.vendor } : {}),
    label: spec.modelId,
    spec,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 셀렉터용 목록
// ─────────────────────────────────────────────────────────────────────────

/** 오케 모델 셀렉터 한 칸. `value` 는 `harness[:modelId][@effort]` compound. */
export interface OrchestratorModelChoice {
  value: string;
  /** 스폰할 CLI(하네스). 값·의미 모두 종전 `provider` 필드와 동일하다. */
  harness: ModelType;
  /** 벤더(백엔드 주인). 모델 핀이 있는 칸에만. */
  vendor?: VendorId;
  modelId?: string;
  label: string;
  /**
   * 이 칸에서 **셀렉터로 고를 수 있는** effort 들(낮음 → 높음). 비었으면 effort
   * 축이 없다는 뜻이고(claude 전부, 프로바이더 기본칸), 그때 UI 는 effort 드롭다운
   * 자체를 그리지 않는다 — 즉 Claude 만 쓰는 사용자에겐 종전과 픽셀 동일하다.
   *
   * ★레지스트리 `efforts` 전부가 아니다. 승인게이트 칸(max/ultra, #602)은 빠진다
   * — 사유는 `selectableEfforts` 주석.
   */
  efforts: EffortLevel[];
}

/**
 * compound 셀렉터 값을 만든다. `provider[:modelId][@effort]`.
 *
 * 접미가 하나도 없으면 종전 값("claude"/"codex")과 바이트 동일하다 — 앱상태에
 * 저장된 기존 값이 그대로 유효하다(재시작 연속성 하위호환).
 *
 * effort 는 **모델 핀 위에만** 얹는다. 모델 없이 effort 만 지정하는 값은 만들지
 * 않는다 — 어느 모델의 effort 인지 검증할 수 없고, 사용자 `config.toml` 이 물고
 * 있는 모델이 그 effort 를 지원하는지도 알 수 없기 때문이다.
 */
export function orchestratorModelValue(
  provider: string,
  modelId?: string,
  effort?: string
): string {
  if (!modelId) return provider;
  return effort ? `${provider}:${modelId}@${effort}` : `${provider}:${modelId}`;
}

/**
 * 이 모델을 **오케 셀렉터에서** 고를 수 있는 effort 목록(레지스트리 파생).
 *
 * ★max/ultra 를 빼는 이유는 "비싸서" 가 아니라 **오케 모델 선택이 프로젝트별로
 * 영구 저장되기 때문**이다. 한 번 ultra 로 고르면 앱 재시작·크래시 자동재시작·
 * 모델 핸드오프가 전부 말없이 ultra 로 뜬다 — #602 승인게이트가 막으려던 바로 그
 * "자동 남발" 이 셀렉터 경로로 새는 것이다. 게다가 그 승인은 **티켓당 1회용**이라
 * (`escalation-approval`) 수명이 무한한 오케 기본값과 애초에 맞지 않는다.
 *
 * 그래서 셀렉터의 천장은 무게이트 최고칸(xhigh)이다. 에이전트 스폰의 max/ultra 는
 * 종전대로 `request_model_escalation` 승인 왕복으로만 열린다 — 그 경로는 손대지
 * 않았다.
 */
export function selectableEfforts(entry: ModelRegistryEntry): EffortLevel[] {
  return entry.efforts.filter((e) => !isApprovalGatedEffort(e));
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
 * 저장해 둔 값이나 오타가 spawn 을 깨뜨리지 않게. 같은 이유로 이 모델이 지원하지
 * 않는 effort, 그리고 승인게이트 칸(max/ultra)도 버린다: 저장값·env 로 들어온
 * `@ultra` 가 승인 없이 매 재시작마다 되살아나는 경로를 여기서 끊는다(#602).
 * ★버리는 것은 effort 뿐이고 모델 핀과 프로바이더는 살아남는다 — 선택이 통째로
 * 무효가 되어 오케가 엉뚱한 CLI 로 뜨는 편이 훨씬 나쁘다.
 */
export function splitOrchestratorModelValue(value: string): {
  /**
   * UI 표기 하네스 이름(`claude` | `codex`). 내부 `HarnessId` 로는 codex → gpt 다
   * (`resolveOrchestratorModel` 이 그 정규화를 한다). 값·의미 모두 종전 `provider`
   * 필드와 동일하고, 이름만 축분리(USbdRV4k) 어휘로 맞췄다.
   */
  harness: string;
  modelId?: string;
  effort?: EffortLevel;
} {
  const raw = (value ?? "").trim().toLowerCase();
  // effort 를 먼저 떼어낸다. 모델 id 에는 "@" 가 없으므로(레지스트리) 마지막
  // "@" 뒤는 항상 effort 자리다.
  const at = raw.lastIndexOf("@");
  const body = at > 0 ? raw.slice(0, at) : raw;
  const effortPart = at > 0 ? raw.slice(at + 1).trim() : "";

  const sep = body.indexOf(":");
  if (sep < 0) return { harness: body };
  const harness = body.slice(0, sep);
  const modelPart = body.slice(sep + 1);
  const entry = findModelLoose(modelPart);
  if (!entry) {
    console.warn("[model-selection] 미지 오케 모델 접미 무시", {
      value,
      harness,
      modelPart,
    });
    return { harness };
  }
  if (!effortPart) return { harness, modelId: entry.id };

  const allowed = selectableEfforts(entry);
  if (!allowed.includes(effortPart as EffortLevel)) {
    console.warn("[model-selection] 오케 effort 무시", {
      value,
      model: entry.id,
      requested: effortPart,
      reason: isApprovalGatedEffort(effortPart)
        ? "승인게이트 칸(max/ultra)은 오케 기본값으로 고정할 수 없다"
        : "이 모델이 지원하지 않는 effort",
      allowed: allowed.length ? allowed.join("/") : "(effort 축 없음)",
    });
    return { harness, modelId: entry.id };
  }
  return { harness, modelId: entry.id, effort: effortPart as EffortLevel };
}

/**
 * 오케로 띄울 수 있는 **하네스**(설정값의 프로바이더 자리에 올 수 있는 이름).
 *
 * 기준은 하나다: **자기 계정으로 자기 CLI 가 뜨는가**. claude/codex/grok/antigravity
 * 는 각자 로그인(구독·OAuth·브라우저 인증)을 자기 홈에 들고 있어 오케 수명(무한)에
 * 얹어도 조건부 상태가 없다. grok 은 네이티브 CLI(하네스 A형)라 여기 속한다 —
 * 종전엔 목록에 없어 "grok" 설정이 조용히 claude 로 강등됐다(BYOM 게이트 티켓).
 *
 * ★env-swap 벤더(GLM/MiniMax/Kimi)는 여기 없다. 그들은 **하네스가 아니라 모델 핀**
 * 으로만 지정되는데, 오케 선택은 프로젝트별 영구 저장이라 키가 빠진 순간부터 매
 * 재시작이 말없이 네이티브 백엔드로 샌다(`selectorEligible` 주석의 확정 결정).
 * 그 차단은 목록이 아니라 아래 모델 핀 검사가 한다.
 */
export const ORCHESTRATOR_HARNESS_SETTINGS = [
  "claude",
  "codex",
  "grok",
  "antigravity",
] as const;

/**
 * 오케 **자동 기본값** 우선순위 (연결·인증된 네이티브 하네스 중).
 *
 * 사용자가 `orchestratorModel` 을 **명시**하지 않았을 때(또는 자동 저장으로
 * 박힌 per-project 값을 재평가할 때) 쓴다. 제품 기본은 Claude → Codex → Grok
 * 순이고, env-swap 벤더(GLM/MiniMax/Kimi)는 오케 후보가 아니라 여기 없다
 * (목록 자체가 네이티브 3종). antigravity 도 자동 기본에는 넣지 않는다 —
 * 구독 온보딩 선택지도 같은 3종이다.
 *
 * ★자동 픽은 프로젝트별 영구 저장에 남지만 source=`auto` 로 태깅된다. 다음
 * resolve 때 이 우선순위로 다시 고르므로, 그록만 있을 때 박힌 값이 클로드
 * 복원 후에도 이기는 갭이 없다(명시 source=`user` 는 존중).
 */
export const ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY = [
  "claude",
  "codex",
  "grok",
] as const;

/**
 * 연결·인증된 네이티브 하네스 중 제품 기본 우선순위로 하나를 고른다.
 *
 *   - 입력은 UI/저장 표기(`claude`/`codex`/`grok`) 또는 내부 ModelType(`gpt`)
 *   - 우선순위: Claude > Codex > Grok
 *   - 후보가 없으면 null (호출부가 hard default `claude` 로 떨어진다)
 *   - env-swap 벤더 이름은 무시한다 (오케 후보 아님)
 */
export function pickPreferredOrchestratorHarness(
  authenticated: Iterable<string>
): typeof ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY[number] | null {
  const ready = new Set<string>();
  for (const raw of authenticated) {
    const v = (raw ?? "").trim().toLowerCase();
    if (!v) continue;
    // 내부 ModelType "gpt" ↔ 설정 표기 "codex"
    if (v === "gpt") ready.add("codex");
    else ready.add(v);
  }
  for (const harness of ORCHESTRATOR_DEFAULT_HARNESS_PRIORITY) {
    if (ready.has(harness)) return harness;
  }
  return null;
}

/**
 * 오케 모델 설정값(`provider[:modelId][@effort]`)을 정규화한다. main.ts 의 저장값·
 * env·IPC 세 입구가 전부 이 함수를 지난다.
 *
 * ★모델 접미는 레지스트리에 있는 것만 살아남는다 — 오타나 옛 빌드가 저장한 미지
 * 모델은 접미만 버리고 프로바이더로 강등된다(spawn 이 깨지지 않게). effort 도
 * 같다: 이 모델이 지원하지 않는 값과 승인게이트 칸(max/ultra)은
 * `splitOrchestratorModelValue` 가 이미 떨궈서 온다(#602 — 저장값·env 로 들어온
 * `@ultra` 가 매 재시작 되살아나는 경로를 여기서 끊는다).
 * 접미 없는 값의 결과는 종전과 완전히 동일하므로 기존 저장값이 그대로 유효하다.
 *
 * ★모델 핀이 하네스와 어긋나면(예: "claude:gpt-5.5") 접미를 버린다. 셀렉터는 그런
 * 값을 만들지 않지만 env·손편집은 만들 수 있고, 그대로 통과시키면 claude CLI 에
 * `--model gpt-5.5` 가 붙어 spawn 이 깨진다.
 *
 * ★env-swap 벤더 핀("claude:glm-4.7")도 버린다 — UI 셀렉터는 `selectorEligible` 로
 * 이미 그 칸을 세우지 않지만, env·손편집·옛 저장값은 여기로 들어올 수 있다. 목록
 * 필터만으로는 "오케에 env-swap 미편입" 이 지켜지지 않는다.
 */
export function normalizeOrchestratorModelSetting(value: unknown): string {
  const input = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (!input) return "claude";
  const {
    harness: rawHarness,
    modelId,
    effort,
  } = splitOrchestratorModelValue(input);
  const provider = rawHarness === "gpt" ? "codex" : rawHarness;
  if (
    !(ORCHESTRATOR_HARNESS_SETTINGS as readonly string[]).includes(provider)
  ) {
    return "claude";
  }
  if (!modelId) return provider;

  const entry = getModel(modelId);
  // ★핀이 어느 CLI 로 뜨는지는 **하네스** 축이 정한다(USbdRV4k). 벤더는 env 로
  // 갈릴 뿐 바이너리를 바꾸지 않으므로, 여기서 봐야 하는 값은 harness 다.
  const pinHarness = entry?.harness;

  if (entry && entry.provider !== HARNESS_NATIVE_VENDOR[entry.harness]) {
    console.warn(
      `[model-selection] env-swap 벤더 모델 "${modelId}"(vendor=${entry.provider})은 오케 후보가 아니라 접미를 버립니다 — 오케 선택은 영구 저장이라 조건부 크레덴셜을 얹지 않는다`
    );
    return provider;
  }

  if (
    (provider === "claude" && pinHarness === "claude") ||
    (provider === "codex" && pinHarness === "gpt")
  ) {
    return orchestratorModelValue(provider, modelId, effort);
  }

  // grok/antigravity 는 하네스로는 뜨지만 **모델 핀 축이 launch 옵션에 아직 없다**
  // (`orchestratorLaunchPin` 은 claude/codex 두 축만 만든다). 접미를 살려두면
  // 저장값엔 남는데 CLI 엔 안 붙어 "골랐는데 안 먹는" 상태가 되므로 여기서 버린다.
  if (pinHarness && pinHarness === provider) {
    console.warn(
      `[model-selection] "${provider}" 오케는 모델 핀 축이 없어 접미 "${modelId}" 를 버립니다(프로바이더 기본 모델로 뜬다)`
    );
    return provider;
  }

  console.warn(
    `[model-selection] 오케 모델 접미 "${modelId}"(harness=${
      pinHarness ?? "미지"
    })가 프로바이더 "${provider}" 와 어긋나 무시합니다`
  );
  return provider;
}

/** 정규화된 오케 설정값 → 스폰 하네스(`ModelType`). */
export function orchestratorModelTypeForSetting(value: unknown): ModelType {
  const { harness } = splitOrchestratorModelValue(
    normalizeOrchestratorModelSetting(value)
  );
  if (harness === "codex") return "gpt";
  if (harness === "grok") return "grok";
  if (harness === "antigravity") return "antigravity";
  return "claude";
}

/**
 * 오케 셀렉터/저장값 하나(`provider[:modelId][@effort]`)를 launch 옵션의 **모델 핀
 * 세 축**(claude `--model`, codex `-c model=`/`-c model_reasoning_effort=`,
 * grok `-m`)으로 해석한다. 프로바이더만 고른 값이면 전부 undefined 를 돌려주고, 그때
 * 오케는 종전대로 각 CLI 의 기본 모델·기본 effort 를 상속한다(바이트 동일).
 *
 * ★main.ts 가 이 함수를 쓰고 테스트도 이 함수를 쓴다. 해석 규칙을 main 안에 두면
 * (a) 테스트가 그 규칙을 복사하게 되고 — 복사본을 검증해봐야 라이브 경로를 증명하지
 * 못한다 — (b) claude 축과 codex 축이 서로 다른 자리에서 갈라진다.
 *
 * claude 축은 버전가드(`resolveClaudeModelPinned`)를 그대로 통과한다. codex 축엔
 * 게이트가 없다 — 레지스트리 codex 행에 `minCli` 가 없기 때문이고(§ 모델 목록을
 * 서버 권위 캐시에서 받으므로 CLI 버전으로 대신 판정할 근거가 없다), effort 는
 * `splitOrchestratorModelValue` 가 모델별 지원목록 + 승인게이트로 이미 걸러서 준다.
 */
export function orchestratorLaunchPin(
  value: string,
  installedClaudeVersion?: string
): {
  claudeModel?: string;
  codexModel?: string;
  codexEffort?: EffortLevel;
  nativeModel?: string;
} {
  const { harness, modelId, effort } = splitOrchestratorModelValue(value);
  if (!modelId) return {};

  const pin = resolveModelPin(
    effort ? `${modelId}@${effort}` : modelId,
    installedClaudeVersion
  );
  if (!pin) return {};

  // 하네스가 어긋난 값(env·손편집)은 축을 넘기지 않는다 — claude CLI 에
  // `--model gpt-5.5` 가 붙으면 spawn 이 깨진다.
  if (harness === "claude" && pin.harness === "claude") {
    return pin.claudeModel ? { claudeModel: pin.claudeModel } : {};
  }
  if (harness === "codex" && pin.harness === "gpt") {
    return {
      ...(pin.codexModel ? { codexModel: pin.codexModel } : {}),
      ...(pin.codexEffort ? { codexEffort: pin.codexEffort } : {}),
    };
  }
  // grok 축(`-m <MODEL>`). ★이 분기가 없어서 오케 grok 의 모델 선택이 통째로
  // drop 됐다 — `grok:grok-4.5` 는 위 두 분기에 걸리지 못하고 아래 "하네스 어긋남"
  // 경고로 떨어져 `{}` 를 돌려줬고, 결국 buildCLICommand 가 매번
  // GROK_DEFAULT_MODEL 로 떴다. 셀렉터에서 무엇을 고르든 결과가 같았다.
  //
  // grok CLI 1.0.0 은 `-m, --model <MODEL>` 을 정식 지원한다(`grok --help` 실측).
  // 예전 0.2.112 가 `-m` 을 거부했다는 관측은 이 버전에서 더 이상 사실이 아니다.
  if (harness === "grok" && pin.harness === "grok") {
    return pin.nativeModel ? { nativeModel: pin.nativeModel } : {};
  }
  console.warn("[model-selection] 오케 모델 핀이 하네스와 어긋나 무시", {
    value,
    harness,
    pinHarness: pin.harness,
  });
  return {};
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
  return orchestratorChoicesFor("claude", "claude", (entry) =>
    humanizeClaudeModelId(entry.id)
  );
}

/**
 * 셀렉터에 넣을 Codex(GPT) 변형 목록 — Claude 와 **같은 경로**로 레지스트리에서
 * 파생한다(능력등급 높음 → 낮음).
 *
 * ★라벨에 모델 id 를 **그대로** 쓴다: `Codex (gpt-5.6-sol)`. Claude 쪽처럼 예쁘게
 * 접지 않는 이유는 codex 변종 이름이 사람 사이에서 자주 오전달되기 때문이다
 * (사장님 표기 "gpt-5.6-solar" ↔ 실제 `gpt-5.6-sol`). 화면에 레지스트리 실명이
 * 그대로 보이면 그 어긋남이 즉시 드러난다 — 이 티켓의 "모델명 날조 금지" 는
 * 데이터뿐 아니라 UI 표기까지의 요구다.
 *
 * effort 축은 별도 드롭다운이 된다(칸을 곱집합으로 펼치면 6모델 × 4effort = 24칸
 * 짜리 드롭다운이 되어 아무도 못 고른다). 두 축의 선택은 하나의 compound 값
 * `codex:gpt-5.6-terra@high` 로 합쳐져 저장·전달된다 — 저장 필드가 하나라 재시작
 * 연속성 경로가 갈라지지 않는다.
 */
export function codexOrchestratorChoices(): OrchestratorModelChoice[] {
  return orchestratorChoicesFor("gpt", "codex", (entry) => entry.id);
}

/**
 * 하네스 하나의 셀렉터 칸들. 두 하네스가 같은 정렬·같은 값 포맷을 쓰도록
 * 한 곳에 둔다(#601 이 claude 에만 깔아둔 규칙을 codex 가 복제하지 않게).
 *
 * ★목록의 축은 **하네스**다(USbdRV4k). "Claude 드롭다운" 은 "claude 바이너리로
 * 뜨는 칸들" 이라는 뜻이고, env-swap 벤더가 등록되면 같은 드롭다운에 다른 벤더
 * 칸이 함께 선다 — 그때 벤더 구분은 `vendor` 필드가 한다.
 *
 * ★정렬은 `.reverse()` 가 아니라 내림차순 비교자다. `modelsByHarness` 의 정렬은
 * 안정정렬이라 같은 등급 안에서는 레지스트리 등재 순서(신형이 먼저)가 유지되는데,
 * 통째로 뒤집으면 그 동률 순서까지 뒤집혀 `top` 등급의 Opus 5 밑에 Opus 4.8 이 아니라
 * 위에 오게 된다. 등급만 뒤집고 동률 순서는 보존해야 "신형이 위" 가 성립한다.
 *
 * @param harness    레지스트리 하네스 축("claude" | "gpt")
 * @param valuePrefix compound 값·라벨에 쓸 UI 이름. gpt 는 UI 에서
 *                    "codex" 다(메모리: Codex==gpt, 내부 model id 는 "gpt").
 */
function orchestratorChoicesFor(
  harness: "claude" | "gpt",
  valuePrefix: string,
  humanize: (entry: ModelRegistryEntry) => string
): OrchestratorModelChoice[] {
  const rank: Record<string, number> = {
    cheap: 0,
    mid: 1,
    top: 2,
    frontier: 3,
  };
  const uiName = valuePrefix.charAt(0).toUpperCase() + valuePrefix.slice(1);
  return modelsByHarness(harness)
    .filter(selectorEligible)
    .sort((a, b) => rank[b.capability] - rank[a.capability])
    .map((entry) => ({
      value: orchestratorModelValue(valuePrefix, entry.id),
      harness: harness as ModelType,
      vendor: entry.provider,
      modelId: entry.id,
      label: `${uiName} (${humanize(entry)})`,
      efforts: selectableEfforts(entry),
    }));
}

/**
 * 오케 셀렉터에 세울 수 있는 행인가 — **하네스 네이티브 벤더만** 통과한다.
 *
 * ★사유는 max/ultra 를 셀렉터에서 빼는 것(`selectableEfforts`)과 정확히 같다:
 * 오케 모델 선택은 **프로젝트별로 영구 저장**된다. env-swap 벤더(GLM 등)는 별도
 * 구독키가 있어야 도는데, 키가 없는 상태로 한 번 저장되면 앱 재시작·크래시
 * 자동재시작·모델 핸드오프가 **전부 말없이** 그 값으로 뜨고, 매번 벤더 프로파일
 * 미주입 → 하네스 기본 백엔드로 새는 스폰이 반복된다. 수명이 무한한 기본값에
 * 조건부 크레덴셜을 얹지 않는다.
 *
 * env-swap 벤더는 **명시 지정**(`dispatch_task(model="glm-4.7")`)으로 닿는다 —
 * 그 경로는 티켓 1건짜리 수명이라 실패해도 그 티켓에서 끝난다. 구독 확보 + 라이브
 * 검증(서베이 V1-2)이 끝나면 이 필터를 걷고 벤더별 표기 라벨을 붙인다.
 */
function selectorEligible(entry: ModelRegistryEntry): boolean {
  return entry.provider === HARNESS_NATIVE_VENDOR[entry.harness];
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

// ─────────────────────────────────────────────────────────────────────────
// 퀵레인 모델 카탈로그 (벤더 → 구체 모델 → effort)
//
// 오케 셀렉터(`*OrchestratorChoices`)와 **의도적으로 다른 함수**다. 두 셀렉터의
// 선택은 수명이 다르기 때문이다:
//
//   오케 선택   — 프로젝트별로 **영구 저장**된다. 그래서 env-swap 벤더를
//                 `selectorEligible` 로 잘라낸다(키가 없는 값이 매 재시작마다
//                 되살아나 조용히 네이티브 벤더로 새는 것을 막으려고).
//   퀵레인 선택 — **레인 1개짜리 수명**이다. 티켓 하나를 띄우는 그 순간의
//                 선택이고, 실패해도 그 레인에서 끝난다 — `dispatch_task(model=…)`
//                 명시 지정과 같은 수명이라 같은 대우를 받는다.
//
// 그래서 여기는 **레지스트리 전 행**을 벤더별로 세운다. 키가 없는 벤더는 목록에서
// 지우는 대신 `requiredEnvKeys` 를 실어 보내고, 켤 수 있는지 판정(=process.env
// 조회)은 main 이 한다 — 이 모듈은 시크릿을 읽지 않는다(model-registry 상단 규율).
// ─────────────────────────────────────────────────────────────────────────

/**
 * 벤더 표시명. **모델 목록이 아니라 브랜드 표기**라서 표로 둔다 —
 * `Record<VendorId, string>` 이 exhaustive 라, 레지스트리에 새 벤더가 들어오면
 * 컴파일이 여기서 멈춘다(라벨을 잊은 채 조용히 벤더 id 가 UI 에 노출되지 않는다).
 */
export const VENDOR_LABEL: Readonly<Record<VendorId, string>> = {
  anthropic: "Claude",
  openai: "Codex",
  google: "Gemini",
  zai: "Z.ai GLM",
  minimax: "MiniMax",
  xai: "Grok",
  moonshot: "Kimi",
  upstage: "Upstage Solar",
  local: "로컬",
  custom: "사용자 지정",
};

/** 퀵레인 셀렉터의 모델 한 칸. */
export interface QuickLaneModelOption {
  /** 레지스트리 구체 id. 그대로 `agent:launch` 의 modelPin 으로 나간다. */
  modelId: string;
  /**
   * 이 모델로 해석되는 CLI alias 들(`registry.aliases` 그대로).
   *
   * 셀렉터는 이 값을 **그리지 않는다** — 핀에는 구체 id 만 쓴다(레지스트리 상단
   * 규율). 그럼에도 카탈로그에 실어 보내는 이유는 사용량 탭 때문이다: 과거 로그·
   * 스폰 argv 에는 `grok`·`opus` 같은 alias 가 그대로 남아 있고, 렌더러는
   * 레지스트리를 import 할 수 없어(경계 규약) 이 채널 말고는 alias→벤더를 알
   * 방법이 없다. 안 실어 보내면 alias 로 기록된 사용량이 "미등록" 으로 떨어진다.
   */
  aliases: string[];
  /** 사람이 읽는 이름(claude 계열만 예쁘게 접고 나머지는 실명 그대로). */
  label: string;
  capability: CapabilityTier;
  /** 셀렉터에서 고를 수 있는 effort(낮음 → 높음). 빈 배열 = effort 축 없음. */
  efforts: EffortLevel[];
  /** CLI 기본 effort — 드롭다운의 "기본" 칸이 무엇을 뜻하는지 보여주는 힌트. */
  defaultEffort?: EffortLevel;
  /** 단가가 추정치인가(=화면에 "추정" 표기). */
  estimatedPricing: boolean;
}

/** 퀵레인 셀렉터의 벤더 그룹(= 1단계 선택지). */
export interface QuickLaneVendorGroup {
  vendor: VendorId;
  label: string;
  /** 이 그룹의 모델들이 스폰하는 바이너리. 에이전트 doc 의 `model` 이 된다. */
  harness: ModelType;
  /** 에이전트 doc 의 `command`. `agent-config.MODEL_BINARY` 단일소스 파생. */
  command: string;
  /**
   * 이 벤더에 붙으려면 있어야 하는 env 키 **이름들**(값 아님). 네이티브 벤더는
   * 빈 배열 — CLI 자기 로그인으로 붙는다.
   */
  requiredEnvKeys: string[];
  models: QuickLaneModelOption[];
}

/**
 * 퀵레인 모델 카탈로그 — **레지스트리 파생**. 이 함수 안에 모델 id 리터럴은
 * 하나도 없다(모델을 추가하려면 레지스트리에 행 하나면 된다).
 *
 * 정렬: 벤더는 네이티브(하네스 기본 벤더) 먼저 → 그 안에서 `VENDOR_IDS` 순서.
 * 모델은 능력등급 높음 → 낮음(오케 셀렉터와 같은 규칙, 같은 이유로 `.reverse()`
 * 가 아니라 내림차순 비교자다 — 동률 순서를 보존해야 "신형이 위" 가 성립한다).
 */
export function quickLaneVendorCatalog(): QuickLaneVendorGroup[] {
  const rank: Record<CapabilityTier, number> = {
    cheap: 0,
    mid: 1,
    top: 2,
    frontier: 3,
  };
  const groups: QuickLaneVendorGroup[] = [];

  for (const vendor of VENDOR_IDS) {
    const entries = MODEL_REGISTRY.filter(
      (m) => m.provider === vendor && m.status === "active"
    );
    if (entries.length === 0) continue;

    // 한 벤더의 행들이 서로 다른 하네스로 갈리는 경우는 오늘 없지만, 생긴다면
    // 그룹을 하네스별로 쪼개야 한다(그룹 하나가 두 바이너리를 뜻할 수 없다).
    // 그때 조용히 첫 하네스로 뭉뚱그리지 않도록 여기서 갈라 준다.
    const harnesses = [...new Set(entries.map((e) => e.harness))];
    for (const harness of harnesses) {
      const groupEntries = entries.filter((e) => e.harness === harness);
      const models = groupEntries
        .sort((a, b) => rank[b.capability] - rank[a.capability])
        .map<QuickLaneModelOption>((entry) => ({
          modelId: entry.id,
          aliases: [...entry.aliases],
          label:
            entry.harness === "claude" && entry.provider === "anthropic"
              ? humanizeClaudeModelId(entry.id)
              : entry.id,
          capability: entry.capability,
          efforts: selectableEfforts(entry),
          ...(entry.defaultEffort
            ? { defaultEffort: entry.defaultEffort }
            : {}),
          estimatedPricing: Boolean(entry.pricing.estimated),
        }));

      // 그룹의 필수 env 키 = 소속 모델들이 요구하는 키의 합집합. 오늘 한 벤더의
      // 행들은 같은 프로파일을 쓰므로 합집합이 곧 각 행의 키다.
      const envKeys = new Set<string>();
      for (const entry of groupEntries) {
        for (const key of vendorEnvSecretKeys(entry.id)) envKeys.add(key);
      }

      groups.push({
        vendor,
        label: VENDOR_LABEL[vendor],
        harness: harness as ModelType,
        command: harnessCommandName(harness as ModelType),
        requiredEnvKeys: [...envKeys].sort(),
        models,
      });
    }
  }

  // 네이티브 벤더(=그 하네스가 프로파일 없이 붙는 곳)를 앞으로. env-swap 벤더는
  // 조건부 크레덴셜이 필요한 칸이라 목록 아래쪽이 정직하다.
  return groups.sort((a, b) => {
    const an = HARNESS_NATIVE_VENDOR[a.harness as HarnessKey] === a.vendor;
    const bn = HARNESS_NATIVE_VENDOR[b.harness as HarnessKey] === b.vendor;
    if (an !== bn) return an ? -1 : 1;
    return 0;
  });
}

/** `HARNESS_NATIVE_VENDOR` 의 키 타입(레지스트리 `HarnessId`)에 맞추기 위한 별칭. */
type HarnessKey = keyof typeof HARNESS_NATIVE_VENDOR;
