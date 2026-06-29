import { useState, useEffect } from "react";
import { DiffEditor } from "@monaco-editor/react";
import { useTranslation } from "../../lib/i18n";

interface DiffViewerProps {
  filePath: string;
  language: string;
  currentContent: string;
}

export function DiffViewer({
  filePath,
  language,
  currentContent,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const [original, setOriginal] = useState<string>("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);

    window.electronAPI.fs
      .gitDiff(filePath)
      .then((result) => {
        if (!cancelled) {
          setOriginal(result.original);
          setLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setOriginal("");
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-gray-500">
        {t("code.diffLoading")}
      </div>
    );
  }

  return (
    <DiffEditor
      height="100%"
      language={language}
      original={original}
      modified={currentContent}
      theme="vs-dark"
      options={{
        readOnly: true,
        minimap: { enabled: false },
        fontSize: 13,
        lineHeight: 20,
        scrollBeyondLastLine: false,
        renderSideBySide: true,
        automaticLayout: true,
      }}
    />
  );
}
