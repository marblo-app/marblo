/**
 * **우리 자체 실측**(our-measured) 소스의 규율을 못박는다 — 티켓 S3r33amMPLxM8y9UJOII.
 *
 * ── 이 파일이 지키는 것 ──────────────────────────────────────────────────
 *   1. **★벤더치와 섞이지 않는다.** 이게 이 파일의 존재 이유다. 우리 실측은 공식
 *      SWE-bench Docker 가 아닌 환경에서 잰 값이라, 벤더가 자기 하네스에서 낸
 *      숫자와 뺄셈이 성립하지 않는다. 그래서 "섞지 말자" 는 약속이 아니라 **구조**
 *      여야 한다: 모듈이 서로를 import 하지 않고(양방향), 벤더치를 조립하는
 *      경로(model-fact-sheet / model-guidance)가 이 모듈을 읽지 않으며, 화면에서도
 *      두 스토어가 한 컴포넌트에 같이 들어가지 않는다. 셋 다 소스 스캔으로 강제한다.
 *   2. **대조행(noop 0% / gold 100%)이 항상 있다.** 채점기 무결성의 증거이자,
 *      "claude 100%" 를 주장이 아니라 관측으로 만드는 유일한 근거다.
 *   3. **한계 캡션이 문서와 같은 문자열이다.** `generated-report.md` 헤더와 화면
 *      캡션이 갈라지면, 갈라진 뒤엔 늘 화면 쪽이 조건을 잃는다.
 *   4. 비율·환경 필드 같은 기본 산술/필수값(= 표를 해석 가능하게 만드는 것들).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  OUR_BENCH,
  controlRoleOf,
  ourBenchPayload,
  stripEmphasis,
  validateOurBench,
  type OurBenchReport,
} from "../../electron/model-bench-ours";
import { BENCH_REFERENCE } from "../../electron/model-bench-reference";
import { ko } from "../../src/locales/ko";
import { en } from "../../src/locales/en";

const V3 = join(__dirname, "..", "..");
const ELECTRON_DIR = join(V3, "electron");
const USAGE_DIR = join(V3, "src", "components", "usage");
const read = (...p: string[]) => readFileSync(join(...p), "utf8");

const OURS_IMPORT =
  /from\s+["'][^"']*model-bench-ours["']|require\(\s*["'][^"']*model-bench-ours["']\s*\)/;
const REFERENCE_IMPORT =
  /from\s+["'][^"']*model-bench-reference["']|require\(\s*["'][^"']*model-bench-reference["']\s*\)/;

describe("model-bench-ours / 스키마 규율", () => {
  it("로드 시점 검증을 통과한다(그리고 그 검증은 실제로 던진다)", () => {
    expect(() => validateOurBench(OUR_BENCH)).not.toThrow();

    // 검증이 장식이 아님을 보인다 — 대조행을 빼면 못 뜬다.
    const withoutControls: OurBenchReport = {
      ...OUR_BENCH,
      cells: OUR_BENCH.cells.filter((c) => controlRoleOf(c.harness) === null),
    };
    expect(() => validateOurBench(withoutControls)).toThrow(/대조행/);
  });

  it("모든 셀이 scaffold·execEnv·grader 를 들고 다닌다", () => {
    expect(OUR_BENCH.cells.length).toBeGreaterThan(0);
    for (const c of OUR_BENCH.cells) {
      const at = `${c.harness}/${c.model ?? "(cli default)"}`;
      expect(c.scaffold.length, at).toBeGreaterThan(0);
      expect(c.execEnv.length, at).toBeGreaterThan(0);
      expect(c.graderVersion.length, at).toBeGreaterThan(0);
    }
  });

  it("resolved% 는 resolved/graded 와 일치하고, 분모 0 은 null 이다", () => {
    for (const c of OUR_BENCH.cells) {
      if (c.graded === 0) expect(c.resolvedPct).toBeNull();
      else expect(c.resolvedPct).toBeCloseTo((c.resolved / c.graded) * 100, 5);
      expect(c.resolved).toBeLessThanOrEqual(c.graded);
    }
  });

  it("사용량·비용 축은 필수이며, 미계측과 0을 섞지 않는다", () => {
    let metered = 0;
    let unmetered = 0;
    for (const c of OUR_BENCH.cells) {
      expect(c).toHaveProperty("inputTokens");
      expect(c).toHaveProperty("outputTokens");
      expect(c).toHaveProperty("listCostUsd");
      expect(c).toHaveProperty("vendorCostUsd");
      if (c.inputTokens === null) {
        unmetered += 1;
        expect(c.outputTokens).toBeNull();
        expect(c.listCostUsd).toBeNull();
      } else {
        metered += 1;
        expect(c.inputTokens).toBeGreaterThan(0);
        expect(c.outputTokens).not.toBeNull();
        expect(c.listCostUsd).not.toBeNull();
      }
    }
    expect(metered).toBeGreaterThan(0);
    expect(unmetered).toBeGreaterThan(0);
    // Codex가 금액을 안 준다는 사실은 $0가 아니라 null로 화면까지 간다.
    const astraCells = OUR_BENCH.cells.filter((c) => c.model === "gpt-6-astra");
    expect(astraCells.length).toBeGreaterThan(0);
    expect(astraCells.every((c) => c.vendorCostUsd === null)).toBe(true);
  });

  it("execEnv 가 공식 Docker 가 아님을 데이터가 스스로 밝힌다", () => {
    // 이 사실이 데이터에서 사라지면 캡션만으로는 "왜 비교 불가인지" 를 못 댄다.
    expect(OUR_BENCH.meta.execEnv).toContain("no-docker");
  });
});

describe("model-bench-ours / ★대조행 노출 계약", () => {
  it("payload 가 noop(바닥) 0% 와 gold(천장) 100% 를 따로 실어 준다", () => {
    const { controls } = ourBenchPayload();
    const floor = controls.find((c) => c.role === "floor");
    const ceiling = controls.find((c) => c.role === "ceiling");
    expect(floor?.harness).toBe("noop");
    expect(ceiling?.harness).toBe("gold");
    // 이 두 값이 아니면 채점기가 헐겁거나(noop>0) 조인다(gold<100).
    expect(floor?.resolvedPct).toBe(0);
    expect(ceiling?.resolvedPct).toBe(100);
    expect(floor?.graded).toBeGreaterThan(0);
    expect(ceiling?.graded).toBeGreaterThan(0);
  });

  it("measured 에는 대조행이 없고, cells 에는 그대로 남아 있다", () => {
    const { measured, cells } = ourBenchPayload();
    expect(measured.every((c) => controlRoleOf(c.harness) === null)).toBe(true);
    // ★요약에서 빠진다고 표에서까지 지우면 증거가 사라진다.
    expect(cells.some((c) => c.harness === "noop")).toBe(true);
    expect(cells.some((c) => c.harness === "gold")).toBe(true);
  });
});

describe("★our-measured 가 벤더 공개치와 섞이지 않는다", () => {
  it("두 모듈은 서로를 import 하지 않는다(양방향)", () => {
    expect(
      REFERENCE_IMPORT.test(read(ELECTRON_DIR, "model-bench-ours.ts")),
    ).toBe(false);
    expect(
      OURS_IMPORT.test(read(ELECTRON_DIR, "model-bench-reference.ts")),
    ).toBe(false);
  });

  it("우리 실측 모듈의 의존은 자기 데이터 파일 하나뿐이다", () => {
    // 레지스트리조차 안 읽는다 — 측정은 과거의 사실이라, 나중에 레지스트리에서
    // 모델이 빠져도 "그때 그 모델로 쟀다" 가 거짓이 되지는 않는다.
    const src = read(ELECTRON_DIR, "model-bench-ours.ts");
    const imports = [...src.matchAll(/from\s+["'](\.[^"']+)["']/g)].map(
      (m) => m[1],
    );
    expect(imports).toEqual(["./model-bench-ours-data"]);
  });

  it("벤더치를 조립·해설하는 경로가 우리 실측을 읽지 않는다", () => {
    // model-fact-sheet: 사용량 탭 정보표(벤더 공개치 조인).
    // model-guidance : 오케가 듣는 정적 모델 안내.
    // 이 둘이 우리 실측을 읽기 시작하면 한 응답 안에서 두 축이 만나고, 그 순간
    // 화면이 둘을 한 표에 놓지 않을 구조적 이유가 사라진다.
    for (const f of ["model-fact-sheet.ts", "model-guidance.ts"]) {
      expect(OURS_IMPORT.test(read(ELECTRON_DIR, f)), f).toBe(false);
    }
  });

  it("라우팅 코드도 우리 실측을 읽지 않는다(참조표와 같은 규율)", () => {
    // 벤더치를 라우팅에 주입하지 않는 이유(관측과 마케팅을 섞지 않는다)가 여기선
    // 더 강하다: N=3 짜리 실측을 스코어러에 먹이면 세 문제로 함대 전체가 기운다.
    for (const f of [
      "routing-graph.ts",
      "graph-updater.ts",
      "routing-model-key.ts",
      "dispatch-scoring.ts",
      "model-selection.ts",
      "model-ladder.ts",
    ]) {
      expect(OURS_IMPORT.test(read(ELECTRON_DIR, f)), f).toBe(false);
    }
  });

  it("두 스키마는 공유 필드가 없다(한 표에 부으면 타입이 먼저 막는다)", () => {
    // 벤더 행의 표식: source/sourceKind/asOf. 우리 셀의 표식: execEnv/scaffold/
    // graderVersion. 어느 쪽도 상대의 표식을 갖지 않아야 "같은 행" 으로 오인되지
    // 않는다.
    for (const cell of OUR_BENCH.cells) {
      const keys = Object.keys(cell);
      expect(keys).not.toContain("source");
      expect(keys).not.toContain("sourceKind");
      expect(keys).not.toContain("asOf");
    }
    for (const row of BENCH_REFERENCE) {
      const keys = Object.keys(row);
      expect(keys).not.toContain("execEnv");
      expect(keys).not.toContain("scaffold");
      expect(keys).not.toContain("graderVersion");
    }
  });

  it("화면에서도 두 소스가 한 컴포넌트에 같이 들어가지 않는다", () => {
    // 벤더 표(ModelFactSheet)와 우리 실측(OurBenchPanel)은 각자 자기 스토어만
    // 읽는다. 한쪽이 상대 스토어를 읽기 시작하면 같은 표를 만들 재료가 갖춰진다.
    const factSheet = read(USAGE_DIR, "ModelFactSheet.tsx");
    const ourPanel = read(USAGE_DIR, "OurBenchPanel.tsx");
    expect(factSheet).not.toContain("ourBenchStore");
    expect(ourPanel).not.toContain("modelFactSheetStore");
    expect(ourPanel).toContain("our-measured");
    expect(ourPanel).toContain("disclaimersPlain");
  });

  it("표는 점수의 분모와 속도·토큰·두 비용 축을 모두 별도 열로 낸다", () => {
    const ourPanel = read(USAGE_DIR, "OurBenchPanel.tsx");
    for (const key of [
      "colGraded",
      "colResolved",
      "colAvg",
      "colInputTokens",
      "colOutputTokens",
      "colListCost",
      "colVendorCost",
    ]) {
      expect(ourPanel).toContain(`usage.ourBench.${key}`);
    }
    // null은 긴 대시, 숫자 0은 그대로 표시한다. 이 경계가 codex 청구액을
    // $0로 둔갑시키는 회귀를 막는다.
    expect(ourPanel).toContain('value === null ? "—"');
  });

  it("IPC 채널도 갈라져 있다(응답이 합쳐질 수 없다)", () => {
    const main = read(ELECTRON_DIR, "main.ts");
    expect(main).toContain('ipcMain.handle("models:ourBench"');
    expect(main).toContain('ipcMain.handle("models:factSheet"');
    const preload = read(ELECTRON_DIR, "preload.ts");
    expect(preload).toContain('ipcRenderer.invoke("models:ourBench")');
  });
});

describe("★한계 캡션이 문서와 같은 문자열이다", () => {
  const REPORT_MD = read(V3, "docs", "benchmark", "generated-report.md");

  it("generated-report.md 헤더가 모듈의 캡션을 그대로 담고 있다", () => {
    expect(OUR_BENCH.meta.disclaimers.length).toBeGreaterThan(0);
    for (const d of OUR_BENCH.meta.disclaimers) {
      // 문서엔 인용부호(`> `)가 붙어 있고 문구는 그대로다.
      expect(REPORT_MD).toContain(`> ${d}`);
    }
  });

  it("실측 payload가 세 정직성 문구를 직접 싣는다", () => {
    // UI는 report.disclaimersPlain을 직접 렌더한다. 로케일 fallback을 셋째 문구의
    // 두 번째 원천으로 만들지 않아 문서·화면이 갈라질 길을 없앤다.
    expect(ourBenchPayload().disclaimersPlain).toHaveLength(3);
    expect(ourBenchPayload().disclaimersPlain[1]).toContain("모델, 하네스");
    expect(ourBenchPayload().disclaimersPlain[1]).toContain("단발 런");
  });

  it("캡션이 비교 불가 사실을 실제로 말한다(ko·en 모두)", () => {
    expect(ko["usage.ourBench.caption.execEnv"]).toContain("Docker");
    expect(ko["usage.ourBench.caption.execEnv"]).toContain("비교할 수 없다");
    expect(en["usage.ourBench.caption.execEnv"]).toContain("Docker");
    expect(en["usage.ourBench.caption.execEnv"]).toContain(
      "cannot be compared",
    );
    // 벤더치와 같은 표에 놓지 않는다는 말도 양쪽 로케일에 남아야 한다.
    expect(ko["usage.ourBench.caption.separate"]).toContain(
      "model-bench-reference",
    );
    expect(en["usage.ourBench.caption.separate"]).toContain(
      "model-bench-reference",
    );
  });

  it("stripEmphasis 는 마크다운 강조만 뗀다", () => {
    expect(stripEmphasis("a **b** `c` *d*")).toBe("a b c d");
  });
});

describe("model-bench-ours-data / 생성물 규율", () => {
  it("손으로 고치지 말라는 표시와 생성 명령이 파일에 적혀 있다", () => {
    const src = read(ELECTRON_DIR, "model-bench-ours-data.ts");
    expect(src).toContain("생성물");
    expect(src).toContain("bench:swe:emit");
  });

  it("데이터가 리포트의 인스턴스 목록과 총 런 수를 그대로 들고 있다", () => {
    const md = read(V3, "docs", "benchmark", "generated-report.md");
    for (const id of OUR_BENCH.meta.instances) expect(md).toContain(id);
    expect(md).toContain(`총 런: ${OUR_BENCH.meta.totalRuns}`);
  });
});
