import { describe, expect, it } from "vitest";
import { isMarkdownFile } from "../src/lib/markdownFiles";

describe("isMarkdownFile", () => {
  it("recognizes common markdown extensions (case-insensitive)", () => {
    for (const p of [
      "README.md",
      "docs/GUIDE.markdown",
      "notes.mdown",
      "a.mkd",
      "b.mkdn",
      "UPPER.MD",
      "C:\\proj\\CHANGELOG.md",
    ]) {
      expect(isMarkdownFile(p)).toBe(true);
    }
  });

  it("rejects non-markdown and extensionless paths", () => {
    for (const p of [
      "index.ts",
      "styles.css",
      "photo.png",
      "mdfile", // no dot
      "README", // no extension
      "archive.md.zip", // final ext wins
      ".mdignore", // dotfile, ext is "mdignore"
    ]) {
      expect(isMarkdownFile(p)).toBe(false);
    }
  });
});
