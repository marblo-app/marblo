// .ipynb (Jupyter notebook) parsing — pure, DOM-free, so it is unit-testable in
// the node-environment vitest suite. NotebookView renders whatever comes out of
// here; every "is this field a string or a string[]?" quirk of the nbformat spec
// is normalized once, at this boundary.
//
// Targets nbformat 4 (what every modern tool writes) and degrades gracefully on
// v3 field names (`pyout`, `prompt_number`) rather than throwing.

/** A single rendered piece of a code cell's result. */
export type NotebookOutput =
  | { kind: "text"; text: string; stream: "stdout" | "stderr" | null }
  | { kind: "image"; mime: string; dataUrl: string }
  | { kind: "html"; html: string }
  | { kind: "markdown"; text: string }
  | { kind: "error"; ename: string; evalue: string; traceback: string };

export interface NotebookCell {
  /** Stable key for React — the nbformat `id` when present, else the index. */
  id: string;
  type: "code" | "markdown" | "raw";
  source: string;
  /** `In [n]` counter; null for never-executed / non-code cells. */
  executionCount: number | null;
  outputs: NotebookOutput[];
}

export interface Notebook {
  cells: NotebookCell[];
  /** Monaco/highlight language id for code cells, e.g. "python". */
  language: string;
  kernelName: string | null;
  nbformat: number;
}

/** Thrown by parseNotebook when the file is not a usable notebook. */
export class NotebookParseError extends Error {}

// nbformat stores multi-line strings as either a plain string or an array of
// lines (each keeping its trailing "\n"). Both mean the same text.
export function joinSource(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.filter(isString).join("");
  return "";
}

// Terminal colour codes leak into tracebacks and coloured stdout. They would
// render as literal "[0;31m" garbage, so drop every CSI/OSC sequence.
// eslint-disable-next-line no-control-regex
const ANSI_RE = /(?:\[[0-9;?]*[ -/]*[@-~]|\][^]*(?:|\\))/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

