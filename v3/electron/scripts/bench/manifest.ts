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
 * ★고정 tiny N. 선정 기준(결과를 보기 전에 정한 것):
 *   ① `django/django` — Verified 500개 중 231개(46%)로 최대 레포이고,
 *      **서드파티 의존이 없어** Docker 없이 네이티브로 세울 수 있는 유일한
 *      대형 레포다(sympy 는 mpmath 하나로 가능하나 러너 출력 파싱이 더 험하다).
 *   ② `difficulty === "<15 min fix"` — P1 스파이크는 파이프라인을 증명하는 게
 *      목적이지 모델을 변별하는 게 목적이 아니다. 쉬운 문제여야 "실패 = 파이프
 *      라인 결함" 과 "실패 = 모델 능력" 이 덜 섞인다.
 *   ③ P2P 개수 3~40 — 채점 신호가 있으면서 러너 실행이 몇 초에 끝나는 구간.
 *   ④ 버전 4.2 / 5.0 — Python 3.11 에서 도는 세대(3.x 대는 옛 파이썬을 요구).
 *
 * ★base_commit 을 여기 적지 않는 것은 실수가 아니라 **의도**다. 커밋 SHA 는
 * 데이터셋에서만 읽는다(`dataset.ts`). 손으로 옮겨 적는 순간 오타·환각이
 * 들어오고, 실제로 이 하네스를 만드는 중에 사람이 SHA 뒷자리를 지어낸 사고가
 * 한 번 났다. 사람이 못 적게 하는 것이 유일하게 확실한 방어다.
 */
export const PINNED_INSTANCES = [
  "django__django-16642",
  "django__django-16429",
  "django__django-15851",
] as const;

/**
 * 스캐폴드 식별자. ★점수는 스캐폴드 없이 해석 불가하므로(feasibility §2-A W5)
 * 모든 결과 행에 박힌다. 배선을 바꾸면 **이 문자열을 반드시 올린다** — 안 올리면
 * 시계열이 조용히 오염된다.
 */
export const SCAFFOLD_ID =
  "marblo-swebench-spike/v1(single-shot,no-mcp,no-board)";

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
