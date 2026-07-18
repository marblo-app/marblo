/**
 * Task-type classification for ML labels (`task_outcomes.taskType`).
 *
 * Background: the outcome writer hardcoded `taskType: null` with a
 * "TODO: derive from task metadata" comment, so 29/29 BigQuery rows carried a
 * NULL type and the column was unusable as a training feature. This module is
 * that missing derivation.
 *
 * Design constraints:
 *  - **Pure + deterministic.** No IO, no clock, no LLM call. Same task text
 *    always yields the same label, so a row logged today stays comparable to
 *    one logged in six months. An LLM classifier here would cost money per
 *    task and drift silently between model versions.
 *  - **Derived, never raw.** The return value is one of a small fixed enum —
 *    the ticket text itself never leaves the machine. This keeps the outcome
 *    row inside the same privacy contract as promptHash/promptLength (see
 *    docs/research/routing-slm-data-collection.md §4).
 *  - **Bilingual.** Marblo tickets are written in Korean and English, often
 *    mixed in one title ("fix(v3): 오케 재시작 크래시"). Korean-only or
 *    English-only keyword lists would mislabel most of the real corpus.
 *
 * Ordering matters: the first matching category wins, so the list runs from
 * most-specific to most-generic. "테스트 실패 수정" is a bug-fix, not a test
 * task — bug-fix is checked first for exactly that reason.
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
 * training set. Downstream treats NULL as "unlabeled" and can drop the row.
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
