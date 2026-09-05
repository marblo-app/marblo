/**
 * ★사전등록(pre-registration) 파일.
 *
 * feasibility 문서(`v3/docs/marblo-swe-benchmark-feasibility-2026-08-09.md`)
 * §4-F 가 T1 의 첫 번째 의무로 못박은 것: **인스턴스 목록·셀·채점 루브릭을
 * 실행 전에 커밋한다. 커밋 해시가 곧 사전등록 증거다.**
 *
 * 그래서 이 파일은 "설정"이 아니라 **증거**다. 결과를 본 뒤에 인스턴스를
 * 갈아끼우면 그 순간 이 벤치는 무가치해진다. 인스턴스를 바꾸려면 **새 라운드**
 * 를 열고(RUN_LABEL 변경) 이전 라운드 결과를 지우지 말 것.
 */
import type { RepoSpec } from "./types";

/** 데이터셋 고정. Lite 가 아니라 Verified — 인스턴스 품질이 사람 검수됐다. */
export const DATASET = "princeton-nlp/SWE-bench_Verified";

/**
 * ★고정 N — **변별 라운드(mixed difficulty)**. 선정 기준(결과를 보기 전에 정한 것):
 *   ① `django/django` — Verified 500개 중 231개(46%)로 최대 레포이고,
 *      **서드파티 의존이 없어** Docker 없이 네이티브로 세울 수 있는 유일한
 *      대형 레포다(sympy 는 mpmath 하나로 가능하나 러너 출력 파싱이 더 험하다).
 *   ② ★난이도 혼합 — 쉬움(`<15 min fix`) 3 / 중간(`15 min - 1 hour`) 5 /
 *      어려움(`1-4 hours`) 4. 라운드1(전부 `<15 min fix`)은 **모든 모델이 100%
 *      로 수렴해 변별력이 0** 이었다. 파이프라인은 그 라운드에서 이미 증명됐고,
 *      이 라운드의 목적은 모델을 **가르는 것**이라 난이도를 섞는다.
 *   ③ 버전 4.2 / 5.0 — Python 3.11 에서 도는 세대(3.x 대는 옛 파이썬을 요구).
 *
 * ★이 12개는 사람이 고른 것이 아니라 데이터셋을 프로그램으로 훑어 위 필터로
 * 뽑은 것이다. **손으로 짓거나 고치지 말 것** — id 한 글자만 어긋나도 러너는
 * "데이터셋에 없다"로 죽거나(운이 좋으면) 엉뚱한 인스턴스를 잰다.
 *
 * ★base_commit 을 여기 적지 않는 것은 실수가 아니라 **의도**다. 커밋 SHA 는
 * 데이터셋에서만 읽는다(`dataset.ts`). 손으로 옮겨 적는 순간 오타·환각이
 * 들어오고, 실제로 이 하네스를 만드는 중에 사람이 SHA 뒷자리를 지어낸 사고가
 * 한 번 났다. 사람이 못 적게 하는 것이 유일하게 확실한 방어다.
 */
export const ROUND_A_INSTANCES = [
  // 쉬움 — `<15 min fix`
  "django__django-15851",
  "django__django-15863",
  "django__django-15987",
  // 중간 — `15 min - 1 hour`
  "django__django-15731",
  "django__django-15814",
  "django__django-16136",
  "django__django-16256",
  "django__django-16315",
  // 어려움 — `1-4 hours`
  "django__django-15957",
  "django__django-16263",
  "django__django-16560",
  "django__django-16631",
] as const;

/** 하위호환 별칭. 옛 호출부가 이 이름을 쓴다. */
export const PINNED_INSTANCES = ROUND_A_INSTANCES;

