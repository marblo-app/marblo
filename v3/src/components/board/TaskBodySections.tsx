// v3/src/components/board/TaskBodySections.tsx
import type { Task } from "../../types/task";
import { useTranslation } from "../../lib/i18n";
import { taskBodyParts } from "../../lib/taskBody";

// 규칙(무엇이 본문인가)은 lib/taskBody 한 곳에만 있다 — 심플 모드의 티켓
// 상세가 같은 규칙으로 같은 정보를 그린다. 여기 남은 건 어드밴스드 보드의
// **칠**뿐이다. 기존 임포트 경로(`./TaskBodySections`)를 깨지 않게 재수출한다.
export { hasAnyBody } from "../../lib/taskBody";

export function TaskBodySections({ task }: { task: Task }) {
  const { t } = useTranslation();
  const { goal, changes, acceptance, notes, description, structured } =
    taskBodyParts(task);

  if (!structured) {
    if (!description) return null;
    return (
      <div>
        <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
          Description
        </h3>
        <p className="text-sm text-gray-300 whitespace-pre-wrap">
          {description}
        </p>
      </div>
    );
  }
  return (
    <div className="space-y-3">
      {goal && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {t("board.section.goal")}
          </h3>
          <p className="text-sm text-gray-200 whitespace-pre-wrap">{goal}</p>
        </section>
      )}
      {changes.length > 0 && (
        <section>
          <h3 className="text-xs font-medium text-gray-400 uppercase mb-1">
            {t("board.section.changes")}
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
            {t("board.section.acceptance")}
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
            {t("board.section.notes")}
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
