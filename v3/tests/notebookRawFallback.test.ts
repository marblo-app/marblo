// The unparseable-.ipynb fallback.
//
// NotebookView no longer offers a Preview/Raw toggle, so this branch is the
// ONLY thing standing between a corrupt notebook and a blank screen. It has to
// show the file's bytes AND say why — which makes it worth a test that renders
// the real component against real broken files rather than trusting a reading
// of the JSX.
//
// renderToStaticMarkup, not a DOM: the suite runs in node, and everything this
// branch does (parse, pick a message, emit markup) is reachable without one.

import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

// Monaco cannot mount without a DOM and is not what we are testing — swap it
// for a marker so we can still assert the raw text is handed to it.
vi.mock("../src/components/code/CodeEditor", () => ({
  CodeEditor: ({ content }: { content: string }) =>
    createElement("pre", { "data-testid": "raw-editor" }, content),
}));

const { NotebookView } = await import("../src/components/code/NotebookView");
const { ko } = await import("../src/locales/ko");

function render(content: string): string {
  return renderToStaticMarkup(
    createElement(NotebookView, {
      filePath: "/tmp/broken.ipynb",
      content,
      language: "json",
    }),
  );
}

// Every one of these is a plausible way a real .ipynb goes bad.
const BROKEN: Record<string, string> = {
  "truncated mid-write": '{"cells": [{"cell_type": "code", "source": ["pri',
  "not JSON at all": "<<<<<<< HEAD\nmerge conflict garbage\n",
  "valid JSON, wrong shape": '{"hello": "world"}',
  "JSON array, not an object": "[1, 2, 3]",
  "no cells key": '{"metadata": {}, "nbformat": 4}',
  empty: "",
};

describe("NotebookView — unparseable .ipynb", () => {
  for (const [label, content] of Object.entries(BROKEN)) {
    it(`renders the raw text with a reason instead of crashing: ${label}`, () => {
      const html = render(content);

      // 1. It explains itself.
      expect(html).toContain(ko["code.notebook.rawFallback.title"]);
      // 2. With a specific cause — the generic fallback is for the
      //    can't-happen case and must not be what users actually see.
      expect(html).toContain("원인:");
      expect(html).not.toContain(ko["code.notebook.rawFallback.unknownReason"]);
      // 3. And it still shows the bytes, which is the whole point.
      expect(html).toContain('data-testid="raw-editor"');
    });
  }

  it("hands the untouched file content to the editor", () => {
    const html = render('{"hello": "world"}');
    expect(html).toContain("{&quot;hello&quot;: &quot;world&quot;}");
  });

  it("offers no Raw toggle — a readable notebook renders as cells only", () => {
    const notebook = JSON.stringify({
      nbformat: 4,
      cells: [
        { cell_type: "code", source: ["print('hi')\n"], outputs: [] },
        { cell_type: "markdown", source: ["# title\n"] },
      ],
    });
    const html = render(notebook);

    expect(html).not.toContain(">Raw<");
    expect(html).not.toContain(">Preview<");
    expect(html).not.toContain(ko["code.notebook.rawFallback.title"]);
    // The cells themselves rendered, so "no toggle" did not mean "no view".
    // Highlighting wraps the source in spans, so match its pieces, not the
    // original line.
    expect(html).toContain('class="hljs language-python"');
    expect(html).toContain("&#x27;hi&#x27;");
    expect(html).toContain("title</h1>");
    // ...and the Run affordance survived, i.e. this is the executable view.
    expect(html).toContain(ko["code.notebook.run"]);
  });
});
