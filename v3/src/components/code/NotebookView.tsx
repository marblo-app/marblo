import { useCallback, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Play, RotateCcw } from "lucide-react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeEditor } from "./CodeEditor";
import { markdownComponents } from "./MarkdownPreview";
import {
  NotebookParseError,
  parseNotebook,
  toFencedMarkdown,
} from "../../lib/notebook";
import type { NotebookCell, NotebookOutput } from "../../lib/notebook";
import { useNotebookKernel } from "../../hooks/useNotebookKernel";
import type { KernelStatus } from "../../lib/notebookKernel/protocol";
import { useTranslation } from "../../lib/i18n";
import "highlight.js/styles/github-dark.css";

interface NotebookViewProps {
  filePath: string;
  /** Already-read .ipynb JSON text. */
  content: string;
  language: string;
}

/**
 * Renders raw HTML output (a pandas DataFrame's `_repr_html_`, mostly) by
 * *rebuilding* it as React elements from a tag whitelist — we never touch
 * innerHTML/dangerouslySetInnerHTML, and we copy no attributes beyond
 * col/rowspan. DOMParser does not execute scripts while parsing, and anything
 * outside the whitelist is reduced to its text, so a hostile .ipynb cannot get
 * script, style, iframe or an event handler into the renderer.
 */
const HTML_TAGS = new Set([
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "caption",
  "div",
  "span",
  "p",
  "b",
  "strong",
  "i",
  "em",
  "u",
  "code",
  "pre",
  "br",
  "hr",
  "ul",
  "ol",
  "li",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "small",
  "sub",
  "sup",
]);

// Table chrome matching the Markdown preview, so a DataFrame in a notebook and
// a table in a .md file look like the same product.
const HTML_CLASS: Record<string, string> = {
  table: "border-collapse text-left text-sm text-gray-300",
  thead: "bg-gray-800",
  th: "border border-gray-700 px-3 py-1.5 font-semibold text-gray-200",
  td: "border border-gray-700 px-3 py-1.5 align-top whitespace-nowrap",
  caption: "pb-2 text-xs text-gray-500",
};

// Tags that carry no children of their own.
const VOID_TAGS = new Set(["br", "hr"]);

// Inside these, the pretty-printing newlines between tags are not content —
// React (correctly) refuses to render a text node as a child of <table>, so
// they have to be dropped rather than passed through.
const NO_TEXT_CHILDREN = new Set(["table", "thead", "tbody", "tfoot", "tr"]);

function toSafeNodes(
  nodes: ArrayLike<ChildNode>,
  parentTag: string,
): ReactNode[] {
  return Array.from(nodes).flatMap((node, i): ReactNode[] => {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = node.nodeValue ?? "";
      if (NO_TEXT_CHILDREN.has(parentTag) && !text.trim()) return [];
      return [text];
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return []; // comments, CDATA, …

    const el = node as Element;
    const tag = el.tagName.toLowerCase();
    if (!HTML_TAGS.has(tag)) {
      // Not on the whitelist: keep the text it wraps, drop the element. For
      // script/style that text is the code itself, which we also don't want.
      if (tag === "script" || tag === "style") return [];
      return [<span key={i}>{toSafeNodes(el.childNodes, parentTag)}</span>];
    }

    if (VOID_TAGS.has(tag)) {
      return [
        tag === "br" ? (
          <br key={i} />
        ) : (
          <hr key={i} className="my-2 border-gray-700" />
        ),
      ];
    }

    const Tag = tag as keyof JSX.IntrinsicElements;
    const { colSpan, rowSpan } = spanAttrs(el, tag);
    return [
      <Tag
        key={i}
        className={HTML_CLASS[tag]}
        colSpan={colSpan}
        rowSpan={rowSpan}
      >
        {toSafeNodes(el.childNodes, tag)}
      </Tag>,
    ];
  });
}

// colspan/rowspan are the only attributes that survive sanitization — a merged
// header cell is structural, and a number can't carry a payload.
function spanAttrs(el: Element, tag: string) {
  if (tag !== "td" && tag !== "th") return {};
  const read = (name: string) => {
    const n = Number(el.getAttribute(name));
    return Number.isInteger(n) && n > 1 && n <= 1000 ? n : undefined;
  };
  return { colSpan: read("colspan"), rowSpan: read("rowspan") };
}

function SafeHtml({ html }: { html: string }) {
  const nodes = useMemo(() => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return toSafeNodes(doc.body.childNodes, "body");
  }, [html]);
  return <div className="overflow-x-auto">{nodes}</div>;
}

