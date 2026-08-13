// v3/src/lib/taskBody.ts
import type { Task } from "../types/task";

/**
 * 티켓 본문의 **정규화** — 어느 화면이 그리든 같은 정보가 나오도록.
 *
 * ★왜 lib 로 뽑았나: 이 규칙(구조화 섹션이 하나라도 있으면 그것을, 없으면
 * description 을 그린다)이 두 화면에 필요해졌다 — 어드밴스드 `TaskBodySections`
 * 와 심플 모드의 `BeginnerTaskModal`. 두 화면은 **칠만** 다르고(어드밴스드는
 * tailwind gray-*, 심플은 카타푸친 팔레트) 정보는 같아야 한다. 규칙을 각자
 * 들면 한쪽에만 섹션이 추가되는 날이 오고, 그날 심플 모드는 조용히 정보가
 * 빠진 화면이 된다 — 이 티켓이 고치는 결함이 정확히 그것이었다.
 *
 * 여기에는 JSX 가 없다. 그래서 순수 규칙만 따로 테스트할 수 있고, 렌더러는
 * 자기 팔레트만 신경 쓰면 된다.
 */
export interface TaskBodyParts {
  goal: string;
  changes: string[];
  acceptance: string[];
  notes: string[];
  description: string;
  /** 구조화 섹션(goal/changes/acceptance/notes)이 하나라도 있는가. */
  structured: boolean;
}

/** 공백만 있는 항목은 항목이 아니다 — 빈 불릿을 그리지 않기 위해 여기서 턴다. */
export function nonEmptyLines(arr?: string[]): string[] {
  return (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function taskBodyParts(task: Task): TaskBodyParts {
  const goal = task.goal?.trim() ?? "";
  const changes = nonEmptyLines(task.changes);
  const acceptance = nonEmptyLines(task.acceptance);
  const notes = nonEmptyLines(task.notes);
  return {
    goal,
    changes,
    acceptance,
    notes,
    description: task.description ?? "",
    structured: Boolean(
      goal || changes.length || acceptance.length || notes.length,
    ),
  };
}

/** 그릴 본문이 하나라도 있는가(없으면 "설명 추가" 자리를 그린다). */
export function hasAnyBody(task: Task): boolean {
  const parts = taskBodyParts(task);
  return parts.structured || Boolean(parts.description);
}
