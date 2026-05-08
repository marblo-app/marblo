// Plain-Node smoke test for the PII scrubber. Mirrors the production
// regex set in v3/src/lib/telemetry/scrub.ts. Run with:
//   node v3/tests/telemetry/scrub.test.mjs
//
// The vitest harness in this repo is currently broken (ESM/CJS deps), so
// this is a self-contained, dependency-free check that covers the 30+
// cases required by master plan §15.6.

const FILE_PATH =
  /(?:\/Users\/[^/\s"']+|\/home\/[^/\s"']+|C:\\Users\\[^\\\s"']+)/gi;
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const PHONE_KR = /\b01[016789][-.\s]?\d{3,4}[-.\s]?\d{4}\b/g;
const PHONE_INTL = /\+\d{1,3}[-.\s]?\d{2,4}[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g;
const ANTHROPIC_KEY = /sk-ant-[A-Za-z0-9_-]{20,}/g;
const OPENAI_KEY = /sk-[A-Za-z0-9_-]{20,}/g;
const GOOGLE_KEY = /AIza[A-Za-z0-9_-]{20,}/g;
const SECRET_KEY_NAME =
  /(_KEY|_TOKEN|_SECRET|^MARBLO_|^ANTHROPIC_|^OPENAI_|^GOOGLE_)/i;
const USER_INPUT_KEY =
  /^(prompt|initialPrompt|message|userInput|content|raw_input)$/i;
const MAX_DEPTH = 8;

function scrubString(input) {
  if (!input) return input;
  return input
    .replace(ANTHROPIC_KEY, "<API_KEY>")
    .replace(GOOGLE_KEY, "<API_KEY>")
    .replace(OPENAI_KEY, "<API_KEY>")
    .replace(EMAIL, "<EMAIL>")
    .replace(PHONE_KR, "<PHONE>")
    .replace(PHONE_INTL, "<PHONE>")
    .replace(FILE_PATH, "<USER_HOME>");
}

function scrubValue(value, depth = 0) {
  if (depth > MAX_DEPTH) return "<TRUNCATED>";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") return scrubString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((v) => scrubValue(v, depth + 1));
  if (typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) {
      if (USER_INPUT_KEY.test(key)) continue;
      if (SECRET_KEY_NAME.test(key)) {
        out[key] = "<REDACTED>";
        continue;
      }
      out[key] = scrubValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

const cases = [
  // ── File paths (5) ──────────────────────────────────────────
  [
    "macOS user home",
    "Crashed at /Users/john.kim/repo/main.ts",
    "Crashed at <USER_HOME>/repo/main.ts",
  ],
  [
    "Linux user home",
    "Failed in /home/dongwon/.config/marblo",
    "Failed in <USER_HOME>/.config/marblo",
  ],
  ["Windows user home", "C:\\Users\\dongwon\\AppData", "<USER_HOME>\\AppData"],
  [
    "multiple paths",
    "from /Users/a/x and /home/b/y",
    "from <USER_HOME>/x and <USER_HOME>/y",
  ],
  ["no path", "Plain message", "Plain message"],

  // ── Emails (5) ──────────────────────────────────────────────
  ["plain email", "contact john.kim@hypemarc.com", "contact <EMAIL>"],
  ["email + path", "user/Users/john.kim@hypemarc.com", "user<USER_HOME>"],
  ["plus alias", "john+tag@example.co.kr now", "<EMAIL> now"],
  ["multiple emails", "a@b.com and c@d.io", "<EMAIL> and <EMAIL>"],
  ["email-like but no TLD", "not@email", "not@email"],

  // ── Phone numbers (5) ────────────────────────────────────────
  ["KR mobile dashed", "010-1234-5678 call me", "<PHONE> call me"],
  ["KR mobile dotted", "010.1234.5678", "<PHONE>"],
  ["KR mobile nodash", "01012345678", "<PHONE>"],
  ["intl phone", "+1 415 555 1234 office", "<PHONE> office"],
  ["random digits not phone", "order #12345 ok", "order #12345 ok"],

  // ── BYOK keys (6) ────────────────────────────────────────────
  [
    "Anthropic key",
    "sk-ant-api01-AbCdEfGhIjKlMnOpQrSt rotated",
    "<API_KEY> rotated",
  ],
  ["OpenAI key", "sk-AbCdEfGhIjKlMnOpQrStUvWxYz rotated", "<API_KEY> rotated"],
  [
    "Google key",
    "AIzaSyAaBbCcDdEeFfGgHhIiJjKkLlMmNnOoPp seen",
    "<API_KEY> seen",
  ],
  ["short sk- not key", "sk-short", "sk-short"],
  [
    "mixed payload",
    "key=AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ1234 email a@b.io",
    "key=<API_KEY> email <EMAIL>",
  ],
  [
    "anthropic before openai (no double scrub)",
    "sk-ant-1234567890abcdefghij",
    "<API_KEY>",
  ],

  // ── Object scrubbing — secret key names (6) ───────────────────
  [
    "env-style API_KEY",
    { ANTHROPIC_API_KEY: "secret123" },
    { ANTHROPIC_API_KEY: "<REDACTED>" },
  ],
  ["TOKEN suffix", { GH_TOKEN: "ghp_xxx" }, { GH_TOKEN: "<REDACTED>" }],
  [
    "MARBLO_ prefix",
    { MARBLO_PROJECT: "abc" },
    { MARBLO_PROJECT: "<REDACTED>" },
  ],
  [
    "non-secret untouched",
    { project: "alpha", count: 3 },
    { project: "alpha", count: 3 },
  ],
  [
    "nested env",
    { env: { OPENAI_KEY: "sk-x" } },
    { env: { OPENAI_KEY: "<REDACTED>" } },
  ],
  ["array of strings", ["a@b.com", "/Users/x/y"], ["<EMAIL>", "<USER_HOME>/y"]],

  // ── User-input drop (3) ───────────────────────────────────────
  [
    "prompt key dropped",
    { prompt: "raw prose", role: "backend" },
    { role: "backend" },
  ],
  ["initialPrompt dropped", { initialPrompt: "x" }, {}],
  ["message dropped", { message: "user typed", taskId: "T" }, { taskId: "T" }],

  // ── Edge cases (4) ────────────────────────────────────────────
  ["null", null, null],
  ["undefined", undefined, undefined],
  ["number", 42, 42],
  ["boolean", true, true],
];

let pass = 0;
let fail = 0;
for (const [name, input, expected] of cases) {
  const got = typeof input === "object" ? scrubValue(input) : scrubValue(input);
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) {
    pass++;
  } else {
    fail++;
    console.log(`FAIL: ${name}`);
    console.log(`  input:    ${JSON.stringify(input)}`);
    console.log(`  expected: ${JSON.stringify(expected)}`);
    console.log(`  got:      ${JSON.stringify(got)}`);
  }
}

console.log(
  `\nscrub: ${pass}/${cases.length} passed${fail ? `, ${fail} failed` : ""}`
);
process.exit(fail ? 1 : 0);
