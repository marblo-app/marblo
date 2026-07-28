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
  benchVariantCoverage,
  harnessKey,
  variantLabelOf,
  BENCHMARK_IDS,
  BENCH_VARIANTS,
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

/**
 * ★한 **변형**에 대한 이 모델의 벤치 칸.
 *
 * 이 타입이 생긴 이유가 이 티켓의 전부다. 예전엔 행마다 `bench` 한 칸이었고,
 * 그 칸의 변형은 "이 모델이 어느 변형에 점수를 갖고 있느냐"로 정해졌다. 그래서
 * 열을 세로로 훑으면 Claude 칸은 Verified, GPT 칸은 Pro 가 나왔다 — 같은 열인데
 * 행마다 자가 달랐다는 뜻이다. 이제 변형이 **열의 속성**이고 행은 그 변형에
 * 답할 뿐이라, 답이 없으면 낮은 점수가 아니라 빈칸("확인 필요")이 된다.
 */
export interface ModelFactBenchCell {
  benchmark: BenchmarkId;
  /** 출처가 화면에 적은 변형 이름(표준과 다를 수 있다). */
  variantLabel: string;
  /** 대표 측정. **null 이면 이 변형에 이 모델의 행이 아예 없다**(= 안 찾아봤다). */
  primary: ModelFactBench | null;
  /**
   * **같은 변형**의 다른 측정. 하네스가 다를 수도(haiku: 벤더 73.3 vs 리더보드
   * 66.6), 하네스는 같은데 발표가 다를 수도 있다(gpt-5.5 를 OpenAI 가 두 번).
   */
  alternates: ModelFactBench[];
}

/** 표/차트가 고를 수 있는 변형 하나. 커버리지가 붙어 있어 기본값을 파생할 수 있다. */
export interface ModelFactVariant {
  benchmark: BenchmarkId;
  label: string;
  short: string;
  blurb: string;
  /** 이 표의 활성 모델 중 이 변형에 **점수가 있는** 수. */
  scoredModels: number;
  /** 이 표의 활성 모델 수(분모). */
  totalModels: number;
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
  /**
   * ★**변형별** 벤치 칸. 네 변형이 모두 키로 있고, 행이 없는 변형은
   * `primary: null` 이다.
   *
   * 왜 한 칸이 아니라 맵인가: 화면이 변형을 바꿔도 IPC 를 다시 돌지 않게 하려는
   * 것도 있지만, 더 중요한 건 **한 칸으로는 이 티켓의 버그를 다시 못 만들게 할
   * 방법이 없다**는 것이다. 칸이 하나면 누군가는 또 "비었으니 다른 변형으로
   * 채우자" 는 fallback 을 넣게 된다. 키가 변형이면 그 fallback 을 쓰려면 키를
   * 바꿔야 하고, 키를 바꾸는 코드는 리뷰에서 눈에 띈다.
   */
  benchByVariant: Record<BenchmarkId, ModelFactBenchCell>;
}

