/**
 * SWE-bench 자체 실측 harness — 공용 타입.
 *
 * ★이 하네스가 내는 숫자는 전부 `our-measured` 라벨을 달고, 벤더 공개치
 * (`electron/model-bench-reference.ts`)와 **절대 같은 표에 섞지 않는다.**
 * 이유는 하나가 아니라 둘이다:
 *   (a) 표본이 tiny N 이라 리더보드 수치와 통계적 성격이 다르다
 *   (b) ★우리 실행환경이 공식 SWE-bench Docker 이미지가 아니다(§ExecEnv)
 * 둘 중 (b) 가 더 치명적이다 — 같은 인스턴스라도 환경이 다르면 점수가
 * 움직이므로, 우리 숫자는 "공식 리더보드보다 높다/낮다"를 말할 수 없다.
 * 말할 수 있는 것은 **우리 환경 안에서 하네스·모델 간 상대 비교**뿐이다.
 */

/** 이 하네스가 태울 수 있는 스폰 경로. `gold` 는 무과금 자체검증용. */
export type BenchHarness = "claude" | "codex" | "gold" | "noop";

/**
 * SWE-bench 데이터셋 1행. HuggingFace `princeton-nlp/SWE-bench_Verified` 의
 * 컬럼명을 **그대로** 쓴다(리네이밍 금지) — 원본과 대조할 때 이름이 어긋나면
 * 추적이 불가능해진다.
 */
export interface SweInstance {
  instance_id: string;
  repo: string;
  /** 에이전트가 작업을 시작하는 커밋. ★절대 손으로 적지 않는다(§dataset). */
  base_commit: string;
  environment_setup_commit: string;
  version: string;
  problem_statement: string;
  /** 정답 패치(gold). 에이전트에게 보여주지 않는다. */
  patch: string;
  /** 채점용 테스트 패치. ★에이전트 실행이 끝난 뒤에 적용한다. */
  test_patch: string;
  FAIL_TO_PASS: string[];
  PASS_TO_PASS: string[];
  difficulty: string;
}

/** 로그 파서 종류 — 레포마다 테스트 러너 출력 형식이 다르다. */
export type LogParserKind = "django" | "pytest";

/**
 * 레포별 환경 레시피. 공식 하네스는 이걸 Docker 이미지로 굽지만, 우리는
 * Docker 가 없는 환경에서 네이티브 venv 로 세운다(§ExecEnv 한계 참조).
 */
export interface RepoSpec {
  /** `python3.11` 처럼 PATH 또는 절대경로로 해석 가능한 인터프리터. */
  python: string;
  /** venv 안에서 레포를 설치하는 명령. 레포 루트에서 실행된다. */
  installArgs: string[];
  /** 테스트 러너를 실행할 작업 디렉터리(레포 루트 기준 상대경로). */
  testCwd: string;
  /** 테스트 러너 argv 를 만든다. `directives` 는 test_patch 에서 유도된다. */
  testArgs: (directives: string[]) => string[];
  /** test_patch 가 건드린 파일 경로 → 러너가 받는 지시자로 변환. */
  toDirective: (testFile: string) => string;
  parser: LogParserKind;
}

/** 테스트 로그 파싱 결과 — 테스트 id → 상태. */
export type TestStatusMap = Record<
  string,
  "PASSED" | "FAILED" | "ERROR" | "SKIPPED"
>;

/** 채점 결과. */
export interface Grade {
  /** ★공식 기준과 동일: F2P 전부 통과 ∧ P2P 전부 통과. */
  resolved: boolean;
  f2pPassed: number;
  f2pTotal: number;
  p2pPassed: number;
  p2pTotal: number;
  /** 통과하지 못한 테스트 id(진단용, 최대 20개로 자름). */
  missing: string[];
}

/** 에이전트 1회 실행의 관측치. */
export interface AgentRun {
  /** 스폰한 argv 전문 — 재현성의 핵심이라 반드시 기록한다. */
  command: string;
  args: string[];
  exitCode: number | null;
  durationMs: number;
  /** 에이전트가 만든 diff(테스트 파일 제외). 빈 문자열이면 무산출. */
  patch: string;
  /** ★무산출 축 — feasibility 문서 §4-C 가 "숨은 핵심"이라 부른 그 축. */
  noOutput: boolean;
  timedOut: boolean;
  /** stdout 꼬리(진단용). 프롬프트·원문 전체는 저장하지 않는다. */
  tailLog: string;
}

/**
 * 결과 1행. `label: "our-measured"` 는 장식이 아니라 **분리 계약**이다 —
 * 이 필드가 없는 행은 리포트 생성기가 거부한다.
 */
export interface RunRecord {
  label: "our-measured";
  /** 실행 묶음 식별자(같은 라운드의 런들이 공유). */
  runId: string;
  /** ISO8601 UTC. */
  startedAt: string;
  dataset: string;
  instanceId: string;
  repo: string;
  baseCommit: string;
  harness: BenchHarness;
  /** 하네스에 핀한 모델 id(있으면). 없으면 CLI 기본값을 썼다는 뜻. */
  model: string | null;
  /** codex 의 reasoning effort. claude 경로에선 null. */
  effort: string | null;
  /** 스캐폴드 식별자 — 점수는 스캐폴드 없이 해석 불가(§W5). */
  scaffold: string;
  /** 실행환경 식별자. 공식 Docker 가 아님을 이 값이 드러낸다. */
  execEnv: string;
  /**
   * ★채점기 버전. 스캐폴드(에이전트 배선)와 **별개 축**이다.
   *
   * 채점 로직이 바뀌면 그 전후 결과는 같은 셀에 들어가면 안 된다. 실제로 이
   * 하네스 초기에 테스트 id 형식 버그가 있던 채점기로 돈 gold 런이 있었고,
   * 이 필드가 없으면 그 런이 수정 후 런과 **한 칸에 합산**돼 "gold 6런 중 4런
   * 통과" 같은 거짓 표가 만들어진다. 셀 키에 포함시켜 구조적으로 막는다.
   * (이 필드가 없는 옛 행은 리포트에서 `v1(pre-fix)` 로 따로 표시된다.)
   */
  graderVersion: string;
  cliVersion: string | null;
  agent: AgentRun | null;
  grade: Grade | null;
  /** 파이프라인이 채점 전에 깨졌으면 그 이유. 채점 실패와 구분된다. */
  error: string | null;
}
