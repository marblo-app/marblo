/**
 * Task-type classification — **main/MCP 쪽 미러** of
 * `src/lib/telemetry/taskType.ts`.
 *
 * ── 왜 미러인가 (P2-1) ──────────────────────────────────────────────────
 * PR#596 이 "지식그래프 콜드시드·학습 축이 complexity 뿐" 의 진범으로 지목한 것이
 * 이 경계다: 라우팅의 taskType 축은 자료구조·시드·집계에 다 있는데 **읽기 경로에서
 * 값이 만들어지지 않아** 항상 비어 있었다. 근거는 종전 코드 주석 세 곳이 그대로
 * 남겨 놓았다 —
 *   - `bridge-server.persistDispatchMeta`: "taskType intentionally omitted here:
 *     electron can't import the src classifyTaskType() (module-boundary)"
 *   - `graph-updater.ts` 헤더의 Boundary note
 *   - `scripts/seed-routing-graph.ts`: "Seeding `taskType:*` would be inert"
 *
 * 이 repo 는 `src/`(vite 렌더러)와 `electron/`(main) 사이에 cross-import 를 두지
 * 않는 규율이 있고(`src/lib/rootPathScope.ts`·`src/stores/orchestratorStore.ts`
 * 주석), MCP 서버는 그보다 더 좁다 — `electron/mcp-server/tsconfig.json` 의
 * `rootDir: "."` 때문에 상위 디렉터리 모듈을 아예 import 할 수 없다. 그래서
 * 선택지는 (a) 미러 + 패리티 테스트, (b) 축을 계속 죽여 두기 뿐이었고, 이미
 * 같은 문제를 같은 방식으로 푼 선례가 있다(`mcp-server/escalation-approval.ts` 의
 * 상수 미러 ↔ `model-ladder.assertMirrorsMatch`).
 *
 * ★위치가 `mcp-server/` 인 이유: 여기 두면 **한 벌**로 끝난다. mcp-server 는 상위를
 * import 할 수 없지만 `electron/` 은 `electron/mcp-server/*` 를 import 할 수 있어
 * (`model-ladder.ts` 가 이미 그렇게 한다) MCP·bridge 양쪽이 같은 구현을 쓴다.
 *
 * ★고치는 규칙: 규칙(RULES/CONVENTIONAL_MAP)을 한쪽만 바꾸면 라벨이 갈라지고,
 * 갈라진 라벨은 그래프 셀을 조용히 쪼갠다. `tests/unit/task-type-parity.test.ts`
 * 가 두 구현을 같은 코퍼스로 대조해 그 드리프트를 깨뜨린다.
 *
 * 아래 규칙 본문은 `src/lib/telemetry/taskType.ts` 와 문자 단위로 같아야 한다.
 * (설계 의도·순서 근거는 그 파일의 모듈 주석에 있다: 순수·결정적, 파생값만,
 * 한/영 이중언어, 그리고 "가장 구체적인 것부터" 순서.)
 */

export type TaskType =
  | "bug-fix"
  | "feature"
  | "refactor"
  | "test"
  | "docs"
  | "infra"
  | "chore";

/** All values `classifyTaskType` can return, for test + analysis use. */
export const TASK_TYPES: readonly TaskType[] = [
  "bug-fix",
  "feature",
  "refactor",
  "test",
  "docs",
  "infra",
  "chore",
] as const;

/**
 * Ordered rules. First hit wins — see the ordering note in the module doc.
 * Patterns are matched case-insensitively against `title + goal + description`.
 */
