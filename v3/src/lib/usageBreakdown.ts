/**
 * 사용량 탭의 **하위모델 분해** 순수 로직 — DOM·store·IPC 없음이라 node 환경에서
 * 그대로 유닛테스트된다(`tests/unit/usage-breakdown.test.ts`).
 *
 * ── 왜 이 파일이 필요한가 ────────────────────────────────────────────────
 * 사용량 탭은 지금까지 모델 id 를 **하네스 계열**로만 접어 보여줬다
 * (`claude-opus-5`·`glm-4.7`·`MiniMax-M3` → 전부 "Claude"). env-swap 벤더가
 * 우리 `claude` 바이너리를 그대로 쓰기 때문에(model-registry 의 harness/provider
 * 축 분리) 그 접기는 **틀린 축**이다 — Z.ai 토큰과 Anthropic 토큰이 한 칸에
 * 섞여서, 어느 벤더 쿼터를 태웠는지 화면에서 알 수 없었다.
 *
 * 그래서 분해 축을 둘로 세운다: **벤더(백엔드 주인) → 구체 모델 id**.
 *
 * ── ★데이터 출처(날조 금지) ──────────────────────────────────────────────
 * 여기 들어오는 숫자는 전부 `getCostSummary`(BigQuery `cost_logs`) 집계다.
 * `cost_logs.model` 은 cost-tracker 가 세션 메타데이터에서 읽은 **실제 실행
 * 모델 id**(useCostWriter 주석 참조)라 분해에 필요한 해상도가 이미 있다.
 * 이 모듈은 그 행들을 재분류·합산만 하고, 없는 값을 만들어내지 않는다.
 *
 * ── ★모델 id 리터럴을 두지 않는 규율 ────────────────────────────────────
 * 벤더↔모델 매핑의 단일소스는 `electron/model-registry.ts` 이고, 렌더러는 그
 * 파일을 import 할 수 없다(경계 규약). 그래서 매핑은 이미 존재하는
 * `models:quickLaneCatalog` IPC(레지스트리 파생)를 그대로 재사용한다 —
 * 미러 배열도, 새 IPC 도 만들지 않는다.
 *
 * 예외는 `guessVendorFromModelId` 하나다. 레지스트리에 **없는** id(구세대
 * `claude-opus-4-7`, `gemini-*` 등 과거 로그)를 "미상" 으로 전부 버리면 과거
 * 사용량이 화면에서 사라지므로, 프리픽스 휴리스틱으로 벤더를 추정하되
 * `registered: false` 로 표시해 추정임을 UI 가 드러낸다. 레지스트리 조회가
 * 언제나 우선이다.
 */

/** 카탈로그 조회 키 정규화 — `model-registry.norm` 과 같은 규칙(trim+소문자). */
function norm(s: string): string {
  return s.trim().toLowerCase();
}

// ─────────────────────────────────────────────────────────────────────────
// 기간 선택기
// ─────────────────────────────────────────────────────────────────────────

/**
 * "전체" 가 서버에 보내는 일수.
 *
 * `getCostSummary` 는 `days` 를 **양의 정수**로만 받고(0/음수는
 * invalid-argument), 내부적으로 `TIMESTAMP_SUB(CURRENT_TIMESTAMP(), INTERVAL
 * @days DAY)` 로 자른다. 10년은 첫 `cost_logs` 행(2026)보다 앞서므로 실질적으로
 * 전 구간이고, 여전히 **실제 쿼리 결과**다 — 합성 총계가 아니다.
 */
export const ALL_PERIOD_DAYS = 3650;

export type UsagePeriodId = "7d" | "30d" | "all";

export interface UsagePeriod {
  id: UsagePeriodId;
  /** `loadSummary(projectId, days)` 로 그대로 나가는 값. */
  days: number;
}

/** 상단 기간 선택기의 칸들(좁은 창 → 넓은 창). */
export const USAGE_PERIODS: readonly UsagePeriod[] = [
  { id: "7d", days: 7 },
  { id: "30d", days: 30 },
  { id: "all", days: ALL_PERIOD_DAYS },
] as const;

export function periodById(id: UsagePeriodId): UsagePeriod {
  return USAGE_PERIODS.find((p) => p.id === id) ?? USAGE_PERIODS[1];
}

// ─────────────────────────────────────────────────────────────────────────
// 벤더 색상 — 카테고리 팔레트(고정 순서)
// ─────────────────────────────────────────────────────────────────────────

