/**
 * 모델 **정보표**(단가 · 개략 성능 · 컨텍스트) — 사용량 탭 상단 접이식 표의 재료.
 *
 * ── 왜 이 모듈이 있나 ────────────────────────────────────────────────────
 * 렌더러(`src/`)는 `electron/model-registry.ts` 를 import 할 수 없다(경계 규약,
 * `src/lib/rootPathScope.ts`). 그래서 화면에 모델 사실을 그리려면 누군가 IPC 로
 * 내려줘야 하는데, 그 "누군가" 를 `main.ts` 안에 인라인으로 쓰면 세 참조표를
 * 조인하는 로직이 IPC 핸들러에 묻혀 테스트가 안 된다. 조인만 여기서 하고
 * `main.ts` 는 한 줄로 부른다.
 *
 * ── 단일소스 규율 ────────────────────────────────────────────────────────
 * 이 모듈은 **아무 사실도 새로 만들지 않는다.** 세 참조표를 모델 id 로 조인만
 * 한다:
 *   · `model-registry.ts`         — 단가(`pricing`), 능력등급, 벤더/하네스
 *   · `model-context-reference.ts` — 컨텍스트 창(출처 URL + 관측일)
 *   · `model-bench-reference.ts`   — SWE-bench 계열 공개 점수(출처 + 하네스)
 *
 * 그래서 레지스트리에 행이 하나 늘면 표에 **자동으로** 한 줄이 는다. 컨텍스트·
 * 벤치 참조표에 짝이 없으면 그 칸만 비고(`null`), 화면이 "확인 필요" 로 그린다 —
 * 없는 숫자를 지어내지 않는다.
 *
 * ── ★"개략" 인 이유(화면이 반드시 같이 말해야 하는 것) ──────────────────
 * SWE-bench 는 **하나의 벤치가 아니고**(Verified/Pro/Multilingual/Multimodal),
 * 같은 벤치·같은 모델이어도 스캐폴드가 다르면 점수가 6~13pt 움직인다
 * (`model-bench-reference.ts` 상단의 실측 예). 그래서 이 표의 점수는 모델 간
 * 순위가 아니라 **자릿수 감각**이고, 각 행이 벤치 이름·하네스·출처·일자를
 * 그대로 들고 다닌다. 조인 단계에서 서로 다른 벤치를 한 숫자로 뭉개지 않는다.
 */

import {
  MODEL_REGISTRY,
  type CapabilityTier,
  type HarnessId,
  type VendorId,
} from "./model-registry";
import {
  benchRowsForModel,
  harnessKey,
  type BenchRecord,
  type BenchmarkId,
} from "./model-bench-reference";
import { contextRecordFor } from "./model-context-reference";
import { humanizeClaudeModelId, VENDOR_LABEL } from "./model-selection";

/** 표의 벤치 칸 하나(출처를 떼지 않는다). */
export interface ModelFactBench {
  benchmark: BenchmarkId;
  /** % resolved. **null 이면 "공식 수치 없음"** 이고 `note` 가 이유를 말한다. */
  score: number | null;
  /** 점수를 낸 스캐폴드(`name@version`). 이게 다르면 다른 실험이다. */
  harness: string;
  source: string;
  sourceKind: BenchRecord["sourceKind"];
  asOf: string;
  note?: string;
}

/** 표의 컨텍스트 칸(출처를 떼지 않는다). */
export interface ModelFactContext {
  tokens: number | null;
  maxOutputTokens?: number;
  source: string;
  asOf: string;
  note?: string;
}

/** 표의 한 줄 = 레지스트리 한 행. */
export interface ModelFactRow {
  modelId: string;
  /** 사람이 읽는 이름(claude 계열만 접고 나머지는 실명 그대로 — 오전달 방지). */
  label: string;
  vendor: VendorId;
  vendorLabel: string;
  harness: HarnessId;
  capability: CapabilityTier;
  /** $/1M. `estimated` 면 화면이 "추정" 배지를 단다. */
  inputPer1M: number;
  outputPer1M: number;
  estimatedPricing: boolean;
  /** 참조표에 짝이 없으면 null(화면은 "확인 필요"). */
  context: ModelFactContext | null;
  /** 대표 벤치 한 칸. 참조표에 행이 아예 없으면 null. */
  bench: ModelFactBench | null;
  /**
   * **같은 벤치**의 다른 하네스 점수들. 비어 있지 않다는 것 자체가
   * "이 모델은 스캐폴드에 따라 점수가 다르다" 는 경고다(haiku 4.5: 73.3 vs 66.6).
   */
  benchAlternates: ModelFactBench[];
}

/**
 * 대표 벤치를 고르는 순서. Verified 가 가장 널리 인용되므로 먼저 보고,
 * 없으면 Pro → Multilingual → Multimodal 로 내려간다. ★서로 다른 벤치를 한
 * 열에서 비교하지 않도록 각 행이 자기 벤치 이름을 들고 다닌다.
 */
const BENCHMARK_PREFERENCE: readonly BenchmarkId[] = [
  "swe-bench-verified",
  "swe-bench-pro",
  "swe-bench-multilingual",
  "swe-bench-multimodal",
] as const;

