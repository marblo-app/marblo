// ESLint flat config for Marblo v3 (Electron + React desktop app)
// TypeScript-aware, @typescript-eslint recommended rules (non-type-checked to
// keep linting fast). Kept intentionally lean as a starting baseline — tighten
// rules incrementally rather than enabling everything at once.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import globals from "globals";

export default tseslint.config(
  // Global ignores (build artifacts, vendored output, type decls)
  {
    ignores: [
      "node_modules/**",
      "dist-mcp/**",
      "functions/lib/**",
      "dist/**",
      "dist-electron/**",
      "**/*.d.ts",
    ],
  },

  // Base JS + TypeScript recommended rule sets
  js.configs.recommended,
  ...tseslint.configs.recommended,

  // Project-wide language options: this app spans the Electron main process
  // (node) and the renderer (browser), so expose both global sets.
  {
    files: ["**/*.{ts,tsx,js,jsx,mjs,cjs}"],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "module",
      globals: {
        ...globals.node,
        ...globals.browser,
      },
    },
  }
);
