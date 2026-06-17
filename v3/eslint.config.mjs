// ESLint flat config for Marblo v3 (Electron + React desktop app)
// TypeScript-aware, @typescript-eslint recommended rules (non-type-checked to
// keep linting fast). Kept intentionally lean as a starting baseline — tighten
// rules incrementally rather than enabling everything at once.
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import reactHooks from "eslint-plugin-react-hooks";
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
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "error",
        {
          argsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
        },
      ],
    },
  },

  // Renderer (React) source: enable the stable react-hooks "recommended" set
  // (rules-of-hooks=error, exhaustive-deps=warn) and a no-console policy.
  // Scoped to src/** only — the Electron main process (electron/) and Cloud
  // Functions use console as their primary node-side logger, so banning it
  // there is out of scope for this baseline.
  {
    files: ["src/**/*.{ts,tsx,jsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: {
      ...reactHooks.configs.recommended.rules,
      // Forbid the catch-all console.log; allow explicit, leveled logging.
      // console.debug stays available for tagged diagnostics (hidden by
      // default in devtools), so existing logs convert without losing intent.
      "no-console": ["error", { allow: ["warn", "error", "info", "debug"] }],
    },
  },
);