function OutputBlock({ output }: { output: NotebookOutput }) {
  switch (output.kind) {
    case "text":
      return (
        <pre
          className={`overflow-x-auto px-3 py-1.5 font-mono text-[12.5px] leading-5 whitespace-pre-wrap ${
            output.stream === "stderr" ? "text-red-300" : "text-gray-300"
          }`}
        >
          {output.text}
        </pre>
      );
    case "image":
      return (
        <div className="px-3 py-2">
          <img
            src={output.dataUrl}
            alt="cell output"
            className="max-w-full rounded bg-white"
          />
        </div>
      );
    case "html":
      return (
        <div className="px-3 py-2">
          <SafeHtml html={output.html} />
        </div>
      );
    case "markdown":
      return (
        <div className="px-3 py-1 text-[14px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={markdownComponents}
          >
            {output.text}
          </ReactMarkdown>
        </div>
      );
    case "error":
      return (
        <div className="border-l-2 border-red-500/60 bg-red-950/20 px-3 py-1.5">
          <div className="font-mono text-[12.5px] font-semibold text-red-300">
            {output.ename}
            {output.evalue ? `: ${output.evalue}` : ""}
          </div>
          {output.traceback && (
            <pre className="mt-1 overflow-x-auto font-mono text-[12px] leading-5 whitespace-pre-wrap text-red-200/80">
              {output.traceback}
            </pre>
          )}
        </div>
      );
  }
}

function CellPrompt({ label }: { label: string }) {
  return (
    <div className="w-16 shrink-0 pt-2 pr-2 text-right font-mono text-[11px] whitespace-nowrap text-gray-500 select-none">
      {label}
    </div>
  );
}

// Only the <pre> is overridden: the cell body IS the code block, so the
// margins the markdown theme adds would just push cells apart.
const cellCodeComponents: Components = {
  pre: (props) => (
    <pre className="overflow-x-auto p-3 text-[13px] leading-6" {...props} />
  ),
};

