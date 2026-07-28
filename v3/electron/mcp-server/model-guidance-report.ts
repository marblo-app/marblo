/**
 * `get_model_guidance` 의 합류·서술 계층 — **정적 지식 × 동적 실적**.
 *
 * ── 이 파일이 답하는 질문 ────────────────────────────────────────────────
 * "이 티켓을 어느 모델 칸에 줄까" 를 오케가 근거로 답하려면 두 축이 같이 있어야
 * 한다. 하나는 우리 티켓과 무관하게 참인 사실(단가·컨텍스트·공개 벤치·티어),
 * 다른 하나는 우리 보드에서 실제로 일어난 일(성공률·비용당성공). 지금까지 앞의
 * 것은 화면에만, 뒤의 것은 `get_routing_effectiveness` 에만 있었다.
 *
 * ── ★수치를 만들지 않는다 ───────────────────────────────────────────────
 * 정적은 브리지가 넘긴 참조표 원문을 그대로 쓰고(가공·반올림 없음), 동적은
 * `routing-effectiveness.ts` 의 집계를 그대로 쓴다. 이 파일이 새로 계산하는 것은
 * **티어 파생**(`./model-tier.js`, 화면과 같은 순수 함수)과 **키 매칭**뿐이다.
 * 종합점수 같은 것도 만들지 않는다 — 서로 다른 벤치·얇은 표본을 한 숫자로 뭉개면
 * 그 숫자가 근거처럼 읽히기 때문이다. 판정은 오케가 한다.
 *
 * ── ★모양 계약을 구조적으로 받는 이유 ───────────────────────────────────
 * 정적 페이로드의 원산지는 `electron/model-guidance.ts` 인데, MCP tsconfig 의
 * `rootDir: "."` 때문에 그 타입을 import 할 수 없다(프로세스도 다르다). 그래서
 * 여기 구조적 타입을 두고, `tests/unit/model-guidance.test.ts` 가 **실제 페이로드가
 * 이 모양을 만족하는지** 를 양쪽 모듈을 다 import 해서 고정한다. 계약이 갈라지면
 * 런타임이 아니라 테스트가 먼저 깨진다.
 */

import {
  withModelTiers,
  type ModelCapability,
  type ModelTierFacts,
  type ModelTierVerdict,
} from "./model-tier.js";
import type { EffectivenessModelRollup } from "./routing-effectiveness.js";

/**
 * 벤치 레코드 — ★고정 필드를 최소로만 안다. 나머지 필드(출처가 표기한 벤치
 * 변형/버전 라벨 등)는 이름을 몰라도 그대로 실려 출력된다. 참조표에 필드가 늘 때
 * 이 파일을 고쳐야 한다면 그건 계약이 잘못 설계된 것이다.
 */
export interface GuidanceBenchRecord {
  benchmark: string;
  score: number | null;
  source: string;
  sourceKind: string;
  asOf: string;
  harness: { name: string; version?: string; config?: string };
  [extra: string]: unknown;
}

export interface GuidanceContext {
  tokens: number | null;
  maxOutputTokens?: number;
  source: string;
  asOf: string;
  note?: string;
}

export interface GuidanceStaticRow {
  modelId: string;
  label: string;
  vendor: string;
  vendorLabel: string;
  harness: string;
  capability: string;
  inputPer1M: number;
  outputPer1M: number;
  estimatedPricing: boolean;
  efforts: string[];
  defaultEffort: string | null;
  aliases: string[];
  context: GuidanceContext | null;
  benchRecords: GuidanceBenchRecord[];
  representativeIndex: number | null;
}

export interface GuidanceStaticPayload {
  payloadVersion: number;
  sources: Record<string, string>;
  models: GuidanceStaticRow[];
}

/** 한 모델에 붙은 동적 실적. 어떤 키에서 왔는지 반드시 같이 들고 다닌다. */
export interface GuidanceDynamic {
  /** 이 모델 id(또는 alias)로 직접 이어진 `model@effort` / 정확 id 칸들. */
  direct: EffectivenessModelRollup[];
  /**
   * 이 모델의 **하네스** 축으로만 이어진 칸들(구 dispatchMeta 의 `provider` 해상도).
   * 같은 하네스의 다른 모델과 공유되므로 모델별 판단 근거로 쓰면 안 된다 —
   * 그래서 direct 와 절대 합치지 않는다.
   */
  harnessLevel: EffectivenessModelRollup[];
}

export interface ModelGuidanceRow {
  static: GuidanceStaticRow;
  tier: ModelTierVerdict;
  dynamic: GuidanceDynamic;
}

const CAPABILITIES: readonly ModelCapability[] = [
  "cheap",
  "mid",
  "top",
  "frontier",
];

function asCapability(value: string): ModelCapability {
  return (CAPABILITIES as readonly string[]).includes(value)
    ? (value as ModelCapability)
    : // 모르는 등급은 지어내지 않고 중간으로 둔다. 티어 heuristic 은 mid 에서만
      // 승격을 시도하므로, 미지의 등급이 근거 없이 프리미어로 올라가지 않는다.
      "mid";
}

