import type { ProjectKind } from "../../types/project";
import { PROJECT_KINDS } from "../../lib/projectKind";
import { useTranslation } from "../../lib/i18n";

interface ProjectKindPickerProps {
  value: ProjectKind;
  onChange: (kind: ProjectKind) => void;
  /** compact = 인라인 배너/헤더 드롭다운용 */
  compact?: boolean;
  id?: string;
}

/**
 * 프로젝트 생성 시 kind 선택 — dev(개발) | assistant(비서).
 * 기본은 dev. 헤더 "새 프로젝트"·폴더 연결 인라인 배너가 공유한다.
 */
export function ProjectKindPicker({
  value,
  onChange,
  compact = false,
  id = "project-kind-picker",
}: ProjectKindPickerProps) {
  const { t } = useTranslation();

  return (
    <div
      className={
        compact
          ? "flex items-center gap-1"
          : "flex flex-col gap-1"
      }
      role="radiogroup"
      aria-label={t("header.projectKind.label")}
      data-testid="project-kind-picker"
    >
      {!compact && (
        <span className="text-[10px] font-medium uppercase tracking-wide text-gray-500">
          {t("header.projectKind.label")}
        </span>
      )}
      <div className="flex gap-1">
        {PROJECT_KINDS.map((kind) => {
          const selected = value === kind;
          const label =
            kind === "dev"
              ? t("header.projectKind.dev")
              : t("header.projectKind.assistant");
          const hint =
            kind === "dev"
              ? t("header.projectKind.devHint")
              : t("header.projectKind.assistantHint");
          return (
            <button
              key={kind}
              id={`${id}-${kind}`}
              type="button"
              role="radio"
              aria-checked={selected}
              title={hint}
              data-testid={`project-kind-${kind}`}
              onClick={() => onChange(kind)}
              className={
                compact
                  ? `rounded px-2 py-1 text-[11px] transition-colors ${
                      selected
                        ? "bg-blue-600 text-white"
                        : "bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200"
                    }`
                  : `flex-1 rounded border px-2 py-1.5 text-left text-[11px] transition-colors ${
                      selected
                        ? "border-blue-500 bg-blue-600/20 text-blue-200"
                        : "border-gray-600 bg-gray-800 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                    }`
              }
            >
              <span className="font-medium">{label}</span>
              {!compact && (
                <span className="mt-0.5 block text-[10px] opacity-80">
                  {hint}
                </span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
