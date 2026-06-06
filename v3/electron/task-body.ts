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

function nonEmpty(arr: string[] | undefined): string[] {
  return (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
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