/** 티어 파생에 필요한 최소 재료로 좁힌다(대표벤치 = representativeIndex 행). */
function tierFacts(row: GuidanceStaticRow): ModelTierFacts {
  const rep =
    row.representativeIndex !== null
      ? (row.benchRecords[row.representativeIndex] ?? null)
      : null;
  return {
    capability: asCapability(row.capability),
    outputPer1M: row.outputPer1M,
    bench: rep ? { benchmark: rep.benchmark, score: rep.score } : null,
  };
}

/**
 * 동적 modelKey 가 이 정적 행의 것인가.
 *
 * 키 모양은 `routing-model-key.formatModelKey` 가 정한 `id` 또는 `id@effort`
 * (소문자). alias 도 본다 — 구 dispatchMeta 가 alias 를 그대로 적은 행이 있고,
 * alias→구체 id 정규화는 레지스트리가 이미 아는 사실이라 여기서 재발명하지 않고
 * 페이로드가 실어 온 목록을 쓴다.
 */
function matchesModel(modelKey: string, row: GuidanceStaticRow): boolean {
  const names = [row.modelId, ...row.aliases].map((n) => n.toLowerCase());
  return names.some((n) => n === modelKey || modelKey.startsWith(`${n}@`));
}

/**
 * 정적 행 × 동적 롤업 합류. 행 순서·집합은 정적 페이로드 그대로다(화면과 같은
 * 목록을 오케도 본다). 티어는 **전체 행**으로 파생한다 — 중앙값 기준이라
 * 부분집합으로 계산하면 필터를 걸 때마다 티어가 바뀐다.
 */
export function mergeModelGuidance(
  payload: GuidanceStaticPayload,
  rollups: readonly EffectivenessModelRollup[],
): ModelGuidanceRow[] {
  const rows = payload.models;
  const tiers = withModelTiers(rows.map(tierFacts));
  return rows.map((row, i) => {
    const harnessKey = row.harness.toLowerCase();
    const direct: EffectivenessModelRollup[] = [];
    const harnessLevel: EffectivenessModelRollup[] = [];
    for (const roll of rollups) {
      if (matchesModel(roll.modelKey, row)) direct.push(roll);
      else if (roll.resolution === "provider" && roll.modelKey === harnessKey) {
        harnessLevel.push(roll);
      }
    }
    const { tier, reason, valueRatio } = tiers[i];
    return {
      static: row,
      tier: { tier, reason, valueRatio },
      dynamic: { direct, harnessLevel },
    };
  });
}

// ── 서술 ────────────────────────────────────────────────────────────────

const TIER_LABEL: Readonly<Record<string, string>> = {
  premier: "프리미어",
  standard: "일반작업",
  value: "가성비",
};

function pct(value: number): string {
  return `${(value * 100).toFixed(0)}%`;
}

function usd(value: number): string {
  return `$${value.toFixed(4)}`;
}

/** 벤치 한 줄. ★알려진 필드만 찍고 끝내지 않는다 — 모르는 필드도 그대로 붙인다. */
const KNOWN_BENCH_FIELDS = new Set([
  "model",
  "kind",
  "benchmark",
  "score",
  "source",
  "sourceKind",
  "asOf",
  "harness",
  "note",
]);

function formatBenchRecord(rec: GuidanceBenchRecord): string {
  const score = rec.score === null ? "공식수치 없음" : `${rec.score}%`;
  const harness = rec.harness?.version
    ? `${rec.harness.name}@${rec.harness.version}`
    : (rec.harness?.name ?? "?");
  // 참조표에 나중에 늘어난 필드(벤치 변형 라벨 등)를 이름을 몰라도 실어 나른다.
  const extras = Object.keys(rec)
    .filter((k) => !KNOWN_BENCH_FIELDS.has(k))
    .sort()
    .map((k) => `${k}=${String(rec[k])}`)
    .join(", ");
  const note = typeof rec.note === "string" && rec.note ? ` — ${rec.note}` : "";
  return (
    `${rec.benchmark}: ${score} (하네스 ${harness}, ${rec.sourceKind}, ${rec.asOf})` +
    (extras ? ` [${extras}]` : "") +
    note
  );
}

function formatDynamic(dyn: GuidanceDynamic): string {
  if (dyn.direct.length === 0 && dyn.harnessLevel.length === 0) {
    return "우리 실적: 없음(이 모델로 끝난 티켓이 아직 없다 — 정적 사실로만 판단해야 한다)";
  }
  const line = (r: EffectivenessModelRollup, tag: string) =>
    `${tag} ${r.modelKey}: n=${r.n} 성공률 ${pct(r.successRate)}` +
    ` · 평균비용 ${r.avgCost === null ? "미측정" : usd(r.avgCost)}` +
    ` · 비용당성공 ${
      r.successPerDollar === null
        ? "미측정"
        : `${r.successPerDollar.toFixed(1)}/$`
    }` +
    ` · 비용커버리지 ${pct(r.costCoverage)}`;
  const parts = [
    ...dyn.direct.map((r) => line(r, "  ·")),
    ...dyn.harnessLevel.map(
      (r) => `${line(r, "  ○")} ※하네스 공통(모델별 근거 아님)`,
    ),
  ];
  return ["우리 실적:", ...parts].join("\n");
}

