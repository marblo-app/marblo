// v3/src/components/board/TaskBodySections.tsx
import type { Task } from "../../types/task";

const LABELS = {
  goal: "목표",
  changes: "변경·접근",
  acceptance: "완료 기준",
  notes: "제약·주의",
} as const;

function nonEmpty(arr?: string[]): string[] {
  return (arr ?? []).map((s) => s.trim()).filter((s) => s.length > 0);
}

export function hasAnyBody(task: Task): boolean {
  return Boolean(
    task.goal?.trim() ||
    nonEmpty(task.changes).length ||
    nonEmpty(task.acceptance).length ||
    nonEmpty(task.notes).length ||
    task.description,
  );
}

function isStructured(task: Task): boolean {
  return Boolean(
    task.goal?.trim() ||
    nonEmpty(task.changes).length ||
    nonEmpty(task.acceptance).length ||
    nonEmpty(task.notes).length,
  );
}

export function TaskBodySections({ task }: { task: Task }) {
  if (!isStructured(task)) {
    if (!task.description) return null;
    return (
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
          Description
        </h3>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">
          {task.description}
        </p>
      </div>
    );
  }
  const changes = nonEmpty(task.changes);
  const acceptance = nonEmpty(task.acceptance);
  const notes = nonEmpty(task.notes);
  return (
    <div className="space-y-3">
      {task.goal?.trim() && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.goal}
          </h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">
            {task.goal}
          </p>
        </section>
      )}
      {changes.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.changes}
          </h3>
          <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-300">
            {changes.map((c, i) => (
              <li key={i}>{c}</li>
            ))}
          </ul>
        </section>
      )}
      {acceptance.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.acceptance}
          </h3>
          <ul className="space-y-0.5 text-sm text-gray-300">
            {acceptance.map((a, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-gray-500">☐</span>
                <span>{a}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
      {notes.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {LABELS.notes}
          </h3>
          <ul className="list-disc list-inside space-y-0.5 text-sm text-gray-400">
            {notes.map((n, i) => (
              <li key={i}>{n}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