const RULES: ReadonlyArray<{ type: TaskType; patterns: RegExp }> = [
  {
    // Checked first: a bug in tests / docs / infra is still a bug-fix.
    type: "bug-fix",
    patterns:
      /\b(bug|bugfix|fix|hotfix|patch|crash|broken|regression|defect|repair)\b|버그|결함|수정|고치|깨[짐진]|크래시|장애|오류|에러|이슈|오작동|재현|핫픽스/i,
  },
  {
    type: "refactor",
    patterns:
      /\b(refactor|refactoring|cleanup|clean[- ]?up|rewrite|restructure|simplif\w*|dedupe|deduplicate|extract|rename|migrate|migration)\b|리팩[토터]|정리|재작성|재구성|단순화|구조\s*개선|이관|마이그/i,
  },
  {
    type: "test",
    patterns:
      /\b(test|tests|testing|spec|specs|coverage|e2e|unit[- ]?test|integration[- ]?test|qa)\b|테스트|검증|커버리지|회귀\s*테스트/i,
  },
  {
    type: "docs",
    patterns:
      /\b(docs?|documentation|readme|changelog|comment|guide|manual|spec[- ]?doc)\b|문서|설명서|주석|가이드|릴리스\s*노트|리포트온리/i,
  },
  {
    type: "infra",
    patterns:
      /\b(ci|cd|pipeline|deploy|deployment|release|build|docker|k8s|kubernetes|terraform|infra|infrastructure|monitoring|telemetry|observability|alert|rollout|provision\w*)\b|배포|릴리[스즈]|빌드|인프라|파이프라인|모니터링|텔레메트리|관측|배선/i,
  },
  {
    type: "feature",
    patterns:
      /\b(feat|feature|add|implement|introduce|support|new|create|build out|enable)\b|기능|추가|구현|신규|도입|지원|만들|개발/i,
  },
  {
    type: "chore",
    patterns:
      /\b(chore|bump|upgrade|update|dependency|dependencies|deps|lint|format|version|config|configuration|housekeeping)\b|의존성|업그레이드|버전|설정|포매팅|린트|잡무/i,
  },
];

/** Conventional-commit style prefix, e.g. "fix(v3): ...", "feat: ...". */
const CONVENTIONAL_PREFIX =
  /^\s*(feat|fix|refactor|test|docs|chore|ci|build|perf|style)\b/i;

const CONVENTIONAL_MAP: Record<string, TaskType> = {
  feat: "feature",
  fix: "bug-fix",
  refactor: "refactor",
  test: "test",
  docs: "docs",
  chore: "chore",
  ci: "infra",
  build: "infra",
  perf: "refactor",
  style: "refactor",
};

/** Task fields the classifier reads. Structural subset of `Task`. */
export interface ClassifiableTask {
  title?: string | null;
  goal?: string | null;
  description?: string | null;
}

/**
 * Best-effort task-type label, or `null` when nothing matches.
 *
 * `null` is a deliberate outcome, not a failure: a task titled "TASK-1234"
 * carries no signal, and guessing "feature" for it would inject noise into the
 * training set (and, here, into the routing graph's taskType cells).
 */
export function classifyTaskType(task: ClassifiableTask): TaskType | null {
  const title = (task.title ?? "").trim();

  // A conventional-commit prefix is an explicit author declaration — trust it
  // over keyword inference. "fix(v3): 문서 오타" is a fix, not a docs task.
  const prefixMatch = CONVENTIONAL_PREFIX.exec(title);
  if (prefixMatch) {
    const mapped = CONVENTIONAL_MAP[prefixMatch[1].toLowerCase()];
    if (mapped) return mapped;
  }

  // Title carries the most signal; goal and description broaden recall for
  // tickets whose title is just an identifier.
  const haystack = [title, task.goal ?? "", task.description ?? ""]
    .filter(Boolean)
    .join("\n");

  if (!haystack.trim()) return null;

  for (const rule of RULES) {
    if (rule.patterns.test(haystack)) return rule.type;
  }
  return null;
}

/**
 * 외부에서 받은 taskType 문자열을 그래프 축으로 쓸 수 있게 정돈한다.
 *
 * 왜 자유문자열을 그냥 받지 않는가: cell key 의 factorValue 가 되므로 공백·대소문자
 * 차이만으로 셀이 쪼개진다("Bug-Fix" ≠ "bug-fix"). 그리고 **미지 라벨은 통과시킨다**
 * — merge 경로가 넘기는 de-identified `changeType`(main.ts foldMergeOutcome)처럼
 * 이 enum 밖의 정당한 라벨이 이미 있어서, 여기서 걸러내면 그 학습이 사라진다.
 */
export function normalizeTaskTypeLabel(
  raw: string | null | undefined,
): string | undefined {
  const value = (raw ?? "").trim().toLowerCase();
  return value ? value : undefined;
}
