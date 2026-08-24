import { createContext, useContext, useMemo, useRef, useState } from "react";
import type {
  ComponentPropsWithoutRef,
  MouseEvent as ReactMouseEvent,
  ReactNode,
  RefObject,
} from "react";
import ReactMarkdown from "react-markdown";
import type { Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { CodeEditor } from "./CodeEditor";
import {
  resolveMarkdownLinkTarget,
  slugifyHeading,
} from "../../lib/markdownLinks";
import { useEditorStore } from "../../stores/editorStore";
// Syntax-highlight colours for fenced code blocks. Bundled from highlight.js
// (a transitive dep of rehype-highlight) — no external CDN. Defines only `.hljs`
// scoped classes, so importing it here has no effect outside rendered markdown.
import "highlight.js/styles/github-dark.css";

interface MarkdownPreviewProps {
  filePath: string;
  /** Already-read file text — rendered as markdown, and shown verbatim in Edit. */
  content: string;
  language: string;
  /** Optional read-only contexts can opt out of editing; markdown is editable by default. */
  readOnly?: boolean;
}

/**
 * Which document the rendered markdown belongs to, so a relative link
 * (`./other.md`) can be resolved against it — and where to scroll for an
 * anchor. Defaults to "no document": NotebookView renders markdown cells with
 * the same component map and has no single owning file, so its relative links
 * resolve to `ignore` (do nothing) rather than opening a blank window.
 */
interface MarkdownDocContextValue {
  filePath: string | null;
  containerRef: RefObject<HTMLDivElement | null> | null;
}

const MarkdownDocContext = createContext<MarkdownDocContextValue>({
  filePath: null,
  containerRef: null,
});

/** Flatten a heading's React children to plain text for the anchor slug. */
function nodeText(node: ReactNode): string {
  if (node === null || node === undefined || typeof node === "boolean") {
    return "";
  }
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(nodeText).join("");
  if (typeof node === "object" && "props" in node) {
    return nodeText((node.props as { children?: ReactNode }).children);
  }
  return "";
}

/**
 * The one place a markdown link decides what to do. Everything except external
 * http(s) has its default click cancelled — that default is exactly what used
 * to reach the main process' setWindowOpenHandler and open an empty
 * BrowserWindow (ticket 9XXzjqJzWVmTc6ASnETU).
 */
function MarkdownLink({
  href,
  children,
  ...props
}: ComponentPropsWithoutRef<"a">) {
  const { filePath, containerRef } = useContext(MarkdownDocContext);
  const rootPath = useEditorStore((s) => s.rootPath);
  const openFile = useEditorStore((s) => s.openFile);

  const target = useMemo(
    () => resolveMarkdownLinkTarget(href, { rootPath, filePath }),
    [href, rootPath, filePath],
  );

  const isExternal = target.kind === "external";

  const handleClick = (event: ReactMouseEvent<HTMLAnchorElement>) => {
    // External http(s) keeps the pre-existing path: target="_blank" → the main
    // process denies the window and hands the URL to the OS browser.
    if (isExternal) return;

    event.preventDefault();

    if (target.kind === "file") {
      void openFile(target.path);
      return;
    }

    if (target.kind === "anchor") {
      const root: ParentNode | Document =
        containerRef?.current ?? event.currentTarget.ownerDocument;
      const escaped =
        typeof CSS !== "undefined" && typeof CSS.escape === "function"
          ? CSS.escape(target.anchor)
          : target.anchor.replace(/["\\]/g, "\\$&");
      const el = root.querySelector(`#${escaped}`);
      el?.scrollIntoView({ behavior: "smooth", block: "start" });
      return;
    }

    // kind === "ignore" — unsupported scheme, path escaping the repo, or no
    // document context. Do nothing at all; never open a window.
  };

  return (
    <a
      href={href}
      target={isExternal ? "_blank" : undefined}
      rel="noreferrer noopener"
      onClick={handleClick}
      className="text-blue-400 underline decoration-blue-400/40 underline-offset-2 hover:text-blue-300"
      {...props}
    >
      {children}
    </a>
  );
}

/** h1–h6 share slug ids so `#anchor` links have something to scroll to. */
function heading(
  Tag: "h1" | "h2" | "h3" | "h4" | "h5" | "h6",
  className: string,
) {
  return function Heading({
    children,
    ...props
  }: ComponentPropsWithoutRef<"h1">) {
    const id = slugifyHeading(nodeText(children));
    return (
      <Tag id={id || undefined} className={className} {...props}>
        {children}
      </Tag>
    );
  };
}

// Element → styled-element map. react-markdown emits bare HTML tags, so every
// visible element is themed here (Tailwind, dark tones matching the app shell)
// rather than relying on a global stylesheet. Kept module-level so the object
// identity is stable across renders.
//
// Exported so NotebookView renders .ipynb markdown cells and code-cell sources
// with the exact same typography as a standalone .md file.
export const markdownComponents: Components = {
  h1: heading(
    "h1",
    "mt-6 mb-4 border-b border-gray-700 pb-2 text-2xl font-bold text-gray-100 first:mt-0",
  ),
  h2: heading(
    "h2",
    "mt-6 mb-3 border-b border-gray-700 pb-1.5 text-xl font-bold text-gray-100 first:mt-0",
  ),
  h3: heading("h3", "mt-5 mb-2 text-lg font-semibold text-gray-100 first:mt-0"),
  h4: heading(
    "h4",
    "mt-4 mb-2 text-base font-semibold text-gray-200 first:mt-0",
  ),
  h5: heading("h5", "mt-4 mb-1 text-sm font-semibold text-gray-200 first:mt-0"),
  h6: heading("h6", "mt-4 mb-1 text-sm font-semibold text-gray-400 first:mt-0"),
  p: (props) => (
    <p className="my-3 leading-7 text-gray-300 first:mt-0" {...props} />
  ),
  // Every link goes through MarkdownLink: repo-relative paths open in-app,
  // anchors scroll, external http(s) keeps the OS-browser path, and anything
  // else does nothing. See ticket 9XXzjqJzWVmTc6ASnETU (blank-window bug).
  a: MarkdownLink,
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
 * Monaco text. A Preview ↔ Edit toggle mirrors ImagePreview's Preview ↔ Source:
 * the editable original source is always one click away.
 *
 * Raw HTML embedded in the markdown is NOT rendered (no rehype-raw), so a
 * malicious .md file can't inject scripts into the renderer.
 */
export function MarkdownPreview({
  filePath,
  content,
  language,
  readOnly = false,
}: MarkdownPreviewProps) {
  const [view, setView] = useState<"preview" | "edit">("preview");
  // Anchor links scroll inside this document's own scroll container, so a
  // second markdown view mounted elsewhere can never steal the scroll.
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const docContext = useMemo(
    () => ({ filePath, containerRef: scrollRef }),
    [filePath],
  );

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
          onClick={() => setView("edit")}
          className={`px-2 py-0.5 ${
            view === "edit"
              ? "bg-blue-600 text-white"
              : "text-gray-300 hover:bg-gray-700"
          }`}
        >
          Edit
        </button>
      </div>
    </div>
  );

  if (view === "edit") {
    return (
      <div className="flex h-full flex-col">
        {toolbar}
        <div className="min-h-0 flex-1">
          <CodeEditor
            filePath={filePath}
            content={content}
            language={language}
            readOnly={readOnly}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      {toolbar}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-auto bg-gray-900">
        <div className="mx-auto max-w-3xl px-6 py-5 text-[15px]">
          <MarkdownDocContext.Provider value={docContext}>
            <ReactMarkdown
              remarkPlugins={[remarkGfm]}
              rehypePlugins={[rehypeHighlight]}
              components={markdownComponents}
            >
              {content}
            </ReactMarkdown>
          </MarkdownDocContext.Provider>
        </div>
      </div>
    </div>
  );
}
