// Jupyter notebook detection for the Code tab preview.
// When an open file is a notebook, CodeTab renders <NotebookView> (cells +
// their saved outputs, with per-cell Run via Pyodide) instead of the Monaco
// text editor — the same shape as the image and markdown branches.

import { fileExt } from "./imageFiles";

export function isNotebookFile(p: string): boolean {
  return fileExt(p) === "ipynb";
}
