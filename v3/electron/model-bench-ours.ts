/**
 * SWE-bench **우리 자체 실측**(our-measured) — 구조화된 단일 소스.
 *
 * ── 이 파일이 무엇이 **아닌지** 부터 ──────────────────────────────────────
 * 이건 `model-bench-reference.ts`(벤더 공개치)의 형제 파일이지만 **같은 물건이
 * 아니다**. 저쪽은 "벤더가 자기 하네스에서 발표한 숫자"이고, 이쪽은 "우리가 우리
 * 스폰 경로로 직접 돌려서 얻은 숫자"다. 두 표를 한 표에 놓는 것은 이 저장소에서
 * **금지**돼 있고(`docs/benchmark/README.md` 의 ①③ 구분), 그 금지를 코드로
 * 못박는 장치가 세 겹이다:
 *
 *   1. 리포트 생성기(`scripts/bench/report.ts`)가 `label !== "our-measured"` 행을
 *      거부한다 — 벤더 수치가 실수로 같은 jsonl 에 섞여도 표에 못 오른다.
 *   2. 이 모듈은 `model-bench-reference.ts` 를 **import 하지 않는다**. 반대로도
 *      마찬가지다. 조인할 수단이 아예 없어야 조인이 안 일어난다.
 *   3. `tests/unit/model-bench-ours.test.ts` 가 그 두 방향을 소스 스캔으로 강제하고,
 *      정보표(`model-fact-sheet.ts`)가 이 모듈을 읽지 않는다는 것도 함께 못박는다.
 *
 * 그래서 이 파일의 import 목록은 **데이터 파일 하나뿐**이다(레지스트리조차 안
 * 읽는다 — 측정은 과거의 사실이라, 나중에 레지스트리에서 모델이 빠졌다고 해서
 * "그때 그 모델로 쟀다"가 거짓이 되지는 않기 때문이다).
 *
 * ── ★가장 중요한 한계: 공식 Docker 가 아니다 ─────────────────────────────
 * 공식 SWE-bench 채점은 인스턴스마다 구운 Docker 이미지 안에서 돈다. 우리 실행은
 * `native-venv/macos-arm64(no-docker)` 다. 따라서 이 숫자들은 **공식 리더보드와
 * 비교할 수 없다.** 읽어도 되는 것은 *같은 execEnv·같은 scaffold 안에서의 상대
 * 비교*뿐이다. 이 문장은 취향이 아니라 데이터다 — `meta.disclaimers` 가
 * `docs/benchmark/generated-report.md` 헤더 문구를 **그대로** 들고 다니고, 화면은
 * 그 캡션을 접힌 상태에서도 지우지 않는다.
 *
 * ── ★대조행(noop / gold)이 1급 시민인 이유 ───────────────────────────────
 * `noop`(아무것도 안 함)과 `gold`(정답 패치 적용)는 모델 성능이 아니라 **채점기가
 * 정상인가**를 재는 행이다. noop 이 0% 가 아니면 채점기가 헐거운 것이고, gold 가
 * 100% 가 아니면 채점기가 조이는 것이다. 이 두 행 없이 "claude 100%" 만 보여 주는
 * 표는 숫자가 참이어도 **증거가 없는 주장**이다. 그래서:
 *   · `validateOurBench` 가 두 대조행의 존재를 **로드 시점에 강제**한다.
 *   · `ourBenchPayload()` 가 대조행을 따로 뽑아 내려, 화면이 접힌 상태에서도
 *     한 줄 요약에 같이 실을 수 있게 한다.
 *
 * ── 손 중복 금지 ─────────────────────────────────────────────────────────
 * 아래 데이터는 손으로 적지 않는다. `runs.jsonl` 이 정본이고,
 * `npm run bench:swe:emit` 이 같은 생성기(`scripts/bench/report.ts`)로 마크다운과
 * 이 모듈의 데이터 파일(`model-bench-ours-data.ts`)을 **한 번에** 뽑는다. 즉
 * 마크다운과 화면이 갈라질 수 없다 — 갈라지려면 생성기를 고쳐야 한다.
 */

import { OUR_BENCH_DATA } from "./model-bench-ours-data";

/** 이 하네스가 태울 수 있는 스폰 경로. `scripts/bench/types.ts` 와 같은 축. */
export type OurBenchHarness = "claude" | "codex" | "grok" | "gold" | "noop";

/**
 * 대조행의 역할. `floor`(noop) = 아무것도 안 했을 때의 바닥,
 * `ceiling`(gold) = 정답 패치를 넣었을 때의 천장. 둘 다 모델 성능이 아니라
 * **채점기 무결성**의 증거다.
 */
export type OurBenchControlRole = "floor" | "ceiling";

