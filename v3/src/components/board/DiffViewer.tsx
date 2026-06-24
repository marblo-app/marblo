import { useEffect, useMemo, useState } from "react";
import { useTranslation } from "../../lib/i18n";

interface DiffViewerProps {
  diff: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

interface DiffSection {
  id: string;
  title: string;
  lines: string[];
  additions: number;
  deletions: number;
}

function parseDiff(diff: string): { summary: string[]; files: DiffSection[] } {
  const summary: string[] = [];
  const files: DiffSection[] = [];
  let current: DiffSection | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const title = match?.[2] ?? line.replace(/^diff --git\s+/, "");
      current = {
        id: `${files.length}:${title}`,
        title,
        lines: [line],
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!current) {
      if (line.trim()) summary.push(line);
      continue;
    }

    current.lines.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions++;
    }
  }

  if (current) files.push(current);
  return { summary, files };
}

function lineClassName(line: string): string {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-emerald-500/10 text-emerald-200";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-red-500/10 text-red-200";
  }
  if (line.startsWith("@@")) {
    return "bg-blue-500/10 text-blue-200";
  }
  if (
    line.startsWith("diff --git") ||
    line.startsWith("index ") ||
    line.startsWith("+++") ||
    line.startsWith("---") ||
    line.startsWith("new file mode") ||
    line.startsWith("deleted file mode")
  ) {
    return "text-gray-400";
  }
  return "text-gray-300";
}

export function DiffViewer({
  diff,
  loading = false,
  error = null,
  onRetry,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const { summary, files } = useMemo(() => parseDiff(diff), [diff]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());

  useEffect(() => {
    setCollapsed(new Set());
  }, [diff]);

  if (loading) {
    return (
      <div className="rounded border border-gray-700/60 bg-gray-900/50 px-3 py-4 text-center text-xs text-gray-500">
        {t("board.diff.loading")}
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded border border-red-500/30 bg-red-500/10 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-red-200">{error}</p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="flex-shrink-0 rounded border border-red-400/30 px-2 py-1 text-xs text-red-100 hover:bg-red-400/10"
            >
              {t("board.diff.retry")}
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!diff.trim()) {
    return (
      <div className="rounded border border-gray-700/60 bg-gray-900/50 px-3 py-4 text-center text-xs text-gray-500">
        {t("board.diff.empty")}
      </div>
    );
  }

  const totals = files.reduce(
    (acc, file) => ({
      additions: acc.additions + file.additions,
      deletions: acc.deletions + file.deletions,
    }),
    { additions: 0, deletions: 0 },
  );

  const toggleFile = (id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">
          {t("board.diff.fileCount", { count: files.length })}
        </span>
        <span className="font-mono text-emerald-300">+{totals.additions}</span>
        <span className="font-mono text-red-300">-{totals.deletions}</span>
      </div>

      {summary.length > 0 && (
        <pre className="max-h-32 overflow-auto rounded border border-gray-700/60 bg-gray-950/60 p-2 font-mono text-[11px] leading-snug text-gray-400">
          {summary.join("\n")}
        </pre>
      )}

      {files.map((file) => {
        const isCollapsed = collapsed.has(file.id);
        return (
          <div
            key={file.id}
            className="overflow-hidden rounded border border-gray-700/60 bg-gray-900/60"
          >
            <button
              type="button"
              onClick={() => toggleFile(file.id)}
              className="flex w-full items-center gap-2 border-b border-gray-700/60 px-3 py-2 text-left hover:bg-gray-800/70"
              title={file.title}
            >
              <span className="w-4 flex-shrink-0 text-gray-500">
                {isCollapsed ? ">" : "v"}
              </span>
              <span className="min-w-0 flex-1 truncate font-mono text-xs text-gray-200">
                {file.title}
              </span>
              <span className="font-mono text-xs text-emerald-300">
                +{file.additions}
              </span>
              <span className="font-mono text-xs text-red-300">
                -{file.deletions}
              </span>
            </button>

            {!isCollapsed && (
              <pre className="max-h-96 overflow-auto bg-gray-950/70 py-2 font-mono text-[11px] leading-snug">
                {file.lines.map((line, index) => (
                  <div
                    key={`${file.id}:${index}`}
                    className={`min-w-max px-3 whitespace-pre ${lineClassName(
                      line,
                    )}`}
                  >
                    {line || " "}
                  </div>
                ))}
              </pre>
            )}
          </div>
        );
      })}
    </div>
  );
}