/**
 * 벤더 색 슬롯. 다크 표면(#182030 = gray-800/50 over gray-900)에 대해 검증된
 * 카테고리 팔레트이고, **순서 자체가 색각이상 안전장치**라 임의로 섞지 않는다
 * (검증: 명도대역/채도하한/인접 CVD ΔE 8.4/일반시야 ΔE 19.3/대비 3:1 전부 통과).
 *
 * ★색은 **엔티티(벤더)를 따라간다. 순위를 따라가지 않는다** — 기간을 바꿔
 * 벤더 순서가 뒤집혀도 Claude 는 계속 같은 파랑이다.
 */
const VENDOR_COLOR_SLOTS = [
  "#3987e5", // blue
  "#d95926", // orange
  "#199e70", // aqua
  "#c98500", // yellow
  "#d55181", // magenta
  "#008300", // green
  "#9085e9", // violet
] as const;

/**
 * 슬롯 배정 순서. `model-registry.VENDOR_IDS` 중 **실제 모델 행을 가진** 벤더들.
 * `local`/`custom`/미상은 카테고리 색을 받지 않고 중립 회색으로 떨어진다 —
 * "벤더 미상" 은 브랜드가 아니라 빈칸이기 때문이다.
 */
const VENDOR_SLOT_ORDER = [
  "anthropic",
  "openai",
  "zai",
  "minimax",
  "xai",
  "google",
  "moonshot",
] as const;

/** 벤더 미상/사용자 지정 — 카테고리 색이 아닌 중립 회색. */
export const NEUTRAL_VENDOR_COLOR = "#9ca3af";

export function vendorColor(vendor: string): string {
  const i = VENDOR_SLOT_ORDER.indexOf(
    norm(vendor) as (typeof VENDOR_SLOT_ORDER)[number],
  );
  return i >= 0 ? VENDOR_COLOR_SLOTS[i] : NEUTRAL_VENDOR_COLOR;
}

// ─────────────────────────────────────────────────────────────────────────
// 벤더 ↔ 모델 인덱스 (quickLaneCatalog 파생)
// ─────────────────────────────────────────────────────────────────────────

export interface VendorModelInfo {
  vendor: string;
  vendorLabel: string;
  /** 사람이 읽는 모델명. 카탈로그가 준 label(claude 계열만 예쁘게 접힌다). */
  modelLabel: string;
  /** 이 모델을 띄우는 바이너리. 같은 `claude` 하네스라도 벤더는 다를 수 있다. */
  harness: string;
  /** 단가가 추정치인가 — 비용 표기 옆 "추정" 배지의 근거. */
  estimatedPricing: boolean;
}

export type VendorModelIndex = ReadonlyMap<string, VendorModelInfo>;

/** 카탈로그(레지스트리 파생)를 `정규화된 모델 id → 벤더 사실` 로 뒤집는다. */
export function buildVendorModelIndex(
  groups: readonly QuickLaneVendorGroup[],
): VendorModelIndex {
  const index = new Map<string, VendorModelInfo>();
  for (const group of groups) {
    for (const model of group.models) {
      index.set(norm(model.modelId), {
        vendor: group.vendor,
        vendorLabel: group.label,
        modelLabel: model.label,
        harness: group.harness,
        estimatedPricing: model.estimatedPricing,
      });
    }
  }
  return index;
}

/**
 * 레지스트리에 **없는** 모델 id 의 벤더 추정(프리픽스 휴리스틱).
 *
 * ★추정이라는 사실은 호출부가 `registered: false` 로 계속 들고 다닌다. 이 함수는
 * 과거 로그(구세대 id)를 "미상" 한 칸에 몰아넣지 않으려고만 존재한다.
 *
 * 한계: env-swap 벤더가 **Anthropic 모델명 그대로** 서빙된 로그가 있다면
 * anthropic 으로 잘못 접힌다. 오늘 등록된 GLM/MiniMax id 는 자기 이름을 쓰고
 * 레지스트리에도 있어 이 경로를 타지 않는다.
 */
export function guessVendorFromModelId(modelId: string): string {
  const m = norm(modelId);
  if (!m) return "unknown";
  if (m.startsWith("glm")) return "zai";
  if (m.startsWith("minimax")) return "minimax";
  if (m.startsWith("grok")) return "xai";
  if (m.startsWith("kimi") || m.startsWith("moonshot")) return "moonshot";
  if (m.startsWith("claude")) return "anthropic";
  if (m.startsWith("gemini")) return "google";
  if (/^(gpt|o\d|codex)/.test(m)) return "openai";
  return "unknown";
}

export interface ResolvedModel extends VendorModelInfo {
  /** 레지스트리(카탈로그)에 있는 id 인가. false = 벤더가 프리픽스 추정치. */
  registered: boolean;
}