/** 실행 묶음 전체에 걸리는 사실. 숫자를 해석하려면 이게 전부 필요하다. */
export interface OurBenchMeta {
  /** ★분리 계약. 이 값이 아닌 행은 생성기가 애초에 거부한다. */
  label: "our-measured";
  dataset: string;
  /** 고정 인스턴스 목록. N 은 이 배열의 길이지 따로 적는 수가 아니다. */
  instances: string[];
  /** 총 런 수(채점 실패 포함 — 분모에서 빼지 않는다). */
  totalRuns: number;
  /** 스캐폴드 식별자. 값이 여럿이면 " · " 로 이어 붙는다(숨기지 않는다). */
  scaffold: string;
  /** ★실행환경. 공식 Docker 가 아님을 이 값이 드러낸다. */
  execEnv: string;
  /** 채점기 버전. 다른 버전의 런은 같은 셀에 합산되지 않는다. */
  graderVersion: string;
  /** 리포트 생성 시각(ISO8601). */
  generatedAt: string;
  /** 같은 데이터로 만든 사람용 문서. 화면이 "어디서 왔나"를 가리킬 때 쓴다. */
  reportPath: string;
  /**
   * ★`generated-report.md` 헤더 문구 **그대로**(마크다운 강조 포함). 화면은
   * 강조 표기를 뗀 `disclaimersPlain` 을 쓰지만, 원문을 같이 들고 다녀야
   * 리뷰어가 문서와 한 글자씩 대조할 수 있다.
   */
  disclaimers: string[];
}

/** 하네스(×모델×effort×환경) 한 칸 = 리포트 "셀별 요약" 표의 한 줄. */
export interface OurBenchCell {
  harness: OurBenchHarness;
  /** 하네스에 핀한 모델 id. null 이면 CLI 기본값(대조행이 그렇다). */
  model: string | null;
  /** codex 의 reasoning effort. 없으면 null. */
  effort: string | null;
  /** 채점에 성공한 런 수(= 비율의 분모). */
  graded: number;
  resolved: number;
  /** graded 가 0 이면 null — 0/0 을 0% 로 적지 않는다. */
  resolvedPct: number | null;
  /** 에이전트가 diff 를 한 줄도 못 낸 런 수(feasibility 문서 §4-C 의 숨은 축). */
  noOutput: number;
  /** 채점 전에 파이프라인이 깨진 런 수. ★분모에서 빼지 않고 따로 센다. */
  errored: number;
  /** 평균 에이전트 실행 시간(초). 측정치가 없으면 null(대조행이 그렇다). */
  avgAgentSeconds: number | null;
  cliVersion: string | null;
  /**
   * ★벤더 경유 경로. OpenAI 호환 env-swap 벤더(Upstage Solar)는 같은 `codex`
   * 하네스라도 다른 셀에 **없는 홉**을 탄다 — 로컬 Responses→Chat 브리지와
   * codex 커스텀 프로바이더다. 그 차이를 표에서 지우면 "같은 조건" 이라는
   * 거짓 인상이 남으므로, 셀이 문자열로 들고 다니고 화면이 그대로 그린다.
   * 기본 경로(다른 모든 셀)면 null.
   */
  vendorRoute: string | null;
  scaffold: string;
  execEnv: string;
  graderVersion: string;
}

/** 인스턴스 × 하네스 격자의 한 칸. F2P/P2P 를 그대로 들고 다닌다. */
export interface OurBenchInstanceCell {
  harness: OurBenchHarness;
  /** null = 채점되지 못함(에러). false 와 구분된다. */
  resolved: boolean | null;
  f2pPassed: number;
  f2pTotal: number;
  p2pPassed: number;
  p2pTotal: number;
}

export interface OurBenchInstanceRow {
  instanceId: string;
  cells: OurBenchInstanceCell[];
}

/** 생성기가 뽑고 데이터 파일이 담는 것 전부. */
export interface OurBenchReport {
  meta: OurBenchMeta;
  cells: OurBenchCell[];
  instances: OurBenchInstanceRow[];
}

/** 대조행 한 줄(화면이 접힌 상태에서도 노출해야 하는 증거). */
export interface OurBenchControl {
  role: OurBenchControlRole;
  harness: OurBenchHarness;
  resolvedPct: number | null;
  graded: number;
}

/** IPC 가 실제로 내리는 것 = 데이터 + 화면이 매번 다시 계산하지 않도록 한 파생. */
export interface OurBenchPayload extends OurBenchReport {
  /** noop/gold. ★비어 있을 수 없다(로드 시점 검증이 막는다). */
  controls: OurBenchControl[];
  /** 대조행이 아닌 셀 = 실제로 모델을 태운 칸. */
  measured: OurBenchCell[];
  /** 마크다운 강조를 뗀 캡션. 화면이 그대로 그린다. */
  disclaimersPlain: string[];
}

