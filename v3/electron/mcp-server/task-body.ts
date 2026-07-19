// v3/electron/task-body.ts

/** 섹션 라벨 (UI 렌더러와 동일 라벨 유지). */
export const SECTION_LABELS = {
  goal: "목표",
  changes: "변경·접근",
  acceptance: "완료 기준",
  notes: "제약·주의",
} as const;

export interface TaskBodyFields {
  goal?: string;
  changes?: string[];
  acceptance?: string[];
  notes?: string[];
  /** legacy 자유서술 — 구조화 필드가 없을 때만 사용. */
  description?: string;
}

/** 섹션 필드로 허용되는 입력 형태. MCP 경계에서 오는 값은 실제로는 unknown 이라
 * 선언 타입을 믿을 수 없다 — validateTaskBodySections 로 먼저 거르되, 여기서도
 * 절대 throw 하지 않는다. */
export const SECTION_ARRAY_FIELDS = ["changes", "acceptance", "notes"] as const;

/**
 * 섹션 배열 정규화. 입력이 배열이 아니어도 **절대 throw 하지 않는다.**
 *
 * 티켓 20GMXojE9iHf5giBckOR: tools.ts 의 create_tasks_bulk 는 MCP 로 들어온
 * Record<string, unknown> 을 `as string[]` 로 무검증 캐스팅해 넘긴다. 호출자가
 * changes 를 문자열로 주면 여기서 "(arr ?? []).map is not a function" TypeError 가
 * 났고, per-item try/catch 가 없어 배치 전체가 죽었다. 한 항목의 타입 실수가
 * 나머지 49건을 날리는 건 어떤 경우에도 옳지 않으므로 이 함수는 안전망으로
 * 남긴다 — 사용자에게 보이는 계약은 validateTaskBodySections 가 강제한다.
 */
function nonEmpty(arr: unknown): string[] {
  // 문자열 한 개는 한 줄짜리 섹션이라는 뜻으로 받는다(명백한 의도).
  const list = Array.isArray(arr) ? arr : typeof arr === "string" ? [arr] : [];
  return list
    .filter((s): s is string => typeof s === "string")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * 섹션 필드의 타입 계약 검증. 위반이면 **필드명과 기대 타입을 담은 실행 가능한**
 * 메시지를, 정상이면 null 을 돌려준다. tools.ts 의 role/priority 검증과 같은
 * 자리에서 per-item 으로 호출해, 잘못된 항목만 실패시키고 배치는 계속하게 한다.
 */
export function validateTaskBodySections(t: TaskBodyFields): string | null {
  for (const field of SECTION_ARRAY_FIELDS) {
    const v = (t as Record<string, unknown>)[field];
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      const bad = v.findIndex((s) => typeof s !== "string");
      if (bad >= 0) {
        return `${field}[${bad}] 는 문자열이어야 합니다 (받은 값: ${typeof v[bad]}). ${field} 는 문자열 배열입니다 — 예: "${field}": ["첫 항목", "둘째 항목"]`;
      }
      continue;
    }
    return `${field} 는 문자열 배열이어야 합니다 (받은 값: ${typeof v}). 예: "${field}": ["첫 항목", "둘째 항목"]${
      typeof v === "string"
        ? ` — 한 줄이면 ["${String(v).slice(0, 40)}"] 처럼 배열로 감싸세요.`
        : ""
    }`;
  }
  return null;
}

/** 구조화 섹션 중 하나라도 내용이 있으면 true. */
export function hasStructuredBody(t: TaskBodyFields): boolean {
  return Boolean(
    (t.goal && t.goal.trim()) ||
    nonEmpty(t.changes).length ||
    nonEmpty(t.acceptance).length ||
    nonEmpty(t.notes).length,
  );
}

/** 구조화 필드 → 에이전트/플랫 텍스트 본문. 빈 섹션은 헤더째 생략. 구조화 필드가 없으면 legacy description. */
export function composeTaskBody(t: TaskBodyFields): string {
  if (!hasStructuredBody(t)) return (t.description ?? "").trim();
  const blocks: string[] = [];
  if (t.goal && t.goal.trim()) {
    blocks.push(`## ${SECTION_LABELS.goal}\n${t.goal.trim()}`);
  }
  const changes = nonEmpty(t.changes);
  if (changes.length) {
    blocks.push(
      `## ${SECTION_LABELS.changes}\n${changes.map((c) => `- ${c}`).join("\n")}`,
    );
  }
  const acceptance = nonEmpty(t.acceptance);
  if (acceptance.length) {
    blocks.push(
      `## ${SECTION_LABELS.acceptance}\n${acceptance.map((a) => `- [ ] ${a}`).join("\n")}`,
    );
  }
  const notes = nonEmpty(t.notes);
  if (notes.length) {
    blocks.push(
      `## ${SECTION_LABELS.notes}\n${notes.map((n) => `- ${n}`).join("\n")}`,
    );
  }
  return blocks.join("\n\n");
}

/** create_task 입력 검증. error 면 차단, warning 은 안내. */
export function validateTaskBodyInput(t: TaskBodyFields): {
  error?: string;
  warning?: string;
} {
  const structured = hasStructuredBody(t);
  if (!structured && !(t.description && t.description.trim())) {
    return { error: "goal (또는 legacy description) is required." };
  }
  if (structured && nonEmpty(t.acceptance).length === 0) {
    return {
      warning:
        "완료 기준(acceptance)이 비어 있습니다 — 검증 가능한 항목을 추가하세요.",
    };
  }
  return {};
}

/** Firestore 저장용 본문 필드 부분집합. 구조화면 4필드 + description:"" , legacy면 description 만. */
export function taskBodyStorageFields(
  t: TaskBodyFields,
): Record<string, unknown> {
  if (hasStructuredBody(t)) {
    return {
      goal: t.goal?.trim() ?? "",
      changes: nonEmpty(t.changes),
      acceptance: nonEmpty(t.acceptance),
      notes: nonEmpty(t.notes),
      description: "",
    };
  }
  return { description: (t.description ?? "").trim() };
}