/** IPC 응답 전체. 행 + "고를 수 있는 변형" 을 같이 내린다. */
export interface ModelFactSheetPayload {
  rows: ModelFactRow[];
  /** 커버리지 내림차순. **[0] 이 기본 축**이고, 그 판정은 데이터에서 파생된다. */
  variants: ModelFactVariant[];
  /** `variants[0].benchmark`. 화면이 같은 계산을 반복하지 않게 명시한다. */
  defaultBenchmark: BenchmarkId;
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
 * 이 모델의 대표 벤치 + 같은 벤치의 대안들 — **BenchRecord 원형 그대로**.
 *
 * `pickBench` 와 갈라 둔 이유: 화면은 좁힌 `ModelFactBench` 를 원하지만, 오케에게
 * 내려가는 통합 지식(`model-guidance.ts`)은 참조표 레코드를 **필드 손실 없이**
 * 그대로 날라야 한다. 두 소비자가 각자 대표 선정 규칙을 다시 구현하면 화면과
 * 오케가 서로 다른 행을 "대표" 라 부르게 되므로, 정책은 이 함수 하나뿐이다.
 *
 * ★이 함수(headline 단일대표)는 벤치 간 fallback 을 한다(BENCHMARK_PREFERENCE).
 * 표/차트의 칸(`benchCellFor`)은 그 반대로 **변형 안에서만** 고른다 — 아래 참고.
 */
export function pickBenchRecords(modelId: string): {
  representative: BenchRecord | null;
  alternates: BenchRecord[];
} {
  const rows = benchRowsForModel(modelId);
  if (rows.length === 0) return { representative: null, alternates: [] };

  for (const benchmark of BENCHMARK_PREFERENCE) {
    const scored = rows.filter(
      (r) => r.benchmark === benchmark && r.score !== null
    );
    if (scored.length === 0) continue;
    const vendorFirst =
      scored.find((r) => r.sourceKind === "model-vendor") ?? scored[0];
    return {
      representative: vendorFirst,
      alternates: scored.filter((r) => r !== vendorFirst),
    };
  }

  for (const benchmark of BENCHMARK_PREFERENCE) {
    const empty = rows.find((r) => r.benchmark === benchmark);
    if (empty) return { representative: empty, alternates: [] };
  }
  return { representative: null, alternates: [] };
}

/** 화면용 좁힌 모양. 선정 정책은 `pickBenchRecords` 한 곳뿐이다. */
function pickBench(modelId: string): {
  bench: ModelFactBench | null;
  alternates: ModelFactBench[];
} {
  const { representative, alternates } = pickBenchRecords(modelId);
  return {
    bench: representative ? toFactBench(representative) : null,
    alternates: alternates.map(toFactBench),
  };
}

/**
 * **한 변형 안에서** 이 모델의 대표 측정 + 같은 변형의 다른 측정들.
 *
 * ★다른 변형으로 넘어가는 fallback 이 **없다**. 이 모델이 이 변형에 점수가
 * 없으면 칸은 빈다 — 그게 사실이기 때문이다. 예전 구현은 여기서 Verified →
 * Pro 로 내려갔고, 그 한 줄이 열의 자를 행마다 바꿔 96 vs 64.6 오독을 만들었다.
 *
 * 고르는 규칙(변형 안에서만):
 *   1. 점수가 있는 행 중 **벤더 자기보고**를 대표로. 리더보드(제3자 채점)가 더
 *      강한 증거이긴 하나, 표의 다른 모델은 대부분 벤더 수치라 한 칸만 리더보드로
 *      바꾸면 열이 서로 다른 성격의 숫자로 섞인다. 그 리더보드 행은 `alternates`
 *      로 같이 내려가 "같은 변형인데 스캐폴드가 다르면 이만큼" 을 보인다.
 *   2. 점수 있는 행이 없으면 **빈 칸 행**을 대표로 — note("no official number: …")
 *      가 왜 비었는지를 화면에 나른다.
 *   3. 행 자체가 없으면 null(= 아직 안 찾아봤다. 2 와 다르다).
 */
export function benchCellFor(
  modelId: string,
  benchmark: BenchmarkId
): ModelFactBenchCell {
  const empty: ModelFactBenchCell = {
    benchmark,
    variantLabel: BENCH_VARIANTS[benchmark].label,
    primary: null,
    alternates: [],
  };

  const rows = benchRowsForModel(modelId).filter(
    (r) => r.benchmark === benchmark
  );
  if (rows.length === 0) return empty;

  const scored = rows.filter((r) => r.score !== null);
  if (scored.length === 0) {
    return { ...empty, primary: toFactBench(rows[0]) };
  }

  const vendorFirst =
    scored.find((r) => r.sourceKind === "model-vendor") ?? scored[0];
  return {
    benchmark,
    // 라벨은 **대표 행의 출처 표기**를 따른다 — 그 칸의 숫자를 리뷰어가 대조할
    // 화면에 실제로 적혀 있는 문자열이어야 대조가 한 번에 끝난다.
    variantLabel: variantLabelOf(vendorFirst),
    primary: toFactBench(vendorFirst),
    alternates: scored.filter((r) => r !== vendorFirst).map(toFactBench),
  };
}

/** 네 변형 전부에 대해 칸을 만든다(없는 변형은 빈 칸). */
function benchCellsFor(
  modelId: string
): Record<BenchmarkId, ModelFactBenchCell> {
  return Object.fromEntries(
    BENCHMARK_IDS.map((id) => [id, benchCellFor(modelId, id)])
  ) as Record<BenchmarkId, ModelFactBenchCell>;
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
      benchByVariant: benchCellsFor(entry.id),
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

/**
 * IPC 가 실제로 내리는 것. 행 + **고를 수 있는 변형 목록**.
 *
 * ── ★기본 축을 상수로 박지 않는 이유 ────────────────────────────────────
 * "기본은 Pro" 라고 적고 싶은 유혹이 있다. 지금은 그게 맞기 때문이다(Pro 12 모델
 * vs Verified 7). 하지만 그 사실은 **벤더가 무엇을 보고하기로 했는가**의 함수이고,
 * 우리는 거기에 아무 통제권이 없다 — 이 파일이 최근 이틀 사이에 본 것만 해도
 * Z.ai 는 4.7(Verified)에서 5.2(Pro)로 갈아탔고, Moonshot 은 K2.6(Verified 80.2)
 * 에서 K3(SWE-bench 아예 없음)로 갈아탔다. 상수를 박으면 다음 갈아타기 때 표가
 * "대부분 확인 필요" 인 축을 기본으로 들고 있게 되고, 아무도 그걸 눈치채지 못한다.
 *
 * 그래서 매번 센다: 지금 이 표의 활성 모델 중 **가장 많은 수를 같은 자로 잴 수
 * 있는 변형**이 기본이다.
 */
export function modelFactSheetPayload(): ModelFactSheetPayload {
  const rows = modelFactSheet();
  const modelIds = rows.map((r) => r.modelId);
  const totalModels = rows.length;

  const variants: ModelFactVariant[] = benchVariantCoverage({
    models: modelIds,
  }).map((c) => ({
    benchmark: c.variant.id,
    label: c.variant.label,
    short: c.variant.short,
    blurb: c.variant.blurb,
    scoredModels: c.scoredModels,
    totalModels,
  }));

  // ★점수가 한 모델도 없는 변형은 고를 수 없게 뺀다 — 고르면 표 전체가 "확인
  // 필요" 로 비어 화면이 고장처럼 읽힌다(빈 티어 묶음을 안 내리는 것과 같은 규율).
  // 전부 0 이면(참조표가 통째로 비는 상황) 빼지 않는다 — 그때는 빈 목록보다
  // "고를 건 있는데 값이 없다" 가 정확한 표현이다.
  const selectable = variants.filter((v) => v.scoredModels > 0);
  const usable = selectable.length > 0 ? selectable : variants;

  return { rows, variants: usable, defaultBenchmark: usable[0].benchmark };
}
