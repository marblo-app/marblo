/**
 * 오케가 모델을 고르기 전에 보는 **정적 모델 지식** 페이로드.
 *
 * ── 무엇을 푸는가 ────────────────────────────────────────────────────────
 * 지금 오케는 모델을 고를 때 참조할 게 두 개인데 둘 다 반쪽이다:
 *   · `get_routing_effectiveness` — **동적**만 안다(우리 티켓에서 실제로 뭐가
 *     성공했나). 콜드면 아무 말도 못 한다.
 *   · 정보표(사용량 탭) — **정적**을 아는데 **화면**에만 있다. 오케는 못 읽는다.
 * 그래서 오케는 사실상 기억과 감으로 골랐다. 이 모듈은 정적 절반을 프로세스
 * 경계 밖으로 꺼내 주고, 동적 절반과의 합류는 MCP 쪽(`mcp-server/
 * model-guidance-report.ts`)이 한다.
 *
 * ── ★단일소스 규율: 여기서 새로 만드는 사실은 0개다 ─────────────────────
 * 전부 기존 참조표의 **재사용**이다. 숫자를 옮겨 적지 않는다:
 *   · 단가·능력등급·벤더/하네스·alias  ← `model-registry.ts`
 *   · 컨텍스트 창                      ← `model-context-reference.ts`
 *   · SWE-bench 계열 점수              ← `model-bench-reference.ts`
 *   · 위 셋의 조인 + 대표벤치 선정      ← `model-fact-sheet.ts` (화면과 같은 함수)
 * 티어(`mcp-server/model-tier.ts`)는 여기서 계산하지 **않는다** — 화면이 IPC 로
 * 받은 행에서 파생하듯, 오케 쪽도 이 페이로드를 받아 같은 순수 함수로 파생한다.
 * 그래야 파생 지점이 하나 늘어도 판정이 갈라지지 않는다.
 *
 * ── ★벤치는 레코드를 통째로 싣는다(필드 하드코딩 금지) ──────────────────
 * `benchRecords` 는 `BenchRecord` 를 **가공 없이** 그대로 담는다. 참조표에 필드가
 * 하나 늘면(예: 진행중인 SWE 변형 라벨 작업) 이 모듈을 고치지 않아도 오케에게
 * 자동으로 전달된다. 여기서 필드를 골라 담는 순간 그 자동성이 죽고, 새 필드는
 * 아무도 모르게 유실된다. 화면용으로 좁힌 모양(`ModelFactBench`)을 쓰지 않는
 * 이유가 바로 이것이다.
 *
 * ── 왜 브리지로 내보내나 ─────────────────────────────────────────────────
 * MCP 서버 프로세스는 `electron/mcp-server/tsconfig.json` 의 `rootDir: "."` 때문에
 * `../model-registry` 를 import 할 수 없다. 메인 프로세스만 이 참조표들을 볼 수
 * 있으므로, 기존 `GET /agents` 선례대로 브리지가 이 페이로드를 넘긴다.
 */

import { MODEL_REGISTRY, type ModelRegistryEntry } from "./model-registry";
import { modelFactSheet, pickBenchRecords } from "./model-fact-sheet";
import { benchRowsForModel, type BenchRecord } from "./model-bench-reference";
import type { ModelFactContext, ModelFactRow } from "./model-fact-sheet";

/** 이 페이로드의 계약 버전. 소비자(MCP)가 모양 불일치를 조용히 넘기지 않게. */
export const MODEL_GUIDANCE_PAYLOAD_VERSION = 1;