export interface GuidanceReportOptions {
  /** 동적 절반을 만든 스캔 범위(집계와 같은 말을 하게). */
  scanned: number;
  cap: number;
  /** 정적 절반을 못 받았을 때 그 사유. 있으면 리포트가 반쪽임을 먼저 말한다. */
  staticError?: string | null;
  /** 이 모델 id/alias 로 필터된 결과면 그 질의어. */
  filter?: string | null;
}

/**
 * 오케가 그대로 읽는 리포트.
 *
 * 서술 규율은 `formatEffectivenessReport` 와 같다 — **모르는 것을 모른다고 말하는
 * 게 절반이다**. 표만 주면 n=1 짜리 칸과 추정 단가가 결론처럼 읽힌다.
 */
export function formatModelGuidance(
  rows: readonly ModelGuidanceRow[],
  opts: GuidanceReportOptions,
): string {
  const lines: string[] = [];
  lines.push(
    "모델 선택 지식 — 정적(레지스트리·공개벤치·컨텍스트·티어) + 동적(우리 보드 실적).",
  );
  if (opts.staticError) {
    lines.push(
      `★정적 절반 없음: ${opts.staticError}. 아래는 동적 실적만이며, 단가·컨텍스트·벤치는 이 응답으로 판단하지 말 것.`,
    );
  }
  lines.push(
    `동적 스캔 ${opts.scanned}건` +
      (opts.cap && opts.scanned >= opts.cap
        ? ` (★상한 ${opts.cap} 에 걸렸다 — 더 오래된 티켓은 빠져 있다)`
        : ""),
  );
  if (opts.filter) lines.push(`필터: "${opts.filter}"`);
  if (rows.length === 0) {
    // ★사유를 두 번 말하지 않는다. 정적 절반을 못 받아서 행이 없는 것을
    // "모델 행이 없다"(=레지스트리가 비었다)로 다시 적으면 오케가 원인을
    // 잘못 짚는다 — 그 사유는 위 staticError 줄이 이미 말했다.
    if (!opts.staticError) {
      lines.push("");
      lines.push(
        opts.filter
          ? "일치하는 모델이 없다. 필터 없이 다시 부르면 전체 목록을 볼 수 있다."
          : "모델 행이 없다.",
      );
    }
    return lines.join("\n");
  }

  for (const row of rows) {
    const s = row.static;
    lines.push("");
    lines.push(
      `## ${s.label} (${s.modelId}) — ${TIER_LABEL[row.tier.tier] ?? row.tier.tier}` +
        ` · ${s.vendorLabel} · 하네스 ${s.harness} · 능력 ${s.capability}`,
    );
    lines.push(
      `단가: in ${usd(s.inputPer1M)}/1M · out ${usd(s.outputPer1M)}/1M` +
        (s.estimatedPricing ? " ★추정치(공식 단가 미확인)" : "") +
        (s.efforts.length
          ? ` · effort ${s.efforts.join("/")}${s.defaultEffort ? ` (기본 ${s.defaultEffort})` : ""}`
          : " · effort 축 없음"),
    );
    lines.push(
      s.context
        ? `컨텍스트: ${s.context.tokens === null ? "확인 필요" : `${s.context.tokens.toLocaleString("en-US")} tok`}` +
            (s.context.maxOutputTokens
              ? ` (max out ${s.context.maxOutputTokens.toLocaleString("en-US")})`
              : "") +
            ` — ${s.context.asOf}, ${s.context.source}`
        : "컨텍스트: 확인 필요(참조표에 짝 없음)",
    );
    if (s.benchRecords.length === 0) {
      lines.push(
        "공개 벤치: 참조표에 행 없음 — '성능이 준수하다' 는 근거가 없다.",
      );
    } else {
      lines.push("공개 벤치:");
      s.benchRecords.forEach((rec, i) => {
        const tag = i === s.representativeIndex ? "대표" : "대안";
        lines.push(`  [${tag}] ${formatBenchRecord(rec)}`);
      });
    }
    lines.push(formatDynamic(row.dynamic));
  }

  lines.push("");
  lines.push(
    "★읽는 법: (1) SWE-bench 는 문제집합이 다른 4종이고 스캐폴드가 다르면 같은 모델도 " +
      "6~13pt 움직인다 — 서로 다른 벤치/하네스 행의 점수를 견주지 말 것. " +
      "(2) 티어는 레지스트리 능력등급 + '같은 벤치 최고점 대비 ÷ output 단가' 의 묶음 " +
      "라벨이지 순위가 아니다. (3) 우리 실적의 n 이 작은 칸으로 우열을 판정하지 말 것. " +
      "(4) `○` 줄은 하네스 공통 실적이라 모델별 근거가 아니다. " +
      "(5) 단가에 ★추정치가 붙은 행은 비용 비교의 근거로 삼기 전에 확인이 필요하다. " +
      "칸별 (난도 × taskType) 세부는 get_routing_effectiveness 가 준다.",
  );
  return lines.join("\n");
}