/**
 * ★라운드B(after) — **해상도를 올린 문제셋. N=20.**
 *
 * 이 셋이 어떻게 정해졌는지가 이 라운드의 전부다. 진단 없이 문제를 더 넣은
 * 것이 아니라, 라운드A 실측 120런(frontier 10셀 × 12문제)이 가리킨 세 가지를
 * 그대로 집행한 것이다.
 *
 * ① ★죽은 문제 7개를 뺀다 — 라운드A 에서 frontier 10모델이 **전원 정답**이라
 *    정보를 0 준 문제들: 15731·15814·15851·15863·15957·16136·16560.
 *    이건 난이도 라벨로 자른 것이 아니라 **실측 변별 이력**으로 자른 것이다.
 *
 * ② ★실제로 갈랐던 5개는 남긴다 — 15987(7/10)·16256(4/10)·16263(8/10)·
 *    16315(8/10)·16631(9/10). 이 다섯이 라운드A 의 유효 문제 전부였다.
 *
 * ③ ★난이도 라벨을 믿지 않는다 — 라운드A 에서 라벨별 천장률은
 *    `<15 min fix` 67% / `15 min - 1 hour` 60% / `1-4 hours` 50% 로
 *    기울기가 거의 없었고, **가장 잘 가른 두 문제(16256·16315)가 오히려
 *    `15 min - 1 hour`** 였다. 반대로 `1-4 hours` 인 15957·16560 은 천장이었다.
 *    그래서 "더 어려운 라벨로 채운다" 는 처방을 쓰지 않는다.
 *    대신 python3.11 이 도는 v4.1+ 의 **미사용 `1-4 hours` 4개를 전량** 넣고
 *    (공급이 딱 4개다 — 난이도만으로는 20을 못 채운다는 것이 실측 제약),
 *    나머지는 미사용 `15 min - 1 hour` 로 채운다.
 *
 * ★채우는 순서는 사람이 고르지 않는다 — 데이터셋을 `repo=django/django ∧
 * version∈{4.1,4.2,5.0} ∧ difficulty=='15 min - 1 hour' ∧ 라운드A 미사용`
 * 으로 거른 뒤 **instance_id 오름차순 앞에서부터** 11개를 취했다. 결과를 보고
 * 고르는 여지를 없애기 위한 규칙이고, 이 주석이 그 규칙의 사전등록이다.
 */
export const ROUND_B_INSTANCES = [
  // ── 유지: 라운드A 에서 실제로 모델을 가른 5개 ──
  "django__django-15987",
  "django__django-16256",
  "django__django-16263",
  "django__django-16315",
  "django__django-16631",
  // ── 신규: v4.1+ 미사용 `1-4 hours` 전량(공급 4개가 전부) ──
  "django__django-15128",
  "django__django-15268",
  "django__django-15503",
  "django__django-15629",
  // ── 신규: v4.1 미사용 `15 min - 1 hour`, id 오름차순 앞 11개 ──
  "django__django-14725",
  "django__django-14771",
  "django__django-15022",
  "django__django-15037",
  "django__django-15098",
  "django__django-15103",
  "django__django-15161",
  "django__django-15252",
  "django__django-15278",
  "django__django-15280",
  "django__django-15375",
] as const;

/** `--round=a|b` 로 고르는 사전등록 셋. */
export const ROUNDS: Record<string, readonly string[]> = {
  a: ROUND_A_INSTANCES,
  b: ROUND_B_INSTANCES,
};

/**
 * 스캐폴드 식별자. ★점수는 스캐폴드 없이 해석 불가하므로(feasibility §2-A W5)
 * 모든 결과 행에 박힌다. 배선을 바꾸면 **이 문자열을 반드시 올린다** — 안 올리면
 * 시계열이 조용히 오염된다.
 *
 * ★v2 → v3 변경 사유(둘 다 실제 배선 변경이라 옛 라운드와 합산 금지):
 *   (a) **토큰·비용 계측 추가** — claude 에 `--output-format json`,
 *       codex 에 `--json` 을 붙였다. 모델 행동은 안 바꾸지만 argv 가 바뀌었다.
 *   (b) **CLI 가 올라갔다** — claude 2.1.227→2.1.261, codex 0.147.0→
 *       0.153.3(A)·0.153.4(B) (실행 원장의 `cliVersion`으로 고정 기록).
 *       그래서 비교군(claude-opus-5)의 라운드2 숫자를 재활용하지 않고
 *       **오늘 조건으로 다시 잰다.** 옛 숫자를 새 표에 끌어오면 CLI 차이가
 *       모델 차이로 둔갑한다.
 *
 * ★A/B 를 다른 문자열로 두는 이유: 리포트가 스캐폴드별로 표를 가르므로,
 * 같은 문자열이면 문제셋이 다른 두 라운드가 한 칸에 합산된다.
 */
export function scaffoldFor(round: "a" | "b"): string {
  const base =
    round === "a"
      ? "marblo-swebench-spike/v3a(12-mixed-difficulty,single-shot,no-mcp,no-board,metered)"
      : "marblo-swebench-spike/v3b(20-discrimination-tuned,single-shot,no-mcp,no-board,metered)";
  // 티켓 pW7c7b0p2FdAmhaLj1Xq: Upstage 브리지 on/off 는 배선 변경이라 같은
  // 스캐폴드 문자열에 합산하면 안 된다(§ scaffoldFor 머리말 규율 그대로). 이
  // 축을 쓰는 라운드가 아니면(env 미설정) 문자열이 그대로라 기존 라운드와
  // 호환된다.
  const solarBridgeOverride = process.env.MARBLO_UPSTAGE_NATIVE_RESPONSES;
  if (solarBridgeOverride === "1" || solarBridgeOverride === "true") {
    return base.replace(")", ",solar-native-responses)");
  }
  return base;
}

/** 기본값(라운드A). 옛 호출부 호환. */
export const SCAFFOLD_ID = scaffoldFor("a");