function isString(v: unknown): v is string {
  return typeof v === "string";
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

// Mime priority for execute_result / display_data bundles. Richest-first: a
// pandas DataFrame ships both text/html and text/plain, a matplotlib figure
// both image/png and text/plain ("<Figure size ...>") — we want the picture.
const MIME_PRIORITY = [
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
  "image/svg+xml",
  "text/html",
  "text/markdown",
  "text/latex",
  "text/plain",
] as const;

/**
 * Picks the one mime type to render from an output's data bundle.
 * Returns null when the bundle holds nothing we know how to show.
 */
export function pickMime(data: Record<string, unknown>): string | null {
  for (const mime of MIME_PRIORITY) {
    if (mime in data) return mime;
  }
  return null;
}

// Base64 payloads are stored line-wrapped (as arrays or with embedded "\n").
// Whitespace is not valid inside a data: URL, so squeeze it out.
function base64Payload(value: unknown): string {
  return joinSource(value).replace(/\s+/g, "");
}

function bundleToOutput(data: Record<string, unknown>): NotebookOutput | null {
  const mime = pickMime(data);
  if (!mime) return null;
  const value = data[mime];

  if (mime.startsWith("image/")) {
    // SVG arrives as markup, every other image type as base64. Both end up in
    // an <img src="data:...">, which never executes scripts — even for SVG.
    const payload =
      mime === "image/svg+xml"
        ? btoaUtf8(joinSource(value))
        : base64Payload(value);
    if (!payload) return null;
    return { kind: "image", mime, dataUrl: `data:${mime};base64,${payload}` };
  }
  if (mime === "text/html") return { kind: "html", html: joinSource(value) };
  if (mime === "text/markdown")
    return { kind: "markdown", text: joinSource(value) };
  // text/latex has no renderer here; showing the source beats showing nothing.
  return { kind: "text", text: stripAnsi(joinSource(value)), stream: null };
}

// btoa() throws on any code point > 0xff, and SVG markup is routinely UTF-8.
// Encode to bytes first so non-ASCII labels in a figure survive.
function btoaUtf8(text: string): string {
  if (typeof TextEncoder === "undefined" || typeof btoa === "undefined") {
    return "";
  }
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/** Normalizes one nbformat output object into 0..1 renderable outputs. */
export function parseOutput(raw: unknown): NotebookOutput | null {
  if (!isRecord(raw)) return null;
  const type = raw.output_type;

  if (type === "stream") {
    const text = stripAnsi(joinSource(raw.text));
    if (!text) return null;
    return {
      kind: "text",
      text,
      stream: raw.name === "stderr" ? "stderr" : "stdout",
    };
  }

  if (type === "error" || type === "pyerr") {
    const traceback = Array.isArray(raw.traceback)
      ? raw.traceback.filter(isString).join("\n")
      : joinSource(raw.traceback);
    return {
      kind: "error",
      ename: isString(raw.ename) ? raw.ename : "Error",
      evalue: stripAnsi(isString(raw.evalue) ? raw.evalue : ""),
      traceback: stripAnsi(traceback),
    };
  }

  // execute_result | display_data | v3's pyout. v3 also inlined the mime keys
  // on the output object itself (`{output_type:"pyout", text:[...]}`), so fall
  // back to the raw object when there is no nested `data` bundle.
  if (isRecord(raw.data)) return bundleToOutput(raw.data);
  if (type === "pyout" || type === "display_data") {
    const legacy: Record<string, unknown> = {};
    if ("png" in raw) legacy["image/png"] = raw.png;
    if ("html" in raw) legacy["text/html"] = raw.html;
    if ("text" in raw) legacy["text/plain"] = raw.text;
    return bundleToOutput(legacy);
  }
  return null;
}

function parseCell(raw: unknown, index: number): NotebookCell {
  const cell = isRecord(raw) ? raw : {};
  const type =
    cell.cell_type === "markdown" || cell.cell_type === "raw"
      ? cell.cell_type
      : "code";
  const rawCount = cell.execution_count ?? cell.prompt_number;
  const outputs = Array.isArray(cell.outputs)
    ? cell.outputs
        .map(parseOutput)
        .filter((o): o is NotebookOutput => o !== null)
    : [];
  return {
    id: isString(cell.id) && cell.id ? cell.id : `cell-${index}`,
    type,
    source: joinSource(cell.source ?? cell.input),
    executionCount: typeof rawCount === "number" ? rawCount : null,
    outputs: type === "code" ? outputs : [],
  };
}

/**
 * Wraps a cell's source in a fenced code block so it can go through the same
 * react-markdown + rehype-highlight pipeline the Markdown preview uses — one
 * highlighter, one theme, no second syntax-highlighting dependency.
 *
 * The fence is grown past the longest backtick run in the source, so a cell
 * containing ``` (docstrings, %%markdown magics) can't break out of the block.
 */
export function toFencedMarkdown(source: string, language: string): string {
  const longestRun = Math.max(
    0,
    ...[...source.matchAll(/`+/g)].map((m) => m[0].length),
  );
  const fence = "`".repeat(Math.max(3, longestRun + 1));
  // A trailing newline keeps the closing fence on its own line even when the
  // source does not end in one.
  return `${fence}${language}\n${source}\n${fence}`;
}

/**
 * Parses .ipynb JSON text into a render-ready notebook.
 * Throws NotebookParseError with a user-facing message on malformed input.
 */
export function parseNotebook(text: string): Notebook {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new NotebookParseError(
      `JSON 파싱 실패: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  if (!isRecord(json)) {
    throw new NotebookParseError("노트북 최상위가 객체가 아닙니다.");
  }
  // v3 kept cells inside worksheets[]; flatten so both shapes render.
  const rawCells = Array.isArray(json.cells)
    ? json.cells
    : Array.isArray(json.worksheets)
      ? json.worksheets.flatMap((w) =>
          isRecord(w) && Array.isArray(w.cells) ? w.cells : [],
        )
      : null;
  if (!rawCells) {
    throw new NotebookParseError("cells 배열이 없습니다 (.ipynb 형식 아님).");
  }

  const metadata = isRecord(json.metadata) ? json.metadata : {};
  const kernelspec = isRecord(metadata.kernelspec) ? metadata.kernelspec : {};
  const langInfo = isRecord(metadata.language_info)
    ? metadata.language_info
    : {};

  return {
    cells: rawCells.map(parseCell),
    language: isString(langInfo.name)
      ? langInfo.name
      : isString(kernelspec.language)
        ? kernelspec.language
        : "python",
    kernelName: isString(kernelspec.display_name)
      ? kernelspec.display_name
      : isString(kernelspec.name)
        ? kernelspec.name
        : null,
    nbformat: typeof json.nbformat === "number" ? json.nbformat : 4,
  };
}
