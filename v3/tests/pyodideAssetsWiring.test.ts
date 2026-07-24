// Guards the DX contract around the vendored Pyodide runtime.
//
// The original bug was not a broken feature — it was guidance that pointed at
// something the repo did not offer, plus a build-only hook that left `npm run
// dev` on its own. Both are the kind of thing that silently rots, so both are
// asserted here rather than left to a reviewer's memory.

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { PYODIDE_INSTALL_COMMAND } from "../src/lib/notebookKernel/protocol";
import { ko } from "../src/locales/ko";
import { en } from "../src/locales/en";

const V3 = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(
  readFileSync(path.join(V3, "package.json"), "utf-8"),
) as { scripts: Record<string, string> };

describe("pyodide asset wiring", () => {
  it("prints a command the repo actually answers to", () => {
    // The whole point: paste it and it runs. If someone renames the script,
    // this fails instead of a user discovering it.
    expect(PYODIDE_INSTALL_COMMAND).toBe("cd v3 && npm run assets:pyodide");
    expect(pkg.scripts["assets:pyodide"]).toBeDefined();
  });

  it("names the directory, because the repo root has no package.json", () => {
    expect(PYODIDE_INSTALL_COMMAND).toContain("cd v3");
  });

  it("prepares assets on every dev entry point", () => {
    for (const hook of ["predev", "predev:vite", "predev:electron"]) {
      expect(pkg.scripts[hook], `${hook} must exist`).toContain(
        "assets:pyodide:soft",
      );
    }
  });

  it("uses soft mode for dev so an offline machine still boots", () => {
    expect(pkg.scripts["assets:pyodide:soft"]).toContain("--soft");
  });

  it("keeps the packaged build strict, so no installer ships without the runtime", () => {
    const build = pkg.scripts["build:electron"];
    expect(build).toContain("assets:pyodide");
    // Strict, not the soft variant — a build that cannot vendor must fail.
    expect(build).not.toContain("assets:pyodide:soft");
  });

  it("keeps the missing-assets explanation out of the worker", () => {
    // The worker cannot translate (no locale store in a worker), so any prose
    // it authors is stuck in one language — which is how the old guidance both
    // went stale and stayed Korean-only. It reports a code; the renderer
    // writes the sentence. These two literals are what that replaced.
    const worker = readFileSync(
      path.join(V3, "src/lib/notebookKernel/kernel.worker.ts"),
      "utf-8",
    );
    expect(worker).not.toContain("자산이 설치");
    // The old phase check sniffed the message text, so rewording the message
    // silently broke the missing-assets UI. It must key off the code instead.
    expect(worker).not.toContain('includes("자산")');
    expect(worker).toContain('"missing-assets"');
  });

  it("never tells a user to invoke the script by path", () => {
    // `node scripts/fetch-pyodide-assets.mjs` was the old advice: right file,
    // wrong entry point, and no hint about which directory to be in.
    for (const [locale, table] of [
      ["ko", ko],
      ["en", en],
    ] as const) {
      for (const [key, value] of Object.entries(table)) {
        expect(
          value,
          `${locale}.${key} should point at the npm script`,
        ).not.toContain("fetch-pyodide-assets.mjs");
      }
    }
  });

  it("builds its guidance from the single source of truth", () => {
    for (const table of [ko, en]) {
      expect(table["code.notebook.kernel.missingAssetsError"]).toContain(
        "{command}",
      );
    }
  });
});
