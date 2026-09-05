// SWE-bench 참조표(model-bench-reference.ts)의 규율을 못박는다.
//
// 이 파일이 지키는 것 4가지:
//   1. **레지스트리 교차검증** — kind:"registry" 행의 model 은 레지스트리에 있는
//      구체 id 여야 하고, 없는 id/alias 는 거부된다.
//   2. **출처 URL 필수** — score 가 있든 null 이든 모든 행에 http(s) URL 이 있다.
//   3. **빈 칸이 침묵하지 않는다** — 공식 수치가 없는 칸은 행을 지우는 게 아니라
//      score:null + "no official number" 로 남아 있다.
//   4. **★학습 그래프 미주입** — routing-graph / routing-effectiveness 등 라우팅
//      코드가 이 모듈을 import 하지 않는다(소스 스캔으로 강제).
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  BENCHMARK_IDS,
  BENCH_REFERENCE,
  BENCH_VARIANTS,
  benchVariantCoverage,
  variantFamilyOf,
  benchRowsFor,
  benchRowsForModel,
  comparableRows,
  formatBenchTable,
  harnessKey,
  missingCells,
  validateBenchRecords,
  type BenchRecord,
} from "../../electron/model-bench-reference";
import { MODEL_REGISTRY, isKnownModelId } from "../../electron/model-registry";

const ELECTRON_DIR = join(__dirname, "..", "..", "electron");