function CodeCell({
  cell,
  language,
  live,
  onRun,
  isRunning,
  busy,
}: {
  cell: NotebookCell;
  language: string;
  /** Outputs from this session's run, which replace the saved ones. */
  live: NotebookOutput[] | null;
  onRun: () => void;
  isRunning: boolean;
  /** Another cell holds the kernel — Run stays visible but disabled. */
  busy: boolean;
}) {
  const { t } = useTranslation();
  const markdown = useMemo(
    () => toFencedMarkdown(cell.source, language),
    [cell.source, language],
  );
  const outputs = live ?? cell.outputs;
  const label = isRunning ? "In [*]:" : `In [${cell.executionCount ?? " "}]:`;

  return (
    <div className="group flex">
      <CellPrompt label={label} />
      <div className="min-w-0 flex-1">
        <div className="relative overflow-hidden rounded-md border border-gray-700 bg-gray-950">
          <ReactMarkdown
            rehypePlugins={[rehypeHighlight]}
            components={cellCodeComponents}
          >
            {markdown}
          </ReactMarkdown>
          <button
            type="button"
            onClick={onRun}
            disabled={busy}
            title={t("code.notebook.run")}
            aria-label={t("code.notebook.run")}
            className="absolute top-1.5 right-1.5 flex items-center gap-1 rounded border border-gray-600 bg-gray-800/90 px-2 py-0.5 text-[11px] text-gray-300 opacity-0 transition group-hover:opacity-100 focus:opacity-100 enabled:hover:bg-gray-700 enabled:hover:text-white disabled:cursor-not-allowed disabled:opacity-40 group-hover:disabled:opacity-40"
          >
            {isRunning ? (
              <span className="h-3 w-3 animate-spin rounded-full border border-gray-500 border-t-blue-400" />
            ) : (
              <Play size={11} />
            )}
            {t("code.notebook.run")}
          </button>
        </div>
        {outputs.length > 0 && (
          <div className="mt-1 divide-y divide-gray-800 rounded-md border border-gray-800 bg-gray-900/60">
            {outputs.map((output, i) => (
              <OutputBlock key={i} output={output} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function MarkdownCell({ cell }: { cell: NotebookCell }) {
  return (
    <div className="flex">
      <CellPrompt label="" />
      <div className="min-w-0 flex-1 text-[15px]">
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          rehypePlugins={[rehypeHighlight]}
          components={markdownComponents}
        >
          {cell.source}
        </ReactMarkdown>
      </div>
    </div>
  );
}

/** Kernel state, shown only once the user has actually started one. */
function KernelBadge({ status }: { status: KernelStatus }) {
  const { t } = useTranslation();
  if (status.phase === "idle") return null;

  const busy =
    status.phase === "loading-runtime" ||
    status.phase === "loading-packages" ||
    status.phase === "running";
  const broken = status.phase === "failed" || status.phase === "missing-assets";
  const text =
    status.phase === "loading-runtime"
      ? t("code.notebook.kernel.loadingRuntime")
      : status.phase === "loading-packages"
        ? t("code.notebook.kernel.loadingPackages")
        : status.phase === "running"
          ? t("code.notebook.kernel.running")
          : status.phase === "ready"
            ? t("code.notebook.kernel.ready")
            : (status.detail ?? t("code.notebook.kernel.failed"));

  return (
    <span
      title={status.detail}
      className={`flex min-w-0 items-center gap-1.5 ${
        broken ? "text-red-400" : busy ? "text-blue-300" : "text-green-400"
      }`}
    >
      {busy ? (
        <span className="h-2.5 w-2.5 shrink-0 animate-spin rounded-full border border-blue-400/40 border-t-blue-300" />
      ) : (
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            broken ? "bg-red-400" : "bg-green-400"
          }`}
        />
      )}
      <span className="truncate">{text}</span>
    </span>
  );
}

/**
 * Renders a Jupyter notebook (.ipynb) as cells + their saved outputs — text,
 * matplotlib PNGs, DataFrame tables and tracebacks — instead of the raw JSON
 * blob Monaco would show. A Preview ↔ Raw toggle mirrors MarkdownPreview, so
 * the underlying JSON is always one click away.
 */
export function NotebookView({
  filePath,
  content,
  language,
}: NotebookViewProps) {
  const { t } = useTranslation();
  const [view, setView] = useState<"preview" | "raw">("preview");
  const { status, runningCellId, runCell, restart } = useNotebookKernel();
  // Outputs produced this session, keyed by cell id. The file on disk is never
  // touched — a notebook opened here is a read-only document that you can
  // *also* run, so a stray Run can't corrupt the user's .ipynb.
  const [liveOutputs, setLiveOutputs] = useState<
    Record<string, NotebookOutput[]>
  >({});

  const onRun = useCallback(
    async (cell: NotebookCell) => {
      const result = await runCell(cell.id, cell.source);
      setLiveOutputs((prev) => ({ ...prev, [cell.id]: result.outputs }));
    },
    [runCell],
  );

  const onRestart = useCallback(() => {
    restart();
    setLiveOutputs({});
  }, [restart]);

  const parsed = useMemo(() => {
    try {
      return { notebook: parseNotebook(content), error: null };
    } catch (e) {
      return {
        notebook: null,
        error:
          e instanceof NotebookParseError
            ? e.message
            : e instanceof Error
              ? e.message
              : String(e),
      };
    }
  }, [content]);

  const notebook = parsed.notebook;
  const codeCells = notebook
    ? notebook.cells.filter((c) => c.type === "code").length
    : 0;

  const toolbar = (
    <div className="flex items-center gap-3 border-b border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-400">
      <span className="truncate">{filePath.split(/[/\\]/).pop()}</span>
      <span className="text-gray-600 uppercase">Notebook</span>
      {notebook && (
        <span className="truncate text-gray-500">
          {notebook.kernelName ?? notebook.language} ·{" "}
          {t("code.notebook.cellCount", {
            total: notebook.cells.length,
            code: codeCells,
          })}
        </span>
      )}
      <KernelBadge status={status} />
      {status.phase !== "idle" && (
        <button
          type="button"
          onClick={onRestart}
          title={t("code.notebook.restart")}
          className="flex items-center gap-1 rounded border border-gray-700 px-1.5 py-0.5 text-gray-400 hover:bg-gray-700 hover:text-white"
        >
          <RotateCcw size={11} />
          {t("code.notebook.restart")}
        </button>
      )}
      <div className="ml-auto flex overflow-hidden rounded border border-gray-700">
        <button
          type="button"
          onClick={() => setView("preview")}
          className={`px-2 py-0.5 ${
            view === "preview"
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-gray-700"
          }`}
        >
          Preview
        </button>
        <button
          type="button"
          onClick={() => setView("raw")}
          className={`px-2 py-0.5 ${
            view === "raw"
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-gray-700"
          }`}
        >
          Raw
        </button>
      </div>
    </div>
  );

  if (view === "raw" || !notebook) {
    return (
      <div className="flex h-full flex-col">
        {toolbar}
        {parsed.error && (
          <div className="border-b border-red-900/50 bg-red-950/30 px-3 py-1.5 text-xs text-red-300">
            {t("code.notebook.parseError", { message: parsed.error })}
          </div>
        )}
        <div className="min-h-0 flex-1">
          <CodeEditor
            filePath={filePath}
            content={content}
            language={language}
            readOnly
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {toolbar}
      <div className="min-h-0 flex-1 overflow-auto bg-gray-900">
        <div className="mx-auto max-w-5xl space-y-4 px-5 py-5">
          {notebook.cells.length === 0 && (
            <div className="py-10 text-center text-sm text-gray-500">
              {t("code.notebook.empty")}
            </div>
          )}
          {notebook.cells.map((cell) =>
            cell.type === "markdown" ? (
              <MarkdownCell key={cell.id} cell={cell} />
            ) : cell.type === "raw" ? (
              <div key={cell.id} className="flex">
                <CellPrompt label="" />
                <pre className="min-w-0 flex-1 overflow-x-auto rounded-md border border-dashed border-gray-700 p-3 font-mono text-[12.5px] leading-5 whitespace-pre-wrap text-gray-500">
                  {cell.source}
                </pre>
              </div>
            ) : (
              <CodeCell
                key={cell.id}
                cell={cell}
                language={notebook.language}
                live={liveOutputs[cell.id] ?? null}
                isRunning={runningCellId === cell.id}
                busy={runningCellId !== null}
                onRun={() => void onRun(cell)}
              />
            ),
          )}
        </div>
      </div>
    </div>
  );
}
