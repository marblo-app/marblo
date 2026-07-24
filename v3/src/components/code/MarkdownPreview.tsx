import { useState } from "react";
import type { ComponentPropsWithoutRef } from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeEditor } from "./CodeEditor";
// Syntax-highlight colours for fenced code blocks. Bundled from highlight.js
// (a transitive dep of rehype-highlight) — no external CDN. Defines only `.hljs`
// scoped classes, so importing it here has no effect outside rendered markdown.
import "highlight.js/styles/github-dark.css";

interface MarkdownPreviewProps {
  filePath: string;
  /** Already-read file text — rendered as markdown, and shown verbatim in Raw. */
  content: string;
  language: string;
}

// Element → styled-element map. react-markdown emits bare HTML tags, so every
// visible element is themed here (Tailwind, dark tones matching the app shell)
// rather than relying on a global stylesheet. Kept module-level so the object
// identity is stable across renders.
//
// Exported so NotebookView renders .ipynb markdown cells and code-cell sources
// with the exact same typography as a standalone .md file.
export const markdownComponents: Components = {
  h1: (props) => (
    <h1
      className="mt-6 mb-4 border-b border-gray-700 pb-2 text-2xl font-bold text-gray-100 first:mt-0"
      {...props}
    />
  ),
  h2: (props) => (
    <h2
      className="mt-6 mb-3 border-b border-gray-700 pb-1.5 text-xl font-bold text-gray-100 first:mt-0"
      {...props}
    />
  ),
  h3: (props) => (
    <h3
      className="mt-5 mb-2 text-lg font-semibold text-gray-100 first:mt-0"
      {...props}
    />
  ),
  h4: (props) => (
    <h4
      className="mt-4 mb-2 text-base font-semibold text-gray-200 first:mt-0"
      {...props}
    />
  ),
  h5: (props) => (
    <h5
      className="mt-4 mb-1 text-sm font-semibold text-gray-200 first:mt-0"
      {...props}
    />
  ),
  h6: (props) => (
    <h6
      className="mt-4 mb-1 text-sm font-semibold text-gray-400 first:mt-0"
      {...props}
    />
  ),
  p: (props) => (
    <p className="my-3 leading-7 text-gray-300 first:mt-0" {...props} />
  ),
  a: ({ href, ...props }) => (
    // http(s) links open in the OS browser via the main-process
    // setWindowOpenHandler (target=_blank → deny + shell.openExternal), so the
    // Electron window is never navigated away from the app.
    <a
      href={href}
      target="_blank"
      rel="noreferrer noopener"
      className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
      {...props}
    />
  ),
  ul: (props) => (
    <ul className="my-3 list-disc space-y-1 pl-6 text-gray-300" {...props} />
  ),
  ol: (props) => (
    <ol className="my-3 list-decimal space-y-1 pl-6 text-gray-300" {...props} />
  ),
  li: (props) => <li className="leading-7 marker:text-gray-500" {...props} />,
  blockquote: (props) => (
    <blockquote
      className="my-4 border-l-4 border-gray-600 pl-4 text-gray-400 italic"
      {...props}
    />
  ),
  hr: (props) => <hr className="my-6 border-gray-700" {...props} />,
  img: ({ alt, ...props }) => (
    // eslint-disable-next-line jsx-a11y/alt-text -- alt forwarded from markdown
    <img
      alt={alt ?? ""}
      className="my-3 max-w-full rounded border border-gray-700"
      {...props}
    />
  ),
  table: (props) => (
    <div className="my-4 overflow-x-auto">
      <table
        className="w-full border-collapse text-left text-sm text-gray-300"
        {...props}
      />
    </div>
  ),
  thead: (props) => <thead className="bg-gray-800" {...props} />,
  th: (props) => (
    <th
      className="border border-gray-700 px-3 py-1.5 font-semibold text-gray-200"
      {...props}
    />
  ),
  td: (props) => (
    <td className="border border-gray-700 px-3 py-1.5 align-top" {...props} />
  ),
  pre: (props) => (
    <pre
      className="my-4 overflow-x-auto rounded-md border border-gray-700 bg-gray-900 p-3 text-[13px] leading-6"
      {...props}
    />
  ),
  code: ({
    className,
    children,
    ...props
  }: ComponentPropsWithoutRef<"code">) => {
    // Fenced blocks carry a `language-*` / `hljs` class (added by
    // rehype-highlight) and already live inside the styled <pre> above — pass
    // them through untouched. Inline code (single backticks) has no such class,
    // so it gets the pill treatment here.
    const isBlock = /(^|\s)(language-|hljs)/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={className} {...props}>
          {children}
        </code>
      );
    }
    return (
      <code
        className="rounded bg-gray-800 px-1.5 py-0.5 font-mono text-[0.85em] text-pink-300"
        {...props}
      >
        {children}
      </code>
    );
  },
};

/**
 * Renders a Markdown file as a formatted document (react-markdown + remark-gfm
 * for tables/task-lists + rehype-highlight for fenced code), instead of raw
 * Monaco text. A Preview ↔ Raw toggle mirrors ImagePreview's Preview ↔ Source:
 * the original source is always one click away in the read-only editor.
 *
 * Raw HTML embedded in the markdown is NOT rendered (no rehype-raw), so a
 * malicious .md file can't inject scripts into the renderer.
 */
export function MarkdownPreview({
  filePath,
  content,
  language,
}: MarkdownPreviewProps) {
  const [view, setView] = useState<"preview" | "raw">("preview");

  const toolbar = (
    <div className="flex items-center gap-3 border-b border-gray-700 bg-gray-800 px-3 py-1.5 text-xs text-gray-400">
      <span className="truncate">{filePath.split(/[/\\]/).pop()}</span>
      <span className="text-gray-600 uppercase">Markdown</span>
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

  if (view === "raw") {
    return (
      <div className="flex h-full flex-col">
        {toolbar}
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
        <div className="mx-auto max-w-3xl px-6 py-5 text-[15px]">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={markdownComponents}
          >
            {content}
          </ReactMarkdown>
        </div>
      </div>
    </div>
  );
}
