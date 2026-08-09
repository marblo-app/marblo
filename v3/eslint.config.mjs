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
      // credit-proxy is a separate Cloud Run package with its own build output
      // (gitignored, but present locally after `npm test` / `npm run build`).
      "credit-proxy/dist/**",
      "credit-proxy/.test-out/**",
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

  // i18n guard: discourage NEW hard-coded Korean UI strings in JSX. The app is
  // mid-migration to English i18n (PR-0 namespace split → P1–P6 translation),
  // so this is `warn`, not `error` — it surfaces un-migrated strings for the
  // follow-up PRs without breaking `eslint .` (warnings exit 0) on the large
  // body of pre-existing Korean literals. Hangul range = syllables + Jamo.
  // What's exempt (data values, identifiers, logs/paths): see src/locales/README.md.
  {
    files: ["src/**/*.{tsx,jsx}"],
    rules: {
      "no-restricted-syntax": [
        "warn",
        {
          // Visible text content: <div>안녕</div>
          selector: "JSXText[value=/[\\u3130-\\u318F\\uAC00-\\uD7A3]/]",
          message:
            "JSX에 한글 UI 문자열을 직접 넣지 마세요. src/locales/<ns> 네임스페이스에 키를 추가하고 t()로 사용하세요. 데이터/식별자/로그 예외는 src/locales/README.md 참고.",
        },
        {
          // User-facing string attributes: title/placeholder/aria-label/alt/label="한글"
          selector:
            "JSXAttribute[name.name=/^(title|placeholder|alt|label|aria-label)$/] > Literal[value=/[\\u3130-\\u318F\\uAC00-\\uD7A3]/]",
          message:
            "한글 UI 속성 문자열은 t()로 번역하세요. 예외는 src/locales/README.md 참고.",
        },
      ],
    },
  },
);
