import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "../../lib/i18n";
import { useOrchestratorDiffComment } from "../../hooks/useOrchestratorDiffComment";
import {
  annotateDiffLines,
  buildRangeFromSelection,
  formatRangeLabel,
  type AnnotatedDiffLine,
} from "../../lib/diffComment";

interface DiffViewerProps {
  diff: string;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}

interface DiffSection {
  id: string;
  title: string;
  lines: AnnotatedDiffLine[];
  additions: number;
  deletions: number;
}

function parseDiff(diff: string): { summary: string[]; files: DiffSection[] } {
  const summary: string[] = [];
  const files: Array<Omit<DiffSection, "lines"> & { raw: string[] }> = [];
  let current: (Omit<DiffSection, "lines"> & { raw: string[] }) | null = null;

  for (const line of diff.split("\n")) {
    if (line.startsWith("diff --git ")) {
      if (current) files.push(current);
      const match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
      const title = match?.[2] ?? line.replace(/^diff --git\s+/, "");
      current = {
        id: `${files.length}:${title}`,
        title,
        raw: [line],
        additions: 0,
        deletions: 0,
      };
      continue;
    }

    if (!current) {
      if (line.trim()) summary.push(line);
      continue;
    }

    current.raw.push(line);
    if (line.startsWith("+") && !line.startsWith("+++")) {
      current.additions++;
    } else if (line.startsWith("-") && !line.startsWith("---")) {
      current.deletions++;
    }
  }

  if (current) files.push(current);
  return {
    summary,
    files: files.map(({ raw, ...rest }) => ({
      ...rest,
      lines: annotateDiffLines(raw),
    })),
  };
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

/** Resolve a DOM node inside the diff back to the line it belongs to. */
function lineIndexOf(node: Node | null, fileId: string): number | null {
  const start =
    node instanceof HTMLElement ? node : (node?.parentElement ?? null);
  const el = start?.closest<HTMLElement>("[data-line-index]");
  if (!el || el.dataset.fileId !== fileId) return null;
  const index = Number(el.dataset.lineIndex);
  return Number.isFinite(index) ? index : null;
}

/**
 * The drag-selected span inside `fileId`, or null when there is no usable
 * selection (collapsed, or it spills outside this file's block).
 */
function readSelectedSpan(fileId: string): { lo: number; hi: number } | null {
  const sel = typeof window !== "undefined" ? window.getSelection() : null;
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return null;
  const a = lineIndexOf(sel.anchorNode, fileId);
  const b = lineIndexOf(sel.focusNode, fileId);
  if (a === null || b === null) return null;
  return { lo: Math.min(a, b), hi: Math.max(a, b) };
}

interface MenuState {
  x: number;
  y: number;
  fileId: string;
  lo: number;
  hi: number;
}

/**
 * Unified-diff renderer for a pre-computed diff string (task detail + work
 * history), now with "select code → right-click → comment to the orchestrator".
 *
 * Why right-click and not a gutter click (which is what the Monaco-based
 * DiffSurface offers): a gutter click is invisible — nobody discovers it —
 * and it can only ever address a single line. A context-menu entry is a
 * visible affordance and carries whatever the reviewer highlighted, so the
 * orchestrator receives the actual code in question, not just a line number.
 *
 * The message format and the send path are shared with DiffSurface — see
 * `lib/diffComment` and `hooks/useOrchestratorDiffComment`.
 */
export function DiffViewer({
  diff,
  loading = false,
  error = null,
  onRetry,
}: DiffViewerProps) {
  const { t } = useTranslation();
  const { summary, files } = useMemo(() => parseDiff(diff), [diff]);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { send, toast } = useOrchestratorDiffComment();

  const [menu, setMenu] = useState<MenuState | null>(null);
  const [composer, setComposer] = useState<MenuState | null>(null);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    setCollapsed(new Set());
  }, [diff]);

  // Dismiss the context menu on any outside interaction or Escape.
  useEffect(() => {
    if (!menu) return;
    const close = () => setMenu(null);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    window.addEventListener("mousedown", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  useEffect(() => {
    if (composer) textareaRef.current?.focus();
  }, [composer]);

  const handleContextMenu = useCallback(
    (e: React.MouseEvent, fileId: string) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>(
        "[data-line-index]",
      );
      if (!el || el.dataset.fileId !== fileId) return;

      e.preventDefault();
      const clicked = Number(el.dataset.lineIndex);
      // A drag selection wins; a bare right-click falls back to that one line.
      const span = readSelectedSpan(fileId) ?? { lo: clicked, hi: clicked };
      setMenu({ x: e.clientX, y: e.clientY, fileId, ...span });
    },
    [],
  );

  const openComposer = useCallback(() => {
    if (!menu) return;
    setDraft("");
    setComposer(menu);
    setMenu(null);
  }, [menu]);

  const submitComment = useCallback(async () => {
    if (!composer || !draft.trim() || sending) return;
    const file = files.find((f) => f.id === composer.fileId);
    if (!file) return;
    setSending(true);
    await send(
      buildRangeFromSelection(file.title, file.lines, composer.lo, composer.hi),
      draft,
    );
    setSending(false);
    setComposer(null);
    setDraft("");
  }, [composer, draft, files, send, sending]);

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

  const composerFile = composer
    ? files.find((f) => f.id === composer.fileId)
    : null;
  const composerLabel =
    composer && composerFile
      ? formatRangeLabel(
          buildRangeFromSelection(
            composerFile.title,
            composerFile.lines,
            composer.lo,
            composer.hi,
          ),
        )
      : "";

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-gray-400">
          {t("board.diff.fileCount", { count: files.length })}
        </span>
        <span className="font-mono text-emerald-300">+{totals.additions}</span>
        <span className="font-mono text-red-300">-{totals.deletions}</span>
        <span className="ml-auto text-[11px] text-gray-500">
          {t("diff.comment.hint")}
        </span>
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
              <pre
                onContextMenu={(e) => handleContextMenu(e, file.id)}
                className="max-h-96 overflow-auto bg-gray-950/70 py-2 font-mono text-[11px] leading-snug"
              >
                {file.lines.map((line, index) => (
                  <div
                    key={`${file.id}:${index}`}
                    data-line-index={index}
                    data-file-id={file.id}
                    className={`min-w-max px-3 whitespace-pre ${lineClassName(
                      line.text,
                    )}`}
                  >
                    {line.text || " "}
                  </div>
                ))}
              </pre>
            )}
          </div>
        );
      })}

      {menu && (
        <div
          role="menu"
          style={{ top: menu.y, left: menu.x }}
          // Keep the menu alive through the click that activates it — the
          // window-level mousedown listener would otherwise close it first.
          onMouseDown={(e) => e.stopPropagation()}
          className="fixed z-[60] overflow-hidden rounded border border-gray-600 bg-gray-800 shadow-lg"
        >
          <button
            type="button"
            role="menuitem"
            onClick={openComposer}
            className="block w-full px-3 py-1.5 text-left text-xs whitespace-nowrap text-gray-100 hover:bg-blue-600"
          >
            {t("diff.comment.action")}
          </button>
        </div>
      )}

      {composer && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4"
          // DiffViewer renders inside TaskDetailModal; keep our clicks and keys
          // from reaching the host modal's close handlers.
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
        >
          <div className="w-full max-w-lg rounded border border-gray-600 bg-gray-900 p-3 shadow-xl">
            <div className="mb-2 truncate font-mono text-[11px] text-gray-400">
              {t("diff.comment.on")} · {composerLabel}
            </div>
            <textarea
              ref={textareaRef}
              rows={4}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") {
                  e.stopPropagation();
                  setComposer(null);
                }
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                  void submitComment();
                }
              }}
              placeholder={t("diff.comment.placeholder")}
              className="w-full resize-y rounded border border-gray-700 bg-gray-950 p-2 text-xs text-gray-100 outline-none focus:border-blue-500"
            />
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setComposer(null)}
                className="rounded border border-gray-600 px-3 py-1 text-xs text-gray-300 hover:bg-gray-800"
              >
                {t("common.cancel")}
              </button>
              <button
                type="button"
                onClick={() => void submitComment()}
                disabled={sending || !draft.trim()}
                className="rounded bg-blue-600 px-3 py-1 text-xs text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {sending ? t("orchestrator.sending") : t("diff.comment.send")}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[60] -translate-x-1/2 rounded bg-gray-800 px-3 py-1.5 text-xs text-gray-100 shadow-lg ring-1 ring-gray-700">
          {toast}
        </div>
      )}
    </div>
  );
}