describe("model-bench-reference / 스키마 규율", () => {
  it("모든 행에 출처가 있다 (leaderboard 외에는 URL)", () => {
    expect(BENCH_REFERENCE.length).toBeGreaterThan(0);
    for (const r of BENCH_REFERENCE) {
      if (r.sourceKind === "leaderboard") {
        expect(r.source, `${r.model}/${r.benchmark}`).toBe(
          "BenchLM (benchlm.ai/benchmarks/swePro)",
        );
        continue;
      }
      expect(r.source, `${r.model}/${r.benchmark}`).toMatch(/^https?:\/\/\S+$/);
    }
  });

  it("점수는 % 범위(0..100) 안이거나 명시적 null 이다", () => {
    for (const r of BENCH_REFERENCE) {
      if (r.score === null) continue;
      expect(r.score, `${r.model}/${r.benchmark}`).toBeGreaterThanOrEqual(0);
      expect(r.score, `${r.model}/${r.benchmark}`).toBeLessThanOrEqual(100);
    }
  });

  it("asOf 는 ISO 날짜, benchmark 는 알려진 값", () => {
    for (const r of BENCH_REFERENCE) {
      expect(r.asOf).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(BENCHMARK_IDS).toContain(r.benchmark);
      expect(r.version.trim().length).toBeGreaterThan(0);
      expect(r.harness.name.trim().length).toBeGreaterThan(0);
    }
  });

  it("같은 (model,benchmark,version,harness,source) 행이 중복되지 않는다", () => {
    const keys = BENCH_REFERENCE.map((r) =>
      [r.model, r.benchmark, r.version, harnessKey(r.harness), r.source].join(
        "|",
      ),
    );
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("model-bench-reference / 레지스트리 교차검증", () => {
  it('kind:"registry" 행의 model 은 모두 레지스트리의 **구체 id** 다', () => {
    const rows = BENCH_REFERENCE.filter((r) => r.kind === "registry");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(
        isKnownModelId(r.model),
        `${r.model} 은 레지스트리 구체 id 가 아님`,
      ).toBe(true);
    }
  });

  it('kind:"reference" 행은 레지스트리에 없는 후보만이다(잘못 분류 방지)', () => {
    const rows = BENCH_REFERENCE.filter((r) => r.kind === "reference");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(isKnownModelId(r.model), `${r.model} 은 레지스트리에 있다`).toBe(
        false,
      );
    }
  });

  it("티켓이 지정한 대상 모델이 전부 표에 있다(수치가 없으면 빈 칸으로라도)", () => {
    const targets = [
      "claude-opus-5",
      "claude-opus-4-8",
      "claude-sonnet-5",
      "claude-haiku-4-5-20251001",
      "claude-fable-5",
      "gpt-5.5",
      "gpt-5.6-sol",
      "gpt-5.6-terra",
      "gpt-5.6-luna",
      // ★env-swap / 네이티브 벤더(자동선택 후보 풀). 수치가 없으면 score:null 행으로라도
      // 남겨야 "안 찾아봤다"와 "찾았는데 없다"가 갈린다 — MiniMax-M3 누락 회귀 가드.
      "MiniMax-M3",
      "MiniMax-M2.7",
      "glm-5.2",
      "glm-4.7",
      "k3",
      "k3-256k",
      "kimi-for-coding",
      "grok-4.5",
    ];
    for (const id of targets) {
      const rows = benchRowsForModel(id);
      expect(rows.length, `${id} 에 대한 참조 행이 없다`).toBeGreaterThan(0);
      // 대상 모델은 전부 레지스트리에 실재해야 한다(오타 가드).
      expect(MODEL_REGISTRY.some((m) => m.id === id)).toBe(true);
    }
  });

  it("★MiniMax-M3 은 SWE-bench Verified 1차 출처 점수를 갖는다(자동선택 bench 축)", () => {
    const verified = benchRowsForModel("MiniMax-M3").filter(
      (r) => r.benchmark === "swe-bench-verified" && r.score !== null,
    );
    expect(verified.length).toBeGreaterThan(0);
    expect(verified[0].score).toBe(80.5);
    expect(verified[0].source).toMatch(
      /huggingface\.co\/MiniMaxAI\/MiniMax-M3/,
    );
    expect(verified[0].sourceKind).toBe("model-vendor");
  });

  it("표 안에 레지스트리 밖 registry 행이 하나도 없다", () => {
    const invalid = BENCH_REFERENCE.filter(
      (r) => r.kind === "registry" && !isKnownModelId(r.model),
    );
    expect(invalid).toEqual([]);
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★핵심 회귀 가드 — "지금 데이터가 깨끗하다" 가 아니라 "더러운 행이 들어오면
// 죽는다" 를 증명한다. 위조 행을 실제로 검증기에 먹여서 확인한다.
// ─────────────────────────────────────────────────────────────────────────

describe("model-bench-reference / 검증기는 잘못된 행을 거부한다", () => {
  const ok: BenchRecord = {
    model: "claude-sonnet-5",
    kind: "registry",
    benchmark: "swe-bench-verified",
    version: "unspecified",
    harness: { name: "test-harness" },
    score: 85.2,
    source: "https://example.test/card",
    sourceKind: "model-vendor",
    asOf: "2026-06-30",
  };

  it("베이스라인 행은 통과한다(가드가 무조건 throw 하는 게 아님을 먼저 못박는다)", () => {
    expect(() => validateBenchRecords([ok])).not.toThrow();
  });

  it("레지스트리에 없는 model id 를 registry 행으로 쓰면 거부한다", () => {
    expect(isKnownModelId("claude-opus-9999")).toBe(false);
    expect(() =>
      validateBenchRecords([{ ...ok, model: "claude-opus-9999" }]),
    ).toThrow(/레지스트리에 없는 모델 id/);
  });

  it("alias 를 model 로 쓰면 거부한다(이동표적 금지)", () => {
    // "sonnet" 은 레지스트리가 아는 alias 지만 구체 id 가 아니다.
    expect(() => validateBenchRecords([{ ...ok, model: "sonnet" }])).toThrow(
      /alias/,
    );
  });

  it('레지스트리에 있는 모델을 kind:"reference" 로 잘못 분류하면 거부한다', () => {
    expect(() => validateBenchRecords([{ ...ok, kind: "reference" }])).toThrow(
      /kind: "reference" 로 적혀 있습니다/,
    );
  });

  it("source 가 없거나 URL 이 아니면 거부한다 (score=null 행도 마찬가지)", () => {
    expect(() => validateBenchRecords([{ ...ok, source: "" }])).toThrow(
      /source 가 URL 이 아닙니다/,
    );
    expect(() =>
      validateBenchRecords([{ ...ok, source: "Anthropic 시스템카드" }]),
    ).toThrow(/source 가 URL 이 아닙니다/);
    expect(() =>
      validateBenchRecords([
        {
          ...ok,
          score: null,
          note: "no official number: 없음",
          source: "not-a-url",
        },
      ]),
    ).toThrow(/source 가 URL 이 아닙니다/);
  });

  it('score=null 인데 "no official number" 표기가 없으면 거부한다', () => {
    expect(() => validateBenchRecords([{ ...ok, score: null }])).toThrow(
      /no official number/,
    );
    expect(() =>
      validateBenchRecords([{ ...ok, score: null, note: "나중에 채움" }]),
    ).toThrow(/no official number/);
  });

  it("% 범위 밖 점수를 거부한다", () => {
    expect(() => validateBenchRecords([{ ...ok, score: 101 }])).toThrow(
      /% 범위/,
    );
    expect(() => validateBenchRecords([{ ...ok, score: -1 }])).toThrow(
      /% 범위/,
    );
    expect(() => validateBenchRecords([{ ...ok, score: NaN }])).toThrow(
      /% 범위/,
    );
  });

  it("asOf 가 ISO 날짜가 아니면 거부한다", () => {
    expect(() => validateBenchRecords([{ ...ok, asOf: "2026/06/30" }])).toThrow(
      /YYYY-MM-DD/,
    );
    expect(() => validateBenchRecords([{ ...ok, asOf: "" }])).toThrow(
      /YYYY-MM-DD/,
    );
  });

  it("version / harness.name 빈 문자열을 거부한다", () => {
    expect(() => validateBenchRecords([{ ...ok, version: "  " }])).toThrow(
      /version 이 비었습니다/,
    );
    expect(() =>
      validateBenchRecords([{ ...ok, harness: { name: "" } }]),
    ).toThrow(/harness.name 이 비었습니다/);
  });

  it("완전히 같은 행이 두 번 들어오면 거부한다(붙여넣기 사고)", () => {
    expect(() => validateBenchRecords([ok, { ...ok }])).toThrow(
      /이미 있습니다/,
    );
    // 하네스가 다르면 정당한 별개 실험이므로 통과해야 한다.
    expect(() =>
      validateBenchRecords([ok, { ...ok, harness: { name: "other-harness" } }]),
    ).not.toThrow();
  });

  it("alias 는 벤치 행에 쓰지 않는다(이동표적 금지)", () => {
    const aliases = new Set(MODEL_REGISTRY.flatMap((m) => m.aliases));
    for (const r of BENCH_REFERENCE) {
      expect(aliases.has(r.model), `${r.model} 은 alias`).toBe(false);
    }
  });

  // ── ★변형 라벨 교차검증 ─────────────────────────────────────────────
  // 이 표에서 가장 비싼 실수는 "출처가 Pro 라 적은 값을 Verified 행에 붙여넣는
  // 것" 이다. 두 필드가 몇 줄 떨어져 있어 사람 눈으로는 안 잡히고, 잡히지
  // 않은 채로 화면에 나가면 정확히 이 티켓이 고친 오독이 데이터에서 다시 난다.

  it("출처 표기와 benchmark 가 어긋나면 거부한다", () => {
    expect(() =>
      validateBenchRecords([
        {
          ...ok,
          benchmark: "swe-bench-verified",
          variantLabel: "SWE-Bench Pro",
        },
      ]),
    ).toThrow(/출처가 적은 변형과 이 행이 주장하는 변형이 다릅니다/);
  });

  it("변형을 읽을 수 없는 라벨은 거부한다(어느 시험인지 확정 안 됨)", () => {
    expect(() =>
      validateBenchRecords([{ ...ok, variantLabel: "SWE-bench" }]),
    ).toThrow(
      /변형\(Verified\/Pro\/Multilingual\/Multimodal\)을 읽을 수 없습니다/,
    );
    // 둘 이상에 걸려도 확정이 아니다.
    expect(() =>
      validateBenchRecords([
        { ...ok, variantLabel: "SWE-bench Verified (Pro subset)" },
      ]),
    ).toThrow(/읽을 수 없습니다/);
  });

  it("빈 variantLabel 은 거부한다(생략이 기본값이지 빈 문자열이 아니다)", () => {
    expect(() => validateBenchRecords([{ ...ok, variantLabel: "  " }])).toThrow(
      /빈 문자열/,
    );
  });

  it("실측 표기 흔들림은 통과한다(대문자·하이픈·언더바·네임스페이스)", () => {
    for (const label of [
      "SWE-Bench Pro",
      "SWE-bench Pro",
      "SWE-Bench Pro (Public)",
      "SWE-Pro",
      "ScaleAI/SWE-bench_Pro",
    ]) {
      expect(
        () =>
          validateBenchRecords([
            { ...ok, benchmark: "swe-bench-pro", variantLabel: label },
          ]),
        label,
      ).not.toThrow();
    }
  });

  it("남의 벤치 이름의 'pro' 에 걸리지 않는다(ProgramBench)", () => {
    // 경계 없이 "pro" 를 찾으면 ProgramBench 가 Pro 로 잡힌다. 그러면 Kimi 카드의
    // ProgramBench 값을 SWE-bench Pro 행에 넣는 사고를 가드가 오히려 통과시킨다.
    expect(() =>
      validateBenchRecords([{ ...ok, variantLabel: "ProgramBench" }]),
    ).toThrow(/읽을 수 없습니다/);
  });

  it("모든 실제 행의 변형 라벨이 자기 benchmark 와 일치한다", () => {
    for (const r of BENCH_REFERENCE) {
      if (r.variantLabel === undefined) continue;
      expect(
        variantFamilyOf(r.variantLabel),
        `${r.model}/${r.benchmark} → "${r.variantLabel}"`,
      ).toBe(r.benchmark);
    }
  });
});

describe("model-bench-reference / 변형 커버리지 파생", () => {
  it("커버리지는 **행이 아니라 모델** 수로 센다(중복 하네스가 부풀리지 않게)", () => {
    // haiku 4.5 는 Verified 에 하네스가 다른 두 행을 갖는다. 2 로 세면 한 모델이
    // 커버리지를 두 배로 부풀린다.
    const verified = benchVariantCoverage().find(
      (c) => c.variant.id === "swe-bench-verified",
    )!;
    const distinct = new Set(
      benchRowsFor("swe-bench-verified", {
        kind: "registry",
        scoredOnly: true,
      }).map((r) => r.model),
    );
    expect(verified.scoredModels).toBe(distinct.size);
  });

  it("점수 내림차순으로 나온다(1위가 기본 축이 된다)", () => {
    const cov = benchVariantCoverage();
    expect(cov).toHaveLength(BENCHMARK_IDS.length);
    for (let i = 1; i < cov.length; i++) {
      expect(cov[i - 1].scoredModels).toBeGreaterThanOrEqual(
        cov[i].scoredModels,
      );
    }
  });

  it("models 필터를 주면 그 모델들로만 센다", () => {
    const only = benchVariantCoverage({ models: ["claude-opus-5"] });
    for (const c of only) expect(c.scoredModels).toBeLessThanOrEqual(1);
    const pro = only.find((c) => c.variant.id === "swe-bench-pro")!;
    expect(pro.scoredModels).toBe(1);
  });

  it("BENCH_VARIANTS 는 네 변형 전부에 라벨을 갖는다", () => {
    for (const id of BENCHMARK_IDS) {
      expect(BENCH_VARIANTS[id].id).toBe(id);
      expect(BENCH_VARIANTS[id].label).toBeTruthy();
      expect(BENCH_VARIANTS[id].short).toBeTruthy();
      expect(BENCH_VARIANTS[id].blurb).toBeTruthy();
      // 표준 라벨은 자기 변형으로 되읽혀야 한다(라벨과 id 의 자기일관성).
      expect(variantFamilyOf(BENCH_VARIANTS[id].label)).toBe(id);
    }
  });
});

describe("model-bench-reference / 빈 칸은 침묵하지 않는다", () => {
  it('score=null 행은 note 에 "no official number" 를 남긴다', () => {
    const blanks = missingCells();
    expect(blanks.length).toBeGreaterThan(0);
    for (const r of blanks) {
      expect(r.note ?? "", `${r.model}/${r.benchmark}`).toContain(
        "no official number",
      );
    }
  });

  it("gpt 계열은 SWE-bench Verified 가 공식적으로 비어 있다(OpenAI 는 Pro 만 공개)", () => {
    const gptVerified = benchRowsFor("swe-bench-verified").filter((r) =>
      r.model.startsWith("gpt-"),
    );
    // 5.6 3변종 + 5.5 + gpt-6-astra(2026-09-05 편입 — Astra 는 Verified 만이
    // 아니라 Pro 보고마저 없다, 아래 astra 전용 확인 참조).
    expect(gptVerified.length).toBe(5);
    for (const r of gptVerified) expect(r.score).toBeNull();

    // 반대로 Pro 는 실수치가 채워져 있어야 한다(빈 칸 남발 방지).
    const gptPro = benchRowsFor("swe-bench-pro", { scoredOnly: true }).filter(
      (r) => r.model.startsWith("gpt-"),
    );
    expect(gptPro.length).toBeGreaterThanOrEqual(4);
  });

  it("★gpt-6-astra 는 Verified 만이 아니라 Pro 까지 비어 있다(2026-09-05 수집)", () => {
    // OpenAI 가 5.6 세대까지 보고하던 SWE-Bench Pro 를 Astra 발표에서 뺐다 —
    // 즉 2026-07-28 재조사가 세운 claude↔gpt 공통축(Pro)이 신형 세대에서 다시
    // 끊겼다. 이 사실이 침묵하지 않도록 null 행 존재를 못박는다.
    const astra = benchRowsForModel("gpt-6-astra");
    const variants = astra.map((r) => r.benchmark).sort();
    expect(variants).toEqual(["swe-bench-pro", "swe-bench-verified"]);
    for (const r of astra) {
      expect(r.score, r.benchmark).toBeNull();
      expect(r.note).toContain("no official number");
    }
  });
});

describe("model-bench-reference / 하네스 축", () => {
  it("같은 모델·같은 벤치라도 하네스가 다르면 별개 행이다", () => {
    const haiku = benchRowsForModel("claude-haiku-4-5-20251001").filter(
      (r) => r.benchmark === "swe-bench-verified" && r.score !== null,
    );
    const harnesses = new Set(haiku.map((r) => harnessKey(r.harness)));
    expect(harnesses.size).toBeGreaterThanOrEqual(2);
    // 두 행의 점수가 실제로 다르다 = 하네스 축을 1급으로 둔 이유.
    expect(new Set(haiku.map((r) => r.score)).size).toBeGreaterThanOrEqual(2);
  });

  it("comparableRows 는 하네스가 같은 행만, 점수 내림차순으로 준다", () => {
    const rows = comparableRows("swe-bench-verified", "mini-SWE-agent@2.0.0");
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(harnessKey(r.harness)).toBe("mini-SWE-agent@2.0.0");
      expect(r.score).not.toBeNull();
    }
    const scores = rows.map((r) => r.score as number);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("formatBenchTable 은 하네스별로 묶어 출력한다", () => {
    const out = formatBenchTable("swe-bench-verified");
    expect(out).toContain("하네스 ");
    expect(out).toContain("공식수치 없음");
    expect(out).toContain("[참조]");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// ★학습 그래프 오염 금지 — 완료 기준의 핵심 항목.
//
// 타입 시스템으로는 "누가 나를 import 하는가" 를 막을 수 없으므로 소스를 읽어
// 강제한다. 라우팅 코드가 이 표를 먹기 시작하면 그래프가 "우리 워크로드 관측"
// 인지 "벤더 발표 수치" 인지 사후에 분리되지 않는다.
// ─────────────────────────────────────────────────────────────────────────

function walkTs(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    if (name === "node_modules") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walkTs(p, out);
    else if (name.endsWith(".ts")) out.push(p);
  }
  return out;
}

describe("model-bench-reference / routing 그래프 미주입", () => {
  const IMPORT_RE =
    /from\s+["'][^"']*model-bench-reference["']|require\(\s*["'][^"']*model-bench-reference["']\s*\)/;

  it("routing-graph / graph-updater / routing-effectiveness 가 참조표를 import 하지 않는다", () => {
    const guarded = [
      join(ELECTRON_DIR, "routing-graph.ts"),
      join(ELECTRON_DIR, "graph-updater.ts"),
      join(ELECTRON_DIR, "routing-model-key.ts"),
      join(ELECTRON_DIR, "mcp-server", "routing-effectiveness.ts"),
      join(ELECTRON_DIR, "dispatch-scoring.ts"),
      join(ELECTRON_DIR, "model-selection.ts"),
      join(ELECTRON_DIR, "model-ladder.ts"),
    ];
    for (const f of guarded) {
      const src = readFileSync(f, "utf8");
      expect(
        IMPORT_RE.test(src),
        `${f} 가 model-bench-reference 를 import 한다`,
      ).toBe(false);
    }
  });

  it("이 모듈을 읽는 프로덕션 코드는 허용목록 안에만 있다(라우팅 코드 아님)", () => {
    // 종전엔 "importer 가 하나도 없다" 였다. 지금은 사용량 탭 정보표
    // (`model-fact-sheet.ts`)가 읽는다 — 표시 전용이고 라우팅 결정에 관여하지
    // 않는다. 허용목록으로 바꾼 이유는 위 주석 그대로다: **목록이 늘면 이
    // 테스트가 그 사실을 리뷰 앞으로 끌고 온다.** 라우팅 모듈이 여기 들어오려
    // 하면 위 테스트(routing-graph/graph-updater/routing-effectiveness)가 먼저
    // 막는다.
    //
    // `model-guidance.ts` 가 두 번째로 들어왔다(오케 `get_model_guidance` 의 정적
    // 절반). 같은 근거로 허용된다: **읽어서 보여줄 뿐 라우팅 결정에 관여하지
    // 않는다.** 그 툴은 점수도 추천도 만들지 않고 참조표 레코드를 그대로 실어
    // 오케에게 보여주며, 스코어러(dispatch-scoring)는 위 테스트가 계속 막는다 —
    // 즉 "사람(오케)이 읽는 경로" 와 "자동 라우팅 경로" 의 분리는 유지된다.
    const ALLOWED = ["model-fact-sheet.ts", "model-guidance.ts"];
    const importers = walkTs(ELECTRON_DIR)
      .filter(
        (f) =>
          !f.endsWith("model-bench-reference.ts") &&
          IMPORT_RE.test(readFileSync(f, "utf8")),
      )
      .map((f) => f.split("/").pop() ?? f)
      .filter((name) => !ALLOWED.includes(name));
    expect(importers).toEqual([]);
  });

  it("참조표 자신도 routing 모듈을 import 하지 않는다(단방향 유지)", () => {
    const src = readFileSync(
      join(ELECTRON_DIR, "model-bench-reference.ts"),
      "utf8",
    );
    expect(src).not.toMatch(/from\s+["']\.\/routing-graph["']/);
    expect(src).not.toMatch(/from\s+["']\.\/graph-updater["']/);
    // 의존은 model-registry 하나뿐이어야 한다.
    const imports = [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["./model-registry"]);
  });
});

describe("model-bench-reference / 수치 스팟체크(출처 대조)", () => {
  const find = (
    model: string,
    benchmark: BenchRecord["benchmark"],
    harness: string,
  ) =>
    BENCH_REFERENCE.find(
      (r) =>
        r.model === model &&
        r.benchmark === benchmark &&
        harnessKey(r.harness) === harness,
    );

  it("Anthropic 시스템카드 Verified 수치", () => {
    const h = "vendor-internal (Anthropic system-card standard config)";
    expect(find("claude-opus-5", "swe-bench-verified", h)?.score).toBe(96.0);
    expect(find("claude-fable-5", "swe-bench-verified", h)?.score).toBe(95.0);
    expect(find("claude-opus-4-8", "swe-bench-verified", h)?.score).toBe(88.6);
    expect(find("claude-sonnet-5", "swe-bench-verified", h)?.score).toBe(85.2);
  });

  it("Fable 5.1 시스템카드 §8.2 수치(SzVyt06S7X27tfnfdM9s) — 값이 아니라 스키마만 지키면 통과하던 구멍을 메운다", () => {
    const h = "vendor-internal (Anthropic system-card standard config)";
    expect(find("claude-fable-5-1", "swe-bench-pro", h)?.score).toBe(81.2);
    expect(find("claude-fable-5-1", "swe-bench-multilingual", h)?.score).toBe(
      89.1,
    );
    expect(find("claude-fable-5-1", "swe-bench-multimodal", h)?.score).toBe(
      54.7,
    );
    // Fable 5 카드엔 있던 Verified 행이 5.1 카드엔 없다 — score=null 로만
    // 침묵을 막는다(§8 전문에 "SWE-bench Verified" 0건, pdftotext 확인).
    expect(find("claude-fable-5-1", "swe-bench-verified", h)?.score).toBeNull();

    const benchlm = BENCH_REFERENCE.find(
      (r) =>
        r.model === "claude-fable-5-1" &&
        r.benchmark === "swe-bench-pro" &&
        r.sourceKind === "leaderboard",
    );
    expect(benchlm?.score).toBe(81.2);
  });

  it("공식 리더보드(mini-SWE-agent 2.0.0) 수치", () => {
    expect(
      find(
        "claude-haiku-4-5-20251001",
        "swe-bench-verified",
        "mini-SWE-agent@2.0.0",
      )?.score,
    ).toBe(66.6);
  });

  it("OpenAI 공식 SWE-Bench Pro 수치", () => {
    const h = "vendor-internal (OpenAI)";
    expect(find("gpt-5.6-sol", "swe-bench-pro", h)?.score).toBe(64.6);
    expect(find("gpt-5.6-terra", "swe-bench-pro", h)?.score).toBe(63.4);
    expect(find("gpt-5.6-luna", "swe-bench-pro", h)?.score).toBe(62.7);
  });

  it("BenchLM SWE-bench Pro 리더보드 수치와 출처 규율", () => {
    const expected: Array<[string, BenchRecord["kind"], number]> = [
      ["claude-fable-5", "registry", 80.0],
      ["claude-opus-5", "registry", 79.2],
      ["claude-opus-4-8", "registry", 69.2],
      ["claude-sonnet-5", "registry", 63.2],
      ["grok-4.5", "registry", 64.7],
      ["gpt-5.6-sol", "registry", 64.6],
      ["gpt-5.6-terra", "registry", 63.4],
      ["gpt-5.6-luna", "registry", 62.7],
      ["gpt-5.5", "registry", 58.6],
      ["glm-5.2", "registry", 62.1],
      ["MiniMax-M3", "registry", 59.0],
      ["MiniMax-M2.7", "registry", 56.2],
      ["Gemini 3.5 Flash", "reference", 55.1],
      ["Gemini 3.5 Flash-Lite", "reference", 54.2],
      ["GLM-5.1", "reference", 58.4],
      ["GLM-5", "reference", 55.1],
      ["Kimi K2.6", "reference", 58.6],
      ["Kimi K2.5", "reference", 50.7],
    ];
    for (const [model, kind, score] of expected) {
      const row = BENCH_REFERENCE.find(
        (r) =>
          r.model === model &&
          r.kind === kind &&
          r.benchmark === "swe-bench-pro" &&
          r.sourceKind === "leaderboard",
      );
      expect(row, model).toBeDefined();
      expect(row?.score, model).toBe(score);
      expect(row?.source, model).toBe("BenchLM (benchlm.ai/benchmarks/swePro)");
      expect(row?.asOf, model).toBe("2026-07-28");
      expect(row?.note, model).toContain(
        "OpenAI 2026-07 audit flagged ~30% public tasks broken",
      );
    }
  });

  it("벤더 후보 참조행", () => {
    // ★glm-4.7 은 MTtCVCP4 로 레지스트리에 편입되면서 참조행 → registry 행이 됐다
    // (표기도 벤더 블로그의 "GLM-4.7" 이 아니라 레지스트리 구체 id). 이 전환은
    // validateBenchRecords 의 역방향 검증이 부팅 시 강제한다.
    const glm47 = BENCH_REFERENCE.find(
      (r) => r.model === "glm-4.7" && r.benchmark === "swe-bench-verified",
    );
    expect(glm47?.score).toBe(73.8);
    expect(glm47?.kind).toBe("registry");
    // 아직 편입 전인 GLM-4.6 행들은 참조행 그대로다.
    expect(
      BENCH_REFERENCE.filter((r) => r.model === "GLM-4.6").every(
        (r) => r.kind === "reference",
      ),
    ).toBe(true);

    // ★Grok 4.5 도 같은 전환을 거쳤다: 레지스트리에 `grok-4.5` 행이 생기면서
    // 참조행 → registry 행이 됐고, 표기도 벤더 발표문의 "Grok 4.5"(공백)가
    // 아니라 레지스트리 구체 id 다. 종전 표기는 공백/하이픈 차이 때문에
    // 역방향 가드를 우연히 피해 갔고, 그 상태에서는 사용량 탭이 모델 id 로
    // 조회해도 이 행에 닿지 못했다.
    expect(benchRowsForModel("Grok 4.5")).toEqual([]);
    const grokRows = benchRowsForModel("grok-4.5");
    expect(grokRows.every((r) => r.kind === "registry")).toBe(true);
    expect(
      grokRows.find((r) => r.benchmark === "swe-bench-verified")?.score,
    ).toBeNull();
    expect(grokRows.find((r) => r.benchmark === "swe-bench-pro")?.score).toBe(
      64.7,
    );
  });
});