export interface ModelGuidanceStaticRow {
  modelId: string;
  label: string;
  vendor: string;
  vendorLabel: string;
  /** 스폰할 바이너리(벤더 아님). 동적 집계의 `해상도=provider` 칸이 이 축이다. */
  harness: string;
  capability: string;
  inputPer1M: number;
  outputPer1M: number;
  /** true = 공식 단가 미확인 보수적 추정치. 판단에 반드시 같이 읽혀야 한다. */
  estimatedPricing: boolean;
  /** 지원 effort(빈 배열 = effort 축 없음). 동적 키 `model@effort` 와 짝이다. */
  efforts: string[];
  defaultEffort: string | null;
  /** CLI alias — 동적 modelKey 가 alias 로 적힌 옛 행과도 이어붙일 수 있게. */
  aliases: string[];
  context: ModelFactContext | null;
  /**
   * ★이 모델의 참조표 레코드 **전부**, 원형 그대로. 화면(정보표)은 자리가 없어
   * 대표 벤치 한 줄로 좁히지만 오케에겐 그럴 이유가 없다 — Verified 만 보고
   * Pro/Multilingual 이 있다는 걸 모르면 그게 곧 오판이다.
   */
  benchRecords: BenchRecord[];
  /**
   * `benchRecords` 안에서 **화면이 대표로 고른 그 행**의 색인. 티어 파생이 이
   * 행을 쓰므로, 여기가 화면과 어긋나면 티어도 어긋난다. 참조표에 행이 없거나
   * 대표를 못 고르면 null — 같은 숫자를 두 번 싣지 않으려고 복사가 아니라 색인이다.
   */
  representativeIndex: number | null;
}

export interface ModelGuidanceStatic {
  payloadVersion: number;
  /** 사실의 출처를 페이로드가 스스로 들고 다닌다(오케가 원문을 찾아갈 수 있게). */
  sources: {
    pricing: string;
    capability: string;
    bench: string;
    context: string;
    tier: string;
    dynamic: string;
  };
  models: ModelGuidanceStaticRow[];
}

/**
 * 활성 레지스트리 행 전체의 정적 지식. 행 순서·집합은 정보표와 **같다**
 * (`modelFactSheet()` 가 정하는 벤더 묶음 → 능력등급 순, deprecated 제외).
 * 화면과 오케가 다른 모델 목록을 보면 그 자체가 사고다.
 */
export function modelGuidanceStatic(): ModelGuidanceStatic {
  const byId = new Map<string, ModelRegistryEntry>();
  for (const entry of MODEL_REGISTRY) byId.set(entry.id, entry);

  const models = modelFactSheet().map((row: ModelFactRow) => {
    const entry = byId.get(row.modelId);
    // 참조표 순서 그대로 전부 싣고, 대표는 색인으로만 가리킨다. 재정렬하면
    // "왜 이 순서인가" 라는 두 번째 정책이 생기고, 참조표가 바뀔 때 갈라진다.
    const benchRecords = benchRowsForModel(row.modelId);
    const { representative } = pickBenchRecords(row.modelId);
    const representativeIndex = representative
      ? benchRecords.indexOf(representative)
      : -1;
    return {
      modelId: row.modelId,
      label: row.label,
      vendor: row.vendor,
      vendorLabel: row.vendorLabel,
      harness: row.harness,
      capability: row.capability,
      inputPer1M: row.inputPer1M,
      outputPer1M: row.outputPer1M,
      estimatedPricing: row.estimatedPricing,
      efforts: entry ? [...entry.efforts] : [],
      defaultEffort: entry?.defaultEffort ?? null,
      aliases: entry ? [...entry.aliases] : [],
      context: row.context,
      benchRecords,
      representativeIndex:
        representativeIndex >= 0 ? representativeIndex : null,
    } satisfies ModelGuidanceStaticRow;
  });

  return {
    payloadVersion: MODEL_GUIDANCE_PAYLOAD_VERSION,
    sources: {
      pricing: "electron/model-registry.ts",
      capability: "electron/model-registry.ts",
      bench: "electron/model-bench-reference.ts",
      context: "electron/model-context-reference.ts",
      tier: "electron/mcp-server/model-tier.ts",
      dynamic: "electron/mcp-server/routing-effectiveness.ts",
    },
    models,
  };
}