function toFactBench(rec: BenchRecord): ModelFactBench {
  return {
    benchmark: rec.benchmark,
    score: rec.score,
    harness: harnessKey(rec.harness),
    source: rec.source,
    sourceKind: rec.sourceKind,
    asOf: rec.asOf,
    ...(rec.note ? { note: rec.note } : {}),
  };
}

/**
 * 이 모델의 대표 벤치 + 같은 벤치의 대안들.
 *
 * 고르는 규칙:
 *   1. 선호 순서대로 훑어 **점수가 있는** 벤치를 먼저 잡는다.
 *   2. 같은 벤치에 행이 여럿이면 **벤더 자기보고**를 대표로 둔다. 리더보드
 *      (제3자 채점)가 더 강한 증거이긴 하나, 우리 표의 다른 모델은 전부 벤더
 *      수치라 한 칸만 리더보드로 바꾸면 열이 서로 다른 성격의 숫자로 섞인다.
 *      대신 그 리더보드 행을 `benchAlternates` 로 **같이** 내려보내 화면이
 *      "같은 모델·같은 벤치인데 하네스가 다르면 이만큼 차이" 를 보이게 한다.
 *   3. 점수 있는 벤치가 하나도 없으면, 선호 순서 첫 **빈 칸** 행을 대표로 둔다 —
 *      그 행의 note("no official number: …")가 왜 비었는지를 화면에 나른다.
 */
function pickBench(modelId: string): {
  bench: ModelFactBench | null;
  alternates: ModelFactBench[];
} {
  const rows = benchRowsForModel(modelId);
  if (rows.length === 0) return { bench: null, alternates: [] };

  for (const benchmark of BENCHMARK_PREFERENCE) {
    const scored = rows.filter(
      (r) => r.benchmark === benchmark && r.score !== null,
    );
    if (scored.length === 0) continue;
    const vendorFirst =
      scored.find((r) => r.sourceKind === "model-vendor") ?? scored[0];
    return {
      bench: toFactBench(vendorFirst),
      alternates: scored.filter((r) => r !== vendorFirst).map(toFactBench),
    };
  }

  for (const benchmark of BENCHMARK_PREFERENCE) {
    const empty = rows.find((r) => r.benchmark === benchmark);
    if (empty) return { bench: toFactBench(empty), alternates: [] };
  }
  return { bench: null, alternates: [] };
}

const CAPABILITY_ORDER: Readonly<Record<CapabilityTier, number>> = {
  frontier: 0,
  top: 1,
  mid: 2,
  cheap: 3,
};

/**
 * 활성 레지스트리 모델 전체의 정보표. 정렬은 **벤더 묶음 → 능력등급 높은 순**
 * 으로, 퀵레인 셀렉터(`quickLaneVendorCatalog`)와 같은 감각을 유지한다.
 *
 * `status: "deprecated"` 행은 뺀다 — 신규 라우팅 후보가 아니고, 표의 목적이
 * "지금 고를 수 있는 칸이 무엇인가" 이기 때문이다.
 */
export function modelFactSheet(): ModelFactRow[] {
  const rows: ModelFactRow[] = [];
  for (const entry of MODEL_REGISTRY) {
    if (entry.status !== "active") continue;
    const { bench, alternates } = pickBench(entry.id);
    const context = contextRecordFor(entry.id);
    rows.push({
      modelId: entry.id,
      label:
        entry.harness === "claude" && entry.provider === "anthropic"
          ? humanizeClaudeModelId(entry.id)
          : entry.id,
      vendor: entry.provider,
      vendorLabel: VENDOR_LABEL[entry.provider],
      harness: entry.harness,
      capability: entry.capability,
      inputPer1M: entry.pricing.inputPer1M,
      outputPer1M: entry.pricing.outputPer1M,
      estimatedPricing: Boolean(entry.pricing.estimated),
      context: context
        ? {
            tokens: context.tokens,
            ...(context.maxOutputTokens !== undefined
              ? { maxOutputTokens: context.maxOutputTokens }
              : {}),
            source: context.source,
            asOf: context.asOf,
            ...(context.note ? { note: context.note } : {}),
          }
        : null,
      bench,
      benchAlternates: alternates,
    });
  }

  // 벤더 그룹은 레지스트리 등장 순서를 따른다(= 네이티브 벤더가 앞). 그 안에서
  // 능력등급 높은 순. sort 는 안정정렬이므로 그룹 순서가 흐트러지지 않는다.
  const vendorOrder = new Map<VendorId, number>();
  for (const row of rows) {
    if (!vendorOrder.has(row.vendor))
      vendorOrder.set(row.vendor, vendorOrder.size);
  }
  return rows.sort((a, b) => {
    const va = vendorOrder.get(a.vendor) ?? 0;
    const vb = vendorOrder.get(b.vendor) ?? 0;
    if (va !== vb) return va - vb;
    return CAPABILITY_ORDER[a.capability] - CAPABILITY_ORDER[b.capability];
  });
}
