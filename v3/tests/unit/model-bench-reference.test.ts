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
  BENCH_REFERENCE,
  BENCHMARK_IDS,
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
  it("모든 행에 출처 URL 이 있다 (score=null 인 행도 예외 없음)", () => {
    expect(BENCH_REFERENCE.length).toBeGreaterThan(0);
    for (const r of BENCH_REFERENCE) {
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
    ];
    for (const id of targets) {
      const rows = benchRowsForModel(id);
      expect(rows.length, `${id} 에 대한 참조 행이 없다`).toBeGreaterThan(0);
      // 대상 모델은 전부 레지스트리에 실재해야 한다(오타 가드).
      expect(MODEL_REGISTRY.some((m) => m.id === id)).toBe(true);
    }
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
    expect(gptVerified.length).toBe(4);
    for (const r of gptVerified) expect(r.score).toBeNull();

    // 반대로 Pro 는 실수치가 채워져 있어야 한다(빈 칸 남발 방지).
    const gptPro = benchRowsFor("swe-bench-pro", { scoredOnly: true }).filter(
      (r) => r.model.startsWith("gpt-"),
    );
    expect(gptPro.length).toBeGreaterThanOrEqual(4);
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
