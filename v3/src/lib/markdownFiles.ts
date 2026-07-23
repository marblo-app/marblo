// Markdown file detection for the Code tab preview.
// When an open file is Markdown, CodeTab renders <MarkdownPreview> (a rendered
// document with a Preview ↔ Raw toggle) instead of the Monaco text editor — the
// same shape as the image branch, which swaps in <ImagePreview>.

import { fileExt } from "./imageFiles";

const MARKDOWN_EXTS = new Set(["md", "markdown", "mdown", "mkd", "mkdn"]);

export function isMarkdownFile(p: string): boolean {
  return MARKDOWN_EXTS.has(fileExt(p));
}