/**
 * 모델 id 하나를 벤더 사실로 해석한다. 인덱스 우선, 없으면 추정.
 *
 * 빈 문자열(= `cost_logs.model` 이 NULL 이던 행)은 지어내지 않고 "미상" 으로 둔다.
 */
export function resolveModel(
  modelId: string,
  index: VendorModelIndex,
): ResolvedModel {
  const hit = index.get(norm(modelId));
  if (hit) return { ...hit, registered: true };
  const vendor = guessVendorFromModelId(modelId);
  return {
    vendor,
    // 라벨은 카탈로그에만 있다 — 없으면 벤더 id 를 그대로 노출한다(가짜
    // 브랜드명을 만들지 않는다). UI 가 "미상" 만 번역해 덮는다.
    vendorLabel: vendor,
    modelLabel: modelId || "",
    harness: "",
    estimatedPricing: false,
    registered: false,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// 집계 — byDay(일자×모델) → 벤더 → 하위모델
// ─────────────────────────────────────────────────────────────────────────

/** `getCostSummary.byDay` 한 행이 갖는 수치들(집계에 필요한 최소 형태). */
export interface UsageEntry {
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalTokens: number;
  cost: number;
}

export interface UsageTotals {
  tokens: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  cost: number;
}

export interface ModelUsageRow extends UsageTotals {
  modelId: string;
  label: string;
  registered: boolean;
  estimatedPricing: boolean;
}

export interface VendorUsageRow extends UsageTotals {
  vendor: string;
  label: string;
  color: string;
  /** 이 벤더 행들이 전부 추정 분류인가(= 레지스트리 매칭이 하나도 없었다). */
  registered: boolean;
  models: ModelUsageRow[];
}

const ZERO: UsageTotals = {
  tokens: 0,
  inputTokens: 0,
  outputTokens: 0,
  cacheReadTokens: 0,
  cacheWriteTokens: 0,
  cost: 0,
};

/**
 * 한 행의 토큰 총합. `totalTokens` 가 있으면 그것을 믿고, 없으면(구 행/부분
 * 응답) 네 부분의 합으로 되살린다 — 기존 DailyTrend 와 같은 규칙이다.
 */
function tokensOf(e: UsageEntry): number {
  return (
    e.totalTokens ||
    (e.inputTokens || 0) +
      (e.outputTokens || 0) +
      (e.cacheReadTokens || 0) +
      (e.cacheWriteTokens || 0)
  );
}

function addInto(acc: UsageTotals, e: UsageEntry): void {
  acc.tokens += tokensOf(e);
  acc.inputTokens += e.inputTokens || 0;
  acc.outputTokens += e.outputTokens || 0;
  acc.cacheReadTokens += e.cacheReadTokens || 0;
  acc.cacheWriteTokens += e.cacheWriteTokens || 0;
  acc.cost += e.cost || 0;
}

/**
 * 선택된 기간의 byDay 행들을 **벤더 → 하위모델** 2단으로 접는다.
 *
 * 정렬은 토큰 내림차순(벤더·모델 둘 다). 색은 정렬과 무관하게 벤더 id 로 고정.
 */
export function aggregateUsageByVendor(
  entries: readonly UsageEntry[],
  index: VendorModelIndex,
): { vendors: VendorUsageRow[]; totals: UsageTotals } {
  const totals: UsageTotals = { ...ZERO };
  const byVendor = new Map<
    string,
    VendorUsageRow & { byModel: Map<string, ModelUsageRow> }
  >();

  for (const entry of entries) {
    const resolved = resolveModel(entry.model, index);
    let vendorRow = byVendor.get(resolved.vendor);
    if (!vendorRow) {
      vendorRow = {
        ...ZERO,
        vendor: resolved.vendor,
        label: resolved.vendorLabel,
        color: vendorColor(resolved.vendor),
        registered: false,
        models: [],
        byModel: new Map(),
      };
      byVendor.set(resolved.vendor, vendorRow);
    }
    // 카탈로그가 준 라벨이 하나라도 있으면 그것을 벤더 표시명으로 승격한다
    // (추정 행만 있는 벤더는 id 가 그대로 남아 UI 가 "미상" 처리할 수 있다).
    if (resolved.registered) {
      vendorRow.label = resolved.vendorLabel;
      vendorRow.registered = true;
    }

    const key = norm(entry.model);
    let modelRow = vendorRow.byModel.get(key);
    if (!modelRow) {
      modelRow = {
        ...ZERO,
        modelId: entry.model,
        label: resolved.modelLabel || entry.model,
        registered: resolved.registered,
        estimatedPricing: resolved.estimatedPricing,
      };
      vendorRow.byModel.set(key, modelRow);
    }

    addInto(totals, entry);
    addInto(vendorRow, entry);
    addInto(modelRow, entry);
  }

  const vendors = [...byVendor.values()]
    .map(({ byModel, ...row }) => ({
      ...row,
      models: [...byModel.values()].sort((a, b) => b.tokens - a.tokens),
    }))
    .sort((a, b) => b.tokens - a.tokens);

  return { vendors, totals };
}

// ─────────────────────────────────────────────────────────────────────────
// 에이전트명 ↔ 실제 실행 모델
// ─────────────────────────────────────────────────────────────────────────

/** 매핑에 필요한 에이전트 doc 필드만(컴포넌트 밖에서 테스트하려고 좁혔다). */
export interface AgentModelSource {
  id: string;
  name: string;
  /** 벤더가 아니라 **하네스**(스폰한 바이너리). */
  model: string;
  /** main 이 실제 argv 를 되읽어 스탬프한 값. effort 접미사(`@high`)가 붙는다. */
  spawnedModel?: string;
  /** cost-tracker 가 세션 메타데이터에서 읽은 실제 과금 모델 id. */
  detectedModelId?: string;
  totalCost?: number;
  costUpdatedAt?: Date | string;
}

/** 이 행의 모델 id 를 어디서 알아냈나 — UI 가 근거를 함께 보여준다. */
export type ModelIdSource = "detected" | "spawned" | "none";

export interface AgentModelRow {
  agentId: string;
  name: string;
  harness: string;
  /** 실제 실행 모델 id(원문). 근거가 없으면 null — 추측하지 않는다. */
  modelId: string | null;
  /** 표시용 모델명. modelId 가 null 이면 null. */
  modelLabel: string | null;
  source: ModelIdSource;
  vendor: string;
  vendorLabel: string;
  registered: boolean;
  color: string;
}

/** `claude-opus-5@high` → `claude-opus-5`. 레지스트리 조회용으로만 벗긴다. */
export function stripEffortSuffix(modelPin: string): string {
  const at = modelPin.indexOf("@");
  return at > 0 ? modelPin.slice(0, at) : modelPin;
}

/**
 * 에이전트명 ↔ 실제 실행 모델 매핑.
 *
 * 근거 우선순위:
 *   1. `detectedModelId` — cost-tracker 가 **과금된 세션**에서 읽은 값. 요청이
 *      아니라 결과라 가장 강한 근거다.
 *   2. `spawnedModel` — main 이 CLI 에 넘긴 argv 되읽기. 폴백/강등이 반영된
 *      "서빙된 값" 이지만 아직 과금 관측은 아니다.
 *   3. 없음 — 모델을 핀하지 않은 launch(오케 기본 경로)나 구 doc. **벤더만
 *      표시하고 모델은 비운다**(Agent 타입 주석의 graceful fallback 규약).
 */
export function mapAgentsToModels(
  agents: readonly AgentModelSource[],
  index: VendorModelIndex,
): AgentModelRow[] {
  return agents
    .map((agent) => {
      const detected = (agent.detectedModelId ?? "").trim();
      const spawned = (agent.spawnedModel ?? "").trim();
      const raw = detected || spawned;
      const source: ModelIdSource = detected
        ? "detected"
        : spawned
          ? "spawned"
          : "none";

      if (!raw) {
        // 모델 근거 없음 — 벤더는 하네스의 네이티브 벤더로 **추정하지 않는다**.
        // 하네스만 그대로 보여주고 벤더 칸은 미상으로 둔다.
        return {
          agentId: agent.id,
          name: agent.name,
          harness: agent.model || "",
          modelId: null,
          modelLabel: null,
          source,
          vendor: "unknown",
          vendorLabel: "unknown",
          registered: false,
          color: NEUTRAL_VENDOR_COLOR,
        };
      }

      const resolved = resolveModel(stripEffortSuffix(raw), index);
      return {
        agentId: agent.id,
        name: agent.name,
        harness: agent.model || resolved.harness,
        modelId: raw,
        modelLabel: resolved.modelLabel || raw,
        source,
        vendor: resolved.vendor,
        vendorLabel: resolved.vendorLabel,
        registered: resolved.registered,
        color: vendorColor(resolved.vendor),
      };
    })
    .sort((a, b) => {
      // 모델 근거가 있는 행 먼저 → 그 안에서 이름순(안정적 목록).
      const ar = a.modelId ? 1 : 0;
      const br = b.modelId ? 1 : 0;
      if (ar !== br) return br - ar;
      return a.name.localeCompare(b.name);
    });
}