/**
 * 하네스 → 대조 역할. 목록을 데이터에 적지 않고 여기서 파생시키는 이유:
 * 데이터 파일은 생성물이라 사람이 못 고치는데, "무엇이 대조행인가" 는 사람이
 * 아는 규칙이기 때문이다. 생성기가 이 판정을 몰라도 되게 만든다.
 */
export function controlRoleOf(
  harness: OurBenchHarness,
): OurBenchControlRole | null {
  if (harness === "noop") return "floor";
  if (harness === "gold") return "ceiling";
  return null;
}

/** 마크다운 강조(`**`, `*`, 백틱) 제거. 캡션을 화면에 그대로 그리기 위한 것. */
export function stripEmphasis(md: string): string {
  return md.replace(/\*\*/g, "").replace(/[*`]/g, "");
}

const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T/;

/**
 * 로드 시점 검증. 어긋난 데이터는 앱을 못 뜨게 한다
 * (`model-bench-reference.ts` 와 같은 철학: 거짓 표가 조용히 사는 것보다 낫다).
 *
 * ★특히 **대조행 강제**가 이 함수의 핵심이다. 생성기가 대조행 없이 우리 숫자만
 * 뽑아 오는 날, 그 표는 "채점기가 정상임을 보인 적 없는 100%" 가 된다.
 */
export function validateOurBench(report: OurBenchReport): void {
  const { meta, cells, instances } = report;
  const fail = (why: string): never => {
    throw new Error(`model-bench-ours: ${why}`);
  };

  if (meta.label !== "our-measured") fail(`label 이 our-measured 가 아니다`);
  if (!meta.dataset.trim()) fail("dataset 이 비었다");
  if (meta.instances.length === 0) fail("instances 가 비었다");
  if (!ISO_DATE_TIME.test(meta.generatedAt))
    fail(`generatedAt 이 ISO8601 이 아니다: ${meta.generatedAt}`);
  for (const field of ["scaffold", "execEnv", "graderVersion"] as const) {
    if (!meta[field].trim()) fail(`meta.${field} 가 비었다`);
  }
  // 캡션이 없으면 화면이 "비교 불가" 를 말할 근거를 잃는다 — 그건 숫자만 남고
  // 조건이 사라지는 것이라, 빈 배열을 허용하지 않는다.
  if (meta.disclaimers.length === 0) fail("disclaimers 가 비었다");

  if (cells.length === 0) fail("cells 가 비었다");
  for (const c of cells) {
    const at = `${c.harness}/${c.model ?? "(cli default)"}`;
    if (!c.scaffold.trim() || !c.execEnv.trim() || !c.graderVersion.trim())
      fail(`${at}: scaffold/execEnv/graderVersion 중 빈 칸이 있다`);
    if (c.resolved > c.graded) fail(`${at}: resolved > graded`);
    if (c.graded === 0) {
      if (c.resolvedPct !== null) fail(`${at}: graded=0 인데 비율이 있다`);
    } else {
      const expected = (c.resolved / c.graded) * 100;
      if (c.resolvedPct === null || Math.abs(c.resolvedPct - expected) > 0.05)
        fail(`${at}: resolvedPct 가 resolved/graded 와 어긋난다`);
    }
  }

  // ★대조행 강제.
  const roles = new Set(
    cells.map((c) => controlRoleOf(c.harness)).filter(Boolean),
  );
  if (!roles.has("floor") || !roles.has("ceiling"))
    fail("대조행(noop=floor, gold=ceiling)이 둘 다 있어야 한다");

  const known = new Set(meta.instances);
  for (const row of instances) {
    if (!known.has(row.instanceId))
      fail(`instances 격자에 meta 에 없는 인스턴스가 있다: ${row.instanceId}`);
  }
}

validateOurBench(OUR_BENCH_DATA);

export const OUR_BENCH: OurBenchReport = OUR_BENCH_DATA;

/**
 * IPC 응답. 파생은 두 가지뿐이고 둘 다 **화면이 정직하기 위해** 필요한 것이다:
 * 대조행을 따로 뽑아 접힌 상태에서도 보이게 하고, 캡션의 마크다운을 떼 준다.
 */
export function ourBenchPayload(): OurBenchPayload {
  const controls: OurBenchControl[] = [];
  const measured: OurBenchCell[] = [];
  for (const cell of OUR_BENCH.cells) {
    const role = controlRoleOf(cell.harness);
    if (role)
      controls.push({
        role,
        harness: cell.harness,
        resolvedPct: cell.resolvedPct,
        graded: cell.graded,
      });
    else measured.push(cell);
  }
  return {
    ...OUR_BENCH,
    controls,
    measured,
    disclaimersPlain: OUR_BENCH.meta.disclaimers.map(stripEmphasis),
  };
}
