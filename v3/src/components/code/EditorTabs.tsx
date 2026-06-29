import { useCallback } from "react";
import { useEditorStore } from "../../stores/editorStore";
import { useTranslation } from "../../lib/i18n";

export function EditorTabs() {
  const { t } = useTranslation();
  const openFiles = useEditorStore((s) => s.openFiles);
  const activeFilePath = useEditorStore((s) => s.activeFilePath);
  const setActiveFile = useEditorStore((s) => s.setActiveFile);
  const closeFile = useEditorStore((s) => s.closeFile);
  const showDiff = useEditorStore((s) => s.showDiff);
  const toggleDiff = useEditorStore((s) => s.toggleDiff);

  const handleClose = useCallback(
    (e: React.MouseEvent, path: string) => {
      e.stopPropagation();
      closeFile(path);
    },
    [closeFile],
  );

  if (openFiles.length === 0) return null;

  return (
    <div className="flex items-center border-b border-gray-700 bg-gray-800">
      {/* File tabs */}
      <div className="flex flex-1 overflow-x-auto">
        {openFiles.map((file) => {
          const isActive = file.path === activeFilePath;
          return (
            <button
              key={file.path}
              onClick={() => setActiveFile(file.path)}
              className={`group flex items-center gap-1.5 border-r border-gray-700 px-3 py-1.5 text-[13px] ${
                isActive
                  ? "border-b-2 border-b-blue-500 bg-gray-700 text-white"
                  : "text-gray-400 hover:bg-gray-750 hover:text-gray-200"
              }`}
            >
              {/* Modified indicator */}
              {file.isModified && <span className="text-blue-400">●</span>}
              <span className="max-w-[120px] truncate">{file.name}</span>
              {/* Close button */}
              <span
                onClick={(e) => handleClose(e, file.path)}
                className="ml-1 rounded p-0.5 opacity-0 hover:bg-gray-600 group-hover:opacity-100"
              >
                <svg
                  className="h-3 w-3"
                  fill="none"
                  viewBox="0 0 24 24"
                  stroke="currentColor"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M6 18L18 6M6 6l12 12"
                  />
                </svg>
              </span>
            </button>
          );
        })}
      </div>

      {/* Diff toggle */}
      <button
        onClick={toggleDiff}
        className={`mx-1 rounded px-2 py-1 text-[11px] ${
          showDiff
            ? "bg-blue-600 text-white"
            : "text-gray-400 hover:bg-gray-700 hover:text-gray-200"
        }`}
        title={t("code.diffView")}
      >
        Diff
      </button>
    </div>
  );
}