/**
 * ★벤치 단가표 — USD per 1M tokens.
 *
 * `electron/model-registry.ts` 의 `pricing` 과 **같은 값이어야 한다.** 그런데
 * 여기 따로 적는 것은 중복이 아니라 의도다: `agent.ts` 주석이 적어 둔 대로 이
 * 하네스는 제품 코드를 import 하지 않는다(feasibility §4-G — 벤치와 제품 로직의
 * 결합 금지). 대신 **드리프트를 단위테스트가 잡는다** —
 * `tests/unit/bench-usage.test.ts` 가 이 표와 레지스트리를 대조해서, 레지스트리
 * 단가가 바뀌었는데 여기가 안 바뀌면 실패한다.
 *
 * ★두 신형이 같은 값($10/$50)이라는 것이 이 라운드의 출발점이다 — 그래서
 * "얼마에 몇 개를 푸는가" 가 유일한 판별축이 된다.
 */
export const BENCH_PRICES: Record<
  string,
  { inputPer1M: number; outputPer1M: number }
> = {
  "claude-fable-5-1": { inputPer1M: 10, outputPer1M: 50 },
  // ★비교군은 두 신형보다 **싸다**($5/$25). 그래서 "비교군이 비용축에서
  // 유리하게 나왔다" 를 실력으로 읽으면 안 된다 — 리포트가 이 비대칭을 명시한다.
  "claude-opus-5": { inputPer1M: 5, outputPer1M: 25 },
  "gpt-6-astra": { inputPer1M: 10, outputPer1M: 50 },
};

/**
 * ★실행환경 식별자 — 여기에 이 스파이크의 가장 큰 한계가 들어 있다.
 *
 * 공식 SWE-bench 채점은 인스턴스마다 구운 Docker 이미지 안에서 돈다. 이 Mac 에는
 * docker/podman/colima 가 하나도 없어서(2026-08-10 실측) 그 경로를 못 탄다.
 * 대신 base_commit 워크트리 + 네이티브 venv 로 환경을 세운다.
 *
 * 결과적으로 우리 숫자는 **공식 리더보드와 비교 불가**다. 파이썬 패치 버전,
 * 의존 라이브러리 해상도, OS(macOS ARM vs linux x86) 가 전부 다르다. 이 문자열이
 * 리포트에 그대로 찍혀서 그 사실을 숨길 수 없게 만든다.
 */
export const EXEC_ENV_ID = "native-venv/macos-arm64(no-docker)";

/**
 * 채점기 버전. **채점 로직을 바꾸면 반드시 올린다.**
 *
 * v1 → v2 변경 사유: django 테스트 id 가 파이썬 버전에 따라 두 형식으로 찍히는데
 * (`logparse.ts` 참조) v1 은 한쪽만 인식해서, **테스트가 전부 통과했는데도**
 * resolved=false 를 내고 있었다. v2 는 (a) 두 형식을 별칭으로 함께 등록하고
 * (b) 데이터셋 id 와 교집합이 0이면 조용히 0점을 주는 대신 에러로 올린다.
 */
export const GRADER_VERSION = "v2(id-alias+mismatch-gate)";

/**
 * 레포별 환경·테스트 레시피.
 *
 * django 러너 주의점 두 가지(실측으로 확인한 것):
 *   - `--parallel 1` 필수. 기본 병렬이면 출력이 뒤섞여 파싱이 깨진다.
 *   - `--verbosity 2` 필수. 이 레벨에서만 테스트별 `... ok` 줄이 나온다.
 *     (그리고 docstring 이 있는 테스트는 **메서드명이 아니라 docstring** 이
 *      id 로 찍힌다 — 데이터셋의 F2P id 가 실제로 그 형태다. `logparse.ts` 참조)
 */
export const REPO_SPECS: Record<string, RepoSpec> = {
  "django/django": {
    python: process.env.MARBLO_BENCH_PYTHON || "python3.11",
    // `-e .` 로 개발설치 — 에이전트가 소스를 고치면 재설치 없이 반영된다.
    installArgs: ["install", "-e", "."],
    testCwd: "tests",
    testArgs: (directives) => [
      "runtests.py",
      "--verbosity",
      "2",
      "--settings=test_sqlite",
      "--parallel",
      "1",
      ...directives,
    ],
    // tests/responses/test_fileresponse.py → responses.test_fileresponse
    toDirective: (testFile) =>
      testFile
        .replace(/^tests\//, "")
        .replace(/\.py$/, "")
        .replace(/\//g, "."),
    parser: "django",
  },
};

/** 레포 git URL. 얕은 bare 캐시를 만들 때 쓴다. */
export function repoCloneUrl(repo: string): string {
  return `https://github.com/${repo}.git`;
}
